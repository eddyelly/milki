import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/milki_theme.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';
import '../widgets/confirm_action.dart';

final deviceCredentialProvider = FutureProvider.autoDispose<bool>((ref) => ref.watch(authRepositoryProvider).hasDeviceCredential());

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  Future<void> _toggleBiometric(BuildContext context, WidgetRef ref, bool enable) async {
    final l = context.l10n;
    final auth = ref.read(authRepositoryProvider);
    if (!enable) {
      await auth.disableDevice();
      ref.invalidate(deviceCredentialProvider);
      return;
    }
    final password = TextEditingController();
    final ok = await showConfirmAction<bool>(
      context,
      tier: ConfirmTier.t1,
      title: l.enableBiometrics,
      consequences: [l.enableBiometricsBody],
      listen: password,
      canConfirm: () => password.text.isNotEmpty,
      extra: TextField(key: const Key('enroll-password'), controller: password, obscureText: true, decoration: InputDecoration(labelText: l.password)),
      onConfirm: (_) async {
        await auth.enrollDevice(password.text);
        return true;
      },
    );
    // Not disposed here: the sheet's exit animation still renders the field; it is collected with the sheet.
    ref.invalidate(deviceCredentialProvider);
    if (ok == true && context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.saved)));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final user = currentUserOf(ref.watch(sessionProvider));
    final settings = ref.watch(settingsProvider);
    final biometric = ref.watch(deviceCredentialProvider);
    final lang = settings.locale?.languageCode ?? Localizations.localeOf(context).languageCode;

    return Scaffold(
      appBar: AppBar(title: Text(l.settingsTitle)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (user != null)
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: CircleAvatar(radius: 24, backgroundColor: context.milki.gold.withValues(alpha: .25), child: Text(user.fullName.isEmpty ? '?' : user.fullName[0], style: TextStyle(color: context.milki.goldInk, fontWeight: FontWeight.w800, fontSize: 20))),
              title: Text(user.fullName, style: context.text.titleMedium),
              subtitle: Text([user.phone, ?user.nidaMasked].join(' · ')),
            ),
          ),
        const SizedBox(height: 16),
        Text(l.language, style: context.text.titleSmall),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: const [ButtonSegment(value: 'sw', label: Text('Kiswahili')), ButtonSegment(value: 'en', label: Text('English'))],
          selected: {lang},
          onSelectionChanged: (s) => ref.read(settingsProvider.notifier).setLocale(Locale(s.first)),
        ),
        const SizedBox(height: 16),
        Text(l.theme, style: context.text.titleSmall),
        const SizedBox(height: 8),
        SegmentedButton<ThemeMode>(
          showSelectedIcon: false,
          segments: [
            ButtonSegment(value: ThemeMode.system, icon: const Icon(Icons.brightness_auto_outlined), label: Text(l.themeSystem)),
            ButtonSegment(value: ThemeMode.light, icon: const Icon(Icons.light_mode_outlined), label: Text(l.themeLight)),
            ButtonSegment(value: ThemeMode.dark, icon: const Icon(Icons.dark_mode_outlined), label: Text(l.themeDark)),
          ],
          selected: {settings.themeMode},
          onSelectionChanged: (s) => ref.read(settingsProvider.notifier).setTheme(s.first),
        ),
        const SizedBox(height: 16),
        Card(
          child: SwitchListTile(
            key: const Key('biometric-switch'),
            secondary: Icon(Icons.fingerprint, color: context.colors.primary),
            title: Text(l.biometricConfirm),
            subtitle: Text(l.biometricConfirmBody),
            value: biometric.value ?? false,
            onChanged: biometric.isLoading ? null : (v) => _toggleBiometric(context, ref, v),
          ),
        ),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          key: const Key('sign-out'),
          style: OutlinedButton.styleFrom(foregroundColor: context.milki.danger),
          onPressed: () => ref.read(sessionProvider.notifier).signOut(),
          icon: const Icon(Icons.logout),
          label: Text(l.signOut),
        ),
      ]),
    );
  }
}
