import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../core/api/api_client.dart';
import '../../core/support_chat.dart';
import '../../core/theme/milki_theme.dart';
import '../../data/support_models.dart';
import '../../data/support_repository.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';
import '../widgets/confirm_action.dart';
import '../widgets/file_pick.dart';

// ----------------------------------------------------------------------------------------- labels
String ticketStatusLabel(AppLocalizations l, String s) => switch (s) {
      'OPEN' => l.ticketOpen,
      'IN_PROGRESS' => l.ticketInProgress,
      'AWAITING_USER' => l.ticketAwaitingYou,
      'RESOLVED' => l.ticketResolved,
      _ => l.ticketClosed,
    };

String categoryLabel(AppLocalizations l, String c) => switch (c) {
      'GETTING_STARTED' => l.catGettingStarted,
      'TRANSFERS' => l.catTransfers,
      'DOCUMENTS' => l.catDocuments,
      'MORTGAGES' => l.catMortgages,
      'ACCOUNT' => l.catAccount,
      _ => l.catOther,
    };

const ticketCategories = ['GETTING_STARTED', 'TRANSFERS', 'DOCUMENTS', 'MORTGAGES', 'ACCOUNT', 'OTHER'];

/// Ticket status: colour + icon + label (never colour alone, CLAUDE.md §9.1).
class TicketStatusChip extends StatelessWidget {
  const TicketStatusChip(this.status, {super.key, this.small = false});
  final String status;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final m = context.milki;
    final (IconData icon, Color color, Color ink) = switch (status) {
      'OPEN' => (Icons.radio_button_checked, m.gold, m.goldInk),
      'IN_PROGRESS' => (Icons.schedule, m.info, m.info),
      'AWAITING_USER' => (Icons.reply, m.earth, m.earth),
      'RESOLVED' => (Icons.check_circle_outline, m.success, m.success),
      _ => (Icons.lock_outline, m.muted, m.muted),
    };
    return Container(
      padding: EdgeInsets.symmetric(horizontal: small ? 8 : 10, vertical: small ? 3 : 5),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(999), border: Border.all(color: color.withValues(alpha: .3))),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: small ? 13 : 15, color: ink),
        const SizedBox(width: 4),
        Text(ticketStatusLabel(context.l10n, status), style: TextStyle(fontSize: small ? 11 : 12, fontWeight: FontWeight.w600, color: ink)),
      ]),
    );
  }
}

// --------------------------------------------------------------------------------------- my tickets
class MyTicketsScreen extends ConsumerWidget {
  const MyTicketsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final tickets = ref.watch(myTicketsProvider);
    final lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(title: Text(l.myTickets)),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('new-ticket'),
        onPressed: () => context.go('/help/tickets/new'),
        icon: const Icon(Icons.add_comment_outlined),
        label: Text(l.newTicket),
      ),
      body: tickets.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(myTicketsProvider)),
        data: (list) => RefreshIndicator(
          onRefresh: () => ref.refresh(myTicketsProvider.future),
          child: list.isEmpty
              ? ListView(children: [SizedBox(height: 420, child: EmptyState(icon: Icons.support_agent, title: l.noTickets, body: l.noTicketsBody))])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final t = list[i];
                    return Pressable(
                      onTap: () => context.go('/help/tickets/${t.id}'),
                      child: Card(
                        key: Key('ticket-${t.number}'),
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Text(t.number, style: monoStyle(size: 12, color: context.colors.onSurfaceVariant)),
                              const Spacer(),
                              TicketStatusChip(t.status, small: true),
                            ]),
                            const SizedBox(height: 6),
                            Text(t.subject, style: context.text.titleSmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                            const SizedBox(height: 4),
                            Text(
                              '${categoryLabel(l, t.category)}${t.lastMessageAt != null ? ' · ${timeago.format(t.lastMessageAt!, locale: lang)}' : ''}',
                              style: context.text.bodySmall,
                            ),
                          ]),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

// --------------------------------------------------------------------------------------- new ticket
class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key, this.parcelId, this.transferId});
  final String? parcelId;
  final String? transferId;

  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  final _form = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _description = TextEditingController();
  late String _category = widget.transferId != null ? 'TRANSFERS' : widget.parcelId != null ? 'DOCUMENTS' : 'GETTING_STARTED';
  String _priority = 'NORMAL';
  PickedAttachment? _file;
  String? _fileError;

  @override
  void dispose() {
    _subject.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _attach(Future<PickedAttachment?> Function() pick) async {
    final f = await pick();
    if (f == null) return;
    setState(() {
      _fileError = f.bytes.length > maxAttachmentBytes ? context.l10n.fileTooLarge : null;
      _file = _fileError == null ? f : null;
    });
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final l = context.l10n;
    final t = await showConfirmAction<Ticket>(
      context,
      tier: ConfirmTier.t1,
      title: l.sendTicket,
      impact: [
        (l.category, categoryLabel(l, _category)),
        (l.priority, _priorityLabel(l, _priority)),
        if (widget.parcelId != null) (l.parcel, widget.parcelId!),
        if (widget.transferId != null) (l.transfer, widget.transferId!),
        if (_file != null) (l.file, _file!.name.length > 24 ? '${_file!.name.substring(0, 21)}…' : _file!.name),
      ],
      consequences: [l.ticketPromise],
      confirmLabel: l.send,
      onConfirm: (ctx) => ref.read(supportRepositoryProvider).create(
            category: _category,
            priority: _priority,
            subject: _subject.text.trim(),
            description: _description.text.trim(),
            parcelId: widget.parcelId,
            transferId: widget.transferId,
            file: _file,
            options: ctx.options,
          ),
    );
    if (t == null || !mounted) return;
    ref.invalidate(myTicketsProvider);
    context.go('/help/tickets/${t.id}');
  }

  String _priorityLabel(AppLocalizations l, String p) => switch (p) { 'URGENT' => l.priorityUrgent, 'HIGH' => l.priorityHigh, _ => l.priorityNormal };

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final context0 = widget.parcelId ?? widget.transferId;
    return Scaffold(
      appBar: AppBar(title: Text(l.newTicket)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (context0 != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Container(
                key: const Key('ticket-context'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: context.milki.gold.withValues(alpha: .12), borderRadius: BorderRadius.circular(10), border: Border.all(color: context.milki.gold.withValues(alpha: .4))),
                child: Row(children: [
                  Icon(Icons.link, color: context.milki.goldInk),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l.aboutThis, style: context.text.bodySmall),
                      Text(context0, style: monoStyle(size: 14, weight: FontWeight.w600, color: context.colors.onSurface)),
                    ]),
                  ),
                ]),
              ),
            ),
          DropdownButtonFormField<String>(
            key: const Key('ticket-category'),
            initialValue: _category,
            decoration: InputDecoration(labelText: l.category),
            items: [for (final c in ticketCategories) DropdownMenuItem(value: c, child: Text(categoryLabel(l, c)))],
            onChanged: (v) => setState(() => _category = v ?? _category),
          ),
          const SizedBox(height: 12),
          Text(l.priority, style: context.text.labelLarge),
          const SizedBox(height: 6),
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: 'NORMAL', label: Text(l.priorityNormal)),
              ButtonSegment(value: 'HIGH', label: Text(l.priorityHigh)),
              ButtonSegment(value: 'URGENT', label: Text(l.priorityUrgent)),
            ],
            selected: {_priority},
            onSelectionChanged: (s) => setState(() => _priority = s.first),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('ticket-subject'),
            controller: _subject,
            maxLength: 140,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l.subject),
            validator: (v) => (v ?? '').trim().length < 4 ? l.subjectTooShort : null,
          ),
          const SizedBox(height: 4),
          TextFormField(
            key: const Key('ticket-description'),
            controller: _description,
            minLines: 4,
            maxLines: 8,
            maxLength: 5000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l.describeProblem, hintText: l.describeProblemHint, alignLabelWithHint: true),
            validator: (v) => (v ?? '').trim().length < 10 ? l.descriptionTooShort : null,
          ),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => _attach(pickDocument), icon: const Icon(Icons.attach_file), label: Text(l.chooseFile))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(onPressed: () => _attach(takePhoto), icon: const Icon(Icons.photo_camera_outlined), label: Text(l.takePhoto))),
          ]),
          if (_file != null)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.description_outlined),
              title: Text(_file!.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              trailing: IconButton(tooltip: l.remove, icon: const Icon(Icons.close), onPressed: () => setState(() => _file = null)),
            ),
          if (_fileError != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_fileError!, style: TextStyle(color: context.milki.danger))),
          const SizedBox(height: 24),
          FilledButton.icon(key: const Key('ticket-submit'), onPressed: _submit, icon: const Icon(Icons.send), label: Text(l.sendTicket)),
        ]),
      ),
    );
  }
}

// --------------------------------------------------------------------------------------- live chat
class TicketChatScreen extends ConsumerStatefulWidget {
  const TicketChatScreen({super.key, required this.ticketId});
  final String ticketId;

  @override
  ConsumerState<TicketChatScreen> createState() => _TicketChatScreenState();
}

class _TicketChatScreenState extends ConsumerState<TicketChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<TicketMessage>? _messages;
  Ticket? _ticket;
  Object? _error;
  final _typing = <String>{};
  final _typingTimers = <String, Timer>{};
  int? _agentsOnline;
  StreamSubscription<ChatEvent>? _events;
  StreamSubscription<int>? _presence;
  Timer? _readDebounce;
  PickedAttachment? _file;
  bool _sending = false;
  DateTime _lastTyping = DateTime.fromMillisecondsSinceEpoch(0);
  // Messages that arrive live animate in; history doesn't (CLAUDE.md §10: don't animate what people re-read).
  final _live = <String>{};
  // Stable per message: a retried send never posts twice.
  String _sendKey = newUuid();

  SupportRepository get _repo => ref.read(supportRepositoryProvider);
  // Captured once: `ref` must not be used in dispose().
  late final SupportChat _chat;
  String? get _me => currentUserOf(ref.read(sessionProvider))?.userId;

  @override
  void initState() {
    super.initState();
    _chat = ref.read(supportChatProvider);
    _agentsOnline = _chat.lastPresence;
    _events = _chat.events.where((e) => e.ticketId == widget.ticketId).listen(_onEvent);
    _presence = _chat.presence.listen((n) => setState(() => _agentsOnline = n));
    unawaited(_chat.join(widget.ticketId));
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([_repo.ticket(widget.ticketId), _repo.messages(widget.ticketId)]);
      if (!mounted) return;
      setState(() {
        _ticket = results[0] as Ticket;
        _messages = results[1] as List<TicketMessage>;
        _error = null;
      });
      _scrollToEnd(jump: true);
      _markRead();
      if (_agentsOnline == null) {
        final n = await _repo.agentsOnline();
        if (mounted) setState(() => _agentsOnline ??= n);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _onEvent(ChatEvent e) {
    if (!mounted) return;
    setState(() {
      switch (e) {
        case MessageEvent(:final message):
          final list = _messages ?? <TicketMessage>[];
          final i = list.indexWhere((m) => m.id == message.id);
          if (i == -1) {
            _live.add(message.id);
            _messages = [...list, message];
          } else {
            _messages = [...list]..[i] = message;
          }
          _typing.remove(message.authorId);
        case MessageDeletedEvent(:final messageId):
          _messages = _messages?.map((m) => m.id == messageId ? m.copyWith(body: '', deleted: true) : m).toList();
        case TicketUpdatedEvent(:final ticket):
          // Socket payloads carry IDs, not names: keep the known assignee name.
          final old = _ticket;
          _ticket = ticket.assignee == null && old?.assignee != null ? ticket.withAssignee(old!.assignee) : ticket;
        case TypingEvent(:final userId, :final typing):
          if (userId == _me) break;
          _typingTimers.remove(userId)?.cancel();
          if (typing) {
            _typing.add(userId);
            _typingTimers[userId] = Timer(const Duration(seconds: 6), () => mounted ? setState(() => _typing.remove(userId)) : null);
          } else {
            _typing.remove(userId);
          }
        case ReadEvent(:final userId):
          _messages = _messages?.map((m) => m.authorId != userId && !m.readBy.contains(userId) ? m.copyWith(readBy: {...m.readBy, userId}) : m).toList();
      }
    });
    if (e is MessageEvent && e.message.authorId != _me) _markRead();
    if (e is MessageEvent || e is TypingEvent) _scrollToEnd();
  }

  /// Read receipts (UI state, no confirmation), debounced.
  void _markRead() {
    final me = _me;
    if (me == null || !(_messages ?? const []).any((m) => m.authorId != me && !m.readBy.contains(me))) return;
    _readDebounce?.cancel();
    _readDebounce = Timer(const Duration(milliseconds: 500), () => _repo.markRead(widget.ticketId).catchError((_) {}));
  }

  void _scrollToEnd({bool jump = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      final max = _scroll.position.maxScrollExtent;
      if (jump || reduceMotion(context)) {
        _scroll.jumpTo(max);
      } else {
        _scroll.animateTo(max, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  void _onTyping(String v) {
    final now = DateTime.now();
    if (v.isEmpty) {
      _chat.typing(widget.ticketId, false);
      _lastTyping = DateTime.fromMillisecondsSinceEpoch(0);
    } else if (now.difference(_lastTyping) > const Duration(seconds: 2)) {
      _chat.typing(widget.ticketId, true);
      _lastTyping = now;
    }
  }

  /// Sending a chat message is itself the explicit action (Send button); edits/deletes within 5 minutes are the
  /// undo. Documented as the chat exception to the confirmation rule in CLAUDE.md §11.
  Future<void> _send() async {
    final text = _input.text.trim();
    if ((text.isEmpty && _file == null) || _sending) return;
    setState(() => _sending = true);
    try {
      final m = await _repo.send(widget.ticketId, text, file: _file, options: WriteOptions(idempotencyKey: _sendKey));
      _sendKey = newUuid();
      _chat.typing(widget.ticketId, false);
      _onEvent(MessageEvent(m));
      _input.clear();
      setState(() => _file = null);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiException.from(e).message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _attach() async {
    final l = context.l10n;
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.attach_file), title: Text(l.chooseFile), onTap: () => Navigator.pop(c, 'file')),
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(l.takePhoto), onTap: () => Navigator.pop(c, 'photo')),
        ]),
      ),
    );
    if (choice == null) return;
    final f = choice == 'file' ? await pickDocument() : await takePhoto();
    if (f == null || !mounted) return;
    if (f.bytes.length > maxAttachmentBytes) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.fileTooLarge)));
      return;
    }
    setState(() => _file = f);
  }

  Future<void> _messageActions(TicketMessage m) async {
    final l = context.l10n;
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(key: const Key('msg-edit'), leading: const Icon(Icons.edit_outlined), title: Text(l.editMessage), onTap: () => Navigator.pop(c, 'edit')),
          ListTile(key: const Key('msg-delete'), leading: Icon(Icons.delete_outline, color: context.milki.danger), title: Text(l.deleteMessage), onTap: () => Navigator.pop(c, 'delete')),
        ]),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'delete') {
      final ok = await showConfirmAction<bool>(
        context,
        tier: ConfirmTier.t1,
        title: l.deleteMessageQ,
        consequences: [l.deleteMessageBody],
        confirmLabel: l.delete,
        onConfirm: (ctx) async {
          await _repo.deleteMessage(widget.ticketId, m.id, ctx.options);
          return true;
        },
      );
      if (ok == true) _onEvent(MessageDeletedEvent(widget.ticketId, m.id));
    } else {
      final ctrl = TextEditingController(text: m.body);
      final updated = await showConfirmAction<TicketMessage>(
        context,
        tier: ConfirmTier.t1,
        title: l.editMessage,
        listen: ctrl,
        canConfirm: () => ctrl.text.trim().isNotEmpty && ctrl.text.trim() != m.body,
        extra: TextField(key: const Key('edit-field'), controller: ctrl, minLines: 2, maxLines: 6),
        confirmLabel: l.save,
        onConfirm: (ctx) => _repo.edit(widget.ticketId, m.id, ctrl.text.trim(), ctx.options),
      );
      // Not disposed here: the sheet's exit animation still renders the field; it is collected with the sheet.
      if (updated != null) _onEvent(MessageEvent(updated));
    }
  }

  Future<void> _close(Ticket t) async {
    final l = context.l10n;
    final r = await showConfirmAction<Ticket>(
      context,
      tier: ConfirmTier.t2,
      title: l.closeTicketQ,
      consequences: [l.closeTicketBody],
      typeToConfirm: t.number,
      confirmLabel: l.closeTicket,
      onConfirm: (ctx) => _repo.close(t.id, ctx.options),
    );
    if (r != null) _onEvent(TicketUpdatedEvent(r));
  }

  Future<void> _reopen(Ticket t) async {
    final l = context.l10n;
    final r = await showConfirmAction<Ticket>(
      context,
      tier: ConfirmTier.t1,
      title: l.reopenTicketQ,
      consequences: [l.reopenTicketBody],
      confirmLabel: l.reopen,
      onConfirm: (ctx) => _repo.reopen(t.id, ctx.options),
    );
    if (r != null) _onEvent(TicketUpdatedEvent(r));
  }

  Future<void> _rate(Ticket t, int stars) async {
    final l = context.l10n;
    final comment = TextEditingController();
    final r = await showConfirmAction<Ticket>(
      context,
      tier: ConfirmTier.t1,
      title: l.rateTicket,
      impact: [(l.yourRating, '★' * stars + '☆' * (5 - stars))],
      extra: TextField(key: const Key('rating-comment'), controller: comment, maxLength: 1000, decoration: InputDecoration(labelText: l.commentOptional)),
      confirmLabel: l.send,
      onConfirm: (ctx) => _repo.rate(t.id, stars, comment.text, ctx.options),
    );
    // Not disposed here: the sheet's exit animation still renders the field; it is collected with the sheet.
    if (r != null) _onEvent(TicketUpdatedEvent(r));
  }

  @override
  void dispose() {
    _chat.leave(widget.ticketId);
    _events?.cancel();
    _presence?.cancel();
    _readDebounce?.cancel();
    for (final t in _typingTimers.values) {
      t.cancel();
    }
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = _ticket;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: t == null
            ? null
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.titleMedium),
                Text(t.number, style: monoStyle(size: 11, color: context.colors.onSurfaceVariant)),
              ]),
        actions: [
          if (t != null && !t.isClosed)
            PopupMenuButton<String>(
              key: const Key('ticket-menu'),
              onSelected: (_) => _close(t),
              itemBuilder: (_) => [PopupMenuItem(value: 'close', child: Text(l.closeTicket))],
            ),
        ],
      ),
      body: _error != null
          ? ErrorState(error: _error!, onRetry: _load)
          : t == null || _messages == null
              ? const SkeletonList(count: 4, height: 70)
              : Column(children: [
                  _StatusBar(ticket: t, agentsOnline: _agentsOnline),
                  Expanded(
                    child: ListView(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                      children: [
                        _Bubble(
                          mine: true,
                          author: null,
                          body: t.description,
                          attachments: t.attachments,
                          at: t.createdAt,
                          seen: false,
                          animate: false,
                        ),
                        for (final m in _messages!)
                          GestureDetector(
                            onLongPress: m.authorId == _me && !m.deleted && m.createdAt != null && DateTime.now().difference(m.createdAt!) < const Duration(minutes: 5) ? () => _messageActions(m) : null,
                            child: _Bubble(
                              key: Key('msg-${m.id}'),
                              mine: m.authorId == _me,
                              author: m.authorId == _me ? null : (m.author ?? l.supportTeam),
                              body: m.deleted ? null : m.body,
                              attachments: m.attachments,
                              at: m.createdAt,
                              edited: m.editedAt != null && !m.deleted,
                              seen: m.authorId == _me && m.readBy.any((u) => u != _me),
                              animate: _live.contains(m.id),
                            ),
                          ),
                        if (_typing.isNotEmpty) const _TypingDots(),
                      ],
                    ),
                  ),
                  if (t.resolved) _ResolvedPanel(ticket: t, onRate: (s) => _rate(t, s), onReopen: () => _reopen(t)),
                  if (!t.isClosed) _composer(context),
                ]),
    );
  }

  Widget _composer(BuildContext context) {
    final l = context.l10n;
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
        decoration: BoxDecoration(color: context.colors.surfaceContainerLowest, border: Border(top: BorderSide(color: context.milki.border))),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_file != null)
            Align(
              alignment: Alignment.centerLeft,
              child: InputChip(avatar: const Icon(Icons.description_outlined, size: 18), label: Text(_file!.name, overflow: TextOverflow.ellipsis), onDeleted: () => setState(() => _file = null)),
            ),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            IconButton(tooltip: l.attachFile, icon: const Icon(Icons.attach_file), onPressed: _attach),
            Expanded(
              child: TextField(
                key: const Key('chat-input'),
                controller: _input,
                minLines: 1,
                maxLines: 5,
                textCapitalization: TextCapitalization.sentences,
                onChanged: _onTyping,
                decoration: InputDecoration(hintText: l.typeMessage, contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
              ),
            ),
            const SizedBox(width: 6),
            IconButton.filled(key: const Key('chat-send'), tooltip: l.send, onPressed: _sending ? null : _send, icon: const Icon(Icons.send)),
          ]),
        ]),
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({required this.ticket, required this.agentsOnline});
  final Ticket ticket;
  final int? agentsOnline;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final online = (agentsOnline ?? 0) > 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: BoxDecoration(color: context.colors.surfaceContainerLowest, border: Border(bottom: BorderSide(color: context.milki.border))),
      child: Row(children: [
        TicketStatusChip(ticket.status, small: true),
        const SizedBox(width: 10),
        Expanded(
          child: Row(children: [
            Container(
              key: const Key('presence-dot'),
              width: 9,
              height: 9,
              decoration: BoxDecoration(shape: BoxShape.circle, color: online ? context.milki.success : context.milki.muted.withValues(alpha: .5)),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                agentsOnline == null ? '…' : online ? (ticket.assignee != null ? l.agentHelping(ticket.assignee!) : l.agentsOnlineNow) : l.agentsOffline,
                style: context.text.bodySmall,
                maxLines: 2,
              ),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// Message bubble; live ones spring in (CLAUDE.md §10.9).
class _Bubble extends StatelessWidget {
  const _Bubble({super.key, required this.mine, required this.author, required this.body, required this.attachments, required this.at, required this.seen, required this.animate, this.edited = false});
  final bool mine;
  final String? author;
  final String? body;
  final List<Attachment> attachments;
  final DateTime? at;
  final bool seen;
  final bool edited;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final primary = context.colors.primary;
    final fg = mine ? context.colors.onPrimary : context.colors.onSurface;
    Widget bubble = Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .8),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
          decoration: BoxDecoration(
            color: mine ? primary : context.colors.surfaceContainerLowest,
            border: mine ? null : Border.all(color: context.milki.border),
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(14),
              topRight: const Radius.circular(14),
              bottomLeft: Radius.circular(mine ? 14 : 4),
              bottomRight: Radius.circular(mine ? 4 : 14),
            ),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (author != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.support_agent, size: 14, color: primary),
                  const SizedBox(width: 4),
                  Text(author!, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: primary)),
                ]),
              ),
            if (body == null)
              Text(l.messageDeleted, style: TextStyle(color: fg.withValues(alpha: .7), fontStyle: FontStyle.italic))
            else if (body!.isNotEmpty)
              Text(body!, style: context.text.bodyMedium?.copyWith(color: fg)),
            for (final a in attachments)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.description_outlined, size: 16, color: fg),
                  const SizedBox(width: 4),
                  Flexible(child: Text(a.name, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: fg, decoration: TextDecoration.underline))),
                ]),
              ),
            const SizedBox(height: 2),
            Row(mainAxisSize: MainAxisSize.min, children: [
              if (edited) Text('${l.edited} · ', style: TextStyle(fontSize: 10.5, color: fg.withValues(alpha: .7))),
              if (at != null) Text(TimeOfDay.fromDateTime(at!).format(context), style: TextStyle(fontSize: 10.5, color: fg.withValues(alpha: .7))),
              if (mine && seen) ...[const SizedBox(width: 4), Icon(Icons.done_all, size: 14, color: fg.withValues(alpha: .85), semanticLabel: l.seen)],
            ]),
          ]),
        ),
      ),
    );
    if (!animate || reduceMotion(context)) return bubble;
    return bubble
        .animate()
        .fadeIn(duration: 150.ms)
        .scale(begin: const Offset(.85, .85), end: const Offset(1, 1), alignment: mine ? Alignment.bottomRight : Alignment.bottomLeft, duration: 380.ms, curve: Curves.elasticOut)
        .slideY(begin: .25, end: 0, duration: 260.ms, curve: Curves.easeOut);
  }
}

/// Three bouncing dots (CLAUDE.md §10.9).
class _TypingDots extends StatelessWidget {
  const _TypingDots();

  @override
  Widget build(BuildContext context) {
    final reduce = reduceMotion(context);
    final dot = Container(width: 7, height: 7, decoration: BoxDecoration(color: context.colors.onSurfaceVariant, shape: BoxShape.circle));
    return Semantics(
      label: context.l10n.agentTyping,
      child: Align(
        key: const Key('typing-dots'),
        alignment: Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(color: context.colors.surfaceContainerLowest, border: Border.all(color: context.milki.border), borderRadius: BorderRadius.circular(14)),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            for (var i = 0; i < 3; i++)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: reduce
                    ? dot
                    : dot
                        .animate(onPlay: (c) => c.repeat())
                        .moveY(begin: 0, end: -5, delay: (i * 150).ms, duration: 300.ms, curve: Curves.easeOut)
                        .then()
                        .moveY(begin: -5, end: 0, duration: 300.ms, curve: Curves.easeIn)
                        .then(delay: ((2 - i) * 150).ms),
              ),
          ]),
        ),
      ),
    );
  }
}

class _ResolvedPanel extends StatelessWidget {
  const _ResolvedPanel({required this.ticket, required this.onRate, required this.onReopen});
  final Ticket ticket;
  final ValueChanged<int> onRate;
  final VoidCallback onReopen;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final t = ticket;
    return Container(
      key: const Key('resolved-panel'),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      decoration: BoxDecoration(color: context.milki.success.withValues(alpha: .08), border: Border(top: BorderSide(color: context.milki.border))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(t.rating == null ? l.howDidWeDo : l.thanksForRating, style: context.text.titleSmall),
        const SizedBox(height: 6),
        Row(children: [
          for (var i = 1; i <= 5; i++)
            IconButton(
              key: Key('star-$i'),
              tooltip: '$i',
              visualDensity: VisualDensity.compact,
              onPressed: t.rating == null ? () => onRate(i) : null,
              icon: Icon((t.rating?.stars ?? 0) >= i ? Icons.star_rounded : Icons.star_outline_rounded, color: context.milki.gold, size: 30),
            ),
          const Spacer(),
          if (t.canReopen(DateTime.now())) TextButton(key: const Key('reopen'), onPressed: onReopen, child: Text(l.reopen)),
        ]),
        if (t.rating?.comment.isNotEmpty ?? false) Text('“${t.rating!.comment}”', style: context.text.bodySmall),
      ]),
    );
  }
}
