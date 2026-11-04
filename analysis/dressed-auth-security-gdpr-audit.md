# DRESSED — Auth, Security & GDPR Audit

> **Type: SECURITY + PRIVACY + GDPR AUDIT (read-only) med én minimal fix.**
> Ingen migration er ændret, ingen dependency tilføjet, ingen commit/push/
> merge/rebase/reset/stash/checkout. X/Y-scaling, placement, drag, pinch, wheel,
> tap, saved outfits, AI og begge 3D-analyser er **urørte**.
>
> **Baseline (tillæses, ikke overskrives):**
> `analysis/dressed-account-security-and-user-isolation-analysis.md`
> (ejerskab, gaps G1–G9, migration `202610070001`, `/api/account/delete`),
> `docs/DRESSED-PROJECT-SPECIFICATION.md` (Rule 1–20),
> `analysis/DRESSED-SQL-MIGRATIONS-ANALYSIS.md`, `DRESSED-AUTH-SQL-ARCHITECTURE-ANALYSIS.md`,
> `DRESSED-LIVE-DATABASE-INSPECTION.md`, begge 3D-analyser.
>
> **Evidensmarkering:** **CONFIRMED** = læst i kode/migration her ·
> **INFERRED** = logisk slutning · **UNVERIFIED** = kræver live-Supabase,
> dashboard-indstillinger eller udbyder-verifikation (kan **ikke** afgøres fra
> repoet — gæt bruges aldrig).

---

## Executive Summary

DRESSED' sikkerhedsmodel er **korrekt i sit fundament** og er ikke blevet
omskrevet: *identitet = verificeret Supabase-JWT → server-route → RLS med
`auth.uid() = user_id` → privat storage under `{userId}/`*. Alle **16 routes
(12 filer)** kalder `authenticateSupabaseRequest` og filtrerer `user_id`; alle
svar har `Cache-Control: no-store`; **ingen** `getPublicUrl()`; **intet**
localStorage bruges som auth; service-nøglen findes kun server-side
(0 references i `.astro`).

**Fund i denne runde:**

| # | Fund | Status |
|---|---|---|
| **SF1** | **bfcache-læk (back/forward-navigation):** en side gendannet fra browserens back/forward-cache kører **ikke** sine scripts, så den eksisterende session-guard aldrig genereeres — privat DOM (items, outfits, signerede billeder) kunne stå tilbage efter logout | **Rettet nu** (mindste fix: `pageshow`-handler genkalder den *eksisterende* guard på `/profile`, `/wardrobe`, `/closet`) |
| **SF2** | `202610070001` (profiles-RLS + storage-ejerskab) findes som **fil**, men er **ikke anvendt** live ⇒ privat-læsning af storage/profiles er stadig **ukendt** | **NEEDS TEST** — skal anvendes og verificeres før 3D |
| **SF3** | Alle IDOR-/isolationstest er **kode-verificeret, men ikke kørt** mod Supabase | **NEEDS TEST** (matrix i §19) |
| **SF4** | **Ingen retention-perioder er defineret** for nogen datatype (kun sletning via konto-sletning) | **LEGAL/PRODUCT DECISION REQUIRED** |
| **SF5** | **Google Fonts** (`global.css:1`) hentes klient-side ⇒ hver besøgendes IP går til Google | Anbefaling (selv-hosting), ikke implementeret — **produktvalg** |
| **SF6** | **FASHN try-on sender brugerens foto til en offentlig HuggingFace Space** (`fashn-ai-fashn-vton-1-5.hf.space`) — men **ingen klient kalder endpointet i dag** (0 referencer) | **Requires provider/legal verification** før det tages i brug |
| **SF7** | `closet-source-photo` og `dressed-character` gemmer **base64-billeder i localStorage** uden udløb (legitim legacy-fallback, ryddes ved logout) | Dataminimerings-spørgsmål → **Product decision required** |
| **SF8** | **GDPR-eksport findes ikke** | Dokumenteret: *"GDPR access/export feature not yet implemented."* |

**Ingen kritisk, åben "bruger A kan læse bruger B"-fejl blev fundet i repoets
kode** — men da RLS/storage-policy'erne **lever live og ikke kan aflæses herfra**
(UNVERIFIED, fund SF2), kan isolationen **ikke erklæres PASS endnu**.

---

## Scope & Method

| Læst | Formål |
|---|---|
| Alle 12 filer i `src/pages/api/**` | auth + ejerskab pr. endpoint |
| `src/lib/server/supabase.ts`, `server/ai/background.ts`, `job-launcher.ts` | JWT-verifikation, service-rolle |
| `signup.astro`, `login.astro`, `Header.astro`, `profile.astro`, `wardrobe.astro`, `closet.astro` | livscyklus, guards, client-state |
| Alle 17 migrations (16 + `202610070001`) | RLS, grants, definer-RPC'er, storage-policies |
| `lib/client/*`, alle localStorage/sessionStorage-nøgler | client-state-isolation |
| Eksisterende analyser + `docs/` | historik (baseline F4/F6/F9 + G1–G9), gældende regler |
| `package.json`, `global.css`, `fashn-space.ts`, AI-jobs | dependencies, tredjeparter |

Ændringer i denne runde (hele listen): **3 `pageshow`-handlere**
(`profile.astro`, `wardrobe.astro`, `closet.astro`) + denne fil.
`npm run build` = **Complete**; `npx tsc --noEmit` = **0 fejl i ændrede filer**
(12 præ-eksisterende i urørte filer: `@types/pngjs`, `ArrayBuffer`, `astro.config`).

---

## 1. Current Architecture (CONFIRMED)

```text
PUBLIC  / , /login , /signup                 ← statisk prerenderet HTML (ingen data)
PROTECTED (klient-guard) /profile /wardrobe /closet
   │  HTML er TOM skel: ingen privat data i kilden (data hentes efterfølgende)
   │  ★ SIKKERHEDEN ligger IKKE i sidens guard (den er UX) — den ligger i:
   ▼
API-ruter (Astro SSR, /api/**)
   authenticateSupabaseRequest(request)
     1. Bearer-token fra Authorization-headeren (aldrig query/body)
     2. client.auth.getUser(token)  ← server-side verifikation
     3. returnerer { client = JWT-scoped, user }
   ▼  + eksplicit .eq("user_id", user.id) på hver operation
Supabase Postgres (RLS: auth.uid() = user_id)   ← andet, uafhængigt lag
   ▼
Supabase Storage (privat bucket, {userId}/-stier, signerede URLs)
   ▲
Service-rolle (SUPABASE_SERVICE_ROLE_KEY) bruges KUN i: API-ruter,
baggrundsjobs (Netlify + x-job-secret + jobUserIsValid), konto-sletning.
   └── findes ALDRIG i .astro/klient-bundles (grep = 0).
```

**Nøgler:** `PUBLIC_SUPABASE_URL/ANON_KEY` = klient (meningen);
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `BACKGROUND_JOB_SECRET`,
`HF_TOKEN` = kun server/funktioner. **Bemærk (hygiejne):** `.env` indeholder
dublerede `PUBLIC_SUPABASE_*`-nøgler (dokumenteret fund, ryd op ved deploy).

**Pages er statiske** (`output: "static"` + SSR-funktion for `/api/**`): der
findes **ingen middleware/server-side route-guard**. Det er en bevidst, fungerende
arkitektur — sikkerhedsgrænsen er API+RLS, ikke HTML'en (se §5).

---

## 2. Authentication Audit — livscyklussen

| Trin | Hvad beviser identitet | Session fra | Validering | Ved fejl |
|---|---|---|---|---|
| **PUBLIC** | intet | ingen | — | — |
| **SIGNUP** | — (opretter) | `supabase.auth.signUp` → session hvis bekræftet ellers `null` | Supabase Auth (kode + evt. e-mailverification, dashboard = **UNVERIFIED**) | fejlbesked i `#signup-message`; ingen forespørgsel ved mismatch |
| **LOGIN** | `signInWithPassword` | Supabase (localStorage af supabase-js, `persistSession: true` som default) | Supabase Auth | generisk "Email or password is incorrect." |
| **SESSION** | access-JWT | `getSession()` (klient, UX) → **`getUser(token)` (server, sikkerhed)** | Hver API-kald verificeres server-side | 401 → klient viser fejl/redirect |
| **/profile** | guard `checkProfileSession` + API | `getSession()` | Redirect til `/login` ved ingen session; data kræver token | `/login?reason=session` |
| **/wardrobe** | guard `checkWardrobeSession` + API | samme | samme | samme |
| **/closet** | **soft-guard** (ingen redirect): `loadCloset()` afviser tomt token og viser `PLEASE LOG IN TO VIEW YOUR CLOSET.` + tomt grid | `getSession()` | Data kan **ikke** loades uden token; API+RLS er det egentlige lag | tomt grid (ingen data) |
| **LOGOUT** | `supabase.auth.signOut()` | session fjernes (klient) | — | fejlbesked, bliv på siden |
| **LOGIN IGEN** | ny session | samme localStorage | **client-state ryddes ved forrige logout** ⇒ starter rent | — |
| **DELETION** | JWT → `user.id` | session invalid efter `deleteUser` | `POST /api/account/delete` | ærlig 4xx/5xx, kan gentages |

**Udløbet/ugyldig session:** API svarer 401 (`authenticateSupabaseRequest`) →
klienten holder op med at hente data; `#wardrobe`/`#profile` viser fejl og
redirecter ved næste navigation. **Adgangstoken forbliver teknisk gyldigt indtil
udløb (~1 t) efter logout** (JWT-semantik) — **INFERRED**, dokumenteret som
rest-risiko i §20 (kan ikke ændres uden server-side token-revocation-list,
**UNVERIFIED** om Supabase-projektet har det slået til).

**Back/forward-navigation:** **SF1 fundet og rettet** — `pageshow`-handlere
som genkalder de eksisterende guards, når browseren gendanner en side fra
bfcache (`event.persisted`). Registreret som den *eneste* kodeændring ud over
den tidligere runde.

---

## 3. Login Audit (`login.astro`, CONFIRMED)

| Krav | Status | Bevis |
|---|---|---|
| Autentificering via Supabase Auth | ✓ | `supabase.auth.signInWithPassword({email, password})` |
| Ingen localStorage-flag som auth | ✓ | `closet-logged-in` **findes ikke** i koden (grep); ingen "logged-in"-nøgle læses nogen steder |
| Forkerte credentials fejler sikkert | ✓ | kun `if (error)`-gren; ingen undtagelse sives til UI |
| Fejl afslører ikke for meget | ✓ | `invalid_credentials` → *"Email or password is incorrect."* (ingen differentiering af ukendt e-mail vs. forkert kode); øvrige → generisk *"We couldn't log you in."* |
| Korrekt session etableres | ✓ (kode) | `if (!data.session) → "check your email verification"`; ellers redirect `/profile` |
| Redirect ved succes | ✓ | `window.location.href = "/profile"` |
| andres lokaldata efter login | ✓ efter F-fixes | logout rydder `closet-items`, `closet-source-photo`, `dressed-character`, `dressed-profile-outfit:*` (`account-state.ts`) |
| Beskyttede sider kræver auth | ✓ (kode) | guards + token-krav i alle data-load |

**Fund:** ingen sikkerhedsfejl i login. **UNVERIFIED:** rate-limiting,
lockout og e-mailverification styres i Supabase-dashboard (kan ikke aflæses fra
repoet) → indgår i §21.

---

## 4. Signup Audit (`signup.astro`, CONFIRMED)

| Krav | Status | Bevis |
|---|---|---|
| E-mail-validering | ✓ | `type="email"` + `required` + `email.trim()` + Supabase-fejl-gren `email_address_invalid` |
| Password + CONFIRM PASSWORD | ✓ | to felter, `#signup-password` / `#signup-password-confirm` |
| Mismatch blokerer signup | ✓ | `password !== passwordConfirm → return` **før** noget `supabase.auth`-kald |
| Show/hide password, uafhængigt | ✓ | to selvstændige `wirePasswordToggle`-tilslutninger; kun `input.type` ændres |
| Tastatur-tilgængelighed | ✓ | rigtige `<button type="button">`, `aria-label` "Show/Hide password", `aria-pressed`, pink `:focus-visible` |
| `autocomplete="new-password"` | ✓ | på begge felter |
| Ingen logging af adgangskoder | ✓ | hverken `console.*` eller fejlbeskeder indeholder koden; kun `error.message` fra Supabase |
| Ingen lokal lagring af kode | ✓ | ingen `localStorage`-skrivning med kode/confirm (grep) |
| Supabase forbliver autoritet | ✓ | kun `signUp({email, password, options.data{name, gender}})`; ingen egen hash/lagring |
| Ingen unødvendig rewriting | ✓ | eksisterende flow bevaret; kun tilføjelser |

**Status: opfyldt — ingen ændring foretaget i denne runde** (Rule: *hvis det
allerede er korrekt, lad det være*).

---

## 5. Session Audit

**Kilde til "hvem er jeg":** `supabase.auth.getSession()` i klienten (UX) og
`client.auth.getUser(token)` i **serveren** (sikkerhed). Aldrig:

```text
FORBUDT (verificeret fraværende):        BRUGT:
✗ localStorage user-id                    ✓ Authorization: Bearer <access_token>
✗ URL / ?user_id=                         ✓ authenticateSupabaseRequest → user.id
✗ profile-id som identitet                ✓ .eq("user_id", user.id) oven i RLS
✗ request-body user_id (ignoreres/kontroleres)
```

**Alle beskyttede ruter:** `/profile` + `/wardrobe` = hårde guards
(`check*Session` + redirect, nu også ved bfcache); `/closet` = soft-guard
(ingen data uden token). **Alle API-ruter (12/12):** `authenticateSupabaseRequest`
**og** `user_id`-filter (verificeret fil-for-fil).

**Alle DB-operationer:** RLS-defineret ejerskab (§10) — klienten er aldrig
andet end andet-lag oven i det.

**Alle Storage-operationer:** `{userId}/`-stier + policies (§11) + signerede
URLs; **ingen** offentlige URLs.

**HTML-lagets rolle (ærlig vurdering):** siderne er statiske og har **ingen**
server-side guard. Det er **ikke** en sårbarhed, så længe indeholder er tomt
(**CONFIRMED**: ingen privat data i prærenderet HTML) og alle data hentes via
JWT-beskyttede kald. Men det betyder, at *synlighed* efter login (DOM) afhænger
af klient-guards — hvilket er præcis, hvad SF1-fixet adresserer.

---

## 6. Logout Audit

```text
Header LOG OUT-knap
  → supabase.auth.signOut()            (fjerner lokal session; refresh-token revokeres*,
                                        access-JWT kan leve videre til naturligt udløb*)
  → clearDressedClientState()          ← NY i forrige runde (kun DRESSED-nøgler):
        closet-items, closet-source-photo, dressed-character,
        dressed-profile-outfit:*, sessionStorage dressed-generation-flow
  → redirect /login
  → bfcache-back? → pageshow-genkald af guard → redirect (SF1-fix)
```

- **Ryddes kun DRESSED-specifik state?** ✓ — ingen global `localStorage.clear()`,
  ingen røring af supabase-js' egen session-nøgle **før** `signOut` er gennemført
  (supabase-js rydder selv sin `sb-<ref>-auth-token` ved signOut).
- **Kan bruger B se bruger As data?** Nej efter denne model: As filer/nøgler er
  fjernet; B's egne kald filtreres af API+RLS. *(Live-bekræftelse = §19 E.)*
- **Beskyttede sider forbliver beskyttede** ✓ (guard + 401).
- *`signOut`-revocations-semantik for access-tokens = **UNVERIFIED** (se §20).

**Status: kode korrekt; live-test kræves (§19 E).**

---

## 7. Dashboard / Profile Audit (`/profile` = beskyttet dashboard)

| Område | Kontrol | Status |
|---|---|---|
| Auth-guard | `checkProfileSession()` + **ny** `pageshow`-genkald ved bfcache | ✓ kode |
| Profilindlæsning | `supabase.from("profiles").… .eq("user_id", session.user.id)` (`:704`, `:915`, `:943`, `:1188`) | ✓ |
| Profile-oprettelse (lazy) | `.insert({ user_id: session.user.id, … })` | ✓ (+ RLS `WITH CHECK` efter migration) |
| Model/karakterindlæsning | `dressed_characters … .eq("user_id", session.user.id)` (`:566`) | ✓ |
| Wardrobe-indlæsning | `loadPersistentWardrobe(token)` → `/api/wardrobe/items` (server-filtreret) | ✓ |
| Outfit-indlæsning | `loadSavedDressedOutfits(token)` → `/api/wardrobe/outfits` | ✓ |
| Billedindlæsning | `createSignedUrl(model_path / source_photo_path)` med **eget** JWT → storage-SELECT-policy | ✓ efter migration (§11) |
| Kontoindstillinger | profilformular: kun egne felter | ✓ |
| Slet konto | `POST /api/account/delete` med bekræftelse + JWT-identitet | ✓ (§12) |

**"Skift ID i URL/API for at få andres data":** der findes **ingen** ID i
nogen URL på Profile (ingen `?id=`, ingen `:id`-route). Alle kald er
bruger-id-filtrerede, og RLS er andet lag. **Konklusion: bevaret som korrekt
beskyttet** — ingen ændring.

**Kendt begrænsning:** `#profile` viser legacy-lokalt `closet-items` *indtil*
server-load erstatter det (`profile.astro:1303-1368` vs `:1567`) — efter logout-
rydningen kan det ikke overleve til næste konto, men **mens man er logget ind**
er det brugerens egne data. Markeres som dataminimerings-spørgsmål (SF7/§16),
**ikke** som isolationssår.

---

## 8. Wardrobe Audit (`/wardrobe`)

| Operation | Route | Auth | Ejerskab | RLS-lag |
|---|---|---|---|---|
| Item read (grid/model) | `GET /api/wardrobe/items` | ✓ | `user_id`-filter + `aiAssets` pr. `base_type` | ✓ SELECT own |
| Item create (upload) | `POST /api/wardrobe/items` | ✓ | `user_id: user.id` (aldrig fra body) + `{user.id}/…`-sti-CHECK | ✓ INSERT own + path |
| Item update (placement) | `PATCH …/items/[id]` | ✓ | filter `eq(user_id)` før service-UPDATE | ✓ UPDATE own |
| Item delete | `DELETE …/items/[id]` | ✓ | filter + kun egne stier (`startsWith(user.id/)`) | ✓ DELETE own |
| Image retrieval | signerede URLs fra server | ✓ | kun egne stier; signer kræver SELECT-policy | ✓ |
| Outfit create | `POST /api/wardrobe/outfits` → RPC `save_dressed_outfit` | ✓ | RPC bruger `auth.uid()` | ✓ (kun definer-INSERT) |
| Outfit load | `GET …/outfits` | ✓ | `eq(user_id)` | ✓ SELECT own |
| Outfit delete | `DELETE …/outfits/[id]` | ✓ | filter | ✓ DELETE own |
| Placement update | `PATCH …/items/[id]` | ✓ | filter + `parsePlacement`-validering | ✓ (service-klient m. filter, baseline F3) |

**Klassisk IDOR-scenarie (kode-gennemgang):**

```text
BRUGER B kender BRUGER As item-id (f.eks. "pink-shirt-1")
  GET    /api/wardrobe/items/PINK-SHIRT-1 → B's JWT → select m. eq(user_id=B)
                                             → 0 rækker → 404
  PATCH  /api/wardrobe/items/PINK-SHIRT-1 → eq(user_id=B) på UPDATE → 0 rækker → 404
  DELETE /api/wardrobe/items/PINK-SHIRT-1 → samme → 404
  Samme for outfits/[id], characters/[id], profiles og storage-stier.
  (+ selv hvis et filter glemt: RLS nægter raden — uafhængigt andet lag)
```

**Konklusion:** wardrobe-authorization er **korrekt i kode**; den praktiske
bekræftelse kræver to rigtige konti → **NEEDS TEST** (§19 C).

---

## 9. API Audit — alle 16 routes (12 filer)

Akronummer: **1** = auth krævet · **2** = identitet fra JWT · **3** = ejerskab
verificeret · **4** = RLS som andet lag · **5** = client-supplied `user_id`
ignoreret/kontrolleret · **6** = resource-id beskyttet · **7** = sikre fejl ·
**8** = ingen privilegerede hemmeligheder i svaret. Alle svar har `Cache-Control:
no-store` (verificeret 12/12 filer).

| Endpoint | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | Bevis / noter |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/wardrobe/items` (upload) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | sti-CHECK kræver `{uid}/`-prefix; client `user_id` accepteres ikke |
| `GET /api/wardrobe/items` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | kun egne items + egne rpc-assets |
| `PATCH /api/wardrobe/items/[id]` | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | `eq(user_id)` før service-UPDATE; placement valideres (`parsePlacement`, max 10k) |
| `DELETE /api/wardrobe/items/[id]` | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | service-rollen **nøjes med** `eq(user_id)` + `startsWith(uid/)` |
| `POST /api/wardrobe/outfits` (RPC) | ✓ | ✓ | ✓ | ✓ | ✓* | – | ✓ | ✓ | `save_dressed_outfit` bruger `auth.uid()`; *`p_user_id` underordnes (`COALESCE(auth.uid(),…)`) |
| `GET /api/wardrobe/outfits` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | `eq(user_id)` |
| `DELETE /api/wardrobe/outfits/[id]` | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | filter + re-read efter delete |
| `POST /api/ai/try-on` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | billed-lagre bruger `user.id` (kun FK bruges); preview = base64, ikke URL |
| `POST /api/profile/source-photo` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | server **ignorerer** `user_id` i body; `path.startsWith(uid/)` ved delete |
| `GET/POST /api/ai/usage` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | `get_ai_usage_metrics(claimed_id)` validerer `auth.uid() = claimed_id` |
| `POST /api/ai/personal-model` + `GET …/personal-model` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | reservation via `auth.uid()`; job låst med `jobUserIsValid`; `GET` viser kun egne signaturer |
| `POST /api/ai/process-clothing` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | reference-URL kun internt i job; 307-underskrivning kræver egne stier |
| `POST /api/ai/dress-model` | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | `p_user_id` ignoreres; resultat = `eq(user_id)`; response = base64, ikke URL |
| `GET /api/ai/characters/[id]` | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | `get_character_for_user(auth.uid(), …)` + opslagslås; **404** for andres id |
| `POST /api/characters/[id]` | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | primary-flip `eq(user_id)`; `is_primary` aldrig fra body; DELETE er 405 |
| **`POST /api/account/delete`** | ✓ | ✓ | ✓ | ✓ | **✓ aldrig fra body** | – | ✓ | ✓ | `user.id` fra `auth.getUser(token)`; service-rolle kun internt; svaret = tal/status |

**Særligt om `/api/account/delete` (Part 10-krav):** identiteten kommer
**udelukkende** fra den verificerede session; et falskt `userId` i body er
irrelevant (bruges kun til valideringsbesked). Service-nøglen sendes aldrig
tilbage. Svaret indeholder kun tal/status — ingen stier/hemmeligheder.

**Observationer (ingen kræver kodeændring):**
1) `items/[id]` PATCH/DELETE bruger service-rollen **med** `user_id`-filter —
   sikkert i dag; RLS forbliver net som andet lag.
2) `try-on`-ruterne er **ikke forbundet til nogen klient** (0 referencer) —
   FASHN-strømmen er inaktiv (§17).
3) Alle 16 routes (12 filer) har både `authenticateSupabaseRequest` og
   `user_id`-filter (verificeret fil-for-fil med grep).

---

## 10. Database / RLS Audit

| Tabel | SELECT | INSERT | UPDATE | DELETE | Noter |
|---|---|---|---|---|---|
| `auth.users` | ejer via Auth | – | – | ejer (konto-sletning) | styres af Supabase Auth |
| `profiles` | own (`202610070001`) | own + `WITH CHECK user_id = auth.uid()` | own | own | **GAP G1:** live er kendt *åben* (`0000` = "DROP ALL"-fase); ejerskab findes kun i den **nye, ikke-anvendte** migration |
| `wardrobe_items` | own (`0011`) | own | own | own | + `base-form-read` (nødvendig deling af basis-assets) |
| `wardrobe_item_ai_assets` | own (`0011`, prædikat via relation `→ wardrobe_items`) | own | own | own | **ingen persondata** (referencer/versioner) |
| `dressed_characters` | own (`0010`) | own | own + primary-lås | own | modelfil = persondata |
| `saved_dressed_outfits` | own (`0011`) | **kun via defineret RPC** | – | own | RPC `save_dressed_outfit` bruger `auth.uid()` |
| `wardrobe_results` | own (`0010`) | own | own | own | AI-resultat = persondata |
| `dressed_outfit_items` | mangler (`0010` = GAP) | ingen | ingen | ingen | **ikke brugt** af applikationen (tom, genoprettet af FK) |
| `ai_generation_usage` | RPC-gate (`get_ai_usage_metrics` validerer `auth.uid() = claimed_id`) | via `record_ai_generation`-RPC | – | ingen | tæller, ikke personindhold |
| `ai_generation_limits` | **global** (`SECURITY DEFINER`, ingen `user_id`) | – | – | – | ressource-loft pr. basis, ikke per-bruger |
| `ai_generation_overrides` | own (RLS) | admin | admin | admin | administrativ |

**Principielle konklusioner (CONFIRMED):**
- **Ingen bred** *"authenticated users can access this table"*-policy findes
  (bevist i `0011`: "already non-existent"). Alt er `auth.uid() = user_id`,
  undtagen de dokumenterede basis-assets og de definerede RPC'er.
- **`WITH CHECK`** findes, hvor klienten indsætter `user_id`.
- **"UUID er ikke nok"** er håndteret: ejerskab er altid `auth.uid()`.
- **`storage.objects`** (ny i `202610070001`): ejerskab =
  `(storage.foldername(name))[1] = auth.uid()::text`, 8 policies
  (2 buckets × 4 operationer), `TO authenticated` begge veje, anon revokeres,
  `base-form-read` fra `0010` bevares. **Ikke anvendt endnu (SF2).**
- **Definer-RPC'erne** (`update_item_placement`, `save_dressed_outfit`,
  `get_ai_usage_metrics`, `record_ai_generation`, `update_outfit_free_scale`,
  `get_character_for_user`) validerer `auth.uid()` (eller er `SECURITY DEFINER`
  med validering). **UNVERIFIED:** om migrations 0009+ er anvendt live.
- **Ingen migration er ændret** i denne proces; `202610070001` **tilføjer**
  ejerskab og revokerer anon — det er den mindst mulige, additive rettelse.

**Verifikations-SQL (køres i Supabase SQL editor — ikke kørt herfra):**

```sql
select tablename, policyname from pg_policies
 where schemaname = 'public'
   and (tablename = 'profiles' or tablename = 'objects')
 order by tablename, policyname;
-- forventet efter anvendt migration: 3 profiles-policyer (SELECT/INSERT/UPDATE
-- med auth.uid()=user_id), base-form-read på objects, + 8 owner-folder-policyer
```

---

## 11. Storage Audit

**Buckets (oprettet i `0010`):** `profile-images`, `model-images` —
begge **private** (`public=false`); `base-forms` oprettes privat, men
`202610070001` revokerer **anon**-adgangen til den — fund:
*base-forms-server-URL’en er i øjeblikket eneste læsevej* (bygning kræver
decode; **anbefalet:** signerede form-billeder i stedet for HTTP-kald, se §20).
**Ingen** `getPublicUrl()` findes (bevist).

**Global vs. privat (part 9):**

| Aktiv | Klasse | Sti / adgang |
|---|---|---|
| Brugerens kilde-/profilfoto | **PRIVAT** | `profile-images/{uid}/…` (låst til ejer via client-supabase-garantien (baseline F4) + storage-policies i `202610070001`) |
| Brugerens AI-modelbilleder (inference + job) | **PRIVAT** | `model-images/{uid}/…` (job opretter client-supabase-garantien) |
| Basisformer (woman/man) | GLOBAL DELT | `base-forms/{base_type}/…` — *ændrer klassen fra privat til delt; se risiko §20* |
| Fremtidige delte tøj-assets | GLOBAL DELT | foreslås `shared-clothing/{asset_id}/…` (Plan B) |
| Fremtidige 3D-assets | enten | `model-images/{uid}/` vs `shared-3d/…` — **produktvalg før oprettelse** |

**Signed-URL-semantik (dokineret, jf. krav):**
> En signerede URL er et **bearer-credential** for sin levetid (her 3600 s).
> Efter udstedelsen er den **ikke knyttet til identitet** — enhver der har URL'en,
> kan hente filen indtil udløb. Signed-URLs giver **ikke** identitetsbaseret
> adgang efter udstedelse, og **ingen** URL er signeret i HTML/SSR (de oprettes
> kun i browserens egen `createSignedUrl(session.accessToken)`-kald).

**SELECT/INSERT/UPDATE/DELETE:** alle 4 operationer er dækket pr. bucket i
`202610070001` (8 policies), TO authenticated, anon revokeres — **men
migrationsfilen er ikke anvendt (SF2)**: indtil da er privat-læsning
**UNVERIFIED** (live-kendt som muligvis åben for alle autentificerede, jf.
GAP G2 i baseline-analysen). Sletning på tværs af brugere forhindres **altid**
på API-niveau (`startsWith(user.id/)`) uanset policy-tilladelse — en B-bruger
kan altså ikke *fjerne* As filer via DRESSED's API (policy-lag beskytter
primært mod direkte storage-kald).

---

## 12. Account Deletion Audit (`POST /api/account/delete`)

**Dækning af al persondata under DRESSEDs kontrol (Part 11):**

| Trin | Rækkefølge | Data | Håndtering af fejl |
|---|---|---|---|
| 1 | DB barn-først | `wardrobe_results` → `wardrobe_item_ai_assets` → `wardrobe_items` → `saved_dressed_outfits` (+ `dressed_outfit_items`) → `dressed_characters` → `ai_generation_usage` → `ai_generation_overrides` → **`profiles` (eksplicit, ukendt FK)** | hvert trin `.eq("user_id", …)`; fejl → `502` med `warnings[]` |
| 2 | Storage | `{uid}/` i **begge** buckets, **rekursiv + pagineret** (gennemløber også `models/`, `tryon/`, `generation/`, `profile/`-undermapper) | delvis fejl → `502` "some storage objects could not be removed" |
| 3 | **Auth til sidst** | `auth.admin.deleteUser(user.id)` | 403 → `409` (kan ikke slette andres/rå rolle); anden fejl → `502` |

**Bestil og FK-afhængigheder** er verificeret mod migrations
(`wardrobe_results → items` FK, `dressed_outfit_items → outfits`, `characters`
FK’er); autoprofil-FK’en er **ikke kendt** (`0001` havde ingen FK) →
sletning derfor eksplicit uanset retning. **DB → Storage → Auth**-rækkefølgen
betyder at en fejl **altid efterlader en genkørlig, ærlig tilstand** —
klienten viser aldrig "kontoen er slettet" før `deletion.authDeleted === true`.

**Efter vellykket sletning:** `signOut()` + `clearDressedClientState()` +
redirect til `/` (offentligt område). **Session-invalidation:** auth-useren
fjernes ⇒ næste `getUser(token)` fejler; sign-out rydder den lokale session.
**Fortsat utilgængelighed:** guards giver `/login?reason=session`, og selv om
klienten blev omgået, svarer alle API-ruter 401 (token findes ikke længere).

**GDPR-artikel-17-teknik:** denne funktion **er** den tekniske
slettevej (§16). **Ærlighed:** den dækker kun det, DRESSED faktisk ejer —
se §16/§17 om tredjeparts-restkopier og §20 om backups/logs.

---

## 13. User Isolation Audit

**Hvor `auth.uid() = user_id` gælder (lag-for-lag):**

| Lag | Mekanisme | Tværgående IDOR-mulighed |
|---|---|---|
| Route-ingen | ingen ID i URL udover `[id]` der altid passerer `eq(user_id)` | ingen URL-manipulation |
| API | `authenticateSupabaseRequest` → `user.id` fra JWT; body `user_id` ignoreres/kontrolleres | kræver at B's egen JWT bruges ⇒ filtret rammer B |
| DB | RLS `auth.uid() = user_id` på alle bruger-tabeller | kræver at kunden henvender sig direkte til Postgres — **policy-tilladelser = UNVERIFIED (SF2)** |
| Storage | `{userId}/`-stier + folder-owner-policy + signerede URLs | private paths; **policy-tilladelser = UNVERIFIED (SF2)** |
| Client | localStorage-nøgler er ikke-opdaterede uafhængigt af konto | **ryddes ved logout** (`account-state.ts`) + SF1-fix |

**Prøvning af hver ressource (Forventet vs. kode):**

| Ressource | B's forsøg på As ID | Forventet | Kode-sandt? |
|---|---|---|---|
| wardrobe item | GET/PATCH/DELETE `[id]` | 404 | ✓ `eq(user_id)` på alle tre |
| outfit | GET/DELETE `[id]` | 404 | ✓ `eq(user_id)` |
| character/model | GET `[id]` | **404** (aktivt valgt) | ✓ RPC + `auth.uid()` |
| profile | GET/PATCH uden ID | **kun egen række** (muligvis `null`) | ✓ `eq(user_id)` + RLS |
| kildefoto | GET/DELETE | 404/forbuddet, kun `{uid}/` | ✓ path-præfiks + JWT i clienten |
| AI-modelfoto | signér As sti med B's JWT | afvist (policy) | ✓ efter migration (SF2) |
| usage-tæller | `rpc(get_ai_usage_metrics, [As-id])` | `{authorized:false}` | ✓ `auth.uid()`-check i SQL |
| konto-sletning | body `userId: As-id` | **sletter kun B** | ✓ identitet fra JWT alene |

**Konklusion:** isolationen er **"forsvar i dybden"** i kode, men dens
**policies** lever i Supabase og kan ikke aflæses herfra ⇒ status
**NEEDS TEST** — ikke PASS — indtil §19's matrix er kørt.

---

## 14. GDPR Technical / Privacy Audit

> **Advarsel:** *tekniske foranstaltninger understøtter GDPR-overholdelse — de
> beviser den ikke. Ingen juridisk konklusion drages her; alle
> retsgrundlags-spørgsmål er udskilt til §21.*

| Princip | Teknisk status | Vurdering |
|---|---|---|
| **Databeherskelsesansvar / accountability** | Denne + baseline-analysen dokumenterer arkitektur, lag og datastrømme | ✓ teknisk dokumentation; **juridisk ansvarsfordeling = §21** |
| **Data minimisation (art. 5.1.c)** | Kun 7 profilfelter; `is_primary`-kolumnen *gemmes*, **men klienten sender den aldrig** (overflødigt, men uskadeligt); uploads = kun det påkrævede; intet sporings-/analysebibliotek (ingen GA/Segment) | **stærk**, med to observationer: SF7 (base64-lokale fotos) og SF5 (Google Fonts) — **Produktvalg** |
| **Purpose limitation (art. 5.1.b)** | Hver funktion henter præcis det, den viser; **ingen** videresalg/annoncer; udelukkende eget formål i koden | ✓ teknisk; **om skriftligt formål findes = §21** |
| **Accuracy (art. 5.1.d)** | Klienten redigerer egne profilfelter direkte; ingen automatisk profil-generering af kundeindhold udover AI, som bevarer input | ✓ teknisk |
| **Storage limitation (art. 5.1.e)** | **Ingen TTL/retningslinje fundet** (alt er "indefinit"; kun sletning via konto-sletning); Netlify-fjernelse er overflow-styret | **LEGAL/PRODUCT DECISION REQUIRED** (§16) |
| **Integrity & confidentiality (art. 5.1.f)** | TLS (HTTPS-overalt), JWT-verifikation server-side, RLS, private buckets, **no-store** på alle API-svar, service-nøgle aldrig i browser, signerede URLs | ✓ stærk teknisk; **ansees som teknisk gennemført** |
| **Privacy by design / by default (art. 25)** | Privat-storage-som-standard; tomme konti uden demo-data; profil oprettes først ved brug; JWT i kernen fra dag ét; eksport mangler, retention mangler | **delvis** — manglende dele er kendte og dokumenteret (ikke skjult) |
| **Data subject rights (art. 15–22)** | **Sletning = teknisk implementeret** (§12); **adgang/eksport = "GDPR access/export feature not yet implemented."** (§17); **rettelser = profil-edit** ✓; **indsigelse/behandling-begrænsning = ikke implementeret** (produktbeslutning) | **Blandet — se §21** |

**Særligt om de tre følsomme strømme:**

1. **Kontooplysninger** (e-mail, valgfrit navn, køn, stil-præferencer):
   minimale; **køn + stil-præferencer kan have diskriminationsfølsomhed** →
   *produkt/juridisk valg* om de overhovedet skal gemmes (art. 9-analyse
   berøres i §21, ikke afgøres her).
2. **Uploadede fotografier (kildefoto + tøjfoto):** foto = personoplysninger
   (ofte identificerbart). Teknisk: privat bucket, `{uid}/`, signerede URLs
   (1 t), tydeligt formål (AI-generering af brugerens egen model).
   **Juridisk:** *kræver fastlæggelse af retsgrundlag* (art. 6 og muligvis
   art. 9, hvis billedet udgør biometri via den fremtidige figur) —
   **§21, ikke herfra**.
3. **AI-genererede billeder baseret på brugerfotografier:** billedet er
   en *afledt personoplysning* (bærer brugerens udseende) → samme
   beskyttelsesniveau (private bucket, ejerskab i `model-images/{uid}/`,
   dækkes af sletning). **Udbyderens efterbehandling af trænings-/logdata
   = §17 (Requires provider/legal verification).**

---

## 15. Data Inventory

### 15.1 Databasen

| Data | Hvor | Hvorfor (funktion) | Ejer | Afgang |
|---|---|---|---|---|
| `email`, `encrypted_password`, `created_at`, `updated_at`, `confirmation_*`, metadata `{name, gender}` | `auth.users` (Supabase) | login, konto | bruger | sletning |
| `profiles`: `name`, `username`, `favourite_style`, `gender`, `source_photo_path`, `model_photo_path`, `model_generation_status`, `is_primary`, `model_generation_job_id` | public + storage-sti-referencer | visning af navn/stil, foto-stier, job-status | bruger | sletning |
| Kildefoto (fil) | `profile-images/{uid}/…` | AI-input til personlig model | bruger | sletning (Storage-trin) |
| AI-modelbilleder (fil) | `model-images/{uid}/…` | dashboard/try-on | bruger | sletning |
| Basisform-billeder (fil) | `base-forms/{base_type}/…` | **global** kropsbasis for alle | DRESSED | driftsvedligeholdelse |
| `wardrobe_items`: `name`, `category`, `reference_path`, `original_path`, `preview_path`, `placement` | public | garderobe, placering | bruger | sletning |
| `wardrobe_item_ai_assets`: `reference_path`, `generation_version`, `base_type` | public | AI-readiness pr. basis | **ikke personlig** (slettes via item) | sletning |
| `dressed_characters`: `model_path`, `gender`, `is_primary`, `geometry_contract_version` | public | figurvalg | bruger | sletning |
| `saved_dressed_outfits`: `name`, `item_ids`, `base_type`, `character_id`, `outfit_key`, `free_scale_x/y` | public | gemte outfits (kunstnernavne + id’er) | bruger | sletning |
| `wardrobe_results`: `item_ids`, `result_path`, `outfit_key`, `character_id`, `character_variant_key` | public | AI-dress-resultat (foto-lignende) | bruger | sletning |
| `ai_generation_usage/limits/overrides` | public | service-loft, administration | DRESSED | drift/revision |
| netværksdata | Netlify/Supabase-logs (udenfor appen) | drift | bruger | **ikke DRESSED-kontrolleret — §17** |

### 15.2 Browserens klientlager (DRESSED-nøgler)

| Nøgle | Indhold | Formål | Efter logout |
|---|---|---|---|
| `sb-<ref>-auth-token` (supabase-js) | session-JWT | auth | fjernes af `signOut()` |
| `closet-items` | legacy wardrobe-linjer (stier + placement) | fejl-tolerant fallback (baseline F8) | **ryddet** (`account-state.ts`) |
| `closet-source-photo` | kildefoto som **base64 (hele billedet!)** | fallback til profil-flow | **ryddet** |
| `dressed-character` | cache af model, **base64-op til ~3,8 M tegn** | genbrug mellem sessions | **ryddet** |
| `dressed-profile-outfit:*` | cachelagrede outfits pr. karakter | hurtig indlæsning | **ryddet** |
| sessionStorage `dressed-generation-flow` | afbrudt AI-flow | genoptagelse af flow | **ryddet** |
| `dressed-outfit-*` | outfit-billeder (kun brugerens egne) | genbrug | **ikke ryddet** — indeholder kun egne data; fjernes ved evt. fuld lokal rydning (produktvalg, §21) |

**Udgående forespørgsler (hvad der forlader browseren):** kildefoto + tøjfoto
→ AI-udbydere (§17); signerede URLs → Supabase Storage; alle API-kald → egen
Netlify-funktion; **Google Fonts** → Google (SF5); **ingen** tracking,
cookie-banner eller tredjeparts-widget fundet i appen.

---

## 16. Data Retention (Part 15 + Part 16)

> **Ingen retentionsperiode er opfundet her.** Hvor en periode ikke findes i
> systemet, står: **"Product/legal decision required."**

| Datatype | Formål | Hvor lagret | Hvem kan tilgå | Retentionsadfærd | Sletningsmetode |
|---|---|---|---|---|---|
| Konto (`auth.users`) | login | Supabase Auth | ejer + service-rolle | **indefinit** (ingen auto-sletning) | `/api/account/delete` → `auth.admin.deleteUser` |
| Profil (7 felter) | visning | `public.profiles` | ejer (RLS), service-rolle | **indefinit** | sletningstrin 1 (explicit) |
| Kildefoto | AI-input | `profile-images/{uid}/` | ejer via signerede URL (1 t); **policy = UNVERIFIED** | **indefinit** (erstatning arkiverer ikke) | sletningstrin 2 (rekursiv) |
| AI-modelbilleder | visning/try-on | `model-images/{uid}/` | samme | **indefinit** | sletningstrin 2 |
| Basisformer | delt funktion | `base-forms/` | **global** (se §20) | vedligeholdes | manuelt (ikke brugerdata) |
| Wardrobe items + AI-assets | garderobe | `wardrobe_items` (+assets) | ejer (RLS) | **indefinit** | sletningstrin 1 |
| Outfits | gemte outfits | `saved_dressed_outfits` | ejer (RLS) | **indefinit** | sletningstrin 1 |
| AI-dress-resultater | try-on-historik | `wardrobe_results` | ejer (RLS) | **indefinit** | sletningstrin 1 |
| Kørselstæller | service-loft | `ai_generation_usage` | ejer via RPC | **indefinit** | sletningstrin 1 |
| Klient-cache (base64-foto!) | offline/fallback | brugerens browser | **alle på den maskine** (herredømme over dokumentet) | **indefinit indtil logout** | logout-rydning (`account-state.ts`) |
| Signerede URLs | midlertidig adgang | browserens hukommelse | hvem end der har URL'en | **maks 3600 s** | udløb automatisk |
| Netlify-/Supabase-logs | drift | udbyder | udbyder | **ikke DRESSED-kontrolleret** | §17 |
| Backups (hvis PITR/slack) | disaster recovery | Supabase | udbyder | **UNVERIFIED** | juridisk/teknisk spørgsmål §21 |

**Delvise huller:** `dressed-outfit-*`-nøgler ryddes ikke ved logout (§15.2);
`ais*`/legacy-wip- og rate-nøgler er ikke-personlige og røres bevidst ikke.

**Højre til sletning (art. 17) — teknisk:** opfyldt inden for DRESSEDs
kontrol via `/api/account/delete` (DB + Storage + Auth), gentageligt, med
ærlig delvis-fejl-rapport. **Undtagelser der skal afgøres juridisk, ikke
opfindes:** eventuel DB-backup-periode (Supabase), Netlify-function-logs,
adgangstokens der lever til naturligt udløb (~1 t), og tredjeparts-restkopier
(§17). **Ingen påstand om, at DRESSED kan slette data, det ikke ejer.**

---

## 17. Third-Party / AI Data Questions

| Processor | Hvad sendes | Hvorfor | Opbevarer? | Retention konfigurerbar? | Sletning anmodet? | DPA? |
|---|---|---|---|---|---|---|
| **Supabase** (Auth/DB/Storage, `GLOBAL_SUPABASE_URL`) | alle persondata (konto, DB, private filer) | kerneydelse | ja (hosted) | **Requires provider/legal verification** | via konto-sletning (DB+storage); backup-periode = §21 | **Requires legal verification** |
| **OpenAI** (`api.openai.com`, model `gpt-image-2.5-sunburst`) | kildefoto, tøjfoto, basisform-lag + tekstprompts (`dress_model_with_openai`, `create_dressed_image`, `personal-model`) | AI-generering af figur/dress | **ukendt — verifieres** (API-data-brugsindstillinger, zero-data-retention) | måske (via OpenAI-organisation) | ukendt | **Requires legal verification** |
| **FASHN via HuggingFace Space** (`fashn-ai-fashn-vton-1-5.hf.space`) | kildefoto + tøjfoto (`fashn-space.ts`) | try-on | ukendt (Space-kørsel) | ukendt | ukendt | **Requires legal verification** — **og bemærk: inaktiv i dag (0 klient-referencer); tages den i brug, kræver den forudgående vurdering** |
| **Netlify** (hosting + background functions + funktion-logs) | hele den server-behandlede strøm (fotos i hukommelse, kode, logs) | drift | ja (logs) | ukendt | via leverandøren | **Requires legal verification** |
| **Google Fonts** (`fonts.googleapis.com`, `global.css:1`) | **IP + User-Agent** for hver sidevisning | skrifttyper | Google | nej | nej (per-besøg) | **SF5 — anbefaling: selv-hosting** |
| **Fremtidige 3D-udbydere (ComfyUI/three.js m.fl.)** | endnu ikke valgt | 3D-fase | ukendt | ukendt | ukendt | **Inden brug: §21-spørgeskema samme format** |

**Regel for dette projekt:** *der hævdes intet om udbyderne, der ikke er
verificeret.* Alle "ukendt"-felter er bevidst markeret
**"Requires provider/legal verification"**. Især OpenAI + FASHN skal afklares
**før** produktion med rigtige brugerfotos.

---

## 18. Future 3D Security Model

**Hverken 3D eller clothing navigation implementeres her** — kun
ejerskabs-arkitekturen, som 3D skal bygges på (baseline A4-strategien):

| Klasse | Ressourcer | Ejerskabsmekanisme | Regler |
|---|---|---|---|
| **GLOBAL DELT** | kanonisk DRESSED-krop, basisformer, fælles hårfiler, fælles 3D-tøjassets, delte teksturer | egen bucket eller `{global}/`-præfiks med **rolle-orienteret** read (aldrig `auth.uid()`) | **må aldrig** ved et uheld blive privat (ingen `user_id`-kolonne, ingen auto-sletning ved bruger-sletning) |
| **BRUGER-EJET** | personfotos, AI-model, garderobe, outfits, **fremtidige private 3D-assets, hårkopier** | `auth.uid() = user_id` i DB + `{userId}/` i storage + JWT i API | **må aldrig** blive delt/offentlig (intet `public=true`, ingen universal-policy) |
| **TVILLING-HÅR** (3D-analysen H2) | bruger-ejet hårfil med dele-URL som **selvstændigt bevidst valg** | privat `{uid}/` som standard | dele-URL = bearer (jf. §11), tidsbegrænses |
| **AI-JOBS** (H3) | ydre arbejdere låser `jobUserIsValid(user.id)` | token-som-kontrakt | intet privilegium ud over brugerens egen session |

**De to ulykkelser afvises strukturelt:** (a) *delt → privat:* ingen delt
ressource får `user_id`-kolonne eller bruger-specifik sti; (b) *privat → delt:*
ingen privat ressource får `public=true` eller en læs-for-alles policy.
**3D-strategien (B-beslutning):** delt bedømmelses-asset-pool i en **fælles
bucket i stedet for** at flytte private `{uid}/`-filer — samme ejerskabskontrakt.

---

## 19. Manual Security Test Matrix (to rigtige konti)

> **Ærlighed:** ingen af disse test er kørt herfra (intet live-Supabase- eller
> browser-adgang i dette miljø). **ACTUAL = "ikke kørt"**, **RESULTAT = PENDING**
> indtil nogen kører dem. Koden er kode-verificeret (§2–§13), men **kode er
> ikke test**.

### A. Signup / password flow

| # | ACTION | EXPECTED | ACTUAL | RESULT |
|---|---|---|---|---|
| A1 | Tilmeld med gyldig e-mail + kode + bekræftelse | konto oprettet; evt. e-mail-verifikation | ikke kørt | PENDING |
| A2 | Tilmeld med **forskellige** koder | **ingen** forespørgsel; "PASSWORDS DO NOT MATCH." | kode-gennemgået (blokerer før `signUp`) | PENDING |
| A3 | Show/hide på hver knap uafhængigt | hvert felt skifter selvstændigt; `aria-pressed` opdateres | kode-gennemgået | PENDING |
| A4 | Tab + Enter | synligt fokus; Enter submitter | kode-gennemgået | PENDING |
| A5 | Inspektér netværk under signup | `password` sendes **kun** til Supabase `grant_type=password` | kode-gennemgået | PENDING |
| A6 | Login med ny konto | korrekt session, redirect `/profile` | ikke kørt | PENDING |

### B. Login / session

| # | ACTION | EXPECTED | ACTUAL | RESULT |
|---|---|---|---|---|
| B1 | Login med forkert kode | generisk fejl, ingen differentiering | kode-gennemgået | PENDING |
| B2 | Slet session-lokalt → `/profile` | redirect `/login?reason=session`; ingen data | ikke kørt | PENDING |
| B3 | Udløbet/manipuleret token | API 401; ingen data vises | ikke kørt | PENDING |
| B4 | Uden login åbn `/profile`, `/wardrobe` | redirect `/login`; **ingen** privat DOM | kode-gennemgået | PENDING |

### C. A↔B isolation (kernen)

| # | ACTION | EXPECTED | ACTUAL | RESULT |
|---|---|---|---|---|
| C1 | Som B: `GET /api/wardrobe/items/{As-id}` | **404** | ikke kørt | PENDING |
| C2 | Som B: `PATCH` As item-id (placement) | 404 + A's række **urørt** (verificér som A) | ikke kørt | PENDING |
| C3 | Som B: `DELETE` As outfit-id | 404 + A's outfit findes stadig | ikke kørt | PENDING |
| C4 | Som B: `GET /api/ai/characters/{As-character-id}` | **404** | ikke kørt | PENDING |
| C5 | Som B: hent As profil via ethvert kald | kun B's egne felter (`null`/tomt) | ikke kørt | PENDING |
| C6 | Som B: `createSignedUrl(A's model_path)` | afvist efter migration (SF2); **kan ikke aflæses før** | ikke kørt | PENDING |
| C7 | Som B: genbrug af A's **signerede URL** | lykkes indtil udløb (forventet — bearer-semantik, §11) | ikke kørt | PENDING |
| C8 | Som B: `POST /api/account/delete` med `userId: A` | **kun B slettes**; A intakt | ikke kørt | PENDING |
| C9 | Som B: `rpc(get_ai_usage_metrics,[A-id])` | `authorized:false` | ikke kørt | PENDING |
| C10 | Kør C1–C9 **i begge retninger** (B→A også) | samme forventninger | ikke kørt | PENDING |

### D. Sletning

| # | ACTION | EXPECTED | ACTUAL | RESULT |
|---|---|---|---|---|
| D1 | Bekræftelsestrin **uden** det korrekte ord | knap forbliver inaktiv | kode-gennemgået | PENDING |
| D2 | Endelig sletning | DB væk, storage `{uid}/` tom, auth-user væk, `authDeleted === true` | ikke kørt | PENDING |
| D3 | Log ind med samme konto bagefter | afvist (konto findes ikke) | ikke kørt | PENDING |
| D4 | Registrér ny konto med samme e-mail | **tom konto**, ingen demo-data (del 12) | ikke kørt | PENDING |
| D5 | Delvis storage-fejl (simulér) | `502` + advarsel, **ingen** falsk succes | ikke kørt | PENDING |

### E. Logout + tilbage/frem-navigation

| # | ACTION | EXPECTED | ACTUAL | RESULT |
|---|---|---|---|---|
| E1 | Log ud | session + DRESSED-nøgler fjernet, redirect `/login` | kode-gennemgået | PENDING |
| E2 | Log ind som B på **samme** browser | **ren konto** (intet As garderode/foto/figur) | ikke kørt | PENDING |
| E3 | Efter logout tryk **Tilbage** | `pageshow`-guard → `/login`; **ingen** As-DOM (SF1-fix) | ikke kørt | PENDING |
| E4 | Logget ind → Tilbage/Frem | side forbliver (ingen unødvendig redirect) | ikke kørt | PENDING |
| E5 | `/closet` efter logout + Tilbage | grid erstattes med log-in/tom-tilstand (soft-guard) | ikke kørt | PENDING |

### F. Tom konto + private images

| # | ACTION | EXPECTED | ACTUAL | RESULT |
|---|---|---|---|---|
| F1 | Ny konto → `/profile` | 0 items, 0 outfits, tom model, intet kildefoto | kode-gennemgået (ingen seed-data i repoet) | PENDING |
| F2 | Ny konto → `/wardrobe` + `/closet` | 0 items, korrekt tomme beskeder | kode-gennemgået | PENDING |
| F3 | Netværk-log for ny konto | **ingen** forespørgsler med fremmede id'er | ikke kørt | PENDING |
| F4 | Kontrollér at **intet** privat billede bruger `getPublicUrl` | alle private billeder via signerede URLs (1 t) | grep-verificeret | PENDING (live) |
| F5 | Efter `202610070001`: `pg_policies`-SQL (§10) | 3 profiles + base-form-read + 8 owner-folder-policyer | ikke kørt (SF2) | PENDING |

---

## 20. Remaining Risks

| # | Risiko | Sværhedsgrad | Status / mindste sikre fix |
|---|---|---|---|
| **R1** | **SF2:** migration `202610070001` **ikke anvendt** ⇒ `profiles`- og storage-ejerskab lever kun som fil; live kan være åben for alle autentificerede | **Høj** | *Fix:* anvend filen i SQL-editoren + kør §10 og test F5 i §19. **Ingen kodeændring kræves.** |
| **R2** | **SF3:** alle isolationstest er ukørte | **Høj** (bevisførelse) | Kør §19 C1–C10 |
| **R3** | **SF1 (rettet):** bfcache kunne vise privat DOM efter logout | Mellem (rettet) | `pageshow`-guards i 3 sider; bekræft med §19 E3–E5 |
| **R4** | **base-forms = global i en privat bucket** (`0010` gap): universal read tilføjet, men filerne lever i bucket-opfyldt af brugerstier | Mellem | *Mindste fix (befales):* flyt/spejl base-forms til `shared-assets`-bucket (global) og signer dem; eller tilføj server-proxy. **Fase:** før 3D (beregning kan ikke afkodes via privat URL) |
| **R5** | Adgangstoken er gyldigt indtil naturligt udløb (~1 t) efter `signOut` (JWT) | Lav–Mellem | *Kan ikke fjernes rent fra klienten*; overvej Supabase token-revocation/short-lived tokens (dashboard-afklaring) |
| **R6** | **SF7:** base64-foto (`closet-source-photo`, `dressed-character`) ligger i brugerens browser indtil logout | Mellem (privat) | Ryd ved logout ✓; **produktvalg** om overhovedet at gemme (§21) |
| **R7** | **SF5:** Google Fonts sender IP til Google | Lav (privat) | *Mindste fix:* selv-host de 3 skrifttyper (`@font-face` i `global.css`) — **anbefalet, ikke implementeret** (scopevalg) |
| **R8** | **SF6:** FASHN-hvis den aktiveres sender foto til offentlig HF-Space; i dag **inaktiv** | Høj hvis aktiveret | **Hold inaktiv** indtil §21-afklaring; overvej egen CF/vertikal VTON |
| **R9** | `.env` indeholder dublerede `PUBLIC_SUPABASE_*`-nøgler | Lav (hygiejne) | Ryd op ved næste deploy; **ikke** gjort (kunne påvirke drift) |
| **R10** | Præ-eksisterende `items/[id]`-service-mønster med `eq(user_id)` (filterglem risiko ved fremtidig ændring) | Lav | RLS = net; regel: **aldrig** fjerne begge lag |
| **R11** | **`getPublicUrl`/HTML-cache:** private billeder serveres aldrig via offentlige URLs, men **HTML-siderne** kan cache's af browserens back/forward-cache | Lav (dækket af SF1) | Alternativt `Cache-Control: no-store` på de 3 beskyttede sider via Netlify `_headers` — *valgfri forstærkning, ikke implementeret* |

---

## 21. Required Legal / Product Decisions

> **Disse er ikke tekniske — de må ikke besvares af koden.**

1. **Retsgrundlag for behandlingen (art. 6) — og om foto af person udgør
   biometri/andres særlige kategorier (art. 9):** kildefoto, garderobe og
   AI-genereret figur. **Ikke afgjort her; ikke antaget.**
2. **Retentionsperiode pr. datatype (art. 5.1.e):** alle rækker i §16 er
   *"Product/legal decision required."* (konto, fotos, AI-resultater, logs,
   backups).
3. **Databehandleraftaler (DPA) + underdatabehandlere:** Supabase, OpenAI,
   Netlify, (FASHN/HF hvis aktiveret) — *Requires legal verification.*
4. **AI-udbydernes datapolitik** (træning/zero-retention/zap-log): *Requires
   provider/legal verification* — **før** produktion med rigtige fotos.
5. **Lagringssted/region:** Supabase- og Netlify-region er ukendt fra repoet —
   *Requires provider/legal verification.*
6. **Eksport-/adgangsfunktion (art. 15):** *"GDPR access/export feature not
   yet implemented."* — skal besluttes, om og hvornår den bygges.
7. **Lokal cache (SF7):** fjern base64-lokalfoto-cachen eller beholde
   funktionaliteten? (dataminimering vs. offline-fallback).
8. **Google Fonts (SF5):** selv-host? (billigt, men er en ændring).
9. **SF6:** aktiveres FASHN-try-on? Med hvilken aftale — eller udskift udbyder?
10. **Privatlivsside:** udgivelses-/inaktiveringsside (privacy policy, cookie-/tekstpligt)
    findes ikke i appen — **produkt/juridisk**.
11. **Dokumentation af dele-synlighed** (basisformer, dele-URLs, 3D-pool):
    fastlæg skriftligt, hvilke ressourcer der *skal* være globale.

---

## 22. Final Readiness Gate

**Regler:** *PASS* = kun hvis både kode og (hvor nødvendigt) live-verifikation
foreligger. Ingen vare er PASS alene fordi "koden ser rimelig ud".
**NEEDS TEST** = implementeret, men kræver rigtig Supabase/browser ·
**NEEDS FIX** = konkret mangel · **LEGAL/PRODUCT DECISION REQUIRED** = kan ikke
løses teknisk.

| # | Område | Status | Bevis / hvad der mangler |
|---|---|---|---|
| 1 | **AUTHENTICATION** | **NEEDS TEST** | JWT-vejen kode-verificeret (`getUser` server-side i alle ruter); e-mailverification/lockout = dashboard-ukendt → §19 A–B |
| 2 | **LOGIN** | **NEEDS TEST** | Generiske fejl, ingen localStorage-auth ✓ i kode; live B1–B3 mangler |
| 3 | **SIGNUP** | **NEEDS TEST** | Alle specificerede krav er **kode-verificerede** (mismatch blokerer før `signUp`, uafhængige toggles, `new-password`, ingen logging/lagring) — men en rigtig Supabase-tilmelding er ikke kørt herfra → §19 A1/A6 |
| 4 | **SESSION** | **NEEDS TEST** | 401-håndtering + guards ✓ i kode; udløb/refresh kræver live B2–B3 |
| 5 | **LOGOUT** | **NEEDS TEST** | `signOut` + DRESSED-state-rydning ✓ i kode; live E1–E2 + revocations-semantik (R5) |
| 6 | **PROTECTED DASHBOARD** | **NEEDS TEST** | Hard-guard + bfcache-fix ✓ i kode; live B4/E3–E4 |
| 7 | **WARDROBE AUTHORIZATION** | **NEEDS TEST** | Alle operationer `eq(user_id)` ✓ i kode; IDOR-bevis = §19 C1–C3/C10 |
| 8 | **API AUTHORIZATION** | **NEEDS TEST** | 16/16 routes: JWT + ejerskab ✓ i kode; live §19 C mangler |
| 9 | **DATABASE RLS** | **NEEDS TEST** | `202610070001` **er ikke anvendt** (SF2) → anvend + `pg_policies` (§10) + §19 F5 |
| 10 | **STORAGE ISOLATION** | **NEEDS TEST** | Samme migration har de 8 owner-folder-policyer; privat-læsning **ukendt** indtil da (SF2) |
| 11 | **ACCOUNT DELETION** | **NEEDS TEST** | Implementeret (DB → Storage → Auth, ærlige delvise fejl) ✓; live D1–D5 |
| 12 | **EMPTY NEW ACCOUNTS** | **NEEDS TEST** | Ingen seed/demo-data i repoet ✓; profil-trigger på signup **ukendt** (baseline F3) → live F1–F2 |
| 13 | **CLIENT-STATE ISOLATION** | **NEEDS TEST** | Rydning + bfcache-guards ✓ i kode; live E2/E3/E5 |
| 14 | **GDPR TECHNICAL FOUNDATIONS** | **LEGAL/PRODUCT DECISION REQUIRED** | Tekniske lag findes (isolation, sletning, no-store, private buckets, dokumentation), men **ingen retentionsperioder, ingen eksport, intet fastlagt retsgrundlag, ingen DPA-verifikation** → §21 (1–6) |
| 15 | **FUTURE 3D DATA ISOLATION** | **PASS** | *Design-gennemgang:* der findes endnu ingen 3D-data, og kontrakten (global vs. `{userId}/`, §18) afviser begge forvekslinger; **betinget** af at 3D respekterer den, og at SF2/R4 løses først |

**SAMLET READINESS: IKKE KLAR TIL 3D — to høj-risiko-hindringer:**

1. **SF2/R1:** anvend `supabase/migrations/202610070001_account_security_and_user_isolation.sql`
   i Supabase SQL-editoren, og verificér med `pg_policies`-SQL'en i §10.
2. **SF3/R2:** kør testmatrix §19 med to rigtige konti (især **C1–C10** i
   begge retninger, D1–D5, E1–E5, F1–F5).

Derefter: §21's juridiske/produktvalg (mindst 1–4) **før produktion med
rigtige brugerfotos**, og R4 (base-forms) før 3D-beregningen skal bruge dem.

---

## Appendix — Ændringer foretaget i denne runde (komplet)

| Fil | Ændring | Type |
|---|---|---|
| `src/pages/profile.astro` | `pageshow`-genkald af `checkProfileSession()` ved bfcache-restore | tilføjelse (SF1) |
| `src/pages/wardrobe.astro` | `pageshow`-genkald af `checkWardrobeSession()` | tilføjelse (SF1) |
| `src/pages/closet.astro` | `pageshow`: kun session-tjek ved bfcache — logget ud ⇒ grid erstattes; logget ind ⇒ intet gen-renderes (bevarer valg) | tilføjelse (SF1) |
| `analysis/dressed-auth-security-gdpr-audit.md` | denne rapport | dokument |

**Ikke rørt (bekræftet):** alle migrations (inkl. `202610070001`, der blot
ligger klar), alle API-ruter, signup/login/logout-flowet (bevaret fra tidligere
runder), X/Y-scaling, placement, drag/pinch/wheel/tap, saved outfits, AI, begge
3D-analyser, `docs/*`, dependencies og git-historik (**ingen
commit/push/merge/rebase/reset/stash/checkout**).

**Validering:** `npm run build` → **Complete** · `npx tsc --noEmit` →
**0 fejl i ændrede filer** (12 præ-eksisterende i urørte filer) ·
`git status --short` → kun de forventede analyse-/konto-filer.













