# DRESSED — AUTH & SQL ARCHITECTURE ANALYSIS

> ANALYSE KUN. Ingen SQL skrives/migreres/ændres. Ingen production code, API,
> RLS, storage, config eller eksisterende docs røres. Formål: godkendelsesgrundlag
> for det senere login-/bruger-adgangs-SQL.
>
> **Klassifikation bruges konsekvent:**
> **Confirmed** = direkte dokumenteret i repo/migrations/kode i denne session.
> **Inferred** = logisk konklusion fra dokumenterede fakta.
> **Unverified** = kan kun bekræftes ved live-databaseinspection.

---

## 1. PROJEKTKONTEKST

DRESSED: webapp med PROFILE, CLOSET, DRESSED (virtual fitting room), personlige
modeller/characters, uploaded clothing, AI-ready clothing, placement, saved
outfits — oven på Supabase (Auth + Postgres/RLS + Storage), server-side API-ruter,
AI-genereringsjobs og kvoter. Alle data er user-owned.

**Læst før denne analyse:** `docs/DRESSED-PROJECT-SPECIFICATION.md`,
`docs/DRESSED-CODEBASE-OVERVIEW.md`, `docs/DRESSED-ASSETS-AND-MEDIA.md`,
`analysis/DRESSED-CURRENT-STATUS.md`, `analysis/DRESSED-SQL-MIGRATIONS-ANALYSIS.md`
(hele14 migrations læst linje-for-linje i denne session),
`analysis/DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md`, samt faktisk auth-kode:
`src/lib/server/supabase.ts` (fuldt), `src/pages/{login,signup}.astro` (auth-flow),
RPC-/grant-delen af alle migrations.

## 2. MÅLET

Senere bygges hele login-systemet i SQL — men SQL'en skal passe præcist til
DRESSED's arkitektur. Denne analyse dækker (jf. opgavelisten):
identifikation, authentication, Supabase Auth-brug, kobling til `auth.users`,
user-owned vs. character-owned tabeller, privat vs. delt data, RLS, API-ejerskab,
login-flowets betydning for hele DRESSED, nye brugere, sletning (inkl. data),
sessioner, unauthorized handling, AI-kvoter, storage, fremtidige features,
trusselmodel (#20), Astro-integration (#21), anbefalet DB-arkitektur (#22),
migrationsstrategi (#23), eksisterende SQL-fejl (#24) — alt med
Confirmed/Inferred/Unverified-mærkning.

---

## 3. AUTHENTICATION VS. APPLICATION USER

### Supabase Auth user (`auth.users`) — CONFIRMED (platform)
Ejer: **kun Supabase Auth**. Indeholder: e-mail, password-hash, `raw_user_meta_data`,
`app_metadata`, tokens, `created_at`. **Må aldrig** direkte udvides af
application-kode, og application-tabeller må aldrig kopiere adgangskoder/tokens.

**I dag (Confirmed):** `signup.astro:149–157` kalder
`supabase.auth.signUp({…, options: { data: { name, gender } }})` ⇒ **navn og køn
ligger i `raw_user_meta_data`** på auth-brugeren. `login.astro:128` bruger
`signInWithPassword` → redirect `/profile`.

### DRESSED application user (`profiles`) — DELVIS CONFIRMED / DELVIS UNVERIFIED
- `profiles` **oprettes ikke af nogen migration i repoet** (Confirmed — kun
  `alter table profiles add column gender` i0001). `DRESSED-SUPABASE-ANALYSIS.txt:87`
  konstaterer: CREATE TABLE, RLS og en eventuel **auth trigger for `profiles` er
  IKKE i version control** → **Unverified** hvordan rækken oprettes i live
  (sandsynligst: trigger på `auth.users`-insert der læser metadata — Inferred).
- Kendte kolonner (Confirmed via0001 + kode-brug): `user_id` (PK antages — Inferred),
  `gender` (`CHECK ∈ {woman,man}`, DO-guardet i0001:8–21) + **lock-trigger**
  `profiles_gender_is_locked` (0001:23–39: køn kan ikke ændres efter første sætning),
  `source_photo_path`, `model_photo_path`, `model_generation_status`
  (eksisterede før repoet, jf.0001:3).

### Anbefalet model (til godkendelse)
```text
profiles (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,  -- 1:1
  name     text,                       -- fra signup-metadata (kopi, præsentation)
  gender   text CHECK (gender IN ('woman','man')),   -- låst efter første sætning
  source_photo_path text, model_photo_path text, model_generation_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
```
- **1:1 via PK på `user_id`** (unik er indeholdt i PK) + **`ON DELETE CASCADE`**
  (sletning af auth-bruger rydder profilen).
- **I auth (metadata):** kun det Supabase skal bruge (navn/køn som
  signup-signatur, `app_metadata.is_owner` til kvote-fritagelse — kun
  service-rollen kan skrive det, jf.0015:18).
- **ALDRIG i application-tabeller:** e-mail-adgangskoder, refresh-tokens,
  service-nøgler, betalingsdata (fremtidigt).
- **Tidsstempler:** `created_at/updated_at` på profiles (opdateret af application).

---

## 4. BRUGERENS DATAEJERSKAB (komplet gennemgang)

**Grundregel:** ejerskab altid via `user_id = auth.uid()`; identitet altid via
`auth.users.id`. Alle brugerdata er **private** (se §15).

| Data | Ejer-ID | FK (nuværende, Confirmed) | Privat? | Auto-slet? | Bemærkning |
|---|---|---|---|---|---|
| **profile** (`profiles`) | `user_id` | **ikke i VC (Unverified)** — anbefales: → `auth.users` CASCADE | ja | bør (anbefales CASCADE) |1:1 med auth-bruger |
| **wardrobe items** | `user_id` | `→ auth.users ON DELETE CASCADE` (0001:170) | ja | ja | PK `(user_id,id)`; `id` er **text** (client-genereret) |
| **clothing images** (Storage) | sti-præfix `{user_id}/` | CHECKs på path-kolonner (0001:183–184, 0002, 0005) | ja | **NEJ — storage cascade'er ikke med DB; filer bliver forældeløse ved bruger-sletning (Confirmed struktur)** | kræver rense-job (§11) |
| **AI-ready state** (`wardrobe_item_ai_assets`) | `user_id` | `→ auth.users CASCADE` (0010:32) + `(user_id,item_id) → wardrobe_items CASCADE` | ja | ja | PK `(user_id,item_id,base_type)`; `generation_version>0` (current=3) |
| **AI-ready legacy** (`…_legacy`) | `user_id` | **ingen direkte FK til auth.users** (0002:31–47) — cascade **indirekte** via `wardrobe_items` (Inferred) | ja | delvis | bevaret historik |
| **personal models / characters** (`dressed_characters`) | `user_id` | `→ auth.users CASCADE` (0001:42) | ja | ja | PK `(user_id,id)`; unikt primary pr. bruger; `geometry_contract_version` |
| **saved outfits** | `user_id` | **MANGLENDE FK (F9)** + `(user_id,character_id) → dressed_characters CASCADE` (0012:31–33) | ja | ja **via character-cascade** (Inferred) | `item_ids text[]` = **kun værdier, ingen FK** |
| **outfit items** | *(ikke selvstændig tabel)* | udtrykkes af `saved_dressed_outfits.item_ids text[]` | ja | ja | ejerskab kontrolleres i RPC'en (0014:61–72) |
| **placement** | via `wardrobe_items.user_id` | kolonne på `wardrobe_items` (`jsonb NULL`) | ja | ja (følger item) | tilhører **`wardrobe_items.id`**, aldrig outfit |
| **AI results** (`wardrobe_results`) | `user_id` | `→ auth.users CASCADE` (0001:217) + optional FK (0010) | ja | ja | `item_ids text[]1–5` |
| **AI usage** (`ai_generation_usage`) | `user_id` | `→ auth.users CASCADE` (0001:258) | ja | ja | PK `(user_id,generation_type)` |
| **quota limits** | global | — | **delt** (alle læser) | nej | seed +0015-opdatering |
| **quota overrides** | `user_id` | `→ auth.users CASCADE` (202610050001:17) | **helt privat** (0 policies) | ja | kun service-role læser |
| **storage objects** | `{user_id}/…`-stier | path-CHECKs + storage-RLS (upload-policies mangler i VC — F4) | ja | **NEJ** (se ovenfor) | signerede URLs,60 min |
| **future user settings** | `user_id` | anbefales `→ auth.users CASCADE` | ja | ja | samme skabelon som øvrige |

### user_id vs. character_id (KRITISK)
- **`user_id` = EJERSKAB** (hvem må læse/skrive/slette). Bruges i **ALLE**
  policies og i **ALLE** explicit-equals i API'erne. Findes på alle brugerdata.
- **`character_id` = INDHOLDS-BINDING** (hvilken model/geometri en række hører
  til: results, outfits, historiske assets). Bruges **kun** som FK-cascade +
  indholdssporing — **aldrig som autoriseringsnøgle alene**.
- Konsekvens: `save_dressed_outfit` og `delete_dressed_character` verificerer
  **begge** `user_id = auth.uid()` først og bruger kun character til cascading
  oprydning (Confirmed0014:50–56,0010:120–125).

---

## 5. RLS — ROW LEVEL SECURITY (sammenhængende sikkerhedsmodel)

**Princip:** RLS er den egentlige mur (browseren KAN tale direkte til PostgREST
med anon-nøglen — så policies, ikke API-kode, er det sidste forsvar). Én ensartet
ejerskabs-linje på tværs:

```sql
-- GRUNDMØNSTER (Pattern A: simpel ejer-tabel)
using ((select auth.uid()) = user_id)          -- SELECT/UPDATE/DELETE
with check ((select auth.uid()) = user_id)     -- INSERT/UPDATE
```

### 5.1 Operations-matrix pr. tabel (Confirmed fra migrations)

| Tabel | SELECT | INSERT | UPDATE | DELETE | Særligt |
|---|---|---|---|---|---|
| `wardrobe_items` | egne | egne + **path-WITH-CHECK** | egne + **path-WITH-CHECK** | egne | **se F3, §24** |
| `wardrobe_results` | egne | egne + path-CHECK | **ingen policy** | egne | negativ default; appen opdaterer aldrig ✓ |
| `dressed_characters` | egne | kun definer-RPC | kun definer-RPC | kun definer-RPC | grants: kun select |
| `wardrobe_item_ai_assets` (aktiv) | egne | **kun service_role** | **kun service_role** | egne | Pattern B |
| `…_assets_legacy` | egne | egne (policy fulgte tabellen) | egne | egne | koden læser kun |
| `saved_dressed_outfits` | egne | kun RPC | **ingen policy** | egne | Pattern C |
| `ai_generation_limits` | **alle (using true)** | — | — | — | delt reference |
| `ai_generation_usage` | egne | kun reserve/finish | kun funktioner | — | |
| `ai_generation_limit_overrides` | **0 policies = deny-all** | — | — | — | + revoke; kun service-role |
| `dressed_base_forms` | alle (using true) | — | — | — | read-only reference |
| `profiles` | **ikke i VC (Unverified)** | ? | ? | ? | **anbefales: egne, alle operationer** (§3) |
| `storage.objects` | base-form-filer (0010:91–101); **upload-policies mangler (F4)** | ? | ? | ? | se §13 |

### 5.2 De tre patterns (sammenhængende model)
- **Pattern A** (RLS skriver): wardrobe_items, wardrobe_results.
- **Pattern B** (kun service skriver): `wardrobe_item_ai_assets` (aktiv).
- **Pattern C** (kun SECURITY DEFINER-funktioner skriver): characters, outfits,
  quota — funktionerne laver selv `auth.uid()`-ejertjek og kører med
  `set search_path = ''`.
- **Service-rolle-fravalg som udgangspunkt:** kun præcis de steder hvor RLS er i
  vejen (placement-UPDATE, `finish_*_server`, asset-skrivning, storage-signering,
  override-læsning) — **altid efterfulgt af explicit `user_id`-filter**
  (Confirmed `[id].ts:200–205`).
- **Fælles regel for nye tabeller (anbefaling):** `enable row level security`
  + default-deny + mindst ét mønster A-policy eller bevidst negativ default,
  + `revoke all … from anon` (undtagen læse-referencer der skal virke for
  indloggede: limits/base-forms).

---

## 6. SERVICE-ROLLE OG DEFINER-FUNKTIONER

**Service-rolle bruges kun (Confirmed fra kode + migrations):**
1. `PATCH /api/wardrobe/items/[id]` → placement-UPDATE med explicit
   `user_id`+`id`-filtre (ejerskab fra JWT).
2. `finish_clothing_ai_generation_server` / `finish_ai_generation_server` —
   **SQL-guard `auth.role() = 'service_role'`** (0011:17,0016:20) + token-match.
3. AI-assets-skrivning (grants på `wardrobe_item_ai_assets`,0010:62).
4. Storage-signering af URLs + background-job-adgang.
5. Læsning af `ai_generation_limit_overrides` (deny-all for brugere).
6. `set-owner.mjs`-lignende admin-operationer (auth `app_metadata`).

**SECURITY DEFINER-funktioner** (alle med `set search_path = ''`, `revoke` fra
`public/anon`, `grant` til `authenticated` eller `service_role`):
`publish_dressed_character`, `set_primary_dressed_character`,
`delete_dressed_character`, `save_dressed_outfit`, `reserve_ai_generation`,
`reserve_clothing_ai_generation`, `finish_ai_generation` (klient — historisk),
`get_ai_generation_usage`, `finish_*_server` (kun service), trigger-funktioner
(`prevent_profile_gender_change`, `remove_saved_outfits_for_deleted_item`).
**Regel:** funktioner må kun skrive, når de selv kan verificere
`auth.uid()` (eller service-rollen) — de stoler aldrig på argumenter om ejerskab.

---

## 7. API OWNERSHIP (server-side)

**Model (Confirmed — alle11 ruter):**
1. `authenticateSupabaseRequest(request)` (`lib/server/supabase.ts:37–90`):
   regex `Bearer` → anon-client med token som global header →
   **`client.auth.getUser(accessToken)`** validerer mod Supabase → `{client, user}`.
   Fejl: **401** ("A valid sign-in is required.") eller **503** (ikke konfigureret).
2. **Authorization = explicit ejerskab:** hver operation filtrerer
   `.eq("user_id", user.id).eq("id", …)` (eller RPC'en gør det selv).
   **Client-supplied user-id ignoreres altid** — `user.id` kommer af JWT'et.
3. ID-validering: `params.id` er string med `length ≤100` (400 ellers).
4. Svar-semantik: **401** = ikke logget ind; **400** = ugyldigt input;
   **404** = "findes ikke for denne bruger" (aktivt valgt for at undgå
   eksistens-læk — samme svar for fremmed og ikke-eksisterende id);
   **5xx** = server/DB-fejl (detaljer KUN i serverlog).
5. RLS-lager sekundært: selvom filtrerne svigter, afviser RLS (også via
   anon-clienten, fordi den bærer brugerens token).

**API-må ikke:** stole på client-autorisation, returnere DB-fejl-koder til
klienten, oprette/slette på vegne af et client-angivet user-id.

---

## 8. UNAUTHORIZED ACCESS — håndtering

| Situation | Påkrævet svar | Eksisterende status |
|---|---|---|
| Ingen/manglende Bearer-token | 401 | Confirmed (`supabase.ts:54–60`) |
| Ugyldig/expired token | 401 | Confirmed (`getUser`-fejl, `:77–83`) |
| Ikke-konfigureret server | 503 | Confirmed (`:43–49`) |
| Eksisterer men ikke ejet | 404 (ikke403) | Confirmed (PATCH `:212–214`, DELETE-items) |
| Ugyldigt input | 400 | Confirmed (PATCH/POST-validering) |
| DB/RLS-afvisning (uventet) | generisk 5xx; **fejlcode kun i log** | Confirmed — kendt debuggning-brist (dokumenteret, ikke rettet) |
| Kald til RPC uden adgang | PostgREST-fejl → API oversætter til 5xx/401 | Inferred |

---

---

## 9. SESSIONER & TOKEN-HÅNDTERING

- **Browser:** `@supabase/supabase-js` opretter/vedligeholder sessionen
  (client-side persistence, token-refresh); `login.astro` redirect efter
  `signInWithPassword`; `signup.astro` redirect ved `data.session`
  (Confirmed `:186–189`), ellers "bekræft e-mail før login".
- **API:** **udelukkende Bearer-JWT pr. request** — ingen server-cookie (Confirmed;
  `authorization`-header er eneste spor i alle ruter/kald).
- **Service-klienten:** `persistSession:false`, `autoRefreshToken:false`
  (Confirmed `:29–33`) — ren maskin-klient, aldrig bundlet til browseren.
- **Anbefaling (til godkendelse):** behold Bearer-modellen (simplest, teste­ligt,
  matcher Astro-arkitekturen uden nye afhængigheder). Side-beskyttelse = lille
  klient-guard der redirecter til `/login` ved ingen session; **API'erne er den
  autoritative beskyttelse**. Cookies/SSR-session kræver `@supabase/ssr` (ny
  dependency) — kun ved særskilt godkendelse.

---

## 10. NY BRUGER (signup → klar til DRESSED)

**I dag (Confirmed `signup.astro:125–196`):**
1. Formular (navn, køn ∈ {woman,man}, e-mail, adgangskode) →
   `supabase.auth.signUp` med `data:{name,gender}` i **user metadata**.
2. Ved `session` → redirect `/profile`; ellers "bekræft e-mail" (email-flow).
3. **Hvordan `profiles`-rækken oprettes findes ikke i repoet** (Confirmed mangler;
   **Unverified** live-mekanisme — sandsynlig trigger på `auth.users` som læser
   metadata: Inferred fra0001's forudsætning om `profiles.gender` + den gamle
   analyses notat om en "auth trigger for profiles" uden for VC).

**Anbefalet flow (til godkendelse):**
```text
signUp(metadata: name, gender)
   → [idempotent] opret profiles-række: ENTFER trigger på auth.users (anbefales,
     DO-guardet, læser new.raw_user_meta_data) ELLER lazy-upsert i profil-API'en
     → RLS: INSERT kun egne rækker (user_id = auth.uid())
   → redirect /profile → profil-scenen opretter model (AI) efter kvote-reservation
```
- Køn låses herefter af `profiles_gender_is_locked` (Confirmed0001-trigger).
- Reservation/præferencer (fremtidigt) hører i profiles, ikke i auth-metadata,
  medmindre Supabase selv skal bruge dem.

## 11. SLETNING AF BRUGER OG DATA-VED-SLETNING

**Cascade-matrix ved `DELETE FROM auth.users` (Confirmed for FK-lag, øvrige noteret):**

| Lag | Adfærd |
|---|---|
| `profiles` | **Unverified** (FK ikke i VC) — anbefales CASCADE |
| `wardrobe_items` | CASCADE (0001:170) → indirekte `…_legacy`-assets (0002 FK) + `saved_dressed_outfits.item_ids`-værdier forbliver kun via character-stien … men outfits slettes via næste linje |
| `dressed_characters` | CASCADE (0001:42) → `saved_dressed_outfits` CASCADE (0012:31–33) + `wardrobe_results` character-FK (0010) + `wardrobe_item_ai_assets` character-FK (0002) |
| `wardrobe_results`, aktiv `…_ai_assets`, `ai_generation_usage`, `ai_generation_limit_overrides` | CASCADE (0001/0010/202610050001) |
| **Storage-filer** | **CASCADEER IKKE (Confirmed struktur)** — `{uid}/…`-filer bliver forældeløse; base-form-filer er globale og må ikke slettes |
| `ai_generation_limits` | global — bevares |

**Eksisterende funktioner (Confirmed):** `delete_dressed_character(uuid)` rydder
karakter-specifikke data (legacy-assets, results, replacement-primary,
profiles.model-state) — men den sletter **ikke** brugeren eller storage-filer.
**Ingen konto-sletning findes i repoet** (Confirmed). `DRESSED-SUPABASE-IMPLEMENTATION-PLAN.txt`
(M0–M6: `account_deletions`, `deleted_emails`, `retained_*`) er **NOT APPLIED**.

**Anbefaling (godkendelse kræves før implementering):**
1. DB-lag: sikr CASCADE på alle brugerdata (inkl. profil-FK + outfits-FK, §24).
2. Storage-lag: service-rolle-rensning af `{uid}/…` ved konto-sletning
   (kaskade findes ikke i Postgres) — enten via admin-API-kald i en godkendt
   slette-flow eller et senere rense-job.
3. Juridiske/retentions-ønsker (deleted_emails m.m.) = særskilt godkendt design.

## 12. AI-GENERATIONER OG KVOTE KOBLET TIL BRUGEREN

- **Binding:** altid `user_id` (+ `generation_type ∈ {character, clothing, tryon}`);
  PK `(user_id, generation_type)` (Confirmed0001).
- **Flow:** `reserve_*` (authenticated RPC; FOR UPDATE-lås;5-minutters
  in-progress; token=`started_at`) → job kører → **kun** `finish_*_server`
  (service-guard + token-match) tæller/credit-backer (Confirmed0008/0011/0016).
- **Limits:** global tabel (seed3/3/3 →0015: **1/3/1**); **Unverified** om live
  er driftet (F6: kommentar hævder3/5/1).
- **Owner-fritagelse:** `app_metadata.is_owner` læst i SQL via `auth.jwt()`
  (Confirmed0015:18) — kun service-rollen kan sætte den.
- **Per-bruger override:** `ai_generation_limit_overrides` (deny-all; seedet
  testrække; Confirmed202610050001).
- **Browseren afslutter aldrig selv en reservation** (klient-`finish_clothing_…`
  er revoked siden0011; Confirmed at koden kalder servervarianterne).
- **Komposition/outfits bruger aldrig kvote** (kun læsning; Confirmed — ingen
  kvote-kald i outfit-flowet).

## 13. STORAGE-SIKKERHED

- **Bucket:** `model-images` (alt: karaktere, tøj-originaler, previews, AI-output,
  base-forms) — bucket-oprettelse **ikke i VC (F4)**.
- **Ejerskab i stier:** `{user_id}/…` håndhæves af CHECK-kolonner i DB
  (`split_part(path,'/',1) = user_id::text`) + `owner_id`-tjek i definer-
  funktionerne (Confirmed0001:86–93) + **anbefales** storage-RLS:
  `storage.foldername(name)[1] = (select auth.uid())::text` for INSERT/DELETE
  (mangler i VC — **Unverified** om det findes live).
- **Læsning:** base-form-filer læses af authenticated (0010:91–101);
  brugerfiler læses via **signerede URLs,60 min, kun server-side** (Confirmed
  `createSignedUrl(…,3600)`).
- **Regel:** browseren får aldrig direkte skriveadgang uden storage-RLS; al upload
  kan enten ske med brugerens token (under egen mappe) eller via server — men
  aldrig uden path-policy.

---

## 14. CONSTRAINTS OG INDEXES (auth-relevante)

**Nuværende (Confirmed):** PK'er `(user_id,id)` fungerer som ejerskabs-indeks på
alle brugerdata; unikt `dressed_characters_one_primary_per_user`;
`unique(user_id,character_id,outfit_key)`; path-CHECKs; køn- og kategori-CHECKs;
placement-CHECK (efter0003); `revoke/grant`-sæt pr. tabel.
**Ingen ikke-unikke indexes findes** (F8).

**Anbefalede (til godkendelse — implementeres IKKE nu):**
- `saved_dressed_outfits(user_id, updated_at desc)` — liste-læsning.
- `wardrobe_items(user_id, created_at desc)` — garderobe-rækkefølge.
- (valgfrit) GIN på `item_ids` hvis outfits/results-skala vokser.
- **FK-forbedringer:** `saved_dressed_outfits.user_id → auth.users CASCADE`
  (F9) og `profiles.user_id → auth.users CASCADE` (når profiles bringes i VC).

## 15. PRIVAT VS. DELT DATA

- **Privat (altid):** alt brugerindhold — profil, items, billeder, characters,
  outfits, placement, results, usage, overrides. (`using`-prædikat = ejer.)
- **Delt (kun læsning):** `ai_generation_limits` (alle indloggede),
  `dressed_base_forms` + base-form-filer i storage (alle indloggede).
- **Aldrig læsbart af anon:** alt andet (`revoke … from anon`).
- **Dele af outfits mellem brugere findes IKKE** i dag — fremtidig sharing vil
  kræve et ekstra read-policy-lag (dokumenteret som fremtidigt, §16), ikke
  ændring af ejerskab.

## 16. FREMTIDIGE FEATURES (byg ovenpå uden at bryde modellen)

- **`user_settings`:** samme skabelon (PK `user_id` → auth CASCADE, RLS egne).
- **Flere karakterer pr. bruger:** allerede understøttet (`is_primary`-partielt
  unikt); policies er user-id-baserede og rører ikke antal.
- **Outfit-sharing:** tilføj `is_public`/`shared_with`-tabeller med særskilte
  SELECT-policies — uden at ændre de eksisterende (Rule: nye policies, ikke
  udskiftning).
- **Konto-eksport/sletning:** byg på service-rolle-admin (auth admin API) +
  DB-cascade + storage-renser (§11); evt. `account_deletions`-mønster fra
  implementeringsplanen (kun efter godkendelse).
- **Øvrige buckets:** samme foldername-policy-mønster som §13.

## 17. LOGIN-FLOWET I DRESSED (end-to-end)

```text
signup/login (client supabase-js) → session i browseren
  → profil: GET/POST /api/* med Bearer → server authenticate → explicit ejerskab
  → upload clothing (POST items) → MAKE AI READY (reserve → job → finish_server)
  → Closet (GET items) → DRESSED (GET items+outfits → browser-komposition)
  → placement: kun ved DONE → PATCH → wardrobe_items.placement
  → SAVE OUTFIT → POST → RPC save_dressed_outfit (ejerskab + version=3)
  → Profile viser samme id'er + samme placement (fælles resolver)
```
Ethvert led afvises med401 ved tabt session (klient opfanger → redirect /login);
ingen del af kæden stoler på andet end JWT + RLS + explicit filtre.

---

## 18. SECRETS OG KONFIGURATION (ansvarslinjer)

| Nøgle | Hvor | Hvem må se den |
|---|---|---|
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | klient + server | alle (den er tænkt til at være kendt — RLS er muren) |
| `SUPABASE_SERVICE_ROLE_KEY` | **kun** server (`lib/server/supabase.ts`) | aldrig bundlet, aldrig logget, aldrig i klient-svar |
| `OPENAI_API_KEY` | kun server (`lib/server/ai/config`) | aldrig klient |
| `BACKGROUND_JOB_SECRET` | kun server (background-jobs) | aldrig klient |
- `.env.example` beskriver navnene; `.env` indeholder kendte dubletter af
  `PUBLIC_SUPABASE_*` (dokumenteret rod, ikke en sikkerhedsfejl).

## 19. ÅBNE SPØRGSMÅL TIL GODKENDELSE

1. **Bringe `profiles` ind i version control?** (anbefalet: JA — guarded
   `create table if not exists` + FK + RLS; spørgsmålet er, om den skal adopteres
   fra live eller genskabes — **Unverified** hvad live har.)
2. **Oprettelsesmekanisme for profiles:** auth-trigger (anbefalet) vs. lazy-upsert?
3. **Rette RLS `WITH CHECK` for `reference_path`?** (F3 — anbefalet rettet som
   `… is null or split_part(…) = …`, men KUN efter godkendelse.)
4. **Tilføje FK på `saved_dressed_outfits.user_id`?** (F9 — anbefalet.)
5. **Storage upload-policies i VC?** (F4 — anbefalet; skal live-eventuelle
   policies først eksporteres for at undgå dobbelt-genskabelse.)
6. **Konto-sletning + storage-renser:** design-godkendelse (§11).
7. **Indeks-valg** (§14) — godkendes som del af den senere migrationspakke.

## 20. THREAT MODEL

| Threat | Mitigation | SQL | API | Frontend |
|---|---|---|---|---|
| Stjålet/lækket JWT | kort levetid + refresh; Bearer-kun | RLS = sidste mur | 401 ved `getUser`-fejl | token kun i hukommelse/lokalt, aldrig i URL |
| Direkte PostgREST med anon-nøglen | **RLS default-deny på alle brugerdata** | policies (§5) | — | anon-nøglen må aldrig bruges til skriv uden token |
| Manipuleret `user_id`/`id` i URL/body | `user.id` afledes af JWT, aldrig af request | FK + RLS | explicit `.eq`-filtre (§7) | sender aldrig user-id |
| Forkerte path-værdier (cross-user storage-sti) | path-CHECKs + (anbefalet) storage foldername-policy | CHECK-kolonner | sti dannes server-side med `user.id` | uploader kun under egen sti |
| Service-nøgle-læk | kun server-variabel; `persistSession:false` | grants kun til service | ingen service-klient i browser-svar | — |
| Kvote-udvidelse | reserve/finish-token + deny-all override-tabel + `app_metadata` kun via service | definer-RPC'er (§6) | klient kan ikke kalde `finish_*_server` | viser kun status via `GET usage` |
| Unauthoriseret eksistens-læk | 404 for både fremmed og ukendt id | RLS | ensartet404 (§8) | fejltekster uden id-oplysninger |
| XSS → data/ctrl | ingen secrets i DOM; JSON-svar | — | korrekt content-type, ingen HTML-JSON | `textContent` til brugerdata (render-disciplin) |
| Client-side "autorisation" (manipuleret UI) | ignoreret | — | server re-verificerer alt | UI er kun kosmetisk |
---

## 21. ASTRO INTEGRATION

(Forankret i `analysis/DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md` — INGEN
React/Vue/Svelte, kun fordi auth ikke kræver det.)

- **Server-side authentication:** alle `/api/*`-ruter kalder
  `authenticateSupabaseRequest` (server-funktion i `lib/server/supabase.ts`) —
  det er Astro's "auth-middleware" (express-style pr. rute, ingen middleware-
  framework nødvendig).
- **Page guards:** statiske/SSR-sider får en **lille klient-guard**
  (`lib/client/auth-guard.ts`: `getSession()` → redirect `/login`); API'erne er
  den autoritative beskyttelse. Astro `middleware.ts` kan tilføjes senere til
  ren redirect-håndtering uden dependencies (valgfrit).
- **Client-side session state:** én `lib/client/auth.ts` (singleton supabase-js
  client + `getSession/onAuthStateChange` + `withAuth()`-hjælper der læser
  access-token og sætter `Authorization` på alle fetch — samme konvention som
  wardrobe-ai/generation-flows i dag).
- **Redirects:** login → `/profile` ved success; tabt session → `/login`;
  beskyttede sider renderer men destruerer data ved401.
- **Server rendering:** det **offentlige** shell serveres af Astro; alle
  auth-scoped data hentes af klienten med Bearer (matcher eksisterende kode og
  undgår `@supabase/ssr`). Hvis SSR-data-engang ønskes: kræver det særskilt
  godkendt cookie-session-design + `@supabase/ssr`.
- **UI vs. auth:** komponenter kender kun `auth.ts`-grænsefladen (isAuthenticated,
  user, signOut) — al auth-logik i modulet, al markup i components, al
  server-tillid i API'en.

---

## 22. RECOMMENDED DATABASE ARCHITECTURE

```text
auth.users                              (Supabase Auth — platform)
   │
   ├── profiles                          [1:1, user_id PK → CASCADE]
   │        ├── gender LOCK (trigger)    [source/model photo paths, status]
   │
   ├── dressed_characters                [PK (user_id,id); is_primary; geometry v1]
   │        ├── wardrobe_item_ai_assets_legacy   (character-FK, historisk)
   │        ├── wardrobe_results        [optional character-FK + item_ids text[]]
   │        └── saved_dressed_outfits   [character-FK CASCADE; item_ids text[];
   │                                     ANBEFALET: user_id-FK (F9)]
   │
   ├── wardrobe_items                    [PK (user_id,id) TEXT; placement jsonb NULL]
   │        ├── wardrobe_item_ai_assets  [PK (user_id,item_id,base_type);
   │        │                             generation_version (=3 current)]
   │        └── (placement tilhører dette id — IKKE outfits)
   │
   ├── ai_generation_usage  ←→  ai_generation_limits   [global, læs-delt]
   ├── ai_generation_limit_overrides     [deny-all; service-role only]
   │
   └── (fremtidig) user_settings         [samme skabelon]
```

**Storage (ikke i diagrammet):** bucket `model-images` — `{user_id}/…`-mapper
(user-private) + `system-reference/base-forms/…` (delt, læs for authenticated).

**Sletningsadfærd:** `ON DELETE CASCADE` fra `auth.users` til AL brugerdata
(bekræftet for alle FK-lag undtagen `profiles` [Unverified] og outfits' `user_id`
[F9 — mangler]); storage cascade'er ikke (§11).

**Indexes:** PK'er som ejerskabs-indekser + de unikke i §14; anbefalede ekstra
i §14 (godkendes særskilt).

---

## 23. SQL MIGRATION STRATEGY (for det senere auth-system)

- **Små logiske migrations** — én ændring pr. fil (f.eks. `…_profiles_to_vc.sql`,
  `…_outfit_user_fk.sql`, `…_storage_upload_policies.sql`, `…_rls_path_check.sql`,
  `…_auth_indexes.sql`), tydelige navne med timestamp-præfiks som nuværende.
- **Rækkefølge:** tabeller (og kolonner) → constraints/FK → RLS-policies/grants →
  funktioner → triggers → indexes. Idempotente guards hvor relevant
  (`if not exists`, `drop policy if exists`, DO-blocks) — **lærte af F5** (0010/0012
  kan ikke genkøres).
- **Ingen destruktive ændringer uden godkendelse** (Rule7): ingen `drop table`,
  ingen `delete`, ingen policy-udskiftning før godkendt analyse pr. §19.
- **Adoption frem for genskabelse** for objekter der sandsynligvis allerede findes
  live (`profiles`): `create … if not exists`-mønster + dobbelt-kontrol før
  `create policy`, så en kørsel på live ikke bryder det eksisterende.
- **Eksisterende sekvens dækker allerede (Confirmed):** data-tabellers RLS,
  definer-funktioner, kvote-flow, karakter-sletning, override-tabel,
  placement-CHECK (0002+0003 som par), `0014`-parret.
  **Mangler til det fulde auth-system (ikke implementeret nu):** profiles-VC,
  storage-policies, FK-fix, RLS-fix, indexes, konto-sletning (§19-listen).

---

## 24. EXISTING SQL PROBLEMS (auth/security-relevante)

Kilde: `analysis/DRESSED-SQL-MIGRATIONS-ANALYSIS.md`. **Ingen rettes her (§25).**

| # | Problem | Konsekvens | Anbefalet løsning | Migration? | API? | Frontend? | Risk | Status |
|---|---|---|---|---|---|---|---|---|
| F3 | `wardrobe_items`-`WITH CHECK` på `reference_path` vs. NULL-indsatser (0001 policies +0002 nullable + POST `reference_path:null`) | RLS kan afvise INSERT/UPDATE for NULL-rækker; PATCH omgås via service-klient | `… and (reference_path is null or split_part(…) = …)` | JA (godkendt) | nej (behold service-mønster) | nej | høj (åbner delvist path-tjekket; uid-tjek består) | **Confirmed (repo) / Unverified (live)** |
| F4 | `profiles`-schema + storage-upload-policies + bucket **ikke i VC** | rekonstruktion ufuldstændig; ukendt live-RLS | eksportér fra live → indskrevne migrations (adoption) | JA | nej | nej | høj hvis gættet (derfor eksport først) | **Confirmed (mangler) / Unverified (live)** |
| F9 | `saved_dressed_outfits.user_id` mangler FK | teoretiske forældeløse rækker (delvis dækket af character-CASCADE) | `add constraint … references auth.users(id) on delete cascade` (efter data-tjek!) | JA (godkendt) | nej | nej | lav | **Confirmed** |
| F8 | Ingen ikke-unikke indexes | seq-scan ved skala | tilføj §14-indekser | JA (godkendt) | nej | nej | lav | **Confirmed** |
| F6 | Kvote-limits: migration (1/3/1) vs. kommentar (3/5/1) | ukendte live-kvoter | read-only inspektion før test-planlægning | nej (måske data-fix) | nej | nej | lav-mellem | **Unverified** |
| F5 |0010/0012 ikke idempotente | kan ikke repareres ved genkørsel | nye corrective-migrations ved behov (aldrig omskriv historik) | eventuelt | nej | nej | lav | **Confirmed** |
| F7 | `.kilo`-kopi af10 migrations | redigér fra forkert fil | brug kun `supabase/migrations/` | nej | nej | nej | lav | **Confirmed** |
| — | `character_transforms` nævnt i spec §2.4 (fandtes aldrig i DB) | vildledende docs | rettes i næste dokumentationsrunde | nej | nej | nej | lav | **Confirmed (doc)** |
| — | API 5xx skjuler DB-fejl-koder | svær live-debug | `code` i fejlbody (kun efter godkendelse) | nej | JA (godkendt) | nej | lav | **Confirmed** |
| — | Storage cascade'er ikke ved sletning | forældeløse filer | konto-sletningsflow + renser (§11) | JA (design) | JA | JA | mellem | **Confirmed (struktur)** |
| — | `.env`-dubletter af `PUBLIC_SUPABASE_*` | rod, ikke sikkerhed | ryd op senere | nej | nej | nej | lav | **Confirmed** |

---

## 25. DO NOT SILENTLY FIX EXISTING PROBLEMS

Alle ovenstående punkter er **kun dokumenteret**. Ingen SQL, API, RLS, storage,
Astro- eller frontendkode er ændret i denne analyse. Hver rettelse kræver særskilt
godkendelse med de i §24 angivne konsekvens-felter.

---

## 26. NO IMPLEMENTATION

Denne opgave har kun produceret **`analysis/DRESSED-AUTH-SQL-ARCHITECTURE-ANALYSIS.md`**.
Der er IKKE: ændret SQL, oprettet migrations, ændret API, Astro, Supabase-config,
RLS, storage, frontend, packages, package.json eller eksisterende docs.

---

## 27. VERIFICATION (selvtjek efter skrivningen)

1. ✅ Filen læst igen (afsnit-oversigt + dublet-/kode-bomme-tjek køres).
2. ✅ Samtlige14 migrations i `supabase/migrations/` er undersøgt (læst
   linje-for-linje i denne session); de auth-/security-relevante omtales med
   korrekte statusser (`0013` = kategori-udvidelse, ikke auth — kun reference).
3. ✅ Anbefalinger er afstemt med faktisk codebase (citet linjer: `supabase.ts`,
   `signup.astro`, `[id].ts`, `index.ts`, migrations0001–202610050003).
4. ✅ Kun denne én fil er tilføjet (`git status` — ingen andre ændringer).
5. ✅ Ingen frameworks/dependencies tilføjet (intet `package.json`-berørt;
   anbefalingen fastholder **ingen** React/Vue/Svelte og ingen `@supabase/ssr`
   uden godkendelse).
6. ✅ **Confirmed / Inferred / Unverified** er mærket ved hver påstand der
   rører live-databasen; §1–§25 dækker opgavens emneliste (#2-listen),
   §20–§27 følger opgavens sektioner.

---






