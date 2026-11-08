@Tags(['live'])
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/core/api/api_client.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/core/config.dart';
import 'package:milki_mobile/core/ledger_events.dart';
import 'package:milki_mobile/core/support_chat.dart';
import 'package:milki_mobile/data/models.dart';
import 'package:milki_mobile/data/repositories.dart';
import 'package:milki_mobile/data/support_repository.dart';

/// Contract test: the mobile data layer against the running stack (not part of the default run).
///
///   flutter test test/live --dart-define=API_URL=http://localhost:4100/api/v1 --dart-define=MAILPIT_URL=http://localhost:8126
///
/// Signs in the seeded citizen and buyer (OTP from Mailpit), reads parcels from the ledger, links the phone for
/// biometric re-auth, then initiates → accepts → cancels a transfer, waiting for each commit over Socket.IO.
const live = bool.hasEnvironment('API_URL');
const mailpit = String.fromEnvironment('MAILPIT_URL', defaultValue: 'http://localhost:8126');

Future<String> otpFor(String phone, DateTime after) async {
  final http = HttpClient();
  try {
    for (var i = 0; i < 40; i++) {
      final req = await http.getUrl(Uri.parse('$mailpit/api/v1/search?query=${Uri.encodeQueryComponent('to:"$phone@sms.milki.local"')}&limit=1'));
      final body = jsonDecode(await (await req.close()).transform(utf8.decoder).join()) as Map<String, dynamic>;
      final m = ((body['messages'] as List?) ?? const []).cast<Map<String, dynamic>>().firstOrNull;
      if (m != null && DateTime.parse(m['Created'] as String).isAfter(after.subtract(const Duration(seconds: 2)))) {
        final code = RegExp(r'\b(\d{6})\b').firstMatch(m['Snippet'] as String)?.group(1);
        if (code != null) return code;
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    throw StateError('no OTP for $phone');
  } finally {
    http.close();
  }
}

class Session {
  Session(this.tokens, this.api) : auth = AuthRepository(api, tokens);
  final MemoryTokenStore tokens;
  final ApiClient api;
  final AuthRepository auth;
  late User user;

  static Future<Session> signIn(String identifier, String phone) async {
    final tokens = MemoryTokenStore();
    final s = Session(tokens, ApiClient(tokens: tokens));
    final started = DateTime.now().toUtc();
    final challenge = await s.auth.login(identifier, 'Milki@2026');
    s.user = await s.auth.verifyOtp(challenge.challengeId, await otpFor(phone, started));
    return s;
  }
}

void main() {
  // flutter_test blocks real HTTP by default; this suite talks to the running API on purpose.
  setUpAll(() => HttpOverrides.global = null);

  test('mobile data layer against the live API', () async {
    final seller = await Session.signIn('citizen@milki.dev', '+255712000001');
    expect(seller.user.role, 'CITIZEN');

    final parcels = ParcelRepository(seller.api);
    final mine = await parcels.mine();
    expect(mine, isNotEmpty);
    final active = mine.firstWhere((p) => p.status == 'ACTIVE', orElse: () => throw StateError('seed an ACTIVE parcel for citizen@milki.dev'));
    final parcel = await parcels.get(active.parcelId);
    expect(parcel.ownerId, seller.user.userId);
    expect(await parcels.history(parcel.parcelId), isNotEmpty);
    await parcels.documents(parcel.parcelId);

    final verified = await parcels.verify(parcel.parcelId);
    expect(verified.parcelId, parcel.parcelId);
    expect(verified.owner, contains('Asha'));

    // Link this "phone" for biometric confirmation, then re-authenticate with the device secret.
    await seller.auth.enrollDevice('Milki@2026', deviceName: 'live test');
    final reauth1 = await seller.auth.reauthWithDevice();
    expect(reauth1, isNotEmpty);

    final ledger = SocketLedgerEvents(LedgerRepository(seller.api))..connect(seller.tokens.accessToken!);
    final transfers = TransferRepository(seller.api);
    final buyerParty = await transfers.lookupBuyer('+255712000002');
    expect(buyerParty.fullName, 'Juma H.');

    final initiated = await transfers.initiate(
      parcelId: parcel.parcelId,
      buyerUserId: buyerParty.userId,
      salePrice: 1000000,
      options: WriteOptions(idempotencyKey: newUuid(), reauthToken: reauth1),
    );
    final transferId = initiated.extra['transferId'] as String;
    final commit = await ledger.waitForCommit(initiated.txId, timeout: const Duration(seconds: 60));
    expect(commit.blockNumber, isNotNull);

    final buyer = await Session.signIn('buyer@milki.dev', '+255712000002');
    final buyerTransfers = TransferRepository(buyer.api);
    final t = await buyerTransfers.get(transferId);
    expect(t.status, 'INITIATED');
    expect(t.salePrice, 1000000);
    final accepted = await buyerTransfers.accept(transferId, WriteOptions(idempotencyKey: newUuid(), reauthToken: await buyer.auth.reauthWithPassword('Milki@2026')));
    final buyerLedger = SocketLedgerEvents(LedgerRepository(buyer.api))..connect(buyer.tokens.accessToken!);
    await buyerLedger.waitForCommit(accepted.txId, timeout: const Duration(seconds: 60));

    // Seller cancels (leaves the parcel ACTIVE for the next run).
    final cancelled = await transfers.cancel(transferId, 'Live contract test', WriteOptions(idempotencyKey: newUuid(), reauthToken: await seller.auth.reauthWithDevice()));
    await ledger.waitForCommit(cancelled.txId, timeout: const Duration(seconds: 60));
    final closed = await transfers.get(transferId);
    expect(closed.status, 'CANCELLED');
    expect(closed.history.map((h) => h.status), containsAll(['INITIATED', 'BUYER_ACCEPTED', 'CANCELLED']));

    final notes = await NotificationRepository(buyer.api).list();
    expect(notes.items, isNotEmpty);

    ledger.disconnect();
    buyerLedger.disconnect();
    await seller.auth.logout();
    await buyer.auth.logout();
    expect(AppConfig.apiUrl, isNot(contains('10.0.2.2')));
  }, skip: live ? false : 'set --dart-define=API_URL to run against the live stack', timeout: const Timeout(Duration(minutes: 4)));

  test('support: ticket, live chat over /support, resolution and rating', () async {
    final citizen = await Session.signIn('citizen@milki.dev', '+255712000001');
    final agent = await Session.signIn('support@milki.dev', '+255716000001');
    final support = SupportRepository(citizen.api);

    expect((await support.articles(q: 'transfer')).map((a) => a.slug), contains('how-to-transfer-land'));
    final parcelId = (await ParcelRepository(citizen.api).mine()).first.parcelId;
    final t = await support.create(category: 'TRANSFERS', subject: 'Live test ticket', description: 'Created by the mobile contract test.', parcelId: parcelId, options: WriteOptions(idempotencyKey: newUuid()));
    expect(t.number, startsWith('MLK-'));
    expect(t.parcelId, parcelId);

    final chat = SocketSupportChat()..connect(citizen.tokens.accessToken!);
    await Future<void>.delayed(const Duration(seconds: 1));
    expect(await chat.join(t.id), isTrue);
    final reply = chat.events.where((e) => e is MessageEvent).cast<MessageEvent>().first.timeout(const Duration(seconds: 10));
    final updated = chat.events.where((e) => e is TicketUpdatedEvent).cast<TicketUpdatedEvent>().firstWhere((e) => e.ticket.status == 'RESOLVED').timeout(const Duration(seconds: 10));

    final agentRepo = SupportRepository(agent.api);
    await agentRepo.send(t.id, 'Habari! This is a live reply.', options: WriteOptions(idempotencyKey: newUuid()));
    expect((await reply).message.body, 'Habari! This is a live reply.');

    await agent.api.send<Map<String, dynamic>>('PATCH', '/tickets/${t.id}', body: {'status': 'RESOLVED'}, options: WriteOptions(idempotencyKey: newUuid()));
    expect((await updated).ticket.resolved, isTrue);

    final rated = await support.rate(t.id, 5, 'Fast!', WriteOptions(idempotencyKey: newUuid()));
    expect(rated.rating?.stars, 5);
    await support.close(t.id, WriteOptions(idempotencyKey: newUuid()));

    chat.disconnect();
    await citizen.auth.logout();
    await agent.auth.logout();
  }, skip: live ? false : 'set --dart-define=API_URL to run against the live stack', timeout: const Timeout(Duration(minutes: 2)));
}
