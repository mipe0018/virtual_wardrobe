# DRESSED — LIVE DATABASE INSPECTION (read-only)

> INGENTING ER ÆNDRET. Kun **GET-læsninger** mod den live Supabase-instance
> (REST/PostgREST, Storage-bucket-liste, Auth-admin-læsning) med nøglerne fra
> `.env`. **Ingen SQL er kørt. Ingen data er skrevet/slettet.** Nøgler udskrives
> ikke, ingen e-mails/PII vises (kun tal og struktur). Midlertidige analyse-scripts
> ligger kun i `%TEMP%`.
>
> **Klassifikation:** **VERIFIED IN DATABASE** = aflæst direkte fra live nu ·
> **CONFIRMED (repo)** = læst fra migrations/kode · **INFERRED** = logisk slutning ·
> **UNVERIFIED** = kan kunses via SQL/egen-login (ikke tilgængeligt her).
> Projekt: `cmqefxwgqliqbmtpojxu.supabase.co`.

**Metode-detaljer:** PostgREST `GET /rest/v1/` (OpenAPI: tabeller, kolonner,
typer, RPC-stier) med service-nøglen; `Prefer: count=exact`-tællinger;
enkeltværdi-læsninger (placement/limits/usage/characters/outfits);
`GET /storage/v1/bucket`; `GET /auth/v1/admin/users` (kun antal + metadata-nøgle-
navne). Anon-nøglen (`sb_publishable…`) er **gyldig** — dens401'er viste sig at
være PostgreSQL `42501 permission denied` (privilegie-tjek), **ikke** en nøglefejl
(min første tolkning var forkert og rettes her: nøglen når PostgREST og DB'en).

---

## A. SCHEMA: LIVE vs. REPO (11 tabeller live)

**VERIFIED IN DATABASE — samtlige11 tabeller findes live** (service-syn):
`ai_generation_limit_overrides, ai_generation_limits, ai_generation_usage,
dressed_base_forms, dressed_characters, profiles, saved_dressed_outfits,
wardrobe_item_ai_assets, wardrobe_item_ai_assets_legacy, wardrobe_items,
wardrobe_results`.

| Tabel | Live-kolonner (aflæst) | Sammenligning med repo |
|---|---|---|
| `profiles` | `id, created_at, user_id, name, username, favourite_style, source_photo_path, model_photo_path, model_generation_status, gender` | **AFVIGELSE (F4 bekræftet):** repoet kender kun `gender` +3 photo/status-felter (0001). **Live har ekstra kolonner uden for version control:** `id`, `created_at`, `user_id`, **`name`, `username`, `favourite_style`**. PK/FK/trigger/oprettelsesmekanisme: **UNVERIFIED** |
| `wardrobe_items` | `user_id, id(text), name, category, reference_path, created_at, updated_at, original_path, preview_path, **placement:jsonb**` | **MATCH** med0001+00040002+0005+202610050002. **Ingen** `base_type`/`gender`/`image_url`-kolonner live ⇒ **bekræfter de tidligere doc-korrektioner** |
| `saved_dressed_outfits` | `user_id, id, character_id, base_type, name, outfit_key, **item_ids: text[]**, created_at, updated_at` | **MATCH** med0012; **`text[]` VERIFIED IN DATABASE** (int[]-påstanden var forkert — nu bevidst) |
| `wardrobe_results` | `user_id, id, item_ids(text[]), result_path, created_at, character_id, outfit_key` | **MATCH** inkl.0010's kolonner |
| `dressed_characters` | `user_id, id, model_path, gender, is_primary, created_at, geometry_contract_version` | **MATCH** inkl.0012's `geometry_contract_version` |
| `wardrobe_item_ai_assets` | `user_id, item_id, base_type, reference_path, generation_version(int), created_at, updated_at` | **MATCH** med0010 |
| `wardrobe_item_ai_assets_legacy` | `user_id, item_id, character_id, reference_path, created_at, generation_version` | **MATCH** (0002+0005 efter rename i0010) — legacy findes live |
| `ai_generation_limits` | `generation_type, free_limit(int)` | **MATCH struktur** (værdier: se §D) |
| `ai_generation_usage` | `user_id, generation_type, used_count, in_progress, started_at, updated_at` | **MATCH** (bekræftet: **ingen `id`-kolonne** — `select=id` gav400) |
| `ai_generation_limit_overrides` | `user_id, clothing_free_limit(int), created_at` | **MATCH** med202610050001 |
| `dressed_base_forms` | `base_type, storage_path, created_at` | **MATCH** med0010 |

**Findes IKKE live (VERIFIED IN DATABASE — ud af11):**
- **`character_transforms`** — **eksisterer aldrig i live** (befæster at den
  tidligere dokumentations-reference var falsk; §2.4-noten i spec er stadig ikke
  rettet — se §I).
- `account_deletions`, `deleted_emails`, `retained_*` — M0–M6-planen er
  **ikke implementeret** (NOT APPLIED bekræftet).
- Ingen uventede øvrige tabeller (ingen test/temp-tabeller i `public`).

**CHECK-constraints, FKs, triggers, kolonne-defaults og RLS-policy-tekster:**
**UNVERIFIED** — PostgREST-OpenAPI viser dem ikke; kræver SQL (ikke tilladt her).

## B. RPC-FUNKTIONER (VERIFIED IN DATABASE —11 live)

`delete_dressed_character, finish_ai_generation, finish_ai_generation_server,
finish_clothing_ai_generation, finish_clothing_ai_generation_server,
get_ai_generation_usage, publish_dressed_character, reserve_ai_generation,
reserve_clothing_ai_generation, save_dressed_outfit, set_primary_dressed_character`

- **MATCH** præcis med migrationsættet (0001/0008/0011/0012/0014/0016).
---

- De **revokede/ældre** funktioner (`finish_clothing_ai_generation`,
  `finish_ai_generation`) **findes stadig** — som forudsat "død kode i DB".
  Bemærk: OpenAPI-listen er service-rolle-perspektivet ⇒ den beviser
  **eksistens**, ikke at `authenticated` stadig har `execute` (grant-status:
  UNVERIFIED, men repoet revokerede dem — CONFIRMED (repo)).

---

## C. RLS OG GRANTS (anon-probes — VERIFIED IN DATABASE)

| Probe (anon-nøgle, **ingen bruger-session**) | Svar | Fortolkning |
|---|---|---|
| `GET /rest/v1/ai_generation_limits?select=…` | HTTP401 + PostgreSQL **`42501`** "Grant SELECT … TO anon" | **`revoke … from anon` er LIVE** (0001/0010). Anon kan IKKE læse tabellen direkte (appet bruger RPC `get_ai_generation_usage` — repo-kontrakt ✓) |
| `GET /rest/v1/wardrobe_items?select=id` | HTTP401 + **`42501`** "Grant SELECT … TO anon" | **Anon kan IKKE læse garderober — RLS+grants virker live.** Brugerens adgang kræver JWT (authenticated) |
| Anon-nøglegyldighed | Nåede PostgREST + DB-tjek (42501 ≠401-apikey) | **Nøglen er gyldig** (korrigerer min første tolkning) |

- **Anonym (og derfor også uden-JWT) adgang til brugerdata: LUKKET LIVE** —
  VERIFIED IN DATABASE (negativ bevisførelse).
- **Authenticated-adfærd** (egne rækker læses/skrives korrekt, `WITH CHECK`
  opfører sig som beskrevet, F3's NULL-problem i praksis): **UNVERIFIED** —
  kræver et login med rigtigt bruger-JWT (ikke forsøgt; ingen adgangskoder).
- **Policy-teksterne** (`using`/`with check`) kan ikke aflæses via REST:
  **UNVERIFIED** (kun deres *effekt* over for anon er bekræftet).
- Service-rolle-perspektivet viser alle tabeller med GET/POST/PATCH/DELETE
  (OpenAPI) — det er **grants for service_rollen**, ikke et bevis på at
  `authenticated` har mere end repoets `grant`-sæt (det = CONFIRMED (repo)).

## D. QUOTAS (F6 LØST — VERIFIED IN DATABASE)

| Måling | Live-værdi | Repo-forventning | Status |
|---|---|---|---|
| `ai_generation_limits` | **character=3, clothing=5, tryon=1** |0015 ⇒ (1,3,1);0001-seed ⇒ (3,3,3) | **LIVE ≠ REPO.** Kombinationen (tryon=1 fra0015) + (character/clothing ≠0015) ⇒ **0015 kørte, og character/clothing er SENERE ændret manuelt live**. Kommentaren i `202610050001` ("character=3, clothing=5, tryon=1 stay exactly as they are") var **altså korrekt** — F6 er nu bekræftet og løst som gåde: **repo-migrationerne producerer IKKE de live-værdier der gælder** |
| `ai_generation_limit_overrides` | **1 række, `clothing_free_limit=100`** | seed af testbruger (202610050001) | **MATCH** (seedet række findes) |
| `app_metadata.is_owner` | **0 af4 brugere har is_owner=true** | ejer-exemption fra0015 | **VERIFIED:** ejer-fritagelse er **inaktiv** for alle brugere (nøglen findes ikke engang i metadata) |
| `ai_generation_usage` | **7 rækker** på4 brugere: `character` (1,2,1,0,0), `clothing` (2,**6**), `tryon` (0) | — | **Live-observationer:** (a) **`clothing used=6 > free_limit=5`** — historisk forbrug overskrider den nuværende limit (konsistent med manuel nedjustering af limit efter forbrug); (b) **1 række `in_progress=true`** (character, used=1) = en **hængende reservation** (ny reserve rydder den automatisk efter5 minutters-vinduet — Inferred fra0015-logikken); alle øvrige `in_progress=false` |
| Binding | `usage.user_id`-rækker pr. bruger + `generation_type` | PK `(user_id,generation_type)` | **MATCH** (strukturel aflæsning) |

## E. DATAMÆNGDER (VERIFIED IN DATABASE — `count=exact`)

`profiles=3` · `wardrobe_items=9` · `saved_dressed_outfits=3` ·
`dressed_characters=4` · `wardrobe_results=0` · `ai_generation_usage=7`
(`ai_generation_usage`-count med `select=id` fejlede400 — **fordi tabellen
 ingen `id`-kolonne har**, som forudsat).

## F. PLACEMENT — DIREKTE LIVE-BEVIS (VERIFIED IN DATABASE)

Aflæst fra `wardrobe_items` (9 rækker,3 non-null):

```json
{"x":0, "y":-4.2106, "scale":0.63, "anchor":"torso"}     ← præcis det dokumenterede eksempel
{"x":-0.5053, "y":14.8214, "scale":0.64, "anchor":"waist"}
{"x":-0.5052, "y":-6.5686, "scale":0.52, "anchor":"torso"}
```
+6 rækker `placement=null` (default-adfærd ✓, ingen tvungne backfills ✓).

**Konklusion:**
1. `wardrobe_items.placement` **findes live som jsonb** (kolonne-typen aflæst) —
   **VERIFIED IN DATABASE** (var før: Unverified).
2. **Den rettede0003-CHECK er funktionelt aktiv live:** disse gyldige værdier
   kunne ikke eksistere i tabellen, hvis den gamle `'text'`-CHECK stadig var
   gældende (alt non-null blev afvist med23514). **VERIFIED IN DATABASE
   (funktionel bevisførelse).**
3. Den **præcise constraint-definition/navn/`convalidated`** i `pg_constraint`
   kan ikke aflæses via REST → **UNVERIFIED** (kræver read-only SQL ved en
   senere godkendt lejlighed).
4. `item_ids`-indholdet i live-outfits er **tekst-strenge** (UUID-tekst) ✓
   `text[]` — yderligere bevis for rettelsen af `int[]`-dokumentationen.

## G. STORAGE (VERIFIED IN DATABASE — bucket-liste)

```text
profile-images   (private)     ← LEVER KUN LIVE — findes IKKE i nogen migration (udvidet F4)
model-images     (private)     ← matcher repo (0001/0010 + kode)
```
- **To buckets, begge private** ⇒ ingen offentlig læsning; al adgang via
  signerede URLs (kode: CONFIRMED (repo),60 min) eller service-rolle.
- **Upload-policies, base-form-policy og `foldername`-ejerskabsregler kan ikke
  aflæses via REST → UNVERIFIED** (kun at bucket'en eksisterer og er privat).
- Ikon-filer m.m. i `public/` hører til appen, ikke denne bucket (repo-faktum).

## H. AUTH (VERIFIED IN DATABASE — admin-læsning, ingen PII vist)

- **4 brugere** i `auth.users` (antal + `aud=authenticated`; e-mails/ids vises ikke).
- **`app_metadata`-nøgler på alle brugere: KUN `[provider, providers]`** ⇒
  - **`is_owner` findes ikke hos nogen** ⇒0015's ejer-exemption er **inaktiv live**.
  - ingen øvrige metadata-nøgler (ingen legacy-flags).
- **Hvordan `profiles`-rækker oprettes** (auth-trigger? lazy-insert?): stadig
  **UNVERIFIED** — triggers er ikke synlige via REST.
- Sessionstypen i browsersen er supabase-js (repo: CONFIRMED); ikke-inspiceret live.

---

## I. SAMMENLIGNINGSOPSUMMERING (repo vs. live)

**MATCH (live = migrations):**
1. Alle migrations-tabeler findes (inkl. legacy-tabel + placement-kolonnen).
2. Alle11 RPC'er findes i præcis migrations-sættet.
3. Alle aflæste kolonner matcher repo-kontrakten (`text`-id, `text[]`-item_ids,
   `jsonb`-placement, `geometry_contract_version`, `generation_version`, …).
4. `revoke … from anon` er effektiv live (42501-bevis).
5. Kvote-override-rækken (100) findes som seedet; `normalized-v1` på ALLE
   characters; `placement=null` som default for de fleste items.

**AFVIGELSER (live ≠ repo):**
| # | Afvigelse | Detalje | Konsekvens |
|---|---|---|---|
| L1 | **`profiles` er rigere end repo ved** | `id, created_at, user_id, name, username, favourite_style` udover repo-kendskabet | **F4 bekræftet + udvidet:** bring live-schema ind i VC før rekonstruktion |
| L2 | **Kvote-limits = (3,5,1) live vs. (1,3,1) i repo-migrationer** | `0015` kørte, derefter manuel live-ændring; `202610050001`-kommentaren var korrekt | **F6 løst:** dokumenter live-værdierne som gældende; vælg ved godkendelse om repo eller live skal rettes til |
| L3 | **Bucket `profile-images` findes kun live** | ikke nævnt i nogen migration/kodefund | F4-udvidelse; skal med i evt. storage-migration |
| L4 | `ai_generation_usage.clothing=6 > limit=5` | historisk forbrug vs. sænket limit | dokumenteret; ingen automatisk nedtælling findes |

**MANGLER I LIVE (intet fundet — repoet er komplet ift. live):** ingen
migrations-tabel eller RPC mangler live. (Historik-objekter som `character_transforms`
fandtes aldrig.)

**Tilbageværende UNVERIFIED (kræver read-only SQL eller bruger-login):**
- `pg_constraint`: `wardrobe_items_placement_check`-tekst, navn, `convalidated`.
- RLS-policy-tekster (`using`/`with check`) pr. tabel + storage-policies.
- FK-strukturer (bl.a. F9: findes der FK på `saved_dressed_outfits.user_id`?),
  PK'er og unikke constraints.
- Triggers (inkl. `profiles_gender_is_locked`, outfit-trigger,
  **profiles-oprettelses-trigger** hvis den findes).
- Funktioners `security definer`-tilstand + grants pr. rolle.
- `ai_generation_usage`-præcise værdier pr. bruger (kun samlet aflæst —
  ingen PII udskrevet).
- Authenticated-adfærd for F3 (`WITH CHECK` vs. NULL-`reference_path`).
- Kategori-/anchor-CHECK-indhold (`wardrobe_items_category_check`).

## J. HVAD DETTE BETYDER FOR DE ÅBNE SPØRGSMÅL (§19 i auth-analysen)

- Spørgsmål1/2 (profiles i VC + oprettelsesmekanisme): **NU MED LIVE-SKEMA** at
  adoptere (kolonneliste ovenfor) — mekanisme stadig ukendt.
- Spørgsmål3 (F3): stadig kræver live-test med login/SQL før beslutning.
- Spørgsmål4 (F9-FK): stadig **Unverified** (REST viser ikke FK).
- Spørgsmål5 (storage-policies): bucket-eksistens nu **Confirmed**; policies
  stadig ukendte → eksport først.
- Spørgsmål7 (indekser): ingen nyt data — fortsat anbefaling.

## K. AFGRÆNSNING

- **Kun GET-læsninger.** Ingen SQL, ingen inserts/updates/delete, ingen
  migrations, ingen ændringer i repo, kode, config eller eksisterende docs.
- Midlertidige analyse-scripts ligger kun i `%TEMP%` (`dd-live.js`,
  `dd-probe.js`, `dd-probe3.js`, `dd-parse.js`) — ikke i projektet.
- Denne fil + statusrapporten er det eneste output; resultatet stoppes her til
  fælles gennemgang.


