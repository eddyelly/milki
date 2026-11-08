import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the session lives. The access token is kept in memory; the rotating refresh token, the device ID and the
/// biometric re-auth secret are kept in the Keystore/Keychain (flutter_secure_storage).
abstract class TokenStore {
  String? get accessToken;
  Future<void> save({required String access, required String refresh});
  Future<String?> readRefreshToken();
  Future<void> clear();

  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _s;
  String? _access;

  static const _refreshKey = 'milki.refresh_token';

  @override
  String? get accessToken => _access;

  @override
  Future<void> save({required String access, required String refresh}) async {
    _access = access;
    await _s.write(key: _refreshKey, value: refresh);
  }

  @override
  Future<String?> readRefreshToken() => _s.read(key: _refreshKey);

  @override
  Future<void> clear() async {
    _access = null;
    await _s.delete(key: _refreshKey);
  }

  @override
  Future<String?> read(String key) => _s.read(key: key);

  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _s.delete(key: key);
}

/// For tests and previews.
class MemoryTokenStore implements TokenStore {
  String? _access;
  final Map<String, String> values = {};

  @override
  String? get accessToken => _access;

  @override
  Future<void> save({required String access, required String refresh}) async {
    _access = access;
    values['refresh'] = refresh;
  }

  @override
  Future<String?> readRefreshToken() async => values['refresh'];

  @override
  Future<void> clear() async {
    _access = null;
    values.remove('refresh');
  }

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}
