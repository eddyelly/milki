import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_ce_flutter/hive_ce_flutter.dart';

import '../core/api/api_client.dart';
import '../core/api/token_store.dart';
import '../core/ledger_events.dart';
import '../core/push.dart';
import '../core/reauth.dart';
import '../core/support_chat.dart';
import '../data/models.dart';
import '../data/repositories.dart';
import '../data/support_models.dart';
import '../data/support_repository.dart';

// --------------------------------------------------------------------------------------------- core
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(tokens: ref.watch(tokenStoreProvider), onSessionExpired: () => ref.read(sessionProvider.notifier).expired());
});

final authRepositoryProvider = Provider((ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider)));
final parcelRepositoryProvider = Provider((ref) => ParcelRepository(ref.watch(apiClientProvider)));
final transferRepositoryProvider = Provider((ref) => TransferRepository(ref.watch(apiClientProvider)));
final notificationRepositoryProvider = Provider((ref) => NotificationRepository(ref.watch(apiClientProvider)));
final ledgerRepositoryProvider = Provider((ref) => LedgerRepository(ref.watch(apiClientProvider)));

final ledgerEventsProvider = Provider<LedgerEvents>((ref) {
  final events = SocketLedgerEvents(ref.watch(ledgerRepositoryProvider));
  ref.onDispose(events.disconnect);
  return events;
});

final supportRepositoryProvider = Provider((ref) => SupportRepository(ref.watch(apiClientProvider)));

final supportChatProvider = Provider<SupportChat>((ref) {
  final chat = SocketSupportChat();
  ref.onDispose(chat.disconnect);
  return chat;
});

final reauthenticatorProvider = Provider<Reauthenticator>((ref) => DeviceReauthenticator(ref.watch(authRepositoryProvider)));

// ------------------------------------------------------------------------------------------ session
sealed class SessionState {
  const SessionState();
}

class SessionLoading extends SessionState {
  const SessionLoading();
}

class SignedOut extends SessionState {
  const SignedOut({this.expired = false});
  final bool expired;
}

class SignedIn extends SessionState {
  const SignedIn(this.user);
  final User user;
}

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() {
    unawaited(_restore());
    return const SessionLoading();
  }

  Future<void> _restore() async {
    final user = await ref.read(authRepositoryProvider).restore();
    if (user != null) {
      _onSignedIn(user);
    } else {
      state = const SignedOut();
    }
  }

  void _onSignedIn(User user) {
    final token = ref.read(tokenStoreProvider).accessToken;
    if (token != null) {
      ref.read(ledgerEventsProvider).connect(token);
      ref.read(supportChatProvider).connect(token);
    }
    unawaited(Push.register(ref.read(notificationRepositoryProvider)));
    state = SignedIn(user);
  }

  /// Citizens only: the mobile app is the landowner client (CLAUDE.md §2).
  void signedIn(User user) => _onSignedIn(user);

  Future<void> signOut() async {
    ref.read(ledgerEventsProvider).disconnect();
    ref.read(supportChatProvider).disconnect();
    await Push.unregister();
    await ref.read(authRepositoryProvider).logout();
    state = const SignedOut();
  }

  void expired() {
    ref.read(ledgerEventsProvider).disconnect();
    ref.read(supportChatProvider).disconnect();
    state = const SignedOut(expired: true);
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

User? currentUserOf(SessionState s) => s is SignedIn ? s.user : null;

// ----------------------------------------------------------------------------------------- settings
class Settings {
  const Settings({this.locale, this.themeMode = ThemeMode.system});
  final Locale? locale;
  final ThemeMode themeMode;
}

/// Language and theme, persisted in a Hive box (null box in tests → in-memory only).
class SettingsController extends Notifier<Settings> {
  SettingsController([this._box]);
  final Box<dynamic>? _box;

  @override
  Settings build() {
    final lang = _box?.get('language') as String?;
    final theme = _box?.get('theme') as String?;
    return Settings(locale: lang == null ? null : Locale(lang), themeMode: ThemeMode.values.firstWhere((m) => m.name == theme, orElse: () => ThemeMode.system));
  }

  void setLocale(Locale locale) {
    _box?.put('language', locale.languageCode);
    state = Settings(locale: locale, themeMode: state.themeMode);
  }

  void setTheme(ThemeMode mode) {
    _box?.put('theme', mode.name);
    state = Settings(locale: state.locale, themeMode: mode);
  }
}

final settingsBoxProvider = Provider<Box<dynamic>?>((ref) => null);
final settingsProvider = NotifierProvider<SettingsController, Settings>(() => throw UnimplementedError('overridden in main()'));

// ----------------------------------------------------------------------------------------------- data
/// Re-fetches whenever the ledger reports a change for this user (socket `ledger:event` / `notification`).
void _refreshOnLedgerChange(Ref ref) {
  final sub = ref.watch(ledgerEventsProvider).changes.listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
}

final myParcelsProvider = FutureProvider.autoDispose<List<ParcelSummary>>((ref) {
  _refreshOnLedgerChange(ref);
  return ref.watch(parcelRepositoryProvider).mine();
});

final parcelProvider = FutureProvider.autoDispose.family<Parcel, String>((ref, id) {
  _refreshOnLedgerChange(ref);
  return ref.watch(parcelRepositoryProvider).get(id);
});

final parcelHistoryProvider = FutureProvider.autoDispose.family<List<HistoryEntry>, String>((ref, id) {
  _refreshOnLedgerChange(ref);
  return ref.watch(parcelRepositoryProvider).history(id);
});

final parcelDocumentsProvider = FutureProvider.autoDispose.family<List<DocumentRef>, String>((ref, id) => ref.watch(parcelRepositoryProvider).documents(id));

final myTransfersProvider = FutureProvider.autoDispose<List<TransferSummary>>((ref) {
  _refreshOnLedgerChange(ref);
  return ref.watch(transferRepositoryProvider).mine();
});

final transferProvider = FutureProvider.autoDispose.family<Transfer, String>((ref, id) {
  _refreshOnLedgerChange(ref);
  return ref.watch(transferRepositoryProvider).get(id);
});

final transferDocumentsProvider = FutureProvider.autoDispose.family<List<DocumentRef>, String>((ref, id) {
  _refreshOnLedgerChange(ref);
  return ref.watch(transferRepositoryProvider).documents(id);
});

final notificationsProvider = FutureProvider.autoDispose<({List<NotificationItem> items, int unread})>((ref) {
  _refreshOnLedgerChange(ref);
  return ref.watch(notificationRepositoryProvider).list();
});

// ------------------------------------------------------------------------------------------ support
final kbCategoriesProvider = FutureProvider.autoDispose<List<KbCategory>>((ref) => ref.watch(supportRepositoryProvider).categories());

typedef KbQuery = ({String q, String? category});
final kbArticlesProvider = FutureProvider.autoDispose.family<List<KbArticle>, KbQuery>(
  (ref, k) => ref.watch(supportRepositoryProvider).articles(q: k.q.trim().isEmpty ? null : k.q.trim(), category: k.category),
);

final kbArticleProvider = FutureProvider.autoDispose.family<KbArticle, String>((ref, slug) => ref.watch(supportRepositoryProvider).article(slug));

/// Refreshes when support writes back on /support (ticket updates, new replies).
void _refreshOnSupportChange(Ref ref, bool Function(ChatEvent e) when) {
  final sub = ref.watch(supportChatProvider).events.where(when).listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
}

final myTicketsProvider = FutureProvider.autoDispose<List<Ticket>>((ref) {
  _refreshOnSupportChange(ref, (e) => e is TicketUpdatedEvent || e is MessageEvent);
  _refreshOnLedgerChange(ref); // replies to offline users arrive as notifications
  return ref.watch(supportRepositoryProvider).myTickets();
});

final ticketProvider = FutureProvider.autoDispose.family<Ticket, String>((ref, id) => ref.watch(supportRepositoryProvider).ticket(id));
