# Milki user manual

*Ardhi yako, kumbukumbu ya kudumu*: "Your land, a permanent record."

This manual explains how Milki works and how each kind of user does their job in it: landowners on the mobile app, registry staff, bank officers, support agents and administrators on the web portal, and bank systems on the partner API. Every screenshot was taken from the running system with the demo data (`npm run seed` and `npm run seed:demo`).

For the technical design (architecture rules, ports, environment variables, build decisions) see [CLAUDE.md](../../CLAUDE.md). For setup commands per component see the [project README](../../README.md).

## Contents

1. [What Milki is](#1-what-milki-is)
2. [Running it and the demo accounts](#2-running-it-and-the-demo-accounts)
3. [Key ideas](#3-key-ideas)
4. [Roles at a glance](#4-roles-at-a-glance)
5. [Signing in](#5-signing-in)
6. [The web portal: features every staff member has](#6-the-web-portal-features-every-staff-member-has)
7. [Registrar](#7-registrar)
8. [Land officer](#8-land-officer)
9. [Bank officer](#9-bank-officer)
10. [Support agent](#10-support-agent)
11. [System administrator](#11-system-administrator)
12. [The mobile app for landowners](#12-the-mobile-app-for-landowners)
13. [Public verification (QR codes)](#13-public-verification-qr-codes)
14. [Partner API for bank systems](#14-partner-api-for-bank-systems)
15. [A complete transfer, start to finish](#15-a-complete-transfer-start-to-finish)
16. [Troubleshooting](#16-troubleshooting)
17. [Glossary](#17-glossary)

---

## 1. What Milki is

Milki is a land register for the Ministry of Lands, Housing and Human Settlements Development (Tanzania). Ownership of every parcel is recorded on a **Hyperledger Fabric blockchain** (the *ledger*) that is shared by three organisations:

| Organisation | Fabric MSP | Who signs with it |
|---|---|---|
| Ministry | `Org1MSP` | Registrars and landowners |
| Land Office | `Org2MSP` | Land officers |
| Banks | `Org3MSP` | Bank officers and bank systems |

A change to the register is only accepted when the Ministry **and** either the Land Office or a Bank endorse it. Once accepted, it can never be deleted or edited quietly: every change is a new, signed, timestamped entry, so anyone with the right access can audit the full history of a parcel.

```mermaid
flowchart LR
  A[Mobile app<br/>landowners] --> API
  W[Web portal<br/>staff] --> API
  B[Bank systems<br/>partner API] --> API
  API[Milki API] --> M[(MongoDB<br/>accounts, tickets,<br/>read caches)]
  API --> R[(Redis<br/>codes, sessions,<br/>queues)]
  API --> S[(MinIO<br/>document files)]
  API --> F[Fabric ledger<br/>land-channel]
  F --- O1[Ministry peer]
  F --- O2[Land Office peer]
  F --- O3[Banks peer]
```

**What lives where**

- **On the ledger:** parcels, owners (as user IDs), transfers, mortgages and other encumbrances, disputes, and the SHA-256 fingerprints of documents.
- **Never on the shared ledger:** NIDA numbers, phone numbers and sale prices. Sale details go in a private data collection that only the Ministry and Land Office peers hold. Owner NIDA numbers are stored only as salted hashes.
- **Off the ledger (MongoDB):** user accounts, support tickets, help articles, notifications, the audit log, and fast read caches of the ledger.
- **Files (MinIO):** uploaded PDFs and photos. Only their fingerprint goes on the ledger, so any later change to a file is detected.

---

## 2. Running it and the demo accounts

The quickest way to bring everything up on a development machine:

```bash
docker compose -f infra/docker-compose.yml up -d
```

```bash
./network/scripts/up.sh
```

```bash
cd backend && cp .env.example .env && npm install && npm run seed && npm run seed:demo && npm run dev
```

```bash
cd web && cp .env.example .env.local && npm install && npm run dev
```

```bash
cd mobile && flutter pub get && flutter run --dart-define=API_URL=http://10.0.2.2:4100/api/v1
```

| What | Address |
|---|---|
| Web portal | http://localhost:3100 |
| API and its interactive docs | http://localhost:4100/api/docs |
| Mailpit (where the SMS sign-in codes land in development) | http://localhost:8126 |

After a reboot, use `./network/scripts/start.sh` instead of `up.sh` to resume the network without losing ledger data.

**Demo accounts** (development only). The password for all of them is `Milki@2026`.

| Email | Phone | Name | Role | Use on |
|---|---|---|---|---|
| `registrar@milki.dev` | +255714000001 | Baraka Mushi | Registrar | Web |
| `officer@milki.dev` | +255713000001 | Neema Kileo | Land officer | Web |
| `bank@milki.dev` | +255715000001 | Grace Lyimo (CRDB Bank) | Bank officer | Web |
| `support@milki.dev` | +255716000001 | Halima Said | Support agent | Web |
| `admin@milki.dev` | +255717000001 | System Administrator | System administrator | Web |
| `citizen@milki.dev` | +255712000001 | Asha Mwakyusa | Landowner | Mobile |
| `buyer@milki.dev` | +255712000002 | Juma Hassan | Landowner | Mobile |
| `neema@milki.dev`, `baraka@milki.dev`, `zawadi@milki.dev`, `rehema@milki.dev` | +255712000003 to 006 | Demo landowners | Landowner | Mobile |

The demo data covers 3 regions (Dar es Salaam, Arusha, Mwanza), 30 parcels with boundaries, transfers in every state, a CRDB mortgage, a boundary dispute and three support tickets.

---

## 3. Key ideas

### 3.1 Parcel status

A parcel's status is **worked out by the ledger** from its facts; nobody sets it by hand. When several apply, the strongest wins, in this order:

| Status | Meaning | Can it be transferred? |
|---|---|---|
| **Retired** | Permanently removed from use (for example merged into a road reserve). | No, never again |
| **Frozen** | Locked by a registrar, for example by court order. | No, until unfrozen |
| **Disputed** | A land officer has an open dispute on it. | No, until resolved |
| **Encumbered** | A bank holds an active mortgage, charge, caveat or lien. | No, until released |
| **Pending transfer** | A transfer is in progress. | Only that one |
| **Active** | Normal. | Yes |

Statuses always show an icon and a word, never colour alone.

### 3.2 The transfer lifecycle

```mermaid
stateDiagram-v2
  [*] --> INITIATED: Owner starts (mobile)
  INITIATED --> BUYER_ACCEPTED: Buyer accepts (mobile)
  BUYER_ACCEPTED --> PAYMENTS_CONFIRMED: Land officer checks receipts (web)
  PAYMENTS_CONFIRMED --> OFFICER_VERIFIED: Land officer verifies (web)
  OFFICER_VERIFIED --> COMPLETED: Registrar approves, ownership moves (web)
  INITIATED --> CANCELLED: Seller cancels
  BUYER_ACCEPTED --> CANCELLED: Seller cancels
  PAYMENTS_CONFIRMED --> CANCELLED: Seller cancels
  INITIATED --> REJECTED: Officer or registrar
  BUYER_ACCEPTED --> REJECTED: Officer or registrar
  PAYMENTS_CONFIRMED --> REJECTED: Officer or registrar
  OFFICER_VERIFIED --> REJECTED: Registrar only
  COMPLETED --> [*]
  CANCELLED --> [*]
  REJECTED --> [*]
```

Rules the ledger enforces at every step:

- Only the current owner can start a transfer, and a parcel can have only one transfer open at a time.
- No transfer can start or move forward while the parcel is encumbered, disputed or frozen.
- The person who verifies and the person who approves must hold different roles.
- Every forward step re-checks that the seller still owns the parcel.
- Approval records "Approved" and "Completed" in the same ledger transaction and moves ownership to the buyer.

### 3.3 Confirmation tiers

Every action that changes data asks for confirmation. How strongly depends on how serious it is.

| Tier | Used for | What you see |
|---|---|---|
| **T1 Standard** | Creating or editing ordinary records: profile, ticket, article, office | A summary of the change, then **Confirm** |
| **T2 Destructive** | Soft deletes, revoking an API key, closing a ticket, deactivating a user | A red dialog that states the consequences. You must **type the identifier** (for example the ticket number or `REVOKE`) to unlock the button |
| **T3 Ledger** | Anything that writes to the blockchain | 1. A review with a plain sentence about the impact ("Ownership of DSM-KIN-12-45 will move from A to B"). 2. "This is permanent and publicly auditable". 3. **Re-authentication**: password or SMS code on the web, fingerprint or face (device PIN as fallback) on the phone. 4. The **Sealed on the ledger** animation: Submitting, Endorsing, Committed with the block number and transaction ID |

T3 actions that undo something (cancel, reject, retire, release) also ask you to type the record's ID.

Exceptions on purpose: sending a chat message, marking notifications as read and voting on a help article have no dialog. They are either undoable (chat messages can be edited or deleted for 5 minutes) or are UI state rather than data.

### 3.4 Every write is safe to retry

Each write carries a unique *idempotency key*. If the network drops and you press the button again, the server recognises the repeat and returns the first result instead of writing twice. A ledger write returns immediately with "Submitted"; the screen switches to "Committed" when the commit event arrives.

---

## 4. Roles at a glance

| Role | Where | Main jobs | Signs on the ledger as |
|---|---|---|---|
| **Landowner** (`CITIZEN`) | Mobile app | See own parcels, start, accept or cancel transfers, upload documents, share proof of ownership, get help | Ministry |
| **Land officer** (`LAND_OFFICER`) | Web | Confirm payments, verify transfers, reject before verification, flag and resolve disputes, answer support escalations | Land Office |
| **Registrar** (`REGISTRAR`) | Web | Register and update parcels, approve or reject verified transfers, freeze, unfreeze and retire parcels, resolve disputes | Ministry |
| **Bank officer** (`BANK_OFFICER`) | Web | Check parcels, add, update and release their own bank's mortgages and charges, see the bank's book | Banks |
| **Support agent** (`SUPPORT_AGENT`) | Web | Work the ticket queue, live chat, canned responses, help-centre articles, escalate to a land officer. **Read-only** on parcels and transfers | (never writes to the ledger) |
| **System administrator** (`SYSTEM_ADMIN`) | Web | Staff accounts and roles, land offices, bank API clients, the audit log, support metrics | (never writes to the ledger) |
| **Bank system** (API client) | Partner API | Verify parcels and owners, manage that bank's encumbrances automatically | Banks |

What each staff role sees in the portal's sidebar:

| Menu item | Registrar | Land officer | Bank officer | Support agent | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Parcels | ✓ | ✓ | ✓ | ✓ (read-only) | ✓ (read-only) |
| Register parcel | ✓ | | | | |
| Transfers | ✓ | ✓ | | ✓ (read-only) | ✓ (read-only) |
| Encumbrances | ✓ | ✓ | ✓ (own bank) | | ✓ |
| Support queue | | | | ✓ | ✓ |
| Escalations | ✓ | ✓ | | ✓ | ✓ |
| Help centre | ✓ | ✓ | ✓ | ✓ (manage) | ✓ (manage) |
| Users, Land offices, API clients, Audit log | | | | | ✓ |
| Verify document, Notifications | ✓ | ✓ | ✓ | ✓ | ✓ |

A landowner who signs in on the web is told to use the mobile app:

![A landowner on the web portal is directed to the mobile app](images/web/70-citizen-on-web.png)

---

## 5. Signing in

Sign-in has two steps for every role: your password, then a 6-digit code sent by SMS.

1. Open http://localhost:3100 and enter your phone number or email and your password.

   ![Sign-in page](images/web/01-login.png)

2. Enter the 6-digit code. It is valid for 5 minutes, works once, and allows at most 5 wrong attempts. **Resend** sends a new one.

   ![The SMS code step](images/web/02-login-code.png)

3. In development there is no real SMS. Codes are delivered as emails to `<phone>@sms.milki.local` and appear in Mailpit at http://localhost:8126.

   ![Sign-in codes in Mailpit](images/web/03-mailpit-codes.png)

**How long you stay signed in.** Access lasts 15 minutes and is renewed silently for up to 7 days. Each renewal token works only once. Signing out, or an administrator deactivating your account, ends the session.

---

## 6. The web portal: features every staff member has

**Layout.** A collapsible green sidebar on the left (your menu, your name, role and the organisation you sign as), a top bar with search, a live-connection indicator, notifications and the light/dark switch.

**Search (Ctrl+K or ⌘K).** Type a parcel ID, a transfer ID or part of a location to jump straight to it.

![The command palette](images/web/21-command-palette.png)

**Notifications.** Ledger events and support escalations arrive live (the bell shows a count). Mark them read, or delete them (T1).

![Notifications](images/web/22-notifications.png)

**Verify document.** Drop in a file you were given (for example a sale agreement) to check that its SHA-256 fingerprint matches the one recorded on the ledger. Nothing is uploaded or stored.

![Verify a document against the ledger](images/web/23-verify-document.png)

**Dark mode.** The sun/moon button switches theme; the portal follows the system setting by default.

![Dark mode](images/web/24-dark-mode.png)

**Live updates.** Lists and records refresh by themselves when the ledger changes, so two officers never work on stale data. If a record changes while you have a dialog open, the dialog stays put until you close it.

**Help centre.** Every staff member can read the knowledge base (see [10.6](#106-help-centre)).

---

## 7. Registrar

*Demo account: `registrar@milki.dev`.* The registrar is the final authority of the register: they create parcels, give the final approval that moves ownership, and can freeze or retire parcels.

### 7.1 Dashboard

The dashboard shows what is waiting for you (transfers awaiting approval, escalations), the size of the register, transfers over the last six months, parcels by status and region, and recently updated parcels.

![Registrar dashboard](images/web/10-registrar-dashboard.png)

### 7.2 Find and inspect parcels

**Parcels** lists the register with search, filters (region, status, land use) and paging.

![Parcel list](images/web/11-parcels-list.png)

A parcel page shows its facts straight from the ledger, the owner (name and phone for officials; the NIDA number is never shown), the location on a map, and tabs for **History** (the chain of every ledger change), **Mortgages**, **Disputes** and **Documents**.

![Parcel page](images/web/12-parcel-detail.png)

### 7.3 Register a new parcel (T3)

1. Click **Register parcel** in the sidebar.
2. Fill in the title number, region, district, ward, block and plot, area, land use, the location, and the owner (found by phone number). The parcel ID is built from these (for example `DSM-KIN-61-261`).

   ![Register parcel form](images/web/16-register-parcel-form.png)

3. **Review.** The dialog states the ledger impact in plain words.

   ![T3 review step](images/web/17-t3-review.png)

4. **Re-authenticate** with your password, or ask for an SMS code.

   ![T3 re-authentication](images/web/18-t3-reauth.png)

5. Watch it being sealed: **Submitting**, then **Endorsing** (the Ministry and Land Office or Bank peers sign it) ...

   ![Endorsing](images/web/19-t3-endorsing.png)

   ... then **Committed**, with the block number and transaction ID. The owner gets a notification on their phone.

   ![Sealed on the ledger](images/web/20-t3-sealed.png)

### 7.4 Update, freeze, unfreeze and retire

On a parcel page the registrar has these actions (all T3):

- **Update parcel details:** land use, an area correction (a reason is required), or the location. Other fields cannot be changed.
- **Freeze / Unfreeze:** stops or allows transfers, for example during a court case.
- **Retire parcel:** permanent. Only possible once there is no open transfer, mortgage or dispute, and you must type the parcel ID to confirm. A retired parcel stays on the ledger with its full history.

### 7.5 Approve or reject transfers

**Transfers** opens on your queue: transfers that a land officer has verified and that are waiting for your approval.

![Registrar's transfer queue](images/web/13-transfers-queue-registrar.png)

A transfer page shows the progress tracker, both parties, the parcel's current status, the private sale details (price and payment reference, visible only to the parties and officials), documents and every ledger step.

![Transfer page](images/web/14-transfer-detail.png)

**Approve transfer** (T3) records the approval and moves ownership to the buyer in one ledger transaction. You can add a note.

![Approve a transfer](images/web/15-approve-review.png)

**Reject transfer** (T3 plus the typed transfer ID) closes it with a reason that is sent to both parties. A registrar can reject at any stage before completion; a land officer only until verification.

### 7.6 Disputes and escalations

Registrars can add notes to and resolve disputes on the parcel's **Disputes** tab, and see support escalations under **Escalations**.

---

## 8. Land officer

*Demo account: `officer@milki.dev`.* The land officer is the checking step of every transfer: they confirm that the money has been paid and that the paperwork is right, and they handle boundary and ownership disputes.

### 8.1 Dashboard and queue

The dashboard counts transfers awaiting payment confirmation and verification, and open escalations from support.

![Land officer dashboard](images/web/30-officer-dashboard.png)

**Transfers** opens on the officer's queue.

![Land officer's transfer queue](images/web/31-officer-queue.png)

### 8.2 Confirm payments (T3)

When the buyer has accepted, open the transfer and click **Confirm payments**. Pick the receipt that the parties attached (purchase price and TRA fees) and enter the payment or TRA reference. The receipt's SHA-256 is written to the ledger as the payment evidence. If no receipt is attached yet the dialog says so and you cannot continue: ask the buyer to upload proof of payment from the app.

![Confirm payments](images/web/32-confirm-payments.png)

### 8.3 Verify (T3)

After payments are confirmed, check the documents and parties and click **Verify transfer**, with an optional note. The transfer then goes to a registrar for approval.

![Verify a transfer](images/web/33-verify-transfer.png)

A land officer can **Reject** a transfer (with a reason) until it has been verified.

### 8.4 Flag a dispute (T3)

On a parcel page, **Flag a dispute** records a summary (at least 10 characters) on the ledger. While a dispute is open the parcel is *Disputed* and cannot be transferred. On the **Disputes** tab, officers and registrars can **Add note** and **Resolve** (both T3).

![Flag a dispute](images/web/34-flag-dispute.png)

### 8.5 Escalations from support

When a support agent needs an official answer, they escalate the ticket. Land officers are notified and see it under **Escalations**. Your answer is added to the ticket as an internal note for the agent.

![Escalations](images/web/35-escalations.png)

---

## 9. Bank officer

*Demo account: `bank@milki.dev` (Grace Lyimo, CRDB Bank).* Banks register their security over land so that it cannot be sold behind their back. The bank comes from the officer's account (and their ledger certificate), never from what they type, and **only the bank that created an encumbrance can change or release it**.

### 9.1 Dashboard and the bank's book

![Bank officer dashboard](images/web/40-bank-dashboard.png)

**Encumbrances** lists your bank's mortgages and charges, active and released. (Registry staff see every bank's.)

![The bank's encumbrance book](images/web/41-bank-encumbrances.png)

### 9.2 Add a mortgage or charge (T3)

1. Search for the parcel and open it.
2. Click **Add mortgage / charge**.
3. Choose the type (mortgage, charge, caveat or lien), the amount and currency, and your bank's own loan reference. Never enter borrower personal data in the reference.
4. Review, re-authenticate and seal.

![Add a mortgage](images/web/44-add-mortgage.png)

The parcel becomes *Encumbered*. It cannot be transferred, and a new transfer cannot start, until you release it. A mortgage cannot be added while the parcel is frozen, retired, disputed or has a transfer in progress.

### 9.3 Update or release (T3)

On the parcel's **Mortgages** tab, your bank's active entries have **Update** (amount, currency, reference, terms) and **Release** buttons. Other banks' entries show no buttons.

![Mortgages tab](images/web/42-mortgages-tab.png)

Release asks for a reason and for the encumbrance ID (`ENC-...`) to be typed.

![Release a mortgage](images/web/43-release-mortgage.png)

Bank officers do not see the parcel owner's personal details and cannot see sale prices.

---

## 10. Support agent

*Demo account: `support@milki.dev`.* Support agents make sure a landowner with a problem reaches a person quickly. They work entirely off the ledger: they can **look** at a user's parcels and transfers, but cannot change them.

### 10.1 Dashboard

Unassigned tickets, open tickets and escalations, first-response and resolution times, satisfaction (CSAT) and tickets by category.

![Support dashboard](images/web/50-support-dashboard.png)

### 10.2 The queue

**Support queue** has tabs (My tickets, Unassigned, All open, Awaiting user, Resolved & closed), filters and search. Tickets are sorted by how close they are to their deadline. Each ticket shows an **SLA timer**: it turns gold at 75% of the time allowed and red once the deadline has passed.

| Priority | First response within | Resolution within |
|---|---|---|
| Urgent | 1 hour | 8 hours |
| High | 4 hours | 24 hours |
| Normal | 24 hours | 72 hours |
| Low | 72 hours | 7 days |

![Support queue](images/web/51-support-queue.png)

Ticket numbers look like `MLK-000123`. Status flow: **Open → In progress → Awaiting user → Resolved → Closed**. A landowner can reopen a resolved ticket within 7 days.

### 10.3 The ticket workspace

Opening a ticket gives you the conversation (live chat with the landowner, with typing indicators and read receipts), the ticket controls (status, priority, assignee, tags; changes are confirmed T1), and the **Requester context**: the person's profile, parcels, transfers and previous tickets, read-only, with links to the parcel and transfer pages.

![Ticket workspace](images/web/52-ticket-workspace.png)

- Your first public reply records the first response time, moves the ticket to *In progress* and assigns it to you if nobody had it.
- If the landowner is not in the app, your reply reaches them as a push notification and, if they have an email, by email.
- You can edit or delete your own message for 5 minutes.
- **Close ticket** is T2: type the ticket number.

**Canned responses** insert a prepared answer that you can edit before sending.

![Canned response picker](images/web/53-canned-picker.png)

**Internal note** switches the composer to notes that only staff can see (the landowner never sees them, even live).

![Writing an internal note](images/web/54-internal-note.png)

### 10.4 Escalate to an officer

When a question needs the land office (for example "the buyer cannot see my transfer"), **Escalate to officer** creates a task for land officers with your note. There can be one open escalation per ticket. The officer's answer comes back as an internal note.

![Escalate to an officer](images/web/55-escalate.png)

### 10.5 Manage canned responses

**Support queue → Canned responses**: create, edit (T1) and delete (T2) the prepared answers.

![Canned responses](images/web/56-canned-responses.png)

### 10.6 Help centre

The knowledge base is grouped by category (Getting started, Transfers, Documents, Mortgages, Account), searchable, and every article exists in English and Swahili. Readers can vote "Was this helpful?".

![Help centre](images/web/57-help-centre.png)

![A help article](images/web/58-help-article.png)

Agents and administrators manage articles under **Help centre → Manage**: create and edit (T1, both languages required), unpublish and delete (T2). Article bodies use a small, safe formatting subset: paragraphs, `- ` lists and `**bold**`.

![Managing help articles](images/web/59-help-manage.png)

---

## 11. System administrator

*Demo account: `admin@milki.dev`.* The administrator runs the system itself. They never write to the ledger.

### 11.1 Dashboard

Registry and support figures together.

![Administrator dashboard](images/web/67-admin-dashboard.png)

### 11.2 Users

**Users** lists every account with filters by role and status.

![Users](images/web/60-admin-users.png)

- **Create staff** (T1). Landowners register themselves in the app, so only staff are created here. Choose the role, the office and, for bank officers, the bank. A one-time password is shown once (and emailed); it cannot be dismissed until you tick "I have copied and stored it safely". The ledger identity is enrolled in the background.

  ![Create a staff account](images/web/61-create-staff.png)

- **Edit** (T1). Changing a role or bank re-issues the person's ledger certificate, because the certificate carries the role. Converting a landowner to staff (or back) and changing your own role are refused.
- **Reset password** and **Deactivate** are T2 (type the email). Deactivation stops sign-in and re-authentication immediately and removes the person's push tokens and fingerprint credentials; any session already open ends within 15 minutes.

### 11.3 Land offices

Create, edit (T1) and delete (T2, type the office code) the land offices. An office with active staff cannot be deleted.

![Land offices](images/web/62-land-offices.png)

### 11.4 API clients for banks

An API client lets a bank's own systems call the partner API (section 14).

1. **New API client**: name, bank code, scopes (`parcels:verify`, `encumbrances:write`) and a per-minute rate limit.

   ![New API client](images/web/63-new-api-client.png)

2. The key (`mlk_<prefix>_<secret>`) is shown **once**. Only its SHA-256 is stored, so it can never be shown again. Copy it into the bank's secret store.

   ![The key is shown once](images/web/64-api-key-shown-once.png)

3. From the list you can **Rotate** the key (T2; the old key stops working at once), change scopes and limit, or **Revoke** the client permanently (T2, type `REVOKE`).

   ![API clients](images/web/65-api-clients.png)

### 11.5 Audit log

Every change made through Milki (sign-ins, ledger writes, ticket changes, admin actions and every partner API call, including rejected keys) is recorded with who did it, when, from where and the outcome. The log is read-only: no screen or API can change or delete entries. Filter by area, outcome and record.

![Audit log](images/web/66-audit-log.png)

### 11.6 API documentation

The full REST API is documented and can be tried at http://localhost:4100/api/docs.

![API docs](images/web/80-api-docs.png)

---

## 12. The mobile app for landowners

*Demo accounts: `citizen@milki.dev` (Asha, a seller) and `buyer@milki.dev` (Juma, a buyer).* The app is in English and Swahili, light and dark. Only landowner accounts can use it; staff are told to use the web portal. The bottom bar has **Home, Parcels, Transfers, Verify and Help**.

### 12.1 Create an account and sign in

<table>
<tr>
<td width="33%"><img src="images/mobile/02-register.png" alt="Create an account"></td>
<td width="33%"><img src="images/mobile/01-login.png" alt="Sign in"></td>
<td width="33%"><img src="images/mobile/03-otp.png" alt="Enter the SMS code"></td>
</tr>
<tr>
<td>Register with your name, phone, NIDA number, optional email, password and language.</td>
<td>Sign in with your phone or email and password.</td>
<td>Enter the 6-digit SMS code. The boxes fill as you type.</td>
</tr>
</table>

Your NIDA number is used to prove you are the owner, but it is stored only as a salted fingerprint and never shown in full.

### 12.2 Home and your parcels

<table>
<tr>
<td width="33%"><img src="images/mobile/04-home.png" alt="Home"></td>
<td width="33%"><img src="images/mobile/05-parcels.png" alt="My parcels"></td>
<td width="33%"><img src="images/mobile/06-parcel-detail.png" alt="Parcel details"></td>
</tr>
<tr>
<td><b>Home</b>: shortcuts, anything <b>waiting for you</b> (for example a transfer you need to accept), and your parcels. The bell shows unread notifications.</td>
<td><b>Parcels</b>: every parcel registered to you, with its status. Pull down to refresh.</td>
<td><b>Parcel details</b> are read straight from the ledger: title, location, ownership version, last transaction and the full history chain. Tap a history entry to see its transaction.</td>
</tr>
</table>

The headset icon on a parcel or transfer opens a support ticket with that record already attached.

### 12.3 Share proof of ownership

Tap the QR icon on a parcel. Anyone can scan the code with the Milki app (or open the verification link) to check, on the ledger, that the parcel is registered and who owns it, without your phone number or NIDA number ever being shown.

<img src="images/mobile/07-proof-qr.png" alt="Proof of ownership QR code" width="300">

### 12.4 Sell: start a transfer (T3)

<table>
<tr>
<td width="25%"><img src="images/mobile/08-initiate-transfer.png" alt="Start a transfer"></td>
<td width="25%"><img src="images/mobile/09-t3-review.png" alt="Review"></td>
<td width="25%"><img src="images/mobile/10-t3-reauth.png" alt="Confirm it's you"></td>
<td width="25%"><img src="images/mobile/11-t3-sealed.png" alt="Sealed on the ledger"></td>
</tr>
<tr>
<td>1. On an active parcel tap <b>Transfer this parcel</b>. Find the buyer by phone number (you see a short name such as "Juma H." to check it is the right person), and enter the agreed price.</td>
<td>2. <b>Review</b>: what will happen, in a sentence. The price is private: only Ministry and Land Office peers keep it.</td>
<td>3. <b>Confirm it's you</b> with your fingerprint or face (or your password).</td>
<td>4. The transfer is <b>sealed on the ledger</b>, with the block number and transaction ID.</td>
</tr>
</table>

To use fingerprint or face confirmation, turn it on once in **Settings** (section 12.8). Without it, the app asks for your password at step 3.

### 12.5 Follow, accept, cancel

<table>
<tr>
<td width="25%"><img src="images/mobile/12-transfers.png" alt="Transfers"></td>
<td width="25%"><img src="images/mobile/13-transfer-tracker.png" alt="Transfer tracker"></td>
<td width="25%"><img src="images/mobile/14-transfer-accept.png" alt="Accept a transfer"></td>
<td width="25%"><img src="images/mobile/15-cancel-transfer.png" alt="Cancel a transfer"></td>
</tr>
<tr>
<td><b>Transfers</b>: all your transfers, filtered by <i>Selling</i> or <i>Buying</i>.</td>
<td>The <b>tracker</b> shows the five steps, who acted and when, and what happens next. You get a notification at each step.</td>
<td>As the <b>buyer</b>, review and tap <b>Accept transfer</b> (T3).</td>
<td>As the <b>seller</b>, you can <b>cancel</b> until the land officer verifies. Give a reason and type the transfer ID (T3).</td>
</tr>
</table>

**Upload a document** on a transfer attaches a sale agreement, receipt or other paper from a file or the camera (PDF, JPEG or PNG, up to 10 MB). The app computes its fingerprint before uploading; the server checks it, stores the file privately and records the fingerprint on the ledger (T3). The land officer needs the payment receipt before they can confirm payments.

### 12.6 Get help

<table>
<tr>
<td width="20%"><img src="images/mobile/18-help.png" alt="Help"></td>
<td width="20%"><img src="images/mobile/19-help-article.png" alt="Article"></td>
<td width="20%"><img src="images/mobile/20-my-tickets.png" alt="My tickets"></td>
<td width="20%"><img src="images/mobile/21-ticket-chat.png" alt="Chat"></td>
<td width="20%"><img src="images/mobile/22-new-ticket.png" alt="New ticket"></td>
</tr>
<tr>
<td><b>Help</b>: search the articles by category, or <b>Talk to a person</b>.</td>
<td>Articles in your language, with "Was this helpful?".</td>
<td><b>My support tickets</b> with status.</td>
<td><b>Live chat</b> with the agent: typing dots, presence, ✓✓ read receipts. After resolution, rate it with stars, or reopen within 7 days.</td>
<td><b>New ticket</b> (T1): category, priority, subject, description and an optional file or photo. "Get help" from a parcel or transfer fills in <i>About</i>.</td>
</tr>
</table>

If no agent is online your message becomes a ticket and the reply reaches you as a push notification and email.

### 12.7 Notifications

Every ledger event about your parcels and transfers, and every support reply. Tap one to open the record. **Mark all read** clears the badge; swipe to delete (T1).

<img src="images/mobile/23-notifications.png" alt="Notifications" width="300">

### 12.8 Settings

Language (Kiswahili or English), theme (System, Light, Dark) and **Fingerprint / face confirmation**. Turning it on asks for your password once (T1): the phone receives a secret that is kept in its secure storage and only unlocked by your fingerprint, face or device PIN. Turning it off, or signing out, revokes it.

<img src="images/mobile/24-settings.png" alt="Settings" width="300">

### 12.9 Dark mode and Swahili

<table>
<tr>
<td width="25%"><img src="images/mobile/25-home-dark.png" alt="Home in dark mode"></td>
<td width="25%"><img src="images/mobile/26-transfer-tracker-dark.png" alt="Tracker in dark mode"></td>
<td width="25%"><img src="images/mobile/27-home-swahili.png" alt="Home in Swahili"></td>
<td width="25%"><img src="images/mobile/28-help-swahili.png" alt="Help in Swahili"></td>
</tr>
</table>

---

## 13. Public verification (QR codes)

Anyone (a buyer, a neighbour, a court clerk) can check a parcel or a document **without an account**. On the phone use the **Verify** tab, or **Verify a title** on the sign-in screen. Scan a QR code or type a parcel ID.

<table>
<tr>
<td width="50%"><img src="images/mobile/16-verify-parcel.png" alt="Verified on Milki"></td>
<td width="50%"><img src="images/mobile/17-verify-mismatch.png" alt="Document does not match"></td>
</tr>
<tr>
<td>A registered parcel flips in a gold <b>Verified on Milki</b> badge with its facts from the ledger and a short owner name ("Asha M."). It also says whether the parcel is mortgaged, disputed or frozen.</td>
<td>A document whose fingerprint does not match the ledger shakes with a <b>Does not match</b> warning. Do not rely on it.</td>
</tr>
</table>

Understood QR formats:

| Code | Meaning |
|---|---|
| `milki:parcel:<PARCEL-ID>` | Proof of ownership (shown on the parcel screen) |
| `milki:doc:<DOC-ID>:<sha256>` | A specific document version |
| A verification URL, or a bare parcel ID | Also accepted |

The same checks are open API endpoints (limited to 60 requests per minute per address):

```bash
curl http://localhost:4100/api/v1/verify/parcels/DSM-KIN-12-45
```

```bash
curl "http://localhost:4100/api/v1/verify/documents/DOC-0123456789ABCDEF?sha256=<64 hex characters>"
```

---

## 14. Partner API for bank systems

Banks can connect their core banking systems directly. An administrator creates an API client (section 11.4) and gives the bank the key once. Every call sends it in the `x-api-key` header.

| Call | Scope | What it does |
|---|---|---|
| `GET /partner/parcels/{id}` | `parcels:verify` | Parcel facts, status and active encumbrances from the ledger. Amounts only for your own bank. No owner identity |
| `POST /partner/parcels/{id}/verify-owner` `{nida}` | `parcels:verify` | Answers `ownerMatches: true/false` by comparing salted hashes; the NIDA number is never stored or logged |
| `GET /partner/encumbrances` | `encumbrances:write` | Your bank's encumbrances |
| `POST /partner/parcels/{id}/encumbrances` | `encumbrances:write` | Add a mortgage, charge, caveat or lien |
| `PATCH /partner/encumbrances/{id}` | `encumbrances:write` | Update amount, currency, reference or terms |
| `POST /partner/encumbrances/{id}/release` `{reason}` | `encumbrances:write` | Release |
| `GET /partner/tx/{txId}` | any | Commit status of your own submission |

Examples:

```bash
curl -H "x-api-key: $MILKI_KEY" http://localhost:4100/api/v1/partner/parcels/DSM-KIN-12-45
```

```bash
curl -X POST -H "x-api-key: $MILKI_KEY" -H "content-type: application/json" \
  -d '{"nida":"19900101123450000101"}' \
  http://localhost:4100/api/v1/partner/parcels/DSM-KIN-12-45/verify-owner
```

```bash
curl -X POST -H "x-api-key: $MILKI_KEY" -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"type":"MORTGAGE","amount":95000000,"currency":"TZS","reference":"CRDB/HL/2026/0107"}' \
  http://localhost:4100/api/v1/partner/parcels/MWZ-ILE-23-153/encumbrances
```

Writes return `202 {txId, encumbranceId}`. Poll `GET /partner/tx/{txId}` until `COMMITTED` (or `FAILED`). Writes are signed on the ledger by a bank identity that belongs to that API client. Machine clients have no re-authentication step; the key, its scopes, the idempotency key and the audit log take its place. Exceeding the client's rate limit returns `429 RATE_LIMITED`.

---

## 15. A complete transfer, start to finish

Asha sells parcel `DSM-KIN-12-45` to Juma.

| # | Who | Where | Action | Status after |
|---|---|---|---|---|
| 1 | Asha (owner) | App: parcel → **Transfer this parcel** | Finds Juma by phone, enters the price, confirms with her fingerprint (T3) | Initiated; parcel *Pending transfer* |
| 2 | Juma (buyer) | App: Home → **Waiting for you** | Reviews and taps **Accept transfer** (T3) | Buyer accepted |
| 3 | Juma or Asha | App: transfer → **Upload a document** | Attaches the payment receipt (T3) | (unchanged) |
| 4 | Land officer | Web: **Transfers** → the transfer | **Confirm payments** against the receipt (T3) | Payments confirmed |
| 5 | Land officer | Web | **Verify transfer** (T3) | Officer verified |
| 6 | Registrar | Web: **Transfers** queue | **Approve transfer** (T3) | Completed; Juma is the owner |
| 7 | Anyone | App: **Verify** | Scans the parcel QR | Shows "Juma H." as owner |

At every step both parties get a notification, the portal queues update live, and the step appears in the parcel's history with its transaction ID. This whole flow is automated as an end-to-end test (`web/e2e/full-transfer.spec.ts`).

---

## 16. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| **No SMS code arrives** | In development, codes are in Mailpit (http://localhost:8126). Codes expire after 5 minutes; use **Resend**. |
| **"Too many attempts" on sign-in** | The sign-in, registration and code endpoints allow 20 requests per minute per address (`AUTH_RATE_LIMIT_PER_MIN`). Wait a minute. |
| **"Your session ended"** | The 7-day session expired, the account was deactivated, or the refresh token was used twice. Sign in again. |
| **"Ledger unavailable" (503)** | The Fabric network is down. Run `./network/scripts/start.sh` (after a reboot) or `./network/scripts/up.sh` (fresh). Sign-in and support still work. |
| **A ledger action is refused with a message** | The ledger checked a rule, for example "This parcel has an active mortgage with CRDB Bank". The message says what to fix; nothing was written. |
| **"Waiting for commit" takes long** | The app listens for the commit event and falls back to polling. If it times out, the transfer page shows the true state on refresh. Retrying is safe because of the idempotency key. |
| **Fingerprint option is missing on the phone** | The device has no fingerprint, face or PIN set up, or the setting is off in **Settings**. Password confirmation always works. |
| **"Integrity failure" when downloading a document** | The stored file no longer matches the fingerprint on the ledger. The download is blocked on purpose; report it. |
| **Map tiles are grey on the parcel page** | The browser cannot reach the OpenStreetMap tile servers (for example a closed network). The coordinates are still shown. |
| **Push notifications do not arrive** | Push needs `flutterfire configure` (Firebase). Without it, notifications arrive while the app is open. |

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Ledger** | The Hyperledger Fabric blockchain that is the legal source of truth for ownership. |
| **Block / transaction ID (txId)** | Where and under which ID a change was recorded. Shown after every T3 action. |
| **Endorsement** | Peers of the required organisations signing a change before it is accepted (Ministry and Land Office or Bank). |
| **Private data collection** | Data (sale price, NIDA references) kept only on Ministry and Land Office peers, never on the shared ledger. |
| **Encumbrance** | A bank's legal claim on a parcel: mortgage, charge, caveat or lien. |
| **Dispute** | A recorded disagreement over a parcel (boundary, ownership) that blocks transfers until resolved. |
| **Ownership version** | A counter that increases each time ownership moves. |
| **SHA-256 fingerprint** | A 64-character code computed from a file. Any change to the file changes it. |
| **Re-authentication** | Proving it's you again just before a ledger write (password, SMS code or fingerprint). |
| **Idempotency key** | A unique ID on each write, so a retried request is never applied twice. |
| **SLA** | The time allowed to first respond to and to resolve a support ticket. |
| **CSAT** | Customer satisfaction: the average star rating landowners give resolved tickets. |
| **NIDA** | Tanzania's National Identification Authority number. |
| **TRA** | Tanzania Revenue Authority (transfer taxes and fees; mocked in this project). |
