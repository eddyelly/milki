import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/data/models.dart';
import 'package:milki_mobile/ui/widgets/timelines.dart';

import 'support/fakes.dart';

TransferStep step(String s, int day) => TransferStep(status: s, at: DateTime(2026, 3, day), role: 'CITIZEN', mspId: 'Org1MSP', txId: 'tx$day');

void main() {
  setUpAll(setUpFonts);

  group('reachedIndex', () {
    test('follows the happy path', () {
      expect(TransferTracker.reachedIndex('INITIATED', const []), 0);
      expect(TransferTracker.reachedIndex('PAYMENTS_CONFIRMED', const []), 2);
      expect(TransferTracker.reachedIndex('APPROVED', const []), 4);
      expect(TransferTracker.reachedIndex('COMPLETED', const []), 4);
    });

    test('a closed transfer stops at the last step it reached', () {
      expect(TransferTracker.reachedIndex('CANCELLED', [step('INITIATED', 1), step('BUYER_ACCEPTED', 2), step('CANCELLED', 3)]), 1);
      expect(TransferTracker.reachedIndex('REJECTED', [step('REJECTED', 1)]), 0);
    });
  });

  testWidgets('marks completed steps done and the current one current', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(testApp(TransferTracker(status: 'PAYMENTS_CONFIRMED', history: [step('INITIATED', 1), step('BUYER_ACCEPTED', 2), step('PAYMENTS_CONFIRMED', 3)])));
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Initiated, done, Mar 1, 2026'), findsOneWidget);
    expect(find.bySemanticsLabel('Buyer accepted, done, Mar 2, 2026'), findsOneWidget);
    expect(find.bySemanticsLabel('Payments confirmed, current, Mar 3, 2026'), findsOneWidget);
    expect(find.bySemanticsLabel('Verified'), findsOneWidget);
    expect(find.text('Approved & recorded'), findsOneWidget);
    expect(find.text('4'), findsOneWidget); // upcoming steps show their number
    expect(find.text('Mar 3, 2026'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a completed transfer ticks every step', (tester) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(testApp(const TransferTracker(status: 'COMPLETED', history: [])));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel(RegExp(r', done$')), findsNWidgets(5));
    handle.dispose();
  });

  testWidgets('a cancelled transfer shows where it stopped and why', (tester) async {
    await tester.pumpWidget(testApp(TransferTracker(status: 'CANCELLED', history: [step('INITIATED', 1), step('CANCELLED', 2)])));
    await tester.pumpAndSettle();
    expect(find.text('Cancelled by the seller.'), findsOneWidget);
    expect(find.byIcon(Icons.block), findsOneWidget);
  });

  testWidgets('animates when motion is allowed (breathing current step, check draw)', (tester) async {
    await tester.pumpWidget(testApp(const TransferTracker(status: 'BUYER_ACCEPTED', history: []), reduceMotion: false));
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('Buyer accepted'), findsOneWidget);
    // The breathing loop repeats forever; replace the tree so no ticker outlives the test.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('renders in Swahili', (tester) async {
    await tester.pumpWidget(testApp(const TransferTracker(status: 'INITIATED', history: []), locale: const Locale('sw')));
    await tester.pumpAndSettle();
    expect(find.text('Umeanzishwa'), findsOneWidget);
  });
}
