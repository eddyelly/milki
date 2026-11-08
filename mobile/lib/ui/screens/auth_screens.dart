import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import '../../state/providers.dart';
import '../validators.dart';
import '../widgets/common.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: context.milki.primaryDeep,
        body: Stack(children: [
          TopoBackground(color: Colors.white.withValues(alpha: .08)),
          const Center(child: MilkiMark(size: 72, light: true)),
        ]),
      );
}

/// Brand mark: gold seal with a contour "M".
class MilkiMark extends StatelessWidget {
  const MilkiMark({super.key, this.size = 48, this.light = false, this.showName = true});
  final double size;
  final bool light;
  final bool showName;

  @override
  Widget build(BuildContext context) {
    final mark = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const RadialGradient(center: Alignment(-.3, -.4), colors: [Color(0xFFF7DB8C), Color(0xFFE9B949), Color(0xFFC99A2E)]),
        boxShadow: [BoxShadow(color: const Color(0xFFC99A2E).withValues(alpha: .4), blurRadius: size / 4, offset: Offset(0, size / 12))],
      ),
      alignment: Alignment.center,
      child: Text('M', style: TextStyle(fontSize: size * .5, fontWeight: FontWeight.w800, color: const Color(0xFF4A3608), height: 1)),
    );
    if (!showName) return mark;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      mark,
      SizedBox(height: size / 5),
      Text(context.l10n.appName, style: context.text.headlineMedium?.copyWith(color: light ? Colors.white : null, fontWeight: FontWeight.w800)),
      Text(context.l10n.tagline, style: context.text.bodyMedium?.copyWith(color: light ? Colors.white70 : context.colors.onSurfaceVariant)),
    ]);
  }
}

/// Shared frame for the sign-in flow: a deep-green hero with drifting contour lines (CLAUDE.md §10.7).
class _AuthFrame extends StatelessWidget {
  const _AuthFrame({required this.child, this.showBack = false});
  final Widget child;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.milki.primaryDeep,
      body: Stack(children: [
        Positioned.fill(child: TopoBackground(color: Colors.white.withValues(alpha: .09))),
        SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(children: [
                  if (showBack)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: IconButton(
                        tooltip: context.l10n.back,
                        color: Colors.white,
                        icon: const Icon(Icons.arrow_back),
                        onPressed: () => context.canPop() ? context.pop() : context.go('/login'),
                      ),
                    ),
                  const MilkiMark(size: 56, light: true),
                  const SizedBox(height: 24),
                  Card(child: Padding(padding: const EdgeInsets.all(20), child: child)),
                ]),
              ),
            ),
          ),
        ),
      ]),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    final danger = context.milki.danger;
    return Container(
      key: const Key('auth-error'),
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: danger.withValues(alpha: .1), borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        Icon(Icons.error_outline, color: danger, size: 18),
        const SizedBox(width: 8),
        Expanded(child: Text(message, style: TextStyle(color: danger, fontWeight: FontWeight.w600))),
      ]),
    ).animate(target: reduceMotion(context) ? 0 : 1).shake(hz: 4, offset: const Offset(4, 0), duration: 300.ms);
  }
}

Widget _spinner() => const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white));

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _id = TextEditingController();
  final _password = TextEditingController();
  bool _pending = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _id.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _pending = true;
      _error = null;
    });
    try {
      final challenge = await ref.read(authRepositoryProvider).login(_id.text.trim(), _password.text);
      if (mounted) unawaited(context.push('/otp', extra: challenge));
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _pending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final session = ref.watch(sessionProvider);
    final expired = session is SignedOut && session.expired;
    return _AuthFrame(
      child: Form(
        key: _form,
        child: AutofillGroup(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.signInTitle, style: context.text.headlineSmall),
            const SizedBox(height: 4),
            Text(l.signInSubtitle, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
            const SizedBox(height: 20),
            if (expired && _error == null) _ErrorBanner(l.sessionExpired),
            if (_error != null) _ErrorBanner(_error!),
            TextFormField(
              key: const Key('login-identifier'),
              controller: _id,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.telephoneNumber, AutofillHints.email],
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: l.phoneOrEmail, prefixIcon: const Icon(Icons.person_outline)),
              validator: (v) => requiredField(l, v),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const Key('login-password'),
              controller: _password,
              obscureText: _obscure,
              autofillHints: const [AutofillHints.password],
              onFieldSubmitted: (_) => _pending ? null : _submit(),
              decoration: InputDecoration(
                labelText: l.password,
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => _obscure = !_obscure)),
              ),
              validator: (v) => requiredField(l, v),
            ),
            const SizedBox(height: 20),
            FilledButton(key: const Key('login-submit'), onPressed: _pending ? null : _submit, child: _pending ? _spinner() : Text(l.continueAction)),
            const SizedBox(height: 8),
            TextButton(onPressed: () => context.push('/register'), child: Text(l.createAccount)),
            const Divider(height: 24),
            OutlinedButton.icon(onPressed: () => context.push('/check'), icon: const Icon(Icons.qr_code_scanner), label: Text(l.quickVerify)),
          ]),
        ),
      ),
    );
  }
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _nida = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String _language = 'sw';
  bool _pending = false;
  String? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _language = Localizations.localeOf(context).languageCode == 'en' ? 'en' : 'sw';
  }

  @override
  void dispose() {
    for (final c in [_name, _phone, _nida, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _pending = true;
      _error = null;
    });
    try {
      final challenge = await ref.read(authRepositoryProvider).register(
            fullName: _name.text.trim(),
            phone: _phone.text.trim(),
            nida: _nida.text.trim(),
            email: _email.text.trim(),
            password: _password.text,
            language: _language,
          );
      ref.read(settingsProvider.notifier).setLocale(Locale(_language));
      if (mounted) unawaited(context.push('/otp', extra: challenge));
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _pending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return _AuthFrame(
      showBack: true,
      child: Form(
        key: _form,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(l.registerTitle, style: context.text.headlineSmall),
          const SizedBox(height: 20),
          if (_error != null) _ErrorBanner(_error!),
          TextFormField(
            key: const Key('register-name'),
            controller: _name,
            textCapitalization: TextCapitalization.words,
            autofillHints: const [AutofillHints.name],
            decoration: InputDecoration(labelText: l.fullName),
            validator: (v) => requiredField(l, v),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('register-phone'),
            controller: _phone,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumber],
            decoration: InputDecoration(labelText: l.phone, hintText: '0712 345 678'),
            validator: (v) => validPhone(l, v),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('register-nida'),
            controller: _nida,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l.nida, hintText: '19900101-12345-00001-01'),
            validator: (v) => validNida(l, v),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: InputDecoration(labelText: l.emailOptional),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('register-password'),
            controller: _password,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: InputDecoration(labelText: l.password, helperText: l.passwordHint),
            validator: (v) => validPassword(l, v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _language,
            decoration: InputDecoration(labelText: l.language),
            items: const [DropdownMenuItem(value: 'sw', child: Text('Kiswahili')), DropdownMenuItem(value: 'en', child: Text('English'))],
            onChanged: (v) => setState(() => _language = v ?? 'sw'),
          ),
          const SizedBox(height: 20),
          FilledButton(key: const Key('register-submit'), onPressed: _pending ? null : _submit, child: _pending ? _spinner() : Text(l.continueAction)),
          TextButton(onPressed: () => context.go('/login'), child: Text(l.haveAccount)),
        ]),
      ),
    );
  }
}

class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, required this.challenge});
  final OtpChallenge challenge;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  late OtpChallenge _challenge = widget.challenge;
  String _code = '';
  bool _pending = false;
  String? _error;
  int _cooldown = 30;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startCooldown();
  }

  void _startCooldown() {
    _timer?.cancel();
    setState(() => _cooldown = 30);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_cooldown <= 1) t.cancel();
      if (mounted) setState(() => _cooldown--);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _verify([String? code]) async {
    final value = code ?? _code;
    if (value.length != 6 || _pending) return;
    setState(() {
      _pending = true;
      _error = null;
    });
    final auth = ref.read(authRepositoryProvider);
    try {
      final user = await auth.verifyOtp(_challenge.challengeId, value);
      if (user.role != 'CITIZEN') {
        // The mobile app is the landowner client; staff use the web portal (CLAUDE.md §2).
        await auth.logout();
        setState(() => _error = context.l10n.staffUseWeb);
        return;
      }
      ref.read(sessionProvider.notifier).signedIn(user);
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _pending = false);
    }
  }

  Future<void> _resend() async {
    try {
      final c = await ref.read(authRepositoryProvider).resend(_challenge.challengeId);
      setState(() {
        _challenge = c;
        _error = null;
      });
      _startCooldown();
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return _AuthFrame(
      showBack: true,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(l.otpTitle, style: context.text.headlineSmall),
        const SizedBox(height: 4),
        Text(l.otpSentTo(_challenge.sentTo), style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
        const SizedBox(height: 20),
        if (_error != null) _ErrorBanner(_error!),
        OtpInput(
          enabled: !_pending,
          onChanged: (v) => setState(() => _code = v),
          onCompleted: _verify,
        ),
        const SizedBox(height: 20),
        FilledButton(key: const Key('otp-submit'), onPressed: _code.length == 6 && !_pending ? _verify : null, child: _pending ? _spinner() : Text(l.verifyAndContinue)),
        const SizedBox(height: 8),
        TextButton(onPressed: _cooldown > 0 ? null : _resend, child: Text(_cooldown > 0 ? l.resendIn(_cooldown) : l.resendCode)),
      ]),
    );
  }
}
