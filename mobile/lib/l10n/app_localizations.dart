import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_sw.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('sw'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'Milki'**
  String get appName;

  /// No description provided for @tagline.
  ///
  /// In en, this message translates to:
  /// **'Your land, a permanent record.'**
  String get tagline;

  /// No description provided for @navHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// No description provided for @navParcels.
  ///
  /// In en, this message translates to:
  /// **'Parcels'**
  String get navParcels;

  /// No description provided for @navTransfers.
  ///
  /// In en, this message translates to:
  /// **'Transfers'**
  String get navTransfers;

  /// No description provided for @navVerify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get navVerify;

  /// No description provided for @navHelp.
  ///
  /// In en, this message translates to:
  /// **'Help'**
  String get navHelp;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signInTitle;

  /// No description provided for @signInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Use the phone number and password you registered with.'**
  String get signInSubtitle;

  /// No description provided for @phoneOrEmail.
  ///
  /// In en, this message translates to:
  /// **'Phone number or email'**
  String get phoneOrEmail;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @continueAction.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueAction;

  /// No description provided for @createAccount.
  ///
  /// In en, this message translates to:
  /// **'Create an account'**
  String get createAccount;

  /// No description provided for @haveAccount.
  ///
  /// In en, this message translates to:
  /// **'Already registered? Sign in'**
  String get haveAccount;

  /// No description provided for @registerTitle.
  ///
  /// In en, this message translates to:
  /// **'Create your Milki account'**
  String get registerTitle;

  /// No description provided for @fullName.
  ///
  /// In en, this message translates to:
  /// **'Full name'**
  String get fullName;

  /// No description provided for @phone.
  ///
  /// In en, this message translates to:
  /// **'Phone number'**
  String get phone;

  /// No description provided for @nida.
  ///
  /// In en, this message translates to:
  /// **'NIDA number'**
  String get nida;

  /// No description provided for @emailOptional.
  ///
  /// In en, this message translates to:
  /// **'Email (optional)'**
  String get emailOptional;

  /// No description provided for @passwordHint.
  ///
  /// In en, this message translates to:
  /// **'At least 8 characters, with a number'**
  String get passwordHint;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @otpTitle.
  ///
  /// In en, this message translates to:
  /// **'Enter your code'**
  String get otpTitle;

  /// No description provided for @otpSentTo.
  ///
  /// In en, this message translates to:
  /// **'We sent a 6-digit code to {destination}. It expires in 5 minutes.'**
  String otpSentTo(String destination);

  /// No description provided for @verifyAndContinue.
  ///
  /// In en, this message translates to:
  /// **'Verify and continue'**
  String get verifyAndContinue;

  /// No description provided for @resendCode.
  ///
  /// In en, this message translates to:
  /// **'Resend code'**
  String get resendCode;

  /// No description provided for @resendIn.
  ///
  /// In en, this message translates to:
  /// **'Resend in {seconds}s'**
  String resendIn(int seconds);

  /// No description provided for @back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get back;

  /// No description provided for @fieldRequired.
  ///
  /// In en, this message translates to:
  /// **'This field is required.'**
  String get fieldRequired;

  /// No description provided for @invalidPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid Tanzanian mobile number, e.g. 0712 345 678.'**
  String get invalidPhone;

  /// No description provided for @invalidNida.
  ///
  /// In en, this message translates to:
  /// **'Enter your 20-digit NIDA number.'**
  String get invalidNida;

  /// No description provided for @invalidPassword.
  ///
  /// In en, this message translates to:
  /// **'Use at least 8 characters including a number.'**
  String get invalidPassword;

  /// No description provided for @greetingMorning.
  ///
  /// In en, this message translates to:
  /// **'Habari za asubuhi'**
  String get greetingMorning;

  /// No description provided for @greetingAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Habari za mchana'**
  String get greetingAfternoon;

  /// No description provided for @greetingEvening.
  ///
  /// In en, this message translates to:
  /// **'Habari za jioni'**
  String get greetingEvening;

  /// No description provided for @myParcels.
  ///
  /// In en, this message translates to:
  /// **'My parcels'**
  String get myParcels;

  /// No description provided for @waitingForYou.
  ///
  /// In en, this message translates to:
  /// **'Waiting for you'**
  String get waitingForYou;

  /// No description provided for @recentActivity.
  ///
  /// In en, this message translates to:
  /// **'Recent activity'**
  String get recentActivity;

  /// No description provided for @noActivity.
  ///
  /// In en, this message translates to:
  /// **'Nothing new. Updates about your land will appear here.'**
  String get noActivity;

  /// No description provided for @quickVerify.
  ///
  /// In en, this message translates to:
  /// **'Verify a title'**
  String get quickVerify;

  /// No description provided for @quickTransfer.
  ///
  /// In en, this message translates to:
  /// **'Transfer land'**
  String get quickTransfer;

  /// No description provided for @seeAll.
  ///
  /// In en, this message translates to:
  /// **'See all'**
  String get seeAll;

  /// No description provided for @parcelsTitle.
  ///
  /// In en, this message translates to:
  /// **'My parcels'**
  String get parcelsTitle;

  /// No description provided for @noParcels.
  ///
  /// In en, this message translates to:
  /// **'No parcels yet'**
  String get noParcels;

  /// No description provided for @noParcelsBody.
  ///
  /// In en, this message translates to:
  /// **'Parcels registered in your name by the land registry appear here.'**
  String get noParcelsBody;

  /// No description provided for @area.
  ///
  /// In en, this message translates to:
  /// **'Area'**
  String get area;

  /// No description provided for @landUse.
  ///
  /// In en, this message translates to:
  /// **'Land use'**
  String get landUse;

  /// No description provided for @titleNumber.
  ///
  /// In en, this message translates to:
  /// **'Title number'**
  String get titleNumber;

  /// No description provided for @location.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get location;

  /// No description provided for @registeredOn.
  ///
  /// In en, this message translates to:
  /// **'Registered'**
  String get registeredOn;

  /// No description provided for @ownershipVersion.
  ///
  /// In en, this message translates to:
  /// **'Ownership version'**
  String get ownershipVersion;

  /// No description provided for @lastTransaction.
  ///
  /// In en, this message translates to:
  /// **'Last transaction'**
  String get lastTransaction;

  /// No description provided for @history.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get history;

  /// No description provided for @documents.
  ///
  /// In en, this message translates to:
  /// **'Documents'**
  String get documents;

  /// No description provided for @noDocuments.
  ///
  /// In en, this message translates to:
  /// **'No documents attached yet.'**
  String get noDocuments;

  /// No description provided for @shareProof.
  ///
  /// In en, this message translates to:
  /// **'Share proof of ownership'**
  String get shareProof;

  /// No description provided for @shareProofBody.
  ///
  /// In en, this message translates to:
  /// **'Anyone can scan this code in the Milki app to check this parcel on the ledger.'**
  String get shareProofBody;

  /// No description provided for @transferThisParcel.
  ///
  /// In en, this message translates to:
  /// **'Transfer this parcel'**
  String get transferThisParcel;

  /// No description provided for @cannotTransfer.
  ///
  /// In en, this message translates to:
  /// **'This parcel cannot be transferred right now.'**
  String get cannotTransfer;

  /// No description provided for @registeredTo.
  ///
  /// In en, this message translates to:
  /// **'Registered to {name}'**
  String registeredTo(String name);

  /// No description provided for @ownerChanged.
  ///
  /// In en, this message translates to:
  /// **'Owner changed'**
  String get ownerChanged;

  /// No description provided for @statusChanged.
  ///
  /// In en, this message translates to:
  /// **'Status changed'**
  String get statusChanged;

  /// No description provided for @transfersTitle.
  ///
  /// In en, this message translates to:
  /// **'Transfers'**
  String get transfersTitle;

  /// No description provided for @asSeller.
  ///
  /// In en, this message translates to:
  /// **'Selling'**
  String get asSeller;

  /// No description provided for @asBuyer.
  ///
  /// In en, this message translates to:
  /// **'Buying'**
  String get asBuyer;

  /// No description provided for @noTransfers.
  ///
  /// In en, this message translates to:
  /// **'No transfers yet'**
  String get noTransfers;

  /// No description provided for @noTransfersBody.
  ///
  /// In en, this message translates to:
  /// **'Transfers you start or receive appear here.'**
  String get noTransfersBody;

  /// No description provided for @seller.
  ///
  /// In en, this message translates to:
  /// **'Seller'**
  String get seller;

  /// No description provided for @buyer.
  ///
  /// In en, this message translates to:
  /// **'Buyer'**
  String get buyer;

  /// No description provided for @salePrice.
  ///
  /// In en, this message translates to:
  /// **'Sale price'**
  String get salePrice;

  /// No description provided for @privateData.
  ///
  /// In en, this message translates to:
  /// **'Private — kept only on Ministry and Land Office peers, never on the public ledger.'**
  String get privateData;

  /// No description provided for @acceptTransfer.
  ///
  /// In en, this message translates to:
  /// **'Accept transfer'**
  String get acceptTransfer;

  /// No description provided for @cancelTransfer.
  ///
  /// In en, this message translates to:
  /// **'Cancel transfer'**
  String get cancelTransfer;

  /// No description provided for @uploadDocument.
  ///
  /// In en, this message translates to:
  /// **'Upload a document'**
  String get uploadDocument;

  /// No description provided for @startTransferTitle.
  ///
  /// In en, this message translates to:
  /// **'Transfer {parcelId}'**
  String startTransferTitle(String parcelId);

  /// No description provided for @buyerPhone.
  ///
  /// In en, this message translates to:
  /// **'Buyer\'s phone number'**
  String get buyerPhone;

  /// No description provided for @findBuyer.
  ///
  /// In en, this message translates to:
  /// **'Find buyer'**
  String get findBuyer;

  /// No description provided for @buyerFound.
  ///
  /// In en, this message translates to:
  /// **'Buyer: {name}'**
  String buyerFound(String name);

  /// No description provided for @salePriceTzs.
  ///
  /// In en, this message translates to:
  /// **'Sale price (TZS)'**
  String get salePriceTzs;

  /// No description provided for @reviewTransfer.
  ///
  /// In en, this message translates to:
  /// **'Review transfer'**
  String get reviewTransfer;

  /// No description provided for @documentType.
  ///
  /// In en, this message translates to:
  /// **'Document type'**
  String get documentType;

  /// No description provided for @chooseFile.
  ///
  /// In en, this message translates to:
  /// **'Choose a file'**
  String get chooseFile;

  /// No description provided for @stepInitiated.
  ///
  /// In en, this message translates to:
  /// **'Initiated'**
  String get stepInitiated;

  /// No description provided for @stepAccepted.
  ///
  /// In en, this message translates to:
  /// **'Buyer accepted'**
  String get stepAccepted;

  /// No description provided for @stepPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments confirmed'**
  String get stepPayments;

  /// No description provided for @stepVerified.
  ///
  /// In en, this message translates to:
  /// **'Verified'**
  String get stepVerified;

  /// No description provided for @stepRecorded.
  ///
  /// In en, this message translates to:
  /// **'Approved & recorded'**
  String get stepRecorded;

  /// No description provided for @closedCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled by the seller.'**
  String get closedCancelled;

  /// No description provided for @closedRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected by the land registry.'**
  String get closedRejected;

  /// No description provided for @statusActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get statusActive;

  /// No description provided for @statusPendingTransfer.
  ///
  /// In en, this message translates to:
  /// **'Pending transfer'**
  String get statusPendingTransfer;

  /// No description provided for @statusEncumbered.
  ///
  /// In en, this message translates to:
  /// **'Encumbered'**
  String get statusEncumbered;

  /// No description provided for @statusDisputed.
  ///
  /// In en, this message translates to:
  /// **'Disputed'**
  String get statusDisputed;

  /// No description provided for @statusFrozen.
  ///
  /// In en, this message translates to:
  /// **'Frozen'**
  String get statusFrozen;

  /// No description provided for @statusRetired.
  ///
  /// In en, this message translates to:
  /// **'Retired'**
  String get statusRetired;

  /// No description provided for @statusInitiated.
  ///
  /// In en, this message translates to:
  /// **'Initiated'**
  String get statusInitiated;

  /// No description provided for @statusBuyerAccepted.
  ///
  /// In en, this message translates to:
  /// **'Buyer accepted'**
  String get statusBuyerAccepted;

  /// No description provided for @statusPaymentsConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Payments confirmed'**
  String get statusPaymentsConfirmed;

  /// No description provided for @statusOfficerVerified.
  ///
  /// In en, this message translates to:
  /// **'Officer verified'**
  String get statusOfficerVerified;

  /// No description provided for @statusApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get statusApproved;

  /// No description provided for @statusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get statusCompleted;

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get statusCancelled;

  /// No description provided for @statusRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get statusRejected;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @tryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get tryAgain;

  /// No description provided for @confirmItsYou.
  ///
  /// In en, this message translates to:
  /// **'Confirm it\'s you'**
  String get confirmItsYou;

  /// No description provided for @ledgerStep.
  ///
  /// In en, this message translates to:
  /// **'Ledger action · step {step} of 2'**
  String ledgerStep(int step);

  /// No description provided for @permanentWarning.
  ///
  /// In en, this message translates to:
  /// **'This is permanent and publicly auditable. It will be signed with your ledger identity.'**
  String get permanentWarning;

  /// No description provided for @typeToConfirm.
  ///
  /// In en, this message translates to:
  /// **'Type {value} to confirm'**
  String typeToConfirm(String value);

  /// No description provided for @useBiometrics.
  ///
  /// In en, this message translates to:
  /// **'Confirm with fingerprint or face'**
  String get useBiometrics;

  /// No description provided for @usePasswordInstead.
  ///
  /// In en, this message translates to:
  /// **'Use my password instead'**
  String get usePasswordInstead;

  /// No description provided for @biometricReason.
  ///
  /// In en, this message translates to:
  /// **'Confirm this land register action'**
  String get biometricReason;

  /// No description provided for @signAndRecord.
  ///
  /// In en, this message translates to:
  /// **'Sign and record'**
  String get signAndRecord;

  /// No description provided for @submitting.
  ///
  /// In en, this message translates to:
  /// **'Submitting'**
  String get submitting;

  /// No description provided for @endorsing.
  ///
  /// In en, this message translates to:
  /// **'Endorsing'**
  String get endorsing;

  /// No description provided for @committed.
  ///
  /// In en, this message translates to:
  /// **'Committed'**
  String get committed;

  /// No description provided for @submittingBody.
  ///
  /// In en, this message translates to:
  /// **'Signing with your ledger identity and sending to the peers…'**
  String get submittingBody;

  /// No description provided for @endorsingBody.
  ///
  /// In en, this message translates to:
  /// **'Ministry and Land Office peers are endorsing; waiting for the block…'**
  String get endorsingBody;

  /// No description provided for @sealedInBlock.
  ///
  /// In en, this message translates to:
  /// **'Sealed on the ledger in block #{block}'**
  String sealedInBlock(int block);

  /// No description provided for @transaction.
  ///
  /// In en, this message translates to:
  /// **'Transaction'**
  String get transaction;

  /// No description provided for @ledgerFailed.
  ///
  /// In en, this message translates to:
  /// **'The ledger did not accept this transaction. Nothing was changed.'**
  String get ledgerFailed;

  /// No description provided for @stillWaiting.
  ///
  /// In en, this message translates to:
  /// **'Still waiting for the ledger. Your request was submitted — check back shortly.'**
  String get stillWaiting;

  /// No description provided for @verifyTitle.
  ///
  /// In en, this message translates to:
  /// **'Verify on Milki'**
  String get verifyTitle;

  /// No description provided for @verifySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Scan the QR code on a title or document, or type the parcel ID.'**
  String get verifySubtitle;

  /// No description provided for @scanning.
  ///
  /// In en, this message translates to:
  /// **'Point the camera at a Milki QR code'**
  String get scanning;

  /// No description provided for @enterParcelId.
  ///
  /// In en, this message translates to:
  /// **'Parcel ID, e.g. DSM-KIN-12-45'**
  String get enterParcelId;

  /// No description provided for @check.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get check;

  /// No description provided for @verifiedOnMilki.
  ///
  /// In en, this message translates to:
  /// **'Verified on Milki'**
  String get verifiedOnMilki;

  /// No description provided for @verifiedParcelBody.
  ///
  /// In en, this message translates to:
  /// **'This parcel is registered on the ledger.'**
  String get verifiedParcelBody;

  /// No description provided for @verifiedDocBody.
  ///
  /// In en, this message translates to:
  /// **'This document\'s fingerprint matches the ledger exactly.'**
  String get verifiedDocBody;

  /// No description provided for @mismatch.
  ///
  /// In en, this message translates to:
  /// **'Does not match'**
  String get mismatch;

  /// No description provided for @mismatchBody.
  ///
  /// In en, this message translates to:
  /// **'This document is different from the one recorded on the ledger. Do not rely on it.'**
  String get mismatchBody;

  /// No description provided for @owner.
  ///
  /// In en, this message translates to:
  /// **'Owner'**
  String get owner;

  /// No description provided for @unrecognisedCode.
  ///
  /// In en, this message translates to:
  /// **'This QR code is not a Milki code.'**
  String get unrecognisedCode;

  /// No description provided for @cameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera is not available. Type the parcel ID instead.'**
  String get cameraUnavailable;

  /// No description provided for @helpTitle.
  ///
  /// In en, this message translates to:
  /// **'Help'**
  String get helpTitle;

  /// No description provided for @helpSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Answers to common questions. Live support arrives soon.'**
  String get helpSubtitle;

  /// No description provided for @faqTransferQ.
  ///
  /// In en, this message translates to:
  /// **'How do I transfer my land?'**
  String get faqTransferQ;

  /// No description provided for @faqTransferA.
  ///
  /// In en, this message translates to:
  /// **'Open the parcel, tap \'Transfer this parcel\', find the buyer by phone number and enter the price. The buyer accepts in their app, then a land officer confirms payments and verifies, and a registrar approves.'**
  String get faqTransferA;

  /// No description provided for @faqMortgageQ.
  ///
  /// In en, this message translates to:
  /// **'Why can\'t I transfer a parcel with a mortgage?'**
  String get faqMortgageQ;

  /// No description provided for @faqMortgageA.
  ///
  /// In en, this message translates to:
  /// **'A parcel with an active mortgage is ENCUMBERED. The bank must release the mortgage on Milki before ownership can move.'**
  String get faqMortgageA;

  /// No description provided for @faqVerifyQ.
  ///
  /// In en, this message translates to:
  /// **'How do I check a title is genuine?'**
  String get faqVerifyQ;

  /// No description provided for @faqVerifyA.
  ///
  /// In en, this message translates to:
  /// **'Use Verify and scan the QR code on the title or document. Milki checks it directly against the ledger.'**
  String get faqVerifyA;

  /// No description provided for @faqPrivacyQ.
  ///
  /// In en, this message translates to:
  /// **'Who can see my sale price?'**
  String get faqPrivacyQ;

  /// No description provided for @faqPrivacyA.
  ///
  /// In en, this message translates to:
  /// **'Only you, the other party, land officers and registrars. It is never written to the public ledger.'**
  String get faqPrivacyA;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsTitle;

  /// No description provided for @noNotifications.
  ///
  /// In en, this message translates to:
  /// **'You\'re all caught up.'**
  String get noNotifications;

  /// No description provided for @markAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get markAllRead;

  /// No description provided for @deleteNotification.
  ///
  /// In en, this message translates to:
  /// **'Delete notification?'**
  String get deleteNotification;

  /// No description provided for @deleteNotificationBody.
  ///
  /// In en, this message translates to:
  /// **'It will be removed from your inbox. The ledger record is not affected.'**
  String get deleteNotificationBody;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @theme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get theme;

  /// No description provided for @themeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// No description provided for @themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// No description provided for @themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// No description provided for @biometricConfirm.
  ///
  /// In en, this message translates to:
  /// **'Fingerprint / face confirmation'**
  String get biometricConfirm;

  /// No description provided for @biometricConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Confirm land register actions with your fingerprint or face (device PIN as fallback).'**
  String get biometricConfirmBody;

  /// No description provided for @enableBiometrics.
  ///
  /// In en, this message translates to:
  /// **'Turn on fingerprint confirmation'**
  String get enableBiometrics;

  /// No description provided for @enableBiometricsBody.
  ///
  /// In en, this message translates to:
  /// **'Enter your password once to link this phone.'**
  String get enableBiometricsBody;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @saved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get saved;

  /// No description provided for @loadError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Pull to refresh or try again.'**
  String get loadError;

  /// No description provided for @offline.
  ///
  /// In en, this message translates to:
  /// **'Milki could not be reached. Check your connection.'**
  String get offline;

  /// No description provided for @acceptNext.
  ///
  /// In en, this message translates to:
  /// **'A land officer will confirm the payments next, then verify the transfer.'**
  String get acceptNext;

  /// No description provided for @all.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get all;

  /// No description provided for @blockedEncumbered.
  ///
  /// In en, this message translates to:
  /// **'This parcel has an active mortgage. The bank must release it before ownership can move.'**
  String get blockedEncumbered;

  /// No description provided for @blockedDisputed.
  ///
  /// In en, this message translates to:
  /// **'This parcel has an open dispute. It cannot be transferred until the land office resolves it.'**
  String get blockedDisputed;

  /// No description provided for @blockedFrozen.
  ///
  /// In en, this message translates to:
  /// **'The land registry has frozen this parcel. Contact your land office.'**
  String get blockedFrozen;

  /// No description provided for @cancelConsequence.
  ///
  /// In en, this message translates to:
  /// **'The transfer closes for good. To sell later you will start a new transfer.'**
  String get cancelConsequence;

  /// No description provided for @cannotSellToSelf.
  ///
  /// In en, this message translates to:
  /// **'That is your own number. Enter the buyer\'s phone number.'**
  String get cannotSellToSelf;

  /// No description provided for @contactOffice.
  ///
  /// In en, this message translates to:
  /// **'Need a person? Visit your district land office with your title number. Live support in the app is coming soon.'**
  String get contactOffice;

  /// No description provided for @deleted.
  ///
  /// In en, this message translates to:
  /// **'Deleted'**
  String get deleted;

  /// No description provided for @faqBiometricQ.
  ///
  /// In en, this message translates to:
  /// **'Why does Milki ask for my fingerprint?'**
  String get faqBiometricQ;

  /// No description provided for @faqBiometricA.
  ///
  /// In en, this message translates to:
  /// **'Every change to the land register is signed with your identity. Your fingerprint (or your password) confirms it is really you before anything is recorded.'**
  String get faqBiometricA;

  /// No description provided for @file.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get file;

  /// No description provided for @fileStaysPrivate.
  ///
  /// In en, this message translates to:
  /// **'The file is stored privately. Only its SHA-256 fingerprint is written to the ledger.'**
  String get fileStaysPrivate;

  /// No description provided for @fileTooLarge.
  ///
  /// In en, this message translates to:
  /// **'The file is larger than 10 MB.'**
  String get fileTooLarge;

  /// No description provided for @fileTypesHint.
  ///
  /// In en, this message translates to:
  /// **'PDF, JPEG or PNG, up to 10 MB.'**
  String get fileTypesHint;

  /// No description provided for @impactAccept.
  ///
  /// In en, this message translates to:
  /// **'You agree to buy {parcelId} from {seller}.'**
  String impactAccept(String parcelId, String seller);

  /// No description provided for @impactCancel.
  ///
  /// In en, this message translates to:
  /// **'The transfer of {parcelId} will be cancelled. The parcel stays with you.'**
  String impactCancel(String parcelId);

  /// No description provided for @impactDocument.
  ///
  /// In en, this message translates to:
  /// **'A {documentType} will be attached to {transferId} on the ledger.'**
  String impactDocument(String documentType, String transferId);

  /// No description provided for @impactTransfer.
  ///
  /// In en, this message translates to:
  /// **'Ownership of {parcelId} will move from {from} to {to}.'**
  String impactTransfer(String parcelId, String from, String to);

  /// No description provided for @invalidAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount greater than zero.'**
  String get invalidAmount;

  /// No description provided for @needsYourAcceptance.
  ///
  /// In en, this message translates to:
  /// **'Needs your acceptance'**
  String get needsYourAcceptance;

  /// No description provided for @noResults.
  ///
  /// In en, this message translates to:
  /// **'No matching answers.'**
  String get noResults;

  /// No description provided for @notVerified.
  ///
  /// In en, this message translates to:
  /// **'Not verified'**
  String get notVerified;

  /// No description provided for @parcel.
  ///
  /// In en, this message translates to:
  /// **'Parcel'**
  String get parcel;

  /// No description provided for @reason.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get reason;

  /// No description provided for @scan.
  ///
  /// In en, this message translates to:
  /// **'Scan'**
  String get scan;

  /// No description provided for @scanAnother.
  ///
  /// In en, this message translates to:
  /// **'Scan another code'**
  String get scanAnother;

  /// No description provided for @searchHelp.
  ///
  /// In en, this message translates to:
  /// **'Search help'**
  String get searchHelp;

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session has ended. Please sign in again.'**
  String get sessionExpired;

  /// No description provided for @size.
  ///
  /// In en, this message translates to:
  /// **'Size'**
  String get size;

  /// No description provided for @staffUseWeb.
  ///
  /// In en, this message translates to:
  /// **'The Milki app is for landowners. Staff accounts sign in on the web portal.'**
  String get staffUseWeb;

  /// No description provided for @status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get status;

  /// No description provided for @supersededNote.
  ///
  /// In en, this message translates to:
  /// **'A newer version of this document exists. Ask for the latest copy.'**
  String get supersededNote;

  /// No description provided for @takePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get takePhoto;

  /// No description provided for @transferNextSteps.
  ///
  /// In en, this message translates to:
  /// **'Next: the buyer accepts in their app, a land officer confirms payments and verifies, then a registrar approves.'**
  String get transferNextSteps;

  /// No description provided for @typeId.
  ///
  /// In en, this message translates to:
  /// **'Type ID'**
  String get typeId;

  /// No description provided for @viewActiveTransfer.
  ///
  /// In en, this message translates to:
  /// **'View the transfer in progress'**
  String get viewActiveTransfer;

  /// No description provided for @waitingForBuyer.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the buyer to accept.'**
  String get waitingForBuyer;

  /// No description provided for @waitingForOfficials.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the land office. You\'ll be notified at each step.'**
  String get waitingForOfficials;

  /// No description provided for @warnDisputed.
  ///
  /// In en, this message translates to:
  /// **'This parcel has an open dispute.'**
  String get warnDisputed;

  /// No description provided for @warnEncumbered.
  ///
  /// In en, this message translates to:
  /// **'This parcel has an active mortgage.'**
  String get warnEncumbered;

  /// No description provided for @you.
  ///
  /// In en, this message translates to:
  /// **'you'**
  String get you;

  /// No description provided for @blockPlot.
  ///
  /// In en, this message translates to:
  /// **'Block {block}, Plot {plot}'**
  String blockPlot(String block, String plot);

  /// No description provided for @stepDone.
  ///
  /// In en, this message translates to:
  /// **'done'**
  String get stepDone;

  /// No description provided for @stepCurrent.
  ///
  /// In en, this message translates to:
  /// **'current'**
  String get stepCurrent;

  /// No description provided for @copy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copy;

  /// No description provided for @copied.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get copied;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'sw'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'sw':
      return AppLocalizationsSw();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
