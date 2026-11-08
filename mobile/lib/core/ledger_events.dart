import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../data/models.dart';
import '../data/repositories.dart';
import 'config.dart';

/// Waits for ledger commits. Socket.IO `ledger:tx` is the fast path; polling GET /ledger/tx/:id is the fallback
/// (FCM pushes the same commit when the app is in the background).
abstract class LedgerEvents {
  Future<LedgerTxStatus> waitForCommit(String txId, {Duration timeout});

  /// Fires for any ledger change involving this user (refresh lists).
  Stream<void> get changes;

  void connect(String accessToken);
  void disconnect();
}

class LedgerCommitException implements Exception {
  LedgerCommitException(this.timedOut);
  final bool timedOut;
}

class SocketLedgerEvents implements LedgerEvents {
  SocketLedgerEvents(this.ledger);
  final LedgerRepository ledger;

  io.Socket? _socket;
  final _tx = StreamController<LedgerTxStatus>.broadcast();
  final _changes = StreamController<void>.broadcast();

  @override
  Stream<void> get changes => _changes.stream;

  @override
  void connect(String accessToken) {
    disconnect();
    final s = io.io(AppConfig.socketUrl, io.OptionBuilder().setTransports(['websocket']).setAuth({'token': accessToken}).disableAutoConnect().build());
    s.on('ledger:tx', (data) {
      if (data is Map) _tx.add(LedgerTxStatus.fromJson(Map<String, dynamic>.from(data)));
    });
    for (final e in ['ledger:event', 'notification']) {
      s.on(e, (_) => _changes.add(null));
    }
    s.connect();
    _socket = s;
  }

  @override
  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  @override
  Future<LedgerTxStatus> waitForCommit(String txId, {Duration timeout = const Duration(seconds: 90)}) {
    final done = Completer<LedgerTxStatus>();
    void finish(LedgerTxStatus s) {
      if (done.isCompleted || s.status == 'SUBMITTED') return;
      if (s.status == 'COMMITTED') {
        done.complete(s);
      } else {
        done.completeError(LedgerCommitException(false));
      }
    }

    final sub = _tx.stream.where((s) => s.txId == txId).listen(finish);
    final poll = Timer.periodic(const Duration(seconds: 2), (_) async {
      try {
        finish(await ledger.status(txId));
      } catch (_) {}
    });
    final timer = Timer(timeout, () {
      if (!done.isCompleted) done.completeError(LedgerCommitException(true));
    });
    return done.future.whenComplete(() {
      sub.cancel();
      poll.cancel();
      timer.cancel();
      _changes.add(null);
    });
  }
}
