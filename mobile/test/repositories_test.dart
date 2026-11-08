import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/core/api/api_client.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/data/repositories.dart';

import 'support/fakes.dart';

void main() {
  late FakeApi api;
  late MemoryTokenStore tokens;
  late ApiClient client;
  var expired = 0;

  setUp(() {
    api = FakeApi();
    tokens = MemoryTokenStore();
    expired = 0;
    client = fakeClient(api, tokens, onExpired: () => expired++);
  });

  group('AuthRepository', () {
    test('login sends the identifier and password and returns the OTP challenge', () async {
      api.on('POST /auth/login', (_) => Reply.ok({'challengeId': 'ch_1', 'sentTo': '+2557•••001', 'expiresIn': 300}));
      final c = await AuthRepository(client, tokens).login('citizen@milki.dev', 'Milki@2026');
      expect(c.challengeId, 'ch_1');
      expect(c.expiresIn, 300);
      expect(api.calls.single.json, {'identifier': 'citizen@milki.dev', 'password': 'Milki@2026'});
    });

    test('verifyOtp stores the session and returns the user', () async {
      api.on('POST /auth/otp/verify', (_) => Reply.ok({'accessToken': 'at1', 'refreshToken': 'rt1', 'user': userJson()}));
      final u = await AuthRepository(client, tokens).verifyOtp('ch_1', '123456');
      expect(u.firstName, 'Asha');
      expect(tokens.accessToken, 'at1');
      expect(await tokens.readRefreshToken(), 'rt1');
    });

    test('register omits an empty email and sends the preferred language', () async {
      api.on('POST /auth/register', (_) => Reply.ok({'challenge': {'challengeId': 'ch_2', 'sentTo': 'x', 'expiresIn': 300}}, status: 201));
      await AuthRepository(client, tokens).register(fullName: 'Neema J', phone: '0712000009', nida: '19900101123450000101', password: 'abc12345', email: '', language: 'sw');
      final body = api.calls.single.json;
      expect(body.containsKey('email'), isFalse);
      expect(body['preferredLanguage'], 'sw');
    });

    test('restore returns null without a refresh token and the user after a refresh', () async {
      final auth = AuthRepository(client, tokens);
      expect(await auth.restore(), isNull);
      await tokens.save(access: 'old', refresh: 'rt0');
      api.on('POST /auth/refresh', (_) => Reply.ok({'accessToken': 'at2', 'refreshToken': 'rt2'}));
      api.on('GET /auth/me', (_) => Reply.ok(userJson()));
      final u = await auth.restore();
      expect(u?.userId, 'usr_1');
      expect(await tokens.readRefreshToken(), 'rt2');
      expect(api.called('GET /auth/me').single.headers['Authorization'], 'Bearer at2');
    });

    test('device re-auth: refuses without a linked credential, then exchanges the secret', () async {
      final auth = AuthRepository(client, tokens);
      expect(() => auth.reauthWithDevice(), throwsA(isA<ApiException>().having((e) => e.code, 'code', 'DEVICE_NOT_TRUSTED')));

      api.on('POST /auth/reauth/device', (_) => Reply.ok({'deviceSecret': 's3cret'}, status: 201));
      await auth.enrollDevice('Milki@2026');
      expect(await auth.hasDeviceCredential(), isTrue);
      final deviceId = await auth.deviceId();
      expect(api.called('POST /auth/reauth/device').single.json['deviceId'], deviceId);

      api.on('POST /auth/reauth', (_) => Reply.ok({'reauthToken': 'rk1', 'expiresIn': 300}));
      expect(await auth.reauthWithDevice(), 'rk1');
      expect(api.called('POST /auth/reauth').single.json, {'deviceId': deviceId, 'deviceSecret': 's3cret'});
    });

    test('logout always clears local state, even when the API is unreachable', () async {
      await tokens.save(access: 'a', refresh: 'r');
      await tokens.write(AuthRepository.deviceSecretKey, 's');
      api.on('POST /auth/logout', (_) => throw DioException(requestOptions: RequestOptions()));
      await AuthRepository(client, tokens).logout();
      expect(tokens.accessToken, isNull);
      expect(await tokens.read(AuthRepository.deviceSecretKey), isNull);
    });
  });

  group('ApiClient', () {
    test('refreshes once on 401 and retries with the rotated token', () async {
      await tokens.save(access: 'stale', refresh: 'rt0');
      var n = 0;
      api.on('GET /parcels', (c) => n++ == 0 ? Reply.error(401, 'UNAUTHORIZED', 'Expired') : Reply.ok([parcelJson()], meta: {'total': 1}));
      api.on('POST /auth/refresh', (_) => Reply.ok({'accessToken': 'fresh', 'refreshToken': 'rt1'}));
      final list = await ParcelRepository(client).mine();
      expect(list.single.parcelId, 'DSM-KIN-12-45');
      expect(api.called('POST /auth/refresh'), hasLength(1));
      expect(api.called('GET /parcels').last.headers['Authorization'], 'Bearer fresh');
    });

    test('a failed refresh ends the session', () async {
      await tokens.save(access: 'stale', refresh: 'rt0');
      api.on('GET /parcels', (_) => Reply.error(401, 'UNAUTHORIZED', 'Expired'));
      api.on('POST /auth/refresh', (_) => Reply.error(401, 'INVALID_REFRESH', 'Refresh token reused'));
      await expectLater(ParcelRepository(client).mine(), throwsA(isA<ApiException>()));
      expect(expired, 1);
      expect(await tokens.readRefreshToken(), isNull);
    });

    test('maps the error envelope to a human message', () async {
      api.on('POST /transfers', (_) => Reply.error(409, 'PARCEL_ENCUMBERED', 'This parcel has an active mortgage with CRDB Bank.'));
      final e = await TransferRepository(client)
          .initiate(parcelId: 'DSM-KIN-12-45', buyerUserId: 'usr_2', salePrice: 1, options: const WriteOptions())
          .then<Object?>((_) => null, onError: (Object e) => e);
      expect(e, isA<ApiException>());
      expect((e! as ApiException).message, 'This parcel has an active mortgage with CRDB Bank.');
      expect((e as ApiException).status, 409);
    });

    test('network failures become a readable offline error', () async {
      api.on('GET /parcels', (_) => throw DioException.connectionError(requestOptions: RequestOptions(), reason: 'down'));
      final e = await ParcelRepository(client).mine().then<Object?>((_) => null, onError: (Object e) => e);
      expect((e! as ApiException).isNetwork, isTrue);
    });
  });

  group('TransferRepository', () {
    test('ledger writes carry the idempotency key and the re-auth token', () async {
      api.on('POST /transfers', (_) => Reply.ok({'txId': 'tx1', 'status': 'SUBMITTED', 'transferId': 'TRF-0123456789ABCDEF'}, status: 202));
      final r = await TransferRepository(client).initiate(parcelId: 'DSM-KIN-12-45', buyerUserId: 'usr_2', salePrice: 85000000, options: const WriteOptions(idempotencyKey: 'k1', reauthToken: 'rk'));
      expect(r.txId, 'tx1');
      expect(r.extra['transferId'], 'TRF-0123456789ABCDEF');
      final c = api.calls.single;
      expect(c.headers['Idempotency-Key'], 'k1');
      expect(c.headers['X-Reauth-Token'], 'rk');
      expect(c.json, {'parcelId': 'DSM-KIN-12-45', 'buyer': {'userId': 'usr_2'}, 'salePrice': 85000000, 'currency': 'TZS'});
    });

    test('off-chain writes still get a fresh idempotency key and no re-auth header', () async {
      api.on('DELETE /notifications/n1', (_) => Reply.ok({'deleted': true}));
      await NotificationRepository(client).delete('n1', const WriteOptions());
      final h = api.calls.single.headers;
      expect(h['Idempotency-Key'], matches(RegExp(r'^[0-9a-f-]{36}$')));
      expect(h.containsKey('X-Reauth-Token'), isFalse);
    });

    test('upload sends multipart with our own SHA-256 for the in-transit check', () async {
      api.on('POST /documents', (_) => Reply.ok({'txId': 'tx2', 'documentId': 'DOC-0123456789ABCDEF'}, status: 202));
      final bytes = utf8.encode('%PDF-1.7 receipt');
      await TransferRepository(client).upload(
        targetType: 'TRANSFER',
        targetId: 'TRF-0123456789ABCDEF',
        documentType: 'PAYMENT_PROOF',
        bytes: bytes,
        filename: 'receipt.pdf',
        mimeType: 'application/pdf',
        options: const WriteOptions(idempotencyKey: 'k', reauthToken: 'r'),
      );
      final form = api.calls.single.data! as FormData;
      final fields = Map.fromEntries(form.fields);
      expect(fields['sha256'], sha256.convert(bytes).toString());
      expect(fields['documentType'], 'PAYMENT_PROOF');
      expect(form.files.single.value.filename, 'receipt.pdf');
    });

    test('lookupBuyer returns the short display name for the review screen', () async {
      api.on('GET /users/lookup', (c) => Reply.ok({'userId': 'usr_2', 'displayName': 'Juma H.'}));
      final p = await TransferRepository(client).lookupBuyer('+255712000002');
      expect(p.userId, 'usr_2');
      expect(api.calls.single.query['phone'], '+255712000002');
    });

    test('parses a transfer with private sale details and history', () async {
      api.on('GET /transfers/TRF-1', (_) => Reply.ok({
            'transferId': 'TRF-1',
            'parcelId': 'DSM-KIN-12-45',
            'sellerId': 'usr_1',
            'buyerId': 'usr_2',
            'seller': {'userId': 'usr_1', 'fullName': 'Asha Mwakyusa'},
            'buyer': {'userId': 'usr_2', 'fullName': 'Juma Hassan'},
            'status': 'BUYER_ACCEPTED',
            'sale': {'salePrice': 85000000, 'currency': 'TZS'},
            'history': [
              {'status': 'INITIATED', 'at': '2026-03-01T10:00:00Z', 'by': {'role': 'CITIZEN', 'mspId': 'Org1MSP'}, 'txId': 't1'},
              {'status': 'BUYER_ACCEPTED', 'at': '2026-03-02T10:00:00Z', 'by': {'role': 'CITIZEN', 'mspId': 'Org1MSP'}, 'txId': 't2'},
            ],
          }));
      final t = await TransferRepository(client).get('TRF-1');
      expect(t.buyer.shortName, 'Juma H.');
      expect(t.salePrice, 85000000);
      expect(t.history.map((h) => h.status), ['INITIATED', 'BUYER_ACCEPTED']);
      expect(t.isOpen, isTrue);
    });
  });

  group('ParcelRepository and notifications', () {
    test('public verification reads the ledger answer', () async {
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
            'lastTxId': 'b' * 64,
          }, meta: {'source': 'ledger'}));
      final v = await ParcelRepository(client).verify('DSM-KIN-12-45');
      expect(v.owner, 'Asha M.');
      expect(v.encumbered, isTrue);
    });

    test('document verification passes the hash as a query parameter', () async {
      api.on('GET /verify/documents/DOC-0123456789ABCDEF', (c) => Reply.ok({'documentId': 'DOC-0123456789ABCDEF', 'match': c.query['sha256'] == 'f' * 64, 'status': 'ACTIVE', 'documentType': 'TITLE_DEED', 'parcelId': 'DSM-KIN-12-45'}));
      expect((await ParcelRepository(client).verifyDocument('DOC-0123456789ABCDEF', 'f' * 64)).match, isTrue);
      expect((await ParcelRepository(client).verifyDocument('DOC-0123456789ABCDEF', 'e' * 64)).match, isFalse);
    });

    test('notifications list exposes the unread count from meta', () async {
      api.on('GET /notifications', (_) => Reply.ok([
            {'_id': 'n1', 'type': 'milki.Transfer.Initiated', 'title': 'Transfer started', 'body': 'b', 'data': {'transferId': 'TRF-1'}, 'createdAt': '2026-03-01T10:00:00Z'},
          ], meta: {'unread': 3}));
      final r = await NotificationRepository(client).list();
      expect(r.unread, 3);
      expect(r.items.single.transferId, 'TRF-1');
    });
  });
}
