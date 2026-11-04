# DRESSED — READ-ONLY ANALYSIS: 31-DAY ACCOUNT CREATION COOLDOWN

> **Type: READ-ONLY ANALYSE. Ingen kode, migration, policy, dependency eller
> git-ændring er foretaget.** Ingen commit/push/merge/rebase/reset/stash/
> checkout.
>
> **Evidensmarkering:** **CONFIRMED** = læst i kode/migration her ·
> **INFERRED** = logisk slutning · **UNVERIFIED** = kan ikke afgøres fra
> repoet (Supabase-dashboard, betalingsudbyder, jura) — gæt bruges aldrig.
>
> **Kilder verificeret:** `signup.astro`, `login.astro`, `profile.astro`,
> `Header.astro`, alle 12 filer i `src/pages/api/**`, `src/lib/server/**`, alle
> 17 migrations, `package.json`, `.env`/`.env.example` (kun nøglenavne), samt
> `analysis/dressed-auth-security-gdpr-audit.md` og
> `analysis/dressed-account-security-and-user-isolation-analysis.md`.

---

## 1. Executive Summary

**Hvad systemet gør i dag (CONFIRMED):** DRESSED er et **gratis
tilmeldingssystem uden betaling**. Signup er **rent klient-side**:
`src/pages/signup.astro:263` kalder `supabase.auth.signUp(...)` direkte med den
offentlige anon-nøgle. Der findes **ingen** server-side signup-route, **ingen**
betalingskode, **ingen** betalingsnøgler i `.env`, **ingen** auth-webhooks,
**ingen** edge-functions og **ingen** "aktiv/betalt"-flag. Profil oprettes lazy
ved første `/profile`-besøg (`profile.astro:723`); sletning sker via
`POST /api/account/delete` (DB → Storage → Auth).

**Hvad 31-dages-reglen kræver:** reglen kan **ikke** indføres inde i Supabase
`signUp` — det er en offentlige ende, vi ikke ejer (og om "disable signups"
findes i projektets dashboard er **UNVERIFIED**). Den **eneste** sikre
håndhævelsesplads er **vores egen server**: en lille, server-side
**berettigelses- og cooldown-mekanisme** knyttet til en
**betalings-identitet** (ikke IP, ikke device-fingerprint), som:

- starter ved **bekræftet betaling** (webhook), ikke ved blot at indtaste en e-mail;
- **overlever konto-sletning** (bevidst ingen FK til `auth.users`);
- opbevares **minimalt** (hash af e-mail + betalingsreference + tidsstempler);
- håndhæves via **én central kontrol** i `authenticateSupabaseRequest`
  (`src/lib/server/supabase.ts:37`), som alle 12 API-filer allerede bruger.

**Fund af betydning:**

| # | Fund | Konsekvens |
|---|---|---|
| **K1** | **Intet betalingssystem eksisterer** (0 betalings-kodeord i repoet; dependencies = kun `@astrojs/netlify`, `@supabase/supabase-js`, `astro`, `pngjs`; `.env` har ingen betalingsnøgler) | Hele flowet er grønne marker → udbydervalg = **PRODUCT DECISION REQUIRED** |
| **K2** | `signUp` er offentligt tilgængeligt via anon-nøglen | Kunden kan altid skabe en **tom** Supabase-bruger; reglen skal derfor defineres og håndhæves ved **berettigelse** (brugbar/betalt konto), ikke ved HTML |
| **K3** | `/api/account/delete` sletter 9 tabeller m. `.eq("user_id",…)` + storage + auth | En cooldown-post **uden** `user_id`/FK røres **automatisk ikke** ✓ naturlig overlevelse |
| **K4** | Eksisterende brugere har **ingen** betalingshistorik | Enhver adgangskrævende løsning **skal** bagfill-mærke alle eksisterende brugere — ellers låses alle ude (**kompatibilitets-risiko #1**) |
| **K5** | E-mail-verifikation er dashboard-styret (**UNVERIFIED**) — koden håndterer begge grene (`signup.astro:300-306`) | Cooldown-startpunkt må **ikke** afhænge af verifikation (§5) |
| **K6** | Dublerede `PUBLIC_SUPABASE_*`-nøgler i `.env` (kendt fund) | Hygiejne; ingen betydning for reglen |

**Principper (jf. "do not overengineer"):** lille · server-side ·
privacy-bevidst · ingen tracking · ingen nye dependencies · **ingen** berøring
af wardrobe, outfits, AI, placement, X/Y-scaling eller 3D-arkitektur.

---

## 2. Current Signup Architecture (CONFIRMED — præcis forløb)

```text
/signup (statisk side, src/pages/signup.astro)
  <form class="signup-form">  ← ingen method/action (rent JS)
  submit-handler (signup.astro:225)
    1. feltvalidering (navn, e-mail, køn)              :230-244
    2. password != confirm → RETURN (ingen forespørgsel) :247-252
    3. supabase-konfiguration mangler → RETURN          :254-257
    4. signupButton.disabled = true                     :259  ← dobbeltklik-beskyttelse ✓
    5. supabase.auth.signUp({ email, password,          :263  ← ENESTE STED, DER
         options.data: { name, gender } })                    SKABER BRUGEREN
    6. fejl-grene: user_already_exists / weak_password /
       email_address_invalid / generisk                :274-298
    7. data.session → redirect /profile                 :300-303
       ellers → "Check your email to confirm it…"       :305-306
    8. finally: knap genaktiveres                       :310-313
```

**Verificerede karakteristika:**
- **Ingen** server-route mellem bruger og Supabase Auth: der findes ingen
  `src/pages/api/auth/*`, ingen `signup`-API og ingen webhook-modtager
  (routes-listen = kun `account/delete`, `ai/*`, `characters/*`,
  `profile/source-photo`, `wardrobe/*`).
- **Ingen** betalings-, cooldown- eller "paid"-tjek nogen steder.
- **Intet** `localStorage`-flag indgår i auth (bevist i den forrige audit).
- **E-mail-verifikation:** begge grene håndteres af koden; om den er slået til
  i Supabase = **UNVERIFIED** (kun dashboard kan svare).
- **Profil oprettes ikke ved signup** — lazy-indsættelse ved første
  `/profile`-load (`profile.astro:721-730`, `.insert({ user_id: userId, … })`).
- **Login** (`login.astro:128` `signInWithPassword`) → `/profile` (:151).
- **Logout** (`Header.astro`): `signOut()` + `clearDressedClientState()`.

**Præcise indsætningspunkter (udpeget — IKKE ændret):**

| # | Trin | Fil / funktion |
|---|---|---|
| 1 | Signup begynder (submit) | `src/pages/signup.astro:225` `signupForm.addEventListener("submit", …)` |
| 2 | E-mail/password-validering | `signup.astro:230-252` (klient) |
| 3 | Supabase Auth-bruger oprettes | `signup.astro:263` `supabase.auth.signUp(...)` |
| 4 | Profil oprettes | `src/pages/profile.astro:723` lazy `.insert({user_id, …})` |
| 5 | Betaling hører logisk hjemme | **mellem eligibility og `signUp`** (Option B, §4/§7) |
| 6 | Server-side eligibility-tjek | ny route (§18) + central kontrol i `src/lib/server/supabase.ts:37` `authenticateSupabaseRequest` |
| 7 | Cooldown oprettes | betalingens **webhook** (server-side, §7) |
| 8 | Sletning sker | `src/pages/api/account/delete.ts` (DB → Storage → Auth) |
| 9 | Skal **overleve** sletning | cooldown/registrerings-posten (bevidst uden `user_id`) |
| 10 | Skal **slettes** | alt andet: 9 DB-tabeller, `{uid}/`-storage, auth-user (uændret) |

---

## 3. Current Account Deletion Architecture (CONFIRMED)

```text
POST /api/account/delete          (Header-knap → profil: to-trins bekræftelse)
  auth = authenticateSupabaseRequest(request)      ← identitet KUN fra JWT
  kræver body.confirm === true
  Trin 1  DB barn-først, alle .eq("user_id", auth.user.id):
          wardrobe_results → wardrobe_item_ai_assets → wardrobe_items →
          saved_dressed_outfits (+ dressed_outfit_items) → dressed_characters →
          ai_generation_usage → ai_generation_overrides → profiles (eksplicit)
  Trin 2  Storage: rekursiv, pagineret sletning af alt under {uid}/
          i både profile-images og model-images
  Trin 3  Auth sidst: auth.admin.deleteUser(user.id)
  Svar:   ærlig JSON m. tællere + warnings[]; 502 ved delvis fejl
          (aldrig falsk "alt slettet"), så den kan gentages
  Klient: signOut() + clearDressedClientState() + redirect til /
```

**Hvad sletningen rører:** udelukkende rækker med brugerens `user_id` og filer
under brugerens `{uid}/`-mappe. **Ingen** tabel uden `user_id`-kolonne og
**ingen** FK `→ auth.users … on delete cascade` findes i den liste (FK'er
findes kun på bruger-tabellerne selv). → **En kommende cooldown-tabel uden
`user_id`-kolonne og uden FK til `auth.users` vil *af design* ikke blive
slettet** (K3). Dette er bevidst og er præcis den egenskab, §5/§11 kræver.

---

## 4. Payment Readiness

**Eksisterende (CONFIRMED):** **intet**. Verificeret via:
- søgning efter `stripe|mobilepay|payment|betaling|checkout|invoice|quickpay|7 DKK|
  oprettelsesgebyr` på tværs af kilde/migrations/docs → **kun** ét dokument-citat
  (`DRESSED-AUTH-SQL-ARCHITECTURE-ANALYSIS.md:84` "betalingsdata (fremtidigt)`);
- `package.json`: `@astrojs/netlify`, `@supabase/supabase-js`, `astro`, `pngjs` —
  **ingen** betalings-SDK;
- `.env`/`.env.example`: `PUBLIC_SUPABASE_URL/ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `BACKGROUND_JOB_SECRET`,
  `HF_TOKEN` — **ingen** betalingsnøgler;
- routes-listen: **ingen** webhook-, checkout- eller betalings-route;
- `supabase/functions`: findes **ikke** (edge-functions bruges ikke).

**Konklusion:** betalingstrinet er **helt grønt**. Nedenfor findes *hvor det
logisk skal sidde* — ikke en valgt udbyder. **Udbydervalg = PRODUCT DECISION
REQUIRED** (krav: signerede webhooks, idempotens-nøgler, refusions-API,
stabil kunde-/kort-identitet, DKK-understøttelse, DPA).

### Sammenligning: Option A vs. Option B

| Scenario | **Option A:** signup → betaling → aktivering | **Option B:** oplysninger → betaling → oprettelse |
|---|---|---|
| **Mislykket betaling** | Konto findes **ubetalt** → skal deaktiveres/udløbe (ny tilstand i alle 12 API-ruter) | **Ingen konto** → rent |
| **Forladt checkout** | Oprydningsproblem: ubetalte konti + e-mails forbrugt | Kun en "pending intent" → rent |
| **Dobbelt betaling** | Kræver idempotens (begge) | Kræver idempotens (begge) |
| **Browser refresh** | Konto + betalingstilstand er server-side ✓ | Intent er server-side, kan genoptages ✓ |
| **Webhooks/callbacks** | Webhook sætter "paid"-flag | Webhook udsteder **registrerings-bevis** |
| **Betaling OK, frontend crash** | webhook gør det → genoprettelig ✓ | webhook udsteder bevis → status-side kan hente det ✓ (**Test 9**) |
| **Betaling OK, DB-fejl** | webhook-genforsøg (leverandørens retry) ✓ | samme ✓ |
| **Betaling OK, Auth-oprettelse fejler** | N/A (Auth skabt først) ⇒ men **ubetalt-brugt-konto**-problem flyttes til "penge uden konto" | Beviset forbliver ukonsumeret → **kan gentages** uden ny betaling ✓ |
| **Bruger betaler, men aldrig færdiggør** | Konto står ubetalt | Bevis med udløb → **refusionsbeslutning** (§13) |
| **Bruger får mange konti af én betaling** | Kræver "ét aktivt flag pr. betaling" | Bevis er **engangs** (unikt, forbruges atomisk) ✓ |
| **GDPR-data før betaling** | Auth-user (e-mail) oprettes **før** penge | Kun intent (hash + reference) indtil betaling ✓ **bedre minimering** |
| **Ændring af auth-flow** | Bevarer `signUp` 100% | Bevarer `signUp` **også** (se §7 — B udføres via bevis + eksisterende `signUp`, ikke ved at flytte oprettelsen) |
| **Risiko ved debugging** | Flere tilstande at holde styr på | Færre tilstande |

**Anbefaling:** **Option B** (penge først) — færre tilstande, ingen ubetalte
konti, og "bruger betaler uden at få konto" håndteres med **ét** genbrugeligt,
tidsbegrænset bevis i stedet for en deaktiveringsmotor overalt i koden.
**Bemærk (K2):** da `signUp` forbliver offentligt tilgængeligt, er den egentlige
sikkerhedsgrænse **berettigelses-laget** (§7), uanset hvilken option der vælges.

---

## 5. 31-Day Rule Definition

### 5.1 Den anbefalede definition (præcis)

```text
START:  det øjeblik, en betaling på 7 DKK er BEKRÆFTET af betalingsudbyderens
        webhook (server-side) — ikke ved e-mail-indtastning, ikke ved
        klik på "Betal", ikke ved e-mail-verifikation.

        + 31 dage → next_allowed_at (UTC-tidspunkt, beregnet af databasen:
        now() + interval '31 days', ikke af browseren)

SLUT:   next_allowed_at <= now()
```

**Hvorfor ved bekræftet betaling (INFERRED, men begrundet):**
- Forretningen beskytter **omkostningen** — omkostningen opstår ved betaling.
- **Test 10 opfyldes:** mislykket betaling skaber **ingen** cooldown-post.
- **Ikke ved e-mail:** "Vi definerer ikke reglen til at starte, fordi nogen
  indtastede en e-mail" (eksplicit krav) ✓ — en blot indtastet e-mail er gratis
  og giver ingen omkostning.
- **Ikke ved e-mail-verifikation:** verifikation kan være fra-/tilsluttet
  (K5) og sker *efter* oprettelse — reglen må ikke afhænge af en
  dashboard-indstilling.
- **Ikke ved `signUp`:** `signUp` kan kaldes gratis af alle (K2) — ellers
  ville en angriber kunne starte andres cooldown uden betaling (ondskabsfuld
  "cooldown-poisoning" mod en kendt e-mail!).

### 5.2 Kanter og interaktioner

| Situation | Cooldown? | Begrundelse |
|---|---|---|
| E-mail indtastet, checkout åbnet, **ikke betalt** | **Nej** | ingen omkostning |
| Betaling **afvist/fejlet** | **Nej** | Test 10 |
| Betaling bekræftet, men bruger aldrig færdiggør signup | **Ja** (starter ved webhook) | penge er brugt; beviset kan stadig bruges inden for dets udløb (§13) |
| Betaling OK, `signUp` fejler (svag kode m.m.) | **Ja** — men beviset **forbliver ukonsumeret** → kan gentages uden ny betaling | penge er brugt |
| **E-mail-verifikation** deaktiveret | Ja (uafhængig) | K5 |
| **E-mail-verifikation** aktiveret, bruger verificerer aldrig | Ja (starter ved betaling) | reglen er betalings-drejet |
| Dobbeltsend signup (2 `signUp`-kald samtidig) | Én cooldown-post | Supabase afviser det andet `user_already_exists`; derudover unik `identity`-nøgle (§10) |
| **Eksisterende bruger** (oprettet før lancering) | **Ingen cooldown** — bagfill-mærkes `grandfathered` | §12/K4 |
| Bruger sletter konto, prøver igen dag 5 | **Blokeret** | §11 |
| Bruger sletter konto, prøver dag 32 | **Tilladt** (ny betaling + ny post) | reglen udløber naturligt |
| **Samme e-mail, nyt password** | irrelevant (Supabase tillader ikke duplikat-e-mail) | — |

**Tidszone:** beregning i **UTC** i databasen; visning i
**Europe/Copenhagen** på brugerfladen. **DST-bemærkning:** 10. oktober →
10. november 2026 krydser sommertids-slutningen (25. oktober) — den **daterede
grænse** skal derfor beregnes af serveren og vises som en fast dato, ikke som
"31 × 24 timer" i browseren. (Dag-grænse kl. 23:59:59 Copenhagen vs. præcis
31 × 24 t fra betalingstidspunktet er et lille **PRODUCT DECISION** —
anbefaling: 31 × 24 timer fra betaling, vist som en afrundet dato.)

---

## 6. Identity Options

"Identiteten" = det, cooldown-posten knyttes til. Krav: skal **overleve
sletning, nye browsere, nye enheder og nye e-mails hvor relevant** — og
**ikke** være unødigt indgribende data.

| Mulighed | Sikkerhed | GDPR | Impl. kompleksitet | Bypass | Robusthed | Overlever sletning | Forkert-blokering | Egnet? |
|---|---|---|---|---|---|---|---|---|
| **Rå e-mail** | middel (ny e-mail = fri) | persondata, klart | **meget lav** | nem (ny e-mail) | høj for samme e-mail | ja (uden FK) | lav | ✓ som sekundær |
| **Hash af normaliseret e-mail** (HMAC-SHA256 + server-hemmelighed) | middel (samme som rå) | **pseudonymiseret** — stadig persondata men minimalt | lav | nem (ny e-mail) | høj | ja | lav (kun hvis e-mail deles i husstanden) | ✓ **anbefalet fallback-nøgle** |
| **Betalingsudbyder-kunde-ID** (f.eks. wallet-/konto-ID) | **høj** (ny e-mail blokeres stadig) | udbyder-data, minimalt hos os | lav (fra webhook) | svær (ny konto hos udbyder) | høj | ja | lav–middel (delt familiekonto) | ✓ **anbefalet primær** |
| **Kort-/betalingsfingerprint** (tokeniseret, aldrig råt kort) | **høj** | øget (kortdata-klassificering?) — **NEEDS LEGAL REVIEW** | middel (afhænger af udbyder) | middel (andet kort) | middel (udskiftede kort) | ja | **høj** (delt kort i husstanden) | ✓ mulig, kræver udbyder+ juridisk vurdering |
| **Betalings-reference (transaktions-ID)** | lav alene (ny transaktion hver gang) | lav | lav | **trivial** | høj | ja | lav | ✓ som spor/reference, **ikke** som identitet alene |
| **IP-adresse** | lav (VPN/CGNAT/mobil-IP skifter) | **høj** persondata, deler med husstande | lav | nem (VPN) | **lav** (dynamiske IP'er) | ja | **høj** (delte uddannelser, mobil-NAT, familier) | **✗ frarådes** — præcis den unødige data-samling, vi vil undgå |
| **Device/browser-fingerprint** | middel | **høj** (sporings-teknologi, EDPB-mistænksom) | høj (ny dependency!) | middel (renset browser) | lav (opdateringer) | ja | middel | **✗ frarådes** (overengineer + privacy) |
| **Telefonnummer/SMS** | høj | særskilt persondata + SMS-omkostning | høj (ny udbyder) | middel (nyt SIM) | høj | ja | lav | ✗ udvider datasamlingen unødigt |
| **Kombination: betalings-ID ⊕ e-mail-hash** | **højest opnåelige** | stadig minimal (2 felter) | lav | svær | høj | ja | lav | ✓✓ **ANBEFALING** |

**Svar på det stillede spørgsmål:** *ja* — den reneste tilgang er at knytte
cooldown til **betalingens identitet** frem for at spore brugeren via browser/
device/IP. To identitetsnøgler (betalings-ID + e-mail-hash) dækker både
"ny e-mail samme kort" (Test 2) og "nyt kort samme e-mail" (via Supabase-duplikat-
beskyttelse), **uden** at indsamle sporingsdata. **IP og fingerprint frarådes
eksplicit.**

---

## 7. Recommended Architecture

**Anbefalet samlet model: Option B (penge først) + Arkitektur C (dedikeret
registrerings-/betalings-post) + identitet = betalings-ID ⊕ e-mail-hash +
central server-side berettigelses-kontrol.** Ingen tracking, ingen ny
dependency, ingen ændring af `signUp`, `signOut`, session eller RLS for
bruger-data.

### 7.1 Flow (mål-billede)

```text
1. /signup  (klient, som i dag indtil trin 3)
   └─ NYT: POST /api/account/registration-eligibility  { email }
        server: normaliser (trim+lower) → HMAC-hash → slå op i cooldowns
        svar: { eligible: true } | { eligible:false, nextAllowedAt }
        (kun rådgivende — ALDRIG sikkerhedsgrænsen; rate-begrænset)
2. Hvis blokeret → vis besked (§14). INGEN betaling tilbydes. STOP.
3. Hvis tilladt → POST /api/account/registration-intents  (Idempotency-Key
        fra klient + unik partial-indeks på "én pending intent pr. identity")
        → opretter intent { status:'pending', amount_ore:700 } →
        videresender til betalingsudbyderens checkout (hosted/embedded).
4. Betaling gennemført → udbyderens WEBHOOK til
        POST /api/webhooks/payment  (signatur-verificeret)
        atomisk (én RPC, §10):
          a. intent: pending → paid  (kun hvis den stadig er pending)
          b. TJEK cooldown for begge nøgler (betalings-ID + e-mail-hash)
          c. hvis IKKE blokeret: upsert cooldown { next_allowed_at = now+31d }
          d. udsted ENGANGS registreringsbevis (token; gem KUN hash)
          e. hvis BLOKERET: markér intent 'blocked_refundable' (§13)
        [webhook er styrende: frontend-crash her er ufarligt — Test 9]
5. Bruger vender tilbage til /signup?intent=… → status-side henter svar via
        GET /api/account/registration-status  (JWT eller intent-token)
        → viser "Betaling modtaget — fuldfør oprettelsen".
6. Klient udfører DET EKSISTERENDE supabase.auth.signUp(...) (signup.astro:263)
        bagefter: POST /api/account/register  { grantToken }
        server (atomisk):
          forbruger beviset (kun én vinder, §10)
          opretter berettigelses-post { status:'active', user … }
        → Supabase-kontoen er nu BRUGBAR.
7. Framtidige kald: authenticateSupabaseRequest (supabase.ts:37) tjekker
        CENTRALT at den auth'ede bruger har en aktiv berettigelse
        (eller en grandfathered-post) → ellers 403 'registration_required'.
        ← DENNE er den egentlige håndhævelse (K2), ikke trin 1.
```

### 7.2 Hvorfor netop dette

- **Ét håndhævelsessted:** alle 12 API-filer rører allerede
  `authenticateSupabaseRequest` → **én** central tilføjelse dækker alt; ingen
  af de 12 ruter skal ændres individuelt.
- **Betalt-før-brugbar:** én betaling kan maksimalt give **én** brugbar konto
  (beviset er engangs og knyttet til betalingen) — opfylder "bruger får flere
  konti fra én betaling"-forbuddet.
- **Blokering før betaling** (trin 1) + **genbekræftelse ved webhook** (trin 4b):
  to lag, så en blokeret bruger **aldrig bliver opkrævet 7 DKK** — og hvis et
  kapløb alligevel opstår, ender det i `blocked_refundable` i stedet for en
  stiltiende opkrævning (§13).
- **Ingen tracking:** kun det, betalingen allerede afslører + et hash.
- **Sletningssikker:** berettigelse/cooldown-tabeller har **ingen** `user_id`
  og **ingen** FK til `auth.users` → `/api/account/delete` rører dem ikke (K3);
    men de indeholder **ingen** garderobe-/profile-data — kun hash + tider +
    references (GDPR §12).
- **Kompatibilitet:** eksisterende brugere bagfill-mærkes `grandfathered` i
  **samme** migration, verificeret med en count-query før og efter (§12, §16).

### 7.3 Bevidst valgte FRAVALG

| FRAVALG | Hvorfor |
|---|---|
| IP-blokering | privacy + høj risiko for forkert-blokering (§6) |
| Device-fingerprint | sporings-teknologi, ny dependency, overengineering |
| "Paid"-flag på alle brugere med deaktiveringslogik i alle ruter | større blast radius end 1 central berettigelses-kontrol |
| Cooldown der afhænger af `user.id` | dør ved sletning/ny konto (eksaktionskrav) |
| Cooldown der starter ved e-mail-indtastning | gratis at udløse mod andre (poisoning), §5 |
| Ny framework / betalings-SDK i klienten | udbyderens hosted checkout kræver ingen SDK |

---

## 8. Proposed Database Model (KONCEPTUELT — oprettes IKKE)

To tabeller er nok (minimum necessary schema); "intent" og "berettigelse"
holdes i **én** tabel for at undgå tredje tabel:

```text
registrations                        -- én række pr. betalings-forsøg/berettigelse
  id                    uuid PK
  identity_email_hash   text NOT NULL     -- HMAC(normaliseret e-mail); INGEN rå e-mail
  identity_payment      text NULL         -- udbyderens stabile ID (f.eks. "stripe:cus_…")
  status                text  -- 'pending' | 'paid' | 'registered'
                             -- | 'blocked_refundable' | 'expired' | 'grandfathered'
  amount_ore            int   -- 700
  provider              text NULL
  payment_reference     text NULL UNIQUE  -- transaktions-ID (refusion/regnskab)
  idempotency_key       text NULL UNIQUE  -- fra klient; dobbeltklik/refresh
  grant_token_hash      text NULL UNIQUE  -- engangsbevis; rå token ALDRIG gemt
  grant_expires_at      timestamptz NULL
  consumed_at           timestamptz NULL
  consumed_by_user_id   uuid NULL → auth.users(id) ON DELETE SET NULL
  created_at / paid_at  timestamptz
  -- partial unikt indeks: højst ÉN 'pending' pr. identity_email_hash

registration_cooldowns                -- overlever konto-sletning (BEVIDST)
  id                    uuid PK
  identity_email_hash   text NOT NULL UNIQUE   -- opdateres fremad: next_allowed_at
  identity_payment      text NULL
  created_at            timestamptz            -- = betalingstidspunkt
  next_allowed_at       timestamptz            -- created_at + 31 dage (UTC, DB-beregnet)
  source_registration   uuid NULL → registrations(id)   -- sporbarhed
  status                text -- 'active' | 'expired' | 'anonymized'
  -- INGEN user_id. INGEN FK til auth.users.
```

**Minimum, der kræves for at håndhæve reglen:** `identity_email_hash`,
`next_allowed_at` — alt andet er sporbarhed/økonomi (begrundet: `payment_reference`
til refusioner, `status` til webhook-idempotens).

**Sletning af identitet efter udløb:** når `next_allowed_at < now()`,
kan `identity_email_hash` **slettes/anonymiseres uden at bryde reglen** —
reglen gælder kun inden for vinduet; en senere tilmelding starter en **ny**
cooldown. Dette er dataminimering, men **hvor længe man skal bevare noget
alligevel** (f.eks. mod gentagen misbrug eller af hensyn til regnskab) er
**PRODUCT DECISION + LEGAL/PRIVACY REVIEW** (§12).

---

## 9. Supabase/RLS Model

| Spørgsmål | Svar (anbefaling) |
|---|---|
| Skal RLS slås til på de nye tabeller? | **Ja** — `alter table … enable row level security` |
| Policyer for `authenticated`/`anon`? | **Ingen overhovedet** (0 policies = alt nægtes, præcis som `0011`-mønsteret: "RLS without policies blocks all access") |
| Hvem må læse/skrive? | **Kun service-rollen** (bypasserer RLS) via server-ruterne; eller `SECURITY DEFINER`-RPC'er med interne checks, hvis man vil undgå service-rolle |
| Må almindelige brugere nogensinde tilgå tabellen? | **Nej** — heller ikke deres egen cooldown (visningen sker via vores server, der filtrerer svaret) |
| Skal signup-berettigelse tjekkes server-side? | **Ja** — både i eligibility-ruten (rådgivende) og i `authenticateSupabaseRequest` (autoritativ) |
| Nyttig database-funktion/transaction? | **Ja, én RPC** pr. kritisk overgang: `handle_payment_success(intent)` og `consume_registration(token_hash, user_id)` — begge `security definer` med interne valideringer, så webhook og register er **atomiske** |
| Race-beskyttelse | unikke/`partial`-indekser + `ON CONFLICT` + `UPDATE … WHERE status='pending'`-overgange (detaljer §10) |
| Service-nøglen i browseren? | **Absolut ikke** (bevist i forrige audit: 0 references i `.astro`) — webhook/register kører kun server-side |

**Ingen svækkelse af eksisterende RLS:** de nye tabeller **tilføjer** kun
nye policy-frie tabeller; ingen `drop policy` på bruger-data overhovedet.

---

## 10. Race Condition Protection

Truslen: to samtidige kald ser begge "ingen cooldown findes" og fortsætter.
**Guaranti: HØJST ÉN vellykket registrering pr. betaling pr. identitet.**

| # | Kapløb | Mekanisme (DB-garanteret) |
|---|---|---|
| R1 | To `POST /registration-intents` samtidig (dobbeltklik/refresh = Test 7/8) | **partial unikt indeks**: højst én `status='pending'` pr. `identity_email_hash` + `Idempotency-Key` UNIQUE → andet kald modtager **den eksisterende** intent (`ON CONFLICT … DO NOTHING` + re-read), ikke en ny |
| R2 | To webhooks med samme betaling (udbyder-genforsøg) | `UPDATE registrations SET status='paid' WHERE id=$1 AND status='pending'` → **0 rækker = allerede behandlet** ⇒ idempotent; desuden `payment_reference UNIQUE` |
| R3 | To **forskellige** betalinger mod samme identitet (to faneblade, to kort) | samme `registration_cooldowns`-opdatering udføres i **én RPC** med `INSERT … ON CONFLICT (identity_email_hash) DO UPDATE SET next_allowed_at = GREATEST(…)` → unik-nøglen gør det umuligt at få to rækker, og `GREATEST` skubber aldrig datoen **baglæns** |
| R4 | To `POST /register` med samme bevis | forbrug via `UPDATE … SET consumed_at=now() WHERE grant_token_hash=$1 AND consumed_at IS NULL AND status='paid' RETURNING …` → **kun ét kald får en række**; tabellen for det andet |
| R5 | `signUp` + `register` på kryds og tværs (bevis forbruges af anden konto) | `register` kræver **BÅDE** gyldigt bevis **og** en JWT, hvis e-mail-hash matcher bevisets `identity_email_hash` (service-role-opslag) → beviset kan ikke aktivere en tilfældig konto |
| R6 | Betaling fuldført **imens** cooldown oprettes andetsteds | cooldown-tjekket ligger **inde i** den samme atomiske `handle_payment_success`-RPC som status-overgangen — der findes ikke et vindue uden tjek |
| R7 | Webhook ankommer før vi oprettede intent | `payment_reference`-opslag → 0 rækker → webhook svarer med http-kode udbyderen genforsøger på (og logges) — aldrig halvtilstand |
| R8 | Klient sender `signUp` 2× (allerede i dag) | Supabase dedup'er på e-mail (`user_already_exists`) + `signupButton.disabled` (`signup.astro:259`) — eksisterende lag bevares uændret |

**DoS-notat (INFERRED):** eligibility- og intents-endepunkter skal
rate-begrænses (pr. session/IP som drifts-målning — **ikke** som identitet!)
for at forhindre hash-spam. Rate-limit er beskyttelse, ikke identifikation.

---

## 11. Account Deletion Interaction

```text
BRUGER A: betaler → konto oprettes → bruger → SLETTER konto → prøver igen
  /api/account/delete
    ├─ sletter 9 tabeller m. .eq("user_id", …)   → ingen rører registrations/cooldowns
    │                                               (de har INGEN user_id)
    ├─ sletter {uid}/-storage                      → irrelevant for reglen
    ├─ auth.admin.deleteUser                       → e-mailen er igen "ledig" i Supabase
    └─ clearDressedClientState() + signOut
  NY TILMELDING (dag 5):
    eligibility-ruten → finder cooldown (identity_email_hash, next_allowed_at)
    → { eligible:false, nextAllowedAt } → BLOKERET ✓ (Test 1)
    → der oprettes INGEN betaling, INGEN ny intent, INGEN cooldown-forskydning
```

**Hvor skal den persistente post leve?** I `registration_cooldowns` (§8),
**uden `user_id`, uden FK til `auth.users`** — ikke i `profiles`, ikke i
auth-metadata, ikke i localStorage. Alternativet (at hæfte den ved `user.id`)
kænves ved sletning (eksplisit ekskluderet af kravet).

**Hvad der skal BLIVE efter sletning (GDPR-balancen):**

| Bevar | Hvorfor | Minimalt indhold |
|---|---|---|
| Cooldown-posten (indtil `next_allowed_at`) | det er **hele** formålet: at forhindre ny betalt konto i 31 dage | hash + 2 tider + status |
| `payment_reference` + beløb/dato (registrations) | regnskabs-/refusionspligt (**periode = LEGAL REVIEW**; bogføringspligt findes i DK — vi opfinder **ikke** perioden her) | reference, beløb, dato, status |
| **Slettes fortsat fuldstændigt** | alt personindhold: profil, kildefoto, modelbilleder, garderobe, outfits, AI-resultater, tællere, storage, auth (uændret dele af delete-flippet) | — |

**Ærlighed:** personen forbliver **pseudonymiseret knyttet** via e-mail-hash
i op til 31 dage efter sletning. Det er en **bevidst, dokumenteret
afvigelse fra absolut sletning** — berettigelsen hertil er
**NEEDS LEGAL REVIEW** (formodentlig forebyggelse af misbrug/økonomisk
interesse, men dette **opfindes ikke** her).

---

## 12. GDPR / Privacy-by-Design

> **Ingen påstand om juridisk compliance.** Kun tekniske/privatlivsmæssige
> følger; afgørelser er mærket **PASS** (teknisk ordnet) /
> **NEEDS PRODUCT DECISION** / **NEEDS LEGAL REVIEW**.

### 12.1 Data-minimering

**Minimum for at håndhæve reglen:** `HMAC-SHA256(normaliseret e-mail,
server-hemmelighed)` + `next_allowed_at`. Ingen rå e-mail, intet navn, intet
køn, ingen garderobe-data, ingen IP, ingen fingerprint, ingen cookies.
Betalings-ID tilføjes **kun** hvis udbyderen leverer det (og er i sig selv et
transaktionsprodukt, vi alligevel modtager). **PASS** (design).

- Hash-metode: **HMAC med server-hemmelighed** (ikke bare SHA256), så en
  lækage af tabellen ikke giver en ordbog over tilmeldte e-mails.
- Normalisering: `trim + lowercase` — **Ærlighed:** dette fanger **ikke**
  alle e-mail-tricks (f.eks. prikker/`+tags` i nogle domæner). Delvis
  dækning dokumenteres; den resterende dækning kommer fra betalings-identiteten.
  **PASS** (med dokumenteret begrænsning).

### 12.2 Formålsbegrænsning

Posten må kun bruges til: (1) at forhindre dubleret **betalt** kontooprettelse,
(2) at forebygge misbrug, (3) at beskytte brugeren mod uønskede gebyrer —
**intet** marketing, **ingen** deling, **ingen** profilering. Dette skal stå i
en kommende privatlivspolitik (**NEEDS PRODUCT DECISION** — siden findes ikke
i dag, jf. tidligere audit).

### 12.3 Opbevaring (retention)

| Felt | Minimum | Kan slettes? |
|---|---|---|
| `registration_cooldowns`-rækken | til `next_allowed_at` (+ evt. buffer) | **Ja** bagefter — reglen er udløbet, og en ny tilmelding starter forfra (**anbefaling**) |
| `registrations.payment_reference` + beløb/dato | ukendt — **bogføringspligt** | **NEEDS LEGAL REVIEW** (perioden opfindes ikke her) |
| `identity_email_hash` i `registrations` | til refusions-/svindelvindue | **NEEDS PRODUCT DECISION** + **NEEDS LEGAL REVIEW** |
| Hele `registrations` efter udløb af både cooldown og refusionsvindue | — | **NEEDS PRODUCT DECISION** |

**Automatisk oprydning** (enkelt `delete … where next_allowed_at < now()`
kørende som planlagt job) anbefales som teknisk foranstaltning —
**NEEDS PRODUCT DECISION** (job-drift i Netlify-schemat findes i forvejen som
mønster: `BACKGROUND_JOB_SECRET`-mønsteret).

### 12.4 Sletning

Se §11: alt personindhold slettes; kun den minimale cooldown (indtil udløb) og
betalingsreferencen (regnskab) bliver. **NEEDS LEGAL REVIEW** for at fastlægge
berettigelsen til netop den rest.

### 12.5 Adgang / eksport (art. 15)

En kommende eksportfunktion skal **inkludere eller forklare** cooldown-posten
(den er knyttet til personen via hash). Da GDPR-eksport **overhovedet ikke
findes** i dag (dokumenteret i den forrige audit), er status:
**NEEDS PRODUCT DECISION** (eksport findes som bekendt ikke) — reglen tilføjer
**ingen ny** blokering her.

### 12.6 Opsummering af statusser (denne sektion)

| Emne | Status |
|---|---|
| Minimalt datasæt (hash + tider) | **PASS** (design) |
| Ingen IP/fingerprint/cookies til formålet | **PASS** (design) |
| Formålsbegrænsning skrevet ned | **NEEDS PRODUCT DECISION** (privatlivspolitik) |
| Retention-perioder | **NEEDS LEGAL REVIEW** + **NEEDS PRODUCT DECISION** |
| Bevar efter kontosletning | **NEEDS LEGAL REVIEW** |
| Eksport-indhold | **NEEDS PRODUCT DECISION** |
| Retsgrundlag for selve reglen | **NEEDS LEGAL REVIEW** — **opfindes ikke her** |

---

## 13. Payment Failure / Refund Scenarios

| # | Scenario | Systemets adfærd (anbefaling) | Status |
|---|---|---|---|
| P1 | Betaling **afvist** (kort afvist, for lidt penge) | ingen webhook `paid` → **ingen cooldown**, ingen bevis; bruger kan prøve igen med det samme | **PASS** (design, Test 10) |
| P2 | Bruger **afbryder** checkout | kun `pending`-intent; udløber (`expired`); ingen cooldown, intet gebyr | **PASS** (design) |
| P3 | Betaling OK, men cooldown allerede aktiv (kapløb/snyd) | webhook sætter `blocked_refundable` → **automatisk refusion** af 7 DKK eller manuel refusionskø | **NEEDS PRODUCT DECISION** (automatik vs. manuel) |
| P4 | Betaling OK, bruger **aldrig** fuldfører (bevis udløber) | `expired` efter f.eks. 72 t/7 d → **refusion?** | **NEEDS PRODUCT DECISION** (frist + automatik) |
| P5 | **Refusion** (frivillig, fejl, kundeønske) | **Bliver cooldown stående?** | **NEEDS PRODUCT DECISION** — *muligheder:* (a) ja, reglen er misbrugsforebyggelse, ikke gebyr-betinget (anbefaling: ja, for ellers er reglen gratis at omgå ved refusion); (b) nej, drop cooldown ved refusion (gør reglen svag) |
| P6 | **Chargeback / dispute** | cooldown **bliver stående** (det er netop misbrugssignalet); `registrations.status='charged_back'`; refusions-/gebyr-håndtering hos udbyder | **NEEDS PRODUCT DECISION** (ekspedering) + **NEEDS LEGAL REVIEW** (dokumentation) |
| P7 | Betaling **annulleres** før gennemførsel | som P2 | **PASS** (design) |
| P8 | **Retry** af mislykket betaling | ny `Idempotency-Key` pr. nyt forsøg; samme identitet, samme cooldown-tilstand (ingen) | **PASS** (design) |
| P9 | Dobbeltopkrævning (to intents, én person, begge betalt) | `GREATEST()`-opdatering: **én** cooldown; to betalinger → den ene refunderes | **NEEDS PRODUCT DECISION** (automatik) |
| P10 | Betaling OK, **vores** DB nede under webhook | udbyderen genforsøger webhook; intet tab (R7) | **PASS** (design) |

**Regel der ikke afgøres stiltiende:** refusion ↔ cooldown-spørgsmålet (P5)
holdes åbent som **PRODUCT DECISION** — systemet skal i mellemtiden kunne
køre begge grene via `status`-felterne uden ny migration.

---

## 14. UX

### 14.1 Blokeret bruger (anbefalet tekst — ikke endelig)

```text
YOUR DRESSED ACCOUNT HAS RECENTLY BEEN CREATED.

For your protection, new account creation is available again on:

November 10, 2026

Already have an account? Log in instead.          ← [LOG IN]-link
```

### 14.2 Designspørgsmål

| Spørgsmål | Anbefaling | Begrundelse |
|---|---|---|
| Vises **præcis dato**? | **Ja** — server-beregnet fra `next_allowed_at`, vist i Europe/Copenhagen | deterministisk, brugbart, dækker DST (§5) |
| Vises **resterende dage**? | Valgfrit (f.eks. "in 27 days") — sekundært | datoen er det styrende |
| Kan brugeren **logge ind** på eksisterende konto? | **Ja** — vis altid `LOG IN`-linket | en cooldown er **ny**-tilmelding, ikke adgang; (hvis kontoen er slettet, er der bare at logge ind på) |
| Skal blokeringen vises **før eller efter** betaling? | **Før** (eligibility-trin 1) — og genbekræftes ved webhook (trin 4b) | eksplisit krav: **en blokeret bruger må aldrig blive opkrævet 7 DKK** |
| Skal betaling tilbydes når blokeret? | **Nej** — betalingsknappen skjules/deaktiveres, checkout oprettes **ikke** | ellers ville P3 (opkrævning + refusion) blive normaltilstand |
| "Allerede konto? Log ind" | Vis **kun** hvis den samme e-mail har en konto (vis **altid** et generisk LOG IN-link for ikke at afsløre, om e-mailen har en konto) | den nuværende signup afslører allerede "findes eller ej" (`signup.astro:283`) — samme bevidste niveau, ingen ny lækage |
| Hvor i flowet | På `/signup` **inden** betalingsknappen, og igen som fejl-side hvis webhook melder `blocked_refundable` | Test 6/2 dækkes |

**Erklæring (ærlig):** beskeden afslører, at *nogen* for nylig oprettede konto
med denne e-mail. Det gør den nuværende signup allerede ("An account with this
email already exists", `signup.astro:283`) → **ingen ny lækage-klasse**, men
dette bør nævnes i privatlivspolitikken (**NEEDS PRODUCT DECISION**).

---

## 15. Security / Abuse Matrix (min. 10 forsøg)

> Alle forventninger er **design-**forventninger; den faktiske kørsel er
> **NEEDS TEST** (§20).

| # | Handling | Forventet resultat | Hvorfor |
|---|---|---|---|
| **T1** | Opret konto → slet konto → tilmeld igen (dag 5) | **BLOKERET** (dato vises) | cooldown lever uden FK (§11) |
| **T2** | Tilmeld med **en anden e-mail** | **Afhænger af identitet:** e-mail-hash alene → *tilladt*; **med betalings-ID** (samme kort/wallet) → **BLOKERET** ved webhook | §6 — netop derfor anbefales betalings-ID som primær |
| **T3** | Ryd localStorage | **BLOKERET** | server-side post; intet i browseren |
| **T4** | Brug en **anden browser** | **BLOKERET** | samme identitet, ingen browser-tilstand |
| **T5** | Brug en **anden enhed** | **BLOKERET** | samme |
| **T6** | Tilmeld fra **en anden IP** | **BLOKERET** (IP bruges ikke overhovedet) | designet ignorerer IP bevidst |
| **T7** | **Refresh** betalings-/signup-siden gentagne gange | **Ingen** dubler af intents/cooldowns/konti | R1 (pending-unik + Idempotency-Key) + R2 |
| **T8** | **Dobbeltklik** på betalings-/signup-knappen | **Ingen** dubler | `signupButton.disabled` (`:259`) + R1/R4 |
| **T9** | Betaling OK, **frontend crash** bagefter | Genoprettelig: webhook har posten; status-side/bevis kan hentes → fuldførsel senere (inden udløb) | §7 trin 4–6 |
| **T10** | Betaling **fejler** | **Ingen cooldown**, ingen tab af rettigheder | §5 — cooldown skabes kun ved `paid` |
| **T11** | Rå `supabase.auth.signUp` med anon-nøgle **uden** betaling | Kontoen oprettes muligvis (K2), men får **403 `registration_required`** på alle API-ruter → **ingen værdi, ingen AI-forbrug** | central berettigelses-kontrol (§7 trin 7) |
| **T12** | Gentagen `signUp`/`register` mod **andres** e-mail | Supabase afviser eksisterende e-mail; bevis-kobling kræver matchende JWT (R5) | R5 |
| **T13** | manipulér `next_allowed_at` fra browseren | umuligt — feltet findes kun server-side; svaret beregnes af DB | §16 |
| **T14** | Koordineret spam (mange e-mails, ingen betaling) | tomme konti uden værdi; rate-limit på eligibility/intents (R-doS) | §10 |
| **T15** | Betal med samme kort til **ny** e-mail (Test 2's kerne) | **BLOKERET** ved webhook via `identity_payment` | §6 |

---

## 16. Existing System Compatibility

**Ingen migration må berøre det eksisterende.** Nedenfor er hver del bekræftet
mod koden i denne session:

| Systemdel | Kompatibel? | Bevis / betingelse |
|---|---|---|
| **Autentificering / session** | **Ja** | `signUp`, `signInWithPassword`, `signOut`, `getSession`, guards og bfcache-håndteringen ændres **ikke**; kun en ny server-kontrol *tilføjes* i `authenticateSupabaseRequest` |
| **RLS** | **Ja** | kun **nye**, policy-frie tabeller tilføjes; **ingen** `drop policy`, **ingen** ændring af `auth.uid() = user_id`-policyer (hverken `0010`/`0011` eller `202610070001`) |
| **Storage** | **Ja** | ingen bucket-ændringer; `{userId}/`-stier og signerede URLs urørte |
| **API (12 filer)** | **Ja** | de fortsætter med samme `authenticateSupabaseRequest`; den nye kontrol sker **inde i** den (én fil); svar-fejl kode `403 registration_required` er nyt, men påvirker kun brugere uden berettigelse |
| **Wardrobe / outfits / placement / X-Y-scaling / drag / pinch / wheel / tap** | **Ja** | **0** berørte filer — reglen ligger før data-laget og rører ikke ét felt (`placement`-feltet, `update_item_placement`, `update_outfit_free_scale` urørte) |
| **AI-generation** | **Ja** | job-flow, RPC'er, kvoter (`ai_generation_*`) urørte; en uberettiget bruger når ikke frem til dem (403) |
| **Konto-sletning** | **Ja, betinget** | sletningen rører kun `user_id`-tabeller (§11); **betingelse:** de to nye tabeller må **ikke** tilføjes til delete-listen, og `consumed_by_user_id` skal have `ON DELETE SET NULL` (ikke cascade på `registrations`) |
| **Eksisterende brugere (K4)** | **Kritisk betingelse** | migrationen skal **bagfill-mærke alle eksisterende `auth.users`** som `grandfathered` i **samme** migration, verificeret med `select count(*)` før/ellers låses alle ude |
| **Eksisterende profiler/outfits/modeller/storage** | **Ja** | **ingen** `update`/`delete` på bruger-tabeller i nogen ny migration (kun `insert` i nye tabeller) |
| **Fremtidig 3D-arkitektur** | **Ja** | cooldown-laget kender **intet** til assets; den globale-vs-bruger-ejede adskillelse (delt bucket vs. `{uid}/`) påvirkes **ikke** — ingen ny fælles ressource, ingen ny privat sti. **PASS** |
| **E-mail-verifikation (K5)** | **Ja** | reglen er betalings-drejet og uafhængig af verifikationstilstanden |
| **Dublerede `.env`-nøgler (K6)** | uændret | ingen betydning; kan rydtes uafhængigt |

**Eksplicit ikke-ændret (verificeret ved intet at have rørt filerne):** alle
17 migrations, `Header.astro`, `login.astro`, `profile.astro`,
`wardrobe.astro`, `closet.astro`, `signup.astro`, alle API-ruter, `docs/*`,
begge 3D-analyser, begge sikkerheds-analyser, git-historik.

---

## 17. Recommended Implementation Order

> **Ingenting implementeres, før denne analyse er gennemgået og godkendt.**

1. **Produktvalg først:** betalingsudbyder (§4), refusions-adfærd (P3–P6),
   cooldown-startpunkt (§5 — bekræft), retention (§12), UX-tekst (§14).
   → alle **PRODUCT DECISION / LEGAL** (§21).
2. **Migration 1 (konceptuel, §19):** opret de to tabeller + indekser +
   **bagfill af `grandfathered` for alle eksisterende brugere** + RLS-slå-til
   uden policyer. Verificér med count-query.
3. **Server-kernemoduler (nye filer, §18):** HMAC-normalisering, de to RPC'er
   (`handle_payment_success`, `consume_registration`).
4. **Eligibility-ruten** (`POST /api/account/registration-eligibility`) —
   rådgivende, rate-begrænset.
5. **Intent-ruten** + udbyder-checkout-redirect (med `Idempotency-Key`).
6. **Webhook-ruten** (signatur-verificeret) → atomisk RPC → cooldown + bevis.
7. **Status-ruten** (`GET /api/account/registration-status`) til genoptagelse.
8. **`register`-ruten** (bevis + JWT-e-mail-match → forbrug).
9. **Central berettigelses-kontrol i `authenticateSupabaseRequest`**
   (`src/lib/server/supabase.ts:37`) — ét sted, alle 12 ruter arver.
10. **Klient (`signup.astro`):** tilføj eligibility-kald + betalings-/blokerings-
    trin **uden** at røre den eksisterende validering eller `signUp`-kaldet
    (de udvider bare flowet omkring trin 5–6 i §7).
11. **Drift/rengrings-job:** udløb af cooldowns/intents (§12.3).
12. **Test (§20)** i **udviklings-tilstand først** — derefter produktion.

### 17.1 Udviklings-/testtilstand (§13 i opgaven)

**Anbefalet sikker tilgang — server-side, konfigurationsstyret, uden bagdør:**

| Mulighed | Vurdering |
|---|---|
| **`REGISTRATION_COOLDOWN_DAYS` (server-env, default 31)** | ✓ anbefales: sæt til `0` i dev/preview → reglen deaktiveres, kodevejen testes stadig |
| **`PAYMENTS_ENABLED=false` i dev** | ✓ anbefales: dev springer udbyderen over med en **synlig test-grænseflade** (f.eks. webhook der simuleres via hemmelig lokal route) — **kun** når env'en er sat |
| Dedikeret test-identitet (allowlist af e-mails) | ✓ acceptabel som sekundær |
| Permanent "bypas"-kode i koden | **✗ frarådes** (bagdør) |
| Bypas styret af query-parameter/localStorage | **✗ frarådes** (brugerstyret) |
| Almindelige produktionsbrugere ser nogen bypass | **✗ absolut forbudt** — lås så at `NODE_ENV`/env-gating **kun** virker når env'en eksisterer, og log en tydelig advarsel ved opstart hvis cooldown ≠ 31 i produktion |

---

## 18. Files That Would Need Modification (udpeget — IKKE rørt)

### Nye filer (anbefalet)

| Fil | Indhold |
|---|---|
| `src/pages/api/account/registration-eligibility.ts` | `POST` { email } → hash → cooldown-opslag → `{eligible, nextAllowedAt}`; rate-limit |
| `src/pages/api/account/registration-intents.ts` | `POST` { email } (**inden** signup — der findes endnu **ingen** JWT, K2) → hash → opret/returnér pending intent → checkout-URL |
| `src/pages/api/account/registration-status.ts` | `GET ?intent=…` → kun `{status, nextAllowedAt?}` (ingen PII i svaret; ingen JWT krævet før signup) |
| `src/pages/api/account/register.ts` | `POST` (JWT + grant) → atomisk forbrug → `registered` |
| `src/pages/api/webhooks/payment.ts` | modtager, **signatur-verificerer** → `handle_payment_success`-RPC |
| `src/lib/server/registration.ts` | HMAC-normalisering, kald af RPC'er, token-generering (crypto, indbygget) |

### Eksisterende filer, der KUNNE få små tilføjelser

| Fil | Tilføjelse | Risiko |
|---|---|---|
| `src/lib/server/supabase.ts:37` `authenticateSupabaseRequest` | **én** berettigelses-kontrol (deny uden `grandfathered`/`registered`-række) | **kun** dette skal bagfill-mærkes først (K4) ellers låses alle ude |
| `src/pages/signup.astro` | eligibility-kald før betaling + blokerings-/betalings-trin **rundt om** det eksisterende (`:225`-handleren udvides; `:230-252`-validering og `:263` `signUp` **bevares ordret**) | lav — kun tilføjelser |
| `.env.example` | `PAYMENTS_*`, `REGISTRATION_COOLDOWN_DAYS`, `REGISTRATION_HMAC_SECRET` (server-side) | ingen |
| `src/pages/profile.astro` (valgfrit) | 403-tekst "fuldfør betaling" hvis berettigelse mangler | kosmetisk |

### Fil(er), der IKKE må ændres

`src/pages/api/account/delete.ts` (cooldown-tabellerne tilføjes **ikke** til
sletningslisten) · alle wardrobe/AI-ruter · alle migrations · `Header.astro` ·
begge 3D-analyser · alle eksisterende RLS-policyer.

---

## 19. Database Migrations That Would Be Needed (KONCEPTUEL — oprettes IKKE)

**Migration A (ny, f.eks. `2026xxxx0001_registration_cooldown`):**
1. `create table registrations (…)` og `create table registration_cooldowns (…)`
   som beskrevet i §8 (bevidst **uden** FK til `auth.users` på cooldown-tabellen;
   `consumed_by_user_id … on delete set null` på `registrations`).
2. Unikke indekser: `unique(identity_email_hash)` på cooldowns;
   `partial unique` på `registrations (identity_email_hash) where status='pending'`;
   `unique(payment_reference)`, `unique(grant_token_hash)`, `unique(idempotency_key)`.
3. `enable row level security` på begge — **ingen** policyer.
4. **Bagfill:** `insert into registrations (…, status='grandfathered',
   consumed_by_user_id) select id … from auth.users` + count-verifikation
   (K4 — **kritisk**).
5. `create or replace function handle_payment_success(…) returns …
   security definer` (atomisk cooldown-upsert + bevis-udstedelse).
6. `create or replace function consume_registration(…) returns …
   security definer` (atomisk forbrug med `where consumed_at is null`).
7. **Ingen** `update`/`delete` på eksisterende tabeller; **ingen**
   `drop policy`; **ingen** ændring af `storage.objects`-policyer.

**Migration B (senere, kun hvis produktet ønsker det):** oprydning/RPC til
udløb (`status='expired'`/anonymisering) — **PRODUCT DECISION**.

**Eksplicit forbudt i begge:** ændre `202610070001` eller nogen ældre
migration; røre `wardrobe_items.placement`, `ai_generation_*` eller
`storage.objects`.

---

## 20. Testing Plan (manuel, to rigtige konti + testbetaling)

| # | Test | Forventet | Status |
|---|---|---|---|
| TS1 | Normal signup i dev-tilstand (ingen betaling, `PAYMENTS_ENABLED=false`) | konto + adgang som i dag | PENDING |
| TS2 | Vellykket betaling (test-/sandbox-miljø) | intent `paid` + cooldown `now+31d` + bevis udstedt + konto adgang | PENDING |
| TS3 | Mislykket betaling | **ingen** cooldown, **ingen** bevis, fejl-side, kan prøve igen | PENDING |
| TS4 | Dubleret request (refresh + dobbeltklik på intent) | **én** intent, **én** betaling, **én** konto | PENDING |
| TS5 | Konto-sletning efter betaling | DB/storage/auth slettet; `registration_cooldowns` **beholdt** (tæl rækker før/efter) | PENDING |
| TS6 | Re-registrering inden for 31 dage | BLOKERET med korrekt dato; **ingen** checkout mulig | PENDING |
| TS7 | Samme person, **anden browser** | BLOKERET | PENDING |
| TS8 | Samme person, **anden enhed** | BLOKERET | PENDING |
| TS9 | **Anden e-mail** + samme betalingsmiddel | BLOKERET ved webhook (`blocked_refundable` + refusion ift. P3) | PENDING |
| TS10 | Anden e-mail + andet betalingsmiddel | *Afhænger af valgt identitet* — dokumentér det faktiske svar (§6/T2) | PENDING |
| TS11 | Eksakt **31-dages grænse** (1 sek før / 1 sek efter `next_allowed_at`, UTC + visning i CPH incl. DST-skift 25/10-2026) | blokeret før, tilladt efter | PENDING |
| TS12 | **Refusion** af 7 DKK | cooldown-status følger den valgte P5-beslutning | PENDING |
| TS13 | Logout/login efter aktiv berettigelse | fungerer som i dag; berettigelse bevares | PENDING |
| TS14 | **To-bruger-isolation:** bruger B forsøger bruger As `intent`-/bevis-ID via API | 404/403 — B kan kun se egen status (JWT-filter) | PENDING |
| TS15 | Rå `signUp` uden betaling (T11) | 403 `registration_required` på alle 12 ruter, **ingen** AI-forbrug | PENDING |
| TS16 | **Eksisterende bruger** (oprettet før lancering) logger ind og bruger wardrobe/AI | **ingen** 403 (bagfill virkede) — **kritisk regressionstest** | PENDING |
| TS17 | Webhook-modtagelse med **forkert signatur** | afvist, ingen tilstandsendring | PENDING |
| TS18 | Konto-sletning bagefter: login-flags, klient-state | som i dag (rydning uændret) | PENDING |

---

## 21. FINAL READINESS GATE

**Status-mærker brugt præcis som specificeret:** `PASS` = sikkert og allerede
understøttet · `NEEDS IMPLEMENTATION` = kræver kode/database-ændring ·
`NEEDS TEST` = kræver live-test · `PRODUCT DECISION REQUIRED` = forretningen
må beslutte · `LEGAL/PRIVACY REVIEW REQUIRED` = skal gennemgås før produktion.

| # | Område | Status | Bevis / næste skridt |
|---|---|---|---|
| 1 | **Eksisterende fundament** (auth, isolation, sletning — netop testet) | **PASS** | uændret af denne analyse; 0 filer rørt |
| 2 | Server-side **eligibility-tjek** | **NEEDS IMPLEMENTATION** | ny route (§18); kun rådgivende lag |
| 3 | **Cooldown-lagring der overlever sletning** | **NEEDS IMPLEMENTATION** | tabeldesign §8; sletning kræver **ingen** ændring (§11) |
| 4 | **Race-/dobbeltkontrol** (unikke indekser, atomiske RPC'er, idempotens) | **NEEDS IMPLEMENTATION** | §10 mekanismer findes endnu ikke |
| 5 | **Central berettigelses-håndhævelse** (`authenticateSupabaseRequest`) | **NEEDS IMPLEMENTATION** | §7 trin 7 — den egentlige sikkerhedsgrænse (K2) |
| 6 | **Betalingsintegration** (intent + webhook + refusion) | **NEEDS IMPLEMENTATION** | intet eksisterer (K1) |
| 7 | **Valg af betalingsudbyder** | **PRODUCT DECISION REQUIRED** | §4 kravliste; påvirker identitetsstyrke (§6) |
| 8 | **Identitetsmekanisme** (betalings-ID ⊕ e-mail-hash anbefalet) | **PRODUCT DECISION REQUIRED** | §6; udbyderen afgør, om `identity_payment` overhovedet findes |
| 9 | **Præcis cooldown-start** (anbefaling: bekræftet betaling) | **PRODUCT DECISION REQUIRED** | §5; bekræft før implementering |
| 10 | **Refusion/chargeback-adfærd** (P3–P6, især P5: "bevar cooldown ved refusion?") | **PRODUCT DECISION REQUIRED** | §13; systemet skal kunne begge grene |
| 11 | **UX-tekst/datoformat** for blokeret bruger | **PRODUCT DECISION REQUIRED** | §14 foreslår, men den endelige tekst er produktets |
| 12 | **Retention/anonymisering** af cooldown efter udløb | **PRODUCT DECISION REQUIRED** + **LEGAL/PRIVACY REVIEW REQUIRED** | §12.3 |
| 13 | **Bevar af hash efter kontosletning** (art. 17 vs. misbrugsforebyggelse) | **LEGAL/PRIVACY REVIEW REQUIRED** | §11/§12.4 — berettigelsen **opfindes ikke** her |
| 14 | **Retsgrundlag for hele reglen** | **LEGAL/PRIVACY REVIEW REQUIRED** | §12.6 — ikke afgjort, ikke antaget |
| 15 | **Regnskabs-/bogføringsperiode** for betalingsreference | **LEGAL/PRIVACY REVIEW REQUIRED** | §12.3 — perioden opfindes ikke |
| 16 | **Privatlivspolitik / formålsbegrænsning skrevet ned** | **LEGAL/PRIVACY REVIEW REQUIRED** | §12.2 (findes ikke i dag) |
| 17 | **Eksport/adgang:** skal cooldown posten fremgå af fremtidig GDPR-eksport? | **PRODUCT DECISION REQUIRED** | §12.5; findes ingen eksport i dag |
| 18 | **E-mail-verifikation-interaktion** | **PASS** (design) | reglen er betalings-drejet og uafhængig (§5, K5) |
| 19 | **Kompatibilitet: RLS, Storage, API, wardrobe, outfits, AI, X/Y-scaling** | **PASS** (design) | §16 — 0 berørte filer; ingen svækkelse |
| 20 | **Kompatibilitet: eksisterende brugere** | **NEEDS IMPLEMENTATION** (bagfill) efterfulgt af **NEEDS TEST** (TS16) | K4 — kritisk |
| 21 | **Kompatibilitet: konto-sletning** (kalder ikke ændring af delete.ts) | **NEEDS TEST** | design bekræftet (§11); TS5 skal køres |
| 22 | **Udviklings-/testtilstand** (ingen låsning af udvikler, ingen bagdør) | **NEEDS IMPLEMENTATION** | §17.1 |
| 23 | **Abuse/bypass-matrix (T1–T15) + testplan (TS1–TS18)** | **NEEDS TEST** | §15/§20 — alt er design-forventninger |
| 24 | **Data-minimering** (hash + tider; ingen IP/fingerprint/cookies) | **PASS** (design) | §12.1 |
| 25 | **Fremtidig 3D-datas adskillelse** (global vs. bruger-ejet) | **PASS** | §16 — cooldown-laget rører ingen assets |

**SAMLET STATUS: KAN IKKE IMPLEMENTERES ENDNU.**

Fem beslutninger mangler, før kode må skrives (7, 8, 9, 10, 11), og to
juridiske gennemgange bør ske før produktion med rigtige penge
(13, 14 + 15, 16). Den tekniske arkitektur er dog **hel og selv-konsistent**:
to tabeller, én central kode-ændring, ingen tracking, ingen svækkelse af
noget eksisterende.

---

**RECOMMENDED NEXT STEP**

> Gennemgå og godkend denne analyse før **noget** implementeres.
> Første konkrete arbejde efter godkendelse er **de fem produktvalg**
> (betalingsudbyder, identitetsfelt, cooldown-startpunkt, refusions-adfærd,
> UX-tekst) og **den juridiske gennemgang** af opbevaring efter sletning —
> dernæst Migration A (koncept, §19) med bagfill, og først derefter kode
> ifølge rækkefølgen i §17. **Intet er ændret i denne session.**











