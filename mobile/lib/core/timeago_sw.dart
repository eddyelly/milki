import 'package:timeago/timeago.dart' as timeago;

/// Kiswahili for "time ago" labels (the timeago package ships no Swahili). Each phrase carries its own agreement
/// ("dakika 5 zilizopita", "saa moja iliyopita"), so the generic prefix/suffix stay empty.
class SwMessages implements timeago.LookupMessages {
  @override
  String prefixAgo() => '';
  @override
  String prefixFromNow() => 'baada ya';
  @override
  String suffixAgo() => '';
  @override
  String suffixFromNow() => '';
  @override
  String lessThanOneMinute(int seconds) => 'sasa hivi';
  @override
  String aboutAMinute(int minutes) => 'dakika moja iliyopita';
  @override
  String minutes(int minutes) => 'dakika $minutes zilizopita';
  @override
  String aboutAnHour(int minutes) => 'saa moja iliyopita';
  @override
  String hours(int hours) => 'saa $hours zilizopita';
  @override
  String aDay(int hours) => 'jana';
  @override
  String days(int days) => 'siku $days zilizopita';
  @override
  String aboutAMonth(int days) => 'mwezi mmoja uliopita';
  @override
  String months(int months) => 'miezi $months iliyopita';
  @override
  String aboutAYear(int year) => 'mwaka mmoja uliopita';
  @override
  String years(int years) => 'miaka $years iliyopita';
  @override
  String wordSeparator() => ' ';
}

void registerTimeagoLocales() => timeago.setLocaleMessages('sw', SwMessages());
