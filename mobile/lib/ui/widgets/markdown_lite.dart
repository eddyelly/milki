import 'package:flutter/material.dart';

import '../../core/theme/milki_theme.dart';

/// Help-article text (same subset as the web): paragraphs, "- " lists and **bold**.
class MarkdownLite extends StatelessWidget {
  const MarkdownLite(this.text, {super.key});
  final String text;

  List<InlineSpan> _inline(String s, TextStyle? base) {
    final out = <InlineSpan>[];
    final re = RegExp(r'\*\*([^*]+)\*\*');
    var i = 0;
    for (final m in re.allMatches(s)) {
      if (m.start > i) out.add(TextSpan(text: s.substring(i, m.start)));
      out.add(TextSpan(text: m.group(1), style: const TextStyle(fontWeight: FontWeight.w700)));
      i = m.end;
    }
    if (i < s.length) out.add(TextSpan(text: s.substring(i)));
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final style = context.text.bodyLarge?.copyWith(height: 1.55);
    final blocks = text.trim().split(RegExp(r'\n\s*\n'));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final b in blocks)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: b.split('\n').every((l) => l.trim().startsWith('- '))
              ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  for (final l in b.split('\n'))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Padding(padding: const EdgeInsets.only(top: 9, right: 10, left: 4), child: CircleAvatar(radius: 3, backgroundColor: context.colors.primary)),
                        Expanded(child: Text.rich(TextSpan(children: _inline(l.trim().substring(2), style)), style: style)),
                      ]),
                    ),
                ])
              : Text.rich(TextSpan(children: _inline(b, style)), style: style),
        ),
    ]);
  }
}
