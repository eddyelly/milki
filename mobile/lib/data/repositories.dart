import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';

import '../core/api/api_client.dart';
import '../core/api/token_store.dart';
import 'models.dart';

typedef Json = Map<String, dynamic>;

/// Sign-in, registration, session restore and T3 re-authentication.
class AuthRepository {
  AuthRepository(this.api, this.tokens);
  final ApiClient api;
  final TokenStore tokens;

  static const deviceIdKey = 'milki.device_id';
  static const deviceSecretKey = 'milki.reauth_device_secret';

  Future<OtpChallenge> login(String identifier, String password) async =>
      OtpChallenge.fromJson(await api.send<Json>('POST', '/auth/login', body: {'identifier': identifier, 'password': password}));

  Future<OtpChallenge> register({required String fullName, required String phone, required String nida, required String password, String? email, String language = 'en'}) async {
    final r = await api.send<Json>('POST', '/auth/register', body: {
      'fullName': fullName,
      'phone': phone,
      'nida': nida,
      'password': password,
      if (email != null && email.isNotEmpty) 'email': email,
      'preferredLanguage': language,
    });
    return OtpChallenge.fromJson(r['challenge'] as Json);
  }

  Future<OtpChallenge> resend(String challengeId) async => OtpChallenge.fromJson(await api.send<Json>('POST', '/auth/otp/resend', body: {'challengeId': challengeId}));

  /// Completes sign-in/registration and stores the session.
  Future<User> verifyOtp(String challengeId, String code) async {
    final r = await api.send<Json>('POST', '/auth/otp/verify', body: {'challengeId': challengeId, 'code': code});
    await tokens.save(access: r['accessToken'] as String, refresh: r['refreshToken'] as String);
    return User.fromJson(r['user'] as Json);
  }

  /// Restores the session on app start from the refresh token in the Keystore/Keychain.
  Future<User?> restore() async {
    if (await tokens.readRefreshToken() == null) return null;
    if (!await api.refresh()) return null;
    try {
      return User.fromJson((await api.get<Json>('/auth/me')).data);
    } on ApiException {
      return null;
    }
  }

  Future<void> logout() async {
    final rt = await tokens.readRefreshToken();
    final deviceId = await tokens.read(deviceIdKey);
    try {
      if (deviceId != null && await tokens.read(deviceSecretKey) != null) await api.send<Json>('DELETE', '/auth/reauth/device/$deviceId');
      await api.send<Json>('POST', '/auth/logout', body: {'refreshToken': ?rt});
    } catch (_) {
      // Signing out must always succeed locally.
    }
    await tokens.delete(deviceSecretKey);
    await tokens.clear();
  }

  Future<String> deviceId() async {
    final existing = await tokens.read(deviceIdKey);
    if (existing != null) return existing;
    final id = newUuid();
    await tokens.write(deviceIdKey, id);
    return id;
  }

  Future<bool> hasDeviceCredential() async => await tokens.read(deviceSecretKey) != null;

  /// Links this phone for fingerprint/face confirmation (password proves it's you once).
  Future<void> enrollDevice(String password, {String deviceName = 'Milki mobile'}) async {
    final r = await api.send<Json>('POST', '/auth/reauth/device', body: {'deviceId': await deviceId(), 'deviceName': deviceName, 'password': password});
    await tokens.write(deviceSecretKey, r['deviceSecret'] as String);
  }

  Future<void> disableDevice() async {
    try {
      await api.send<Json>('DELETE', '/auth/reauth/device/${await deviceId()}');
    } catch (_) {}
    await tokens.delete(deviceSecretKey);
  }

  Future<String> reauthWithPassword(String password) async => (await api.send<Json>('POST', '/auth/reauth', body: {'password': password}))['reauthToken'] as String;

  /// Called only after local_auth succeeded (the secret is never sent without the biometric/PIN check).
  Future<String> reauthWithDevice() async {
    final secret = await tokens.read(deviceSecretKey);
    if (secret == null) throw ApiException(401, 'DEVICE_NOT_TRUSTED', 'Fingerprint confirmation is not set up on this phone.');
    final r = await api.send<Json>('POST', '/auth/reauth', body: {'deviceId': await deviceId(), 'deviceSecret': secret});
    return r['reauthToken'] as String;
  }
}

class ParcelRepository {
  ParcelRepository(this.api);
  final ApiClient api;

  /// Cache list — citizens only ever get their own parcels.
  Future<List<ParcelSummary>> mine() async =>
      (await api.get<List<dynamic>>('/parcels', query: {'limit': 100, 'sort': '-updatedAt'})).data.whereType<Json>().map(ParcelSummary.fromJson).toList();

  /// Straight from the ledger (rule 3).
  Future<Parcel> get(String parcelId) async => Parcel.fromJson((await api.get<Json>('/parcels/$parcelId')).data);

  Future<List<HistoryEntry>> history(String parcelId) async =>
      (await api.get<List<dynamic>>('/parcels/$parcelId/history')).data.whereType<Json>().map(HistoryEntry.fromJson).toList();

  Future<List<DocumentRef>> documents(String parcelId) async =>
      (await api.get<List<dynamic>>('/parcels/$parcelId/documents')).data.whereType<Json>().map(DocumentRef.fromJson).toList();

  /// Public QR verification — no sign-in needed.
  Future<ParcelVerification> verify(String parcelId) async => ParcelVerification.fromJson((await api.get<Json>('/verify/parcels/$parcelId')).data);

  Future<DocumentVerification> verifyDocument(String documentId, String sha256) async =>
      DocumentVerification.fromJson((await api.get<Json>('/verify/documents/$documentId', query: {'sha256': sha256})).data);
}

class TransferRepository {
  TransferRepository(this.api);
  final ApiClient api;

  Future<List<TransferSummary>> mine({String role = 'any'}) async =>
      (await api.get<List<dynamic>>('/transfers', query: {'limit': 100, 'role': role, 'sort': '-updatedAt'})).data.whereType<Json>().map(TransferSummary.fromJson).toList();

  Future<Transfer> get(String transferId) async => Transfer.fromJson((await api.get<Json>('/transfers/$transferId')).data);

  Future<List<DocumentRef>> documents(String transferId) async =>
      (await api.get<List<dynamic>>('/transfers/$transferId/documents')).data.whereType<Json>().map(DocumentRef.fromJson).toList();

  /// Returns `{userId, displayName}` for the T3 review ("will move to Juma H.").
  Future<Party> lookupBuyer(String phone) async {
    final r = (await api.get<Json>('/users/lookup', query: {'phone': phone})).data;
    return Party(userId: r['userId'] as String, fullName: r['displayName'] as String?);
  }

  Future<Submitted> initiate({required String parcelId, required String buyerUserId, required num salePrice, required WriteOptions options}) async =>
      Submitted.fromJson(await api.send<Json>('POST', '/transfers', body: {'parcelId': parcelId, 'buyer': {'userId': buyerUserId}, 'salePrice': salePrice, 'currency': 'TZS'}, options: options));

  Future<Submitted> accept(String transferId, WriteOptions options) async => Submitted.fromJson(await api.send<Json>('POST', '/transfers/$transferId/accept', body: <String, dynamic>{}, options: options));

  Future<Submitted> cancel(String transferId, String reason, WriteOptions options) async =>
      Submitted.fromJson(await api.send<Json>('POST', '/transfers/$transferId/cancel', body: {'reason': reason}, options: options));

  /// Uploads to MinIO via the API; only the SHA-256 goes on-chain. We send our own hash so the API can detect
  /// corruption in transit.
  Future<Submitted> upload({
    required String targetType,
    required String targetId,
    required String documentType,
    required Uint8List bytes,
    required String filename,
    required String mimeType,
    required WriteOptions options,
  }) async {
    final form = FormData.fromMap({
      'targetType': targetType,
      'targetId': targetId,
      'documentType': documentType,
      'sha256': sha256.convert(bytes).toString(),
      'file': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(mimeType)),
    });
    return Submitted.fromJson(await api.send<Json>('POST', '/documents', body: form, options: options));
  }
}

class NotificationRepository {
  NotificationRepository(this.api);
  final ApiClient api;

  Future<({List<NotificationItem> items, int unread})> list() async {
    final r = await api.get<List<dynamic>>('/notifications', query: {'limit': 50});
    return (items: r.data.whereType<Json>().map(NotificationItem.fromJson).toList(), unread: (r.meta?['unread'] as num?)?.toInt() ?? 0);
  }

  Future<void> markRead(String id) => api.send<Json>('POST', '/notifications/$id/read');
  Future<void> markAllRead() => api.send<Json>('POST', '/notifications/read-all');
  Future<void> delete(String id, WriteOptions options) => api.send<Json>('DELETE', '/notifications/$id', options: options);
  Future<void> registerDevice(String token, String platform) => api.send<Json>('POST', '/devices', body: {'token': token, 'platform': platform});
}

class LedgerRepository {
  LedgerRepository(this.api);
  final ApiClient api;

  Future<LedgerTxStatus> status(String txId) async => LedgerTxStatus.fromJson((await api.get<Json>('/ledger/tx/$txId')).data);
}
