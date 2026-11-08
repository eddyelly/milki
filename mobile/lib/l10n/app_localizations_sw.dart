// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Swahili (`sw`).
class AppLocalizationsSw extends AppLocalizations {
  AppLocalizationsSw([String locale = 'sw']) : super(locale);

  @override
  String get appName => 'Milki';

  @override
  String get tagline => 'Ardhi yako, kumbukumbu ya kudumu.';

  @override
  String get navHome => 'Nyumbani';

  @override
  String get navParcels => 'Viwanja';

  @override
  String get navTransfers => 'Uhamisho';

  @override
  String get navVerify => 'Hakiki';

  @override
  String get navHelp => 'Msaada';

  @override
  String get signInTitle => 'Ingia';

  @override
  String get signInSubtitle =>
      'Tumia namba ya simu na nenosiri ulilojisajili nalo.';

  @override
  String get phoneOrEmail => 'Namba ya simu au barua pepe';

  @override
  String get password => 'Nenosiri';

  @override
  String get continueAction => 'Endelea';

  @override
  String get createAccount => 'Fungua akaunti';

  @override
  String get haveAccount => 'Tayari umejisajili? Ingia';

  @override
  String get registerTitle => 'Fungua akaunti yako ya Milki';

  @override
  String get fullName => 'Jina kamili';

  @override
  String get phone => 'Namba ya simu';

  @override
  String get nida => 'Namba ya NIDA';

  @override
  String get emailOptional => 'Barua pepe (si lazima)';

  @override
  String get passwordHint => 'Angalau herufi 8, pamoja na namba';

  @override
  String get language => 'Lugha';

  @override
  String get otpTitle => 'Weka msimbo wako';

  @override
  String otpSentTo(String destination) {
    return 'Tumetuma msimbo wa tarakimu 6 kwa $destination. Unaisha baada ya dakika 5.';
  }

  @override
  String get verifyAndContinue => 'Thibitisha na uendelee';

  @override
  String get resendCode => 'Tuma msimbo tena';

  @override
  String resendIn(int seconds) {
    return 'Tuma tena baada ya sekunde $seconds';
  }

  @override
  String get back => 'Rudi';

  @override
  String get fieldRequired => 'Sehemu hii inahitajika.';

  @override
  String get invalidPhone =>
      'Weka namba sahihi ya simu ya Tanzania, mfano 0712 345 678.';

  @override
  String get invalidNida => 'Weka namba yako ya NIDA yenye tarakimu 20.';

  @override
  String get invalidPassword => 'Tumia angalau herufi 8 pamoja na namba.';

  @override
  String get greetingMorning => 'Habari za asubuhi';

  @override
  String get greetingAfternoon => 'Habari za mchana';

  @override
  String get greetingEvening => 'Habari za jioni';

  @override
  String get myParcels => 'Viwanja vyangu';

  @override
  String get waitingForYou => 'Vinakusubiri';

  @override
  String get recentActivity => 'Matukio ya karibuni';

  @override
  String get noActivity =>
      'Hakuna jipya. Taarifa kuhusu ardhi yako zitaonekana hapa.';

  @override
  String get quickVerify => 'Hakiki hati';

  @override
  String get quickTransfer => 'Hamisha ardhi';

  @override
  String get seeAll => 'Ona yote';

  @override
  String get parcelsTitle => 'Viwanja vyangu';

  @override
  String get noParcels => 'Bado hakuna viwanja';

  @override
  String get noParcelsBody =>
      'Viwanja vilivyosajiliwa kwa jina lako na msajili vitaonekana hapa.';

  @override
  String get area => 'Eneo';

  @override
  String get landUse => 'Matumizi ya ardhi';

  @override
  String get titleNumber => 'Namba ya hati';

  @override
  String get location => 'Mahali';

  @override
  String get registeredOn => 'Kimesajiliwa';

  @override
  String get ownershipVersion => 'Toleo la umiliki';

  @override
  String get lastTransaction => 'Muamala wa mwisho';

  @override
  String get history => 'Historia';

  @override
  String get documents => 'Nyaraka';

  @override
  String get noDocuments => 'Bado hakuna nyaraka zilizoambatishwa.';

  @override
  String get shareProof => 'Shiriki uthibitisho wa umiliki';

  @override
  String get shareProofBody =>
      'Mtu yeyote anaweza kuchanganua msimbo huu kwenye programu ya Milki kuhakiki kiwanja hiki.';

  @override
  String get transferThisParcel => 'Hamisha kiwanja hiki';

  @override
  String get cannotTransfer => 'Kiwanja hiki hakiwezi kuhamishwa kwa sasa.';

  @override
  String registeredTo(String name) {
    return 'Kimesajiliwa kwa $name';
  }

  @override
  String get ownerChanged => 'Mmiliki amebadilika';

  @override
  String get statusChanged => 'Hali imebadilika';

  @override
  String get transfersTitle => 'Uhamisho';

  @override
  String get asSeller => 'Ninauza';

  @override
  String get asBuyer => 'Ninanunua';

  @override
  String get noTransfers => 'Bado hakuna uhamisho';

  @override
  String get noTransfersBody =>
      'Uhamisho unaoanzisha au unaopokea utaonekana hapa.';

  @override
  String get seller => 'Muuzaji';

  @override
  String get buyer => 'Mnunuzi';

  @override
  String get salePrice => 'Bei ya mauzo';

  @override
  String get privateData =>
      'Siri — huhifadhiwa kwa Wizara na Ofisi ya Ardhi pekee, kamwe si kwenye daftari la umma.';

  @override
  String get acceptTransfer => 'Kubali uhamisho';

  @override
  String get cancelTransfer => 'Sitisha uhamisho';

  @override
  String get uploadDocument => 'Pakia hati';

  @override
  String startTransferTitle(String parcelId) {
    return 'Hamisha $parcelId';
  }

  @override
  String get buyerPhone => 'Namba ya simu ya mnunuzi';

  @override
  String get findBuyer => 'Tafuta mnunuzi';

  @override
  String buyerFound(String name) {
    return 'Mnunuzi: $name';
  }

  @override
  String get salePriceTzs => 'Bei ya mauzo (TZS)';

  @override
  String get reviewTransfer => 'Kagua uhamisho';

  @override
  String get documentType => 'Aina ya hati';

  @override
  String get chooseFile => 'Chagua faili';

  @override
  String get stepInitiated => 'Umeanzishwa';

  @override
  String get stepAccepted => 'Mnunuzi amekubali';

  @override
  String get stepPayments => 'Malipo yamethibitishwa';

  @override
  String get stepVerified => 'Umehakikiwa';

  @override
  String get stepRecorded => 'Umeidhinishwa na kurekodiwa';

  @override
  String get closedCancelled => 'Umesitishwa na muuzaji.';

  @override
  String get closedRejected => 'Umekataliwa na ofisi ya ardhi.';

  @override
  String get statusActive => 'Hai';

  @override
  String get statusPendingTransfer => 'Uhamisho unaendelea';

  @override
  String get statusEncumbered => 'Ina rehani';

  @override
  String get statusDisputed => 'Mgogoro';

  @override
  String get statusFrozen => 'Imezuiliwa';

  @override
  String get statusRetired => 'Imestaafishwa';

  @override
  String get statusInitiated => 'Umeanzishwa';

  @override
  String get statusBuyerAccepted => 'Mnunuzi amekubali';

  @override
  String get statusPaymentsConfirmed => 'Malipo yamethibitishwa';

  @override
  String get statusOfficerVerified => 'Umehakikiwa';

  @override
  String get statusApproved => 'Umeidhinishwa';

  @override
  String get statusCompleted => 'Umekamilika';

  @override
  String get statusCancelled => 'Umesitishwa';

  @override
  String get statusRejected => 'Umekataliwa';

  @override
  String get confirm => 'Thibitisha';

  @override
  String get cancel => 'Ghairi';

  @override
  String get done => 'Imekamilika';

  @override
  String get tryAgain => 'Jaribu tena';

  @override
  String get confirmItsYou => 'Thibitisha kuwa ni wewe';

  @override
  String ledgerStep(int step) {
    return 'Kitendo cha daftari · hatua $step kati ya 2';
  }

  @override
  String get permanentWarning =>
      'Hili ni la kudumu na linaweza kukaguliwa na umma. Litasainiwa kwa utambulisho wako wa daftari.';

  @override
  String typeToConfirm(String value) {
    return 'Andika $value kuthibitisha';
  }

  @override
  String get useBiometrics => 'Thibitisha kwa alama ya kidole au uso';

  @override
  String get usePasswordInstead => 'Tumia nenosiri badala yake';

  @override
  String get biometricReason => 'Thibitisha kitendo hiki cha daftari la ardhi';

  @override
  String get signAndRecord => 'Saini na urekodi';

  @override
  String get submitting => 'Inatuma';

  @override
  String get endorsing => 'Inaidhinishwa';

  @override
  String get committed => 'Imerekodiwa';

  @override
  String get submittingBody =>
      'Inasaini kwa utambulisho wako na kutuma kwa peers…';

  @override
  String get endorsingBody =>
      'Peers wa Wizara na Ofisi ya Ardhi wanaidhinisha; inasubiri bloku…';

  @override
  String sealedInBlock(int block) {
    return 'Imehifadhiwa kwenye daftari katika bloku #$block';
  }

  @override
  String get transaction => 'Muamala';

  @override
  String get ledgerFailed =>
      'Daftari halikukubali muamala huu. Hakuna kilichobadilika.';

  @override
  String get stillWaiting =>
      'Bado tunasubiri daftari. Ombi lako limetumwa — angalia baadaye kidogo.';

  @override
  String get verifyTitle => 'Hakiki kwenye Milki';

  @override
  String get verifySubtitle =>
      'Changanua msimbo wa QR kwenye hati, au andika namba ya kiwanja.';

  @override
  String get scanning => 'Elekeza kamera kwenye msimbo wa QR wa Milki';

  @override
  String get enterParcelId => 'Namba ya kiwanja, mfano DSM-KIN-12-45';

  @override
  String get check => 'Hakiki';

  @override
  String get verifiedOnMilki => 'Imehakikiwa kwenye Milki';

  @override
  String get verifiedParcelBody => 'Kiwanja hiki kimesajiliwa kwenye daftari.';

  @override
  String get verifiedDocBody =>
      'Alama ya hati hii inalingana kabisa na daftari.';

  @override
  String get mismatch => 'Hailingani';

  @override
  String get mismatchBody =>
      'Hati hii ni tofauti na iliyorekodiwa kwenye daftari. Usiitegemee.';

  @override
  String get owner => 'Mmiliki';

  @override
  String get unrecognisedCode => 'Msimbo huu wa QR si wa Milki.';

  @override
  String get cameraUnavailable =>
      'Kamera haipatikani. Andika namba ya kiwanja badala yake.';

  @override
  String get helpTitle => 'Msaada';

  @override
  String get helpSubtitle =>
      'Majibu ya maswali ya kawaida. Msaada wa moja kwa moja unakuja hivi karibuni.';

  @override
  String get faqTransferQ => 'Nawezaje kuhamisha ardhi yangu?';

  @override
  String get faqTransferA =>
      'Fungua kiwanja, bonyeza \'Hamisha kiwanja hiki\', mtafute mnunuzi kwa namba ya simu na uweke bei. Mnunuzi anakubali kwenye programu yake, kisha afisa ardhi anathibitisha malipo na kuhakiki, na msajili anaidhinisha.';

  @override
  String get faqMortgageQ => 'Kwa nini siwezi kuhamisha kiwanja chenye rehani?';

  @override
  String get faqMortgageA =>
      'Kiwanja chenye rehani hai kina hali ya \'Ina rehani\'. Benki lazima iondoe rehani kwenye Milki kabla umiliki haujahamishwa.';

  @override
  String get faqVerifyQ => 'Nawezaje kuhakiki kuwa hati ni halali?';

  @override
  String get faqVerifyA =>
      'Tumia Hakiki na uchanganue msimbo wa QR kwenye hati. Milki inaihakiki moja kwa moja dhidi ya daftari.';

  @override
  String get faqPrivacyQ => 'Nani anaweza kuona bei yangu ya mauzo?';

  @override
  String get faqPrivacyA =>
      'Wewe, upande mwingine, maafisa ardhi na wasajili pekee. Haiandikwi kamwe kwenye daftari la umma.';

  @override
  String get notificationsTitle => 'Taarifa';

  @override
  String get noNotifications => 'Umesoma zote.';

  @override
  String get markAllRead => 'Weka zote zimesomwa';

  @override
  String get deleteNotification => 'Futa taarifa?';

  @override
  String get deleteNotificationBody =>
      'Itaondolewa kwenye kikasha chako. Rekodi ya daftari haiathiriwi.';

  @override
  String get delete => 'Futa';

  @override
  String get settingsTitle => 'Mipangilio';

  @override
  String get theme => 'Mandhari';

  @override
  String get themeSystem => 'Ya mfumo';

  @override
  String get themeLight => 'Mwanga';

  @override
  String get themeDark => 'Giza';

  @override
  String get biometricConfirm => 'Uthibitisho kwa kidole / uso';

  @override
  String get biometricConfirmBody =>
      'Thibitisha vitendo vya daftari kwa alama ya kidole au uso (PIN ya simu kama mbadala).';

  @override
  String get enableBiometrics => 'Washa uthibitisho kwa kidole';

  @override
  String get enableBiometricsBody =>
      'Weka nenosiri lako mara moja kuunganisha simu hii.';

  @override
  String get signOut => 'Toka';

  @override
  String get saved => 'Imehifadhiwa';

  @override
  String get loadError =>
      'Kuna tatizo. Vuta chini kuonyesha upya au jaribu tena.';

  @override
  String get offline => 'Milki haipatikani. Angalia mtandao wako.';

  @override
  String get acceptNext =>
      'Afisa ardhi atathibitisha malipo kwanza, kisha atahakiki uhamisho.';

  @override
  String get all => 'Zote';

  @override
  String get blockedEncumbered =>
      'Kiwanja hiki kina rehani hai. Benki lazima iiondoe kabla umiliki haujahamishwa.';

  @override
  String get blockedDisputed =>
      'Kiwanja hiki kina mgogoro wazi. Hakiwezi kuhamishwa hadi ofisi ya ardhi iutatue.';

  @override
  String get blockedFrozen =>
      'Msajili wa ardhi amesimamisha kiwanja hiki. Wasiliana na ofisi yako ya ardhi.';

  @override
  String get cancelConsequence =>
      'Uhamisho utafungwa kabisa. Ukitaka kuuza baadaye utaanzisha uhamisho mpya.';

  @override
  String get cannotSellToSelf =>
      'Hiyo ni namba yako mwenyewe. Weka namba ya simu ya mnunuzi.';

  @override
  String get contactOffice =>
      'Unahitaji mtu? Tembelea ofisi ya ardhi ya wilaya yako ukiwa na namba ya hati. Msaada wa moja kwa moja ndani ya programu unakuja hivi karibuni.';

  @override
  String get deleted => 'Imefutwa';

  @override
  String get faqBiometricQ => 'Kwa nini Milki inaomba alama ya kidole?';

  @override
  String get faqBiometricA =>
      'Kila mabadiliko kwenye daftari la ardhi yanasainiwa kwa utambulisho wako. Alama ya kidole (au nenosiri lako) inathibitisha kuwa ni wewe kabla chochote hakijarekodiwa.';

  @override
  String get file => 'Faili';

  @override
  String get fileStaysPrivate =>
      'Faili inahifadhiwa kwa faragha. Alama yake ya SHA-256 pekee ndiyo huandikwa kwenye leja.';

  @override
  String get fileTooLarge => 'Faili ni kubwa kuliko MB 10.';

  @override
  String get fileTypesHint => 'PDF, JPEG au PNG, hadi MB 10.';

  @override
  String impactAccept(String parcelId, String seller) {
    return 'Unakubali kununua $parcelId kutoka kwa $seller.';
  }

  @override
  String impactCancel(String parcelId) {
    return 'Uhamisho wa $parcelId utaghairiwa. Kiwanja kinabaki kwako.';
  }

  @override
  String impactDocument(String documentType, String transferId) {
    return '$documentType itaambatishwa kwenye $transferId katika leja.';
  }

  @override
  String impactTransfer(String parcelId, String from, String to) {
    return 'Umiliki wa $parcelId utahama kutoka kwa $from kwenda kwa $to.';
  }

  @override
  String get invalidAmount => 'Weka kiasi kikubwa kuliko sifuri.';

  @override
  String get needsYourAcceptance => 'Inasubiri ukubali';

  @override
  String get noResults => 'Hakuna majibu yanayolingana.';

  @override
  String get notVerified => 'Haijathibitishwa';

  @override
  String get parcel => 'Kiwanja';

  @override
  String get reason => 'Sababu';

  @override
  String get scan => 'Skani';

  @override
  String get scanAnother => 'Skani msimbo mwingine';

  @override
  String get searchHelp => 'Tafuta msaada';

  @override
  String get sessionExpired =>
      'Muda wako wa kuingia umeisha. Tafadhali ingia tena.';

  @override
  String get size => 'Ukubwa';

  @override
  String get staffUseWeb =>
      'Programu ya Milki ni kwa wamiliki wa ardhi. Akaunti za watumishi zinaingia kupitia tovuti.';

  @override
  String get status => 'Hali';

  @override
  String get supersededNote =>
      'Kuna toleo jipya la hati hii. Omba nakala ya karibuni.';

  @override
  String get takePhoto => 'Piga picha';

  @override
  String get transferNextSteps =>
      'Inayofuata: mnunuzi anakubali kwenye programu yake, afisa ardhi anathibitisha malipo na kuhakiki, kisha msajili anaidhinisha.';

  @override
  String get typeId => 'Andika namba';

  @override
  String get viewActiveTransfer => 'Angalia uhamisho unaoendelea';

  @override
  String get waitingForBuyer => 'Inasubiri mnunuzi akubali.';

  @override
  String get waitingForOfficials =>
      'Inasubiri ofisi ya ardhi. Utajulishwa kila hatua.';

  @override
  String get warnDisputed => 'Kiwanja hiki kina mgogoro wazi.';

  @override
  String get warnEncumbered => 'Kiwanja hiki kina rehani hai.';

  @override
  String get you => 'wewe';

  @override
  String blockPlot(String block, String plot) {
    return 'Kitalu $block, Kiwanja $plot';
  }

  @override
  String get stepDone => 'imekamilika';

  @override
  String get stepCurrent => 'inaendelea';

  @override
  String get copy => 'Nakili';

  @override
  String get copied => 'Imenakiliwa';
}
