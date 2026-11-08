/// Help centre and support tickets (CLAUDE.md §11). Shapes match docs/openapi.yaml (Help centre, Support).
library;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
String _s(Object? v, [String fallback = '']) => v?.toString() ?? fallback;
int _i(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;

class Localized {
  const Localized(this.en, this.sw);
  final String en;
  final String sw;

  String of(String languageCode) => languageCode == 'sw' ? sw : en;

  factory Localized.fromJson(Object? j) {
    final m = j is Map ? j : const {};
    return Localized(_s(m['en']), _s(m['sw']));
  }
}

class KbCategory {
  const KbCategory({required this.slug, required this.name, required this.icon, required this.articleCount});
  final String slug;
  final Localized name;
  final String icon;
  final int articleCount;

  factory KbCategory.fromJson(Map<String, dynamic> j) => KbCategory(slug: _s(j['slug']), name: Localized.fromJson(j['name']), icon: _s(j['icon'], 'help'), articleCount: _i(j['articleCount']));
}

class KbArticle {
  const KbArticle({required this.slug, required this.categorySlug, required this.title, required this.body, required this.helpfulYes, required this.helpfulNo, this.updatedAt});
  final String slug;
  final String categorySlug;
  final Localized title;
  final Localized body;
  final int helpfulYes;
  final int helpfulNo;
  final DateTime? updatedAt;

  factory KbArticle.fromJson(Map<String, dynamic> j) => KbArticle(
        slug: _s(j['slug']),
        categorySlug: _s(j['categorySlug']),
        title: Localized.fromJson(j['title']),
        body: Localized.fromJson(j['body']),
        helpfulYes: _i(j['helpfulYes']),
        helpfulNo: _i(j['helpfulNo']),
        updatedAt: _date(j['updatedAt']),
      );
}

class Attachment {
  const Attachment({required this.name, required this.mimeType, required this.size, required this.sha256});
  final String name;
  final String mimeType;
  final int size;
  final String sha256;

  factory Attachment.fromJson(Map<String, dynamic> j) => Attachment(name: _s(j['name']), mimeType: _s(j['mimeType']), size: _i(j['size']), sha256: _s(j['sha256']));
}

class Sla {
  const Sla({required this.target, required this.state, this.dueAt});
  final String target;
  final String state;
  final DateTime? dueAt;

  factory Sla.fromJson(Object? j) {
    final m = j is Map ? j : const {};
    return Sla(target: _s(m['target'], 'NONE'), state: _s(m['state'], 'OK'), dueAt: _date(m['dueAt']));
  }
}

class Rating {
  const Rating(this.stars, this.comment);
  final int stars;
  final String comment;
}

class Ticket {
  const Ticket({
    required this.id,
    required this.number,
    required this.userId,
    required this.category,
    required this.priority,
    required this.subject,
    required this.description,
    required this.status,
    required this.attachments,
    required this.sla,
    this.assignee,
    this.parcelId,
    this.transferId,
    this.rating,
    this.createdAt,
    this.lastMessageAt,
    this.canReopenUntil,
  });
  final String id;
  final String number;
  final String userId;
  final String category;
  final String priority;
  final String subject;
  final String description;
  final String status;
  final List<Attachment> attachments;
  final Sla sla;
  final String? assignee;
  final String? parcelId;
  final String? transferId;
  final Rating? rating;
  final DateTime? createdAt;
  final DateTime? lastMessageAt;
  final DateTime? canReopenUntil;

  static const openStatuses = {'OPEN', 'IN_PROGRESS', 'AWAITING_USER'};
  bool get isOpen => openStatuses.contains(status);
  bool get isClosed => status == 'CLOSED';
  bool get resolved => status == 'RESOLVED' || status == 'CLOSED';
  bool canReopen(DateTime now) => resolved && canReopenUntil != null && now.isBefore(canReopenUntil!);

  /// Socket updates carry IDs, not display names: keep the name we already know.
  Ticket withAssignee(String? name) => Ticket(
        id: id,
        number: number,
        userId: userId,
        category: category,
        priority: priority,
        subject: subject,
        description: description,
        status: status,
        attachments: attachments,
        sla: sla,
        assignee: name,
        parcelId: parcelId,
        transferId: transferId,
        rating: rating,
        createdAt: createdAt,
        lastMessageAt: lastMessageAt,
        canReopenUntil: canReopenUntil,
      );

  factory Ticket.fromJson(Map<String, dynamic> j) {
    final r = j['rating'];
    return Ticket(
      id: _s(j['id'] ?? j['_id']),
      number: _s(j['number']),
      userId: _s(j['userId']),
      category: _s(j['category'], 'OTHER'),
      priority: _s(j['priority'], 'NORMAL'),
      subject: _s(j['subject']),
      description: _s(j['description']),
      status: _s(j['status'], 'OPEN'),
      attachments: (j['attachments'] is List ? j['attachments'] as List : const []).whereType<Map<String, dynamic>>().map(Attachment.fromJson).toList(),
      sla: Sla.fromJson(j['sla']),
      assignee: j['assignee'] as String?,
      parcelId: j['parcelId'] as String?,
      transferId: j['transferId'] as String?,
      rating: r is Map ? Rating(_i(r['stars']), _s(r['comment'])) : null,
      createdAt: _date(j['createdAt']),
      lastMessageAt: _date(j['lastMessageAt']),
      canReopenUntil: _date(j['canReopenUntil']),
    );
  }
}

class TicketMessage {
  const TicketMessage({
    required this.id,
    required this.ticketId,
    required this.authorId,
    required this.authorRole,
    required this.body,
    required this.attachments,
    required this.readBy,
    this.author,
    this.createdAt,
    this.editedAt,
    this.deleted = false,
  });
  final String id;
  final String ticketId;
  final String authorId;
  final String authorRole;
  final String? author;
  final String body;
  final List<Attachment> attachments;
  final Set<String> readBy;
  final DateTime? createdAt;
  final DateTime? editedAt;
  final bool deleted;

  bool get fromStaff => authorRole == 'SUPPORT_AGENT' || authorRole == 'SYSTEM_ADMIN';

  TicketMessage copyWith({String? body, bool? deleted, Set<String>? readBy, DateTime? editedAt}) => TicketMessage(
        id: id,
        ticketId: ticketId,
        authorId: authorId,
        authorRole: authorRole,
        author: author,
        body: body ?? this.body,
        attachments: deleted == true ? const [] : attachments,
        readBy: readBy ?? this.readBy,
        createdAt: createdAt,
        editedAt: editedAt ?? this.editedAt,
        deleted: deleted ?? this.deleted,
      );

  factory TicketMessage.fromJson(Map<String, dynamic> j) => TicketMessage(
        id: _s(j['id'] ?? j['_id']),
        ticketId: _s(j['ticketId']),
        authorId: _s(j['authorId']),
        authorRole: _s(j['authorRole']),
        author: j['author'] as String?,
        body: _s(j['body']),
        attachments: (j['attachments'] is List ? j['attachments'] as List : const []).whereType<Map<String, dynamic>>().map(Attachment.fromJson).toList(),
        readBy: (j['readBy'] is List ? j['readBy'] as List : const []).whereType<Map>().map((r) => _s(r['userId'])).toSet(),
        createdAt: _date(j['createdAt']),
        editedAt: _date(j['editedAt']),
        deleted: j['deletedAt'] != null,
      );
}
