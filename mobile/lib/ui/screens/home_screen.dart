import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../core/theme/milki_theme.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';
import 'notifications_screen.dart';
import 'parcel_screens.dart';
import 'transfer_screens.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  String _greeting(BuildContext context) {
    final l = context.l10n;
    final h = DateTime.now().hour;
    return h < 12 ? l.greetingMorning : h < 17 ? l.greetingAfternoon : l.greetingEvening;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final user = currentUserOf(ref.watch(sessionProvider));
    final parcels = ref.watch(myParcelsProvider);
    final transfers = ref.watch(myTransfersProvider);
    final notes = ref.watch(notificationsProvider);
    final reduce = reduceMotion(context);
    final waiting = (transfers.value ?? []).where((t) => t.buyerId == user?.userId && t.status == 'INITIATED').toList();

    Widget enter(Widget w, int i) => reduce ? w : w.animate().fadeIn(delay: (60 * i).ms, duration: 250.ms).slideY(begin: .06, end: 0, curve: Curves.easeOut);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myParcelsProvider);
          ref.invalidate(myTransfersProvider);
          ref.invalidate(notificationsProvider);
          await ref.read(myParcelsProvider.future);
        },
        child: CustomScrollView(slivers: [
          SliverToBoxAdapter(
            child: Container(
              color: context.milki.primaryDeep,
              child: Stack(children: [
                Positioned.fill(child: TopoBackground(color: Colors.white.withValues(alpha: .07))),
                SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 8, 24),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(_greeting(context), style: context.text.bodyMedium?.copyWith(color: Colors.white70)),
                            Text(user?.firstName ?? '', style: context.text.headlineMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w700)),
                          ]),
                        ),
                      ),
                      NotificationBell(unread: notes.value?.unread ?? 0),
                      IconButton(tooltip: l.settingsTitle, color: Colors.white, icon: const Icon(Icons.settings_outlined), onPressed: () => context.push('/settings')),
                    ]),
                  ),
                ),
              ]),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList.list(children: [
              enter(
                  Row(children: [
                    Expanded(child: _QuickAction(icon: Icons.qr_code_scanner, label: l.quickVerify, onTap: () => context.go('/verify'))),
                    const SizedBox(width: 12),
                    Expanded(child: _QuickAction(icon: Icons.swap_horiz, label: l.quickTransfer, onTap: () => context.go('/parcels'))),
                  ]),
                  0),
              if (waiting.isNotEmpty) ...[
                const SizedBox(height: 24),
                enter(_SectionTitle(l.waitingForYou), 1),
                for (final t in waiting) enter(Padding(padding: const EdgeInsets.only(top: 8), child: TransferTile(t, highlight: true)), 2),
              ],
              const SizedBox(height: 24),
              enter(_SectionTitle(l.myParcels, action: TextButton(onPressed: () => context.go('/parcels'), child: Text(l.seeAll))), 2),
              parcels.when(
                loading: () => const Column(children: [SkeletonBox(height: 96), SizedBox(height: 12), SkeletonBox(height: 96)]),
                error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(myParcelsProvider)),
                data: (list) => list.isEmpty
                    ? Card(child: Padding(padding: const EdgeInsets.all(20), child: Text(l.noParcelsBody, style: context.text.bodyMedium)))
                    : Column(children: [for (final (i, p) in list.take(3).indexed) enter(Padding(padding: const EdgeInsets.only(bottom: 12), child: ParcelCard(p)), 3 + i)]),
              ),
              const SizedBox(height: 12),
              enter(_SectionTitle(l.recentActivity), 5),
              notes.when(
                loading: () => const SkeletonBox(height: 120),
                error: (_, _) => const SizedBox.shrink(),
                data: (n) => n.items.isEmpty
                    ? Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(l.noActivity, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)))
                    : Card(
                        child: Column(children: [
                          for (final item in n.items.take(4))
                            ListTile(
                              leading: Icon(notificationIcon(item.type), color: context.colors.primary),
                              title: Text(item.title, style: context.text.titleSmall),
                              subtitle: Text(item.body, maxLines: 2, overflow: TextOverflow.ellipsis),
                              trailing: item.createdAt == null ? null : Text(timeago.format(item.createdAt!, locale: Localizations.localeOf(context).languageCode), style: context.text.bodySmall),
                              onTap: () => openNotification(context, ref, item),
                            ),
                        ]),
                      ),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key, required this.unread});
  final int unread;

  @override
  Widget build(BuildContext context) => IconButton(
        key: const Key('notifications-bell'),
        tooltip: context.l10n.notificationsTitle,
        color: Colors.white,
        onPressed: () => context.push('/notifications'),
        icon: Badge(
          isLabelVisible: unread > 0,
          backgroundColor: context.milki.gold,
          textColor: context.milki.primaryDeep,
          label: Text(unread > 9 ? '9+' : '$unread'),
          child: const Icon(Icons.notifications_outlined),
        ),
      );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {this.action});
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(children: [Expanded(child: Text(text, style: context.text.titleMedium)), ?action]),
      );
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              CircleAvatar(radius: 18, backgroundColor: context.milki.gold.withValues(alpha: .2), child: Icon(icon, size: 20, color: context.milki.goldInk)),
              const SizedBox(width: 10),
              Expanded(child: Text(label, style: context.text.titleSmall)),
            ]),
          ),
        ),
      );
}
