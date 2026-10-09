# ACNU Gala & Awards 2027 — UX & Structure Audit Report

- **Project:** ACNU "Gala & Awards" ceremony, 3rd edition, 2027, Douala (Cameroon)
- **Scope:** AUDIT ONLY. No project file was modified except this report.
- **Audience:** guests, sponsors/partners, ticket buyers (Cameroon-first, French-first, mid-range Android, 3G/4G)
- **Business goals:** (1) sell tickets, (2) attract and convert sponsors/partners
- **Method:** static read of the repository (HTML, CSS, JS, API functions, rules, config). Every finding cites a file and line/selector.

> Note on terminology: the brief describes "Payer des billets" as *a separate HTML page with its own header*. The code does **not** match that: the ticket flow is a hidden in-page section (`#paiement`) inside `index.html` (`public/index.html:616`), revealed by JavaScript (`public/js/main.js:196-222`). There is **no separate ticket page**. This discrepancy is itself a finding (see A/C).

---

## 1. Executive summary

**Five biggest problems**
1. **The gala itself has no date, time or address.** The hero only shows the *partnership deadline* ("30 septembre 2026"), never the event date/venue/time (`index.html:55,76,421,505,573`). A visitor cannot answer "when/where is it?".
2. **The sponsor/partner funnel is broken.** The contact form `#partnershipForm` has no submit handler anywhere in the JS (`main.js`, `payments.js`, `admin.js` contain no reference), so it does nothing; and the "Je m'engage" package CTAs point to the *ticket* payment section (`index.html:266,286,309,331`), not to the partner form.
3. **The buyer never receives a reference number.** The confirmation panel (`index.html:766-773`) shows only "Merci !" and never renders the `TX-…` id that the FAQ and section copy promise (`index.html:591,621`); CSS for `.tx-id` exists but is unused. No receipt, no email, no follow-up.
4. **The ticket section is hidden and JS-dependent.** `#paiement` carries the `hidden` attribute (`index.html:616`) and only appears if JS runs (`main.js:196-222`); `[hidden]{display:none!important}` (`styles.css:106-108`). With JS blocked/slow on a mid-range phone, ticket sales are impossible.
5. **Proof upload failure still shows success.** If `/api/upload-proof` fails, the code toasts "Preuve non téléversée…" (`payments.js:310-312`) but then still shows the green "Merci !" success screen (`payments.js:316-318`). Buyer thinks they are done; the admin may never see a proof.

**Five biggest wins available**
1. Add an explicit event date/time/venue block in the hero and ticket page — a few lines of copy (quick win).
2. Show the transaction reference on the confirmation screen and offer a "download receipt / WhatsApp my reference" step (`payments.js:316`, reuse `.tx-id`).
3. Wire `#partnershipForm` to a real submit + confirmation, and repoint the four package CTAs to it (quick win, big sponsor impact).
4. Add WhatsApp click-to-chat and Open Graph/WhatsApp share tags — the two highest-leverage channels in Cameroon (quick wins).
5. Remove the two unused Firebase SDKs (storage, analytics) and dead CSS, cutting page weight significantly on 3G.

---

## 2. Current site map

Two real HTML pages plus serverless API endpoints.

```
/ (public/index.html)                      ← single long landing page (in French)
│  header: brand + nav(Présentation, Prix & distinctions, Partenariats, Contact) + "Payer des billets"
│  ├── Hero (#hero, aria-label "Introduction")                     index.html:50-93
│  │     ├── kicker "3e édition · Gala & Awards 2027 · Douala"      :55
│  │     ├── h1 "Célébrer l'excellence. Inspirer la jeunesse."      :56
│  │     ├── CTAs: "Devenir partenaire" →#partenaires ; "Payer / Soumettre en ligne" →#paiement  :58-64
│  │     └── edition-card (deadline, Douala, 6 catégories, jeunes)  :68-91
│  ├── Trust strip (ACNU, APJC-UN, for-un.com, "Depuis 2014")       :96-115
│  ├── #apropos  "Présentation générale" — 4 photo cards            :118-148
│  ├── #prix     "Prix & distinctions" — 6 category cards (2 placeholders, all "À confirmer")  :151-236
│  ├── #partenaires "Sponsoring & partenariats" — 4 packs + ciblé   :239-352
│  │     └── CTAs "Je m'engage" → #paiement  (WRONG TARGET)         :266,286,309,331
│  ├── (unnumbered) "Pourquoi nous rejoindre" — 5 benefits          :355-411
│  ├── #contact  "Manifestez votre intérêt" — #partnershipForm + info cards  :414-557
│  ├── (unnumbered) FAQ accordion (5 items)                         :560-614
│  └── #paiement (section, hidden) "Soumettez et suivez votre paiement"      :616-776
│        ├── #payApp → #payBox → #payForm  (5 sections: Contact · Quantité · Participants · Paiement · Preuve)
│        └── #payDone (success panel, NO reference number)          :766-773
│  footer (Navigation, Liens utiles, Coordination, "Espace administrateur" link)  :780-824
│
/admin  → public/admin.html (Vercel rewrite, vercel.json)           admin.html:1-243
│  ├── admin-header (title + "Retour au site" + logout)             :81-87
│  ├── #gate  login (email + password, Firebase Auth)               :91-121
│  ├── #adminApp  stats + transactions table                         :124-168
│  ├── #proofLightbox                                                :172-177
│  └── #txModal  transaction detail + approve/reject                 :180-231
│
/api/upload-proof        POST multipart → Postgres `proofs`         api/upload-proof.js
/api/proof/[txId]        GET proof bytes from Postgres              api/proof/[transactionId].js
```

**Navigation paths (current)**
- Every public nav link is an in-page anchor (`#apropos`, `#prix`, `#partenaires`, `#contact`).
- "Payer des billets" and all `[data-pay-cta]` links target `#paiement`; JS unhides the section and scrolls to it (`main.js:200-221`). Header and footer therefore stay the same page — there is no separate ticket page to compare branding/footer against.
- Footer "Espace administrateur" → `admin.html` (`index.html:800`), also reachable via `/admin` rewrite.
- Orphan: `public/js/gallery.js` is **never loaded** by any HTML (`grep gallery.js` in `*.html` → 0 hits) and targets `#tour`, which **does not exist** in `index.html`. The "Visite virtuelle" section is missing entirely. There is **no "Équipe" section** either.

---

## 3. Audit findings (A–L)

### A. Information architecture and navigation

**Current state.** A single-page scroll: Présentation → Prix → Partenariats → Pourquoi → Contact → FAQ → (hidden) Paiement. Header nav omits "Visite virtuelle" and "Équipe" because those sections do not exist. The ticket flow is an in-page hidden section.

**Problems**
- **A1 — The narrative misses the essentials.** The order never delivers *what/when/where/how to attend*. No event date/time/venue anywhere; only the partnership deadline "30 septembre 2026" (`index.html:76,421,505,573`). *(Critical)*
- **A2 — Section order serves sponsors before buyers.** "Prix & distinctions" (6 cards, 2 are "Catégorie à définir" placeholders, all "Dernier lauréat : À confirmer", `index.html:211-233`) precedes anything about attending; ticket sales are buried in a hidden section at the very bottom. *(High)*
- **A3 — CTA labels are inconsistent / wrong-targeted.** "Payer des billets" (nav, `:37`), "Payer / Soumettre en ligne" (hero, `:63`, footer `:799`), "Je m'engage" (packs, `:266,286,309,331`). The three "Payer…" labels name different things, and "Je m'engage" (a sponsor action) jumps to the ticket form. *(High)*
- **A4 — Missing sections vs the brief.** No "Visite virtuelle" (gallery.js orphaned) and no "Équipe" section. *(Medium)*
- **A5 — Footer gaps.** Footer has no gala date, no venue/address, no directions, no program, no refund policy, no WhatsApp, no social links; it exposes "Espace administrateur" (`index.html:795-821`). *(Medium)*
- **A6 — "Separate ticket page" premise not met, but no functional downside.** Since the flow is in-page with the shared header/footer, branding is consistent by construction. The real issue is the `hidden`+JS dependency (see C1). *(Low)*

**Recommendation.** Reorder so the attendee path leads, sponsors follow: Hero (what/when/where + buy) → Présentation → Ce qui vous attend/Programme → Prix & distinctions → Partenariats → Visite virtuelle → Équipe → FAQ → Contact. Fix labels to one vocabulary. Add the missing sections or delete the orphan script. **Effort: M.**

### B. Conversion and calls to action

**Current state.** Hero has a primary "Devenir partenaire" (gold) and a secondary "Payer / Soumettre en ligne" (ghost) (`index.html:58-64`). Sticky header always offers "Payer des billets" (`:37`). Packs each have a full-width "Je m'engage" (`:266,286,309,331`).

**Problems**
- **B1 — Hero buries the #1 goal.** The gold primary CTA is "Devenir partenaire"; ticket purchase (goal #1) is the ghost button and is named ambiguously ("Soumettre en ligne"). Nothing states "achetez vos billets". *(High)*
- **B2 — 5-second clarity fails.** Hero communicates an abstract promise ("Célébrer l'excellence. Inspirer la jeunesse.", `:56`) but no date, no venue, no time, no price-from, no "buy tickets". The edition card lists "Douala" and a *deadline*, not the event (`:73-90`). *(Critical)*
- **B3 — No persistent mobile buy bar.** On mobile the "Payer des billets" button lives inside the collapsed menu (`styles.css:2019-2021`); there is no bottom sticky "Acheter des billets". *(High)*
- **B4 — Trust signals are thin and partially unverifiable.** Trust strip cites ACNU/APJC-UN/for-un.com/"Depuis 2014" (`:96-115`) and legal IDs exist (`:550-552`), but there are no past-edition photos (the 4 photo cards point to **missing files**, see G1), no named organiser, no logos, no testimonials. "Secure-payment reassurance" is a single line (`:754`). *(High)*
- **B5 — Contact is text-only.** Four phone numbers and an email (`:531,541`), no WhatsApp link, no hours location, despite "8h à 18h, 7j/7" claim (`:521`). *(Medium)*

**Recommendation.** Make "Acheter / Payer mes billets" the gold primary hero CTA, put event date/venue/time directly under `h1`, add "Devenir partenaire" as secondary, add a mobile sticky buy bar, add a WhatsApp button and past-edition proof. **Effort: M.**

### C. Ticket purchase flow (end to end)

**Current state.** One scrolling form, 5 sections (`index.html:624-762`): 1 Contact, 2 Quantité par type, 3 Noms des participants, 4 Paiement MoMo, 5 Preuve. Submit validates in JS (`payments.js:199-325`) and writes to Firestore (fallback localStorage) (`firebase.js:14-26`).

**Problems**
- **C1 — Hidden + JS-dependent section.** `#paiement` is `hidden` (`index.html:616`); revealed only by JS (`main.js:196-222`). Without JS, no ticket purchase. *(Critical)*
- **C2 — No reference shown on confirmation.** `#payDone` (`index.html:766-773`) never displays `tx.id`; the id is generated (`payments.js:262`) but only stored. FAQ promises "identifiant de transaction (TX-…)" (`index.html:591`) and the lede promises "un identifiant de transaction" (`:621`). *(Critical)*
- **C3 — Failure still shows success.** Sol— failed upload toasts an error then shows "Merci !" (`payments.js:310-318`). *(High)*
- **C4 — Tier clarity is minimal.** Only name + price + max are shown (`index.html:662-694`); **no "what's included"** per tier (no seat, meal, access level, perks). No visual "remaining availability" (only a hardcoded `max`), no "from 15 000 FCFA" entry price in the hero. *(High)*
- **C5 — No real inventory / sold-out handling.** `max` is a static input bound (`payments.js:8-12,106-111`); nothing decrements or checks real stock, so oversell is possible and a "sold-out tier" cannot be represented. *(High)*
- **C6 — Edge cases unhandled.** Double-submit: button is disabled during the async step (`payments.js:288,314`) but there is no idempotency key and a page refresh resubmits. Network drop mid-upload: handled as C3 (success shown). Wrong file type / >8 Mo: validated client-side with clear French messages (`payments.js:151-160`) — good. *(Medium)*
- **C7 — No progress feedback on upload.** Only a spinner + "Envoi en cours…" (`payments.js:289`); no upload percentage, no per-file progress, no retry button. *(Medium)*
- **C8 — No receipt / follow-up.** No email, no receipt download, no WhatsApp confirmation. Buyer is told only "vos billets vous seront envoyés par email" (`index.html:771`) with no timing. *(High)*
- **C9 — Participants required, but no per-participant email.** Every ticket needs a name (`payments.js:222-238`) yet only the buyer's email is captured; no mechanism to deliver each ticket to its holder. *(Low)*
- **C10 — Typo in data.** `payMethod: "momomo"` (`payments.js:273`) is mapped in admin to "Mobile Money (MoMo)" (`admin.js:41`), so it displays, but the value is malformed. *(Low)*

**Recommendation.** Remove `hidden` (progressive enhancement), render `TX-…` on confirmation with "copier / envoyer par WhatsApp", gate the success screen on proof success or clearly show "preuve manquante", add tier inclusions and availability, add upload progress + retry, add minimum receipt. **Effort: L.**

### D. Partnership flow ("Devenir partenaire")

**Current state.** `#partnershipForm` (`index.html:426-512`) with company, manager, role, phone, email, 5 intent checkboxes, 4 level radios, custom amount, meeting date; side info cards (`:514-554`). Packs shown above with 4 tiers (Bronze 200k, Silver 350k, Gold 700k, Platinum 2M) plus "Sponsoring ciblé" pills (`:250-350`).

**Problems**
- **D1 — The form does nothing.** No JS listens for `#partnershipForm` submit; `payments.js` only wires `#payForm` (`payments.js:199`). With `novalidate` and no `action`, submit performs a native GET reload of `index.html` with query params; no data is captured, no confirmation. *(Critical)*
- **D2 — CTAs point to the wrong place.** "Je m'engage" buttons target `#paiement` (the ticket form) (`index.html:266,286,309,331`), so an interested sponsor lands on "quantité de billets". *(High)*
- **D3 — Form is long for a first contact.** Two fieldsets + 5 checkboxes + 4 radios + custom amount + date (`:474-501`) before any human contact; no progress, no "quick callback" path. *(Medium)*
- **D4 — No confirmation/follow-up.** No success state, no "we will contact you within X", no downloadable dossier/PDF, no calendar booking. *(High)*
- **D5 — Benefit clarity is decent but unverifiable.** Packages list good benefits (`:257-263` etc.) but past partners/logos absent; "Attestation de partenariat" etc. cannot be verified from code. *(Medium)*

**Recommendation.** Add a submit handler that validates, shows a confirmation with a reference and next-step timing, and optionally posts to the same backend; repoint package CTAs to `#contact`; shorten to company + contact + intent + level, with an "Envoyez-moi la présentation" secondary. **Effort: M.**

### E. Mobile-first and responsive behavior

**Current state.** Breakpoints at 1024, 860, 600, 560, 520 px (`styles.css:1990,1999,2027,1469,1824`); mobile menu ≤860 px; forms collapse to one column ≤600 px.

**Problems**
- **E1 — Tap targets below 44 px.** `.qty-btn` is 36×36 (`styles.css:1384-1386`), `.qty-stepper input` is 64×40 (`:1403-1405`), `.btn--sm` is 40 px (`:196-200`), lightbox close 44 px ok (`:1728`). Fails the 44 px minimum. *(High)*
- **E2 — Sticky header can crowd small screens.** Header is 72 px sticky (`styles.css:26,224-233`); nav is absolutely centered on desktop (`:294-301`) and could overlap the brand/CTA around 861–1000 px. *(Low)*
- **E3 — Potential horizontal scroll.** `.trust-strip__item` uses `white-space:nowrap` (`:566`); long items on ≤360 px can overflow. Table in admin is inside an `overflow:auto` panel (`admin.html:150`) — ok. *(Medium)*
- **E4 — Tiny text.** `.brand__sub` 9 px (`styles.css:279`), `.meta-chip span` 11 px (`:537-539`), many 12–13 px. Below the 12 px comfortable floor; 9 px is hard to read on 3G phones. *(Medium)*
- **E5 — Menu behavior is sound.** Toggle is 44×44 (`:342-345`), Esc closes it, `aria-expanded` updated, closes on link tap (`main.js:101-122`). Positive. *(—)*

**Recommendation.** Raise `.qty-btn`/`.btn--sm`/qty input to ≥44 px; clamp trust-strip (allow wrap or marquee); bump min font to 12 px. **Effort: S.**

### F. Performance and low-bandwidth readiness

**Current state.** Unminified CSS ~46.6 KB (`styles.css`, 2046 lines in file) and JS (main 7.8 KB, payments 11.9 KB, admin 13.3 KB). Fonts from Google (Playfair up to 6 weights + italic; Inter 4 weights) (`index.html:8-10`). Five Firebase compat SDKs loaded on the public page (`index.html:827-831`).

**Problems**
- **F1 — Unused Firebase SDKs on the homepage.** `firebase-storage` and `firebase-analytics` are loaded (`index.html:830-831`) but proofs go to Postgres (`api/upload-proof.js`), not Firebase Storage; analytics is not used. Firestore is only needed for the payment action, yet loads on first paint. Firebase compat bundles are large (hundreds of KB combined). *(High)*
- **F2 — Blocking third-party fonts.** Google Fonts stylesheet is render-blocking (`index.html:10`); no `font-display` control beyond `&display=swap`, no self-hosting. On 3G this delays text paint. *(Medium)*
- **F3 — No minification / bundling / splitting.** All assets ship raw; 5 separate Firebase scripts. *(Medium)*
- **F4 — Heavy GPU effects.** `backdrop-filter: blur(...)` on header, cards, panels, toasts (`styles.css:230,464,612,1235`) is expensive on mid-range Android. *(Medium)*
- **F5 — Missing imagery (so no weight now, but no plan).** Card photos reference non-existent files (see G1). `acnu-logo.png` is 40 KB for a 38×38 display; it is not resized/served as WebP. No `loading="lazy"`, no `srcset` anywhere. *(Medium)*
- **F6 — Virtual tour weight unknown.** `gallery.js` is orphaned; if a real tour (images/video) is added it must be budgeted. *(Low)*

**Recommendation.** Drop storage+analytics scripts; load Firebase only when the payment CTA is tapped; self-host subsets of Inter/Playfair or reduce weights; minify/split; add WebP + `loading="lazy"` + fixed dimensions for all images. **Effort: M.**

### G. Visual design and consistency

**Current state.** Coherent dark "gala" palette with gold gradients (`styles.css:4-31`), Playfair Display headings + Inter body (`:28-29`), pill buttons, glass cards, reveal-on-scroll. Consistent across index and admin because admin reuses `styles.css`.

**Problems**
- **G1 — Broken primary imagery.** All four Présentation cards point to `assets/images/cards/ceremonie.jpg`, `influence.jpg`, `vitrine.jpg`, `label.jpg` (`index.html:130,134,138,142`) but `public/assets/images/cards/` is **empty**; cards fall back to a gradient (`styles.css:646-660`). This reads as unfinished. *(High)*
- **G2 — Two brand systems.** The public site uses the sticky `.header` (`styles.css:224`); admin uses a bespoke `.admin-header` (`admin.html:12-76`). Acceptable separation, but the public footer/admin link styling is inconsistent (admin link plain in footer, `index.html:800`). *(Low)*
- **G3 — Placeholder pricing content.** Two of six award categories are "Catégorie à définir" and every winner is "À confirmer" (`index.html:211-233,172-232`). *(Medium)*
- **G4 — Positive: typography hierarchy and spacing are coherent.** `clamp()` type and `--space`/section rhythm (`styles.css:100-102,436-440,582-591`) are consistent. *(—)*

**Recommendation.** Ship real photos (optimised), remove or clearly mark placeholder categories, and align the footer admin link with the design system. **Effort: S.**

### H. Accessibility

**Current state.** Generally strong foundation: `lang="fr"` (`index.html:2`), skip link (`:14`), `:focus-visible` outline (`styles.css:72-76`), `aria-hidden` on decorative SVGs, labelled nav landmarks, `role="alert"` error spans, reduced-motion handling (`styles.css:2038-2046`, `main.js:145-164`, `gallery.js`).

**Problems**
- **H1 — FAQ accordion has no `aria-controls`/region wiring.** Buttons toggle `aria-expanded` (`main.js:179,183`) but answers have no `id`/`role="region"`/`aria-labelledby`, and controls omit `aria-controls` (`index.html:569-611`). *(Medium)*
- **H2 — Upload zone is `role="button"` with `tabindex=0` but is a `<div>`; nested `<input type=file>` is visually hidden.** Keyboard works (`payments.js:145-147`) but screen readers may not announce file constraints; add `aria-describedby`. *(Medium)*
- **H3 — Error text is not associated to inputs.** `.error` spans use `role="alert"` but inputs lack `aria-invalid` / `aria-describedby` (`index.html:431-434`, `payments.js:129-139`). *(Medium)*
- **H4 — Duplicate `<h1>` in admin.** `admin.html:82` and `admin.html:127` both `<h1>` (one hidden until login). *(Low)*
- **H5 — Modal focus management.** `#txModal` sets `aria-modal` (`admin.html:181`) but does not trap focus or return focus on close (`admin.js:236-271`). *(Medium)*
- **H6 — Small font sizes** (9–11 px) hurt low-vision users (see E4). *(Medium)*

**Recommendation.** Add `aria-controls` + answer ids, `aria-invalid`/`aria-describedby`, focus trap in modal, and raise small text. **Effort: M.**

### I. Content and language

**Current state.** French throughout, professional tone; legal identifiers and phone numbers present.

**Problems**
- **I1 — Missing expected content.** No programme/schedule, no dress code, no venue address/map/directions, no refund/cancellation policy, no FAQ about tickets (prices, children, accessibility), no parking/transport. *(High)*
- **I2 — Spelling/typos.** "Récepissé" should be "Récépissé" (`index.html:551`, and FAQ `:609`). Consider also consistent "Classique" vs "Classic" (brief says Classic; UI says "Classique", `index.html:686`, `payments.js:11`). *(Low, quick win)*
- **I3 — Ambiguous/ashamed microcopy.** "Payer / Soumettre en ligne" is vague; error "Quantité supérieure à la disponibilité" (`payments.js:217`) implies inventory that does not exist. Confirmation copy lacks next-step timing. *(Medium)*
- **I4 — English version.** Not warranted as a full duplicate at launch; a single "EN" toggle for the hero + key facts (date, venue, how to pay, contact) is the cheapest correct step. Best done as a lightweight `?lang=en` data-attribute swap or a single `en.html` essentials page, not a full translation of the 800-line page. *(Low)*

**Recommendation.** Add programme, dress code, venue map, refund policy, WhatsApp contact; fix French typos; consider a minimal EN essentials panel. **Effort: M.**

### J. "Visite virtuelle", "Prix & distinctions", "Équipe"

- **"Visite virtuelle" — does not exist.** No section/`#tour` in `index.html`; `gallery.js` is orphaned and never loaded. Either implement a lightweight gallery (6–8 compressed images, lazy-loaded, captions, keyboard nav already written in `gallery.js`) or delete `gallery.js`. *(High — the section is a stated deliverable and is missing.)*
- **"Prix & distinctions" — earning its place, but unfinished.** Six cards convey the concept and the sponsor hook ("Chaque catégorie peut être parrainée", `index.html:158`), but two are placeholders and all winners are "À confirmer" (`:211-233`). Consolidate to the confirmed categories and add a short "Comment candidater / parrainer une catégorie" CTA. *(Medium)*
- **"Équipe" — does not exist.** No team/organiser section. For a gala depending on institutional trust, add a compact "Équipe de coordination / partenaires institutionnels" block (names or logos + roles) to raise credibility, or fold it into the trust strip. *(Medium)*

**Recommendation.** Implement a real, light virtual tour; finalise awards; add a short Équipe/partners credibility block. **Effort: M.**

### K. SEO and sharing

**Current state.** `index.html` has a good `<title>` and `<meta name="description">` (`:6-7`); `admin.html` has its own (`:6-7`).

**Problems**
- **K1 — No Open Graph / Twitter tags.** Sharing on WhatsApp/Facebook shows no image, no title card (`grep` for `og:`/`twitter:` → 0 hits). WhatsApp is a primary channel in Cameroon. *(High)*
- **K2 — No favicon / app icons.** No `rel="icon"`/`apple-touch-icon`/`theme-color` in either page. *(Medium)*
- **K3 — No structured data.** No `Event` JSON-LD (name, startDate, location, offers, organizer) → no rich results. *(Medium)*
- **K4 — No `robots.txt` / `sitemap.xml`.** None present in the repo. *(Medium)*
- **K5 — No canonical URL.** Single page mitigates duplicate risk, but `/` vs `/index.html` and the `/admin` rewrite deserve canonicals/`noindex` on admin. *(Low)*
- **K6 — `admin.html` is indexable.** No `noindex`; it appears in search and is linked in the footer (`index.html:800`). *(Medium, also L)*

**Recommendation.** Add OG + Twitter card (1200×630 share image), favicon set + `theme-color`, Event JSON-LD, `robots.txt` + `sitemap.xml`, `noindex` on admin, canonical on `/`. **Effort: S (each).**

### L. Security and trust (UX-relevant only)

**Problems**
- **L1 — Admin entry exposed to the public.** Footer link "Espace administrateur" (`index.html:800`) plus `/admin` rewrite (`public/vercel.json:2-4`). Access is protected by Firebase Auth + Firestore rules (`firestore.rules:5-18`), so this is a surface/hygiene issue, not a data breach. *(Low)*
- **L2 — Firestore write is open to anonymous buyers.** `allow create: if request.resource.data.status == 'pending'` (`firestore.rules:10`) is required for the flow, but nothing validates amount/tier server-side, so a crafted client could write arbitrary amounts. UX-relevant as it undermines the admin's trust in figures. *(Medium)*
- **L3 — Public `firebase-config.js` exposes the web API key** (`firebase-config.js:2`). Normal for Firebase web, but it must be restricted by domain/API in Google Cloud. Cannot verify restrictions from code → "Not verifiable from code". *(Low)*
- **L4 — Service account secret in the working tree.** `service-account.json` (contains a private key) exists locally; it is gitignored and **not tracked** (`git ls-files` returns nothing; `git status` shows only three untracked scripts). Still, ensure it is never deployed: `firebase.json` ignores `**/.*` and `**/*.env*` but not `service-account.json` (`firebase.json`). Flag only. *(Medium — flag, do not fix.)*
- **L5 — Proof endpoint is public and unauthenticated.** `GET /api/proof/[transactionId]` returns the image to anyone who knows a transaction id (`api/proof/[transactionId].js:16-53`). IDs are 6 random chars (`main.js:49-54`) and URL-guessable, exposing payment screenshots. *(Medium — flag.)*

**Recommendation.** Remove the public admin link (keep URL private), add server-side amount validation, restrict the API key, confirm `service-account.json` is excluded from deploys, require auth or a signed token for proof reads. Flag only per brief. **Effort: S–M.**

---

## 4. Proposed target structure

**Single best recommendation** — keep one primary landing page (fast on 3G) and add a dedicated ticket purchase page.

**Site map**
```
/                       Landing (FR; optional EN essentials toggle)
├── #hero               Date • Heure • Lieu • "Acheter mes billets" • "Devenir partenaire"
├── #apropos            Présentation (real photos)
├── #programme          Ce qui vous attend — programme/schedule, dress code
├── #prix               Prix & distinctions (confirmed categories + parrainer une catégorie)
├── #partenaires        Partenariats — 4 packs + sponsoring ciblé → "Je m'engage" → #contact-partenaire
├── #visite-virtuelle   Visite virtuelle — light gallery of past edition (lazy, captioned)
├── #equipe             Équipe & partenaires institutionnels
├── #faq                FAQ (tickets, refunds, access, dress code)
└── #contact            Contact — WhatsApp, phones, email, map + "Devenir partenaire" form
/tickets                Dedicated ticket purchase page (own header/footer, same branding)
/billets-confirmation   Confirmation with TX reference + receipt/WhatsApp (or in-page state)
/admin                  Admin console (noindex, not linked publicly)
```

**Section order (attendee path first, sponsor path second)**
1. Hero (what/when/where/how) → 2. Présentation → 3. Programme → 4. Prix & distinctions → 5. Partenariats → 6. Visite virtuelle → 7. Équipe → 8. FAQ → 9. Contact.

**What each section must contain**
- **Hero:** event name, "3e édition", **exact date + start time**, venue + city, price "à partir de 15 000 FCFA", primary CTA "Acheter mes billets", secondary "Devenir partenaire", tertiary "Voir la visite virtuelle".
- **Présentation:** real photos, 3–4 value cards, past-edition proof.
- **Programme:** date, timeline (accueil, cérémonie, remises, dîner), dress code.
- **Prix & distinctions:** confirmed categories, how to nominate, "parrainer cette catégorie" → partner form.
- **Partenariats:** 4 packs with inclusions + "Je m'engage" → `#contact`; sponsoring ciblé.
- **Visite virtuelle:** 6–8 optimised images, captions, keyboard nav (reuse `gallery.js`).
- **Équipe:** coordination names/roles + institutional partners' logos.
- **FAQ:** partnership, payment, follow-up, refunds, access, dress code.
- **Contact:** WhatsApp button, phones, email, address/map, partner form.
- **Footer:** date/venue, nav, WhatsApp, email, legal IDs, refund policy link, social.

**Where each CTA lives**
- Buy tickets: hero (gold), sticky header, mobile sticky bottom bar, end of Prix & after FAQ, footer.
- Devenir partenaire: hero (secondary), Partenariats packs, end of Prix, footer.

**Wireframe-level description (text)**

*Hero (mobile-first, single column ≤860 px):*
```
[ header: logo  ·  ☰ ]  (sticky, 64–72 px; "Acheter" button visible ≤860 px)
kicker: 3e édition · Gala & Awards 2027
H1:      Célébrer l'excellence. Inspirer la jeunesse.
facts row (wrap):  [📅 sam. JJ mois 2027 · 18h30] [📍 Salle, Douala] [🎟 à partir de 15 000 FCFA]
[ Acheter mes billets ]  (gold, full-width on mobile, min 48 px)
[ Devenir partenaire ]   (ghost)
[ Voir la visite virtuelle ] (text link)
```
*Ticket page (/tickets):* same header/footer branding; a progress line "1 Contact · 2 Billets · 3 Paiement · 4 Preuve"; step 1 contact; step 2 tier cards each showing name, price, **inclusions**, remaining availability, quantity stepper (≥44 px); step 3 participant names (collapsed by default); step 4 MoMo number + copy + total; step 5 proof upload with progress + retry; then a confirmation screen showing **TX reference**, status "en attente de vérification", "sous 48h", and buttons "Copier la référence", "Envoyer par WhatsApp", "Télécharger le reçu".

*Mobile menu:* full-width dropdown under the header (≤860 px), 16 px links with 48 px rows, a divider, then the gold "Acheter mes billets" and ghost "Devenir partenaire" stacked; Esc closes; the buy button is always reachable via the header before opening the menu.

---

## 5. Prioritized roadmap

Sorted by impact on ticket sales, then sponsor conversion. "QW" = quick win (< 1 h).

### Phase 1 — before launch

| ID | Change | Why (goal) | Severity | Effort | Files affected | Dependencies |
|----|--------|-----------|----------|--------|----------------|--------------|
| P1.1 | Add real event date, time, venue and address to hero + ticket page + footer | Ticket sales (5-sec clarity) | Critical | S (QW) | `index.html` hero/footer | Confirmed event facts from PO |
| P1.2 | Show the `TX-…` reference + status + next-step timing on confirmation; add "Copier"/WhatsApp | Ticket sales (trust/support) | Critical | S | `index.html`, `js/payments.js` | — |
| P1.3 | Wire `#partnershipForm` submit → validation + confirmation; capture data | Sponsor conversion | Critical | M | `js/main.js` (or new `js/partners.js`), `index.html` | Backend/email decision |
| P1.4 | Repoint all "Je m'engage" pack CTAs to the partner form; fix CTA vocabulary | Sponsor conversion | High | S (QW) | `index.html` | P1.3 |
| P1.5 | Make "Acheter mes billets" the hero primary CTA; add mobile sticky buy bar | Ticket sales | High | S | `index.html`, `css/styles.css` | P1.1 |
| P1.6 | Un-hide ticket section (progressive enhancement / separate page) so it works without JS | Ticket sales | Critical | M | `index.html`, `js/main.js`, `css/styles.css` | — |
| P1.7 | Gate success on proof upload; on failure show explicit "preuve manquante, renvoyer" state | Ticket sales (data integrity) | High | S | `js/payments.js`, `index.html` | — |
| P1.8 | Add per-tier inclusions + "à partir de 15 000 FCFA"; show availability | Ticket sales | High | M | `index.html` | Pricing/inclusions content |
| P1.9 | Remove storage+analytics Firebase scripts; lazy-load Firebase on payment tap | Ticket sales (3G load) | High | S | `index.html`, `js/firebase.js` | — |
| P1.10 | Add Open Graph + Twitter card + WhatsApp share image; favicon + `theme-color` | Tickets + sponsors (sharing) | High | S (QW) | `index.html`, `admin.html`, new `assets/` | 1200×630 image |
| P1.11 | Add WhatsApp click-to-chat + one clear contact channel | Tickets + sponsors | High | S (QW) | `index.html`, `css/styles.css` | WhatsApp number |
| P1.12 | Ship real photos for the 4 Présentation cards (or use the tour images) | Trust (both) | High | S | `assets/images/cards/` | Photos |
| P1.13 | Fix "Récepissé"→"Récépissé"; align "Classique/Classic" | Quality | Low | S (QW) | `index.html` | — |

### Phase 2 — soon after

| ID | Change | Why (goal) | Severity | Effort | Files affected | Dependencies |
|----|--------|-----------|----------|--------|----------------|--------------|
| P2.1 | Add Programme/Schedule, dress code, venue map + directions | Ticket sales | High | M | `index.html` | Event details |
| P2.2 | Add refund/cancellation + ticket FAQ | Ticket sales (trust) | High | S | `index.html` | Policy decision |
| P2.3 | Implement virtual tour (reuse `gallery.js`) or delete the orphan script | Sponsors + tickets (proof) | High | M | `index.html`, `js/gallery.js`, images | Photos |
| P2.4 | Add Équipe/partners credibility block | Sponsor conversion | Medium | S | `index.html` | Names/logos |
| P2.5 | Upload progress bar + retry + client-side image compression | Ticket sales (3G) | Medium | M | `js/payments.js` | — |
| P2.6 | Confirmation follow-up: email receipt + WhatsApp link to support | Ticket sales | High | M | `js/payments.js`, backend | Email/backend |
| P2.7 | Real inventory/availability + sold-out states | Ticket sales (accuracy) | High | M | `js/payments.js`, `js/firebase.js` | Backend counters |
| P2.8 | Raise tap targets to ≥44 px (`.qty-btn`, `.btn--sm`, qty input) and min font 12 px | Mobile UX | High | S | `css/styles.css` | — |
| P2.9 | Accessibility pass: `aria-controls` on FAQ, `aria-invalid`/`aria-describedby`, modal focus trap | Accessibility | Medium | M | `index.html`, `js/main.js`, `js/admin.js` | — |
| P2.10 | Remove public "Espace administrateur" footer link; add `noindex` to admin | Security UX | Medium | S (QW) | `index.html`, `admin.html` | — |
| P2.11 | Add Event JSON-LD, `robots.txt`, `sitemap.xml`; canonical on `/` | Discovery | Medium | S | `index.html`, new files | Domain |
| P2.12 | Self-host/subsets fonts; minify + split CSS/JS; remove dead CSS | Performance | Medium | M | `css/styles.css`, build step | Build tooling |
| P2.13 | Server-side validation of amount/tier; restrict proof endpoint | Trust/security (flag) | Medium | M | `firestore.rules`, `api/*` | Backend |

### Phase 3 — nice to have

| ID | Change | Why (goal) | Severity | Effort | Files affected | Dependencies |
|----|--------|-----------|----------|--------|----------------|--------------|
| P3.1 | Minimal English essentials (hero facts + buy + contact via `?lang=en`) | International guests | Low | M | `index.html`, `js/main.js` | Translation |
| P3.2 | Per-participant ticket delivery (email/QR) | Ticket sales | Low | L | `js/payments.js`, backend | Backend |
| P3.3 | Testimonials / past-edition stats ("200 invités en 2026") | Trust | Low | S | `index.html` | Data |
| P3.4 | Reduce/soften `backdrop-filter` on low-end devices via `@media`/feature query | Performance | Low | S | `css/styles.css` | — |
| P3.5 | Finalise all 6 award categories / previous winners | Trust | Medium | S | `index.html` | Content |

**Quick wins (each < 1 h):** P1.1, P1.4, P1.10, P1.11, P1.13, P2.10.

---

## 6. Open questions for the product owner

These cannot be decided from the code:

1. **What is the exact gala date, start time, and venue address in Douala?** The code only knows the partnership deadline (30 Sep 2026).
2. **Is the gala in 2026 or 2027?** Title says "2027" but all deadlines are 2026 — confirm.
3. **What is included in each ticket tier (Premium 300 000 / VIP 25 000 / Classique 15 000)?** Seat class, meal/drink, perks, access zones.
4. **Is there a refund/cancellation policy?** None in code.
5. **What is the WhatsApp business number** and support hours (the site claims 7j/7, 8h–18h, `index.html:521`)?
6. **Where should the partner form submit to** (email inbox, CRM, the existing Postgres/Neon, or a Google Sheet)? No handler exists.
7. **Is there real ticket inventory** and a source of truth for remaining counts, or is the limit purely static?
8. **After approval, how is a ticket delivered** (email, WhatsApp, PDF with QR, on-site list)? The confirmation promises email but no sender exists.
9. **Who are the coordination team members / institutional partners** for the Équipe block?
10. **Do real past-edition photos exist** for the 4 Présentation cards and the virtual tour?
11. **Which 4–6 award categories are final?** Two are placeholders today.
12. **Are Firebase API-key restrictions and the Postgres/Neon proof data access** managed outside this repo (cannot verify from code)?
13. **Is `service-account.json` present on the deploy machine**, and is it excluded from hosting? `firebase.json` does not explicitly list it.
14. **Should the admin link remain in the public footer**, or be reachable only via the private `/admin` URL?
15. **Is an English version required**, and for all content or only the key facts?
