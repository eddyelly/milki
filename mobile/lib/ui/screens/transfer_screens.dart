import 'package:crypto/crypto.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../validators.dart';
import '../widgets/common.dart';
import '../widgets/confirm_action.dart';
import '../widgets/documents.dart';
import '../widgets/file_pick.dart';
import '../widgets/timelines.dart';

// ---------------------------------------------------------------------------------------------- list
class TransfersScreen extends ConsumerStatefulWidget {
  const TransfersScreen({super.key});

  @override
  ConsumerState<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends ConsumerState<TransfersScreen> {
  String _filter = 'any';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final me = currentUserOf(ref.watch(sessionProvider))?.userId;
    final transfers = ref.watch(myTransfersProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.transfersTitle)),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: SegmentedButton<String>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: 'any', label: Text(l.all)),
              ButtonSegment(value: 'seller', label: Text(l.asSeller)),
              ButtonSegment(value: 'buyer', label: Text(l.asBuyer)),
            ],
            selected: {_filter},
            onSelectionChanged: (s) => setState(() => _filter = s.first),
          ),
        ),
        Expanded(
          child: transfers.when(
            loading: () => const SkeletonList(),
            error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(myTransfersProvider)),
            data: (all) {
              final list = all.where((t) => _filter == 'any' || (_filter == 'seller' ? t.sellerId == me : t.buyerId == me)).toList();
              return RefreshIndicator(
                onRefresh: () => ref.refresh(myTransfersProvider.future),
                child: list.isEmpty
                    ? ListView(children: [SizedBox(height: 420, child: EmptyState(icon: Icons.swap_horiz, title: l.noTransfers, body: l.noTransfersBody))])
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: list.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (_, i) => TransferTile(list[i], highlight: list[i].buyerId == me && list[i].status == 'INITIATED'),
                      ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

class TransferTile extends ConsumerWidget {
  const TransferTile(this.t, {super.key, this.highlight = false});
  final TransferSummary t;
  final bool highlight;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = currentUserOf(ref.watch(sessionProvider))?.userId;
    final selling = t.sellerId == me;
    return Pressable(
      onTap: () => context.go('/transfers/${t.transferId}'),
      child: Card(
        key: Key('transfer-${t.transferId}'),
        shape: highlight ? RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: context.milki.gold, width: 1.5)) : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            CircleAvatar(
              backgroundColor: (selling ? context.colors.primary : context.milki.gold).withValues(alpha: .15),
              child: Icon(selling ? Icons.north_east : Icons.south_west, color: selling ? context.colors.primary : context.milki.goldInk, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t.parcelId, style: monoStyle(size: 14, weight: FontWeight.w600, color: context.colors.onSurface)),
                Text('${selling ? l.asSeller : l.asBuyer} · ${fmtDate(t.updatedAt)}', style: context.text.bodySmall),
                if (highlight) Text(l.needsYourAcceptance, style: context.text.labelMedium?.copyWith(color: context.milki.goldInk)),
              ]),
            ),
            StatusChip(status: t.status, small: true),
          ]),
        ),
      ),
    );
  }
}

// -------------------------------------------------------------------------------------------- detail
class TransferDetailScreen extends ConsumerWidget {
  const TransferDetailScreen({super.key, required this.transferId});
  final String transferId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = currentUserOf(ref.watch(sessionProvider))?.userId;
    final transfer = ref.watch(transferProvider(transferId));
    final docs = ref.watch(transferDocumentsProvider(transferId));

    return Scaffold(
      appBar: AppBar(
        title: Text(transferId, style: monoStyle(size: 15, weight: FontWeight.w600, color: context.colors.onSurface)),
        actions: [IconButton(key: const Key('get-help'), tooltip: l.getHelp, icon: const Icon(Icons.support_agent), onPressed: () => context.go('/help/tickets/new?transferId=$transferId'))],
      ),
      body: transfer.when(
        loading: () => const SkeletonList(count: 3, height: 140),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(transferProvider(transferId))),
        data: (t) {
          final buyer = t.buyerId == me;
          final seller = t.sellerId == me;
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(transferDocumentsProvider(transferId));
              return ref.refresh(transferProvider(transferId).future);
            },
            child: ListView(padding: const EdgeInsets.all(16), children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(
                        child: InkWell(
                          onTap: () => context.go('/parcels/${t.parcelId}'),
                          child: Text(t.parcelId, style: monoStyle(size: 17, weight: FontWeight.w700, color: context.colors.primary)),
                        ),
                      ),
                      StatusChip(status: t.status),
                    ]),
                    const SizedBox(height: 16),
                    _Party(label: l.seller, party: t.seller, you: seller),
                    Padding(padding: const EdgeInsets.only(left: 18), child: Icon(Icons.arrow_downward, size: 18, color: context.colors.onSurfaceVariant)),
                    _Party(label: l.buyer, party: t.buyer, you: buyer),
                    if (t.salePrice != null) ...[
                      const Divider(height: 28),
                      Row(children: [
                        Expanded(child: Text(l.salePrice, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant))),
                        Text(fmtMoney(t.salePrice!, t.currency ?? 'TZS'), style: context.text.titleMedium),
                      ]),
                      const SizedBox(height: 6),
                      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Icon(Icons.lock_outline, size: 14, color: context.colors.onSurfaceVariant),
                        const SizedBox(width: 6),
                        Expanded(child: Text(l.privateData, style: context.text.bodySmall)),
                      ]),
                    ],
                  ]),
                ),
              ),
              const SizedBox(height: 16),
              Card(child: Padding(padding: const EdgeInsets.all(16), child: TransferTracker(status: t.status, history: t.history))),
              if (t.closedReason != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('“${t.closedReason}”', style: context.text.bodyMedium)),
              const SizedBox(height: 16),
              ..._actions(context, ref, t, buyer: buyer, seller: seller),
              const SizedBox(height: 16),
              Row(children: [
                Expanded(child: Text(l.documents, style: context.text.titleMedium)),
                if (t.isOpen && (buyer || seller))
                  TextButton.icon(key: const Key('upload-document'), onPressed: () => uploadTransferDocument(context, ref, t), icon: const Icon(Icons.upload_file), label: Text(l.uploadDocument)),
              ]),
              docs.when(
                loading: () => const SkeletonBox(height: 80),
                error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(transferDocumentsProvider(transferId))),
                data: (d) => DocumentList(documents: d),
              ),
            ]),
          );
        },
      ),
    );
  }

  List<Widget> _actions(BuildContext context, WidgetRef ref, Transfer t, {required bool buyer, required bool seller}) {
    final l = context.l10n;
    final canAccept = buyer && t.status == 'INITIATED';
    return [
      // Say who the transfer is waiting for, unless it is waiting for this user.
      if (t.isOpen && !canAccept)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(children: [
            Icon(Icons.hourglass_top_rounded, size: 18, color: context.milki.goldInk),
            const SizedBox(width: 8),
            Expanded(child: Text(t.status == 'INITIATED' ? l.waitingForBuyer : l.waitingForOfficials, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant))),
          ]),
        ),
      if (canAccept) ...[
        FilledButton.icon(key: const Key('accept-transfer'), onPressed: () => _accept(context, ref, t), icon: const Icon(Icons.handshake_outlined), label: Text(l.acceptTransfer)),
        const SizedBox(height: 8),
      ],
      if (seller && Transfer.cancellable.contains(t.status))
        OutlinedButton.icon(
          key: const Key('cancel-transfer'),
          style: OutlinedButton.styleFrom(foregroundColor: context.milki.danger, side: BorderSide(color: context.milki.danger.withValues(alpha: .5))),
          onPressed: () => _cancel(context, ref, t),
          icon: const Icon(Icons.block),
          label: Text(l.cancelTransfer),
        ),
    ];
  }

  Future<void> _accept(BuildContext context, WidgetRef ref, Transfer t) async {
    final l = context.l10n;
    await showConfirmAction<Submitted>(
      context,
      tier: ConfirmTier.t3,
      title: l.acceptTransfer,
      impactSentence: l.impactAccept(t.parcelId, t.seller.shortName),
      impact: [
        (l.seller, t.seller.shortName),
        if (t.salePrice != null) (l.salePrice, fmtMoney(t.salePrice!, t.currency ?? 'TZS')),
      ],
      consequences: [l.acceptNext],
      onConfirm: (ctx) => ref.read(transferRepositoryProvider).accept(t.transferId, ctx.options),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, Transfer t) async {
    final l = context.l10n;
    final reason = TextEditingController();
    await showConfirmAction<Submitted>(
      context,
      tier: ConfirmTier.t3,
      title: l.cancelTransfer,
      impactSentence: l.impactCancel(t.parcelId),
      consequences: [l.cancelConsequence],
      typeToConfirm: t.transferId,
      listen: reason,
      canConfirm: () => reason.text.trim().length >= 3,
      extra: TextField(key: const Key('cancel-reason'), controller: reason, maxLength: 300, decoration: InputDecoration(labelText: l.reason)),
      confirmLabel: l.cancelTransfer,
      onConfirm: (ctx) => ref.read(transferRepositoryProvider).cancel(t.transferId, reason.text.trim(), ctx.options),
    );
    // Not disposed here: the sheet's exit animation still renders the field; it is collected with the sheet.
  }
}

class _Party extends StatelessWidget {
  const _Party({required this.label, required this.party, required this.you});
  final String label;
  final Party party;
  final bool you;

  @override
  Widget build(BuildContext context) {
    final name = party.fullName == null ? party.userId : party.shortName;
    return Row(children: [
      CircleAvatar(radius: 18, backgroundColor: context.colors.primary.withValues(alpha: .1), child: Text(name.isEmpty ? '?' : name[0], style: TextStyle(color: context.colors.primary, fontWeight: FontWeight.w700))),
      const SizedBox(width: 12),
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: context.text.bodySmall),
        Text(you ? '$name (${context.l10n.you})' : name, style: context.text.titleSmall),
      ]),
    ]);
  }
}

// ------------------------------------------------------------------------------------------ initiate
class InitiateTransferScreen extends ConsumerStatefulWidget {
  const InitiateTransferScreen({super.key, required this.parcelId});
  final String parcelId;

  @override
  ConsumerState<InitiateTransferScreen> createState() => _InitiateTransferScreenState();
}

class _InitiateTransferScreenState extends ConsumerState<InitiateTransferScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _price = TextEditingController();
  Party? _buyer;
  bool _looking = false;
  String? _lookupError;

  @override
  void dispose() {
    _phone.dispose();
    _price.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    final l = context.l10n;
    final phone = normalizePhone(_phone.text);
    if (phone == null) {
      setState(() => _lookupError = l.invalidPhone);
      return;
    }
    setState(() {
      _looking = true;
      _lookupError = null;
      _buyer = null;
    });
    try {
      final b = await ref.read(transferRepositoryProvider).lookupBuyer(phone);
      final me = currentUserOf(ref.read(sessionProvider))?.userId;
      setState(() {
        if (b.userId == me) {
          _lookupError = l.cannotSellToSelf;
        } else {
          _buyer = b;
        }
      });
    } catch (e) {
      setState(() => _lookupError = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  num? get _amount => num.tryParse(_price.text.replaceAll(RegExp(r'[,\s]'), ''));

  Future<void> _review(Parcel p) async {
    if (!_form.currentState!.validate() || _buyer == null) return;
    final l = context.l10n;
    final user = currentUserOf(ref.read(sessionProvider));
    final me = Party(userId: user?.userId ?? '', fullName: user?.fullName).shortName;
    final buyer = _buyer!;
    final amount = _amount!;
    final result = await showConfirmAction<Submitted>(
      context,
      tier: ConfirmTier.t3,
      title: l.reviewTransfer,
      impactSentence: l.impactTransfer(p.parcelId, me, buyer.shortName),
      impact: [
        (l.titleNumber, p.titleNumber),
        (l.area, fmtArea(p.area)),
        (l.buyer, buyer.shortName),
        (l.salePrice, fmtMoney(amount)),
      ],
      consequences: [l.transferNextSteps, l.privateData],
      onConfirm: (ctx) => ref.read(transferRepositoryProvider).initiate(parcelId: p.parcelId, buyerUserId: buyer.userId, salePrice: amount, options: ctx.options),
    );
    final id = result?.extra['transferId'] as String?;
    if (id != null && mounted) context.go('/transfers/$id');
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final parcel = ref.watch(parcelProvider(widget.parcelId));
    return Scaffold(
      appBar: AppBar(title: Text(l.startTransferTitle(widget.parcelId))),
      body: parcel.when(
        loading: () => const SkeletonList(count: 2),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(parcelProvider(widget.parcelId))),
        data: (p) => Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            if (!p.transferable)
              Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(l.cannotTransfer, style: TextStyle(color: context.milki.danger, fontWeight: FontWeight.w600))),
            Text(l.buyer, style: context.text.titleMedium),
            const SizedBox(height: 8),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: TextFormField(
                  key: const Key('buyer-phone'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(labelText: l.buyerPhone, hintText: '0712 345 678', errorText: _lookupError),
                  onChanged: (_) => setState(() => _buyer = null),
                  onFieldSubmitted: (_) => _lookup(),
                ),
              ),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: FilledButton.tonal(
                  key: const Key('find-buyer'),
                  onPressed: _looking ? null : _lookup,
                  child: _looking ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.findBuyer),
                ),
              ),
            ]),
            if (_buyer != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Chip(
                  key: const Key('buyer-found'),
                  avatar: Icon(Icons.verified_user, color: context.colors.primary, size: 18),
                  label: Text(l.buyerFound(_buyer!.shortName)),
                ),
              ),
            const SizedBox(height: 24),
            Text(l.salePrice, style: context.text.titleMedium),
            const SizedBox(height: 8),
            TextFormField(
              key: const Key('sale-price'),
              controller: _price,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9,]'))],
              decoration: InputDecoration(labelText: l.salePriceTzs, prefixText: 'TSh '),
              validator: (v) => requiredField(l, v) ?? ((_amount ?? 0) <= 0 ? l.invalidAmount : null),
            ),
            const SizedBox(height: 8),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(Icons.lock_outline, size: 14, color: context.colors.onSurfaceVariant),
              const SizedBox(width: 6),
              Expanded(child: Text(l.privateData, style: context.text.bodySmall)),
            ]),
            const SizedBox(height: 32),
            FilledButton(
              key: const Key('review-transfer'),
              onPressed: _buyer != null && p.transferable ? () => _review(p) : null,
              child: Text(l.reviewTransfer),
            ),
          ]),
        ),
      ),
    );
  }
}

// -------------------------------------------------------------------------------------------- upload
const uploadDocumentTypes = ['SALE_AGREEMENT', 'PAYMENT_PROOF', 'TAX_RECEIPT', 'ID_COPY', 'VALUATION_REPORT', 'OTHER'];

class PickedFile {
  const PickedFile(this.name, this.bytes, this.mimeType);
  final String name;
  final Uint8List bytes;
  final String mimeType;
}


/// Choose type + file, then T3: only the SHA-256 is recorded on the ledger (CLAUDE.md rule 5).
Future<void> uploadTransferDocument(BuildContext context, WidgetRef ref, Transfer t) async {
  final l = context.l10n;
  final picked = await showModalBottomSheet<(String, PickedFile)>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => const _UploadPicker());
  if (picked == null || !context.mounted) return;
  final (type, file) = picked;
  final hash = sha256.convert(file.bytes).toString();
  await showConfirmAction<Submitted>(
    context,
    tier: ConfirmTier.t3,
    title: l.uploadDocument,
    impactSentence: l.impactDocument(titleCase(type), t.transferId),
    impact: [
      (l.documentType, titleCase(type)),
      (l.file, file.name.length > 26 ? '${file.name.substring(0, 23)}…' : file.name),
      (l.size, '${(file.bytes.length / 1024).toStringAsFixed(0)} KB'),
    ],
    extra: Row(children: [
      Icon(Icons.fingerprint, size: 16, color: context.milki.goldInk),
      const SizedBox(width: 6),
      Expanded(child: Text(shortHash(hash, 16, 12), style: monoStyle(size: 12))),
    ]),
    consequences: [l.fileStaysPrivate],
    onConfirm: (ctx) => ref.read(transferRepositoryProvider).upload(
          targetType: 'TRANSFER',
          targetId: t.transferId,
          documentType: type,
          bytes: file.bytes,
          filename: file.name,
          mimeType: file.mimeType,
          options: ctx.options,
        ),
  );
}

class _UploadPicker extends StatefulWidget {
  const _UploadPicker();

  @override
  State<_UploadPicker> createState() => _UploadPickerState();
}

class _UploadPickerState extends State<_UploadPicker> {
  String _type = uploadDocumentTypes.first;
  PickedFile? _file;
  String? _error;

  static const _maxBytes = 10 * 1024 * 1024;

  void _accept(PickedFile f) {
    setState(() {
      if (f.bytes.length > _maxBytes) {
        _error = context.l10n.fileTooLarge;
        _file = null;
      } else {
        _error = null;
        _file = f;
      }
    });
  }

  Future<void> _pickFile() async {
    final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png']);
    if (files.isEmpty) return;
    final f = files.first;
    _accept(PickedFile(f.name, await f.readAsBytes(), mimeFor(f.name)));
  }

  Future<void> _takePhoto() async {
    final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
    if (x == null) return;
    _accept(PickedFile(x.name, await x.readAsBytes(), x.mimeType ?? mimeFor(x.name)));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.uploadDocument, style: context.text.titleMedium),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _type,
            decoration: InputDecoration(labelText: l.documentType),
            items: [for (final t in uploadDocumentTypes) DropdownMenuItem(value: t, child: Text(titleCase(t)))],
            onChanged: (v) => setState(() => _type = v ?? _type),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: _pickFile, icon: const Icon(Icons.attach_file), label: Text(l.chooseFile))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton.icon(onPressed: _takePhoto, icon: const Icon(Icons.photo_camera_outlined), label: Text(l.takePhoto))),
          ]),
          if (_file != null)
            ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.description_outlined), title: Text(_file!.name, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text('${(_file!.bytes.length / 1024).toStringAsFixed(0)} KB')),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: context.milki.danger))),
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.fileTypesHint, style: context.text.bodySmall)),
          const SizedBox(height: 16),
          FilledButton(onPressed: _file == null ? null : () => Navigator.of(context).pop((_type, _file!)), child: Text(l.continueAction)),
        ]),
      ),
    );
  }
}
