import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/milki_theme.dart';
import '../../data/support_models.dart';
import '../../state/providers.dart';
import '../widgets/common.dart';
import '../widgets/markdown_lite.dart';

/// Help centre (CLAUDE.md §11): searchable articles by category in English and Swahili, then a human.
class HelpScreen extends ConsumerStatefulWidget {
  const HelpScreen({super.key});

  @override
  ConsumerState<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends ConsumerState<HelpScreen> {
  final _search = TextEditingController();
  String _q = '';
  String? _category;
  Timer? _debounce;

  @override
  void dispose() {
    _search.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final lang = Localizations.localeOf(context).languageCode;
    final cats = ref.watch(kbCategoriesProvider);
    final articles = ref.watch(kbArticlesProvider((q: _q, category: _category)));
    return Scaffold(
      appBar: AppBar(title: Text(l.helpTitle)),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(kbCategoriesProvider);
          ref.invalidate(kbArticlesProvider);
        },
        child: ListView(padding: const EdgeInsets.all(16), children: [
          _ContactCard(onTap: () => context.go('/help/tickets')),
          const SizedBox(height: 16),
          TextField(
            key: const Key('kb-search'),
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.searchHelp),
            onChanged: (v) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 300), () => setState(() => _q = v));
            },
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 40,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              _Chip(label: l.all, selected: _category == null, onTap: () => setState(() => _category = null)),
              for (final c in cats.value ?? const <KbCategory>[])
                _Chip(label: c.name.of(lang), selected: _category == c.slug, onTap: () => setState(() => _category = c.slug)),
            ]),
          ),
          const SizedBox(height: 12),
          articles.when(
            loading: () => const Column(children: [SkeletonBox(height: 88), SizedBox(height: 10), SkeletonBox(height: 88)]),
            error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(kbArticlesProvider)),
            data: (list) => list.isEmpty
                ? Padding(padding: const EdgeInsets.only(top: 24), child: EmptyState(icon: Icons.search_off, title: l.noResults))
                : Column(children: [
                    for (final a in list)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Card(
                          key: Key('kb-${a.slug}'),
                          child: ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                            title: Text(a.title.of(lang), style: context.text.titleSmall),
                            subtitle: Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(a.body.of(lang).replaceAll('**', ''), maxLines: 2, overflow: TextOverflow.ellipsis),
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => context.go('/help/articles/${a.slug}'),
                          ),
                        ),
                      ),
                  ]),
          ),
        ]),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap(), showCheckmark: false),
      );
}

class _ContactCard extends ConsumerWidget {
  const _ContactCard({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final open = (ref.watch(myTicketsProvider).value ?? const <Ticket>[]).where((t) => t.isOpen).length;
    return Pressable(
      onTap: onTap,
      child: Card(
        key: const Key('contact-support'),
        color: context.milki.primaryDeep,
        clipBehavior: Clip.antiAlias,
        child: Stack(children: [
          Positioned.fill(child: TopoBackground(color: Colors.white.withValues(alpha: .07))),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              CircleAvatar(radius: 22, backgroundColor: context.milki.gold, child: const Icon(Icons.support_agent, color: MilkiColors.primaryDeep)),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l.talkToUs, style: context.text.titleMedium?.copyWith(color: Colors.white)),
                  Text(open > 0 ? l.openTickets(open) : l.talkToUsBody, style: context.text.bodyMedium?.copyWith(color: Colors.white70)),
                ]),
              ),
              const Icon(Icons.chevron_right, color: Colors.white),
            ]),
          ),
        ]),
      ),
    );
  }
}

class ArticleScreen extends ConsumerStatefulWidget {
  const ArticleScreen({super.key, required this.slug});
  final String slug;

  @override
  ConsumerState<ArticleScreen> createState() => _ArticleScreenState();
}

class _ArticleScreenState extends ConsumerState<ArticleScreen> {
  bool? _voted;

  /// Votes are feedback, not data (one per reader, changeable), so no confirmation sheet.
  Future<void> _vote(bool helpful) async {
    try {
      await ref.read(supportRepositoryProvider).vote(widget.slug, helpful);
      setState(() => _voted = helpful);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiException.from(e).message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final lang = Localizations.localeOf(context).languageCode;
    final a = ref.watch(kbArticleProvider(widget.slug));
    return Scaffold(
      appBar: AppBar(),
      body: a.when(
        loading: () => const SkeletonList(count: 3, height: 60),
        error: (e, _) => ErrorState(error: e, onRetry: () => ref.invalidate(kbArticleProvider(widget.slug))),
        data: (a) => ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 32), children: [
          Text(a.title.of(lang), style: context.text.headlineSmall),
          const SizedBox(height: 16),
          MarkdownLite(a.body.of(lang)),
          const Divider(height: 32),
          AnimatedSwitcher(
            duration: reduceMotion(context) ? Duration.zero : const Duration(milliseconds: 250),
            child: _voted != null
                ? Row(key: const ValueKey('thanks'), children: [
                    Icon(Icons.check_circle, color: context.milki.success),
                    const SizedBox(width: 8),
                    Expanded(child: Text(l.thanksFeedback, style: context.text.titleSmall)),
                  ])
                : Column(key: const ValueKey('ask'), crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.wasHelpful, style: context.text.titleSmall),
                    const SizedBox(height: 8),
                    Row(children: [
                      OutlinedButton.icon(key: const Key('vote-yes'), onPressed: () => _vote(true), icon: const Icon(Icons.thumb_up_outlined), label: Text(l.yes)),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(key: const Key('vote-no'), onPressed: () => _vote(false), icon: const Icon(Icons.thumb_down_outlined), label: Text(l.no)),
                    ]),
                  ]),
          ),
          const SizedBox(height: 24),
          TextButton.icon(onPressed: () => context.go('/help/tickets/new'), icon: const Icon(Icons.support_agent), label: Text(l.stillNeedHelp)),
        ]).animate().fadeIn(duration: reduceMotion(context) ? 0.ms : 200.ms),
      ),
    );
  }
}
