import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/core/api/api_client.dart';
import 'package:milki_mobile/data/models.dart';
import 'package:milki_mobile/state/providers.dart';
import 'package:milki_mobile/ui/widgets/confirm_action.dart';

import 'support/fakes.dart';

/// A button that opens the helper and records what it returned.
class _Launcher<T> extends ConsumerWidget {
  const _Launcher(this.open, this.onResult);
  final Future<T?> Function(BuildContext) open;
  final void Function(T?) onResult;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Center(child: FilledButton(key: const Key('open'), onPressed: () async => onResult(await open(context)), child: const Text('open')));
}

void main() {
  setUpAll(setUpFonts);
  late FakeReauth reauth;
  late FakeLedgerEvents ledger;

  setUp(() {
    reauth = FakeReauth();
    ledger = FakeLedgerEvents(block: 42);
  });

  Future<void> pump<T>(WidgetTester tester, Future<T?> Function(BuildContext) open, void Function(T?) onResult) async {
    await tester.pumpWidget(testApp(
      _Launcher<T>(open, onResult),
      overrides: [reauthenticatorProvider.overrideWithValue(reauth), ledgerEventsProvider.overrideWithValue(ledger)],
    ));
    await tester.tap(find.byKey(const Key('open')));
    await tester.pumpAndSettle();
  }

  testWidgets('T1 shows the summary, confirms and returns the result', (tester) async {
    String? result;
    String? key;
    await pump<String>(
      tester,
      (c) => showConfirmAction<String>(c, tier: ConfirmTier.t1, title: 'Save profile?', impact: const [('Name', 'Asha')], onConfirm: (ctx) async {
        key = ctx.idempotencyKey;
        return 'ok';
      }),
      (r) => result = r,
    );
    expect(find.text('Save profile?'), findsOneWidget);
    expect(find.text('Asha'), findsOneWidget);
    await tester.tap(find.byKey(const Key('confirm-submit')));
    await tester.pumpAndSettle();
    expect(result, 'ok');
    expect(key, isNotNull);
    expect(find.text('Save profile?'), findsNothing);
  });

  testWidgets('T1 cancel returns null without calling the action', (tester) async {
    var called = false;
    var closed = false;
    await pump<String>(tester, (c) => showConfirmAction<String>(c, tier: ConfirmTier.t1, title: 'Save?', onConfirm: (_) async {
          called = true;
          return 'x';
        }), (r) => closed = r == null);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(called, isFalse);
    expect(closed, isTrue);
  });

  testWidgets('T2 stays disabled until the identifier is typed exactly', (tester) async {
    var done = false;
    await pump<bool>(tester, (c) => showConfirmAction<bool>(c, tier: ConfirmTier.t2, title: 'Revoke key?', typeToConfirm: 'REVOKE', onConfirm: (_) async => true), (r) => done = r ?? false);
    FilledButton submit() => tester.widget<FilledButton>(find.byKey(const Key('confirm-submit')));
    expect(submit().onPressed, isNull);
    await tester.enterText(find.byKey(const Key('type-to-confirm')), 'revoke');
    await tester.pump();
    expect(submit().onPressed, isNull);
    await tester.enterText(find.byKey(const Key('type-to-confirm')), 'REVOKE');
    await tester.pump();
    expect(submit().onPressed, isNotNull);
    await tester.tap(find.byKey(const Key('confirm-submit')));
    await tester.pumpAndSettle();
    expect(done, isTrue);
  });

  testWidgets('a failed T1 action shows the server message and keeps the sheet open', (tester) async {
    await pump<bool>(tester, (c) => showConfirmAction<bool>(c, tier: ConfirmTier.t1, title: 'Delete?', onConfirm: (_) async => throw ApiException(409, 'CONFLICT', 'Already deleted.')), (_) {});
    await tester.tap(find.byKey(const Key('confirm-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Already deleted.'), findsOneWidget);
    expect(find.text('Delete?'), findsOneWidget);
  });

  testWidgets('T3: impact review → password re-auth → sealed in block with txId', (tester) async {
    Submitted? result;
    ConfirmContext? seen;
    await pump<Submitted>(
      tester,
      (c) => showConfirmAction<Submitted>(
        c,
        tier: ConfirmTier.t3,
        title: 'Review transfer',
        impactSentence: 'Ownership of DSM-KIN-12-45 will move from Asha M. to Juma H.',
        onConfirm: (ctx) async {
          seen = ctx;
          return const Submitted(txId: 'abcdef0123456789abcdef0123456789');
        },
      ),
      (r) => result = r,
    );
    expect(find.byKey(const Key('impact-sentence')), findsOneWidget);
    expect(find.textContaining('permanent and publicly auditable'), findsOneWidget);
    expect(find.text('Ledger action · step 1 of 2'), findsOneWidget);

    await tester.tap(find.byKey(const Key('confirm-continue')));
    await tester.pumpAndSettle();
    expect(find.text("Confirm it's you"), findsOneWidget);
    expect(find.byKey(const Key('reauth-biometric')), findsNothing); // no linked device credential
    expect(tester.widget<FilledButton>(find.byKey(const Key('confirm-sign'))).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('reauth-password')), 'Milki@2026');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-sign')));
    await settle(tester);

    expect(reauth.passwords, ['Milki@2026']);
    expect(seen?.reauthToken, 'reauth-token');
    expect(seen?.options.headers()['X-Reauth-Token'], 'reauth-token');
    expect(ledger.waited, ['abcdef0123456789abcdef0123456789']);
    expect(find.text('Sealed on the ledger in block #42'), findsOneWidget);
    expect(find.text('#42'), findsOneWidget);

    await tester.tap(find.byKey(const Key('confirm-done')));
    await tester.pumpAndSettle();
    expect(result?.txId, 'abcdef0123456789abcdef0123456789');
  });

  testWidgets('T3 with a linked phone confirms by biometrics', (tester) async {
    reauth.biometric = true;
    await pump<Submitted>(tester, (c) => showConfirmAction<Submitted>(c, tier: ConfirmTier.t3, title: 'Accept transfer', onConfirm: (_) async => const Submitted(txId: 'tx-bio')), (_) {});
    await tester.tap(find.byKey(const Key('confirm-continue')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('reauth-biometric')));
    await settle(tester);
    expect(reauth.biometricPrompts, 1);
    expect(find.text('Sealed on the ledger in block #42'), findsOneWidget);
  });

  testWidgets('T3 refused by a chaincode guard returns to review with the reason; the retry reuses the idempotency key', (tester) async {
    final keys = <String>[];
    var attempt = 0;
    await pump<Submitted>(
      tester,
      (c) => showConfirmAction<Submitted>(c, tier: ConfirmTier.t3, title: 'Review transfer', onConfirm: (ctx) async {
        keys.add(ctx.idempotencyKey);
        if (attempt++ == 0) throw ApiException(409, 'PARCEL_ENCUMBERED', 'This parcel has an active mortgage with CRDB Bank.');
        return const Submitted(txId: 'tx2');
      }),
      (_) {},
    );
    Future<void> sign() async {
      await tester.tap(find.byKey(const Key('confirm-continue')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('reauth-password')), 'Milki@2026');
      await tester.pump();
      await tester.tap(find.byKey(const Key('confirm-sign')));
      await settle(tester);
    }

    await sign();
    expect(find.byKey(const Key('confirm-error')), findsOneWidget);
    expect(find.text('This parcel has an active mortgage with CRDB Bank.'), findsOneWidget);
    expect(find.byKey(const Key('confirm-continue')), findsOneWidget);

    await sign();
    expect(find.text('Sealed on the ledger in block #42'), findsOneWidget);
    expect(keys, hasLength(2));
    expect(keys.toSet(), hasLength(1));
  });

  testWidgets('T3 with a wrong password stays on re-auth with the message', (tester) async {
    var called = false;
    await pump<Submitted>(tester, (c) => showConfirmAction<Submitted>(c, tier: ConfirmTier.t3, title: 'X', onConfirm: (_) async {
          called = true;
          return const Submitted(txId: 't');
        }), (_) {});
    await tester.tap(find.byKey(const Key('confirm-continue')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('reauth-password')), 'wrong');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-sign')));
    await settle(tester);
    expect(find.text('That password is not correct.'), findsOneWidget);
    expect(find.byKey(const Key('reauth-password')), findsOneWidget);
    expect(called, isFalse);
  });

  testWidgets('T3 commit failure shows the failed seal', (tester) async {
    ledger.fail = true;
    await pump<Submitted>(tester, (c) => showConfirmAction<Submitted>(c, tier: ConfirmTier.t3, title: 'X', onConfirm: (_) async => const Submitted(txId: 't')), (_) {});
    await tester.tap(find.byKey(const Key('confirm-continue')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('reauth-password')), 'Milki@2026');
    await tester.pump();
    await tester.tap(find.byKey(const Key('confirm-sign')));
    await settle(tester);
    expect(find.textContaining('did not accept this transaction'), findsOneWidget);
  });

  testWidgets('destructive T3 (cancel) needs the typed ID and an extra input', (tester) async {
    final reason = TextEditingController();
    await pump<Submitted>(
      tester,
      (c) => showConfirmAction<Submitted>(
        c,
        tier: ConfirmTier.t3,
        title: 'Cancel transfer',
        typeToConfirm: 'TRF-0123456789ABCDEF',
        listen: reason,
        canConfirm: () => reason.text.trim().length >= 3,
        extra: TextField(key: const Key('reason'), controller: reason),
        onConfirm: (_) async => const Submitted(txId: 't'),
      ),
      (_) {},
    );
    FilledButton next() => tester.widget<FilledButton>(find.byKey(const Key('confirm-continue')));
    await tester.enterText(find.byKey(const Key('type-to-confirm')), 'TRF-0123456789ABCDEF');
    await tester.pump();
    expect(next().onPressed, isNull, reason: 'reason still empty');
    await tester.enterText(find.byKey(const Key('reason')), 'Buyer withdrew');
    await tester.pump();
    expect(next().onPressed, isNotNull);
  });
}
