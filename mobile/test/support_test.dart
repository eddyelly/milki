import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milki_mobile/core/api/api_client.dart';
import 'package:milki_mobile/core/api/token_store.dart';
import 'package:milki_mobile/core/support_chat.dart';
import 'package:milki_mobile/data/support_models.dart';
import 'package:milki_mobile/data/support_repository.dart';
import 'package:milki_mobile/state/providers.dart';
import 'package:milki_mobile/ui/screens/help_screen.dart';
import 'package:milki_mobile/ui/screens/support_screens.dart';
import 'package:milki_mobile/ui/widgets/markdown_lite.dart';

import 'support/fakes.dart';

const tid = '6a0000000000000000000001';

Json ticketJson({String status = 'IN_PROGRESS', String? assignee = 'Halima Said', Json? rating, String? canReopenUntil}) => {
      'id': tid,
      'number': 'MLK-000042',
      'userId': 'usr_1',
      'category': 'TRANSFERS',
      'priority': 'HIGH',
      'subject': 'Buyer cannot see my transfer',
      'description': 'I started a transfer yesterday.',
      'status': status,
      'attachments': <Object>[],
      'sla': {'target': 'RESOLUTION', 'state': 'OK', 'dueAt': '2026-11-10T10:00:00Z'},
      'assignee': assignee,
      'parcelId': 'DSM-KIN-12-45',
      'transferId': null,
      'rating': rating,
      'createdAt': '2026-11-08T08:00:00Z',
      'lastMessageAt': '2026-11-08T09:00:00Z',
      'canReopenUntil': canReopenUntil,
    };

Json msgJson(String id, String author, String role, String body, {List<String> readBy = const [], String at = '2026-11-08T09:00:00Z'}) => {
      'id': id,
      'ticketId': tid,
      'authorId': author,
      'authorRole': role,
      'author': role == 'CITIZEN' ? 'Asha M.' : 'Halima Said',
      'body': body,
      'attachments': <Object>[],
      'readBy': [for (final r in readBy) {'userId': r, 'at': at}],
      'createdAt': at,
      'editedAt': null,
      'deletedAt': null,
    };

void main() {
  setUpAll(setUpFonts);

  group('SupportRepository', () {
    late FakeApi api;
    late SupportRepository repo;
    setUp(() {
      api = FakeApi();
      repo = SupportRepository(fakeClient(api, MemoryTokenStore()));
    });

    test('creates a ticket with "Get help" context as JSON, or multipart with a file', () async {
      api.on('POST /tickets', (c) => Reply.ok(ticketJson(status: 'OPEN'), status: 201));
      final t = await repo.create(category: 'TRANSFERS', subject: 'Help', description: 'Buyer cannot see it', parcelId: 'DSM-KIN-12-45', options: const WriteOptions(idempotencyKey: 'k1'));
      expect(t.number, 'MLK-000042');
      expect(api.calls.single.json, {'category': 'TRANSFERS', 'priority': 'NORMAL', 'subject': 'Help', 'description': 'Buyer cannot see it', 'parcelId': 'DSM-KIN-12-45'});
      expect(api.calls.single.headers['Idempotency-Key'], 'k1');

      await repo.create(category: 'OTHER', subject: 'x', description: 'y', file: PickedAttachment('r.pdf', Uint8ListFrom('%PDF-1'), 'application/pdf'), options: const WriteOptions());
      final form = api.calls.last.data! as FormData;
      expect(Map.fromEntries(form.fields)['category'], 'OTHER');
      expect(form.files.single.value.filename, 'r.pdf');
    });

    test('parses tickets, messages, SLA and the reopen window', () async {
      api.on('GET /tickets/$tid', (_) => Reply.ok(ticketJson(status: 'RESOLVED', rating: {'stars': 4, 'comment': 'ok'}, canReopenUntil: '2099-01-01T00:00:00Z')));
      api.on('GET /tickets/$tid/messages', (_) => Reply.ok([msgJson('m1', 'usr_9', 'SUPPORT_AGENT', 'Hello', readBy: ['usr_1'])]));
      final t = await repo.ticket(tid);
      expect(t.resolved, isTrue);
      expect(t.rating?.stars, 4);
      expect(t.canReopen(DateTime(2026)), isTrue);
      final m = (await repo.messages(tid)).single;
      expect(m.fromStaff, isTrue);
      expect(m.readBy, {'usr_1'});
    });

    test('help centre: categories, search and votes', () async {
      api.on('GET /kb/categories', (_) => Reply.ok([
            {'slug': 'transfers', 'name': {'en': 'Transfers', 'sw': 'Uhamisho'}, 'icon': 'swap', 'articleCount': 2},
          ]));
      api.on('GET /kb/articles', (c) => Reply.ok([
            {'slug': 'how-to-transfer', 'categorySlug': 'transfers', 'title': {'en': 'How', 'sw': 'Jinsi'}, 'body': {'en': 'Open', 'sw': 'Fungua'}, 'helpfulYes': 3, 'helpfulNo': 0},
          ]));
      api.on('POST /kb/articles/how-to-transfer/vote', (_) => Reply.ok({'helpful': true, 'helpfulYes': 4, 'helpfulNo': 0}));
      expect((await repo.categories()).single.name.of('sw'), 'Uhamisho');
      expect((await repo.articles(q: 'transfer')).single.title.of('en'), 'How');
      expect(api.called('GET /kb/articles').single.query['q'], 'transfer');
      await repo.vote('how-to-transfer', true);
      expect(api.calls.last.json, {'helpful': true});
    });
  });

  testWidgets('MarkdownLite renders bold and lists', (tester) async {
    await tester.pumpWidget(testApp(const MarkdownLite('Tap **Transfer**.\n\n- one\n- two')));
    expect(find.textContaining('Transfer', findRichText: true), findsOneWidget);
    expect(find.textContaining('one', findRichText: true), findsOneWidget);
  });

  group('TicketChatScreen', () {
    late FakeApi api;
    late FakeSupportChat chat;

    Future<void> pump(WidgetTester tester, {Json? ticket}) async {
      tester.view.physicalSize = const Size(1080, 2340);
      tester.view.devicePixelRatio = 2.75;
      addTearDown(tester.view.reset);
      api.on('GET /tickets/$tid', (_) => Reply.ok(ticket ?? ticketJson()));
      api.on('GET /tickets/$tid/messages', (_) => Reply.ok([
            msgJson('m1', 'usr_1', 'CITIZEN', 'It happened again.', readBy: ['usr_1', 'usr_9']),
            msgJson('m2', 'usr_9', 'SUPPORT_AGENT', 'Checking now.', readBy: ['usr_9']),
          ]));
      api.on('POST /tickets/$tid/read', (_) => Reply.ok({'updated': 1}));
      api.on('GET /support/presence', (_) => Reply.ok({'agentsOnline': 1}));
      await tester.pumpWidget(testApp(
        const TicketChatScreen(ticketId: tid),
        overrides: [
          apiClientProvider.overrideWithValue(fakeClient(api, MemoryTokenStore())),
          supportChatProvider.overrideWithValue(chat),
          sessionProvider.overrideWith(FakeSession.new),
          reauthenticatorProvider.overrideWithValue(FakeReauth()),
          ledgerEventsProvider.overrideWithValue(FakeLedgerEvents()),
        ],
      ));
      await settle(tester);
    }

    setUp(() {
      api = FakeApi();
      chat = FakeSupportChat();
    });

    testWidgets('history, presence, read receipts, typing dots and live replies', (tester) async {
      await pump(tester);
      expect(chat.joined, [tid]);
      expect(find.text('It happened again.'), findsOneWidget);
      expect(find.text('Checking now.'), findsOneWidget);
      expect(find.text('Halima Said is helping you'), findsOneWidget);
      expect(find.byIcon(Icons.done_all), findsOneWidget); // my message was seen by the agent
      await tester.pump(const Duration(milliseconds: 600));
      await settle(tester);
      expect(api.called('POST /tickets/$tid/read'), hasLength(1));

      chat.emit(const TypingEvent(tid, 'usr_9', 'SUPPORT_AGENT', true));
      await tester.pump();
      await tester.pump(); // after the scroll-to-end post-frame callback
      expect(find.byKey(const Key('typing-dots')), findsOneWidget);

      chat.emit(MessageEvent(TicketMessage.fromJson(msgJson('m3', 'usr_9', 'SUPPORT_AGENT', 'Please refresh the app.', at: '2026-11-08T09:05:00Z'))));
      await settle(tester);
      expect(find.text('Please refresh the app.'), findsOneWidget);
      expect(find.byKey(const Key('typing-dots')), findsNothing);

      chat.emit(TicketUpdatedEvent(Ticket.fromJson(ticketJson(status: 'AWAITING_USER', assignee: null))));
      await tester.pump();
      await tester.pump(); // stream events land on a microtask after the frame
      expect(find.text('Waiting for you'), findsOneWidget);
      expect(find.text('Halima Said is helping you'), findsOneWidget); // name kept
    });

    testWidgets('sending posts with an idempotency key and shows the bubble', (tester) async {
      api.on('POST /tickets/$tid/messages', (c) => Reply.ok(msgJson('m9', 'usr_1', 'CITIZEN', c.json['body'] as String, at: '2026-11-08T09:10:00Z'), status: 201));
      await pump(tester);
      await tester.enterText(find.byKey(const Key('chat-input')), 'Thank you!');
      expect(chat.typingSent, [true]);
      await tester.tap(find.byKey(const Key('chat-send')));
      await settle(tester);
      expect(find.text('Thank you!'), findsOneWidget);
      final post = api.called('POST /tickets/$tid/messages').single;
      expect(post.headers['Idempotency-Key'], isNotNull);
      expect(post.json, {'body': 'Thank you!'});
    });

    testWidgets('resolved: rate with stars (T1) and reopen within 7 days', (tester) async {
      api.on('POST /tickets/$tid/rating', (c) => Reply.ok(ticketJson(status: 'RESOLVED', rating: {'stars': c.json['stars'], 'comment': c.json['comment'] ?? ''}, canReopenUntil: '2099-01-01T00:00:00Z')));
      await pump(tester, ticket: ticketJson(status: 'RESOLVED', canReopenUntil: '2099-01-01T00:00:00Z'));
      expect(find.byKey(const Key('resolved-panel')), findsOneWidget);
      expect(find.byKey(const Key('reopen')), findsOneWidget);
      await tester.tap(find.byKey(const Key('star-4')));
      await settle(tester);
      expect(find.text('★★★★☆'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('rating-comment')), 'Quick help');
      await tester.tap(find.byKey(const Key('confirm-submit')));
      await settle(tester);
      expect(api.called('POST /tickets/$tid/rating').single.json, {'stars': 4, 'comment': 'Quick help'});
      expect(find.text('Thanks for rating us.'), findsOneWidget);
    });

    testWidgets('closing is T2: the ticket number must be typed', (tester) async {
      api.on('POST /tickets/$tid/close', (_) => Reply.ok(ticketJson(status: 'CLOSED')));
      await pump(tester);
      await tester.tap(find.byKey(const Key('ticket-menu')));
      await settle(tester);
      await tester.tap(find.text('Close ticket').last);
      await settle(tester);
      FilledButton submit() => tester.widget<FilledButton>(find.byKey(const Key('confirm-submit')));
      expect(submit().onPressed, isNull);
      await tester.enterText(find.byKey(const Key('type-to-confirm')), 'MLK-000042');
      await tester.pump();
      await tester.tap(find.byKey(const Key('confirm-submit')));
      await settle(tester);
      expect(api.called('POST /tickets/$tid/close'), hasLength(1));
      expect(find.byKey(const Key('chat-input')), findsNothing); // closed: no composer
    });
  });

  testWidgets('help centre lists articles and votes on one', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    final api = FakeApi();
    api.on('GET /kb/categories', (_) => Reply.ok([
          {'slug': 'transfers', 'name': {'en': 'Transfers', 'sw': 'Uhamisho'}, 'articleCount': 1},
        ]));
    api.on('GET /kb/articles', (_) => Reply.ok([
          {'slug': 'how-to-transfer', 'categorySlug': 'transfers', 'title': {'en': 'How do I transfer?', 'sw': 'Ninahamishaje?'}, 'body': {'en': 'Open the **parcel**.', 'sw': 'Fungua **kiwanja**.'}, 'helpfulYes': 0, 'helpfulNo': 0},
        ]));
    api.on('GET /kb/articles/how-to-transfer', (_) => Reply.ok({'slug': 'how-to-transfer', 'categorySlug': 'transfers', 'title': {'en': 'How do I transfer?', 'sw': 'Ninahamishaje?'}, 'body': {'en': 'Open the **parcel**.', 'sw': 'Fungua **kiwanja**.'}}));
    api.on('POST /kb/articles/how-to-transfer/vote', (_) => Reply.ok({'helpful': true, 'helpfulYes': 1, 'helpfulNo': 0}));
    api.on('GET /tickets', (_) => Reply.ok([ticketJson()]));
    final overrides = [
      apiClientProvider.overrideWithValue(fakeClient(api, MemoryTokenStore())),
      supportChatProvider.overrideWithValue(FakeSupportChat()),
      sessionProvider.overrideWith(FakeSession.new),
      ledgerEventsProvider.overrideWithValue(FakeLedgerEvents()),
    ];
    await tester.pumpWidget(testApp(const HelpScreen(), overrides: overrides, locale: const Locale('sw')));
    await settle(tester);
    expect(find.text('Ninahamishaje?'), findsOneWidget);
    expect(find.text('Tiketi 1 iliyo wazi'), findsOneWidget);

    await tester.pumpWidget(testApp(const ArticleScreen(slug: 'how-to-transfer'), overrides: overrides));
    await settle(tester);
    expect(find.text('How do I transfer?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('vote-yes')));
    await settle(tester);
    expect(find.text('Thanks for the feedback!'), findsOneWidget);
  });
}

// ignore: non_constant_identifier_names
Uint8List Uint8ListFrom(String s) => Uint8List.fromList(s.codeUnits);
