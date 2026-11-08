import '../l10n/app_localizations.dart';

/// Client-side checks mirroring the API's Zod schemas (backend/src/modules/auth/auth.schema.ts).
String? requiredField(AppLocalizations l, String? v) => (v == null || v.trim().isEmpty) ? l.fieldRequired : null;

/// 0712 345 678 / 255712345678 / +255712345678 → +255712345678, or null if it isn't a Tanzanian mobile number.
String? normalizePhone(String raw) {
  var s = raw.replaceAll(RegExp(r'[\s()-]'), '');
  if (s.startsWith('0')) s = '+255${s.substring(1)}';
  if (s.startsWith('255')) s = '+$s';
  return RegExp(r'^\+255[67]\d{8}$').hasMatch(s) ? s : null;
}

String? validPhone(AppLocalizations l, String? v) => requiredField(l, v) ?? (normalizePhone(v!) == null ? l.invalidPhone : null);

String? validNida(AppLocalizations l, String? v) => requiredField(l, v) ?? (RegExp(r'^\d{20}$').hasMatch(v!.replaceAll(RegExp(r'[\s-]'), '')) ? null : l.invalidNida);

String? validPassword(AppLocalizations l, String? v) =>
    requiredField(l, v) ?? (v!.length >= 8 && RegExp(r'[A-Za-z]').hasMatch(v) && RegExp(r'\d').hasMatch(v) ? null : l.invalidPassword);
