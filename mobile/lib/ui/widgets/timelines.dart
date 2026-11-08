import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import 'common.dart';

/// Transfer tracker (CLAUDE.md §10.3): the progress line fills between stages, the current stage breathes,
/// completed stages tick with a check-draw.
class TransferTracker extends StatelessWidget {
  const TransferTracker({super.key, required this.status, required this.history});
  final String status;
  final List<TransferStep> history;

  static const order = ['INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED', 'OFFICER_VERIFIED', 'COMPLETED'];

  /// Last reached happy-path step; for CANCELLED/REJECTED the step before it closed.
  static int reachedIndex(String status, List<TransferStep> history) {
    if (status == 'APPROVED' || status == 'COMPLETED') return order.length - 1;
    if (status == 'CANCELLED' || status == 'REJECTED') {
      final reached = history.map((h) => order.indexOf(h.status)).where((i) => i >= 0);
      return reached.isEmpty ? 0 : reached.reduce((a, b) => a > b ? a : b);
    }
    return order.indexOf(status).clamp(0, order.length - 1);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final labels = [l.stepInitiated, l.stepAccepted, l.stepPayments, l.stepVerified, l.stepRecorded];
    final idx = reachedIndex(status, history);
    final closed = status == 'CANCELLED' || status == 'REJECTED';
    final done = status == 'COMPLETED' || status == 'APPROVED';
    final reduce = reduceMotion(context);
    final primary = context.colors.primary;

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (var i = 0; i < order.length; i++)
        _StepRow(
          index: i,
          label: labels[i],
          date: history.where((h) => h.status == order[i]).map((h) => h.at).firstOrNull,
          complete: i < idx || (i == idx && done),
          current: i == idx && !done && !closed,
          stopped: closed && i == idx + 1,
          last: i == order.length - 1,
          lineFilled: i < idx,
          reduce: reduce,
          color: closed ? context.milki.danger : primary,
        ),
      if (closed)
        Container(
          margin: const EdgeInsets.only(top: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: context.milki.danger.withValues(alpha: .1), borderRadius: BorderRadius.circular(10)),
          child: Text(status == 'CANCELLED' ? l.closedCancelled : l.closedRejected, style: TextStyle(color: context.milki.danger, fontWeight: FontWeight.w600)),
        ),
    ]);
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({
    required this.index,
    required this.label,
    required this.date,
    required this.complete,
    required this.current,
    required this.stopped,
    required this.last,
    required this.lineFilled,
    required this.reduce,
    required this.color,
  });
  final int index;
  final String label;
  final DateTime? date;
  final bool complete;
  final bool current;
  final bool stopped;
  final bool last;
  final bool lineFilled;
  final bool reduce;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final m = context.milki;
    Widget dot = Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: complete ? color : context.colors.surfaceContainerLowest,
        border: Border.all(color: complete ? color : current ? m.gold : stopped ? m.danger : m.border, width: 2),
      ),
      child: complete
          ? _CheckDraw(color: context.colors.onPrimary, delay: reduce ? Duration.zero : Duration(milliseconds: 120 + index * 90), animate: !reduce)
          : stopped
              ? Icon(Icons.block, size: 16, color: m.danger)
              : Text('${index + 1}', style: TextStyle(fontWeight: FontWeight.w700, color: current ? m.goldInk : context.colors.onSurfaceVariant)),
    );
    if (current && !reduce) {
      dot = dot.animate(onPlay: (c) => c.repeat(reverse: true)).scale(begin: const Offset(1, 1), end: const Offset(1.08, 1.08), duration: 1100.ms, curve: Curves.easeInOut);
    }
    final l = context.l10n;
    final state = complete ? ', ${l.stepDone}' : current ? ', ${l.stepCurrent}' : '';
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: '$label$state${date != null ? ', ${fmtDate(date)}' : ''}',
      child: IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(
            width: 34,
            child: Column(children: [
              dot,
              if (!last)
                Expanded(
                  child: Container(
                    width: 3,
                    margin: const EdgeInsets.symmetric(vertical: 2),
                    color: m.border,
                    alignment: Alignment.topCenter,
                    child: lineFilled
                        ? (reduce
                            ? Container(color: color)
                            : Container(color: color).animate().custom(
                                  duration: 450.ms,
                                  delay: (index * 90).ms,
                                  curve: Curves.easeOut,
                                  // Scale rather than FractionallySizedBox: a 0 height factor has infinite intrinsic height under IntrinsicHeight.
                                  builder: (_, v, child) => Transform.scale(scaleX: 1, scaleY: v, alignment: Alignment.topCenter, child: child),
                                ))
                        : null,
                  ),
                ),
            ]),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(top: 6, bottom: last ? 0 : 22),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: context.text.titleSmall?.copyWith(color: complete || current ? null : context.colors.onSurfaceVariant)),
                if (date != null) Text(fmtDate(date), style: context.text.bodySmall),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Check-mark that draws itself (path length 0 → 1).
class _CheckDraw extends StatelessWidget {
  const _CheckDraw({required this.color, required this.delay, required this.animate});
  final Color color;
  final Duration delay;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    if (!animate) return CustomPaint(size: const Size(16, 16), painter: _CheckPainter(color, 1));
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 320) + delay,
      curve: Interval(delay.inMilliseconds / (320 + delay.inMilliseconds), 1, curve: Curves.easeOut),
      builder: (_, v, _) => CustomPaint(size: const Size(16, 16), painter: _CheckPainter(color, v)),
    );
  }
}

class _CheckPainter extends CustomPainter {
  _CheckPainter(this.color, this.progress);
  final Color color;
  final double progress;

  @override
  void paint(Canvas canvas, Size s) {
    final path = Path()
      ..moveTo(s.width * .18, s.height * .52)
      ..lineTo(s.width * .42, s.height * .76)
      ..lineTo(s.width * .84, s.height * .26);
    final metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * progress),
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_CheckPainter old) => old.progress != progress;
}

/// Ownership history chain (CLAUDE.md §10.2): the line draws downward, nodes pop in with a stagger, tap expands.
class OwnershipChain extends StatefulWidget {
  const OwnershipChain({super.key, required this.entries});
  final List<HistoryEntry> entries;

  @override
  State<OwnershipChain> createState() => _OwnershipChainState();
}

class _OwnershipChainState extends State<OwnershipChain> {
  String? _open;

  @override
  Widget build(BuildContext context) {
    final items = widget.entries.reversed.toList(); // newest first
    final reduce = reduceMotion(context);
    final m = context.milki;
    final l = context.l10n;
    return Column(children: [
      for (var i = 0; i < items.length; i++)
        Builder(builder: (context) {
          final e = items[i];
          final prev = i + 1 < items.length ? items[i + 1] : null;
          final ownerChanged = prev == null || prev.ownerId != e.ownerId;
          final first = i == items.length - 1;
          final expanded = _open == e.txId;
          Widget row = IntrinsicHeight(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SizedBox(
                width: 22,
                child: Column(children: [
                  const SizedBox(height: 14),
                  Container(
                    width: 18,
                    height: 18,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: context.colors.surfaceContainerLowest, border: Border.all(color: ownerChanged ? m.gold : context.colors.primary, width: 2)),
                    child: ownerChanged ? Center(child: Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: m.gold))) : Icon(Icons.link, size: 11, color: context.colors.primary),
                  ),
                  if (i < items.length - 1) Expanded(child: Container(width: 2, color: context.colors.primary.withValues(alpha: .35))),
                ]),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Card(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => setState(() => _open = expanded ? null : e.txId),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            if (e.status != null) StatusChip(status: e.status!, small: true),
                            const Spacer(),
                            Text(fmtDate(e.timestamp), style: context.text.bodySmall),
                            Icon(expanded ? Icons.expand_less : Icons.expand_more, size: 18, color: context.colors.onSurfaceVariant),
                          ]),
                          if (ownerChanged) ...[
                            const SizedBox(height: 6),
                            Text(first ? l.registeredTo('v${e.ownershipVersion ?? 1}') : '${l.ownerChanged} · v${e.ownershipVersion ?? ''}', style: context.text.titleSmall),
                          ],
                          if (e.note != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('“${e.note}”', style: context.text.bodyMedium)),
                          AnimatedSize(
                            duration: reduce ? Duration.zero : const Duration(milliseconds: 200),
                            child: expanded
                                ? Padding(
                                    padding: const EdgeInsets.only(top: 8),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text(l.transaction, style: context.text.bodySmall),
                                      MonoText(e.txId, short: true, copyable: true, size: 12),
                                      if (e.changedByMsp != null) Text('${titleCase(e.changedByRole ?? '')} · ${e.changedByMsp}', style: context.text.bodySmall),
                                    ]),
                                  )
                                : const SizedBox(width: double.infinity),
                          ),
                        ]),
                      ),
                    ),
                  ),
                ),
              ),
            ]),
          );
          if (!reduce) row = row.animate().fadeIn(delay: (i.clamp(0, 8) * 70).ms, duration: 250.ms).scale(begin: const Offset(.96, .96), curve: Curves.easeOut);
          return row;
        }),
    ]);
  }
}
