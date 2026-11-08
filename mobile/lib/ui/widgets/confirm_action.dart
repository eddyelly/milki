import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/ledger_events.dart';
import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import 'common.dart';
import 'sealed_on_ledger.dart';

/// CLAUDE.md §8 tiers. T1: summary → confirm. T2: red, type the identifier. T3: impact summary → permanence →
/// re-auth (biometric with PIN fallback, or password) → sealed-on-ledger animation.
enum ConfirmTier { t1, t2, t3 }

class ConfirmContext {
  const ConfirmContext({required this.idempotencyKey, this.reauthToken});
  final String idempotencyKey;
  final String? reauthToken;

  WriteOptions get options => WriteOptions(idempotencyKey: idempotencyKey, reauthToken: reauthToken);
}

/// The one confirmation helper for every mutation in the app. Returns the action's result, or null if dismissed.
/// For T3 the result should be a [Submitted]; the sheet then waits for the commit and shows the seal.
Future<T?> showConfirmAction<T>(
  BuildContext context, {
  required ConfirmTier tier,
  required String title,
  required Future<T> Function(ConfirmContext ctx) onConfirm,
  String? impactSentence,
  List<(String, String)> impact = const [],
  List<String> consequences = const [],
  String? typeToConfirm,
  String? confirmLabel,
  Widget? extra,
  bool Function()? canConfirm,
  Listenable? listen,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    isDismissible: true,
    builder: (_) => _ConfirmSheet<T>(
      tier: tier,
      title: title,
      onConfirm: onConfirm,
      impactSentence: impactSentence,
      impact: impact,
      consequences: consequences,
      typeToConfirm: typeToConfirm,
      confirmLabel: confirmLabel,
      extra: extra,
      canConfirm: canConfirm,
      listen: listen,
    ),
  );
}

enum _Step { review, reauth, sealing }

class _ConfirmSheet<T> extends ConsumerStatefulWidget {
  const _ConfirmSheet({
    required this.tier,
    required this.title,
    required this.onConfirm,
    this.impactSentence,
    this.impact = const [],
    this.consequences = const [],
    this.typeToConfirm,
    this.confirmLabel,
    this.extra,
    this.canConfirm,
    this.listen,
  });
  final ConfirmTier tier;
  final String title;
  final Future<T> Function(ConfirmContext ctx) onConfirm;
  final String? impactSentence;
  final List<(String, String)> impact;
  final List<String> consequences;
  final String? typeToConfirm;
  final String? confirmLabel;
  final Widget? extra;
  final bool Function()? canConfirm;

  /// Rebuilds the buttons when inputs inside [extra] change (so [canConfirm] is re-evaluated).
  final Listenable? listen;

  @override
  ConsumerState<_ConfirmSheet<T>> createState() => _ConfirmSheetState<T>();
}

class _ConfirmSheetState<T> extends ConsumerState<_ConfirmSheet<T>> {
  /// Stable for this sheet, so a retry after an error never writes twice.
  final _key = newUuid();
  final _typed = TextEditingController();
  final _password = TextEditingController();
  _Step _step = _Step.review;
  bool _pending = false;
  String? _error;
  bool _biometric = false;
  SealStage _seal = SealStage.submitting;
  String? _txId;
  int? _block;
  T? _result;

  bool get _destructive => widget.tier == ConfirmTier.t2 || widget.typeToConfirm != null;
  bool get _reviewOk => (widget.typeToConfirm == null || _typed.text.trim() == widget.typeToConfirm) && (widget.canConfirm?.call() ?? true);

  @override
  void initState() {
    super.initState();
    _typed.addListener(() => setState(() {}));
    _password.addListener(() => setState(() {}));
    widget.listen?.addListener(_rebuild);
    if (widget.tier == ConfirmTier.t3) {
      ref.read(reauthenticatorProvider).biometricReady().then((v) {
        if (mounted) setState(() => _biometric = v);
      });
    }
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.listen?.removeListener(_rebuild);
    _typed.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _direct() async {
    setState(() {
      _pending = true;
      _error = null;
    });
    try {
      final r = await widget.onConfirm(ConfirmContext(idempotencyKey: _key));
      if (mounted) Navigator.of(context).pop(r);
    } catch (e) {
      setState(() {
        _pending = false;
        _error = ApiException.from(e).message;
      });
    }
  }

  Future<void> _ledger({required bool biometric}) async {
    final l = context.l10n;
    setState(() {
      _pending = true;
      _error = null;
    });
    String? token;
    try {
      final reauth = ref.read(reauthenticatorProvider);
      token = biometric ? await reauth.withBiometrics(l.biometricReason) : await reauth.withPassword(_password.text);
    } catch (e) {
      setState(() {
        _pending = false;
        _error = ApiException.from(e).message;
      });
      return;
    }
    if (token == null) {
      setState(() => _pending = false); // biometric prompt cancelled
      return;
    }
    setState(() {
      _step = _Step.sealing;
      _seal = SealStage.submitting;
    });
    T result;
    try {
      result = await widget.onConfirm(ConfirmContext(idempotencyKey: _key, reauthToken: token));
    } catch (e) {
      // A chaincode guard refused it at endorsement, nothing was written. Back to review with the reason.
      setState(() {
        _pending = false;
        _step = _Step.review;
        _error = ApiException.from(e).message;
      });
      return;
    }
    _result = result;
    final txId = result is Submitted ? result.txId : null;
    if (txId == null) {
      setState(() {
        _pending = false;
        _seal = SealStage.committed;
      });
      return;
    }
    setState(() {
      _txId = txId;
      _seal = SealStage.endorsing;
    });
    try {
      final s = await ref.read(ledgerEventsProvider).waitForCommit(txId);
      setState(() {
        _seal = SealStage.committed;
        _block = s.blockNumber;
      });
    } on LedgerCommitException catch (e) {
      setState(() {
        _seal = SealStage.failed;
        _error = e.timedOut ? l.stillWaiting : l.ledgerFailed;
      });
    } finally {
      if (mounted) setState(() => _pending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final danger = context.milki.danger;
    final t3 = widget.tier == ConfirmTier.t3;
    return PopScope(
      canPop: !_pending,
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (_step != _Step.sealing) ...[
              Row(children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: (_destructive ? danger : t3 ? context.milki.gold : context.colors.primary).withValues(alpha: .15),
                  child: Icon(_destructive ? Icons.warning_amber_rounded : t3 ? Icons.account_balance : Icons.check, color: _destructive ? danger : t3 ? context.milki.goldInk : context.colors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(_step == _Step.reauth ? l.confirmItsYou : widget.title, style: context.text.titleMedium),
                    if (t3) Text(l.ledgerStep(_step == _Step.review ? 1 : 2), style: context.text.bodySmall),
                  ]),
                ),
              ]),
              const SizedBox(height: 16),
            ],
            if (_step == _Step.review) ..._review(context),
            if (_step == _Step.reauth) ..._reauth(context),
            if (_step == _Step.sealing) SealedOnLedger(stage: _seal, txId: _txId, blockNumber: _block, error: _error),
            if (_error != null && _step != _Step.sealing) ...[
              const SizedBox(height: 12),
              Container(
                key: const Key('confirm-error'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: danger.withValues(alpha: .1), borderRadius: BorderRadius.circular(10)),
                child: Text(_error!, style: TextStyle(color: danger, fontWeight: FontWeight.w600)),
              ),
            ],
            const SizedBox(height: 16),
            ..._buttons(context),
          ]),
        ),
      ),
    );
  }

  List<Widget> _review(BuildContext context) {
    final l = context.l10n;
    return [
      if (widget.impactSentence != null)
        Container(
          key: const Key('impact-sentence'),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: context.milki.gold.withValues(alpha: .12), borderRadius: BorderRadius.circular(10), border: Border.all(color: context.milki.gold.withValues(alpha: .4))),
          // Names like "Juma H." can end the sentence: avoid a doubled full stop.
          child: Text(widget.impactSentence!.replaceAll(RegExp(r'\.\.$'), '.'), style: context.text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
        ),
      if (widget.impact.isNotEmpty) ...[
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(border: Border.all(color: context.milki.border), borderRadius: BorderRadius.circular(10)),
          child: Column(children: [
            for (final (k, v) in widget.impact)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                child: Row(children: [Expanded(child: Text(k, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant))), Text(v, style: context.text.bodyMedium?.copyWith(fontWeight: FontWeight.w600))]),
              ),
          ]),
        ),
      ],
      for (final c in widget.consequences) Padding(padding: const EdgeInsets.only(top: 8), child: Text('• $c', style: context.text.bodyMedium)),
      if (widget.extra != null) ...[const SizedBox(height: 12), widget.extra!],
      if (widget.tier == ConfirmTier.t3) ...[
        const SizedBox(height: 12),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.shield_outlined, size: 18, color: context.milki.goldInk),
          const SizedBox(width: 8),
          Expanded(child: Text(l.permanentWarning, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant))),
        ]),
      ],
      if (widget.typeToConfirm != null) ...[
        const SizedBox(height: 12),
        TextField(
          key: const Key('type-to-confirm'),
          controller: _typed,
          autocorrect: false,
          style: monoStyle(size: 15),
          decoration: InputDecoration(labelText: l.typeToConfirm(widget.typeToConfirm!)),
        ),
      ],
    ];
  }

  List<Widget> _reauth(BuildContext context) {
    final l = context.l10n;
    return [
      if (_biometric) ...[
        FilledButton.icon(
          key: const Key('reauth-biometric'),
          onPressed: _pending ? null : () => _ledger(biometric: true),
          icon: const Icon(Icons.fingerprint),
          label: Text(l.useBiometrics),
        ),
        const SizedBox(height: 16),
        Text(l.usePasswordInstead, style: context.text.labelMedium),
        const SizedBox(height: 8),
      ],
      TextField(
        key: const Key('reauth-password'),
        controller: _password,
        obscureText: true,
        autofocus: !_biometric,
        decoration: InputDecoration(labelText: l.password),
        onSubmitted: (_) => _password.text.isNotEmpty && !_pending ? _ledger(biometric: false) : null,
      ),
    ];
  }

  List<Widget> _buttons(BuildContext context) {
    final l = context.l10n;
    final danger = context.milki.danger;
    final style = _destructive ? FilledButton.styleFrom(backgroundColor: danger, foregroundColor: Colors.white) : null;
    Widget spinner() => const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2));

    if (_step == _Step.sealing) {
      return [
        FilledButton(
          key: const Key('confirm-done'),
          onPressed: _pending ? null : () => Navigator.of(context).pop(_seal == SealStage.committed ? _result : null),
          child: _pending ? spinner() : Text(l.done),
        ),
      ];
    }
    final primary = switch ((widget.tier, _step)) {
      (ConfirmTier.t3, _Step.review) => FilledButton(
          key: const Key('confirm-continue'),
          style: style,
          onPressed: _reviewOk ? () => setState(() => _step = _Step.reauth) : null,
          child: Text(l.continueAction),
        ),
      (ConfirmTier.t3, _Step.reauth) => FilledButton(
          key: const Key('confirm-sign'),
          style: style,
          onPressed: _password.text.isNotEmpty && !_pending ? () => _ledger(biometric: false) : null,
          child: _pending ? spinner() : Text(widget.confirmLabel ?? l.signAndRecord),
        ),
      _ => FilledButton(
          key: const Key('confirm-submit'),
          style: style,
          onPressed: _reviewOk && !_pending ? _direct : null,
          child: _pending ? spinner() : Text(widget.confirmLabel ?? l.confirm),
        ),
    };
    return [
      primary,
      const SizedBox(height: 8),
      TextButton(
        onPressed: _pending ? null : () => _step == _Step.reauth ? setState(() => _step = _Step.review) : Navigator.of(context).pop(),
        child: Text(_step == _Step.reauth ? l.back : l.cancel),
      ),
    ];
  }
}
