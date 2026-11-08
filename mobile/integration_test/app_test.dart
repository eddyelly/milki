import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:milki_mobile/app.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/state/providers.dart';

/// End-to-end on a device/emulator against the running stack (API on :4100, Mailpit on :8126, seeded data):
///
///   flutter test integration_test/app_test.dart \
///     --dart-define=API_URL=http://10.0.2.2:4100/api/v1 --dart-define=MAILPIT_URL=http://10.0.2.2:8126
///
/// Signs in as the seeded citizen (password, then the SMS code read from Mailpit), opens a parcel straight from
/// the ledger, and verifies it through the public QR endpoint.
const mailpit = String.fromEnvironment('MAILPIT_URL', defaultValue: 'http://10.0.2.2:8126');
const phone = '+255712000001';

Future<String> latestOtp(DateTime after) async {
  final http = HttpClient();
  try {
    for (var i = 0; i < 30; i++) {
      final req = await http.getUrl(Uri.parse('$mailpit/api/v1/search?query=${Uri.encodeQueryComponent('to:"$phone@sms.milki.local"')}&limit=1'));
      final body = jsonDecode(await (await req.close()).transform(utf8.decoder).join()) as Map<String, dynamic>;
      final messages = (body['messages'] as List?) ?? const [];
      if (messages.isNotEmpty) {
        final m = messages.first as Map<String, dynamic>;
        if (DateTime.parse(m['Created'] as String).isAfter(after.subtract(const Duration(seconds: 2)))) {
          final code = RegExp(r'\b(\d{6})\b').firstMatch('${m['Snippet']} ${m['Subject']}')?.group(1);
          if (code != null) return code;
        }
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    throw StateError('No OTP arrived in Mailpit for $phone');
  } finally {
    http.close();
  }
}

Future<void> waitFor(WidgetTester tester, Finder f, {Duration timeout = const Duration(seconds: 30)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (f.evaluate().isNotEmpty) return;
  }
  throw TestFailure('Timed out waiting for $f');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('citizen signs in, opens a parcel from the ledger and verifies it', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        settingsProvider.overrideWith(() => SettingsController()),
        tokenStoreProvider.overrideWithValue(MemoryTokenStore()), // fresh session, nothing left on the device
      ],
      child: const MilkiApp(),
    ));
    await waitFor(tester, find.byKey(const Key('login-submit')));

    final started = DateTime.now().toUtc();
    await tester.enterText(find.byKey(const Key('login-identifier')), 'citizen@milki.dev');
    await tester.enterText(find.byKey(const Key('login-password')), 'Milki@2026');
    await tester.tap(find.byKey(const Key('login-submit')));
    await waitFor(tester, find.byKey(const Key('otp-field')));

    await tester.enterText(find.byKey(const Key('otp-field')), await latestOtp(started));
    await waitFor(tester, find.byKey(const Key('notifications-bell')));

    final card = find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('parcel-'));
    await waitFor(tester, card);
    final parcelId = (tester.widget(card.first).key! as ValueKey<String>).value.substring('parcel-'.length);
    await tester.tap(card.first);
    await waitFor(tester, find.byKey(const Key('share-proof')));
    expect(find.text(parcelId), findsWidgets);

    await tester.tap(find.text('Verify').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Type ID'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('verify-input')), 'milki:parcel:$parcelId');
    await tester.tap(find.byKey(const Key('verify-check')));
    await waitFor(tester, find.byKey(const Key('verified-badge')));
  });
}
