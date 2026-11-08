import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:hive_ce_flutter/hive_ce_flutter.dart';

import 'app.dart';
import 'core/push.dart';
import 'core/timeago_sw.dart';
import 'state/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Plus Jakarta Sans and JetBrains Mono ship in assets/google_fonts (no runtime download).
  GoogleFonts.config.allowRuntimeFetching = false;
  registerTimeagoLocales();
  await Hive.initFlutter();
  final box = await Hive.openBox<dynamic>('milki.settings');
  await Push.init();
  runApp(ProviderScope(
    overrides: [
      settingsBoxProvider.overrideWithValue(box),
      settingsProvider.overrideWith(() => SettingsController(box)),
    ],
    child: const MilkiApp(),
  ));
}
