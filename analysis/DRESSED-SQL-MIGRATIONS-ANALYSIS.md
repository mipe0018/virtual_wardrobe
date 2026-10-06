# DRESSED — SQL MIGRATIONS & DATABASE CHANGE AUDIT

> DOCUMENTATION-ONLY. Ingen produktionskode, migrationer eller databasen er
> ændret. Der er **ikke kørt SQL** og **ikke adgang til den faktiske database**
> (projektet har ingen `supabase/config.toml` → CLI'en er ikke linked, og
> database-inspektion ville kræve kørsel af SQL, som er forbudt i denne runde).
> Alt herunder er læst direkte fra repository-filer (med citations-linjenumre)
> eller klassificeret ærligt som INFERRED/UNVERIFIED.

**Klassifikations-legende (bruges konsekvent):**
- **VERIFIED IN REPOSITORY** = dokumenteret direkte fra migrations/kode i repoet.
- **VERIFIED IN DATABASE** = faktisk verificeret mod den live Supabase-database.
- **INFERRED** = udledt af adfærd/beviser, men ikke direkte inspiceret.
- **UNVERIFIED** = kan ikke kontrolleres i denne runde.

---

## 1. HELE SQL-HISTORIKKEN (fundet)

| Kilde | Indhold | Status |
|---|---|---|
| `supabase/migrations/*.sql` | **14 migrations** (0001–0016-disken + `202610050001`–`0003`) = den autoritative SQL-historik | Aktiv |
| `.kilo/worktrees/quilt-ticket/supabase/migrations/` | **10 kopier** af0001–0015 (mangler0016 + alle2026-migrationer). Hash-sammenligning:9/10 identiske; `0015` afviger **kun** i linjeafslutning (LF vs CRLF), indhold identisk (`git diff --no-index` = kun line-ending-advarelse) | **DUPLICATE — forældet arbejdstræ; ikke autoritativt** |
| `supabase/.temp/cli-latest` |8 bytes CLI-version-markør — ingen SQL | Ikke-relevant |
| `src/**` (`.ts`/`.astro`) | **0 SQL-sætninger** (ingen DDL/DML i kode). Koden taler PostgREST + `.rpc()` | VERIFIED IN REPOSITORY |
| `scripts/` (kun i worktree: `set-owner.mjs`) | One-off Node-script: sætter `app_metadata.is_owner` via **auth admin-API** (service-role). Ingen SQL, men bekræfter `SUPABASE_SERVICE_ROLE_KEY`-nøglen | VERIFIED IN REPOSITORY |
| `DRESSED-SUPABASE-ANALYSIS.txt` | Tidligere analyse; **"NO live database was queried in this audit"** (linje17) + `profiles`-schema er `[UNKNOWN — must be read from the live database]` (linje88) | Historisk, ingen live-viden |
| `DRESSED-SUPABASE-IMPLEMENTATION-PLAN.txt` | Fremskrevet SQL (M0–M6: `account_deletions`, `deleted_emails`, `retained_*`, profiles-constraints) — **IKKE implementeret** | NOT APPLIED (plan) |
| Mine egne docs (`docs/`, `analysis/DRESSED-CURRENT-STATUS.md` mv.) | Beskriver0002/0003 korrekt (`jsonb_typeof='text'` → `'string'`) | Gældende |
| Git-historik | `git log -- '*.sql'`: alle migrations kom i **eet commit** (`0257145 first commit`); `--diff-filter=D` = **ingen slettede .sql nogensinde** | VERIFIED IN REPOSITORY |


**Konklusion:** supabase/migrations (14 filer) ER hele den versionskontrollerede
SQL-historik. Alt andet (profiles-tabellen, storage-buckets/-policies, evt.
manuelle live-ændringer) er **uden for version control** — se §3 og §4-F4.

---

## 2. KOMPLET MIGRATIONSLISTE (kronologisk)

### 2.1 `202610040001_dressed_ai_wardrobe.sql` (395 linjer)

- **ID/timestamp:** 202610040001 · **Formål:** "Additive profile, private
  wardrobe-reference, result, and AI-quota structures". Kommentar: `source_photo_path`,
  `model_photo_path`, `model_generation_status` **eksisterede allerede på `profiles`**
  (dvs. `profiles` er ældre end repoet — se §3).
- **Kolonner tilføjet:** `profiles.gender text` (+ DO-guarded CONSTRAINT
  `profiles_gender_check` ∈ {woman, man} eller NULL).
- **Tabeller oprettet:**
  - `dressed_characters`: `user_id uuid NOT NULL → auth.users ON DELETE CASCADE`,
    `id uuid DEFAULT gen_random_uuid()`, `model_path text NOT NULL`,
    `gender text NOT NULL CHECK ∈ {woman,man}`, `is_primary bool DEFAULT false`,
    `created_at timestamptz DEFAULT now()`; **PK (user_id, id)**;
    **CHECK** `split_part(model_path,'/',1) = user_id::text` (path-ejerskab);
    **unikt partiel INDEX** `dressed_characters_one_primary_per_user (user_id) WHERE is_primary`.
  - `wardrobe_items`: `user_id uuid NOT NULL → auth.users CASCADE`, **`id text NOT NULL`**,
    `name text NOT NULL CHECK (char_length BETWEEN1 AND100)`, `category text NOT NULL`
    **CHECK ∈ {tops, shirts, sweaters, jackets, dresses, skirts, pants, shorts, shoes,
    bags, jewelry, necklaces, earrings, bracelets, watches, glasses, sunglasses, hats,
    hair-accessories, accessories, other}** (20 værdier), `reference_path text NOT NULL`,
    `created_at/updated_at timestamptz DEFAULT now()`; **PK (user_id, id)**;
    **CHECK** `split_part(reference_path,'/',1) = user_id::text`.
  - `wardrobe_results`: `user_id → auth.users CASCADE`, `id uuid`,
    **`item_ids text[] NOT NULL CHECK (cardinality BETWEEN1 AND5)`**,
    `result_path text NOT NULL`, `created_at`; **PK (user_id, id)**; path-CHECK.
  - `ai_generation_limits`: `generation_type text PK CHECK ∈ {character, clothing, tryon}`,
    `free_limit int NOT NULL CHECK ≥0`; **seed-data:** ('character',3), ('clothing',3),
    ('tryon',3) `ON CONFLICT DO NOTHING`.
  - `ai_generation_usage`: `user_id → auth.users CASCADE`, `generation_type →
    ai_generation_limits`, `used_count int DEFAULT0 CHECK ≥0`, `in_progress bool
    DEFAULT false`, `started_at timestamptz`, `updated_at`; **PK (user_id, generation_type)**.
- **Triggers/functions:** `prevent_profile_gender_change()` (trigger
  `profiles_gender_is_locked` BEFORE UPDATE OF gender — låser køn);
  `publish_dressed_character(text,text)` (security definer; verificerer storage-objekt i
  bucket `model-images` + profil-køn; nulstiller øvrige primaries; opdaterer profiles);
  `set_primary_dressed_character(uuid)` (definer); `reserve_ai_generation(text)`
  (definer; `FOR UPDATE`-lås;5-minutters `already_in_progress`; tæller ±1);
  `finish_ai_generation(text)` (definer); `get_ai_generation_usage()` (definer, sql).
- **RLS:** enabled på alle5 nye/ændrede tabeller. Policies:
  `dressed_characters` SELECT-egne; `wardrobe_items` **SELECT/INSERT/UPDATE/DELETE**
  (INSERT+UPDATE `WITH CHECK`: `auth.uid()=user_id` **og**
  `split_part(reference_path,'/',1)=auth.uid()`); `wardrobe_results` SELECT/INSERT/DELETE;
  `ai_generation_limits` SELECT `using(true)`; `ai_generation_usage` SELECT-egne.
  Alle policies `drop policy if exists` først ⇒ idempotente.
- **Grants:** `revoke all … from anon[, authenticated]` + snævre `grant` (f.eks.
  `wardrobe_items`: select,insert,update,delete; `wardrobe_results`: select,insert,delete;
  funktioner: `revoke from public, anon` + `grant execute to authenticated`).
- **Afhængigheder/forudsætninger:** `profiles`-tabellen + `auth.users` + `model-images`
  bucket **findes allerede (uden for repoet)**.
- **Idempotens:** ja (guards overalt). **Status: `CURRENT`** (kerne-byggesten; al
  senere migration udbygger den).

### 2.2 `202610040002_character_bound_clothing_assets.sql` (112 linjer)

- **Formål:** bevare originale uploads + AI-ready versions pr. *character*.
- **Kolonner:** `wardrobe_items.original_path text` (+CHECK path-ejerskab, DO-guarded);
  **`reference_path` DROP NOT NULL** (nullable nu).
- **Ny tabel `wardrobe_item_ai_assets`:** `user_id`, **`item_id text`**, `character_id uuid`,
  `reference_path text NOT NULL`, `created_at`; **PK (user_id, item_id, character_id)**;
  **FK** `(user_id,item_id) → wardrobe_items(user_id,id) ON DELETE CASCADE`;
  **FK** `(user_id,character_id) → dressed_characters(user_id,id) ON DELETE CASCADE`;
  **CHECK** path-ejerskab.
- **RLS:** SELECT/INSERT/UPDATE/DELETE til authenticated (INSERT/UPDATE med
  `WITH CHECK` på både uid og path-præfix). Grants til authenticated.
- **Dataændring (engang):** backfill-`INSERT … JOIN primary character … ON CONFLICT
  DO NOTHING` (kopierer eksisterende `reference_path` til nye asset-rows).
- **Status: `CURRENT`** — men tabellen blev senere **omdøbt** af0010 (se der);
  idempotent.

### 2.3 `202610040005_clothing_previews_and_asset_versions.sql` (47 linjer)

- **Kolonner:** `wardrobe_items.preview_path text` (+DO-guardet path-CHECK);
  `wardrobe_item_ai_assets.generation_version smallint` (+DO-guardet CHECK `>0`, NULL = legacy).
- **Data:** ingen (eksisterende preview = NULL, assets = legacy).
- **Status: `CURRENT`**, idempotent.

### 2.4 `202610040008_clothing_ai_generation_commit.sql` (115 linjer)

- **Formål:** tæl clothing-kvote **kun** når en current-version AI-ready asset er gemt.
- **Funktioner:** `reserve_clothing_ai_generation()` (definer; returnerer
  `reservation_started_at = clock_timestamp()` som token; **øger IKKE `used_count`
  ved reservation**); `finish_clothing_ai_generation(p_reservation_started_at,
  p_succeeded)` (definer; `+1` kun ved success; matcher token). Grants til authenticated.
- **Status: `SUPERSEDED`** — `reserve_…` blev redefineret af0015 og igen af
  `202610050001`; `finish_clothing_ai_generation(timestamptz,boolean)` blev
  **revoked fra alle kunder** af0011 og erstattet af `finish_clothing_ai_generation_server`.
  Den gamle funktion **findes stadig men er ukaldelig** (død kode i DB). Idempotent.

### 2.5 `202610040010_base_type_clothing_assets.sql` (196 linjer)

- **Formål:** "character-bound" assets → **base-type** assets (genbrugelige pr. køn).
- **Struktur:** **RENAME** `wardrobe_item_ai_assets` → **`wardrobe_item_ai_assets_legacy`**
  (+ PK-constraint omdøbes) — data bevares (Rule4: legacy bevares bevidst).
  `wardrobe_results`: + `character_id uuid`, + `outfit_key text` + DO-guardet **FK**
  `(user_id,character_id) → dressed_characters(user_id,id) CASCADE`.
- **Ny tabel `wardrobe_item_ai_assets`:** `user_id → auth.users CASCADE`, `item_id text`,
  `base_type text CHECK ∈ {woman,man}`, `reference_path text NOT NULL`,
  **`generation_version int NOT NULL CHECK >0`**, `created_at/updated_at`;
  **PK (user_id, item_id, base_type)**; FK `(user_id,item_id) → wardrobe_items CASCADE`;
  CHECK path-ejerskab.
- **RLS (ny tabel):** **kun** SELECT + DELETE-policies til authenticated
  (`revoke all` + `grant select, delete`); **INSERT/UPDATE kun for `service_role`**
  (`grant … to service_role`) ⇒ server-skrivning er bevidst den eneste vej.
- **Ny tabel `dressed_base_forms`:** `base_type text PK CHECK ∈ {woman,man}`,
  `storage_path text NOT NULL UNIQUE CHECK ∈ {de2 stier}`, `created_at`;
  RLS SELECT `using(true)`; seed:2 rækker (IKKE `on conflict`).
- **Storage policy:** `storage.objects` SELECT-policy for de2 base-form-filer i bucket
  `model-images`.
- **Funktion:** `delete_dressed_character(uuid)` (definer; rydder legacy-assets,
  results, `reference_path=NULL`-markering, forfremmer replacement-primary,
  opdaterer profiles; revoke + grant authenticated).
- **Dataændringer:** rename (bevarer data), seed af2 base-form-rækker.
- **Idempotens: NEJ — én-gangs-migration** (`rename` fejler ved genkørsel: tabellen
  findes ikke længere; `create table` uden `if not exists`; `insert` uden `on conflict`;
  `create policy` uden drop-first). **Status: `CURRENT`** (korrekt i frisk-rekonstruktion;
  kan IKKE genkøres på en allerede-migreret DB).

### 2.6 `202610040011_secure_clothing_generation_finalization.sql` (43 linjer)

- `revoke all … finish_clothing_ai_generation(timestamptz,boolean) from public, anon,
  authenticated` — klienter kan **ikke** længere finalisere clothing-kvoter selv.
- Ny `finish_clothing_ai_generation_server(p_user_id, p_reservation_started_at,
  p_succeeded)` (definer; **guard: `auth.role() = 'service_role'`**; token-match;
  `+1` kun ved success). Grants: **kun service_role**.
- **Status: `CURRENT`** (sikkerheds-indskærpning; idempotent).

### 2.7 `202610040012_normalized_character_geometry_and_saved_outfits.sql` (250 linjer)

- **`dressed_characters`:** + `geometry_contract_version text`; **backfill:** alle
  NULL → `'legacy'`; derefter `SET DEFAULT 'normalized-v1'` + `SET NOT NULL` +
  **CHECK ∈ {legacy, normalized-v1}** (Uden guard ⇒ genkørsel fejler).
- **Ny tabel `saved_dressed_outfits`:** `user_id uuid NOT NULL` (**ingen FK til
  auth.users** — se §4-F9), `id uuid`, `character_id uuid NOT NULL`,
  `base_type text CHECK ∈ {woman,man}`, `name text CHECK (btrim1–80)`,
  `outfit_key text NOT NULL`, **`item_ids text[] NOT NULL CHECK (cardinality1–5)`**,
  `created_at/updated_at`; **PK (user_id, id)**; **UNIQUE (user_id, character_id,
  outfit_key)**; **FK** `(user_id,character_id) → dressed_characters CASCADE`.
  **Ingen FK fra item_ids → wardrobe_items** (kun værdi-referencer).
- **RLS:** enabled; policies **kun SELECT + DELETE** til authenticated
  (`revoke all` først); INSERT/UPDATE **kun via RPC** (security definer).
- **Funktioner:** `save_dressed_outfit(text, text[])` (definer; kræver primary
  character m. `geometry_contract_version='normalized-v1'`; validerer navn1–80,
  **1–5 DISTINCTE non-empty item_ids**, at hvert id **ejer­skabes af brugeren**, og at
  hvert id har `wardrobe_item_ai_assets` med `generation_version = 3` for aktiv
  base_type; `outfit_key = base_type || ':' || jsonb_agg(sorte­rede id)`; upsert
  `on conflict (user_id,character_id,outfit_key) do update`);
  `remove_saved_outfits_for_deleted_item()` (definer; sletter outfits hvor
  `item_ids @> array[old.id]`) + **trigger** `wardrobe_item_removes_saved_dressed_outfits`
  AFTER DELETE ON wardrobe_items (begge **uden drop-first-guard** ⇒ ikke idempotente);
  `publish_dressed_character` **redefineret** (sætter nu `geometry_contract_version='normalized-v1'`).
- **Dataændringer:** backfill `'legacy'` på eksisterende characters (én- gangs, men
  harmløs ved gentagelse).
- **Status: `CURRENT`** (tabel/trigger) + **`CORRECTED`** for funktionen
  `save_dressed_outfit`, som indeholdt en SQL-fejl (**42702**) der blev rettet af0014.
  **Ikke idempotent** (create table/policy/trigger/add constraint uden guards).

### 2.8 `202610040013_add_socks_category.sql` (12 linjer)

- Udvider `wardrobe_items_category_check` med `'socks'` (drop-if-exists + add;
  **ikke-destruktiv** — eksisterende rækker tilfredsstiller stadig).
- **Status: `CURRENT`**, idempotent, sikkert datamæssigt.

### 2.9 `202610040014_fix_save_dressed_outfit_ambiguity.sql` (116 linjer)

- **Korrektiv-migration:** retter `42702 column reference "character_id" is ambiguous`
  i `save_dressed_outfit` (rets­tem­plerede `RETURNS TABLE`-kolonnenavne kolliderer med
  tabellen i `ON CONFLICT`). **Eneste ændring vs.0012: `#variable_conflict use_column`**
  (linje22). Samme signatur ⇒ `create or replace` bevarer grants. **Ingen
  tabel/policy/RLS/data-ændringer** (jf. filens egen kommentar, linje1–4).
- **Status: `CURRENT`** (retter0012; idempotent). Se §12-kæde.

### 2.10 `202610040015_ai_quota_limits_and_owner_exemption.sql` (146 linjer)

- **Dataændring:** `ai_generation_limits`: character→**1**, tryon→**1**, clothing→**3**
  (opdaterer0001's seed3/3/3; idempotente updates).
- **Funktioner redefineret** (samme signatur/grants): `reserve_ai_generation(text)` +
  `reserve_clothing_ai_generation()` med **owner-exemption**:
  `is_owner = coalesce((auth.jwt() -> 'app_metadata' ->> 'is_owner') = 'true', false)`
  ⇒ ejer springer `limit_reached` over (forbrug tælles stadig; in-progress-lås gælder).
- **Status: `CURRENT`** (reserverings-funktionerne) — men se **§4-F6**: en kommentar i
  `202610050001` hævder andre limits end denne migration producerer (mulig live-drift).

### 2.11 `202610040016_background_ai_generation_finalization.sql` (51 linjer)

- Ny `finish_ai_generation_server(p_user_id, p_generation_type,
  p_reservation_started_at, p_succeeded)` (definer; guard `auth.role()='service_role'`;
  kun `character`/`tryon`; **failed ⇒ `used_count-1` credit-back** (`greatest(…-1,0)`);
  token-match; errcodes 42501/22023). Grants: **kun service_role**. Kommentar:
  køres fra en **Netlify Background Function**.
- **Ingen skema/policy/data-ændringer.** **Status: `CURRENT`**, idempotent.

### 2.12 `202610050001_clothing_quota_override_test_user.sql` (122 linjer)

- **Ny tabel `ai_generation_limit_overrides`:** `user_id uuid PK → auth.users CASCADE`,
  `clothing_free_limit int NOT NULL CHECK >0`, `created_at`; **RLS enabled med
  BEVIDST INGEN policies** (deny-all; kommentar linje24–26) + `revoke all` fra
  anon/authenticated + `grant select to service_role`.
- **Seed-data:** én række `(619b975b-ce2b-4e62-99dc-7bb0ddcb4c80, 100)` (testkonto,
  "temporary"; upsert `on conflict do update`). **Data i migration — bemærk: forbliver
  i DB indtil fjernet.**
- `reserve_clothing_ai_generation()` redefineret: læser override **efter** global
  null-check (bevidst undgår `SELECT … INTO` NULL-fælde, jf. kommentar linje66–69);
  holder owner-exemption. **`reserve_ai_generation(text)` røres IKKE.**
- **Status: `CURRENT` (midlertidig ved design)**, idempotent. Se §4-F6 (kommentar-vs-repo
  limits-modstrid).

### 2.13 `202610050002_wardrobe_items_placement.sql` (57 linjer) — se også §5

- `alter table wardrobe_items ADD COLUMN IF NOT EXISTS placement jsonb;` (nullable;
  ingen default; ingen rækker overskrives) + kolonne-kommentar.
- DO-guarded **CHECK `wardrobe_items_placement_check`** (linje14–57): NULL OK ellers
  `jsonb_typeof='object'`, alle4 nøgler præcist (`(placement - 'anchor' - 'x' - 'y'
  - 'scale') = '{}'`), anchor ∈15 værdier, x/y ±60, scale0.4–2 — og den kendte fejl:
  **`jsonb_typeof(placement -> 'anchor') = 'text'`** (linje33).
- PK/FK/triggers/grants/RLS **ikke rørt** (kommentar linje4–6).
- **Status: kolonne `CURRENT`; CHECK `CORRECTED` af0003** (se §5). Idempotent.

### 2.14 `202610050003_fix_wardrobe_items_placement_check.sql` (62 linjer) — se også §5

- `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT wardrobe_items_placement_check`
  med **`jsonb_typeof(placement -> 'anchor') = 'string'`** (linje19); øvrig semantik
  identisk (15 anchors via `= ANY(ARRAY[…])`, x/y ≥-60 ≤60, scale ≥0.4 ≤2, exact-keys,
  NULL OK). Ikke `NOT VALID` ⇒ validéres ved tilføjelse (alle eksisterende rækker er
  NULL ⇒ består). Idempotent.
- **Status: `CURRENT` (korrektiv).** Se §6 for live-verifikations-status.

### 2.50 STATUSOVERSIGT

| # | Migration | Status | Hvorfor |
|---|---|---|---|
|1|0001 dressed_ai_wardrobe|`CURRENT`|Kerne; idempotent; bygger på objekter uden for repoet|
|2|0002 character_bound|`CURRENT`|Aktiv legacy-tabel efter0010-rename; backfill kun én gang|
|3|0005 previews/versions|`CURRENT`|Aktive kolonner|
|4|0008 generation commit|`SUPERSEDED`|Funktioner redefineret af0011/0015/202610050001|
|5|0010 base_type assets|`CURRENT`|Aktiv; **ikke idempotent** (én-gangs)|
|6|0011 secure finalization|`CURRENT`|Aktiv service-role-guard|
|7|0012 geometry+outfits|`CURRENT` + funktion `CORRECTED`|save_dressed_outfit rettet af0014; ikke idempotent|
|8|0013 socks|`CURRENT`|Aktiv udvidet CHECK|
|9|0014 ambiguity fix|`CURRENT` (korrektiv)|Retter0012's42702|
|10|0015 quota+owner|`CURRENT`|Aktiv; limits evt. driftet live (§4-F6)|
|11|0016 background finalization|`CURRENT`|Aktiv service-role-funktion|
|12|202610050001 quota override|`CURRENT` (midlertidig ved design)|Seedet testrække + override-tabel|
|13|202610050002 placement|kolonne `CURRENT`; CHECK `CORRECTED`|Fejlslagen CHECK rettet af0003|
|14|202610050003 placement fix|`CURRENT` (korrektiv)|'text' → 'string'|
| — |worktree-kopier (10 stk.)|`DUPLICATE` (forældet)|Ikke autoritativ;0015 kun CRLF-forskel|
| — |DRESSED-SUPABASE-IMPLEMENTATION-PLAN (M0–M6)|`UNVERIFIED` / NOT APPLIED|Planlagt SQL, aldrig kørt|

---

## 3. REPOSITORY VS. FAKTISK DATABASE

### VERIFIED IN REPOSITORY
- Alle14 migrations' indhold (læst linje-for-linje i denne runde).
- Ingen SQL findes andre steder i repoet (src =0 DDL/DML; git har aldrig slettet .sql).
- Appens forventninger: kolonner `placement`/`preview_path`/`original_path`,
  tabeller `wardrobe_item_ai_assets` (+`_legacy`), `saved_dressed_outfits`,
  `dressed_base_forms`, `ai_generation_limit_overrides` + de beskrevne RPC'er
  (kald fundet i `generation-usage.ts`, `usage.ts`, `outfits/index.ts`,
  `characters/[id].ts`).
- Koden **håndterer bevidst manglende kolonner** (`42703`/`PGRST204`-fallback for
  `placement` i GET og for `preview_path` i GET/DELETE) ⇒ kode + repo er
  bevidst-afkoblet fra præcis-exakt live-skema.

### VERIFIED IN DATABASE
**Ingenting i denne runde** (der er ikke kørt SQL eller inspiceret databasen —
forbudt i denne opgave; projektet er heller ikke linked via `supabase/config.toml`).
**Tidligere live-beviser (fra brugerens egne tests, dokumenteret i
`analysis/DRESSED-CURRENT-STATUS.md`):** `ADJUST → DONE → PATCH200 → refresh →
samme placement` med `{"x":0,"y":-4.2106,"scale":0.63,"anchor":"torso"}` ⇒
**INFERRED: `wardrobe_items.placement` findes live, er jsonb, og den
rettede CHECK aktiv** (anden mulighed ville give23514/503 igen).

### INFERRED (udledt, ikke direkte verificeret)
- `0003` er kørt på live (følge af PATCH200; også brugerens udsagn i forrige runde).
- Alle14 migrations er kørt i rækkefølge på live (appens funktionelle adfærd
  forudsætter dem alle: f.eks. `socks`-kategori, `save_dressed_outfit`-upsert,
  base-forms-tabel, background-funktioner).
- Storage-policy for **uploads** til bucket `model-images` (kræves af
  `client.storage.upload` i POST-items) **findes live**, men er **ikke i nogen
  migration** ⇒ oprettet uden for version control.
- `profiles`-tabellen + dens RLS + evt. auth-trigger findes live (0001 kan ikke
  køre uden dem), men er **ikke i repoet**.
- `ai_generation_limits` live-værdier ≈ (1,3,1) efter0015 — men kommentaren i
  `202610050001` modsiger (se §4-F6).

### UNVERIFIED (kan ikke kontrolleres her)
- Faktisk `pg_constraint`-tilstand for `wardrobe_items_placement_check`
  (navn/definition/`convalidated`/om en gammel version stadig findes).
- Om worktree-KOPIEN eller mappen `supabase/.temp` har betydning for live.
- Alle RLS-policies' faktiske live-tekst (kan afvige fra migrations).
- Forekomst/indhold af tabeller nævnt i implementeringsplanen (ikke implementeret).
- `wardrobe_items`-kolonner udover dem migrations skaber (evt. manuelt tilføjede).

---

## 4. HISTORISKE SQL-FEJL (kritisk analyse)

### F1 — Placement-CHECK afviste gyldige værdier (`202610050002` → rettet i `202610050003`)

- **Migration:** `202610050002_wardrobe_items_placement.sql`, linje33.
- **Fejl:** `jsonb_typeof(placement -> 'anchor') = 'text'`.
- **Root cause:** `jsonb_typeof()` returnerer JSON-typenavne — `object`, `array`,
  `string`, `number`, `boolean`, `null`. **PostgreSQL returnerer `'string'` for en
  JSONB-string**; `'text'` er navnet på en *PostgreSQL-datatype*, ikke et
  `jsonb_typeof`-resultat. Betingelsen var derfor **altid false** for enhver
  non-null placement (alle øvrige led kunne være sande — ét falsk led falsificerer
  hele `AND`-kæden).
- **Konsekvens:** enhver gyldig `{anchor,x,y,scale}`-opdatering ramte
  **`23514 check_violation`** → PATCH-indekset (`[id].ts:206–211`) svarede generisk
  **503** ("Could not save this placement.") → **0 rækker nogensinde skrevet** →
  placement levede kun i session og forsvandt ved refresh. GET's `placement: null`
  var "korrekt" (ingen værdier) — hvilket skjulte fejlen yderligere.
- **Rettelse:** `202610050003_fix_wardrobe_items_placement_check.sql` — samme
  constraint-navn, `DROP IF EXISTS` + `ADD` med `= 'string'` (linje19); alt andet
  identisk semantik.
- **Nuværende status:** **`CORRECTED`** i repoet. Live: **INFERRED** kørt
  (PATCH200 bekræftet af bruger) — direkte inspektion **UNVERIFIED** (§6).
- **VIGTIGT:** Kolonnen `placement` er og var korrekt **`jsonb`**. Fejlen var
  **i valideringen af JSONB-indholdet**, ikke i datatypen.

### F2 — `save_dressed_outfit` fejlede med42702 (`202610040012` → rettet i `202610040014`)

- **Migration:** `202610040012…`, funktion linje53–161.
- **Fejl:** `SQLSTATE 42702 column reference "character_id" is ambiguous`
  (fil-kommentar i0014, linje1–2).
- **Root cause:** `RETURNS TABLE (… character_id …)` skaber PL/pgSQL-variabler med
  samme navn som tabellens kolonner; i `ON CONFLICT (user_id, character_id,
  outfit_key) … RETURNING …` blev navnet uklart.
- **Konsekvens:** `save_dressed_outfit`-oprettelse af/upsert af outfits **fejlede**
  indtil0014 kørte (gem-outfit-flowet nede for alle brugere i mellemtiden).
- **Rettelse:** `202610040014` — kun `#variable_conflict use_column` (linje22);
  samme signatur, `create or replace` bevarer grants; ingen skemaændringer.
- **Nuværende status:** **`CORRECTED`** (0012's funktion er `SUPERSEDED` af0014).

### F3 — RLS `WITH CHECK` på `reference_path` vs. nuværende indsatser med NULL

- **Migration/kode:** `202610040001` (INSERT- og UPDATE-policies, linje193–209:
  `WITH CHECK auth.uid()=user_id AND split_part(reference_path,'/',1)=auth.uid()`)
  vs. `202610040002` (linje9–10: **`reference_path DROP NOT NULL`**) vs.
  `src/pages/api/wardrobe/items/index.ts:481–491` (POST-**upsert med
  `reference_path: null` via den RLS-scoped bruger-klient**, `authentication.client`,
  linje386–393).
- **Fejl/analyse:** `split_part(NULL,'/',1)` = NULL → `NULL = uid` = NULL →
  `WITH CHECK`-udtrykket er ikke TRUE → **RLS ville afvise både INSERT og UPDATE
  af rækker med `reference_path IS NULL`** — præcis de rækker, de nuværende flows
  skriver (PATCH-kodekommentaren `[id].ts:144–147` siger eksplicit: *"the owner-RLS
  UPDATE policy carries a WITH CHECK on reference_path, which is NULL for every
  item created by the current flows"*).
- **Konsekvens (mulig, repository-internal modstrid):** (a) under strengt
  migrations-ægte RLS ville POST-items afvises (500) og navne-`update`-grenen
  (linje475–480) ville afvises; (b) PATCH virker **fordi** den kører på
  service-klienten (§7). At item-skabelse alligevel virker live peger på, at
  **live's INSERT/UPDATE-policy afviger fra migrationsteksten** (manuelt rettet
  engang) — men det er **INFERRED / UNVERIFIED**, ikke bekræftet.
- **Rettelse:** **ingen** (dokumenteres kun i denne runde; ingen kode- eller
  DB-ændring må foretages uden godkendelse — Rule7).
- **Nuværende status:** **`UNVERIFIED` (live-adfærd)**; repo-spend er
  **VERIFIED IN REPOSITORY** (teksten ovenfor er læst direkte).

### F4 — Centrale database-objekter eksisterer uden for version control

- **Fund:** ingen migration opretter `profiles` (kun `alter … add gender`);
  `DRESSED-SUPABASE-ANALYSIS.txt:17,87–88` konstaterer samme: "NO live database
  was queried" og at `CREATE TABLE`/RLS/auth-trigger for `profiles` er
  `[UNKNOWN — must be read from the live database]`. Ingen migration opretter
  bucket `model-images` eller **upload-policies** på `storage.objects` (kun
  base-form-SELECT-policy i0010 findes i repoet), selvom POST-items kalder
  `client.storage.upload` (index.ts:461–467).
- **Root cause:** skemaet fandtes (ad-hoc/dashboard- eller tidlig DB-first fase)
  før migrations kom i git ("first commit").
- **Konsekvens:** en frisk database bygget **kun** fra repoet er ikke
  komplet (0010's storage-policy fejler f.eks. hvis bucket ikke findes;
  0001 fejler uden `profiles`). Reconstruction-guiden (§11) markerer dette.
- **Nuværende status:** `UNVERIFIED` (live-objekter inspiceres ikke her) —
  **`VERIFIED IN REPOSITORY` at de mangler i repoet.**

### F5 — Ikke-idempotente migrations (kan ikke genkøres sikkert)

- **Migrationer:** `202610040010` (rename af tabel + `create table` uden
  `if not exists` + `insert` uden `on conflict` + `create policy` uden drop-first)
  og `202610040012` (`add constraint` uden DO-guard, `create table saved_dressed_outfits`
  + `create policy` + `create trigger` uden guards).
- **Root cause:** ingen gennemgående idempotens-standard; flere migrations er
  "engangs" efter design.
- **Konsekvens:** genkørsel på en allerede-migreret DB fejler (`already exists` /
  `relation does not exist`) — uhensigtsmæssigt ved fejlretning, men **harmløst ved
  frisk-rekonstruktion** (køres én gang i rækkefølge).
- **Rettelse:** ingen (historisk bevaret). **Status: `CURRENT` med forbehold** —
  dokumenteret; nye migrations bør være idempotente (regel, ikke ændring her).

### F6 — Kvote-limits: migration-kæde vs. migration-kommentar (mulig live-drift)

- **Fund:** `0015` sætter (character**1**, clothing**3**, tryon**1**), men
  `202610050001`'s indledende kommentar (linje3–5) hævder at **(character=3,
  clothing=5, tryon=1) "stay exactly as they are"**.
- **Root cause (ukendt):** enten (a) limits blev ændret manuelt i live-DB'en mellem
  migrationerne, (b) kommentaren er forældet/forkert, eller (c) begge.
- **Konsekvens:** repoet alene kan ikke fastslå de faktiske live-kvoter;
  dokumentation/forventninger kan afvige fra virkeligheden.
- **Status: `UNVERIFIED`** (limits-inspektion = SQL = forbudt her). Intet rettet.

### F7 — Duplikat-migrations i `.kilo`-arbejdstræet

- **Fund:**10 kopi-filer i `.kilo/worktrees/quilt-ticket/supabase/migrations/`
  (0001–0015, mangler0016 +2026-filer).9/10 hash-identiske med hovedmappen;
  `0015` afviger **kun** i linjeafslutning (CRLF vs LF — `git diff --no-index`
  viser ingen indholdsændring).
- **Konsekvens:** risiko for at redigere/rapportere fra den forkerte kopi;
  arbejdstræet er et **forældet snapshot**.
- **Status: `DUPLICATE` (ikke autoritativt).** Ikke slettet her (Rule4/Rule5:
  ingen sletninger uden godkendelse).

### F8 — Ingen ikke-unikke indexes (observation)

- **Fund:** repoet opretter **kun** unikke indexes/PK'er
  (`dressed_characters_one_primary_per_user`, PK'ere, `unique
  (user_id,character_id,outfit_key)`, `unique(storage_path)`). Ingen index på
  f.eks. `wardrobe_results.item_ids` (bruges af `contains(...)`/`@>` i DELETE-items
  `[id].ts:79–83` og triggeren), `created_at`-sortering eller `wardrobe_items(user_id)`.
- **Konsekvens:** kun performance ved skala (seq-scan); ingen datafejl.
- **Status: observation — ingen fejl, ingen ændring.**

---

### F9 — `saved_dressed_outfits.user_id` mangler FK (observation)

- **Fund:** `0012:20` skriver `user_id uuid not null` **uden** `references
  auth.users(id)` — modsat øvrige tabeller i0001.
- **Konsekvens:** teoretisk mulighed for forældeløse rækker; **delvist mitigeres**
  af FK'en `(user_id,character_id) → dressed_characters … CASCADE` (bruger-sletning
  cascade'er dressed_characters → outfits).
- **Status: `manglende constraint` (lav alvor); dokumenteres — ingen rettelse her.**

---

## 5. PLACEMENT-MIGRATIONERNE (ekstra grundig audit)

### Hvad `0002` (placement) skulle gøre
1. `ADD COLUMN IF NOT EXISTS placement jsonb` på `wardrobe_items` — **nullable,
   ingen default, ingen rækker overskrives** (kommentar linje1–6: "NULL means
   'use the existing clothingPlacement()/anchor defaults'").
2. Kolonnekommentar (linje11–12).
3. Ét DO-guardet `CHECK wardrobe_items_placement_check` (linje14–57).

### Den konkrete fejl
- **`0002:33`:** `and jsonb_typeof(placement -> 'anchor') = 'text'`.
- **`jsonb_typeof` returnerer `'string'`** for JSONB-strings (JSON-specens
  typenavne; PostgreSQL-castenavnet `text` er **ikke** et `jsonb_typeof`-resultat).
- `='text'` er derfor **altid false** ⇒ for enhver `placement IS NOT NULL` er hele
  `OR`-betingelsen false ⇒ **`23514`**.

### Hvordan det påvirkede placement-PATCH
- `PATCH /api/wardrobe/items/[id]`: `serviceClient.update({placement, updated_at})`
  (`[id].ts:200–205`) → DB afviser med23514 → `updateError` → **503** (linje206–211)
  + `console.error` med koden (kun serverlog). Ingen række opdateredes ⇒ session-kun
  placement ⇒ refresh = defaults. GET viste konsekvent `placement: null`
  ("ingen data" og "fejl" gav samme svar — doven signatur, kendt begrænsning).

### Hvad `0003` ændrer
- **Kun** CHECK'en: `DROP CONSTRAINT IF EXISTS wardrobe_items_placement_check`
  + `ADD CONSTRAINT` samme navn med `jsonb_typeof(placement -> 'anchor') = 'string'`
  (linje19). `= ANY(ARRAY[…])` i stedet for `IN (…)` (semantisk identisk).

### Hvad `0003` IKKE ændrer
- Ikke kolonnen (forbliver **`jsonb`**, nullable, ingen default).
- Ikke de15 anchors, ikke x/y ±60, ikke scale0.4–2.0, ikke exact-keys, ikke NULL-tilladelsen.
- Ikke PK, FK, triggers, grants, RLS, policies, indexes, øvrige tabeller.
- Ingen data-migration (rækker røres ikke; ingen `NOT VALID`-snyderi).

### Præcis validering (efter `0003` — VERIFIED IN REPOSITORY)
```text
placement IS NULL  eller  ALTID:
  jsonb_typeof(placement) = 'object'
  OG nøglerne præcis {anchor,x,y,scale}
       ((placement - 'anchor' - 'x' - 'y' - 'scale') = '{}'::jsonb)
  OG jsonb_typeof(placement -> 'anchor') = 'string'      ← det rettede led
  OG (placement ->> 'anchor') ∈ {head, face, ears, neck, shoulders, torso,
       waist, hips, left-hand, right-hand, knees, ankles, feet, full-body, dress}
     (15 anchors — samme navne som DRESSED_ANCHORS i koden)
  OG x: number ∧ -60 ≤ x ≤ 60
  OG y: number ∧ -60 ≤ y ≤ 60
  OG scale: number ∧ 0.4 ≤ scale ≤ 2.0
```
- **Datatype:** `wardrobe_items.placement = jsonb` — **korrekt og uændret.**
  Fejlen var i **valideringen af JSONB-indholdet**, aldrig i kolonnen.

### Forventet constraint-tilstand efter `0003`
`wardrobe_items_placement_check` findes præcis én gang, er **validated**
(`convalidated = true`; ingen `NOT VALID`) og matcher `0003`-teksten.
**Live: INFERRED (PATCH200) / direkte inspektion UNVERIFIED — se §6.**

---

## 6. VERIFICÉR DEN AKTUELLE PLACEMENT-CONSTRAINT

**`UNVERIFIED — database constraint could not be directly inspected.`**

Begrundelse: denne runde må ikke køre SQL eller forbinde til databasen
(ingen linked `supabase/config.toml`; ingen read-only kanal findes i projektets
værktøjer). **Man må IKKE antage at `0003` er kørt bare fordi filen findes.**

Hvad der KAN siges (klart adskilt):

| Kontrolpunkt | Fund | Klassifikation |
|---|---|---|
| `0003`-filen findes korrekt i repoet, navn `wardrobe_items_placement_check`, `DROP IF EXISTS` + `ADD`, `'string'` | Læst linje-for-linje | **VERIFIED IN REPOSITORY** |
| Live PATCH200 med `{"x":0,"y":-4.2106,"scale":0.63,"anchor":"torso"}` efter brugerens kørsel af `0003` | Brugerens dokumenterede test | **INFERRED:** rettet CHECK er aktiv live ellers23514 igen |
| `select convalidated from pg_constraint where conname='wardrobe_items_placement_check'` → forventet `true` | Ikke kørt | **UNVERIFIED** |
| `pg_get_constraintdef(...)` matcher `0003`-teksten | Ikke kørt | **UNVERIFIED** |
| Eksisterer en gammel `'text'`-version side om side? | Kan ikke ske ifølge `0003`'s `DROP CONSTRAINT IF EXISTS` **hvis den er kørt** — men selve kørslen er altså kun INFERRED | **UNVERIFIED** (kørselshistorik) |
| Migration-history stemmer med faktisk schema (alle14 kørt) | Udledt af app-adfærd | **INFERRED** |

**Anbefaling til senere (kræver særskilt godkendelse):** kør ovenstående
`pg_constraint`-slå-op som read-only SQL og notér svaret her.

---

## 7. RLS OG OWNERSHIP

### 7.1 `wardrobe_items` — policies (fra `0001`, uændrede siden)

| Operation | Policy (navn) | USING | WITH CHECK | Grant |
|---|---|---|---|---|
| SELECT | "Users can view their own wardrobe items" | `auth.uid() = user_id` | — | select |
| INSERT | "Users can insert their own wardrobe items" | — | `auth.uid() = user_id` **OG** `split_part(reference_path,'/',1) = auth.uid()` | insert |
| UPDATE | "Users can update their own wardrobe items" | `auth.uid() = user_id` | `auth.uid() = user_id` **OG** `split_part(reference_path,'/',1) = auth.uid()` | update |
| DELETE | "Users can delete their own wardrobe items" | `auth.uid() = user_id` | (ingen) | delete |

- Tabellen har desuden **egne** `CHECK`s (path-ejerskab for `reference_path`,
  `original_path`, `preview_path`) som kører uanset RLS.
- **Ingen UPDATE-policys for `reference_path` er nogensinde ændret** efter at
  `202610040002` gjorde kolonnen nullable ⇒ **se §4-F3**: `WITH CHECK`'ens
  path-led bliver NULL for de rækker nuværende flows skaber.

### 7.2 Hvorfor PATCH bruger service-klienten (aktuelt implementeret, uændret her)

- `[id].ts:140–148` (kodekommentar): *"The UPDATE itself runs on the trusted
  server client because the owner-RLS UPDATE policy carries a WITH CHECK on
  reference_path, which is NULL for every item created by the current flows;
  ownership stays enforced by the authenticated user plus the explicit user_id +
  item id filters."*
- Implementering (`[id].ts:149–219`):
  1. `authenticateSupabaseRequest(request)` → **kaldet skal bære ejerens JWT**
     (401 ellers).
  2. `placement` valideres server-side (`parsePlacement`) — 400 ved fejl.
  3. `createSupabaseServiceClient()` (service-rolle;503 hvis den ikke kan åbnes).
  4. `.update({placement, updated_at}).eq("user_id", user.id).eq("id", itemId)`
     → **ejerskab håndhæves af de to explicit-equals** (JWT → `user.id`),
     ikke af RLS.
  5. 0 rækker → 404; DB-fejl → 503 (fejl-kode kun i serverlog).
- **Sikkerhedsvurdering (dokumenteret, ikke ændret):** modellen er "JWT-validering +
  explicit owner-filtre på service-klienten" for præcis denne én operation; alt
  andet på `wardrobe_items` kører under RLS. Ingen bevilling til at ændre
  sikkerhedsmodellen (Rule7).

### 7.3 Samtlige policies (oversigt over alle14 migrations)

| Objekt | Policies | Bemærkning |
|---|---|---|
| `profiles` | **ikke i repoet** (kun `alter add gender` + trigger) | **Uden for VC — UNVERIFIED live** (F4) |
| `dressed_characters` | SELECT egne (0001) | Skrivning KUN via security-definer-funktioner (`publish/set_primary/delete`) — bevidst |
| `wardrobe_items` | S/I/U/D (0001) | Se7.1 + F3 |
| `wardrobe_results` | S/I/D (0001) | **Ingen UPDATE-policy** — appen opdaterer aldrig resultater ✓ |
| `wardrobe_item_ai_assets` (**legacy**, omdøbt0010) | S/I/U/D (0002, følger tabellen) | Kun læsning i kode (`[id].ts:68–73`) |
| `wardrobe_item_ai_assets` (ny,0010) | **kun S + D** til authenticated; I/U **kun service_role** (grants) | Server-skrivning bevidst |
| `dressed_base_forms` | SELECT `using(true)` (0010) | Read-only reference |
| `saved_dressed_outfits` | **kun S + D** (0012) | Skrivning KUN via `save_dressed_outfit` (definer) |
| `ai_generation_limits` | SELECT `using(true)` (0001) | |
| `ai_generation_usage` | SELECT egne (0001) | Skrivning via reserve/finish-funktioner |
| `ai_generation_limit_overrides` | **0 policies** (bevidst deny-all,202610050001:24–28) + revoke + grant select service_role | Brugere kan aldrig hæve egen kvote |
| `storage.objects` | SELECT for de2 base-form-filer i `model-images` (0010) | **Upload-policies mangler i repoet** (F4) |

### 7.4 Ownership-regler (samlet)
- **Row-ejerskab:** altid `user_id = auth.uid()` (eller path-præfix = uid som
  ekstra-lag); komposit-PK'er `(user_id, id)` gør ejerskab til en del af identiteten.
- **Storage-ejerskab:** `split_part(path,'/',1) = user_id` CHECKs på alle path-kolonner
  + `owner_id`-tjek i definer-funktionerne.
- **Service-rolle bruges kun:** placement-UPDATE (PATCH), job-finalisering
  (`finish_*_server`), AI-assets-skrivning, storage-signering, override-læsning,
  `set-owner.mjs` (auth admin). Altid med enten explicit ejer-filter eller
  service-role-guard i SQL.

---

## 8. SQL SAMMENHOLDT MED APPLIKATIONSKODEN

### 8.1 `wardrobe_items.id` og `user_id`
- **DB:** `id text NOT NULL`, PK `(user_id, id)` (0001:169–185).
  **Kode:** POST-validerer `body.id` som **string ≤100** (index.ts:411) og
  upserter `onConflict: "user_id,id"` (index.ts:481–490); PATCH/DELETE filtrerer
  `.eq("user_id", user.id).eq("id", itemId)` + `itemId.length > 100`-tjek
  (`[id].ts:27,159`). **MATCH ✓** — samme tekst-id gennem hele systemet.

### 8.2 `placement` — ejerskab og livscyklus
- **DB:** `wardrobe_items.placement jsonb NULL` (0002p) + CHECK (0003).
  **Kode:** GET-fragmenter `placement` m. 42703/PGRST204-fallback (index.ts:195–244);
  PATCH skriver kun `{placement, updated_at}` på service-klient m. ejer-filtre
  (`[id].ts:200–205`); klient `parsePlacement` + `saveItemPlacement` (wardrobe-ai);
  resolver `session → persisted → default` i `clothing-placement.ts` bruges af
  **både** `profile-outfits.ts` (Profile) og `wardrobe.astro` (DRESSED).
  **MATCH ✓ — arkitektur bekræftet:**
  - `placement` tilhører det enkelte **`wardrobe_items.id`** (ikke et outfit).
  - Samme item bevarer samme placement på tværs af outfits, Profile og DRESSED.
  - Placement kan ændres uafhængigt senere (PATCH per id).
  - **RESET** skriver `placement = null` → CHECK'en tillader NULL → kode
    falder tilbage til defaults ⇒ **`NULL = eksisterende default-behaviour`** ✓.
  - Saved outfits indeholder **kun `item_ids`** — ingen placement-felter findes i
    `saved_dressed_outfits` (0012), og koden opretter heller ingen ✓.

### 8.3 Outfits / clothing / Closet / DRESSED / Profile
- **`item_ids text[]`** (0001 wardrobe_results, 0012 saved_dressed_outfits) ↔ kode:
  `client.contains("item_ids", [itemId])` (`[id].ts:83`), RPC-parameter
  `p_item_ids text[]`, client sender strings ✓ **MATCH ✓**.
- `save_dressed_outfit`-validering (ejerskab + `generation_version = 3`) ↔ kode:
  outfit-oprettelse kun via RPC (`outfits/index.ts`); AI-ready `CURRENT = 3` i
  klienten ✓ **MATCH ✓**.
- Trigger0012 ↔ kode: DELETE-items sletter kun rows; triggeren rydder outfits ✓.
- Legacy-tabel: DELETE-items læser `wardrobe_item_ai_assets_legacy` (`[id].ts:69`)
  ✓ matcher0010's rename ✓.
- RPC-brug i kode (fundet): `reserve_ai_generation`, `reserve_clothing_ai_generation`,
  `finish_ai_generation`, `finish_ai_generation_server`,
  `finish_clothing_ai_generation_server`, `get_ai_generation_usage`,
  `save_dressed_outfit` + delete-RPC i `characters/[id].ts:158` — alle findes i
  migrations ✓ **MATCH ✓** (den gamle klient-`finish_clothing_ai_generation`
  kaldes aldrig af kode — konsistent med at0011 revokerede den).

### 8.4 Forskelle SQL ↔ kode (dokumenteret — IKKE rettet)
1. **`item_ids`-type:** repo = **`text[]`** — to eksisterende dokumenter skriver
   `int[]` (se §13, `DOCUMENTATION CORRECTION REQUIRED`).
2. **RLS `WITH CHECK` vs. NULL-indsatser:** §4-F3 (repo-internal; live UNVERIFIED).
3. **`profiles`/storage-policies uden for VC:** §4-F4.
4. **Kvote-limits:** §4-F6 (kommentar vs. migrations).
5. **Koden forudsætter `placement`-kolonnen** men håndterer fravær (fallback) —
   bevidst divergence-håndtering, ikke en fejl.

---

## 9. KNOWN SQL ERRORS (tabel)

| Migration | Error | Root cause | Impact | Corrected | Correction |
|---|---|---|---|---|---|
| `202610050002` (placement) | `23514` ved AL non-null placement (`jsonb_typeof(anchor)='text'`, linje33) | `'text'` er ikke et `jsonb_typeof`-resultat; PostgreSQL returnerer **`'string'`** | PATCH → 503;0 rækker skrevet; placement session-kun; refresh nulstillede | `202610050003` | Drop+add samme CHECK med `='string'`. **`CORRECTED`** (live: INFERRED kørt; inspektion UNVERIFIED) |
| `202610040012` (save_dressed_outfit) | `42702 column reference "character_id" is ambiguous` | `RETURNS TABLE`-variabler kolliderer med kolonnenavne i `ON CONFLICT` | Gem-outfit fejlede indtil0014 | `202610040014` | `#variable_conflict use_column`. **`CORRECTED`** |
| `202610040001` (RLS) + `202610040002` + POST-kode | `WITH CHECK` på `reference_path` kan afvise NULL-rækker (potentielt både INSERT og UPDATE) | `reference_path` blev nullable, men policy-en beholdt path-tjekket; nuværende flows skriver NULL | Mulig RLS-afvisning; forklarer PATCH's service-klient; live-at-skabelse-virker ⇒ sandsynlig policy-drift | **Ingen** | **Dokumenteret (F3); UNVERIFIED live; ingen ændring her** |
| (forud for repoet) | `profiles`-schema + storage-upload-policies ikke versionskontrolleret | DB-first/ad-hoc før "first commit" | Frisk-rekonstruktion fra repoet alene er ufuldstændig | **Ingen** | Dokumenteret (F4); §11 advarer |
| `202610040010`, `202610040012` | Ikke-genkørlige migrations (`already exists` / `relation does not exist`) | Manglende idempotens-guards | Kan ikke repareres ved genkørsel på migreret DB | **Ingen** | Dokumenteret (F5); frisk-rekonstruktion ok |
| `202610050001` (kommentar) | Kommentar modsiger0015's limits (`3/5/1` vs `1/3/1`) | Ukendt: manuel live-ændring ELLER stal/fejl i kommentar | Uklarhed om faktiske live-kvoter | **Ingen** | Dokumenteret (F6); UNVERIFIED |
| `.kilo`-kopi (10 filer) | Duplikat-migrationssæt (forældet;0015 kun CRLF) | Arbejdstræ-snapshot | Risiko for redigér/rapportér fra forkerte fil | **Ingen** | Dokumenteret (F7); `DUPLICATE` |
| (hele repoet) | Ingen ikke-unikke indexes | Ikke prioriteret | Seq-scan ved skala (f.eks. `item_ids @>`) | **Ingen** | Dokumenteret (F8) — observation |
| `202610040012` | `saved_dressed_outfits.user_id` mangler FK til `auth.users` | Udeladt i DDL | Mulige forældeløse rækker (delvis dækket af character-CASCADE) | **Ingen** | Dokumenteret (F9) — observation |

---

**Bemærk:** Placering-fejlen (række1 i §9) er den eneste historiske fejl med
**bekræftet live-påvirkning OG bekræftet rettelse** — projektets verificerede
hovedfejl i SQL-historikken.

## 10. CURRENT DATABASE CONTRACT

> **Læsemåde:** alt nedenfor er **VERIFIED IN REPOSITORY** (læst direkte fra
> migrations med linjecitater) og udgør den **forventede** kontrakt applikationen
> bygger på. **Live-tilstanden er INFERRED/UNVERIFIED** (§3/§6) — ingen tabel nedenfor
> er inspiceret i databasen. Hvor live-adfærd har givet bevis, markeres det.

### `profiles` — [DELVIS EKSTERN] `EXPECTED/INFERRED`
- **Purpose:** brugerprofil (identitet, kilde-foto, model-status).
- **Kendte kolonner (brugt af kode/migrations):** `user_id uuid` (PK antages,
  **inferred**), `gender text` + `profiles_gender_check ∈ {woman,man}`
  (0001:5–21, DO-guardet), `source_photo_path`, `model_photo_path`,
  `model_generation_status` (eksisterede før repoet — 0001:3).
- **Triggers:** `profiles_gender_is_locked` (0001:36–39).
- **RLS: `ikke i repoet` → UNVERIFIED** (F4).
- **Ownership:** `user_id = auth.uid()` (antages ud fra kode-brug — INFERRED).

### `dressed_characters` — `EXPECTED` (0001 + 0012)
- **Purpose:** personlige AI-modeller pr. bruger.
- **Kolonner:** `user_id uuid NOT NULL → auth.users CASCADE`,
  `id uuid NOT NULL DEFAULT gen_random_uuid()`, `model_path text NOT NULL`,
  `gender text NOT NULL CHECK ∈ {woman,man}`, `is_primary bool NOT NULL DEFAULT false`,
  `created_at timestamptz NOT NULL DEFAULT now()`,
  `geometry_contract_version text NOT NULL DEFAULT 'normalized-v1'`
  (0012:4–17; backfill `'legacy'` først) + `CHECK ∈ {legacy, normalized-v1}`.
- **PK:** `(user_id, id)` · **Unique:** partiel index
  `dressed_characters_one_primary_per_user (user_id) WHERE is_primary`.
- **CHECK:** `split_part(model_path,'/',1) = user_id::text`.
- **RLS:** enabled; policy **kun SELECT** egne (0001:57–62); grants select only.
- **Ownership:** skrivning kun via definer-RPC'er (`publish_dressed_character`,
  `set_primary_dressed_character`, `delete_dressed_character`).

### `wardrobe_items` — `EXPECTED` + placement **INFERRED LIVE**
- **Purpose:** ét clothing item = identitet for alt tøj (ADD/Profile/Closet/DRESSED).
- **Kolonner:** `user_id uuid NOT NULL → auth.users CASCADE`;
  **`id text NOT NULL`**; `name text NOT NULL CHECK char_length1–100`;
  `category text NOT NULL CHECK ∈` **21 værdier** (0013 tilføjer `'socks'` til0001's20);
  `reference_path text` (**NOT NULL i0001; nullable fra0002**);
  `original_path text` (0002); `preview_path text` (0005);
  `created_at/updated_at timestamptz NOT NULL DEFAULT now()`;
  **`placement jsonb NULL`** (0002p) — *live: INFERRED til stede (PATCH200), kolonne+CHECK forventes som0003.*
- **PK:** `(user_id, id)` · **Ingen FK udover user_id** · **Ingen unique udover PK**.
- **CHECKs:** path-ejerskab for `reference_path`/`original_path`/`preview_path`;
  **`wardrobe_items_placement_check`** (efter0003: exact-keys `{anchor,x,y,scale}`,
  anchor ∈15, x/y ±60, scale0.4–2, NULL OK — se §5).
- **Indexes:** kun PK · **RLS:** S/I/U/D (se §7.1; INSERT/UPDATE med path-WITH-CHECK — F3).
- **Ownership:** `user_id = auth.uid()` + path-præfix + (placement: service-klient
  m. explicit `user_id,id`-filtre, §7.2).

### `wardrobe_results` — `EXPECTED` (0001 + 0010)
- **Purpose:** AI-resultat-billeder (browser-composed outfits m.m.).
- **Kolonner:** `user_id → auth.users CASCADE`, `id uuid DEFAULT gen_random_uuid()`,
  **`item_ids text[] NOT NULL CHECK cardinality1–5`**, `result_path text NOT NULL`,
  `created_at`; + `character_id uuid`, `outfit_key text` (0010) + DO-guardet FK
  `(user_id,character_id) → dressed_characters CASCADE`.
- **PK:** `(user_id, id)` · **CHECK:** path-ejerskab.
- **RLS:** S/I/D (ingen UPDATE) · **Ownership:** uid + path-præfix.

### `wardrobe_item_ai_assets` (aktiv) — `EXPECTED` (0010)
- **Purpose:** AI-ready layer pr. `(item, base_type)` med versionskontrakt.
- **Kolonner:** `user_id → auth.users CASCADE`, `item_id text NOT NULL`,
  `base_type text NOT NULL CHECK ∈ {woman,man}`, `reference_path text NOT NULL`,
  **`generation_version int NOT NULL CHECK >0`** (koden/RPC kræver **= 3** for "current"),
  `created_at/updated_at DEFAULT now()`.
- **PK:** `(user_id, item_id, base_type)` · **FK:** `(user_id,item_id) →
  wardrobe_items CASCADE` · **CHECK:** path-ejerskab.
- **RLS:** SELECT + DELETE til authenticated; **INSERT/UPDATE kun service_role**
  (0010:60–62) · **Ownership:** uid + serviceklient-skrivning fra AI-pipen.

### `wardrobe_item_ai_assets_legacy` — `EXPECTED` (0002 + omdøbt i0010)
- **Purpose:** bevaret character-bound historik (**bevidst ikke slettet** — Rule4).
- **Struktur:** som0002 (`PK (user_id,item_id,character_id)`, to FK'er, path-CHECK,
  `generation_version` nullable smallint fra0005) efter `RENAME` + PK-omdøbelse (0010:3–8).
- **RLS:** S/I/U/D (følger tabellen); koden bruger kun SELECT.
- **Status:** `CURRENT` som legacy; data ryddes af `delete_dressed_character`.

### `dressed_base_forms` — `EXPECTED` (0010)
- **Purpose:** reference til kanoniske master forms (geometry source of truth).
- **Kolonner:** `base_type text PK CHECK ∈ {woman,man}`,
  `storage_path text NOT NULL UNIQUE CHECK ∈ {'system-reference/base-forms/woman.png',
  'system-reference/base-forms/man.png'}`, `created_at DEFAULT now()`.
- **Seed:**2 rækker (0010:86–89) · **RLS:** SELECT `using(true)`; revoke anon.
- **Relateret:** storage-SELECT-policy for de2 filer i bucket `model-images` (0010:91–101).

### `saved_dressed_outfits` — `EXPECTED` (0012 + funktion0014)
- **Purpose:** navngivne outfit-sæt = **kun referencer til items**.
- **Kolonner:** `user_id uuid NOT NULL` (**mangler FK — F9**), `id uuid DEFAULT gen_random_uuid()`,
  `character_id uuid NOT NULL`, `base_type CHECK ∈ {woman,man}`,
  `name text CHECK btrim1–80`, `outfit_key text NOT NULL`,
  **`item_ids text[] NOT NULL CHECK cardinality1–5`** (kun id-værdier; **ingen placement**),
  `created_at/updated_at`.
- **PK:** `(user_id, id)` · **UNIQUE:** `(user_id, character_id, outfit_key)` ·
  **FK:** `(user_id,character_id) → dressed_characters CASCADE` · **Ingen FK fra item_ids.**
- **RLS:** SELECT + DELETE til authenticated; skrivning kun via `save_dressed_outfit`
  (definer,0014-versionen med `#variable_conflict`).
- **Trigger-kæde:** sletning af `wardrobe_items` → `remove_saved_outfits_for_deleted_item`
  sletter outfits der nævner id'et (`item_ids @> array[old.id]`).

### `ai_generation_limits` — `EXPECTED` (0001 + opdateret0015)
- `generation_type text PK CHECK ∈ {character, clothing, tryon}`;
  `free_limit int NOT NULL CHECK ≥0`; seed3/3/3 (0001) → **opdateret til1/3/1 (0015)**;
  RLS: SELECT `using(true)`. *Live-værdier: UNVERIFIED (F6).*

### `ai_generation_usage` — `EXPECTED` (0001 + funktionerne0008/0011/0015/0016/202610050001)
- PK `(user_id, generation_type)`; FK → limits; `used_count int DEFAULT0 ≥0`;
  `in_progress bool DEFAULT false`; `started_at/updated_at`.
- RLS: SELECT egne; skrivning via reserve/finish (definer; servervarianter
  service-role-guardede, token-match, credit-back ved failure).

### `ai_generation_limit_overrides` — `EXPECTED` (202610050001)
- PK `user_id → auth.users CASCADE`; `clothing_free_limit int NOT NULL >0`;
  `created_at`; **RLS enabled uden policies (deny-all)** + revoke + grant select
  service_role; seed:1 testrække (uuid `619b975b-…`,100).

---

## 11. SQL RECONSTRUCTION GUIDE

> **Princip:** kun SQL der FAKTISK findes i repoet gengives/nævnes her.
> **Der opfindes aldrig SQL for at udfylde huller** — huller markeres eksplicit.

### 11.1 Forudsætninger FØR migrations (findes IKKE i repoet — kan ikke rekonstrueres her)
1. Supabase-projekt + `auth.users` (platform).
2. **`profiles`-tabellen** med `source_photo_path`, `model_photo_path`,
   `model_generation_status` (+ dens RLS og evt. auth-trigger): **tekst ukendt —
   UNVERIFIED.** *Skal eksporteres fra live-DB (`pg_dump`) før en rekonstruktion
   kan gennemføres komplet — opfind ikke nyt SQL for den.*
3. **Storage-bucket `model-images`** + **upload-policies** for authenticated:
   **tekst ukendt — UNVERIFIED** (kun base-form-SELECT findes i repoet).
4. Miljø: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (`.env.example`).

### 11.2 Korrekt migrationsrækkefølge (filnavnene er timestamps — køres i dette navne-sortiment)
```text
1.  202610040001_dressed_ai_wardrobe.sql                      (tabeller + RLS + RPC + trigger profiles)
2.  202610040002_character_bound_clothing_assets.sql          (original_path, ref nullable, legacy-assets + backfill)
3.  202610040005_clothing_previews_and_asset_versions.sql     (preview_path, generation_version)
4.  202610040008_clothing_ai_generation_commit.sql            (clothing reserve/finish-token)
5.  202610040010_base_type_clothing_assets.sql                (RENAME→legacy, ny assets-tabel, dressed_base_forms+seed,
                                                              storage-policy [kræver bucket!], delete-funktion)
6.  202610040011_secure_clothing_generation_finalization.sql  (revoker klient-finish; server-variant)
7.  202610040012_normalized_character_geometry_and_saved_outfits.sql
8.  202610040013_add_socks_category.sql                       (category-CHECK genoprettes m. socks)
9.  202610040014_fix_save_dressed_outfit_ambiguity.sql        (retter0012's funktion — SKAL komme efter0012)
10. 202610040015_ai_quota_limits_and_owner_exemption.sql
11. 202610040016_background_ai_generation_finalization.sql
12. 202610050001_clothing_quota_override_test_user.sql
13. 202610050002_wardrobe_items_placement.sql                 (kolonne + KENDT-FEJLET CHECK)
14. 202610050003_fix_wardrobe_items_placement_check.sql       (obligatorisk EFTER 13)
```

### 11.3 Tabeller vs. constraints vs. indexes vs. RLS vs. functions
- **Tabeller oprettes i ovenstående rækkefølge** (0001: dressed_characters,
  wardrobe_items, wardrobe_results, ai_generation_limits, ai_generation_usage →
  0002: wardrobe_item_ai_assets [senere legacy] → 0010: ny assets + dressed_base_forms
  → 0012: saved_dressed_outfits → 202610050001: ai_generation_limit_overrides).
- **Constraints** følger tabellerne (path-CHECKs + PK/FK) med3 senere
  constraint-skift: **0013** (category-liste udvides), **0002p+0003p**
  (`wardrobe_items_placement_check` — køres **kun som par**,0003 er obligatorisk),
  og 0012's `geometry_contract_version`-CHECK.
- **Indexes (alle unikke):** `dressed_characters_one_primary_per_user`,
  PK'er, `unique(user_id, character_id, outfit_key)`, `unique(storage_path)`.
  **Ingen øvrige findes i repoet** (F8 — tilføj ikke nye uden godkendelse).
- **RLS-policies:** som §7.3 — plus **de to manglende sæt** (profiles, storage-upload)
  som SKAL hentes fra live, ikke opfindes.
- **Funktioner (i rækkefølge, `create or replace`-lag):** prevent_profile_gender_change,
  publish_dressed_character (0001 → redefineret0012), set_primary_dressed_character,
  reserve_ai_generation (0001 → redefineret0015), finish_ai_generation (0001),
  get_ai_generation_usage, reserve/finish_clothing_ai_generation (0008 →0011 revokerer
  finish →0015/202610050001 redefinerer reserve), finish_clothing_ai_generation_server,
  delete_dressed_character, save_dressed_outfit (0012 → **0014 er den gældende**),
  remove_saved_outfits_for_deleted_item, finish_ai_generation_server.
- **Triggers:** `profiles_gender_is_locked` (0001), `wardrobe_item_removes_saved_dressed_outfits` (0012).

### 11.4 Corrective migrations der SKAL med (må ikke udelades)
- **`202610040014`** efter0012 (ellers `save_dressed_outfit` fejler42702).
- **`202610050003`** efter `202610050002` (ellers afviser CHECK'en alt).
- **`202610040011`** efter0008 (lukker klient-finalisering).
- (0015/202610050001 "retter" sig selv ved at redefinere funktioner.)

### 11.5 Hvilke filer må IKKE genbruges uændret
- **`.kilo/worktrees/quilt-ticket/supabase/migrations/*`** — forældet duplikat;
  brug ALDRIG disse (F7).
- **På en ALLEREDE-migreret DB:** `202610040010` og `202610040012` må ikke
  genkøres (ikke idempotente, F5) — reparation ville kræve **nye** corrective
  migrations, som **ikke findes** (opfind dem ikke uden godkendelse).
- **`DRESSED-SUPABASE-IMPLEMENTATION-PLAN.txt`**-SQL: aldrig kørt, ikke del af
  rekonstruktionen (NOT APPLIED).

### 11.6 Hvilke filer KAN genbruges
- **Alle14 filer i `supabase/migrations/`** kan genbruges **i den friske
  rækkefølge fra11.2** (de er netop skrevet til engangskørsel i rækkefølge).
  Fil-teksten må **aldrig** rettes for at "fikse" historien (§12) — fejl rettes
  udelukkende af corrective migrations.

---

## 12. BEVAR HISTORIKKEN (original → error → corrective → current state)

**Ingen migrationsfiler er omskrevet i denne runde.** Følgende kæder dokumenterer
den faktiske udviklingshistorik præcis som den er:

### Kæde A — Placement (hovedfejlen)
```text
ORIGINAL:      202610050002  (kolonne jsonb + CHECK med jsonb_typeof(anchor)='text')
HISTORISK FEJL:23514 på enhver non-null placement ('text' ≠ jsonb_typeof-resultat;
               'string' er korrekt) → PATCH503 → session-kun placement
CORREKTIV:     202610050003  (drop+add samme navn med ='string'; alt andet identisk)
CURRENT STATE: kolonnen placement jsonb NULL; CHECK =0003-teksten; NULL = defaults
               (live: INFERRED kørt — PATCH200; inspektion UNVERIFIED)
```

### Kæde B — save_dressed_outfit
```text
ORIGINAL:      202610040012 (save_dressed_outfit uden variable_conflict)
HISTORISK FEJL:42702 'character_id is ambiguous' → gem-outfit fejlede
CORREKTIV:     202610040014 (kun #variable_conflict use_column; samme signatur/grants)
CURRENT STATE:0014-funktionen er gældende;0012's version er historisk (SUPERSEDED)
```

### Kæde C — Clothing-kvote (lag-på-lag, bevidst konservativ)
```text
0001 reserve/finish (klient-tælling) → 0008 commit-model (token; tæl ved success)
→ 0011 REVOKERER klient-finish + server-variant → 0015 owner-exemption
→ 202610050001 per-user override-tabel + reserve-redefinition
CURRENT STATE: flere lag af create or replace; den gamle finish-funktion
               EKSISTERER stadig men er ukaldelig (bevaret historik, ikke slettet)
```

### Kæde D — AI-ready assets
```text
0002 opretter wardrobe_item_ai_assets (character-bound) + backfill
→ 0010 RENAME til _legacy (data bevares!) + ny base_type-tabel
CURRENT STATE: to tabeller side om side; koden læser BEGGE (ny til brug, legacy til rydning)
```

### Kæde E — Kvote-limits
```text
0001 seed (3,3,3) → 0015 opdaterer til (1,3,1) → 202610050001 hævder i kommentar (3,5,1)
CURRENT STATE (repo): (1,3,1) forventes · LIVE: UNVERIFIED (F6) — ikke "rettet", kun noteret
```

---

## 13. AUDIT AF EKSISTERENDE DOKUMENTER

Ingen dokumenter er ændret i denne runde. Følgende er fundet **faktuelt forkert
på grund af SQL/database-historikken**:

### DOCUMENTATION CORRECTION REQUIRED

| Dokument | Sektion | Problem | Faktisk (kilde) |
|---|---|---|---|
| `docs/DRESSED-PROJECT-SPECIFICATION.md` | §2.5 DATA OWNERSHIP RULES (item_ids-blokken) | Skriver **`int[]`** | `item_ids` er **`text[]`** (0001:219, 0012:26) |
| `docs/DRESSED-CODEBASE-OVERVIEW.md` | §3.8 "Tabeller (nøgler)" — `saved_dressed_outfits` | Skriver **`item_ids int[]`** | `text[]` (0012:26) |
| `docs/DRESSED-CODEBASE-OVERVIEW.md` | §3.8 "Tabeller (nøgler)" — rækken **`character_transforms`** | Tabellen **findes ingen steder** i repoet (grep over src + migrations + docs =0 hits) — opført på gæt | **Fjern/erstat**; intet i migrations skaber den |
| `docs/DRESSED-CODEBASE-OVERVIEW.md` | §3.8 "Tabeller (nøgler)" — `wardrobe_items`-kolonner | Nævner `base_type`, `gender`, `image_url` som kolonner | De findes **ikke** på `wardrobe_items` i nogen migration (gender=hos profiles/characters; base_type=hos assets/outfits; image_url=findes ikke i DDL) |
| `docs/DRESSED-CODEBASE-OVERVIEW.md` | §3.8 "Constraints" — "FK'er fra outfits → character/bruger" | Antyder også FK til bruger | `saved_dressed_outfits` har **kun** FK til `dressed_characters` (user_id har INGEN FK — F9) |
| `docs/DRESSED-PROJECT-SPECIFICATION.md` | §2.4 CRITICAL SYSTEMS — `wardrobe_items`-rækken, "Files" | nævner `0008/0011` som wardrobe_items-migrations |0008/0011 rører **kun** kvote-funktioner; korrekte:0001, 00040002, 0005, 0012, 0013, 202610050002/0003 |

**Ikke fundet forkert (kontrolleret):** `analysis/DRESSED-CURRENT-STATUS.md`
(migrationsliste, placement-jsonb,0003-forklaring, tabeller — korrekt),
`analysis/Wheel-Pinch-Placement-Scale-Analysis.md` (jsonb_typeof-note korrekt),
`docs/DRESSED-ASSETS-AND-MEDIA.md` (master forms m.m. — ingen DB-påstande),
`DRESSED-SUPABASE-ANALYSIS.txt` (allerede markeret historisk; påstår bevidst
ingen live-verifikation).

---

## 14. SLUTAUDIT

Kontrolleret gennemlæsning af denne analyse mod repository'et:

| Kontrol | Resultat |
|---|---|
| Alle migrations fundet? | ✓ **14** i `supabase/migrations/` + **10** duplikater i `.kilo` (markeret `DUPLICATE`); git: **0 nogensinde slettede** `.sql`; **0** SQL-sætninger i kode |
| Alle kendte SQL-fejl dokumenteret? | ✓ F1–F9 + tabel i §9 |
| Placement-fejlen korrekt forklaret? | ✓ `jsonb_typeof = 'text'` vs PostgreSQL `'string'`; **kolonnen er korrekt `jsonb`** — fejlen var i indholdsvalideringen (§5) |
| Repository/DB-forskelle tydelige? | ✓ §3 + F3 (RLS-vs-NULL), F4 (profiles/storage uden for VC), F6 (limits-drift), GET-fallback i kode |
| Verified / Inferred / Unverified adskilt? | ✓ Legende i toppen + §3 + §6 (intet live indsnuset som "verificeret") |
| RLS dokumenteret? | ✓ §7.1 (wardrobe_items pr. operation), §7.3 (alle tabeller), §7.4 (ownership) |
| Ownership dokumenteret? | ✓ §7.2 (PATCH's service-klient + JWT + explicit-equals) + §8.2 (placement tilhører `wardrobe_items.id`) |
| Current database contract findes? | ✓ §10 (pr. tabel: kolonner/types/PK/FK/unique/CHECK/indexes/RLS/ownership) |
| SQL Reconstruction Guide findes? | ✓ §11 (rækkefølge, tabeller-først, corrective-migrations, indexes, RLS, functions, filer der må/ikke må genbruges, ingen opdigtet SQL) |
| Historiske migrations ikke omskrevet? | ✓ Ingen migrationsfiler er ændret; §12-kæderne bevarer original → error → corrective → current |
| Ingen antagelser som verificerede fakta? | ✓ Alt er klassificeret; §6's ordlyd: `UNVERIFIED — database constraint could not be directly inspected` |
| DOCUMENTATION CORRECTION REQUIRED noteret (ikke rettet)? | ✓ §13 —6 konkrete poster, ingen dokumenter ændret |

**Afgrænsning bekræftet:** denne runde har kun **læst** repository'en og
**oprettet denne fil**. Ingen produktionskode, migrations, SQL, RLS, API eller
frontend er ændret (`git status` uændret udover denne nye analyse-fil).

---
*Slut på SQL-migrations-audit. Næste skridt (kræver særskilt godkendelse):
(1) read-only inspektion af `pg_constraint` for `wardrobe_items_placement_check`,
(2) eksport af `profiles`-DDL + storage-policies fra live, (3) konsolidering af
`DOCUMENTATION CORRECTION REQUIRED`-listen i næste dokumentationsrunde.*


---

