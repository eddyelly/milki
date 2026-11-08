// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Milki';

  @override
  String get tagline => 'Your land, a permanent record.';

  @override
  String get navHome => 'Home';

  @override
  String get navParcels => 'Parcels';

  @override
  String get navTransfers => 'Transfers';

  @override
  String get navVerify => 'Verify';

  @override
  String get navHelp => 'Help';

  @override
  String get signInTitle => 'Sign in';

  @override
  String get signInSubtitle =>
      'Use the phone number and password you registered with.';

  @override
  String get phoneOrEmail => 'Phone number or email';

  @override
  String get password => 'Password';

  @override
  String get continueAction => 'Continue';

  @override
  String get createAccount => 'Create an account';

  @override
  String get haveAccount => 'Already registered? Sign in';

  @override
  String get registerTitle => 'Create your Milki account';

  @override
  String get fullName => 'Full name';

  @override
  String get phone => 'Phone number';

  @override
  String get nida => 'NIDA number';

  @override
  String get emailOptional => 'Email (optional)';

  @override
  String get passwordHint => 'At least 8 characters, with a number';

  @override
  String get language => 'Language';

  @override
  String get otpTitle => 'Enter your code';

  @override
  String otpSentTo(String destination) {
    return 'We sent a 6-digit code to $destination. It expires in 5 minutes.';
  }

  @override
  String get verifyAndContinue => 'Verify and continue';

  @override
  String get resendCode => 'Resend code';

  @override
  String resendIn(int seconds) {
    return 'Resend in ${seconds}s';
  }

  @override
  String get back => 'Back';

  @override
  String get fieldRequired => 'This field is required.';

  @override
  String get invalidPhone =>
      'Enter a valid Tanzanian mobile number, e.g. 0712 345 678.';

  @override
  String get invalidNida => 'Enter your 20-digit NIDA number.';

  @override
  String get invalidPassword => 'Use at least 8 characters including a number.';

  @override
  String get greetingMorning => 'Habari za asubuhi';

  @override
  String get greetingAfternoon => 'Habari za mchana';

  @override
  String get greetingEvening => 'Habari za jioni';

  @override
  String get myParcels => 'My parcels';

  @override
  String get waitingForYou => 'Waiting for you';

  @override
  String get recentActivity => 'Recent activity';

  @override
  String get noActivity =>
      'Nothing new. Updates about your land will appear here.';

  @override
  String get quickVerify => 'Verify a title';

  @override
  String get quickTransfer => 'Transfer land';

  @override
  String get seeAll => 'See all';

  @override
  String get parcelsTitle => 'My parcels';

  @override
  String get noParcels => 'No parcels yet';

  @override
  String get noParcelsBody =>
      'Parcels registered in your name by the land registry appear here.';

  @override
  String get area => 'Area';

  @override
  String get landUse => 'Land use';

  @override
  String get titleNumber => 'Title number';

  @override
  String get location => 'Location';

  @override
  String get registeredOn => 'Registered';

  @override
  String get ownershipVersion => 'Ownership version';

  @override
  String get lastTransaction => 'Last transaction';

  @override
  String get history => 'History';

  @override
  String get documents => 'Documents';

  @override
  String get noDocuments => 'No documents attached yet.';

  @override
  String get shareProof => 'Share proof of ownership';

  @override
  String get shareProofBody =>
      'Anyone can scan this code in the Milki app to check this parcel on the ledger.';

  @override
  String get transferThisParcel => 'Transfer this parcel';

  @override
  String get cannotTransfer => 'This parcel cannot be transferred right now.';

  @override
  String registeredTo(String name) {
    return 'Registered to $name';
  }

  @override
  String get ownerChanged => 'Owner changed';

  @override
  String get statusChanged => 'Status changed';

  @override
  String get transfersTitle => 'Transfers';

  @override
  String get asSeller => 'Selling';

  @override
  String get asBuyer => 'Buying';

  @override
  String get noTransfers => 'No transfers yet';

  @override
  String get noTransfersBody => 'Transfers you start or receive appear here.';

  @override
  String get seller => 'Seller';

  @override
  String get buyer => 'Buyer';

  @override
  String get salePrice => 'Sale price';

  @override
  String get privateData =>
      'Private — kept only on Ministry and Land Office peers, never on the public ledger.';

  @override
  String get acceptTransfer => 'Accept transfer';

  @override
  String get cancelTransfer => 'Cancel transfer';

  @override
  String get uploadDocument => 'Upload a document';

  @override
  String startTransferTitle(String parcelId) {
    return 'Transfer $parcelId';
  }

  @override
  String get buyerPhone => 'Buyer\'s phone number';

  @override
  String get findBuyer => 'Find buyer';

  @override
  String buyerFound(String name) {
    return 'Buyer: $name';
  }

  @override
  String get salePriceTzs => 'Sale price (TZS)';

  @override
  String get reviewTransfer => 'Review transfer';

  @override
  String get documentType => 'Document type';

  @override
  String get chooseFile => 'Choose a file';

  @override
  String get stepInitiated => 'Initiated';

  @override
  String get stepAccepted => 'Buyer accepted';

  @override
  String get stepPayments => 'Payments confirmed';

  @override
  String get stepVerified => 'Verified';

  @override
  String get stepRecorded => 'Approved & recorded';

  @override
  String get closedCancelled => 'Cancelled by the seller.';

  @override
  String get closedRejected => 'Rejected by the land registry.';

  @override
  String get statusActive => 'Active';

  @override
  String get statusPendingTransfer => 'Pending transfer';

  @override
  String get statusEncumbered => 'Encumbered';

  @override
  String get statusDisputed => 'Disputed';

  @override
  String get statusFrozen => 'Frozen';

  @override
  String get statusRetired => 'Retired';

  @override
  String get statusInitiated => 'Initiated';

  @override
  String get statusBuyerAccepted => 'Buyer accepted';

  @override
  String get statusPaymentsConfirmed => 'Payments confirmed';

  @override
  String get statusOfficerVerified => 'Officer verified';

  @override
  String get statusApproved => 'Approved';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get statusRejected => 'Rejected';

  @override
  String get confirm => 'Confirm';

  @override
  String get cancel => 'Cancel';

  @override
  String get done => 'Done';

  @override
  String get tryAgain => 'Try again';

  @override
  String get confirmItsYou => 'Confirm it\'s you';

  @override
  String ledgerStep(int step) {
    return 'Ledger action · step $step of 2';
  }

  @override
  String get permanentWarning =>
      'This is permanent and publicly auditable. It will be signed with your ledger identity.';

  @override
  String typeToConfirm(String value) {
    return 'Type $value to confirm';
  }

  @override
  String get useBiometrics => 'Confirm with fingerprint or face';

  @override
  String get usePasswordInstead => 'Use my password instead';

  @override
  String get biometricReason => 'Confirm this land register action';

  @override
  String get signAndRecord => 'Sign and record';

  @override
  String get submitting => 'Submitting';

  @override
  String get endorsing => 'Endorsing';

  @override
  String get committed => 'Committed';

  @override
  String get submittingBody =>
      'Signing with your ledger identity and sending to the peers…';

  @override
  String get endorsingBody =>
      'Ministry and Land Office peers are endorsing; waiting for the block…';

  @override
  String sealedInBlock(int block) {
    return 'Sealed on the ledger in block #$block';
  }

  @override
  String get transaction => 'Transaction';

  @override
  String get ledgerFailed =>
      'The ledger did not accept this transaction. Nothing was changed.';

  @override
  String get stillWaiting =>
      'Still waiting for the ledger. Your request was submitted — check back shortly.';

  @override
  String get verifyTitle => 'Verify on Milki';

  @override
  String get verifySubtitle =>
      'Scan the QR code on a title or document, or type the parcel ID.';

  @override
  String get scanning => 'Point the camera at a Milki QR code';

  @override
  String get enterParcelId => 'Parcel ID, e.g. DSM-KIN-12-45';

  @override
  String get check => 'Check';

  @override
  String get verifiedOnMilki => 'Verified on Milki';

  @override
  String get verifiedParcelBody => 'This parcel is registered on the ledger.';

  @override
  String get verifiedDocBody =>
      'This document\'s fingerprint matches the ledger exactly.';

  @override
  String get mismatch => 'Does not match';

  @override
  String get mismatchBody =>
      'This document is different from the one recorded on the ledger. Do not rely on it.';

  @override
  String get owner => 'Owner';

  @override
  String get unrecognisedCode => 'This QR code is not a Milki code.';

  @override
  String get cameraUnavailable =>
      'The camera is not available. Type the parcel ID instead.';

  @override
  String get helpTitle => 'Help';

  @override
  String get helpSubtitle =>
      'Answers to common questions. Live support arrives soon.';

  @override
  String get faqTransferQ => 'How do I transfer my land?';

  @override
  String get faqTransferA =>
      'Open the parcel, tap \'Transfer this parcel\', find the buyer by phone number and enter the price. The buyer accepts in their app, then a land officer confirms payments and verifies, and a registrar approves.';

  @override
  String get faqMortgageQ => 'Why can\'t I transfer a parcel with a mortgage?';

  @override
  String get faqMortgageA =>
      'A parcel with an active mortgage is ENCUMBERED. The bank must release the mortgage on Milki before ownership can move.';

  @override
  String get faqVerifyQ => 'How do I check a title is genuine?';

  @override
  String get faqVerifyA =>
      'Use Verify and scan the QR code on the title or document. Milki checks it directly against the ledger.';

  @override
  String get faqPrivacyQ => 'Who can see my sale price?';

  @override
  String get faqPrivacyA =>
      'Only you, the other party, land officers and registrars. It is never written to the public ledger.';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get noNotifications => 'You\'re all caught up.';

  @override
  String get markAllRead => 'Mark all read';

  @override
  String get deleteNotification => 'Delete notification?';

  @override
  String get deleteNotificationBody =>
      'It will be removed from your inbox. The ledger record is not affected.';

  @override
  String get delete => 'Delete';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get theme => 'Theme';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get biometricConfirm => 'Fingerprint / face confirmation';

  @override
  String get biometricConfirmBody =>
      'Confirm land register actions with your fingerprint or face (device PIN as fallback).';

  @override
  String get enableBiometrics => 'Turn on fingerprint confirmation';

  @override
  String get enableBiometricsBody =>
      'Enter your password once to link this phone.';

  @override
  String get signOut => 'Sign out';

  @override
  String get saved => 'Saved';

  @override
  String get loadError => 'Something went wrong. Pull to refresh or try again.';

  @override
  String get offline => 'Milki could not be reached. Check your connection.';

  @override
  String get acceptNext =>
      'A land officer will confirm the payments next, then verify the transfer.';

  @override
  String get all => 'All';

  @override
  String get blockedEncumbered =>
      'This parcel has an active mortgage. The bank must release it before ownership can move.';

  @override
  String get blockedDisputed =>
      'This parcel has an open dispute. It cannot be transferred until the land office resolves it.';

  @override
  String get blockedFrozen =>
      'The land registry has frozen this parcel. Contact your land office.';

  @override
  String get cancelConsequence =>
      'The transfer closes for good. To sell later you will start a new transfer.';

  @override
  String get cannotSellToSelf =>
      'That is your own number. Enter the buyer\'s phone number.';

  @override
  String get contactOffice =>
      'Need a person? Visit your district land office with your title number. Live support in the app is coming soon.';

  @override
  String get deleted => 'Deleted';

  @override
  String get faqBiometricQ => 'Why does Milki ask for my fingerprint?';

  @override
  String get faqBiometricA =>
      'Every change to the land register is signed with your identity. Your fingerprint (or your password) confirms it is really you before anything is recorded.';

  @override
  String get file => 'File';

  @override
  String get fileStaysPrivate =>
      'The file is stored privately. Only its SHA-256 fingerprint is written to the ledger.';

  @override
  String get fileTooLarge => 'The file is larger than 10 MB.';

  @override
  String get fileTypesHint => 'PDF, JPEG or PNG, up to 10 MB.';

  @override
  String impactAccept(String parcelId, String seller) {
    return 'You agree to buy $parcelId from $seller.';
  }

  @override
  String impactCancel(String parcelId) {
    return 'The transfer of $parcelId will be cancelled. The parcel stays with you.';
  }

  @override
  String impactDocument(String documentType, String transferId) {
    return 'A $documentType will be attached to $transferId on the ledger.';
  }

  @override
  String impactTransfer(String parcelId, String from, String to) {
    return 'Ownership of $parcelId will move from $from to $to.';
  }

  @override
  String get invalidAmount => 'Enter an amount greater than zero.';

  @override
  String get needsYourAcceptance => 'Needs your acceptance';

  @override
  String get noResults => 'No matching answers.';

  @override
  String get notVerified => 'Not verified';

  @override
  String get parcel => 'Parcel';

  @override
  String get reason => 'Reason';

  @override
  String get scan => 'Scan';

  @override
  String get scanAnother => 'Scan another code';

  @override
  String get searchHelp => 'Search help';

  @override
  String get sessionExpired => 'Your session has ended. Please sign in again.';

  @override
  String get size => 'Size';

  @override
  String get staffUseWeb =>
      'The Milki app is for landowners. Staff accounts sign in on the web portal.';

  @override
  String get status => 'Status';

  @override
  String get supersededNote =>
      'A newer version of this document exists. Ask for the latest copy.';

  @override
  String get takePhoto => 'Take a photo';

  @override
  String get transferNextSteps =>
      'Next: the buyer accepts in their app, a land officer confirms payments and verifies, then a registrar approves.';

  @override
  String get typeId => 'Type ID';

  @override
  String get viewActiveTransfer => 'View the transfer in progress';

  @override
  String get waitingForBuyer => 'Waiting for the buyer to accept.';

  @override
  String get waitingForOfficials =>
      'Waiting for the land office. You\'ll be notified at each step.';

  @override
  String get warnDisputed => 'This parcel has an open dispute.';

  @override
  String get warnEncumbered => 'This parcel has an active mortgage.';

  @override
  String get you => 'you';

  @override
  String blockPlot(String block, String plot) {
    return 'Block $block, Plot $plot';
  }

  @override
  String get stepDone => 'done';

  @override
  String get stepCurrent => 'current';

  @override
  String get copy => 'Copy';

  @override
  String get copied => 'Copied';
}
