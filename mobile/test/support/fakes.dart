import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:milki_mobile/core/api/api_client.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/core/ledger_events.dart';
import 'package:milki_mobile/core/reauth.dart';
import 'package:milki_mobile/core/theme/milki_theme.dart';
import 'package:milki_mobile/data/models.dart';
import 'package:milki_mobile/l10n/app_localizations.dart';
import 'package:milki_mobile/state/providers.dart';

typedef Json = Map<String, dynamic>;

/// A recorded request.
class Call {
  Call(this.method, this.path, this.query, this.headers, this.data);
  final String method;
  final String path;
  final Map<String, dynamic> query;
  final Map<String, dynamic> headers;
  final Object? data;

  Json get json => data is Map ? Map<String, dynamic>.from(data! as Map) : (data is String ? jsonDecode(data! as String) as Json : <String, dynamic>{});
}

/// Reply with `{data, meta}` (2xx) or `{error}` (otherwise).
class Reply {
  const Reply(this.status, this.body);
  factory Reply.ok(Object? data, {Json? meta, int status = 200}) => Reply(status, {'data': data, 'meta': ?meta});
  factory Reply.error(int status, String code, String message) => Reply(status, {'error': {'code': code, 'message': message, 'details': null}});
  final int status;
  final Json body;
}

/// In-memory API: routes are matched on "METHOD /path" (path without /api/v1 base and query).
class FakeApi implements HttpClientAdapter {
  final calls = <Call>[];
  final routes = <String, FutureOr<Reply> Function(Call)>{};

  void on(String route, FutureOr<Reply> Function(Call) handler) => routes[route] = handler;

  Iterable<Call> called(String route) => calls.where((c) => '${c.method} ${c.path}' == route);

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final path = Uri.parse(o.path).path;
    final call = Call(o.method, path, o.queryParameters, Map.of(o.headers), o.data);
    calls.add(call);
    final handler = routes['${o.method} $path'];
    final reply = handler == null ? Reply.error(404, 'NOT_FOUND', 'No fake route for ${o.method} $path') : await handler(call);
    return ResponseBody.fromString(jsonEncode(reply.body), reply.status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

ApiClient fakeClient(FakeApi api, TokenStore tokens, {void Function()? onExpired}) =>
    ApiClient(tokens: tokens, dio: Dio(BaseOptions(baseUrl: 'http://test/api/v1'))..httpClientAdapter = api, onSessionExpired: onExpired);

class FakeReauth implements Reauthenticator {
  FakeReauth({this.biometric = false, this.token = 'reauth-token'});
  bool biometric;
  String token;
  final passwords = <String>[];
  int biometricPrompts = 0;

  @override
  Future<bool> biometricReady() async => biometric;

  @override
  Future<String?> withBiometrics(String reason) async {
    biometricPrompts++;
    return token;
  }

  @override
  Future<String> withPassword(String password) async {
    passwords.add(password);
    if (password == 'wrong') throw ApiException(401, 'INVALID_CREDENTIALS', 'That password is not correct.');
    return token;
  }
}

class FakeLedgerEvents implements LedgerEvents {
  FakeLedgerEvents({this.block = 42, this.fail = false});
  int block;
  bool fail;
  final waited = <String>[];
  final _changes = StreamController<void>.broadcast();

  @override
  Stream<void> get changes => _changes.stream;

  @override
  void connect(String accessToken) {}

  @override
  void disconnect() {}

  @override
  Future<LedgerTxStatus> waitForCommit(String txId, {Duration timeout = const Duration(seconds: 90)}) async {
    waited.add(txId);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    if (fail) throw LedgerCommitException(false);
    return LedgerTxStatus(txId: txId, status: 'COMMITTED', blockNumber: block);
  }
}

/// Fonts are bundled; never fetch in tests.
void setUpFonts() {
  GoogleFonts.config.allowRuntimeFetching = false;
}

/// Wraps [child] in the app's theme + localizations, with reduced motion (repeating animations off) by default.
Widget testApp(Widget child, {List<Override> overrides = const [], Locale locale = const Locale('en'), bool reduceMotion = true, ThemeData? theme}) {
  return ProviderScope(
    overrides: [settingsProvider.overrideWith(() => SettingsController()), ...overrides],
    child: MaterialApp(
      theme: theme ?? MilkiTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [AppLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: Builder(builder: (c) => MediaQuery(data: MediaQuery.of(c).copyWith(disableAnimations: reduceMotion), child: Scaffold(body: child))),
    ),
  );
}

Json userJson({String id = 'usr_1', String name = 'Asha Mwakyusa', String role = 'CITIZEN'}) =>
    {'userId': id, 'role': role, 'fullName': name, 'phone': '+255712000001', 'nidaMasked': 'NIDA••••0101', 'preferredLanguage': 'en'};

Json parcelJson({String id = 'DSM-KIN-12-45', String owner = 'usr_1', String status = 'ACTIVE', String? activeTransferId}) => {
      'parcelId': id,
      'titleNumber': 'CT-1001',
      'region': 'Dar es Salaam',
      'district': 'Kinondoni',
      'ward': 'Mikocheni',
      'blockNumber': '12',
      'plotNumber': '45',
      'area': 1200,
      'landUse': 'RESIDENTIAL',
      'location': {'latitude': -6.76, 'longitude': 39.25},
      'owner': {'userId': owner},
      'ownershipVersion': 1,
      'status': status,
      'activeTransferId': activeTransferId,
      'lastTxId': 'a' * 64,
      'createdAt': '2026-01-10T10:00:00Z',
    };

/// Waits for real async work (fake HTTP futures) inside a widget test.
Future<void> settle(WidgetTester tester, [int rounds = 6]) async {
  for (var i = 0; i < rounds; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pump(const Duration(milliseconds: 50));
  }
  await tester.pumpAndSettle();
}
