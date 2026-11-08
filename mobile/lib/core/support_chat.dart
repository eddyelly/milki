import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../data/support_models.dart';
import 'config.dart';

/// Live chat events on the `/support` namespace (CLAUDE.md §11).
sealed class ChatEvent {
  const ChatEvent(this.ticketId);
  final String ticketId;
}

class MessageEvent extends ChatEvent {
  MessageEvent(this.message) : super(message.ticketId);
  final TicketMessage message;
}

class MessageDeletedEvent extends ChatEvent {
  const MessageDeletedEvent(super.ticketId, this.messageId);
  final String messageId;
}

class TicketUpdatedEvent extends ChatEvent {
  TicketUpdatedEvent(this.ticket) : super(ticket.id);
  final Ticket ticket;
}

class TypingEvent extends ChatEvent {
  const TypingEvent(super.ticketId, this.userId, this.role, this.typing);
  final String userId;
  final String role;
  final bool typing;
}

class ReadEvent extends ChatEvent {
  const ReadEvent(super.ticketId, this.userId);
  final String userId;
}

abstract class SupportChat {
  Stream<ChatEvent> get events;

  /// Agents online now (push updates; null until the first one arrives).
  Stream<int> get presence;
  int? get lastPresence;

  void connect(String accessToken);
  void disconnect();
  Future<bool> join(String ticketId);
  void leave(String ticketId);
  void typing(String ticketId, bool typing);
}

class SocketSupportChat implements SupportChat {
  io.Socket? _socket;
  final _events = StreamController<ChatEvent>.broadcast();
  final _presence = StreamController<int>.broadcast();
  final _joined = <String>{};
  int? _last;

  @override
  Stream<ChatEvent> get events => _events.stream;
  @override
  Stream<int> get presence => _presence.stream;
  @override
  int? get lastPresence => _last;

  Map<String, dynamic> _map(Object? d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};

  @override
  void connect(String accessToken) {
    disconnect();
    final s = io.io('${AppConfig.socketUrl}/support', io.OptionBuilder().setTransports(['websocket']).setAuth({'token': accessToken}).disableAutoConnect().build());
    s.on('presence', (d) {
      _last = (_map(d)['agentsOnline'] as num?)?.toInt() ?? 0;
      _presence.add(_last!);
    });
    s.on('message:new', (d) => _events.add(MessageEvent(TicketMessage.fromJson(_map(d)))));
    s.on('message:updated', (d) => _events.add(MessageEvent(TicketMessage.fromJson(_map(d)))));
    s.on('message:deleted', (d) {
      final m = _map(d);
      _events.add(MessageDeletedEvent('${m['ticketId']}', '${m['id']}'));
    });
    s.on('ticket:updated', (d) => _events.add(TicketUpdatedEvent(Ticket.fromJson(_map(d)))));
    s.on('typing', (d) {
      final m = _map(d);
      _events.add(TypingEvent('${m['ticketId']}', '${m['userId']}', '${m['role']}', m['typing'] == true));
    });
    s.on('read', (d) {
      final m = _map(d);
      _events.add(ReadEvent('${m['ticketId']}', '${m['userId']}'));
    });
    // Rejoin rooms after a reconnect.
    s.onConnect((_) {
      for (final id in _joined) {
        s.emit('ticket:join', {'ticketId': id});
      }
    });
    s.connect();
    _socket = s;
  }

  @override
  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  @override
  Future<bool> join(String ticketId) {
    _joined.add(ticketId);
    final s = _socket;
    if (s == null) return Future.value(false);
    final done = Completer<bool>();
    s.emitWithAck('ticket:join', {'ticketId': ticketId}, ack: (r) {
      if (!done.isCompleted) done.complete(r is Map && r['ok'] == true);
    });
    return done.future.timeout(const Duration(seconds: 5), onTimeout: () => false);
  }

  @override
  void leave(String ticketId) {
    _joined.remove(ticketId);
    _socket?.emit('ticket:leave', {'ticketId': ticketId});
  }

  @override
  void typing(String ticketId, bool typing) => _socket?.emit('typing', {'ticketId': ticketId, 'typing': typing});
}
