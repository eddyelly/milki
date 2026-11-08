import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/state/providers.dart';
import 'package:milki_mobile/ui/screens/verify_screen.dart';
import 'package:milki_mobile/ui/validators.dart';

import 'support/fakes.dart';

void main() {
  setUpAll(setUpFonts);

  group('parseVerifyCode', () {
    test('parcel QR, URL and bare ID', () {
      expect((parseVerifyCode('milki:parcel:DSM-KIN-12-45')! as ParcelTarget).parcelId, 'DSM-KIN-12-45');
      expect((parseVerifyCode('MILKI:PARCEL:dsm-kin-12-45')! as ParcelTarget).parcelId, 'DSM-KIN-12-45');
      expect((parseVerifyCode('https://milki.go.tz/verify/parcels/ARU-ARM-3-7')! as ParcelTarget).parcelId, 'ARU-ARM-3-7');
      expect((parseVerifyCode('  dsm-kin-12-45 ')! as ParcelTarget).parcelId, 'DSM-KIN-12-45');
    });

    test('document QR carries the ID and SHA-256', () {
      final sha = 'ab' * 32;
      final t = parseVerifyCode('milki:doc:DOC-0123456789ABCDEF:$sha')! as DocumentTarget;
      expect(t.documentId, 'DOC-0123456789ABCDEF');
      expect(t.sha256, sha);
      final u = parseVerifyCode('https://milki.go.tz/api/v1/verify/documents/doc-0123456789abcdef?sha256=$sha')! as DocumentTarget;
      expect(u.documentId, 'DOC-0123456789ABCDEF');
    });

    test('rejects anything else', () {
      for (final s in ['', 'hello', 'milki:doc:DOC-0123456789ABCDEF', 'milki:doc:DOC-01:${'a' * 64}', 'https://example.com/x', 'milki:parcel:bad id', 'WIFI:S:x;;']) {
        expect(parseVerifyCode(s), isNull, reason: s);
      }
    });
  });

  test('normalizePhone mirrors the API', () {
    expect(normalizePhone('0712 345 678'), '+255712345678');
    expect(normalizePhone('255612345678'), '+255612345678');
    expect(normalizePhone('+255712345678'), '+255712345678');
    expect(normalizePhone('0812345678'), isNull);
    expect(normalizePhone('07123'), isNull);
  });

  group('VerifyScreen', () {
    late FakeApi api;
    setUp(() => api = FakeApi());

    Future<void> pump(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.6;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(testApp(const VerifyScreen(startWithCamera: false), overrides: [apiClientProvider.overrideWithValue(fakeClient(api, MemoryTokenStore()))]));
      await tester.pumpAndSettle();
    }

    testWidgets('a registered parcel flips in the gold badge with ledger details', (tester) async {
      api.on('GET /verify/parcels/DSM-KIN-12-45', (_) => Reply.ok({
            'parcelId': 'DSM-KIN-12-45',
            'titleNumber': 'CT-1001',
            'region': 'Dar es Salaam',
            'district': 'Kinondoni',
            'ward': 'Mikocheni',
            'area': 1200,
            'status': 'ENCUMBERED',
            'owner': 'Asha M.',
            'encumbered': true,
            'disputed': false,
            'lastTxId': 'c' * 64,
          }));
      await pump(tester);
      await tester.enterText(find.byKey(const Key('verify-input')), 'milki:parcel:DSM-KIN-12-45');
      await tester.tap(find.byKey(const Key('verify-check')));
      await settle(tester);
      expect(find.byKey(const Key('verified-badge')), findsOneWidget);
      expect(find.text('Asha M.'), findsOneWidget);
      expect(find.text('This parcel has an active mortgage.'), findsOneWidget);
    });

    testWidgets('a document whose hash differs shows the earth warning', (tester) async {
      api.on('GET /verify/documents/DOC-0123456789ABCDEF', (_) => Reply.ok({'documentId': 'DOC-0123456789ABCDEF', 'match': false, 'status': 'ACTIVE', 'documentType': 'TITLE_DEED', 'parcelId': 'DSM-KIN-12-45'}));
      await pump(tester);
      await tester.enterText(find.byKey(const Key('verify-input')), 'milki:doc:DOC-0123456789ABCDEF:${'d' * 64}');
      await tester.tap(find.byKey(const Key('verify-check')));
      await settle(tester);
      expect(find.byKey(const Key('verify-warning')), findsOneWidget);
      expect(find.text('Does not match'), findsOneWidget);
      expect(find.byKey(const Key('verified-badge')), findsNothing);
    });

    testWidgets('an unknown parcel shows the server message; junk is not sent at all', (tester) async {
      api.on('GET /verify/parcels/DSM-KIN-99-99', (_) => Reply.error(404, 'NOT_FOUND', 'Parcel DSM-KIN-99-99 was not found.'));
      await pump(tester);
      await tester.enterText(find.byKey(const Key('verify-input')), 'DSM-KIN-99-99');
      await tester.tap(find.byKey(const Key('verify-check')));
      await settle(tester);
      expect(find.text('Parcel DSM-KIN-99-99 was not found.'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('verify-input')), 'not a code');
      await tester.tap(find.byKey(const Key('verify-check')));
      await settle(tester);
      expect(find.text('This QR code is not a Milki code.'), findsOneWidget);
      expect(api.calls, hasLength(1));
    });
  });
}
