import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Milki brand colours — the exact hex values from CLAUDE.md §9.1.
class MilkiColors {
  const MilkiColors._();

  // Light
  static const primary = Color(0xFF12805C); // Shamba Green
  static const primaryDeep = Color(0xFF0B4F3C);
  static const gold = Color(0xFFE9B949); // Hati Gold
  static const goldInk = Color(0xFF7A5A0E); // gold readable as text (AA)
  static const earth = Color(0xFFC2593A); // Udongo Terracotta
  static const ink = Color(0xFF0B1220);
  static const muted = Color(0xFF5B6474);
  static const surface = Color(0xFFF7F5EF); // warm paper
  static const card = Color(0xFFFFFFFF);
  static const border = Color(0xFFE4E0D5);
  static const success = Color(0xFF16A34A);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const info = Color(0xFF2563EB);

  // Dark
  static const primaryDark = Color(0xFF2BB585);
  static const primaryDeepDark = Color(0xFF0F3D30);
  static const goldDark = Color(0xFFF2C960);
  static const earthDark = Color(0xFFE07A5A);
  static const inkDark = Color(0xFFE8ECF2);
  static const mutedDark = Color(0xFF9AA3B2);
  static const surfaceDark = Color(0xFF0B1220);
  static const cardDark = Color(0xFF131B2C);
  static const borderDark = Color(0xFF243049);
  static const successDark = Color(0xFF4ADE80);
  static const warningDark = Color(0xFFFBBF24);
  static const dangerDark = Color(0xFFF87171);
  static const infoDark = Color(0xFF60A5FA);
}

/// Brand + status colours that Material's ColorScheme has no slot for (CLAUDE.md §9.1 "ThemeExtension").
@immutable
class MilkiPalette extends ThemeExtension<MilkiPalette> {
  const MilkiPalette({
    required this.primaryDeep,
    required this.gold,
    required this.goldInk,
    required this.earth,
    required this.muted,
    required this.border,
    required this.success,
    required this.warning,
    required this.danger,
    required this.info,
    required this.contour,
  });

  final Color primaryDeep;
  final Color gold;
  final Color goldInk;
  final Color earth;
  final Color muted;
  final Color border;
  final Color success;
  final Color warning;
  final Color danger;
  final Color info;
  final Color contour;

  // Status colours (§9.1): ACTIVE=primary, PENDING=gold, ENCUMBERED=info, DISPUTED=earth,
  // FROZEN/RETIRED=muted, COMPLETED=success, REJECTED/CANCELLED=danger.
  Color get statusPending => gold;
  Color get statusEncumbered => info;
  Color get statusDisputed => earth;
  Color get statusFrozen => muted;
  Color get statusCompleted => success;
  Color get statusRejected => danger;

  static const light = MilkiPalette(
    primaryDeep: MilkiColors.primaryDeep,
    gold: MilkiColors.gold,
    goldInk: MilkiColors.goldInk,
    earth: MilkiColors.earth,
    muted: MilkiColors.muted,
    border: MilkiColors.border,
    success: MilkiColors.success,
    warning: MilkiColors.warning,
    danger: MilkiColors.danger,
    info: MilkiColors.info,
    contour: Color(0x1F12805C),
  );

  static const dark = MilkiPalette(
    primaryDeep: MilkiColors.primaryDeepDark,
    gold: MilkiColors.goldDark,
    goldInk: MilkiColors.goldDark,
    earth: MilkiColors.earthDark,
    muted: MilkiColors.mutedDark,
    border: MilkiColors.borderDark,
    success: MilkiColors.successDark,
    warning: MilkiColors.warningDark,
    danger: MilkiColors.dangerDark,
    info: MilkiColors.infoDark,
    contour: Color(0x1A2BB585),
  );

  @override
  MilkiPalette copyWith({Color? gold, Color? earth}) => MilkiPalette(
        primaryDeep: primaryDeep,
        gold: gold ?? this.gold,
        goldInk: goldInk,
        earth: earth ?? this.earth,
        muted: muted,
        border: border,
        success: success,
        warning: warning,
        danger: danger,
        info: info,
        contour: contour,
      );

  @override
  MilkiPalette lerp(ThemeExtension<MilkiPalette>? other, double t) {
    if (other is! MilkiPalette) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return MilkiPalette(
      primaryDeep: l(primaryDeep, other.primaryDeep),
      gold: l(gold, other.gold),
      goldInk: l(goldInk, other.goldInk),
      earth: l(earth, other.earth),
      muted: l(muted, other.muted),
      border: l(border, other.border),
      success: l(success, other.success),
      warning: l(warning, other.warning),
      danger: l(danger, other.danger),
      info: l(info, other.info),
      contour: l(contour, other.contour),
    );
  }
}

extension MilkiThemeX on BuildContext {
  MilkiPalette get milki => Theme.of(this).extension<MilkiPalette>()!;
  ColorScheme get colors => Theme.of(this).colorScheme;
  TextTheme get text => Theme.of(this).textTheme;
}

/// JetBrains Mono for IDs, hashes and transaction IDs (§9.2).
/// JetBrains Mono ships Regular/Medium/SemiBold (assets/google_fonts), so heavier weights are capped at w600.
TextStyle monoStyle({double size = 13, FontWeight weight = FontWeight.w500, Color? color}) =>
    GoogleFonts.jetBrainsMono(fontSize: size, fontWeight: weight.value > 600 ? FontWeight.w600 : weight, color: color);

class MilkiTheme {
  const MilkiTheme._();

  /// §9.2 scale: 12 / 14 / 16 / 18 / 22 / 28 / 36, in Plus Jakarta Sans.
  /// (Built from GoogleFonts TextStyles: google_fonts 9's TextTheme helpers return material_ui types.)
  static TextTheme _text(Color ink, Color muted) {
    TextStyle s(double size, FontWeight w, [Color? c]) => GoogleFonts.plusJakartaSans(fontSize: size, fontWeight: w, color: c ?? ink, height: 1.35);
    return TextTheme(
      displaySmall: s(36, FontWeight.w700),
      headlineMedium: s(28, FontWeight.w700),
      headlineSmall: s(22, FontWeight.w700),
      titleLarge: s(22, FontWeight.w600),
      titleMedium: s(18, FontWeight.w600),
      titleSmall: s(16, FontWeight.w600),
      bodyLarge: s(16, FontWeight.w400),
      bodyMedium: s(14, FontWeight.w400),
      bodySmall: s(12, FontWeight.w400, muted),
      labelLarge: s(14, FontWeight.w600),
      labelMedium: s(12, FontWeight.w600),
      labelSmall: s(12, FontWeight.w500, muted),
    );
  }

  static ThemeData _build({required Brightness brightness, required MilkiPalette palette}) {
    final dark = brightness == Brightness.dark;
    final primary = dark ? MilkiColors.primaryDark : MilkiColors.primary;
    final ink = dark ? MilkiColors.inkDark : MilkiColors.ink;
    final muted = dark ? MilkiColors.mutedDark : MilkiColors.muted;
    final surface = dark ? MilkiColors.surfaceDark : MilkiColors.surface;
    final card = dark ? MilkiColors.cardDark : MilkiColors.card;
    final border = dark ? MilkiColors.borderDark : MilkiColors.border;

    final scheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: dark ? const Color(0xFF04140E) : Colors.white,
      primaryContainer: dark ? const Color(0xFF17302A) : const Color(0xFFE7F2EC),
      onPrimaryContainer: dark ? const Color(0xFFC9F0DF) : MilkiColors.primaryDeep,
      secondary: palette.gold,
      onSecondary: MilkiColors.ink,
      secondaryContainer: palette.gold.withValues(alpha: 0.18),
      onSecondaryContainer: palette.goldInk,
      tertiary: palette.earth,
      onTertiary: Colors.white,
      error: palette.danger,
      onError: Colors.white,
      surface: surface,
      onSurface: ink,
      onSurfaceVariant: muted,
      surfaceContainerLowest: card,
      surfaceContainerLow: card,
      surfaceContainer: card,
      surfaceContainerHigh: dark ? const Color(0xFF182134) : const Color(0xFFEFECE4),
      surfaceContainerHighest: dark ? const Color(0xFF1A2438) : const Color(0xFFEEF1EA),
      outline: border,
      outlineVariant: border,
      shadow: Colors.black,
      inverseSurface: ink,
      onInverseSurface: surface,
      inversePrimary: dark ? MilkiColors.primary : MilkiColors.primaryDark,
    );

    final radius10 = BorderRadius.circular(10);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: surface,
      textTheme: _text(ink, muted),
      extensions: [palette],
      // Cards 12, inputs/buttons 10, chips 999 (§9.3); soft shadows only on raised cards.
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: border)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        border: OutlineInputBorder(borderRadius: radius10, borderSide: BorderSide(color: border)),
        enabledBorder: OutlineInputBorder(borderRadius: radius10, borderSide: BorderSide(color: border)),
        focusedBorder: OutlineInputBorder(borderRadius: radius10, borderSide: BorderSide(color: primary, width: 2)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(64, 48), shape: RoundedRectangleBorder(borderRadius: radius10), // A theme textStyle replaces (not merges with) labelLarge, so it must name the brand font itself.
            textStyle: GoogleFonts.plusJakartaSans(fontSize: 14, fontWeight: FontWeight.w600)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(64, 48), shape: RoundedRectangleBorder(borderRadius: radius10), side: BorderSide(color: border)),
      ),
      chipTheme: ChipThemeData(shape: const StadiumBorder(), side: BorderSide(color: border)),
      appBarTheme: AppBarTheme(backgroundColor: surface, foregroundColor: ink, elevation: 0, scrolledUnderElevation: 0, centerTitle: false),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: card,
        indicatorColor: scheme.primaryContainer,
        labelTextStyle: WidgetStatePropertyAll(GoogleFonts.plusJakartaSans(fontSize: 12, fontWeight: FontWeight.w600, color: ink)),
      ),
      dividerTheme: DividerThemeData(color: border, space: 1),
      bottomSheetTheme: BottomSheetThemeData(backgroundColor: card, showDragHandle: true, shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20)))),
      snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, shape: RoundedRectangleBorder(borderRadius: radius10)),
    );
  }

  static ThemeData get light => _build(brightness: Brightness.light, palette: MilkiPalette.light);
  static ThemeData get dark => _build(brightness: Brightness.dark, palette: MilkiPalette.dark);
}
