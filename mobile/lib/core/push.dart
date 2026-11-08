import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../data/repositories.dart';

/// FCM push (CLAUDE.md §12). Optional: without a Firebase config (`flutterfire configure` →
/// google-services.json / GoogleService-Info.plist) initialisation fails and push is skipped, exactly like the
/// backend skips FCM without a service account. Commits still reach the app over Socket.IO while it is open.
class Push {
  Push._();
  static bool _ready = false;
  static StreamSubscription<String>? _refresh;

  static Future<void> init() async {
    try {
      await Firebase.initializeApp();
      _ready = true;
    } catch (e) {
      debugPrint('Push disabled: Firebase is not configured ($e)');
    }
  }

  /// After sign-in: ask permission and register this device's token (POST /devices).
  static Future<void> register(NotificationRepository repo) async {
    if (!_ready) return;
    try {
      final fm = FirebaseMessaging.instance;
      await fm.requestPermission();
      // The backend sends with firebase-admin registration tokens, so we keep the token API (the newer
      // register()/onRegistered flow yields an installation ID for direct-send, which the backend does not use).
      // ignore: deprecated_member_use
      final token = await fm.getToken();
      final platform = Platform.isIOS ? 'ios' : 'android';
      if (token != null) await repo.registerDevice(token, platform);
      await _refresh?.cancel();
      // ignore: deprecated_member_use
      _refresh = fm.onTokenRefresh.listen((t) => repo.registerDevice(t, platform).catchError((_) {}));
    } catch (e) {
      debugPrint('Push registration skipped: $e');
    }
  }

  static Future<void> unregister() async {
    await _refresh?.cancel();
    _refresh = null;
    if (!_ready) return;
    try {
      // ignore: deprecated_member_use
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
  }
}
