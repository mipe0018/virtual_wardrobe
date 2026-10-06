# DRESSED – Model Generation Fix

> **Ændringer i dette trin:** én NY migration + denne dokumentationsfil.
> Ingen eksisterende migration er redigeret. Ingen production-code, UI, design,
> Storage, RLS eller sikkerhedscheck er ændret.
>
> **CONFIRMED** = dokumenteret i kode/SQL/live-aflæsning ·
> **INFERRED** = sandsynlig slutning · **UNVERIFIED** = kunne ikke verificeres.

---

## 1. Actual runtime error

**Netlify-logs er IKKE tilgængelige** fra denne maskine: `netlify` CLI er ikke
installeret, der findes ingen `NETLIFY_*`-nøgle i `.env`, der er ingen
`netlify.toml`, og `.netlify/state.json` indeholder kun geodata (intet
site-link). **Produktionslogs er derfor IKKE kørt.**

I stedet findes **faktisk runtime-log** i projektet: `.astro/dev.log`
(1671 linjer, `astro dev`):

```text
.astro/dev.log:287  15.23.26 [202] POST /api/ai/personal-model 3234ms
.astro/dev.log:295  The character reservation was already released or expired.
.astro/dev.log:319  15.24.48 [202] POST /api/ai/personal-model 1283ms
.astro/dev.log:326  The character reservation was already released or expired.
```

**Klassifikation: CONFIRMED** — præcis den rapporterede fejl, fundet to gange.

Ingen af de øvrige fejl-marcører findes for character-flowet i hele loggen:
`DRESSED character generation failed in the background job.`
(`character-job.ts:153`), `Could not publish the generated DRESSED character.`
(`:148`), `Could not store the generated DRESSED character.` (`:124`),
`Could not finalize the character generation reservation.`
(`generation-usage.ts:155`), `BACKGROUND_JOB_SECRET is not configured.`
(`job-launcher.ts:35`), `Inline background job crashed.` — **0 fund**.
Begge requests svarede **202**, altså **ingen** route-fejl. **CONFIRMED.**

---

## 2. Root cause

### Den konkrete årsag til den rapporterede fejl

**Den deployerede `finish_ai_generation_server` RETURNERER `void` (HTTP 204),
mens applikationen forventer `boolean`.**

`src/lib/server/ai/generation-usage.ts:141-159`:

```ts
const { data, error } = await serviceClient.rpc("finish_ai_generation_server", {...});
if (error) { console.error(`Could not finalize the ${type} generation reservation.`, error); return false; }
return data === true;          // ← void-svar deserialiseres til null → altid false
```

`character-job.ts:161-166`:

```ts
} finally {
  const released = await finishGenerationServer(serviceClient, userId, "character", reservationStartedAt, succeeded);
  if (!released) console.error("The character reservation was already released or expired.");
}
```

Et `void`-RPC-svar giver HTTP 204 med tom body → PostgREST/supabase-js
deserialiserer det til `null` → `null === true` er `false` → **beskeden logges
ved hver eneste afslutning, også når reservationen faktisk blev frigivet.**

**Klassifikation: CONFIRMED** (kode + probe, se §3).

### Kæden bag det synlige fejlsymptom (INFERRED)

`finish_ai_generation_server` er det **eneste** sted hvor `in_progress`
slippes for character-flowet. Slippes den ikke, forbliver `in_progress=true`:

```text
reserve (in_progress=true) → 202 → baggrundsjob → publish OK ('completed')
   ↓
finish matcher 0 rækker → in_progress forbliver true
   ↓
profile.astro:1103 waitForGenerationToFinish poller /api/ai/usage hver 4. s
   ↓
in_progress bliver aldrig false → 16 min timeout (generation-usage.ts:48)
   ↓
profile.astro:1169-1171 "MODEL GENERATION FAILED. PLEASE CHECK YOUR CONNECTION..."
```

Dvs. **modellen kan være genereret korrekt, men frontend rapporterer fejl.**
Mekanismen er **CONFIRMED** i koden; at den slår ud live er **INFERRED**.

---

## 3. Evidence

### E1 — Runtime-log (CONFIRMED)
`.astro/dev.log:295` og `:326` — præcis den rapporterede tekst, én gang pr.
forsøg, umiddelbart efter 202-svaret.

### E2 — Genereringen LYKKEDES i samme øjeblik (CONFIRMED)
Live `dressed_characters` (read-only GET):

| model_path-suffix | created_at (UTC) | lokal tid | dev.log |
|---|---|---|---|
| `personal-model-59d03a1f-…` | `2026-10-05T13:23:56.241205+00:00` | 15:23:56 | fejl-log mellem 15.23.56 og 15.24.00 |
| `personal-model-5ac03783-…` | `2026-10-05T13:25:14.219016+00:00` | 15:25:14 | fejl-log mellem 15.25.13 og 15.25.18 |

`publish_dressed_character` (`0012:230-244`) skriver `created_at`,
`model_photo_path` og `model_generation_status='completed'` i samme
transaktion ⇒ **AI + upload + publish lykkedes**. Kun finaliseringen
rapporterede fejl.

### E3 — Kontrolleret probe af RPC'ens retur-type (CONFIRMED)

Samme instance, samme service-nøgle, samme request-format. **Ufarlige kald med
ikke-eksisterende bruger `00000000-0000-0000-0000-000000000000` og token
`2000-01-01` ⇒ 0 rækker påvirket, ingen dataændring.**

| Funktion | Repo-definition | Svar |
|---|---|---|
| `get_ai_generation_usage()` | `returns table` (`0001:360`) | **HTTP 200, body `[]`** (kontrol: PostgREST returnerer bodies) |
| `finish_clothing_ai_generation_server(uuid,timestamptz,boolean)` | `returns boolean` (`0011:11`) | **HTTP 200, body `false`** ✅ |
| **`finish_ai_generation_server(uuid,text,timestamptz,boolean)`** | **`returns boolean` (`0016:12`)** | **HTTP 204, tom body** ❌ ⇒ **`void`** |

Signaturen er bekræftet via PostgREST-OpenAPI (`p_user_id uuid`,
`p_generation_type text`, `p_reservation_started_at timestamp with time zone`,
`p_succeeded boolean`), og `auth.role()`-guarden **bestod** (204, ikke 42501).

⇒ **Søsterfunktionen opfører sig korrekt, denne ene gør ikke. Differencen er
isoleret til `finish_ai_generation_server`.**

### E4 — Reservationen blev aldrig skrevet efter reserve (CONFIRMED)

Live `ai_generation_usage`:

```json
{ "generation_type": "character", "used_count": 1, "in_progress": true,
  "started_at": "2026-10-05T16:54:49.610691+00:00",
  "updated_at": "2026-10-05T16:54:49.610691+00:00" }
```

`updated_at == started_at` ⇒ **sidste skrivning var selve reserven**;
`finish_ai_generation_server` (som sætter `updated_at = now()`) har **aldrig**
opdateret rækken — 24+ timer efter. Reservationen sidder stadig fast.

### E5 — Kvoter opbrugt uden refund (CONFIRMED)

`ai_generation_limits`: character **3**, clothing **5**, tryon **1**.
`ai_generation_usage`: to character-rækker med **`used_count = 3`** (= limit).
Næste forsøg giver **429** `You have used all 3 free character generations.`
Refunden (`greatest(used_count-1,0)`, `0016:33-36`) lever **inde i** det samme
UPDATE der ikke matcher ⇒ fejlede forsøg forbruger credits.

### E6 — Alle profiles står `failed` trods virkelige modeller (CONFIRMED)

Live `profiles` (3 rækker): **alle** `model_generation_status = 'failed'`; to
har et gyldigt `model_photo_path` der peger på en eksisterende primær
`dressed_characters`-række. Kun `setGenerationStatus(..., "failed")`
(`personal-model.ts:280` / `character-job.ts:160`) kan skrive det, og kun i et
`catch`-leje — altså har der været fejlende forsøg **efter** et succesfuldt
publish (der sætter `'completed'`).

---

## 4. Why it worked before

**INFERRED (kun delvist beviseligt).**

* Før `70bd54c` var flowet **synkront** og afsluttede med den bruger-scoped,
  **tokenløse** `finish_ai_generation(text)` (`0001:343-358`), der
  `returns void` **og** hvis returværdi **aldrig blev tjekket**
  (`finishGeneration()` ignorerer `data`). Tom-retur var altså korrekt for den
  funktion — der var ingen `data === true`-kontrol og dermed heller ingen
  fejlbesked.
* `70bd54c` indførte en **ny** funktion med en **boolean-kontrakt** og ny
  kode der **afhænger** af den (`return data === true`).
* Den deployede database fik aldrig den boolean-returnerende variant:
  PostgreSQL kan **ikke** ændre en funktions returtype med `create or replace`,
  så `0016` har reelt aldrig kunnet rette en eksisterende `void`-funktion.
* Samtidig findes der **ingen tests** (`package.json` har kun
  `dev`/`build`/`preview`/`astro`) til at fange kontrakbruddet.

---

## 5. Regression introduced by

**`70bd54c0a60d48d6410a52837c6a453ee946e92f` — *"new commit"*
(2026-10-05 00:26:35 +0200).**

Denne commit flyttede model-generationen til Netlify Background Function og
indførte **samtidig**:

| Element | Fil / migration |
|---|---|
| token-baseret finalisering + `return data === true` | `src/lib/server/ai/generation-usage.ts:141-159` |
| `console.error("The character reservation was already released or expired.")` | `src/lib/server/ai/jobs/character-job.ts:165` |
| ny RPC `finish_ai_generation_server` | `supabase/migrations/202610040016_background_ai_generation_finalization.sql` |
| 202 + polling (16 min) | `src/pages/profile.astro:1100-1119`, `src/lib/client/generation-usage.ts:42-65` |

**CONFIRMED** (`git show --stat 70bd54c`, `git log -S "already released or
expired"`). Fejlteksten findes **ikke** i `75f63b1` (grep exit 1).

---


## 6. Fix implemented

**Ét enkelt, minimalt fix: en NY migration der genskaber
`finish_ai_generation_server` med den korrekte `returns boolean`-kontrakt.**

Filen `supabase/migrations/202610060001_finish_ai_generation_server_return_contract.sql`
gør præcis to ting:

1. `drop function if exists public.finish_ai_generation_server(uuid, text, timestamptz, boolean);`
   — påkrævet, fordi PostgreSQL **ikke** tillader at ændre en funktions
   returtype med `create or replace` (netop derfor har `0016` aldrig kunnet
   rette den deployerede `void`-variant).
2. `create function … returns boolean …` — **verificeret linje-for-linje
   identisk** med `202610040016_background_ai_generation_finalization.sql:6-46`
   plus de samme `revoke`/`grant` (`0016:48-51`).

**Hvad fixet bevarer (bevidst urørt):**

* `security definer` + `set search_path = ''`
* `auth.role() = 'service_role'`-guarden (`42501`)
* `p_generation_type not in ('character','tryon')`-guarden (`22023`)
* token-match `and in_progress and started_at = p_reservation_started_at`
* credit-back `greatest(used_count - 1, 0)` ved fejl
* grants: kun `service_role` (revoked fra `public, anon, authenticated`)
* reservationssystemet, AI-flowet, Storage, RLS, UI, canonical model-arkitektur

**Effekt:** `finishGenerationServer()` (`generation-usage.ts:158`) kan igen
returnere `true` ⇒ `character-job.ts:165` stopper med at logge
*"The character reservation was already released or expired."* ved hver
afslutning — og beskeden bliver **sandfærdig** (den vises kun ved reelt
mislykket release). Samtidig virker release + refund af `in_progress` igen.

**Valgt alternativ (AFVIST):** at ændre TypeScript til at acceptere `null`.
Det ville skjule divergensen mellem repo-SQL og den deployerede database i
stedet for at rette den — og maskere ærlige fejl.

---

## 7. Files changed

| Fil | Type |
|---|---|
| `supabase/migrations/202610060001_finish_ai_generation_server_return_contract.sql` | **NY** migration |
| `analysis/DRESSED-MODEL-GENERATION-FIX.md` | **NY** dokumentation |

**Ikke ændret:** al production-code, `src/**`, `netlify/**`, eksisterende
migrations, `supabase/migrations/202610040016_…`, RLS, Storage, UI/CSS,
`package.json`, dependencies.

`git status` bekræfter at de øvrige modificerede/untrackede filer
(`wardrobe-ai.ts`, `items/*.ts`, `wardrobe.astro`, `wardrobe.css`,
`profile-outfits.ts`, `202610050002/0003`, øvrige analyse-dokumenter)
**forud eksisterede** og ikke er rørt i dette trin.

---

## 8. SQL changes

| Emne | Detalje |
|---|---|
| Ny migration | `202610060001_finish_ai_generation_server_return_contract.sql` |
| Eksisterende migration redigeret? | **NEJ** |
| Funktion | `public.finish_ai_generation_server(uuid, text, timestamptz, boolean)` |
| Ændring | `returns void` (deployed) → **`returns boolean`** (repo-kontrakt, identisk med `0016`) |
| Verifikation | Funktion body **IDENTISK** med `0016:6-46` (automatisk sammenligning: *"IDENTICAL (kun create or replace → create)"*); `revoke`/`grant` identiske |
| Andre tabeller/funktioner | **Ingen** |
| RLS / policies / grants | **Ingen ændringer** udover at genoprette de oprindelige `0016`-grants |
| Risiko | **LOW** — funktionen gendannes nøjagtigt som repoet allerede definerer den |

**Applikation af migrationen er IKKE udført her** (se §10).

---


## 9. Tests

| Trin | Resultat |
|---|---|
| `npm run build` | ✅ **GRØN** — `astro build` gennemført: `✓ Completed in 20.13s`, `Generated SSR Function`, `Server built in 1m 35s`, `[build] Complete!` |
| Eksisterende tests | **Findes ikke.** `package.json` har kun `dev`, `build`, `preview`, `astro` — intet `test`-script, ingen testafhængigheder. Intet at køre og intet brudt |
| Typecheck | **Projektet bruger ikke typecheck** (intet `tsc`/`check`-script). Ændringsfilen er ren SQL; **ingen TypeScript er ændret**, så typefladen er uberørt |
| Migrations-verifikation | ✅ Funktion body automatisk sammenlignet med `0016:6-46` → **IDENTISK** (kun `create or replace` → `drop` + `create`); `revoke`/`grant` identiske |
| SQL-syntax | Kan **ikke** valideres mod en live/lokal PostgreSQL herfra (ingen tilgængelig `psql`/Supabase CLI-auth) → **UNVERIFIED** indtil migrationen køres |

**Ingen eksisterende tests/regler er brudt** (der var ingen).

---

## 10. Live verification

**Live model-generation kan IKKE køres fra Cline.** Årsager:

1. Generering kræver en autentificeret browsersession (Bearer-token fra
   Supabase Auth) — Cline har ingen session/cookie og kan ikke logge ind.
2. Flowet kræver et uploadet kildefoto + valgt køn på en konkret brugerprofil.
3. Et ægte kald ville **forbruge en AI-generation og en kvote** (side-effekt).

**Migrationen er IKKE applikeret på den live database herfra.** Årsager:

1. Supabase CLI/Mangement-API-auth er ikke tilgængelig i dette miljø
   (`supabase` findes ikke i PATH; `.env` indeholder kun REST-nøgler).
2. `supabase db push` ville desuden også forsøge at applicere de **to
   ucommittede** placement-migrations `202610050002`/`0003`, som ikke hører
   til dette fix.
3. Live-ændringer kræver udtrykkeligt deploy-trin fra jer.

**Sådan verificeres fixet (efter applikation):**

```bash
npx supabase db push          # eller indsæt filens SQL i SQL Editor
```

Derefter, **read-only**, gentag E3-proben:

```text
POST /rest/v1/rpc/finish_ai_generation_server  (ikke-eksisterende bruger + token)
forventet FØR: HTTP 204, tom body
forventet EFTER: HTTP 200, body "false"
```

Og kør én ægte model-generation: `.astro/dev.log` skal **ikke** vise
`The character reservation was already released or expired.`, og
`ai_generation_usage.in_progress` skal blive `false` med senere `updated_at`.

**Live verification: NO** (migration oprettet, ikke apliceret).

---

## 11. Remaining uncertainty

| # | Usikkerhed | Klasse |
|---|---|---|
| U1 | **Netlify-produktionslogs er utilgængelige** — den faktiske fejl i *produktion* er ikke set; analysen bygger på `.astro/dev.log` (lokal dev, 2026-10-05) | **UNVERIFIED** |
| U2 | **Den deployede funktions *body* kan ikke læses** (PostgREST giver ingen adgang til `pg_get_functiondef`). Vi ved den er `void`, men ikke om dens WHERE-betingelse også adskiller sig fra `0016` | **UNVERIFIED** |
| U3 | **Den fastlåste reservation** (`16:54:49`) kan skyldes enten (a) at finaliseringen ikke matcher, eller (b) at baggrundsjobbet aldrig kørte (fx manglende `OPENAI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`BACKGROUND_JOB_SECRET` i Netlify-miljøet — baggrundsfunktioner svarer 202 *før* de kører, så route'en ser aldrig fejlen) | **INFERRED** (mekanisme) / **UNVERIFIED** (udløser) |
| U4 | **`model_generation_status='failed'` på alle profiles** stammer fra catch-blokke der **ikke** findes i den tilgængelige log ⇒ hændelser uden for rækkevidde | **UNVERIFIED** |
| U5 | **Kvote 3/3 for to brugere** — om det er refund-svigt (E5) eller bare mange reelle forsøg, kan ikke skelnes uden logs | **INFERRED** |
| U6 | `b9a94ca` som "sidst virkende" er stadig **ikke bevist** (kun CSS-commit, se regression-analysen) | **UNVERIFIED** |
| U7 | Om frontendens `SELECT profiles` efter 202 lades af RLS (profilens `profiles`-RLS findes slet ikke i version control) | **UNVERIFIED** |

**Næste skridt (for jer):** (1) applicer migrationen, (2) kør E3-proben igen,
(3) kør én ægte generering og aflæs `dev.log`/Netlify-log, (4) hvis fejlen
stadig vises, hent Netlify-loggen for `personal-model-background` og find
`DRESSED character generation failed in the background job.`
(`character-job.ts:153`) — den navngiver præcis hvilket trin der fejler.

---

*Oprettet: kun denne fil + én ny migration. Ingen eksisterende migration,
production-code, database, Supabase, Storage, RLS eller dependencies er ændret.*

**MODEL GENERATION FIX COMPLETE**

