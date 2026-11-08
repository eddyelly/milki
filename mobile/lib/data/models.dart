/// API shapes (docs/openapi.yaml). Hand-written, immutable, null-safe parsing.
library;

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
String _s(Object? v, [String fallback = '']) => v?.toString() ?? fallback;
num _n(Object? v) => v is num ? v : num.tryParse('$v') ?? 0;
List<T> _list<T>(Object? v, T Function(Map<String, dynamic>) f) => v is List ? v.whereType<Map<String, dynamic>>().map(f).toList() : <T>[];

class User {
  const User({required this.userId, required this.role, required this.fullName, required this.phone, this.email, this.nidaMasked, this.preferredLanguage = 'en'});
  final String userId;
  final String role;
  final String fullName;
  final String phone;
  final String? email;
  final String? nidaMasked;
  final String preferredLanguage;

  String get firstName => fullName.split(' ').first;

  factory User.fromJson(Map<String, dynamic> j) => User(
        userId: _s(j['userId']),
        role: _s(j['role']),
        fullName: _s(j['fullName']),
        phone: _s(j['phone']),
        email: j['email'] as String?,
        nidaMasked: j['nidaMasked'] as String?,
        preferredLanguage: _s(j['preferredLanguage'], 'en'),
      );
}

class OtpChallenge {
  const OtpChallenge({required this.challengeId, required this.sentTo, required this.expiresIn, this.purpose});
  final String challengeId;
  final String sentTo;
  final int expiresIn;
  final String? purpose;

  factory OtpChallenge.fromJson(Map<String, dynamic> j) =>
      OtpChallenge(challengeId: _s(j['challengeId']), sentTo: _s(j['sentTo']), expiresIn: _n(j['expiresIn']).toInt(), purpose: j['purpose'] as String?);
}

class ParcelSummary {
  const ParcelSummary({required this.parcelId, required this.titleNumber, required this.region, required this.district, required this.ward, required this.area, required this.landUse, required this.status, this.updatedAt});
  final String parcelId;
  final String titleNumber;
  final String region;
  final String district;
  final String ward;
  final num area;
  final String landUse;
  final String status;
  final DateTime? updatedAt;

  factory ParcelSummary.fromJson(Map<String, dynamic> j) => ParcelSummary(
        parcelId: _s(j['parcelId']),
        titleNumber: _s(j['titleNumber']),
        region: _s(j['region']),
        district: _s(j['district']),
        ward: _s(j['ward']),
        area: _n(j['area']),
        landUse: _s(j['landUse']),
        status: _s(j['status'], 'ACTIVE'),
        updatedAt: _date(j['ledgerUpdatedAt']),
      );
}

class Parcel {
  const Parcel({
    required this.parcelId,
    required this.titleNumber,
    required this.region,
    required this.district,
    required this.ward,
    required this.blockNumber,
    required this.plotNumber,
    required this.area,
    required this.landUse,
    required this.latitude,
    required this.longitude,
    required this.ownerId,
    required this.ownershipVersion,
    required this.status,
    required this.activeTransferId,
    required this.lastTxId,
    this.createdAt,
    this.updatedAt,
  });
  final String parcelId;
  final String titleNumber;
  final String region;
  final String district;
  final String ward;
  final String blockNumber;
  final String plotNumber;
  final num area;
  final String landUse;
  final double latitude;
  final double longitude;
  final String ownerId;
  final int ownershipVersion;
  final String status;
  final String? activeTransferId;
  final String lastTxId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get transferable => status == 'ACTIVE';

  factory Parcel.fromJson(Map<String, dynamic> j) {
    final loc = (j['location'] as Map<String, dynamic>?) ?? const {};
    final owner = (j['owner'] as Map<String, dynamic>?) ?? const {};
    return Parcel(
      parcelId: _s(j['parcelId']),
      titleNumber: _s(j['titleNumber']),
      region: _s(j['region']),
      district: _s(j['district']),
      ward: _s(j['ward']),
      blockNumber: _s(j['blockNumber']),
      plotNumber: _s(j['plotNumber']),
      area: _n(j['area']),
      landUse: _s(j['landUse']),
      latitude: _n(loc['latitude']).toDouble(),
      longitude: _n(loc['longitude']).toDouble(),
      ownerId: _s(owner['userId'] ?? j['ownerId']),
      ownershipVersion: _n(j['ownershipVersion']).toInt(),
      status: _s(j['status'], 'ACTIVE'),
      activeTransferId: j['activeTransferId'] as String?,
      lastTxId: _s(j['lastTxId']),
      createdAt: _date(j['createdAt']),
      updatedAt: _date(j['updatedAt']),
    );
  }
}

class HistoryEntry {
  const HistoryEntry({required this.txId, required this.timestamp, this.status, this.ownerId, this.ownershipVersion, this.changedByRole, this.changedByMsp, this.note});
  final String txId;
  final DateTime? timestamp;
  final String? status;
  final String? ownerId;
  final int? ownershipVersion;
  final String? changedByRole;
  final String? changedByMsp;
  final String? note;

  factory HistoryEntry.fromJson(Map<String, dynamic> j) {
    final by = j['changedBy'] as Map<String, dynamic>?;
    return HistoryEntry(
      txId: _s(j['txId']),
      timestamp: _date(j['timestamp']),
      status: j['status'] as String?,
      ownerId: j['ownerId'] as String?,
      ownershipVersion: (j['ownershipVersion'] as num?)?.toInt(),
      changedByRole: by?['role'] as String?,
      changedByMsp: by?['mspId'] as String?,
      note: j['note'] as String?,
    );
  }
}

class Party {
  const Party({required this.userId, this.fullName});
  final String userId;
  final String? fullName;

  /// "Juma Hassan" → "Juma H."
  String get shortName {
    final parts = (fullName ?? '').trim().split(RegExp(r'\s+'));
    if (parts.length < 2) return fullName ?? userId;
    return '${parts.first} ${parts.last[0]}.';
  }

  factory Party.fromJson(Map<String, dynamic>? j) => Party(userId: _s(j?['userId']), fullName: j?['fullName'] as String?);
}

class TransferStep {
  const TransferStep({required this.status, required this.at, required this.role, required this.mspId, required this.txId, this.note});
  final String status;
  final DateTime? at;
  final String? role;
  final String mspId;
  final String txId;
  final String? note;

  factory TransferStep.fromJson(Map<String, dynamic> j) {
    final by = (j['by'] as Map<String, dynamic>?) ?? const {};
    return TransferStep(status: _s(j['status']), at: _date(j['at']), role: by['role'] as String?, mspId: _s(by['mspId']), txId: _s(j['txId']), note: j['note'] as String?);
  }
}

class Transfer {
  const Transfer({
    required this.transferId,
    required this.parcelId,
    required this.sellerId,
    required this.buyerId,
    required this.seller,
    required this.buyer,
    required this.status,
    required this.history,
    this.salePrice,
    this.currency,
    this.closedReason,
    this.createdAt,
    this.updatedAt,
  });
  final String transferId;
  final String parcelId;
  final String sellerId;
  final String buyerId;
  final Party seller;
  final Party buyer;
  final String status;
  final List<TransferStep> history;
  final num? salePrice;
  final String? currency;
  final String? closedReason;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  static const open = {'INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED', 'OFFICER_VERIFIED'};
  static const cancellable = {'INITIATED', 'BUYER_ACCEPTED', 'PAYMENTS_CONFIRMED'};
  bool get isOpen => open.contains(status);

  factory Transfer.fromJson(Map<String, dynamic> j) {
    final sale = j['sale'] as Map<String, dynamic>?;
    return Transfer(
      transferId: _s(j['transferId']),
      parcelId: _s(j['parcelId']),
      sellerId: _s(j['sellerId']),
      buyerId: _s(j['buyerId']),
      seller: Party.fromJson(j['seller'] as Map<String, dynamic>?),
      buyer: Party.fromJson(j['buyer'] as Map<String, dynamic>?),
      status: _s(j['status']),
      history: _list(j['history'], TransferStep.fromJson),
      salePrice: sale?['salePrice'] as num?,
      currency: sale?['currency'] as String?,
      closedReason: j['closedReason'] as String?,
      createdAt: _date(j['createdAt']),
      updatedAt: _date(j['updatedAt']),
    );
  }
}

class TransferSummary {
  const TransferSummary({required this.transferId, required this.parcelId, required this.sellerId, required this.buyerId, required this.status, this.updatedAt});
  final String transferId;
  final String parcelId;
  final String sellerId;
  final String buyerId;
  final String status;
  final DateTime? updatedAt;

  factory TransferSummary.fromJson(Map<String, dynamic> j) => TransferSummary(
        transferId: _s(j['transferId']),
        parcelId: _s(j['parcelId']),
        sellerId: _s(j['sellerId']),
        buyerId: _s(j['buyerId']),
        status: _s(j['status']),
        updatedAt: _date(j['ledgerUpdatedAt']),
      );
}

class DocumentRef {
  const DocumentRef({required this.documentId, required this.documentType, required this.sha256, required this.version, required this.status, this.fileName, this.createdAt});
  final String documentId;
  final String documentType;
  final String sha256;
  final int version;
  final String status;
  final String? fileName;
  final DateTime? createdAt;

  factory DocumentRef.fromJson(Map<String, dynamic> j) => DocumentRef(
        documentId: _s(j['documentId']),
        documentType: _s(j['documentType']),
        sha256: _s(j['sha256']),
        version: _n(j['version']).toInt(),
        status: _s(j['status'], 'ACTIVE'),
        fileName: (j['file'] as Map<String, dynamic>?)?['name'] as String?,
        createdAt: _date(j['createdAt']),
      );
}

class NotificationItem {
  const NotificationItem({required this.id, required this.type, required this.title, required this.body, this.parcelId, this.transferId, this.readAt, this.createdAt});
  final String id;
  final String type;
  final String title;
  final String body;
  final String? parcelId;
  final String? transferId;
  final DateTime? readAt;
  final DateTime? createdAt;

  factory NotificationItem.fromJson(Map<String, dynamic> j) {
    final d = (j['data'] as Map<String, dynamic>?) ?? const {};
    return NotificationItem(
      id: _s(j['_id']),
      type: _s(j['type']),
      title: _s(j['title']),
      body: _s(j['body']),
      parcelId: d['parcelId'] as String?,
      transferId: d['transferId'] as String?,
      readAt: _date(j['readAt']),
      createdAt: _date(j['createdAt']),
    );
  }
}

/// `202 { txId, status: "SUBMITTED", … }` from a ledger write.
class Submitted {
  const Submitted({required this.txId, this.extra = const {}});
  final String txId;
  final Map<String, dynamic> extra;

  factory Submitted.fromJson(Map<String, dynamic> j) => Submitted(txId: _s(j['txId']), extra: j);
}

class LedgerTxStatus {
  const LedgerTxStatus({required this.txId, required this.status, this.blockNumber});
  final String txId;
  final String status;
  final int? blockNumber;

  factory LedgerTxStatus.fromJson(Map<String, dynamic> j) =>
      LedgerTxStatus(txId: _s(j['txId']), status: _s(j['status']), blockNumber: (j['blockNumber'] as num?)?.toInt());
}

class ParcelVerification {
  const ParcelVerification({required this.parcelId, required this.titleNumber, required this.region, required this.district, required this.ward, required this.area, required this.status, required this.owner, required this.encumbered, required this.disputed, required this.lastTxId});
  final String parcelId;
  final String titleNumber;
  final String region;
  final String district;
  final String ward;
  final num area;
  final String status;
  final String owner;
  final bool encumbered;
  final bool disputed;
  final String lastTxId;

  factory ParcelVerification.fromJson(Map<String, dynamic> j) => ParcelVerification(
        parcelId: _s(j['parcelId']),
        titleNumber: _s(j['titleNumber']),
        region: _s(j['region']),
        district: _s(j['district']),
        ward: _s(j['ward']),
        area: _n(j['area']),
        status: _s(j['status']),
        owner: _s(j['owner']),
        encumbered: j['encumbered'] == true,
        disputed: j['disputed'] == true,
        lastTxId: _s(j['lastTxId']),
      );
}

class DocumentVerification {
  const DocumentVerification({required this.documentId, required this.match, required this.status, required this.documentType, required this.parcelId});
  final String documentId;
  final bool match;
  final String status;
  final String documentType;
  final String parcelId;

  factory DocumentVerification.fromJson(Map<String, dynamic> j) =>
      DocumentVerification(documentId: _s(j['documentId']), match: j['match'] == true, status: _s(j['status']), documentType: _s(j['documentType']), parcelId: _s(j['parcelId']));
}
