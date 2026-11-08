import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';
import '../widgets/documents.dart';
import '../widgets/timelines.dart';

/// QR payload for proof of ownership; the Verify tab (and `/check`) understands it.
String parcelQr(String parcelId) => 'milki:parcel:$parcelId';

class ParcelsScreen extends ConsumerWidget {
  const ParcelsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final parcels = ref.watch(myParcelsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.parcelsTitle)),
      body: parcels.when(
        loading: () => const SkeletonList(height: 104),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(myParcelsProvider)),
        data: (list) => RefreshIndicator(
          onRefresh: () => ref.refresh(myParcelsProvider.future),
          child: list.isEmpty
              ? ListView(children: [SizedBox(height: 420, child: EmptyState(icon: Icons.map_outlined, title: l.noParcels, body: l.noParcelsBody))])
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => ParcelCard(list[i]),
                ),
        ),
      ),
    );
  }
}

/// Parcel card → details uses a Hero transition (CLAUDE.md §10.5).
class ParcelCard extends StatelessWidget {
  const ParcelCard(this.parcel, {super.key});
  final ParcelSummary parcel;

  @override
  Widget build(BuildContext context) {
    final p = parcel;
    return Pressable(
      onTap: () => context.go('/parcels/${p.parcelId}'),
      child: Hero(
        tag: 'parcel-${p.parcelId}',
        child: Card(
          key: Key('parcel-${p.parcelId}'),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              _ParcelGlyph(status: p.status),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.parcelId, style: monoStyle(size: 15, weight: FontWeight.w600, color: context.colors.onSurface)),
                  const SizedBox(height: 2),
                  Text('${p.ward}, ${p.district} · ${p.region}', maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
                  const SizedBox(height: 8),
                  Row(children: [
                    StatusChip(status: p.status, small: true),
                    const SizedBox(width: 8),
                    Text('${fmtArea(p.area)} · ${titleCase(p.landUse)}', style: context.text.bodySmall),
                  ]),
                ]),
              ),
              Icon(Icons.chevron_right, color: context.colors.onSurfaceVariant),
            ]),
          ),
        ),
      ),
    );
  }
}

class _ParcelGlyph extends StatelessWidget {
  const _ParcelGlyph({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final c = StatusChip.meta(context, status).color;
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(color: c.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
      child: Icon(Icons.landscape_outlined, color: c),
    );
  }
}

class ParcelDetailScreen extends ConsumerWidget {
  const ParcelDetailScreen({super.key, required this.parcelId});
  final String parcelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final parcel = ref.watch(parcelProvider(parcelId));
    final history = ref.watch(parcelHistoryProvider(parcelId));
    final docs = ref.watch(parcelDocumentsProvider(parcelId));

    return Scaffold(
      appBar: AppBar(
        title: Text(parcelId, style: monoStyle(size: 16, weight: FontWeight.w600, color: context.colors.onSurface)),
        actions: [
          if (parcel.hasValue)
            IconButton(key: const Key('share-proof'), tooltip: l.shareProof, icon: const Icon(Icons.qr_code_2), onPressed: () => _showProof(context, parcel.value!)),
        ],
      ),
      body: parcel.when(
        loading: () => const SkeletonList(count: 3, height: 140),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(parcelProvider(parcelId))),
        data: (p) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(parcelHistoryProvider(parcelId));
            ref.invalidate(parcelDocumentsProvider(parcelId));
            return ref.refresh(parcelProvider(parcelId).future);
          },
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Hero(tag: 'parcel-${p.parcelId}', child: _Header(p)),
            const SizedBox(height: 12),
            _Facts(p),
            const SizedBox(height: 16),
            if (p.activeTransferId != null)
              FilledButton.tonalIcon(
                onPressed: () => context.go('/transfers/${p.activeTransferId}'),
                icon: const Icon(Icons.swap_horiz),
                label: Text(l.viewActiveTransfer),
              )
            else if (p.transferable)
              FilledButton.icon(
                key: const Key('start-transfer'),
                onPressed: () => context.go('/parcels/${p.parcelId}/transfer'),
                icon: const Icon(Icons.swap_horiz),
                label: Text(l.transferThisParcel),
              )
            else
              _Notice(icon: Icons.info_outline, text: _blockedReason(context, p.status)),
            const SizedBox(height: 24),
            Text(l.history, style: context.text.titleMedium),
            const SizedBox(height: 8),
            history.when(
              loading: () => const SkeletonBox(height: 160),
              error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(parcelHistoryProvider(parcelId))),
              data: (h) => OwnershipChain(entries: h),
            ),
            const SizedBox(height: 16),
            Text(l.documents, style: context.text.titleMedium),
            const SizedBox(height: 8),
            docs.when(
              loading: () => const SkeletonBox(height: 80),
              error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(parcelDocumentsProvider(parcelId))),
              data: (d) => DocumentList(documents: d),
            ),
          ]),
        ),
      ),
    );
  }

  String _blockedReason(BuildContext context, String status) {
    final l = context.l10n;
    return switch (status) {
      'ENCUMBERED' => l.blockedEncumbered,
      'DISPUTED' => l.blockedDisputed,
      'FROZEN' => l.blockedFrozen,
      _ => l.cannotTransfer,
    };
  }

  void _showProof(BuildContext context, Parcel p) {
    final l = context.l10n;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(l.shareProof, style: context.text.titleMedium),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: context.milki.gold, width: 2)),
              child: QrImageView(
                key: const Key('proof-qr'),
                data: parcelQr(p.parcelId),
                size: 200,
                eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: MilkiColors.primaryDeep),
                dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: MilkiColors.primaryDeep),
              ),
            ),
            const SizedBox(height: 12),
            Text(p.parcelId, style: monoStyle(size: 15, weight: FontWeight.w600, color: context.colors.onSurface)),
            const SizedBox(height: 8),
            Text(l.shareProofBody, textAlign: TextAlign.center, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
          ]),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.p);
  final Parcel p;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: context.milki.primaryDeep,
      clipBehavior: Clip.antiAlias,
      child: Stack(children: [
        Positioned.fill(child: TopoBackground(color: Colors.white.withValues(alpha: .08))),
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(p.titleNumber, style: monoStyle(size: 13, color: Colors.white70))),
              // Card-coloured backing keeps the chip legible on the deep-green hero (WCAG AA).
              DecoratedBox(
                decoration: BoxDecoration(color: context.colors.surfaceContainerLowest, borderRadius: BorderRadius.circular(999)),
                child: StatusChip(status: p.status),
              ),
            ]),
            const SizedBox(height: 10),
            Text(fmtArea(p.area), style: context.text.headlineMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w700)),
            Text('${titleCase(p.landUse)} · ${p.ward}, ${p.district}, ${p.region}', style: context.text.bodyMedium?.copyWith(color: Colors.white70)),
          ]),
        ),
      ]),
    );
  }
}

class _Facts extends StatelessWidget {
  const _Facts(this.p);
  final Parcel p;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Widget row(String k, Widget v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 2, child: Text(k, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant))),
            const SizedBox(width: 12),
            Expanded(flex: 3, child: v),
          ]),
        );
    Text t(String s) => Text(s, style: context.text.bodyMedium?.copyWith(fontWeight: FontWeight.w600));
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Column(children: [
          row(l.titleNumber, t(p.titleNumber)),
          row(l.location, t('${l.blockPlot(p.blockNumber, p.plotNumber)}\n${p.latitude.toStringAsFixed(5)}, ${p.longitude.toStringAsFixed(5)}')),
          row(l.registeredOn, t(fmtDate(p.createdAt))),
          row(l.ownershipVersion, t('v${p.ownershipVersion}')),
          if (p.lastTxId.isNotEmpty) row(l.lastTransaction, MonoText(p.lastTxId, short: true, copyable: true, size: 12)),
        ]),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.milki.earth;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.withValues(alpha: .1), borderRadius: BorderRadius.circular(10), border: Border.all(color: c.withValues(alpha: .3))),
      child: Row(children: [Icon(icon, color: c), const SizedBox(width: 10), Expanded(child: Text(text, style: context.text.bodyMedium))]),
    );
  }
}
