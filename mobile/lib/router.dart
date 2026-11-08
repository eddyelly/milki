import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'data/models.dart';
import 'state/providers.dart';
import 'ui/screens/auth_screens.dart';
import 'ui/screens/help_screen.dart';
import 'ui/screens/home_screen.dart';
import 'ui/screens/notifications_screen.dart';
import 'ui/screens/parcel_screens.dart';
import 'ui/screens/settings_screen.dart';
import 'ui/screens/shell.dart';
import 'ui/screens/transfer_screens.dart';
import 'ui/screens/verify_screen.dart';

/// Routes reachable without signing in. `/check` is public QR verification (no account needed).
const _public = {'/login', '/register', '/otp', '/check'};

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, _) => refresh.value++);

  final router = GoRouter(
    initialLocation: '/home',
    refreshListenable: refresh,
    redirect: (context, state) {
      final session = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      if (session is SessionLoading) return loc == '/splash' ? null : '/splash';
      if (session is SignedOut) return _public.contains(loc) ? null : '/login';
      if (loc == '/splash' || loc == '/login' || loc == '/register' || loc == '/otp') return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(
        path: '/otp',
        redirect: (_, state) => state.extra is OtpChallenge ? null : '/login',
        builder: (_, state) => OtpScreen(challenge: state.extra! as OtpChallenge),
      ),
      GoRoute(path: '/check', builder: (_, _) => const VerifyScreen(standalone: true)),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => const HomeScreen())]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/parcels',
              builder: (_, _) => const ParcelsScreen(),
              routes: [
                GoRoute(
                  path: ':parcelId',
                  builder: (_, s) => ParcelDetailScreen(parcelId: s.pathParameters['parcelId']!),
                  routes: [GoRoute(path: 'transfer', builder: (_, s) => InitiateTransferScreen(parcelId: s.pathParameters['parcelId']!))],
                ),
              ],
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/transfers',
              builder: (_, _) => const TransfersScreen(),
              routes: [GoRoute(path: ':transferId', builder: (_, s) => TransferDetailScreen(transferId: s.pathParameters['transferId']!))],
            ),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/verify', builder: (_, _) => const VerifyScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/help', builder: (_, _) => const HelpScreen())]),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});
