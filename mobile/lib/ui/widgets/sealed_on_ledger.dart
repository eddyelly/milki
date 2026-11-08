import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/theme/milki_theme.dart';
import 'common.dart';

enum SealStage { submitting, endorsing, committed, failed }

/// "Sealed on the ledger" (CLAUDE.md §10.1): pulsing gold ring → chain links snapping together → gold seal stamp
/// with the block number and txId.
class SealedOnLedger extends StatelessWidget {
  const SealedOnLedger({super.key, required this.stage, this.txId, this.blockNumber, this.error});
  final SealStage stage;
  final String? txId;
  final int? blockNumber;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final reduce = reduceMotion(context);
    final m = context.milki;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      SizedBox(
        height: 150,
        child: Center(
          child: AnimatedSwitcher(
            duration: reduce ? Duration.zero : const Duration(milliseconds: 250),
            child: switch (stage) {
              SealStage.submitting => _Ring(key: const ValueKey('ring'), reduce: reduce),
              SealStage.endorsing => _Chain(key: const ValueKey('chain'), reduce: reduce),
              SealStage.committed => _Seal(key: const ValueKey('seal'), reduce: reduce, blockNumber: blockNumber),
              SealStage.failed => Icon(Icons.cancel_outlined, key: const ValueKey('failed'), size: 96, color: m.earth)
                  .animate(target: reduce ? 0 : 1)
                  .shake(hz: 5, offset: const Offset(8, 0), duration: 450.ms),
            },
          ),
        ),
      ),
      const SizedBox(height: 8),
      _Stages(stage: stage),
      const SizedBox(height: 14),
      SizedBox(
        height: 64,
        child: switch (stage) {
          SealStage.submitting => Text(l.submittingBody, textAlign: TextAlign.center, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
          SealStage.endorsing => Text(l.endorsingBody, textAlign: TextAlign.center, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
          SealStage.failed => Text(error ?? l.ledgerFailed, textAlign: TextAlign.center, style: context.text.bodyMedium?.copyWith(color: m.earth, fontWeight: FontWeight.w600)),
          SealStage.committed => Column(children: [
              Text(blockNumber == null ? l.committed : l.sealedInBlock(blockNumber!), style: context.text.titleSmall?.copyWith(color: context.colors.primary)),
              if (txId != null) ...[
                const SizedBox(height: 4),
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text('${l.transaction} ', style: context.text.bodySmall),
                  MonoText(txId!, short: true, size: 12),
                ]),
              ],
            ]).animate().fadeIn(delay: reduce ? 0.ms : 300.ms, duration: 250.ms),
        },
      ),
    ]);
  }
}

class _Stages extends StatelessWidget {
  const _Stages({required this.stage});
  final SealStage stage;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final labels = [l.submitting, l.endorsing, l.committed];
    final idx = switch (stage) { SealStage.submitting => 0, SealStage.endorsing => 1, SealStage.committed => 3, SealStage.failed => -1 };
    return Wrap(spacing: 6, alignment: WrapAlignment.center, children: [
      for (var i = 0; i < 3; i++)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            color: i < idx ? context.colors.primary.withValues(alpha: .12) : i == idx ? context.milki.gold.withValues(alpha: .18) : Colors.transparent,
            border: Border.all(color: i < idx ? context.colors.primary.withValues(alpha: .3) : i == idx ? context.milki.gold : context.milki.border),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (i < idx) Icon(Icons.check, size: 13, color: context.colors.primary),
            Text(labels[i], style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: i < idx ? context.colors.primary : i == idx ? context.milki.goldInk : context.colors.onSurfaceVariant)),
          ]),
        ),
    ]);
  }
}

class _Ring extends StatelessWidget {
  const _Ring({super.key, required this.reduce});
  final bool reduce;

  @override
  Widget build(BuildContext context) {
    final gold = context.milki.gold;
    final ring = Container(width: 96, height: 96, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: gold, width: 4)));
    if (reduce) return ring;
    return Stack(alignment: Alignment.center, children: [
      Container(width: 96, height: 96, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: gold, width: 2)))
          .animate(onPlay: (c) => c.repeat())
          .scale(begin: const Offset(.7, .7), end: const Offset(1.4, 1.4), duration: 1400.ms, curve: Curves.easeOut)
          .fadeOut(duration: 1400.ms),
      ring,
      Container(width: 12, height: 12, decoration: BoxDecoration(shape: BoxShape.circle, color: gold)),
    ]);
  }
}

class _Chain extends StatelessWidget {
  const _Chain({super.key, required this.reduce});
  final bool reduce;

  @override
  Widget build(BuildContext context) {
    Widget link(Color c) => Container(width: 64, height: 40, decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: c, width: 5)));
    final left = link(context.colors.primary);
    final right = link(context.milki.gold);
    return SizedBox(
      width: 140,
      height: 60,
      child: Stack(alignment: Alignment.center, children: [
        Positioned(left: 14, child: reduce ? left : left.animate().slideX(begin: -.5, end: 0, duration: 380.ms, curve: Curves.easeOutBack)),
        Positioned(right: 14, child: reduce ? right : right.animate().slideX(begin: .5, end: 0, duration: 380.ms, curve: Curves.easeOutBack)),
      ]),
    );
  }
}

class _Seal extends StatelessWidget {
  const _Seal({super.key, required this.reduce, this.blockNumber});
  final bool reduce;
  final int? blockNumber;

  @override
  Widget build(BuildContext context) {
    final seal = SizedBox(
      width: 128,
      height: 128,
      child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
        Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const RadialGradient(center: Alignment(-.3, -.4), colors: [Color(0xFFF7DB8C), Color(0xFFE9B949), Color(0xFFC99A2E)]),
            boxShadow: [BoxShadow(color: const Color(0xFFC99A2E).withValues(alpha: .55), blurRadius: 24, offset: const Offset(0, 10))],
          ),
        ),
        CustomPaint(size: const Size(128, 128), painter: _DashedCircle()),
        const Icon(Icons.verified, size: 52, color: Color(0xFF4A3608)),
        if (blockNumber != null)
          Positioned(
            bottom: -8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(color: context.milki.primaryDeep, borderRadius: BorderRadius.circular(999)),
              child: Text('#$blockNumber', style: monoStyle(size: 11, weight: FontWeight.w600, color: Colors.white)),
            ),
          ),
      ]),
    );
    if (reduce) return seal;
    return seal
        .animate()
        .scale(begin: const Offset(1.7, 1.7), end: const Offset(1, 1), duration: 380.ms, curve: Curves.easeOutBack)
        .rotate(begin: -0.04, end: 0, duration: 380.ms)
        .fadeIn(duration: 200.ms);
  }
}

class _DashedCircle extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..color = const Color(0xFF8A6514);
    const dashes = 60;
    for (var i = 0; i < dashes; i += 2) {
      canvas.drawArc(Rect.fromCircle(center: size.center(Offset.zero), radius: size.width / 2 - 8), i / dashes * 2 * math.pi, math.pi / dashes, false, p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
