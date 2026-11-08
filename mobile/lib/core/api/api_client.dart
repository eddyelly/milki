import 'dart:math';

import 'package:dio/dio.dart';

import '../config.dart';
import 'token_store.dart';

/// An API error with the server's human-readable message (CLAUDE.md §8, never show raw codes).
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.details]);

  final int status;
  final String code;
  final String message;
  final Object? details;

  bool get isNetwork => status == 0;

  @override
  String toString() => message;

  static ApiException from(Object error) {
    if (error is ApiException) return error;
    if (error is DioException) {
      final inner = error.error;
      if (inner is ApiException) return inner;
      final body = error.response?.data;
      if (body is Map && body['error'] is Map) {
        final e = body['error'] as Map;
        return ApiException(error.response?.statusCode ?? 0, (e['code'] ?? 'ERROR').toString(), (e['message'] ?? 'Something went wrong.').toString(), e['details']);
      }
      if (error.response == null) return ApiException(0, 'NETWORK', 'Milki could not be reached. Check your connection and try again.');
      return ApiException(error.response!.statusCode ?? 0, 'HTTP_ERROR', 'Something went wrong. Please try again.');
    }
    return ApiException(0, 'UNKNOWN', 'Something went wrong. Please try again.');
  }
}

final _rng = Random.secure();

/// Random UUID v4 (Idempotency-Key, device IDs).
String newUuid() {
  final b = List<int>.generate(16, (_) => _rng.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

/// Options for a write: the dialog's stable idempotency key and, for ledger writes, the re-auth token.
class WriteOptions {
  const WriteOptions({this.idempotencyKey, this.reauthToken});
  final String? idempotencyKey;
  final String? reauthToken;

  Map<String, String> headers() => {
        'Idempotency-Key': idempotencyKey ?? newUuid(),
        'X-Reauth-Token': ?reauthToken,
      };
}

/// Dio wrapper: bearer token, single-flight refresh on 401 (rotating refresh token in secure storage),
/// `{ data, meta }` unwrapping and error mapping.
class ApiClient {
  ApiClient({required this.tokens, Dio? dio, String? baseUrl, this.onSessionExpired})
      : dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl ?? AppConfig.apiUrl, connectTimeout: const Duration(seconds: 15), receiveTimeout: const Duration(seconds: 45))) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final Dio dio;
  final TokenStore tokens;
  final void Function()? onSessionExpired;
  Future<bool>? _refreshing;

  Future<void> _onRequest(RequestOptions o, RequestInterceptorHandler h) async {
    final access = tokens.accessToken;
    if (access != null && !o.headers.containsKey('Authorization')) o.headers['Authorization'] = 'Bearer $access';
    h.next(o);
  }

  Future<void> _onError(DioException e, ErrorInterceptorHandler h) async {
    final body = e.response?.data;
    final code = body is Map && body['error'] is Map ? (body['error'] as Map)['code'] : null;
    final retried = e.requestOptions.extra['retried'] == true;
    if (e.response?.statusCode == 401 && code == 'UNAUTHORIZED' && !retried && !e.requestOptions.path.contains('/auth/')) {
      if (await refresh()) {
        final o = e.requestOptions
          ..extra['retried'] = true
          ..headers['Authorization'] = 'Bearer ${tokens.accessToken}';
        try {
          return h.resolve(await dio.fetch<dynamic>(o));
        } on DioException catch (again) {
          return h.next(again);
        }
      }
      onSessionExpired?.call();
    }
    h.next(e);
  }

  /// Rotates the refresh token. Concurrent callers share one request.
  Future<bool> refresh() {
    return _refreshing ??= () async {
      try {
        final rt = await tokens.readRefreshToken();
        if (rt == null) return false;
        final r = await dio.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': rt});
        final data = r.data!['data'] as Map<String, dynamic>;
        await tokens.save(access: data['accessToken'] as String, refresh: data['refreshToken'] as String);
        return true;
      } catch (_) {
        await tokens.clear();
        return false;
      } finally {
        _refreshing = null;
      }
    }();
  }

  Future<({T data, Map<String, dynamic>? meta})> get<T>(String path, {Map<String, dynamic>? query}) async {
    try {
      final r = await dio.get<Map<String, dynamic>>(path, queryParameters: query?..removeWhere((_, v) => v == null || v == ''));
      return (data: r.data!['data'] as T, meta: r.data!['meta'] as Map<String, dynamic>?);
    } catch (e) {
      throw ApiException.from(e);
    }
  }

  Future<T> send<T>(String method, String path, {Object? body, WriteOptions options = const WriteOptions()}) async {
    try {
      final r = await dio.request<Map<String, dynamic>>(path, data: body, options: Options(method: method, headers: options.headers()));
      return r.data!['data'] as T;
    } catch (e) {
      throw ApiException.from(e);
    }
  }
}
