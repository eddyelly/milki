import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';
import '../widgets/confirm_action.dart';

IconData notificationIcon(String type) => switch (type) {
      final t when t.contains('Transfer') => Icons.swap_horiz,
      final t when t.contains('Document') => Icons.description_outlined,
      final t when t.contains('Encumbrance') => Icons.account_balance_outlined,
      final t when t.contains('Dispute') => Icons.gavel,
      _ => Icons.landscape_outlined,
    };

/// Read receipts are UI state, not user data, so they need no confirmation (same rule as the web portal).
Future<void> openNotification(BuildContext context, WidgetRef ref, NotificationItem n) async {
  if (n.readAt == null) {
    ref.read(notificationRepositoryProvider).markRead(n.id).then((_) => ref.invalidate(notificationsProvider)).ignore();
  }
  if (n.transferId != null) {
    context.go('/transfers/${n.transferId}');
  } else if (n.parcelId != null) {
    context.go('/parcels/${n.parcelId}');
  }
}

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  Future<bool> _delete(BuildContext context, WidgetRef ref, NotificationItem n) async {
    final l = context.l10n;
    final ok = await showConfirmAction<bool>(
      context,
      tier: ConfirmTier.t1,
      title: l.deleteNotification,
      consequences: [l.deleteNotificationBody],
      impact: [(n.title, fmtDate(n.createdAt))],
      confirmLabel: l.delete,
      onConfirm: (ctx) async {
        await ref.read(notificationRepositoryProvider).delete(n.id, ctx.options);
        return true;
      },
    );
    if (ok == true) {
      ref.invalidate(notificationsProvider);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.deleted)));
    }
    return ok == true;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final notes = ref.watch(notificationsProvider);
    final lang = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.notificationsTitle),
        actions: [
          if ((notes.value?.unread ?? 0) > 0)
            TextButton(
              onPressed: () async {
                await ref.read(notificationRepositoryProvider).markAllRead();
                ref.invalidate(notificationsProvider);
              },
              child: Text(l.markAllRead),
            ),
        ],
      ),
      body: notes.when(
        loading: () => const SkeletonList(),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(notificationsProvider)),
        data: (n) => RefreshIndicator(
          onRefresh: () => ref.refresh(notificationsProvider.future),
          child: n.items.isEmpty
              ? ListView(children: [SizedBox(height: 420, child: EmptyState(icon: Icons.notifications_none, title: l.noNotifications))])
              : ListView.separated(
                  itemCount: n.items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final item = n.items[i];
                    final unread = item.readAt == null;
                    return Dismissible(
                      key: ValueKey(item.id),
                      direction: DismissDirection.endToStart,
                      confirmDismiss: (_) => _delete(context, ref, item),
                      background: Container(
                        color: context.milki.danger,
                        alignment: Alignment.centerRight,
                        padding: const EdgeInsets.only(right: 24),
                        child: const Icon(Icons.delete_outline, color: Colors.white),
                      ),
                      child: ListTile(
                        tileColor: unread ? context.colors.primary.withValues(alpha: .05) : null,
                        leading: Badge(
                          isLabelVisible: unread,
                          smallSize: 8,
                          backgroundColor: context.milki.gold,
                          child: CircleAvatar(backgroundColor: context.colors.primary.withValues(alpha: .1), child: Icon(notificationIcon(item.type), color: context.colors.primary, size: 20)),
                        ),
                        title: Text(item.title, style: context.text.titleSmall?.copyWith(fontWeight: unread ? FontWeight.w700 : FontWeight.w500)),
                        subtitle: Text(item.body),
                        trailing: item.createdAt == null ? null : Text(timeago.format(item.createdAt!, locale: lang), style: context.text.bodySmall),
                        onTap: () => openNotification(context, ref, item),
                        onLongPress: () => _delete(context, ref, item),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
