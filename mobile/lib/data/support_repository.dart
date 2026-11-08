import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../core/api/api_client.dart';
import 'support_models.dart';

typedef _Json = Map<String, dynamic>;

/// A file chosen to attach (PDF/JPEG/PNG, ≤ 10 MB, checked again by magic bytes on the server).
class PickedAttachment {
  const PickedAttachment(this.name, this.bytes, this.mimeType);
  final String name;
  final Uint8List bytes;
  final String mimeType;

  MultipartFile toMultipart() => MultipartFile.fromBytes(bytes, filename: name, contentType: DioMediaType.parse(mimeType));
}

/// Help centre (public) and support tickets (CLAUDE.md §11).
class SupportRepository {
  SupportRepository(this.api);
  final ApiClient api;

  Future<List<KbCategory>> categories() async => (await api.get<List<dynamic>>('/kb/categories')).data.whereType<_Json>().map(KbCategory.fromJson).toList();

  Future<List<KbArticle>> articles({String? q, String? category}) async =>
      (await api.get<List<dynamic>>('/kb/articles', query: {'q': ?q, 'category': ?category, 'limit': 50})).data.whereType<_Json>().map(KbArticle.fromJson).toList();

  Future<KbArticle> article(String slug) async => KbArticle.fromJson((await api.get<_Json>('/kb/articles/$slug')).data);

  /// "Was this helpful?", feedback, one vote per reader (changing it moves the vote).
  Future<void> vote(String slug, bool helpful) => api.send<_Json>('POST', '/kb/articles/$slug/vote', body: {'helpful': helpful});

  Future<List<Ticket>> myTickets() async =>
      (await api.get<List<dynamic>>('/tickets', query: {'limit': 50, 'sort': '-lastMessageAt'})).data.whereType<_Json>().map(Ticket.fromJson).toList();

  Future<Ticket> ticket(String id) async => Ticket.fromJson((await api.get<_Json>('/tickets/$id')).data);

  Future<Ticket> create({
    required String category,
    required String subject,
    required String description,
    String priority = 'NORMAL',
    String? parcelId,
    String? transferId,
    PickedAttachment? file,
    required WriteOptions options,
  }) async {
    final fields = <String, dynamic>{
      'category': category,
      'priority': priority,
      'subject': subject,
      'description': description,
      'parcelId': ?parcelId,
      'transferId': ?transferId,
    };
    final body = file == null ? fields : FormData.fromMap({...fields, 'file': file.toMultipart()});
    return Ticket.fromJson(await api.send<_Json>('POST', '/tickets', body: body, options: options));
  }

  Future<List<TicketMessage>> messages(String id) async =>
      (await api.get<List<dynamic>>('/tickets/$id/messages')).data.whereType<_Json>().map(TicketMessage.fromJson).toList();

  Future<TicketMessage> send(String id, String body, {PickedAttachment? file, required WriteOptions options}) async {
    final payload = file == null ? {'body': body} : FormData.fromMap({'body': body, 'file': file.toMultipart()});
    return TicketMessage.fromJson(await api.send<_Json>('POST', '/tickets/$id/messages', body: payload, options: options));
  }

  Future<TicketMessage> edit(String id, String messageId, String body, WriteOptions options) async =>
      TicketMessage.fromJson(await api.send<_Json>('PATCH', '/tickets/$id/messages/$messageId', body: {'body': body}, options: options));

  Future<void> deleteMessage(String id, String messageId, WriteOptions options) => api.send<_Json>('DELETE', '/tickets/$id/messages/$messageId', options: options);

  /// Read receipts are UI state (no confirmation).
  Future<void> markRead(String id) => api.send<_Json>('POST', '/tickets/$id/read');

  Future<Ticket> close(String id, WriteOptions options) async => Ticket.fromJson(await api.send<_Json>('POST', '/tickets/$id/close', body: <String, dynamic>{}, options: options));

  Future<Ticket> reopen(String id, WriteOptions options) async => Ticket.fromJson(await api.send<_Json>('POST', '/tickets/$id/reopen', body: <String, dynamic>{}, options: options));

  Future<Ticket> rate(String id, int stars, String comment, WriteOptions options) async =>
      Ticket.fromJson(await api.send<_Json>('POST', '/tickets/$id/rating', body: {'stars': stars, if (comment.trim().isNotEmpty) 'comment': comment.trim()}, options: options));

  Future<int> agentsOnline() async => ((await api.get<_Json>('/support/presence')).data['agentsOnline'] as num?)?.toInt() ?? 0;
}
