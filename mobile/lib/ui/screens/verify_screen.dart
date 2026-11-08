import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';

// ---------------------------------------------------------------------------------------- QR payloads
sealed class VerifyTarget {
  const VerifyTarget();
}

class ParcelTarget extends VerifyTarget {
  const ParcelTarget(this.parcelId);
  final String parcelId;
}

class DocumentTarget extends VerifyTarget {
  const DocumentTarget(this.documentId, this.sha256);
  final String documentId;
  final String sha256;
}

final _parcelId = RegExp(r'^[A-Z]{2,4}-[A-Z]{2,4}-[0-9A-Z]{1,8}-[0-9A-Z]{1,8}$');
final _docId = RegExp(r'^DOC-[A-F0-9]{16}$');
final _sha = RegExp(r'^[a-f0-9]{64}$');

/// Understands `milki:parcel:<ID>`, `milki:doc:<DOC-ID>:<sha256>`, verification URLs
/// (`…/verify/parcels/<ID>`, `…/verify/documents/<DOC-ID>?sha256=…`) and a bare parcel ID.
VerifyTarget? parseVerifyCode(String raw) {
  final s = raw.trim();
  if (s.isEmpty) return null;
  final parts = s.split(':');
  if (parts.length >= 3 && parts[0].toLowerCase() == 'milki') {
    final kind = parts[1].toLowerCase();
    if (kind == 'parcel' && _parcelId.hasMatch(parts[2].toUpperCase())) return ParcelTarget(parts[2].toUpperCase());
    if (kind == 'doc' && parts.length == 4 && _docId.hasMatch(parts[2].toUpperCase()) && _sha.hasMatch(parts[3].toLowerCase())) {
      return DocumentTarget(parts[2].toUpperCase(), parts[3].toLowerCase());
    }
    return null;
  }
  final uri = Uri.tryParse(s);
  if (uri != null && uri.hasScheme && uri.pathSegments.length >= 2) {
    final seg = uri.pathSegments;
    final i = seg.indexOf('verify');
    if (i >= 0 && i + 2 < seg.length) {
      final id = seg[i + 2].toUpperCase();
      if (seg[i + 1] == 'parcels' && _parcelId.hasMatch(id)) return ParcelTarget(id);
      final sha = uri.queryParameters['sha256']?.toLowerCase();
      if (seg[i + 1] == 'documents' && _docId.hasMatch(id) && sha != null && _sha.hasMatch(sha)) return DocumentTarget(id, sha);
    }
    return null;
  }
  final id = s.toUpperCase().replaceAll(RegExp(r'\s+'), '');
  return _parcelId.hasMatch(id) ? ParcelTarget(id) : null;
}

// --------------------------------------------------------------------------------------------- screen
sealed class _Outcome {
  const _Outcome();
}

class _ParcelOk extends _Outcome {
  const _ParcelOk(this.v);
  final ParcelVerification v;
}

class _DocResult extends _Outcome {
  const _DocResult(this.v, this.sha256);
  final DocumentVerification v;
  final String sha256;
}

class _Failed extends _Outcome {
  const _Failed(this.message);
  final String message;
}

/// QR verification (CLAUDE.md §10.4): a scanline sweeps the frame; a gold "Verified on Milki" badge flips in on
/// success, the card shakes in earth on a mismatch. Public, works without signing in (`/check`).
class VerifyScreen extends ConsumerStatefulWidget {
  const VerifyScreen({super.key, this.standalone = false, this.startWithCamera = true});
  final bool standalone;
  final bool startWithCamera;

  @override
  ConsumerState<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends ConsumerState<VerifyScreen> {
  late bool _camera = widget.startWithCamera;
  final _manual = TextEditingController();
  bool _pending = false;
  _Outcome? _outcome;
  String? _lastCode;

  @override
  void dispose() {
    _manual.dispose();
    super.dispose();
  }

  Future<void> _check(String raw) async {
    final l = context.l10n;
    if (_pending) return;
    final target = parseVerifyCode(raw);
    if (target == null) {
      setState(() => _outcome = _Failed(l.unrecognisedCode));
      return;
    }
    setState(() {
      _pending = true;
      _outcome = null;
    });
    final repo = ref.read(parcelRepositoryProvider);
    try {
      final outcome = switch (target) {
        ParcelTarget(:final parcelId) => _ParcelOk(await repo.verify(parcelId)),
        DocumentTarget(:final documentId, :final sha256) => _DocResult(await repo.verifyDocument(documentId, sha256), sha256),
      };
      setState(() => _outcome = outcome);
    } catch (e) {
      setState(() => _outcome = _Failed(ApiException.from(e).message));
    } finally {
      if (mounted) setState(() => _pending = false);
    }
  }

  void _onDetect(BarcodeCapture capture) {
    final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
    if (code == null || code == _lastCode || _pending) return;
    _lastCode = code;
    _check(code);
  }

  void _reset() => setState(() {
        _outcome = null;
        _lastCode = null;
      });

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.verifyTitle), automaticallyImplyLeading: widget.standalone),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(l.verifySubtitle, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
        const SizedBox(height: 12),
        SegmentedButton<bool>(
          showSelectedIcon: false,
          segments: [
            ButtonSegment(value: true, icon: const Icon(Icons.qr_code_scanner), label: Text(l.scan)),
            ButtonSegment(value: false, icon: const Icon(Icons.keyboard), label: Text(l.typeId)),
          ],
          selected: {_camera},
          onSelectionChanged: (s) => setState(() {
            _camera = s.first;
            _reset();
          }),
        ),
        const SizedBox(height: 16),
        if (_camera && _outcome == null)
          _ScannerFrame(onDetect: _onDetect, busy: _pending)
        else if (!_camera)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: TextField(
                key: const Key('verify-input'),
                controller: _manual,
                textCapitalization: TextCapitalization.characters,
                style: monoStyle(size: 15),
                decoration: InputDecoration(labelText: l.enterParcelId),
                onSubmitted: _check,
              ),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: FilledButton(
                key: const Key('verify-check'),
                onPressed: _pending ? null : () => _check(_manual.text),
                child: _pending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.check),
              ),
            ),
          ]),
        if (_pending && _camera) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
        if (_outcome != null) ...[
          const SizedBox(height: 16),
          switch (_outcome!) {
            _ParcelOk(:final v) => _ParcelResultCard(v),
            _DocResult(:final v, :final sha256) => v.match ? _DocMatchCard(v, sha256) : _WarningCard(title: l.mismatch, body: l.mismatchBody),
            _Failed(:final message) => _WarningCard(title: l.notVerified, body: message),
          },
          if (_camera) ...[const SizedBox(height: 12), OutlinedButton.icon(onPressed: _reset, icon: const Icon(Icons.qr_code_scanner), label: Text(l.scanAnother))],
        ],
      ]),
    );
  }
}

class _ScannerFrame extends StatefulWidget {
  const _ScannerFrame({required this.onDetect, required this.busy});
  final void Function(BarcodeCapture) onDetect;
  final bool busy;

  @override
  State<_ScannerFrame> createState() => _ScannerFrameState();
}

class _ScannerFrameState extends State<_ScannerFrame> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final gold = context.milki.gold;
    final reduce = reduceMotion(context);
    return AspectRatio(
      aspectRatio: 1,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(fit: StackFit.expand, children: [
          MobileScanner(
            controller: _controller,
            onDetect: widget.onDetect,
            errorBuilder: (c, _) => Container(
              color: context.milki.primaryDeep,
              padding: const EdgeInsets.all(24),
              alignment: Alignment.center,
              child: Text(l.cameraUnavailable, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
            ),
          ),
          IgnorePointer(child: CustomPaint(painter: _CornersPainter(gold))),
          if (!widget.busy && !reduce)
            IgnorePointer(
              child: LayoutBuilder(
                builder: (_, box) => Align(
                  alignment: Alignment.topCenter,
                  child: Container(
                    height: 3,
                    margin: const EdgeInsets.symmetric(horizontal: 28),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: [gold.withValues(alpha: 0), gold, gold.withValues(alpha: 0)]),
                      boxShadow: [BoxShadow(color: gold.withValues(alpha: .6), blurRadius: 12)],
                    ),
                  ).animate(onPlay: (c) => c.repeat(reverse: true)).moveY(begin: 28, end: box.maxHeight - 32, duration: 1800.ms, curve: Curves.easeInOut),
                ),
              ),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 14,
            child: Text(l.scanning, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, shadows: [Shadow(blurRadius: 6)])),
          ),
        ]),
      ),
    );
  }
}

class _CornersPainter extends CustomPainter {
  _CornersPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size s) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    const m = 20.0, len = 34.0;
    for (final (x, y, dx, dy) in [(m, m, 1.0, 1.0), (s.width - m, m, -1.0, 1.0), (m, s.height - m, 1.0, -1.0), (s.width - m, s.height - m, -1.0, -1.0)]) {
      canvas.drawPath(Path()..moveTo(x, y + dy * len)..lineTo(x, y)..lineTo(x + dx * len, y), p);
    }
  }

  @override
  bool shouldRepaint(_CornersPainter old) => old.color != color;
}

/// Gold badge that flips in.
class _VerifiedBadge extends StatelessWidget {
  const _VerifiedBadge();

  @override
  Widget build(BuildContext context) {
    final badge = Container(
      key: const Key('verified-badge'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        gradient: const LinearGradient(colors: [Color(0xFFF7DB8C), Color(0xFFE9B949), Color(0xFFC99A2E)]),
        boxShadow: [BoxShadow(color: const Color(0xFFC99A2E).withValues(alpha: .4), blurRadius: 14, offset: const Offset(0, 6))],
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.verified, color: Color(0xFF4A3608), size: 20),
        const SizedBox(width: 6),
        Text(context.l10n.verifiedOnMilki, style: const TextStyle(color: Color(0xFF4A3608), fontWeight: FontWeight.w800)),
      ]),
    );
    if (reduceMotion(context)) return badge;
    return badge.animate().flipH(begin: -.5, end: 0, duration: 450.ms, curve: Curves.easeOutBack).fadeIn(duration: 150.ms);
  }
}

class _ParcelResultCard extends StatelessWidget {
  const _ParcelResultCard(this.v);
  final ParcelVerification v;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    Widget row(String k, Widget w) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            Expanded(flex: 2, child: Text(k, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant))),
            const SizedBox(width: 12),
            Expanded(flex: 3, child: w),
          ]),
        );
    Text t(String s) => Text(s, style: context.text.bodyMedium?.copyWith(fontWeight: FontWeight.w600));
    final warnings = [if (v.encumbered) l.warnEncumbered, if (v.disputed) l.warnDisputed];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Center(child: _VerifiedBadge()),
          const SizedBox(height: 12),
          Center(child: Text(l.verifiedParcelBody, textAlign: TextAlign.center, style: context.text.bodyMedium)),
          const Divider(height: 24),
          row(l.parcel, Text(v.parcelId, style: monoStyle(size: 14, weight: FontWeight.w600, color: context.colors.onSurface))),
          row(l.titleNumber, t(v.titleNumber)),
          row(l.owner, t(v.owner)),
          row(l.location, t('${v.ward}, ${v.district}, ${v.region}')),
          row(l.area, t(fmtArea(v.area))),
          row(l.status, Align(alignment: Alignment.centerLeft, child: StatusChip(status: v.status, small: true))),
          if (v.lastTxId.isNotEmpty) row(l.lastTransaction, MonoText(v.lastTxId, short: true, size: 12)),
          for (final w in warnings)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(children: [Icon(Icons.warning_amber_rounded, color: context.milki.earth, size: 18), const SizedBox(width: 6), Expanded(child: Text(w, style: context.text.bodyMedium))]),
            ),
        ]),
      ),
    );
  }
}

class _DocMatchCard extends StatelessWidget {
  const _DocMatchCard(this.v, this.sha256);
  final DocumentVerification v;
  final String sha256;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final reduce = reduceMotion(context);
    Widget check = Icon(Icons.check_circle, color: context.milki.success, size: 20);
    if (!reduce) check = check.animate().scale(delay: 400.ms, duration: 250.ms, curve: Curves.easeOutBack);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Center(child: _VerifiedBadge()),
          const SizedBox(height: 12),
          Center(child: Text(l.verifiedDocBody, textAlign: TextAlign.center, style: context.text.bodyMedium)),
          const Divider(height: 24),
          Text('${titleCase(v.documentType)} · ${v.documentId}', style: context.text.titleSmall),
          if (v.parcelId.isNotEmpty) Text('${l.parcel}: ${v.parcelId}', style: context.text.bodySmall),
          if (v.status == 'SUPERSEDED') Padding(padding: const EdgeInsets.only(top: 6), child: Text(l.supersededNote, style: context.text.bodyMedium?.copyWith(color: context.milki.earth))),
          const SizedBox(height: 12),
          Row(children: [
            check,
            const SizedBox(width: 8),
            Expanded(child: Text(shortHash(sha256, 16, 12), style: monoStyle(size: 12, color: context.colors.onSurface))),
          ]),
        ]),
      ),
    );
  }
}

class _WarningCard extends StatelessWidget {
  const _WarningCard({required this.title, required this.body});
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final earth = context.milki.earth;
    final card = Container(
      key: const Key('verify-warning'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: earth.withValues(alpha: .1), borderRadius: BorderRadius.circular(12), border: Border.all(color: earth, width: 1.5)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Icons.gpp_bad_outlined, color: earth, size: 28),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: context.text.titleMedium?.copyWith(color: earth)),
            const SizedBox(height: 4),
            Text(body, style: context.text.bodyMedium),
          ]),
        ),
      ]),
    );
    if (reduceMotion(context)) return card;
    return card.animate().shake(hz: 5, offset: const Offset(8, 0), duration: 450.ms);
  }
}
