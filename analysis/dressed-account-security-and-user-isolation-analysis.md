# DRESSED — Account Security & User Isolation Analysis

> **Type: READ-ONLY SIKKERHEDSAUDIT + IMPLEMENTERINGSPLAN.**
> Fase 1 (dette dokument) er udelukkende læsning. Efter godkendelse af planen
> følger en **minimal** implementation (ny migration + ny slet-endpoint +
> signup-bekræftelse + client-state-rydning), beskrevet præcist i §Implementation
> Plan. **Ingen commit/push/merge/rebase/reset/stash/checkout.**
>
> **Branch:** `safety-branch`.
> **Evidensmarkering:** **CONFIRMED** = læst i kode/migration her ·
> **INFERRED** = logisk slutning · **UNVERIFIED** = kan kun afgøres med
> live-SQL/adgang, der ikke findes her.
>
> **Afrådgivende kilde-hierarki (uforandret):** `docs/DRESSED-PROJECT-SPECIFICATION.md`
> + `docs/DRESSED-CODEBASE-OVERVIEW.md` er gældende; `analysis/` er historik.
> Denne fil **tilføjer** — den overskriver ingen tidligere analyse
> (`dressed-3d-model-z-axis-analysis.md`, `dressed-3d-model-view-clothing-navigation-analysis.md`,
> `DRESSED-SQL-MIGRATIONS-ANALYSIS.md`, `DRESSED-AUTH-SQL-ARCHITECTURE-ANALYSIS.md`,
> `DRESSED-LIVE-DATABASE-INSPECTION.md`).

---

## Executive Summary

DRESSED' database-lag er **i forvejen tæt bygget**: alle kendte bruger-tabeller
har RLS med `auth.uid() = user_id`, alle storage-stier har prefix `{userId}/`,
alle 11 API-ruter kalder `authenticateSupabaseRequest`, og service-nøglen
findes **kun** server-side. Overordnet er der **ikke fundet et åbent "læs en
anden brugers række"-hul** i repoets kode.

Men fem reelle huller findes, og de skal lukkes **før** 3D-arbejdet:

| # | Gap | Alvor | Kilde |
|---|---|---|---|
| **G1** | **`profiles` har ingen RLS-policies i version control** (tabellen er oprettet uden for repoet — F4), mens klienten selv laver SELECT/INSERT/UPDATE på den. Hvad der live er tilladt, er **UNVERIFIED** og kan være permissivt | **Høj** | CONFIRMED (mangler i alle 16 migrations) |
| **G2** | **Storage-policies findes næsten ikke i repoet** (kun ét read-policy for base-former). De live-politikker, der lader upload/download virke, er **ukendte** — og **en signered URL er kun så sikker som storage-SELECT-policy'en**: er policy'en permissiv, kan en bruger skrive under på **en vilkårlig sti** (`createSignedUrl` til et andet `{userId}/…`-objekt) | **Høj** | CONFIRMED (1 policy i 16 migrations) |
| **G3** | **Ingen konto-sletning findes.** Ingen endpoint, ingen UI, og `auth.users`-cascade dækker DB men **aldrig Storage** — og `profiles`-FK er ukendt | **Høj** | CONFIRMED |
| **G4** | **Client-state lækker mellem konti på samme browser:** `closet-source-photo` (base64-foto!), `closet-items` (legacy-garderobe), `dressed-character` (model-cache) og `dressed-generation-flow` er **ikke navngivet pr. bruger** og ryddes **ikke ved logout** | **Mellem** | CONFIRMED |
| **G5** | **Signup har ingen adgangskode-bekræftelse** (ét felt) | **Lav** (sikkerhed: UX-risiko for fejl-indtastet kode) | CONFIRMED |

**Tom-konto-kravet:** der findes **ingen seed-data** til nye brugere (bekræftet:
ingen indsatser pr. bruger nogen steder; kun globale `ai_generation_limits` og
én kvote-override-række for en fast test-UUID). Tomme tilstande findes allerede
(`YOUR CLOSET IS EMPTY`, `NO SAVED OUTFITS YET`, `NO DRESSED CHARACTER YET`).
Den eneste risiko for "indhold der ligner bruger-data" er **legacy-lokalt
`closet-items`** i Profile (se G4) — ikke demo-indhold i repoet.

**Anbefaling:** (1) én ny migration der **fastlægger og strammer** profiles-RLS
+ storage-policies til `{userId}/`-ejerskab, (2) ét nyt server-endpoint
`POST /api/account/delete` (service-rolle, JWT-styret identitet), (3) signup
med to adgangskode-felter + øje-knapper, (4) `clearDressedClientState()` ved
logout og sletning, (5) ACCOUNT-sektion på Profile med to-trins bekræftelse.
Alt additivt; **ingen** eksisterende migration røres, ingen placering/drag/
pinch/wheel/tap/outfit/3D-logik berøres.

---

## Scope & Method

| Læst | Formål |
|---|---|
| `src/lib/supabase.ts`, `src/lib/server/supabase.ts`, `src/lib/server/ai/background.ts`, `job-launcher.ts` | klient-opsætning, JWT-verifikation, service-rolle |
| Alle 11 filer i `src/pages/api/**` | autentificering + ejerskabs-tjek pr. endpoint |
| Alle 16 `supabase/migrations/*.sql` | RLS, grants, definer-funktioner, storage-policy |
| `signup.astro`, `login.astro`, `Header.astro`, `profile.astro`, `wardrobe.astro`, `closet.astro` | auth-flow, UI-tilstande, localStorage |
| `lib/client/{wardrobe-ai,dressed-character,generation-flow,profile-outfits}.ts` | client-state |
| `analysis/*` (inkl. de to 3D-analyser) og `docs/*` | arkitektur-historik, F4/F9-kendte drift |

Søgninger: `supabase`, `auth.uid`, `user_id`, `from(`, `.insert(`, `.update(`,
`.delete(`, `.upload(`, `.download(`, `.remove(`, `createSignedUrl`,
`getPublicUrl`, `service_role`, `PUBLIC_SUPABASE`, `localStorage|sessionStorage`,
`demo|sample|hardcoded|fallback`.

---

## Current Architecture

### 1. Autentificerings-flowet (CONFIRMED)

```text
Browser: supabase-js (anon-nøgle)  →  session/JWT i browseren
   ↓ Authorization: Bearer <access_token>
Astro API-route: authenticateSupabaseRequest(request)         (lib/server/supabase.ts:37)
   1. læser Bearer-token fra headeren (ingen query-params, ingen body-id)
   2. bygger en midlertidig supabase-klient med samme token
   3. client.auth.getUser(token)  →  verificeret server-side
   4. returnerer { client (JWT-scoped), user }
   ↓
Route bruger KUN `client` (RLS aktiv) med eksplicit `.eq("user_id", user.id)`,
undtagen hvor en SECURITY DEFINER-RPC eller service-klienten er påkrævet.
```

**Login/logout:** `login.astro` (signInWithPassword), `Header.astro`
(`supabase.auth.signOut()` → redirect `/login`). **Ingen localStorage bruges
som auth** (`closet-logged-in` findes **ikke** i koden — CONFIRMED ved grep).

### 2. Nøgler og hemmeligheder (CONFIRMED)

| Nøgle | Hvor | Til klient? |
|---|---|---|
| `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` | klient + server | **Ja** (meningen) |
| `SUPABASE_SERVICE_ROLE_KEY` | KUN `lib/server/supabase.ts`, `server/ai/{background,job-launcher}.ts`, `pages/api/**` | **Nej** — grep over alle `.astro`-filer = **0 referencer** til `lib/server` eller `SUPABASE_SERVICE` |
| `OPENAI_API_KEY`, `BACKGROUND_JOB_SECRET`, `HF_TOKEN` | server + Netlify background functions | Nej |

Background jobs: Netlify-funktioner beskyttet med `x-job-secret`
(`secretMatches`, timing-safe) + `jobUserIsValid()` der **bekræfter, at
access-tokenet tilhører det `userId` der står i payloaden** — service-rolle
bruges inde i jobbet med eksplicitte `user_id`-filtre.

**Konklusion:** privilegerede nøgler eksponeres aldrig for browseren (der findes
ingen vej, hvorpå klienten kan tvinge service-rolle-adgang).

### 3. To-klients-modellen (CONFIRMED)

```text
userClient  = anon-nøgle + brugerens JWT  → RLS gælder
serviceClient = SUPABASE_SERVICE_ROLE_KEY  → bypasser RLS (server-only)
   bruges til: placement-UPDATE (items/[id].ts PATCH — pga. WITH CHECK på
   reference_path, dokumenteret), AI-jobben (character/clothing), background
   finalisering, og (i denne plan) konto-sletning
   ALDRIG med data fra request-body som identitet — kun med `user.id` fra JWT.
```

---

## Ownership Model (per ressource)

Ejerskab repræsenteres konsekvent på to niveauer:

1. **DB:** kolonnen `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE`
   (+ ofte composite PK `(user_id, id)` og CHECK
   `split_part(<path>-column,'/',1) = user_id::text`, der tvinger storage-stien
   til at starte med ejerens UUID).
2. **Storage:** objekt-sti `{userId}/…` i bucket `model-images` eller
   `profile-images` (begge private, verificeret live i
   `DRESSED-LIVE-DATABASE-INSPECTION.md` §G).
3. **API:** identitet = JWT (`user.id`); ressourcer slås op med
   `.eq("user_id", user.id)` oven i RLS.

### 10-punkts matrix pr. ressource (jf. opgavens krav)

| Ressource | Ownership | Identitet | RLS | SELECT egen | INSERT egen | UPDATE egen | DELETE egen | Storage isoleret | API-ejerskab | IDOR-risiko |
|---|---|---|---|---|---|---|---|---|---|---|
| `profiles` (foto, model-status, køn) | `user_id` | JWT | **Mangler i VC (G1)** | ? (live ukendt) | ? | ? | n/a (ingen delete-flow) | `profile-images/{uid}/` ✓ sti | `source-photo.ts` `.eq(user_id)` ✓ | **Høj indtil G1 lukkes** |
| `wardrobe_items` | `user_id` + PK | JWT | ✓ 0001 | ✓ | ✓ (path-CHECK) | ✓ (path-CHECK) | ✓ | `model-images/{uid}/clothing*,*-originals,previews` ✓ | `items/index.ts`, `items/[id].ts` alle `.eq(user_id)` ✓ | Lav |
| `wardrobe_item_ai_assets` | `user_id` + FK-cascade | JWT/service | ✓ 0002+0010 | ✓ | **kun service** (grant trukket tilbage) | **kun service** | ✓ | samme `{uid}/clothing/…` ✓ | reads via JWT+filter; writes via job | Lav |
| `wardrobe_item_ai_assets_legacy` | `user_id` | JWT/service | ✓ (0002's policies fulgte tabellen ved rename) | ✓ | service | service | ✓ | `{uid}/…` ✓ | `.eq(user_id)` ✓ | Lav |
| `saved_dressed_outfits` | `user_id` | JWT | ✓ 0012 | ✓ | **kun via definer-RPC** `save_dressed_outfit` | n/a (ingen update) | ✓ | ingen filer | `outfits/*` `.eq(user_id)` + RPC `auth.uid()` | Lav |
| `wardrobe_results` | `user_id` + path-CHECK | JWT | ✓ 0001 | ✓ | ✓ | n/a | ✓ | `{uid}/wardrobe-results/` ✓ | `dress-model.ts` filter + RLS | Lav |
| `dressed_characters` | `user_id` + path-CHECK | JWT/service | ✓ 0001 (+definer `publish_…`) | ✓ | **kun definer-RPC** | via RPC | via definer `delete_dressed_character` | `{uid}/personal-model-*` ✓ | `characters/[id].ts` filter + RPC | Lav |
| `ai_generation_usage` | `user_id` | JWT | ✓ 0001 (kun SELECT) | ✓ | nej (definer) | nej (definer) | cascade | ingen | RPC'er | Lav |
| `ai_generation_limits` | global (ikke-bruger) | — | ✓, SELECT `using (true)` | delt læsning | — | — | — | — | — | Ingen (ingen data) |
| `dressed_base_forms` | global (system) | — | ✓, SELECT `using (true)` | delt læsning | — | — | — | `model-images/system-reference/…` via policy | — | Ingen |
| `ai_generation_limit_overrides` | `user_id` | — | ✓ **nul policies = deny-all** | ✗ | ✗ | ✗ | cascade | — | kun definer-RPC/service | Ingen |
| **Storage `model-images`** | sti `{uid}/…` + `owner_id` | JWT ved signering | **kun base-form read policy i VC (G2)** | ? | ? | ? | ? | privat bucket ✓ | signered URLs kun | **Høj indtil G2 lukkes** |
| **Storage `profile-images``** | sti `{uid}/…` | samme | **0 policies i VC (G2)** | ? | ? | ? | ? | privat bucket ✓ | samme | **Høj indtil G2 lukkes** |

**Vigtigere end UUID'er:** `createSignedUrl()` er **ikke** i sig selv et
ejerskabs-tjek. Undertegnelsen sker med den anmodende klients token, og
oplags-API'et godkender via **storage-SELECT-policy'en**. Hvis den policy live
siger `authenticated USING (true)` (ukendt), kan enhver bruger skrive under på
`{andet-bruger-id}/…` og hente filen via den signeret URL i 60 minutter.
**G2 er derfor det mest kritiske fund.**

---

## User-Owned Resource Inventory (komplet)

```text
DATABASE
  profiles                       {user_id, name, username, favourite_style, gender,
                                  source_photo_path, model_photo_path,
                                  model_generation_status}   ← RLS mangler i VC (G1)
  wardrobe_items                 + placement JSONB (+ original/preview/reference_path)
  wardrobe_item_ai_assets        (user, item, base_type) v3
  wardrobe_item_ai_assets_legacy (user, item, character_id)
  saved_dressed_outfits          item_ids text[]
  dressed_characters             model_path, is_primary, geometry_contract_version
  wardrobe_results               result_path, outfit_key
  ai_generation_usage            used_count, in_progress
  ai_generation_limit_overrides  (kun test-UUID, deny-all)

STORAGE — model-images (private)
  {uid}/clothing/{characterId}/*.png        AI-ready lag
  {uid}/clothing-originals/*.png            rå upload
  {uid}/clothing-previews/*.png             clean preview
  {uid}/personal-model-*.png                AI-model
  {uid}/wardrobe-results/*.png              outfit-resultat
  {uid}/try-on-*.png                        FASHN try-on
  system-reference/base-forms/*.png         GLOBAL / IKKE brugerdata

STORAGE — profile-images (private)
  {uid}/source-photo-*.png                  kildefoto

CLIENT (ikke-auth, rydning kræves)
  localStorage: closet-items, closet-source-photo (data-URL!),
                dressed-character (cache m. modelPhotoPath+billede),
                dressed-profile-outfit:{userId}   (navngivet pr. bruger ✓)
  sessionStorage: dressed-generation-flow
```

---

## Current RLS Policies (CONFIRMED fra migrations)

| Tabeller | Policies | Vurdering |
|---|---|---|
| `dressed_characters` | SELECT own (0001); writes via definer-RPC'er | **Korrekt** — RPC'erne tjekker selv `auth.uid()` |
| `wardrobe_items` | SELECT/INSERT/UPDATE/DELETE own + path-CHECK (0001) | **Korrekt** — UPDATE køres via service-klient pga. `reference_path`-WITH CHECK (F3), men ejerskab filteres stadig |
| `wardrobe_results` | SELECT/INSERT/DELETE own + path-CHECK | **Korrekt** |
| `wardrobe_item_ai_assets` | SELECT/DELETE own (0010); INSERT/UPDATE frataget via `revoke` | **Korrekt** — skriver kun service-rolle |
| `wardrobe_item_ai_assets_legacy` | SELECT/INSERT/UPDATE/DELETE own (0002 policies fulgte tabellen ved rename) | **Korrekt** |
| `saved_dressed_outfits` | SELECT/DELETE own (0012); INSERT kun via definer-RPC | **Korrekt** |
| `ai_generation_usage` | SELECT own; skrive via definer | **Korrekt** |
| `ai_generation_limits`, `dressed_base_forms` | `using (true)` for `authenticated` | **Acceptabelt** — global konfiguration/systemdata, ingen persondata |
| `ai_generation_limit_overrides` | **nul policies** + `revoke all` | **Strammest muligt** — reference-implementering |
| **`profiles`** | **INGEN i version control** | **G1 — ukendt live-tilstand** |

`revoke … from anon` er verificeret effektivt live (42501-bevis i
`DRESSED-LIVE-DATABASE-INSPECTION.md` §C). **Ingen** policy i repoet siger
"authenticated kan alt" uden ejerskabs-betingelse — bortset fra de to globale
læse-tabeller, hvilket er bevidst.

---

## Current Storage (CONFIRMED + UNVERIFIED)

```text
BEGGE BUCKETS PRIVATE (live-verificeret) · INGEN getPublicUrl() i hele repoet
KUN createSignedUrl() (5 min preview / 60 min AI-resultater)
ALLE bruger-stier: {userId}/…  (8 upload-steder, alle verificeret linje-for-linje)
PATH-CHECKs i DB: split_part(path,'/',1) = user_id::text på 4 tabeller

POLICIES I REPO: kun ÉN — "Authenticated users can read DRESSED system base
form files" (0010, model-images, de to base-form-filer).
POLICIES LIVE: ukendte (F4). At upload/download virker beviser, at NOGET findes
live — ikke at det er ejerskabs-begrænset.  UNVERIFIED.
```

**Konsekvens (G2):** indtil en ejerskabs-policy er sat, er isolationen af
private billeder **ikke** bevisligt database-forankret. Rettet i den nye
migration (`{userId}/`-folder-check på SELECT/INSERT/UPDATE/DELETE i begge
buckets).

---

## Current API Authorization (endpoint-for-endpoint, CONFIRMED)

| Endpoint | Auth | Ejerskabs-tjek |
|---|---|---|
| `GET/POST /api/wardrobe/items` | ✓ | `.eq("user_id", …)` + RLS; POST sætter `user_id: user.id` (**aldrig** fra body) |
| `DELETE/PATCH /api/wardrobe/items/[id]` | ✓ | filter + RLS; PATCH på service-klient men med filter |
| `GET/POST /api/wardrobe/outfits` | ✓ | filter + RLS + definer-RPC `save_dressed_outfit` |
| `DELETE /api/wardrobe/outfits/[id]` | ✓ | filter + RLS |
| `DELETE /api/characters/[id]` | ✓ | filter + RLS + definer; afviser stier uden `{user.id}/`-prefix |
| `POST /api/profile/source-photo` | ✓ | filter + `{user.id}/`-sti; rydder kun egne stier |
| `POST /api/ai/personal-model`, `process-clothing` | ✓ | reservation m. `auth.uid()`; job verificerer token mod payload-user; service-rolle inde i job |
| `POST /api/ai/dress-model`, `try-on` | ✓ | filter + RLS + `outfit_key`-cache pr. user |
| `GET /api/ai/usage` | ✓ | definer-funktion med `auth.uid()` |

**Alle 11 API-filer kalder `authenticateSupabaseRequest`** (verificeret med
`-LiteralPath`, da `[id]` ellers fejler som wildcard). **Intet endpoint
accepterer `user_id` fra body/query som ejerskabs-bevis.** Klient-direkte kald
(`profile.astro`, `ProfileTheme.astro`) filtrerer også `.eq("user_id", …)` — men
er sekundære, fordi **RLS er den egentlige sikkerhed**.

**IDOR-sammenhold:** at kende et andet `wardrobe_items.id` er **utilstrækkeligt**
(PK `(user_id, id)` + RLS). Den eneste resterende IDOR-klasse er storage-stier
(G2) og `profiles` (G1) — netop de to ukendte policy-sæt.

---

## Client State / localStorage (CONFIRMED)

| Nøgle | Indhold | Pr. bruger? | Læk-risiko |
|---|---|---|---|
| `closet-source-photo` | **base64 kildefoto** (data:image/…) | **Nej** | **Høj** — vises som fallback i `wardrobe.astro:939` og `profile.astro:774` for næste bruger på samme browser |
| `closet-items` | legacy-garderobe (navn, sti, AI-assets) | **Nej** | **Mellem** — Profile renderer det (`:1303-1368`) *før* server-load erstatter det (`:1567`); ved API-fejl bliver det siddende |
| `dressed-character` | `modelPhotoPath` + billede-URL + køn | **Nej** | **Mellem** |
| `dressed-generation-flow` (session) | status/label/timestamps | Nej (session) | Lav (ingen persondata) |
| `dressed-profile-outfit:{userId}` | valgt outfit-id | **Ja ✓** | Ingen |
| `closet-profile`, `closet-logged-in` | **findes ikke i koden** (opgavens antagelse afvist ved grep) | — | — |

**Regel:** Supabase Auth forbliver den eneste kilde til sandhed; **ingen** ny
client-auth indføres. Løsningen er **rydning ved logout + sletning** (§Plan).

---

## Empty Account / Seed-Data Findings (CONFIRMED)

- **Ingen seed-data til nye brugere findes.** Ingen trigger/indstik opretter
  wardrobe-items, outfits, characters eller fotos ved signup. De eneste
  `insert`-sætninger i alle migrations er: `ai_generation_limits` (3 globale
  rækker), `dressed_base_forms` (2 systemrækker) og **én**
  `ai_generation_limit_overrides`-række for et fast test-UUID (kvote, ikke indhold).
- **Ingen hardkodede/demo items i UI.** Grep efter `demo|sample|hardcoded|dummy`
  i `src/` = 0 fund (kun `responseError(..., fallback)`-tekst).
- **Tomme tilstande findes allerede:** Closet `YOUR CLOSET IS EMPTY` +
  `ADD CLOTHING FROM YOUR PROFILE`, Profile `#empty-closet` (`YOUR CLOSET IS
  EMPTY`), wardrobe `YOUR CLOSET IS EMPTY`, `NO DRESSED CHARACTER YET`,
  `NO SAVED OUTFITS YET.`, Profile-outfit-panelet `NO SAVED OUTFITS YET. CREATE
  ONE IN CLOSET.` (alt i DRESSED' visuelle sprog).
- **Den eneste "indhold-lignende-brugerdata"-risiko er legacy-lokalt
  `closet-items`** (G4) — det er brugerens egen gamle lokaldata, **ikke**
  demo-indhold, og det må **ikke** slettes i selve koden (fungerende fallback),
  men **ryddes ved logout/sletning**, så det aldrig kan forveksles med en ny
  kontos indhold.
- **Model-tilstanden mangler en egentlig "tom" tekst:** Profile viser
  `NO PHOTO YET`-placeholder + generisk hjælpetekst; der findes ingen klar
  `NO AI MODEL YET`-tilstand (forskel på "ingen model" og "ingen foto" markeres
  kun i dynamiske statusbeskeder). Dette **præciseres** i implementationen.

---

## Security Gaps (detaljeret)

| # | Gap | Alvor/Sandsynlighed | Bevis | Foreslået lukning |
|---|---|---|---|---|
| **G1** | `profiles`-tabel uden RLS-policies i VC; klienten læser/skriver den direkte. Hvis live-policy er `using (true)`, kan en bruger læse **enhvers** `source_photo_path`/`model_photo_path` (og derefter — sammen med G2 — hente filerne) | Høj / uvist | Ingen `create policy … profiles` i 16 migrations; `profile.astro:616-677` skriver med JWT | Ny migration: `enable row level security` + drop alle eksisterende + SELECT/INSERT/UPDATE **kun egne** (`auth.uid() = user_id`, `WITH CHECK` samme) |
| **G2** | Storage-SELECT/INSERT/UPDATE/DELETE-policies mangler i VC ⇒ signeret-URL-adgang er ikke bevisligt ejerskabs-begrænset | Høj / uvist | Kun base-form-read findes (`0010:91-101`) | Ny migration: ejerskabs-policies på begge buckets via `(storage.foldername(name))[1] = auth.uid()::text` + `owner_id = auth.uid()`; drop alle ukendte eksisterende policies på `storage.objects` **undtagen** base-form-policy'en (beholdes) |
| **G3** | Ingen konto-sletning (DB-cascade ≠ Storage; `profiles`-FK ukendt) | Høj / sikker | Ingen endpoint/UI | Ny `POST /api/account/delete` (service-rolle, JWT-identitet) + ACCOUNT-UI |
| **G4** | Client-state ikke pr. bruger + ikke ryddet ved logout (`closet-source-photo` = foto-URL, `closet-items` = legacy-garderobe, `dressed-character` = model-cache) | Mellem / sikker | Greps ovenfor | `clearDressedClientState()` kaldes ved **lykket logout** og ved **lykket sletning** |
| **G5** | Signup uden adgangskode-bekræftelse | Lav / sikker | `signup.astro:67-76` ét felt | To felter + match-tjek + `autocomplete="new-password"` + øje-knapper |
| **G6** | `profiles` mangler FK til `auth.users` i VC (ukendt live) ⇒ cascade kan svigte ved sletning | Mellem / uvist | F4 | Slet-endpointet sletter `profiles` **eksplicit** før auth-sletning (uafhængigt af FK) |
| **G7** | Signerede URLs (60 min) er bearer-for-possession — deles via GET-parametre/browser-cache | Lav | Kode | Dokumenteret; ingen ændring (nødvendigt for privat indhold) |
| **G8** | `wardrobe_items` UPDATE via service-klient (F3 `reference_path`-WITH CHECK) | Lav (ejerskab filteres) | `items/[id].ts:200` | Bevar (dokumenteret); evt. ret CHECK i en senere, særskilt godkendt migration |
| **G9** | Live≠repo for øvrige objekter (F4: `profiles`-kolonner, bucket `profile-images`) | Dokumenteret | Live-inspektion | Migrationen tager højde for begge (opretter policies for begge buckets) |

**Ikke-fund (bevidst afvist):** `getPublicUrl` (0), offentlige buckets (0),
client-import af service-nøgle (0), endpoints uden auth (0), localStorage som
auth (0), `user_id` fra request-body som ejerskab (0), demo/hardcoded items (0).

---

## Recommended Architecture

```text
1. DATABASE/RLS (én ny migration, additiv, intet gammelt røres)
   · profiles: ENABLE RLS → drop ALLE eksisterende policies →
     SELECT/INSERT/UPDATE kun egne (auth.uid() = user_id, WITH CHECK samme)
   · storage.objects: drop ALLE policies undtagen base-form-read →
     for hver bucket i {model-images, profile-images}: SELECT/INSERT/UPDATE/DELETE
     med (storage.foldername(name))[1] = auth.uid()::text
   · ingen ændring af øvrige tabeller (de er allerede korrekte)

2. KONTO-SLETNING (server-side, service-rolle)
   POST /api/account/delete  (kun Astro API-route — service-nøglen forlader aldrig serveren)
     a. authenticateSupabaseRequest → user.id fra JWT (aldrig fra body)
     b. kræv bekræftende body-felt (forsvar mod utilsigtet kald)
     c. slet DB-rækker pr. tabel med .eq("user_id", user.id) (uafhængigt af FK/G6)
     d. list + slet ALT under {userId}/ i begge buckets (rekursiv, dybde-begrænset)
     e. serviceClient.auth.admin.deleteUser(user.id)
     f. svar {deleted:true} eller fejl — aldrig falsk succes

3. CLIENT-STATE
   lib/client/account-state.ts → clearDressedClientState()
     fjerner closet-items, closet-source-photo, dressed-character,
     dressed-profile-outfit:*, sessionStorage dressed-generation-flow
     kaldes: Header.astro ved lykket signOut · profile efter lykket sletning

4. SIGNUP
   EMAIL · PASSWORD [eye] · CONFIRM PASSWORD [eye], autocomplete="new-password"
   bloker submit ved mismatch/empty; trim email; aldrig log/slet værdier;
   bevaret Supabase-flow og eksisterende fejlbeskeder

5. EMPTY ACCOUNT
   ingen seed, ingen nye demo-data; eksisterende tomme tilstande bevares;
   Profile-modeltekst præciseres til "NO AI MODEL YET"-tilstand;
   legacy `closet-items` bevares som fallback men ryddes ved logout/sletning
   (fremtidig seed-data kan stadig tilføjes — ingen arkitektur låses)

6. UI
   Profile: ny ACCOUNT-sektion i DRESSED-stil med to-trins bekræftelse
   (varsel-tekst + CANCEL / DELETE ACCOUNT), ingen browser confirm(),
   ingen nye dependencies
```

**Hvorfor dette er sikkert nok til 3D:** alle fremtidige brugerressourcer
(GLB, teksturer, hair, renders) vil ligge under `{userId}/…` og i tabeller med
`user_id` + RLS → de arver isolationen automatisk, og slet-endpointets
`{userId}/`-rensning dækker dem uden ændringer (se §Future-Proofing).

---

## Implementation Plan (nøjagtigt — udført efter denne analyse)

| # | Fil | Handling | Skal det laves? |
|---|---|---|---|
| 1 | `supabase/migrations/202610070001_account_security_and_user_isolation.sql` | **NY.** `profiles`-RLS + storage-policies (begge buckets), additiv, intet gammelt røres | Ja |
| 2 | `src/pages/api/account/delete.ts` | **NY.** `POST`-endpoint (service-rolle, JWT-identitet, bekræftelse, DB+Storage+Auth) | Ja |
| 3 | `src/lib/client/account-state.ts` | **NY.** `clearDressedClientState()` | Ja |
| 4 | `src/components/Header.astro` | Ryd client-state ved lykket logout | Ja |
| 5 | `src/pages/signup.astro` | Bekræftelsesfelt + øje-knapper + validering | Ja |
| 6 | `src/styles/signup.css` | Styles til password-wrap + øje-knap | Ja |
| 7 | `src/pages/profile.astro` | ACCOUNT-sektion + sletningsflow + `NO AI MODEL YET`-tekst | Ja |
| 8 | `src/styles/profile.css` | Styles til ACCOUNT-sektionen | Ja |
| — | Alle øvrige filer, alle eksisterende migrations, `package.json` | **Ingen ændring** | Nej |

**Eksplicit IKKE ændret (opgavens punkt 12):** X/Y-scaling, FREE-scaling, drag,
pinch, wheel, tap-selection, outfit-adfærd, placement-arkitektur, saved outfits,
begge 3D-analyser, navigation-analysen, alle AI-jobs, `wardrobe.astro`,
`closet.astro`, `login.astro`, `package.json`.

---

## Account Deletion — Dependencies (ressource-kort før implementering)

```text
POST /api/account/delete
  identitet: authenticateSupabaseRequest → user.id  (aldrig body/query)
  service-rolle: createSupabaseServiceClient()  (server-only)

  1. DB (alle .eq("user_id", user.id), i denne rækkefølge):
     wardrobe_item_ai_assets          ← FK til items/characters (cascade ville også)
     wardrobe_item_ai_assets_legacy
     saved_dressed_outfits            ← trigger "remove_saved_outfits_for_deleted_item"
     wardrobe_items                   ← trigger fjerner item fra outfits
     dressed_characters               ← (cascade: ai_assets)
     wardrobe_results
     ai_generation_usage
     ai_generation_limit_overrides
     profiles                         ← EKSPPLICIT (G6/F4 — ingen sikker FK i VC)
     [auth.users slettes til SIDST]

  2. STORAGE (ufafhængigt af DB!):
     for bucket i {model-images, profile-images}:
       rekursiv list af {userId}/ (dybde ≤ 6) → remove([…])
       (dækker clothing/, clothing-originals/, clothing-previews/,
        wardrobe-results/, try-on-*, personal-model-*, source-photo-*)
       system-reference/ røres ALDRIG (andet UUID-prefix)

  3. AUTH: serviceClient.auth.admin.deleteUser(user.id)
     → ON DELETE CASCADE på 8 tabeller som sikkerhedsnet

  4. SVAR: {deleted:true} — eller 4xx/5xx med ærlig fejl; ingen falsk succes.

FEJLSKENARIOS:
  · DB-del fejler → 500, INGET slettet, bruger kan prøve igen
  · Storage-del fejler (helt/delvist) → vi forsætter til auth-sletning; hvis
    auth lykkes svarer vi {deleted:true, warning:"some files could not be
    removed"} — aldrig stille fejl. Resterende filer ligger i en privat bucket
    under et nu slettet UUID-præfiks (utilgængelige for andre brugere via de
    nye ejerskabs-policies)
  · auth-sletning fejler efter DB+storage → 500 med "retry"; retry er idempotent
    (tomme sletninger er no-ops, storage-listen er tom)
  · gentagne kald efter lykket sletning → JWT ugyldig → 401
```

**Klientadfærd efter succes:** `clearDressedClientState()` →
`supabase.auth.signOut()` (ignorer fejl — brugeren er allerede slettet) →
redirect `/`. Ved fejl: bevar session + vis fejl, så brugeren kan prøve igen.

**Rækkefølgen bevidst:** DB → Storage → Auth. Autentificeringen sidst gør, at
en midlertidig fejl **altid** kan rettes ved retry, og at brugeren aldrig
efterlades med en aktiv konto og slettet data uden at få besked.

---

## Future-Proofing for 3D (Part 10)

Designet skal understøtte kommende ressourcer **uden** at implementere dem:

```text
GLOBAL / SHARED ASSETS (ikke brugerdata, ingen kopi pr. bruger)
  · kanonisk DRESSED body-model (GLB), skeletter, base-form-filer
  · fælles hår-bibliotek (hair_assets) og fælles 3D-garment genereret én gang
  · front/side/back-renders af delte assets
  LAGRING: dedikeret sti-system-reference/… ELLER en separat bucket
           (anbefaling: `dressed-assets`, global) med read-policy for
           `authenticated` — INTET pr. bruger præfiks, INTET i brugerens mappe.
  RLS: global læse-policy (som `dressed_base_forms` i dag), skrive kun service.

USER-OWNED ASSETS (arver denne sikkerhedsmodel automatisk)
  · 3D-modeller/ansigter pr. bruger (adult/teen/child), personlige hårvalg
  · pr. bruger-genererede 3D-garments FØR deling (hash-cache kan senere
    "promovere" et asset til det delte bibliotek — aldrig omvendt)
  LAGRING: {userId}/… i privat bucket  → samme ejerskabs-policy
  DB: user_id + FK + path-CHECK + RLS (samme skabelon)
  SLETNING: dækkes allerede af den rekursive {userId}/-rensning
```

**Regel for fremtiden (skal indarbejdes i 3D-fasen):** *aldrig* kopier et
globalt asset ind i brugerens mappe, og *aldrig* læs et objekt fra en anden
brugers mappe uden for `auth.uid() = owner`-policy'en. Adskil via sti-præfiks
`system-reference/` vs. `{uuid}/`, hvilket allerede er DRESSED' konvention.

---

## Tests Required (Part 11 — sikkerhedstest-matrix)

> **Status:** disse skal køres **efter** at migrationen er anvendt og deployen
> er opdateret. I denne rækkefølge:

### A. NY KONTO
1. Opret helt ny konto → `GET /api/wardrobe/items` = `[]`,
   `GET /api/wardrobe/outfits` = `[]`, `profiles` = tom/null, ingen characters.
2. Profile viser `YOUR CLOSET IS EMPTY` og `NO AI MODEL YET`-tilstanden;
   wardrobe viser `NO DRESSED CHARACTER YET` + tom clothing-grid.
3. **SQL (read-only, kræver godkendelse):**
   `select count(*) from wardrobe_items where user_id='<ny>';` osv. = 0 for alle
   bruger-tabeller.

### B. ADGANGSBEKRÆFTELSE
1. Lighed → signup tilladt. 2. Ulighed → **ingen request sendt**, besked vist.
3. Øje-knap toggler `type` mellem `password`/`text` for hvert felt uafhængigt;
   tastatur (Tab/Enter) virker; værdien ændres aldrig.
4. `autocomplete="new-password"` på begge; ingen adgangskode i `console.*` eller
   `localStorage` (verificeret ved inspektion).

### C. TO-BRUGER-ISOLATION (A ↔ B)
1. A opretter tøj + outfit (+ model/kilde-foto). Logger ind som B → ser **ingen**
   af As ting (grid/outfits/model tomme).
2. **Direkte forsøg fra B:** `GET/PATCH/DELETE /api/wardrobe/items/{A.id}`,
   `DELETE /api/wardrobe/outfits/{A.id}`, `DELETE /api/characters/{A.id}` →
   **404** (aldrig 200). Prøv at signere As storage-sti fra B's session
   (`createSignedUrl` med As `{userId}/…`-sti) → **fejl** (efter G2-migrationen).
3. `select` forsøg via REST med B's token på As rækker → `[]`.
4. Gentag omvendt (B → A).

### D. KONTO-SLETTING
1. Testkonto fyldt med data → `POST /api/account/delete` (med bekræftelse).
2. Verificer: auth-bruger væk (`auth.admin`/login fejler), alle DB-rækker væk,
   **begge** buckets har **0** objekter under præfikset, session ugyld, `/profile`
   → redirect til login, localStorage ryddet.
3. Samme e-mail igen (hvis Supabase tillader) → **tom** konto.
4. Fejlsti: forkert/udløbet token → 401; manglede bekræftelse → 400;
   service-nøgle ikke konfigureret → 503.

### E. LOGOUT
`signOut` → `/login`; ny login på samme browser → **ingen** `closet-items`,
`closet-source-photo`, `dressed-character` fra forrige bruger
(verificer i DevTools → Application → Storage).

### F. REGRESSION (må ikke brydes)
Build grøn · signup/login/logout · upload tøj · MAKE AI READY · placement
(X/Y/FREE, drag/pinch/wheel/tap) · SAVE/LOAD OUTFIT · Profile-render · Closet.

---

## Risks, Assumptions & What Must Be Addressed Before 3D

### Risici

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| Live-policies er **permissive** indtil migrationen køres (G1/G2) | **Høj** | uvist | Kør migrationen **først** efter godkendelse; verificér med read-only SQL (nedenfor) |
| Migrationen dropper ukendte live-policies på `storage.objects` | Mellem | høj (bevidst) | Kun egne buckets rammes; base-form-policy bevares eksplicit; efterfølgende smoke-test: upload/download/sign |
| `profiles` live har kolonner/udløsere vi ikke kender (F4) | Mellem | høj | Policies rører ikke skema; kun policy-sæt; efterfølgende smoke-test af Profile-indlæsning + kilde-foto-upload |
| Konto-sletning efterlader storage-filer ved delvis fejl | Lav | lav | `warning` i svaret; privat bucket + ejerskabs-policy gør resterne utilgængelige |
| Logout-rydning fjerner legitim legacy-fallback | Lav | mellem | Kun pr. bruger-agnostiske nøgler ryddes, og kun ved logout/sletning (aldrig under drift) |
| Ingen live test kan køres i denne rækkefølge (ingen SQL-kanal, ingen brugeroprettelse her) | Mellem | sikker | Test-matrix udleveres; **migrationen kan IKKE køres fra repoet** — den skal anvendes via Supabase-dashboard/CLI |

### Antagelser

1. Den deployede Netlify-applikation er denne working tree (samme antagelse som
   i `DRESSED-MODEL-GENERATION-DEBUG-01` — E1 ikke bevist).
2. `profiles` oprettes/vedligeholdes af en live-udløser eller lazy-insert i
   klienten (`profile.astro:636`); mekanismen er **UNVERIFIED** (F4).
3. Buckets er `model-images` + `profile-images` (verificeret live) — nye buckets
   til 3D skal tilføjes til migrationen senere.
4. `service_role`-gruppen ejer `storage.objects` og bypasser RLS (Supabase-standard).

### Skal addresses FØR 3D implementering

1. **Kør + verificér migration `202610070001`** (ellers er hverken nutidens
   private billeder eller fremtidens GLB'er database-forankret isoleret).
2. **Verificér `pg_policies` for `storage.objects` og `profiles`** med read-only
   SQL før og efter (bevis, ikke antagelse).
3. **Kør to-bruger-testen (C) begge veje** — især signer-URL-forsøget.
4. **Etabler `tests/` i repoet** (alle nuværende tests lever i `%TEMP%` —
   `DRESSED-CURRENT-STATUS.md` §Known limitations) så isolation kan
   regres-testes.
5. **Ryd `.env`-dubletter** (`PUBLIC_SUPABASE_*` to gange) for at undgå
   forveksling af nøgler ved deploy.
6. **Fastlæg globale vs. private 3D-buckets** (§Future-Proofing) inden første
   GLB uploades.

### Verifikations-SQL (read-only, kræver særskilt godkendelse)

```sql
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where (schemaname='public' and tablename='profiles')
   or (schemaname='storage' and tablename='object')
order by tablename, policyname;
-- forventet efter migration: profiles = 3 policies (select/insert/update,
-- alle med auth.uid() = user_id); storage.objects = base-form-read + 8
-- ejerskabs-policies (4 pr. bucket)
```

---

## Appendix — Selvtjek

| # | Krav | Status |
|---|---|---|
| 1 | Læst alle relevante analyse-dokumenter før implementation | ✓ (3D-analysen, navigations-analysen, SQL-migrations-auditten, AUTH-analysen, live-inspektionen, current-status) |
| 2 | Ingen kode ændret under selve analysen | ✓ denne fil er det eneste artefakt i analyse-fasen |
| 3 | Alle 10 ejerskabsspørgsmål besvaret pr. ressource | ✓ matrix i §Ownership Model |
| 4 | Service-nøgle-afdækning dokumenteret | ✓ §Current Architecture §2 |
| 5 | Alle 11 API-endpoints gennemgået | ✓ §Current API Authorization |
| 6 | Alle localStorage-nøgler gennemgået (inkl. `closet-profile`/`closet-logged-in`, der ikke findes) | ✓ §Client State |
| 7 | Empty-account: seed undersøgt, demo-data afvist, tomme tilstande kortlagt | ✓ §Empty Account |
| 8 | Migrations ændres aldrig — kun ny fil foreslået/tilføjet | ✓ |
| 9 | 3D-navigation og X/Y-scaling ikke berørt | ✓ §Implementation Plan "IKKE ændret" |
| 10 | Global vs. user-owned 3D-assets adskilt | ✓ §Future-Proofing |

---

---

## Implementation Status & Validation (efterfølgende notat)

### Udført (kode/migration — alt additivt)

| Fil | Type | Indhold |
|---|---|---|
| `supabase/migrations/202610070001_account_security_and_user_isolation.sql` | **NY** | G1+G2: `profiles` RLS (3 ejerskabs-policies; alle ukendte droppes først) + 8 owner-folder-policies på `storage.objects` for `model-images`/`profile-images` (base-form-read bevares), `revoke … from anon` |
| `src/pages/api/account/delete.ts` | **NY** | `POST`, JWT-identitet, `confirm:true`-krav, 9 tabeller (`.eq("user_id",…)`), rekursiv + pagineret `{userId}/`-rensning i begge buckets, `auth.admin.deleteUser` sidst, ærlige fejlsvar |
| `src/lib/client/account-state.ts` | **NY** | `clearDressedClientState()` — fjerner `closet-items`, `closet-source-photo`, `dressed-character`, `dressed-profile-outfit:*` og sessionStorage `dressed-generation-flow` |
| `src/components/Header.astro` | Ændret | Rydder client-state efter lykket `signOut` |
| `src/pages/signup.astro` | Ændret | CONFIRM PASSWORD + to uafhængige øje-knapper, `autocomplete="new-password"`, match-tjek der blokerer request, email trimmes |
| `src/styles/signup.css` | Ændret | `.password-field` / `.password-toggle` (overstyrer `.auth-content button`) |
| `src/pages/profile.astro` | Ændret | ACCOUNT-sektion (to-trins, ingen browser `confirm()`) + delete-flow + `NO AI MODEL YET`-tekst |
| `src/styles/profile.css` | Ændret | Danger-zone-stil i DRESSED-sprog (DM Mono, pixel-shadow, pink focus) |

**Ingen ændring af:** alle ældre migrations, `package.json`, `wardrobe.astro`,
`closet.astro`, `login.astro`, placement/drag/pinch/wheel/tap/outfit-logik,
begge 3D-analyser.

### Validering udført i denne runde

- `npm run build` → **Complete!** (SSR-function + alle sider bundlet).
- `npx tsc --noEmit` → **12 fejl, alle præ-eksisterende** i filer der ikke er
  rørt (`astro.config.mjs`, manglende `@types/pngjs`, `ArrayBuffer`-typing i
  AI-filerne). **0 fejl i nye/ændrede filer.**
- `dist/`-kontrol: signup indeholder begge `autocomplete="new-password"`-felter
  og `aria-label="Show password"`; profile indeholder
  `account-delete-confirm-button` og `NO AI MODEL YET`.

### KAN IKKE køres i dette miljø (skal udføres af projektets ejer)

1. **Anvend migration** `202610070001` (Supabase SQL editor/CLI) — der findes
   ingen SQL-kanal fra repoet.
2. **Read-only verifikation** af `pg_policies` (SQL'en står under §Risks).
3. **To-bruger-testen (C)** og **sletningstesten (D/E)** — kræver rigtige konti
   mod live-instansen; de er **ikke udført** og påstås ikke verificeret.

---

*Slut på analysen. Implementeringen ovenfor er udført additivt uden commit,
push, merge, rebase, reset, stash eller checkout. Næste trin: anvend migration
`202610070001`, kør test-matrix A–F, og verificér `pg_policies` før 3D-fasen
påbegyndes.*







