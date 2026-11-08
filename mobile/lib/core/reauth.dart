import 'package:local_auth/local_auth.dart';

import '../data/repositories.dart';

/// T3 re-authentication on mobile (CLAUDE.md §8): biometrics via local_auth with the device PIN as fallback,
/// which unlocks this phone's device credential; the API exchanges it for a single-use re-auth token.
/// Password is the fallback when biometrics are unavailable or not set up.
abstract class Reauthenticator {
  /// Whether this phone can confirm with fingerprint/face/PIN *and* has a linked device credential.
  Future<bool> biometricReady();

  /// Prompts for biometrics (or device PIN). Returns a re-auth token, or null if the user cancelled.
  Future<String?> withBiometrics(String reason);

  Future<String> withPassword(String password);
}

class DeviceReauthenticator implements Reauthenticator {
  DeviceReauthenticator(this.auth, [LocalAuthentication? localAuth]) : _local = localAuth ?? LocalAuthentication();
  final AuthRepository auth;
  final LocalAuthentication _local;

  @override
  Future<bool> biometricReady() async {
    try {
      return await auth.hasDeviceCredential() && await _local.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  @override
  Future<String?> withBiometrics(String reason) async {
    // biometricOnly: false → the OS offers the device PIN/pattern when biometrics fail (the "PIN fallback").
    final ok = await _local.authenticate(localizedReason: reason, biometricOnly: false, sensitiveTransaction: true);
    if (!ok) return null;
    return auth.reauthWithDevice();
  }

  @override
  Future<String> withPassword(String password) => auth.reauthWithPassword(password);
}
