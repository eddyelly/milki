import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../widgets/common.dart';

/// Bottom navigation: Home, Parcels, Transfers, Verify, Help (CLAUDE.md §9.3).
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home_rounded), label: l.navHome),
          NavigationDestination(icon: const Icon(Icons.map_outlined), selectedIcon: const Icon(Icons.map_rounded), label: l.navParcels),
          NavigationDestination(icon: const Icon(Icons.swap_horiz_outlined), selectedIcon: const Icon(Icons.swap_horiz_rounded), label: l.navTransfers),
          NavigationDestination(icon: const Icon(Icons.qr_code_scanner_outlined), selectedIcon: const Icon(Icons.qr_code_scanner_rounded), label: l.navVerify),
          NavigationDestination(icon: const Icon(Icons.help_outline), selectedIcon: const Icon(Icons.help_rounded), label: l.navHelp),
        ],
      ),
    );
  }
}
