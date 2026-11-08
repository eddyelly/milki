import 'package:flutter/material.dart';

import '../../core/theme/milki_theme.dart';
import '../widgets/common.dart';

/// Phase 7 help: common questions in English and Swahili. The knowledge base, tickets and live chat arrive in
/// Phase 8 (CLAUDE.md §11).
class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key});

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final faqs = [
      (Icons.swap_horiz, l.faqTransferQ, l.faqTransferA),
      (Icons.account_balance_outlined, l.faqMortgageQ, l.faqMortgageA),
      (Icons.qr_code_scanner, l.faqVerifyQ, l.faqVerifyA),
      (Icons.lock_outline, l.faqPrivacyQ, l.faqPrivacyA),
      (Icons.fingerprint, l.faqBiometricQ, l.faqBiometricA),
    ];
    final q = _q.toLowerCase();
    final shown = faqs.where((f) => q.isEmpty || f.$2.toLowerCase().contains(q) || f.$3.toLowerCase().contains(q)).toList();
    return Scaffold(
      appBar: AppBar(title: Text(l.helpTitle)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(l.helpSubtitle, style: context.text.bodyMedium?.copyWith(color: context.colors.onSurfaceVariant)),
        const SizedBox(height: 12),
        TextField(decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.searchHelp), onChanged: (v) => setState(() => _q = v)),
        const SizedBox(height: 12),
        if (shown.isEmpty) EmptyState(icon: Icons.search_off, title: l.noResults),
        for (final (icon, question, answer) in shown)
          Card(
            child: Theme(
              data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                leading: Icon(icon, color: context.colors.primary),
                title: Text(question, style: context.text.titleSmall),
                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                expandedCrossAxisAlignment: CrossAxisAlignment.start,
                children: [Text(answer, style: context.text.bodyMedium)],
              ),
            ),
          ),
        const SizedBox(height: 16),
        Card(
          color: context.milki.primaryDeep,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              const Icon(Icons.support_agent, color: Colors.white),
              const SizedBox(width: 12),
              Expanded(child: Text(l.contactOffice, style: const TextStyle(color: Colors.white))),
            ]),
          ),
        ),
      ]),
    );
  }
}
