import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/milki_theme.dart';
import '../../l10n/app_localizations.dart';

/// Reduced motion (CLAUDE.md §10): every animation checks this.
bool reduceMotion(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

extension L10nX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}

String fmtArea(num sqm) => sqm >= 10000 ? '${NumberFormat('#,##0.##').format(sqm / 10000)} ha' : '${NumberFormat('#,##0.#').format(sqm)} m²';
String fmtMoney(num v, [String currency = 'TZS']) => '${currency == 'TZS' ? 'TSh' : currency} ${NumberFormat('#,##0').format(v)}';
String fmtDate(DateTime? d, [String? locale]) => d == null ? '-' : DateFormat.yMMMd(locale).format(d);
String shortHash(String h, [int head = 8, int tail = 6]) => h.length <= head + tail + 1 ? h : '${h.substring(0, head)}…${h.substring(h.length - tail)}';
String titleCase(String s) => s.toLowerCase().split('_').map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}').join(' ');

/// Status chip: colour + icon + label, never colour alone (CLAUDE.md §9.1).
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.status, this.small = false});
  final String status;
  final bool small;

  static ({IconData icon, Color color, Color ink, String label}) meta(BuildContext context, String status) {
    final m = context.milki;
    final l = context.l10n;
    final primary = context.colors.primary;
    return switch (status) {
      'ACTIVE' => (icon: Icons.verified_user_outlined, color: primary, ink: primary, label: l.statusActive),
      'PENDING_TRANSFER' => (icon: Icons.sync_alt, color: m.gold, ink: m.goldInk, label: l.statusPendingTransfer),
      'ENCUMBERED' => (icon: Icons.account_balance_outlined, color: m.info, ink: m.info, label: l.statusEncumbered),
      'DISPUTED' => (icon: Icons.warning_amber_rounded, color: m.earth, ink: m.earth, label: l.statusDisputed),
      'FROZEN' => (icon: Icons.ac_unit, color: m.muted, ink: m.muted, label: l.statusFrozen),
      'RETIRED' => (icon: Icons.inventory_2_outlined, color: m.muted, ink: m.muted, label: l.statusRetired),
      'INITIATED' => (icon: Icons.send_outlined, color: m.gold, ink: m.goldInk, label: l.statusInitiated),
      'BUYER_ACCEPTED' => (icon: Icons.handshake_outlined, color: m.gold, ink: m.goldInk, label: l.statusBuyerAccepted),
      'PAYMENTS_CONFIRMED' => (icon: Icons.receipt_long_outlined, color: m.info, ink: m.info, label: l.statusPaymentsConfirmed),
      'OFFICER_VERIFIED' => (icon: Icons.fact_check_outlined, color: primary, ink: primary, label: l.statusOfficerVerified),
      'APPROVED' => (icon: Icons.approval_outlined, color: primary, ink: primary, label: l.statusApproved),
      'COMPLETED' => (icon: Icons.check_circle_outline, color: m.success, ink: m.success, label: l.statusCompleted),
      'CANCELLED' => (icon: Icons.cancel_outlined, color: m.danger, ink: m.danger, label: l.statusCancelled),
      'REJECTED' => (icon: Icons.block, color: m.danger, ink: m.danger, label: l.statusRejected),
      _ => (icon: Icons.help_outline, color: m.muted, ink: m.muted, label: titleCase(status)),
    };
  }

  @override
  Widget build(BuildContext context) {
    final x = meta(context, status);
    return Semantics(
      label: x.label,
      container: true,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: small ? 8 : 10, vertical: small ? 3 : 5),
        decoration: BoxDecoration(
          color: x.color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: x.color.withValues(alpha: 0.3)),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(x.icon, size: small ? 13 : 15, color: x.ink),
          const SizedBox(width: 5),
          Text(x.label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: x.ink)),
        ]),
      ),
    );
  }
}

/// Monospace ID / hash with copy.
class MonoText extends StatelessWidget {
  const MonoText(this.value, {super.key, this.short = false, this.size = 13, this.copyable = false});
  final String value;
  final bool short;
  final double size;
  final bool copyable;

  @override
  Widget build(BuildContext context) {
    final text = Text(short ? shortHash(value) : value, overflow: TextOverflow.ellipsis, style: monoStyle(size: size, color: context.colors.onSurface));
    if (!copyable) return text;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Flexible(child: text),
      IconButton(
        visualDensity: VisualDensity.compact,
        iconSize: 16,
        tooltip: context.l10n.copy,
        icon: const Icon(Icons.copy_rounded),
        onPressed: () async {
          await Clipboard.setData(ClipboardData(text: value));
          if (context.mounted) ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(context.l10n.copied), duration: const Duration(seconds: 2)));
        },
      ),
    ]);
  }
}

/// Skeleton shimmer while loading (§10.8).
class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.height = 72, this.width = double.infinity});
  final double height;
  final double width;

  @override
  Widget build(BuildContext context) {
    final base = context.colors.surfaceContainerHigh;
    final box = Container(height: height, width: width, decoration: BoxDecoration(color: base, borderRadius: BorderRadius.circular(12)));
    if (reduceMotion(context)) return box;
    return Shimmer.fromColors(baseColor: base, highlightColor: context.colors.surfaceContainerLowest, child: box);
  }
}

class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 4, this.height = 84});
  final int count;
  final double height;

  @override
  Widget build(BuildContext context) => ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: count,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (_, _) => SkeletonBox(height: height),
      );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body, this.action});
  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            CircleAvatar(radius: 28, backgroundColor: context.colors.surfaceContainerHigh, child: Icon(icon, color: context.colors.onSurfaceVariant)),
            const SizedBox(height: 16),
            Text(title, style: context.text.titleSmall, textAlign: TextAlign.center),
            if (body != null) ...[const SizedBox(height: 6), Text(body!, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant), textAlign: TextAlign.center)],
            if (action != null) ...[const SizedBox(height: 16), action!],
          ]),
        ),
      );
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is ApiException ? (error as ApiException).message : context.l10n.loadError;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.error_outline, size: 40, color: context.colors.error),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center, style: context.text.bodyLarge),
          const SizedBox(height: 16),
          OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(context.l10n.tryAgain)),
        ]),
      ),
    );
  }
}

/// Slow-drifting topographic contours (§9 motif, §10.7 auth background).
class TopoBackground extends StatefulWidget {
  const TopoBackground({super.key, this.color});
  final Color? color;

  @override
  State<TopoBackground> createState() => _TopoBackgroundState();
}

class _TopoBackgroundState extends State<TopoBackground> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 60));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (reduceMotion(context)) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RepaintBoundary(
        child: AnimatedBuilder(
          animation: _c,
          builder: (_, _) => CustomPaint(painter: _TopoPainter(widget.color ?? context.milki.contour, _c.value), size: Size.infinite),
        ),
      );
}

class _TopoPainter extends CustomPainter {
  _TopoPainter(this.color, this.t);
  final Color color;
  final double t;

  static const _hills = [(0.25, 0.22, 9, 0.4), (0.8, 0.7, 11, 1.9), (0.95, 0.12, 7, 3.1)];

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..color = color;
    final scale = size.shortestSide / 400;
    canvas.translate(-18 * t * scale, 9 * t * scale);
    for (final (fx, fy, rings, phase) in _hills) {
      for (var i = 0; i < rings; i++) {
        p.strokeWidth = i % 4 == 0 ? 1.6 : 1;
        final path = Path();
        final r = (14 + i * 13) * scale;
        for (var k = 0; k <= 48; k++) {
          final a = k / 48 * math.pi * 2;
          final w = (4 + i) * scale;
          final rr = r + math.sin(a * 3 + phase + i * .35) * w + math.cos(a * 5 + phase * 1.7) * w * .5;
          final o = Offset(size.width * fx + math.cos(a) * rr * 1.25, size.height * fy + math.sin(a) * rr);
          k == 0 ? path.moveTo(o.dx, o.dy) : path.lineTo(o.dx, o.dy);
        }
        canvas.drawPath(path..close(), p);
      }
    }
  }

  @override
  bool shouldRepaint(_TopoPainter old) => old.t != t || old.color != color;
}

/// Six OTP boxes; each bounces as a digit lands (§10.7).
class OtpInput extends StatefulWidget {
  const OtpInput({super.key, required this.onCompleted, this.onChanged, this.enabled = true});
  final ValueChanged<String> onCompleted;
  final ValueChanged<String>? onChanged;
  final bool enabled;

  @override
  State<OtpInput> createState() => _OtpInputState();
}

class _OtpInputState extends State<OtpInput> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final value = _controller.text;
    final reduce = reduceMotion(context);
    return Stack(children: [
      // One hidden field receives input (including SMS autofill and paste); the boxes render it.
      Opacity(
        opacity: 0,
        child: TextField(
          key: const Key('otp-field'),
          controller: _controller,
          focusNode: _focus,
          enabled: widget.enabled,
          autofocus: true,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          onChanged: (v) {
            setState(() {});
            widget.onChanged?.call(v);
            if (v.length == 6) widget.onCompleted(v);
          },
        ),
      ),
      GestureDetector(
        onTap: () => _focus.requestFocus(),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(6, (i) {
            final d = i < value.length ? value[i] : '';
            final box = Container(
              constraints: const BoxConstraints(maxWidth: 46),
              height: 54,
              margin: const EdgeInsets.symmetric(horizontal: 4),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: context.colors.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: d.isNotEmpty || i == value.length ? context.colors.primary : context.milki.border, width: i == value.length ? 2 : 1),
              ),
              child: Text(d, style: monoStyle(size: 22, weight: FontWeight.w600, color: context.colors.onSurface)),
            );
            // Flexible: six boxes shrink to fit narrow screens instead of overflowing.
            if (d.isEmpty || reduce) return Flexible(child: box);
            return Flexible(
              child: box.animate(key: ValueKey('$i$d')).scale(begin: const Offset(1, 1), end: const Offset(1.12, 1.12), duration: 110.ms, curve: Curves.easeOut).then().scale(begin: const Offset(1.12, 1.12), end: const Offset(1, 1), duration: 160.ms),
            );
          }),
        ),
      ),
    ]);
  }
}

/// Press micro-interaction: 0.97 scale (§10.8).
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onTap});
  final Widget child;
  final VoidCallback? onTap;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTapDown: (_) => setState(() => _down = true),
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: widget.onTap,
        child: AnimatedScale(scale: _down && !reduceMotion(context) ? 0.97 : 1, duration: const Duration(milliseconds: 120), curve: Curves.easeOut, child: widget.child),
      );
}
