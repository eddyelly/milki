/// Build-time configuration (CLAUDE.md §6):
///   flutter run --dart-define=API_URL=http://10.0.2.2:4100/api/v1
/// On a physical device use the dev machine's LAN IP.
class AppConfig {
  const AppConfig._();

  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:4100/api/v1');

  /// Socket.IO lives on the API origin (without `/api/v1`).
  static String get socketUrl => Uri.parse(apiUrl).replace(path: '').toString().replaceAll(RegExp(r'/$'), '');
}
