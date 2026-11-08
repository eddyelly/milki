/** DEV ONLY: help-centre content (English + Swahili), canned responses and a few demo tickets (CLAUDE.md §11). */
import { KbArticle, KbCategory } from '../modules/kb/kb.models';
import { dueDates } from '../modules/support/sla';
import { CannedResponse, nextTicketNumber, Ticket, TicketMessage } from '../modules/support/support.models';

const CATEGORIES = [
  { slug: 'getting-started', name: { en: 'Getting started', sw: 'Kuanza' }, icon: 'rocket', order: 1 },
  { slug: 'transfers', name: { en: 'Transfers', sw: 'Uhamisho' }, icon: 'swap', order: 2 },
  { slug: 'documents', name: { en: 'Documents', sw: 'Nyaraka' }, icon: 'file', order: 3 },
  { slug: 'mortgages', name: { en: 'Mortgages', sw: 'Rehani' }, icon: 'bank', order: 4 },
  { slug: 'account', name: { en: 'Account', sw: 'Akaunti' }, icon: 'user', order: 5 },
];

const A = (slug: string, categorySlug: string, title: [string, string], body: [string, string], tags: string[]) => ({
  slug,
  categorySlug,
  title: { en: title[0], sw: title[1] },
  body: { en: body[0], sw: body[1] },
  tags,
  status: 'PUBLISHED' as const,
});

const ARTICLES = [
  A(
    'what-is-milki',
    'getting-started',
    ['What is Milki?', 'Milki ni nini?'],
    [
      'Milki is the Ministry of Lands register on a shared ledger. Every change of ownership is signed, endorsed by the Ministry and the Land Office, and kept **permanently**.\n\n- See every parcel registered in your name\n- Transfer land without visiting several offices\n- Let anyone verify a title by scanning its QR code',
      'Milki ni daftari la Wizara ya Ardhi kwenye leja ya pamoja. Kila mabadiliko ya umiliki yanasainiwa, yanaidhinishwa na Wizara na Ofisi ya Ardhi, na kuhifadhiwa **milele**.\n\n- Ona kila kiwanja kilichosajiliwa kwa jina lako\n- Hamisha ardhi bila kuzunguka ofisi nyingi\n- Mtu yeyote anaweza kuthibitisha hati kwa kuskani msimbo wake wa QR',
    ],
    ['intro', 'ledger'],
  ),
  A(
    'sign-in-and-codes',
    'getting-started',
    ['Signing in and SMS codes', 'Kuingia na misimbo ya SMS'],
    [
      'Sign in with your phone number (or email) and password. We then send a **6-digit code** by SMS that works once and expires after 5 minutes.\n\n- Did not get the code? Wait 30 seconds and tap "Resend code"\n- Never share the code — Milki staff will never ask for it',
      'Ingia kwa namba yako ya simu (au barua pepe) na nenosiri. Kisha tunakutumia **msimbo wa tarakimu 6** kwa SMS unaotumika mara moja na kuisha baada ya dakika 5.\n\n- Hukupata msimbo? Subiri sekunde 30 kisha bonyeza "Tuma msimbo tena"\n- Usimpe mtu msimbo — watumishi wa Milki hawatauomba kamwe',
    ],
    ['otp', 'login'],
  ),
  A(
    'how-to-transfer-land',
    'transfers',
    ['How do I transfer my land?', 'Ninahamishaje ardhi yangu?'],
    [
      'Open the parcel and tap **Transfer this parcel**. Find the buyer by phone number, enter the agreed price and confirm with your fingerprint or password.\n\n- The buyer accepts in their app\n- A land officer confirms the TRA payments and verifies the transfer\n- A registrar approves it and ownership moves on the ledger\n\nYou can follow every step in **Transfers**.',
      'Fungua kiwanja kisha bonyeza **Hamisha kiwanja hiki**. Mtafute mnunuzi kwa namba ya simu, weka bei mliyokubaliana na uthibitishe kwa alama ya kidole au nenosiri.\n\n- Mnunuzi anakubali kwenye programu yake\n- Afisa ardhi anathibitisha malipo ya TRA na kuhakiki uhamisho\n- Msajili anaidhinisha na umiliki unahama kwenye leja\n\nUnaweza kufuatilia kila hatua kwenye **Uhamisho**.',
    ],
    ['transfer', 'sell'],
  ),
  A(
    'cancel-a-transfer',
    'transfers',
    ['Can I cancel a transfer?', 'Ninaweza kughairi uhamisho?'],
    [
      'The seller can cancel until a land officer has **verified** the transfer. Open the transfer, tap **Cancel transfer**, type the transfer ID and give a reason. The parcel stays with you.\n\nAfter verification only the land registry can reject it.',
      'Muuzaji anaweza kughairi hadi afisa ardhi **ahakiki** uhamisho. Fungua uhamisho, bonyeza **Ghairi uhamisho**, andika namba ya uhamisho na utoe sababu. Kiwanja kinabaki kwako.\n\nBaada ya uhakiki ni msajili pekee anayeweza kuukataa.',
    ],
    ['transfer', 'cancel'],
  ),
  A(
    'documents-and-fingerprints',
    'documents',
    ['How are my documents protected?', 'Nyaraka zangu zinalindwaje?'],
    [
      'Files are stored privately. Only their **SHA-256 fingerprint** is written to the ledger, so anyone holding a copy can check it is genuine without seeing your file.\n\n- PDF, JPEG or PNG, up to 10 MB\n- A changed file has a different fingerprint and fails verification',
      'Faili zinahifadhiwa kwa faragha. Ni **alama ya SHA-256** pekee inayoandikwa kwenye leja, hivyo mwenye nakala anaweza kuthibitisha ni halisi bila kuona faili lako.\n\n- PDF, JPEG au PNG, hadi MB 10\n- Faili lililobadilishwa lina alama tofauti na linashindwa uthibitisho',
    ],
    ['documents', 'hash'],
  ),
  A(
    'verify-a-title',
    'documents',
    ['How do I check a title is genuine?', 'Ninathibitishaje hati ni halisi?'],
    [
      'Open **Verify** and scan the QR code on the title or document, or type the parcel ID. Milki answers straight from the ledger: a gold **Verified on Milki** badge means it matches.\n\nIf you see **Does not match**, do not rely on the document and contact your land office.',
      'Fungua **Thibitisha** na uskani msimbo wa QR kwenye hati au nyaraka, au andika namba ya kiwanja. Milki inajibu moja kwa moja kutoka kwenye leja: beji ya dhahabu **Imethibitishwa na Milki** inamaanisha inalingana.\n\nUkiona **Hailingani**, usiitegemee nyaraka hiyo na wasiliana na ofisi ya ardhi.',
    ],
    ['verify', 'qr'],
  ),
  A(
    'mortgage-blocks-transfer',
    'mortgages',
    ["Why can't I transfer a parcel with a mortgage?", 'Kwa nini siwezi kuhamisha kiwanja chenye rehani?'],
    [
      'A parcel with an active mortgage is **Encumbered**. The bank that holds the mortgage must release it on Milki before ownership can move. Ask your bank for a release once the loan is paid.',
      'Kiwanja chenye rehani hai **kimewekwa rehani**. Benki inayoshikilia rehani lazima iiondoe kwenye Milki kabla umiliki haujahamishwa. Omba benki yako iiondoe baada ya kulipa mkopo.',
    ],
    ['mortgage', 'bank'],
  ),
  A(
    'fingerprint-confirmation',
    'account',
    ['Fingerprint and face confirmation', 'Uthibitisho wa alama ya kidole na uso'],
    [
      'Every change to the land register is signed with your identity, so Milki asks you to confirm it is really you. Turn on **Fingerprint / face confirmation** in Settings (your password is needed once). Your phone PIN works as a fallback.',
      'Kila mabadiliko kwenye daftari la ardhi yanasainiwa kwa utambulisho wako, hivyo Milki inakuomba uthibitishe kuwa ni wewe. Washa **Uthibitisho wa alama ya kidole / uso** kwenye Mipangilio (nenosiri linahitajika mara moja). PIN ya simu yako inatumika kama mbadala.',
    ],
    ['biometric', 'security'],
  ),
];

const CANNED = [
  { title: 'Greeting', body: 'Habari! Thank you for contacting Milki support. I am looking into this now.', tags: ['greeting'] },
  { title: 'OTP not received', body: 'SMS codes can take up to a minute. Please wait 30 seconds and tap "Resend code". If it still does not arrive, confirm the phone number on your account ends with the digits shown on the sign-in screen.', tags: ['otp'] },
  { title: 'Mortgage blocks transfer', body: 'Your parcel has an active mortgage, so it cannot be transferred yet. Please ask the bank to release the mortgage on Milki once the loan is settled; the transfer button will then become available.', tags: ['mortgage'] },
  { title: 'Escalated to land office', body: 'I have passed this to a land officer at your district office. They will review the record and we will update you here.', tags: ['escalation'] },
  { title: 'Resolved — anything else?', body: 'I have marked this as resolved. If anything is still not right you can reopen the ticket within 7 days. Asante!', tags: ['closing'] },
];

export async function seedSupport(users: { citizen: string; buyer: string; agent: string }): Promise<{ articles: number; tickets: number }> {
  for (const c of CATEGORIES) await KbCategory.updateOne({ slug: c.slug }, { $set: { ...c, deletedAt: null } }, { upsert: true });
  for (const a of ARTICLES) {
    await KbArticle.updateOne(
      { slug: a.slug },
      { $set: { ...a, deletedAt: null }, $setOnInsert: { createdBy: users.agent, publishedAt: new Date() } },
      { upsert: true },
    );
  }
  for (const c of CANNED) await CannedResponse.updateOne({ title: c.title }, { $set: { ...c, deletedAt: null }, $setOnInsert: { createdBy: users.agent } }, { upsert: true });

  let tickets = 0;
  if (!(await Ticket.exists({ userId: { $in: [users.citizen, users.buyer] } }))) {
    const now = Date.now();
    const make = async (userId: string, at: number, data: Record<string, unknown>) => {
      const createdAt = new Date(at);
      const priority = (data.priority as 'NORMAL') ?? 'NORMAL';
      const t = await Ticket.create({ ...data, priority, userId, number: await nextTicketNumber(), ...dueDates(priority, createdAt), lastMessageAt: createdAt });
      await Ticket.collection.updateOne({ _id: t._id }, { $set: { createdAt } }); // createdAt is immutable in Mongoose
      tickets++;
      return t;
    };
    await make(users.citizen, now - 2 * 3_600_000, {
      category: 'TRANSFERS',
      priority: 'HIGH',
      subject: 'Buyer has not received my transfer',
      description: 'I started a transfer yesterday but the buyer says nothing shows in his app. What should he do?',
    });
    const t2 = await make(users.buyer, now - 30 * 3_600_000, {
      category: 'ACCOUNT',
      subject: 'SMS code arrives late',
      description: 'The sign-in code sometimes takes several minutes to arrive.',
      status: 'IN_PROGRESS',
      assigneeId: users.agent,
      firstResponseAt: new Date(now - 29 * 3_600_000),
    });
    await TicketMessage.create([
      { ticketId: t2._id, authorId: users.buyer, authorRole: 'CITIZEN', body: 'It happened again this morning.', readBy: [{ userId: users.buyer, at: new Date() }] },
      { ticketId: t2._id, authorId: users.agent, authorRole: 'SUPPORT_AGENT', body: CANNED[1]!.body, readBy: [{ userId: users.agent, at: new Date() }] },
      { ticketId: t2._id, authorId: users.agent, authorRole: 'SUPPORT_AGENT', body: 'Checked the SMS gateway logs — delivery delays on one network yesterday.', internal: true, readBy: [{ userId: users.agent, at: new Date() }] },
    ]);
    const resolvedAt = new Date(now - 3 * 86_400_000);
    await make(users.citizen, now - 5 * 86_400_000, {
      category: 'MORTGAGES',
      subject: 'Why is my Arusha parcel encumbered?',
      description: 'The app says my parcel is encumbered but I paid off my loan.',
      status: 'RESOLVED',
      assigneeId: users.agent,
      firstResponseAt: new Date(now - 5 * 86_400_000 + 3_600_000),
      resolvedAt,
      rating: { stars: 5, comment: 'Very clear, thank you!', at: resolvedAt },
    });
  }
  return { articles: ARTICLES.length, tickets };
}
