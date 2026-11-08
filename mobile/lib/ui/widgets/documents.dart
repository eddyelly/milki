import 'package:flutter/material.dart';

import '../../core/theme/milki_theme.dart';
import '../../data/models.dart';
import 'common.dart';

/// Documents attached on-chain: only the SHA-256 fingerprint lives on the ledger (CLAUDE.md rule 5).
class DocumentList extends StatelessWidget {
  const DocumentList({super.key, required this.documents});
  final List<DocumentRef> documents;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    if (documents.isEmpty) {
      return Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(l.noDocuments, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)));
    }
    return Card(
      child: Column(children: [
        for (final (i, d) in documents.indexed) ...[
          if (i > 0) const Divider(height: 1),
          ListTile(
            leading: CircleAvatar(
              backgroundColor: context.colors.primary.withValues(alpha: .1),
              child: Icon(d.status == 'SUPERSEDED' ? Icons.history : Icons.description_outlined, color: context.colors.primary, size: 20),
            ),
            title: Text(titleCase(d.documentType), style: context.text.titleSmall),
            subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (d.fileName != null) Text(d.fileName!, maxLines: 1, overflow: TextOverflow.ellipsis),
              Row(children: [
                Icon(Icons.fingerprint, size: 14, color: context.milki.goldInk),
                const SizedBox(width: 4),
                Flexible(child: MonoText(d.sha256, short: true, size: 11)),
              ]),
            ]),
            trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text('v${d.version}', style: context.text.labelMedium),
              Text(fmtDate(d.createdAt), style: context.text.bodySmall),
            ]),
          ),
        ],
      ]),
    );
  }
}
