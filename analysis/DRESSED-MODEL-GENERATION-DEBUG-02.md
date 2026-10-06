# DRESSED – Model Generation Debug 02

*Type: READ-ONLY ANALYSE. Ingen production code, SQL, migrations, Supabase, Storage,
env eller dependencies er ændret. Kun denne fil er oprettet.*

---

## 1. Entry point

**Fil:** `src/pages/api/ai/personal-model.ts` (Astro API-route, `export const prerender = false`, linje 31).

* Modtager: `POST /api/ai/personal-model` → `export const POST: APIRoute` (**linje 174**).
* Route-princip: `src/pages/api/ai/personal-model.ts` mapping i Astro (bekræftet i
  `analysis/DRESSED-ASTRO-ARCHITECTURE-ANALYSIS.md`).
* Diagnostik-gren (kun `import.meta.env.DEV`): `?diagnostic=A|B|C|INFO` (linje 233-238,
  funktion `runDiagnostic` linje 70) — rører hverken kvote, status, storage eller DB.

## 2. Frontend caller

**Fil:** `src/pages/profile.astro`

* Knap-hander: `createModelButton?.addEventListener("click", async () => …)` **linje 1054**.
* Lokale guards FØR kald (**linje 1055-1063**): ingen kilde-foto →
  `UPLOAD A SOURCE PHOTO BEFORE GENERATING YOUR MODEL.` (1057); gender ≠ woman/man →
  `CHOOSE WOMAN OR MAN…` (1061). Disse kalder **ikke** API'et.
* Session-tjek (1068-1079): `supabase.auth.getSession()` → manglende token →
  `failFlow("MODEL GENERATION FAILED — PLEASE LOG IN AGAIN.")` (1076).
* Selve kaldet (**linje 1086-1091**):
  `fetch("/api/ai/personal-model", { method: "POST", headers: { Authorization: "Bearer <token>" } })`
  — ingen body. Response tolkes som JSON `error?/modelPhotoPath?/status?/gender?/usage?` (1092-1098).

## 3. Authentication

**Fil:** `src/lib/server/supabase.ts`, funktion `authenticateSupabaseRequest` (linje 37-90).

| Tjek | Linje | Resultat |
|---|---|---|
| `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` mangler | 43-49 | **503** `Authentication is not configured.` |
| `Authorization: Bearer …` mangler/malformeret | 51-59 | **401** `A valid sign-in is required.` |
| `client.auth.getUser(accessToken)` fejler/ingen user | 75-83 | **401** `A valid sign-in is required.` |
| OK | 85-89 | `{ ok: true, client, user }` — `client` = anon-nøgle + brugerens Bearer-token (RLS som `authenticated`) |

Yderligere auth i jobbet: `jobUserIsValid(serviceClient, accessToken, userId)`
(`background.ts:49-56`, kaldt `character-job.ts:73`) — service-rolle verificerer at
token stadig svarer til `payload.userId` (ellers kastes fejl → status `failed`).

## 4. Profile/database reads

**Fil:** `src/pages/api/ai/personal-model.ts` (i `try`, linje 183+):

1. **Linje 184-188:** `client.from("profiles").select("gender, source_photo_path").eq("user_id", user.id).maybeSingle()`
   (kørende: brugerens anon-klient).
   * `profileError` → **500** `Could not load your profile. Please try again.` (192)
   * `!profile` → **404** `Your profile could not be found.` (194)
   * gender ∉ {woman, man} → **409** `Choose and save Woman or Man…` (196)
   * `!source_photo_path` → **400** `Upload a source photo before generating your character.` (199)
   * stien starter ikke med `{user.id}/` → **400** `The saved source photo path is invalid.` (201-203)
2. **Linje 204-219:** Storage-download fra bucket **`profile-images`** (bruger-klient);
   tomt/større end 10 MB → throw; MIME ∉ {jpeg,png,webp} → throw → begge ender som **502** i catch.
3. **Linje 222-228:** `moderateImage(sourceDataUrl)` (`openai-images.ts:94-133`);
   OpenAI 422 → kastet videre → **jsonError(error.message, 422)** via OpenAI-grebet (283).
4. **Linje 240:** RPC `reserve_ai_generation('character')` (`generation-usage.ts:28`).
5. **Linje 249:** `readReservationToken(serviceClient, …)` — service-rolle-læsning af
   `ai_generation_usage.started_at` for den in-progress-række (`generation-usage.ts:163-180`).

## 5. AI generation

**Hvornår:** Først EFTER reserve + status-skrivninger, via `launchBackgroundJob`
(`personal-model.ts:254-265`). Selve OpenAI-kaldet sker **ikke i requesten**.

**Job-funktion:**

* **Produktion:** Netlify Background Function **`personal-model-background`**
  (`netlify/functions/personal-model-background.mts`, linje 6-26) — hemmeligheds-tjek
  `secretMatches(x-job-secret, BACKGROUND_JOB_SECRET)` (linje 7-12, ellers **403**),
  miljø-tjek `jobEnvFrom(process.env)` (13-17, ellers **500**), payload-JSON (18-23),
  derefter `await runCharacterJob(env, payload)` (24) og svarer **202**.
* **Udvikelse (`astro dev`):** køres in-process uden await (`job-launcher.ts:19-31`,
  `void runInline(env, payload)`); mangler `BACKGROUND_JOB_SECRET`/env → returnerer
  `false` → route-kast `Could not start the background generation. Please try again.` (**502**, linje 266-270).
* **Selve jobbet:** `runCharacterJob` i `src/lib/server/ai/jobs/character-job.ts` **linje 65-183**.

**Billeder/input sendt til AI** (`character-job.ts:90-104`, `editImage`
`openai-images.ts:135-170`):

1. `sourceDataUrl` = brugerens kilde-foto fra `profile-images/{uid}/…` (linje 80-90).
2. `baseFormDataUrl` = kanonisk base-form (kun hvis det kan loades — fejl her nedgrades
   til `console.warn` og fortsætter uden, linje 92-97): `dressed_base_forms`-række →
   download af `model-images/{system…}` PNG 1024×1536 (`base-forms.ts:12-57`).
3. Prompt: `characterPrompt(gender, hasBaseForm)` (linje 20-53), `size "1024x1536"`,
   `quality high`, model `gpt-image-2.5-sunburst` (`openai-images.ts:14`), timeout
   **8 min** (`BACKGROUND_OPENAI_TIMEOUT_MS`, linje 10; default ellers 45 s, linje 151).

## 6. Storage upload

**Fil:** `src/lib/server/ai/jobs/character-job.ts`

* Sti: `generatedPath = "{userId}/personal-model-{uuid}.{ext}"` (**linje 119**).
* Upload: `userClient.storage.from("model-images").upload(generatedPath, bytes,
  { contentType, upsert: false })` (**linje 120-122**) — **bruger-klienten**
  (anon + brugerens access-token), IKKE service-rolle.
* `uploadError` → `console.error("Could not store the generated character.")` →
  `generatedPath = null` → kast `Could not save the generated character to your account.`
  (**linje 123-127**) → catch → status `failed`.
* Efter succes: fjernelse af den erstattede fil sker først EFTER publish (linje 171-182).
* Billedet valideres forud: PNG-signatur + IHDR 1024×1536 + decode (linje 105-117);
  ellers `The generated character must be a 1024x1536 PNG.` → catch → `failed`.

## 7. Database writes

**I requesten** (`personal-model.ts`, udført som **authenticated bruger**, IKKE service-rolle):

| Skrivning | Linje | Fejlkonsekvens |
|---|---|---|
| RPC `reserve_ai_generation('character')` (opretter/oppdaterer `ai_generation_usage`, `used_count+1`, `in_progress=true`) | 240 | **429/409** (`GenerationLimitError`, linje 282) eller **502** (`generation-usage.ts:33,43`) |
| `UPDATE profiles SET model_generation_status='pending'` via `setGenerationStatus` | 241 | false → kast `Could not start character generation.` → **502** |
| `UPDATE profiles SET model_generation_status='processing'` | 244 | kast `Could not update character generation status.` → **502** |
| Læs reservation via service-rolle (`ai_generation_usage.started_at`) | 249 | null → kast → **502** |
| (ved launch-fejl) `finishGenerationServer(…, false)` service-rolle | 267 | refund + udgiv lås |

`setGenerationStatus` er defineret **linje 152-172**: `client.from("profiles").
update(update).eq("user_id", userId).select("user_id").maybeSingle()` — fejler hvis
`error` **eller** `data` er tom (tomt data sker også hvis RLS/privilegier filtrerer
rækken væk, da `maybeSingle()` returnerer `null` uden fejl).

**I jobbet** (`character-job.ts`):

| Skrivning | Linje | Klient |
|---|---|---|
| `UPDATE profiles SET model_generation_status='failed'` (kun ved fejl) | 55-61, 160 | **serviceClient** (springer RLS) |
| RPC `publish_dressed_character(p_model_path, p_gender)` | 143-146 | **userClient** (SECURITY DEFINER, `auth.uid()`) |
| RPC `finish_ai_generation_server(…, succeeded)` (commit/refund + `in_progress=false`) | 162-164 | **serviceClient** (kun service-rolle, 0016) |
| `storage.remove([replacedModelPath])` | 175-177 | serviceClient |

**`publish_dressed_character`** (gældende: `supabase/migrations/202610040012_normalized_character_geometry_and_saved_outfits.sql` **linje 187-250**, `security definer`):

1. `auth.uid()` null → exception (200-202).
2. gender ∉ {woman,man} ELLER stien tilhører ikke brugeren → exception (203-206).
3. **Tjek mod `storage.objects`:** objekt i bucket `model-images` med `name =
   p_model_path` **og `owner_id::text = uid`**? Hvis ej → exception
   `'The generated character image is not stored in the user-owned private bucket.'` (**207-215**).
4. Profil-række med `gender = p_gender` findes? Hvis ej → exception (216-223).
5. `UPDATE dressed_characters SET is_primary=false` for øvrige primaries (225-228).
6. `INSERT dressed_characters (…, is_primary=true, 'normalized-v1')` (230-236).
7. **`UPDATE profiles SET model_photo_path = p_model_path,
   model_generation_status = 'completed' WHERE user_id = uid`** (**238-241**) —
   `if not found` → exception (242-244).
8. Returnerer nyt character-uuid.

## 8. Generation status

`profiles.model_generation_status` skiftes fem steder (dokumenteret med linje):

| Værdi | Hvor | Linje |
|---|---|---|
| `pending` | requesten, bruger-klient | `personal-model.ts:241` |
| `processing` | requesten, bruger-klient | `personal-model.ts:244` |
| `completed` | **kun** i SQL-publish (sammen med `model_photo_path`) | migration 0012:238-241 |
| `failed` | jobbets catch, service-rolle | `character-job.ts:160` |
| `failed` | requestens catch, bruger-klient (springes ved `GenerationLimitError`) | `personal-model.ts:277-281` |

**Kritisk rækkefølge (CONFIRMED):** ved succes sættes `completed` OG `model_photo_path`
i **samme SQL-transaktion** i publish; derefter `in_progress=false` i
`finish_ai_generation_server` (jobbets `finally`, linje 161-166). Ved fejl sættes
`failed` FØR `finally`. Frontenden kan derfor aldrig (i kodekæden) se `in_progress=false`
før status-resultatet er skrevet — der er ingen race mellem trinnene.


## 9. Polling

To uafhængige pollere i frontend:

1. **Den blokerende venten:** `waitForGenerationToFinish(accessToken, "character")`
   (`src/lib/client/generation-usage.ts:42-65`, kaldt `profile.astro:1103`).
   * Poll `GET /api/ai/usage` hvert **4 s**, deadline **16 min** (linje 47-48).
   * Returnerer når `character`-entry har `in_progress === false` (linje 59);
     ikke-OK svar og netværksfejl `continue`-es tyst (56, 60-62).
   * Timeout → kast `The generation is taking too long. Please check again in a moment.`
     (**linje 64**).
2. **Status-panelet:** `generation-flow.ts` `pollRunning` (linje 116-149) — samme
   endpoint; viser `MODEL READY ✓` ved `in_progress=false` efter >8 s (137-140).
   `MAX_RUNNING_MS` = 10 min (linje 6, 117) gælder kun panelets visning, ikke
   den blokerende venten.

`/api/ai/usage` (`src/pages/api/ai/usage.ts:6-28`) kører RPC
`get_ai_generation_usage()` (SECURITY DEFINER, `auth.uid()`-scopet, migration
0001, `revoke … from public, anon` + `grant execute … to authenticated`).

## 10. Frontend failure conditions

**Fil:** `src/pages/profile.astro`, håndtering af response (linje 1092-1180):

| Linje | Condition | Bruger-tekst |
|---|---|---|
| 1100-1112 | `status === 202` → vent på polling → læs `profiles.{model_generation_status,model_photo_path,gender}` via browserens supabase-klient | — |
| **1113-1119** | `outcome.model_generation_status !== "completed"` **ELLER** `!outcome.model_photo_path` (inkl. `outcome === null`) | `MODEL GENERATION FAILED. PLEASE TRY AGAIN.` |
| 1121-1123 | `!response.ok` (ikke-202) | bibeholder `result.error` fra body |
| **1125-1131** | `(status !== 202 && !ok) \|\| !result.modelPhotoPath` → `failFlow(...)` | **fallback-panelet opstår her** |
| 1138-1143 | signedUrl kan ikke dannes | `MODEL CREATED, BUT THE PREVIEW COULD NOT LOAD…` |
| 1166-1171 | catch — bl.a. timeout-kast fra polling (16 min), netværksfejl, `response.json()`-fejl | `MODEL GENERATION FAILED. PLEASE CHECK YOUR CONNECTION AND TRY AGAIN.` |

**Svar på opgave 17 — den præcise condition efter HTTP 202:**

```text
POST /api/ai/personal-model → 202 (profile.astro:1100)
    ↓
await waitForGenerationToFinish(...)   (1103; kaster efter 16 min → catch 1166)
    ↓
supabase.from("profiles").select(...).maybeSingle()   (1104-1112)
    ↓
profile.astro:1113
  outcome?.model_generation_status !== "completed"   ||   !outcome.model_photo_path
    ↓ JA (enhver af delene — eller outcome === null)
profile.astro:1119  result.error = "MODEL GENERATION FAILED. PLEASE TRY AGAIN."
    ↓
profile.astro:1125  betingelse opfyldt (result.modelPhotoPath = undefined)
profile.astro:1129  failFlow("MODEL GENERATION FAILED — " + ...)
    ↓
flow-panelet + modelDescription viser fejlen
```

`outcome === null` giver også denne gren: `maybeSingle()` kaster ikke ved tomme
resultater (hverken ved RLS-filtrering, ingen række eller læsefejl).

**Sådan kan status blive `≠ completed` efter et vellykket AI-kald (kæden fra
opgaven: AI generation → Storage upload → model_photo_path → status → polling → frontend):**

```text
editImage OK (OpenAI returnerede 1024×1536 PNG)
    ↓
[TRIN A] storage upload model-images/{uid}/personal-model-{uuid}.png  (character-job.ts:120)
         → uploadError → THROW "Could not save the generated character to your account."
[TRIN B] publish RPC: storage.objects-ejerskabstjek  (0012:207-215)
         → ej fundet → THROW "…not stored in the user-owned private bucket."
[TRIN C] publish RPC: INSERT dressed_characters  (0012:230-236)
         → fejl → THROW (f.eks. RLS/policy/unique)
[TRIN D] publish RPC: UPDATE profiles … status='completed'  (0012:238-241)
         → not found → THROW "The user profile could not be updated."
    ↓ alle THROW → catch (character-job.ts:152-160)
         → eventuel cleanup af uploade fil → status='failed' (service-rolle)
         → finishGenerationServer(succeeded=false) → in_progress=false + refund
    ↓
frontend-polling ser in_progress=false → læser profiles → status='failed'
    ↓
profile.astro:1113-1119 → 1125-1129 → "MODEL GENERATION FAILED…"  (fejl EFTER AI-generationen)
```


## 11. Possible SQL/RLS involvement

| # | Sted | Hvorledes SQL/RLS kan blokere | Klassifikation |
|---|---|---|---|
| R1 | `setGenerationStatus` i requesten (`personal-model.ts:241,244,280`) — `UPDATE profiles` som **authenticated** | **Ingen migration i repoet aktiverer RLS på `profiles`** og ingen policy/grant for `profiles` findes i repoet (tjekket: `Select-String 'row level security\|create policy\|grant … profiles'` i alle `supabase/migrations/*.sql` → kun `alter table public.profiles` til kolonnetilføjelser, 0001:5,16). Live-tilstand (RLS on/off + policy-tekst) er **UNVERIFIED** (`DRESSED-LIVE-DATABASE-INSPECTION.md:184`). Hvis live har RLS ON uden UPDATE-policy → `data=null` → false → **502 før 202** | **UNVERIFIED** (muligheden), **CONFIRMED** (at repoet ikke styrer det) |
| R2 | Frontendens `profiles`-SELECT efter 202 (`profile.astro:1104-1112`) | Samme ukendte RLS: filtreret række → `outcome=null` → linje 1113 falsk → fejl **selv om alt på serveren lykkedes**. Imod: `loadProfile` (linje 616-622) bruger samme SELECT ved sideindlæsning og viser status/foto — virker den, virker denne | **UNVERIFIED** |
| R3 | Publish' `storage.objects`-tjek (0012:207-215) | SQL der **læser Storage-tabellen**: kræver at uploaden faktisk lavede en ejer-spejlet række. Udføres af SECURITY DEFINER (bypasser egne policies, men læser `storage.objects`-data). Mis-match → exception → jobbet `failed` **efter** AI-generationen | **CONFIRMED** (mekanismen), **UNVERIFIED** (om det fejler live) |
| R4 | Storage-upload med bruger-klient (`character-job.ts:120`) | Storage-policies er **ikke i repoet** (`DRESSED-LIVE-DATABASE-INSPECTION.md:201-202`: "bucket-eksistens Confirmed; policies stadig ukendte"). Manglende INSERT-policy på `model-images` → upload-fejl → `failed` efter AI | **UNVERIFIED** |
| R5 | `finish_ai_generation_server` (0016, `auth.role()='service_role'`-guard) | Køres kun med service-nøglen (`character-job.ts:162`); repoet viser `grant execute … to service_role` (0016:48-51). Mislykkes → `released=false` → kun log (linje 165) — `in_progress` kan forblive `true` → frontend venter til 16-minutters-timouten | **CONFIRMED** (kæden), **UNVERIFIED** (live-grants) |
| R6 | `reserve_ai_generation` (0015:8-70, definer, `FOR UPDATE`) | `already_in_progress` inden for 5 min → **409** før 202; `limit_reached` → **429** (live-grænse er (3,5,1) ≠ repo (1,3,1), `DRESSED-LIVE-DATABASE-INSPECTION.md:174`) | **CONFIRMED** |
| R7 | `dressed_characters`-INSERT i publish (0012:230) | Tabellen har RLS ENABLE (0001:57) med kun SELECT-policy (0001:59); INSERT laves af definer og springer derfor RLS | **CONFIRMED** |

**Konklusion for SQL/RLS (svar til opgaven):** Ja — der er **tre dokumenterede
SQL/RLS-berøringspunkter der kan få kæden til at fejle efter en vellykket
AI-generation** (R3 publish-tjekket, R4 storage-upload, R2/R1 profiles-adgang), men
**hver isærs live-tilstand er UNVERIFIED**. Repoet kan hverken be- eller afkræfte dem.

## 12. Confirmed

* Hele execution-kæden og alle statusovergange med præcise linjer (se §1-§10).
* `model_photo_path` + `model_generation_status='completed'` skrives **kun** i SQL
  `publish_dressed_character` (0012:238-241), aldrig i TypeScript.
* Frontend-failiing efter 202 er **én** betingelse: `profile.astro:1113` → `1119` →
  `1125-1129`; alternativt timeout-kast `1103→1166-1171`.
* Requestens `UPDATE profiles` kører som **authenticated** (bruger-token, ikke
  service-rolle); jobbets `failed`-skrivning kører som **service-rolle**.
* Repo-migrations indeholder **ingen** RLS-aktivering, policies eller grants for `profiles`.
* Publish-RPC'en indeholder et SQL-tjek mod `storage.objects` (navn + `owner_id`)
  der kaster exception, hvis objektet ikke findes med den rette ejer.
* Reservationen/`in_progress`-låsen frigives altid i jobbets `finally`
  (`character-job.ts:161-166`) — undtagen hvis selve processen dør.
* Live-kvoter = (3,5,1) vs. repo (1,3,1) (live-inspektion L2).

## 13. Inferred

* Hvis brugeren ser fejlen **hurtigt** (sekunder–minutter) efter 202, kørte jobbet og
  fejlede → status=`failed` → frontend-gren 1113. Den mest sårbare del af den kæde er
  TRIN A-D i §10 (storage upload / publish RPC), ikke selve OpenAI-kaldet — for
  OpenAI-fejl ville give `OpenAIImageError`-beskeder, og base-form-fejl nedgraderes
  til warning.
* Hvis brugeren ser fejlen efter **~16 minutter**, er det timeout-grenen (job kørte
  aldrig/ikke færdigt: Netlify 403/500/manglende deploy, process-død, eller
  `finishGenerationServer`-fejl der lod `in_progress=true`).
* R2 (RLS-filtreret frontend-læsning) er **usandsynlig** men ikke udelukket: den
  ville producere præcis "serveren lykkedes men frontend siger fejl".

## 14. Unverified

* Live RLS-tilstand og policies for `profiles` (findes ikke i repoet).
* Storage-policies for `model-images`-buckets INSERT (findes ikke i repoet).
* Netlify-funktionslogs for `personal-model-background` (den konkrete undtagelse:
  `console.error("DRESSED character generation failed in the background job.", error)`
  `character-job.ts:153`).
* Om brugerens `used_count` har nået den live-kvote (3 for character).
* `BACKGROUND_JOB_SECRET`/`OPENAI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` i det
  deployede miljø.
* Om brugerens faktiske fejl meldte sig hurtigt vs. efter timeout.


## 15. Most likely first failure point

 rangeret ud fra kode (ikke fra logs — INFERRED hvor markeret):

**A. Hurtigt fejl (sekunder–minutter efter 202) — jobbet kørte og fejlede efter AI-kaldet:**

```text
editImage OK
  → TRIN A-D (§10): storage upload ELLER publish' storage.objects-tjek
    ELLER INSERT dressed_characters ELLER UPDATE profiles  THROW
  → character-job.ts:160  status='failed' (service-rolle)
  → finishGenerationServer(succeeded=false) → in_progress=false
  → profile.astro:1103 vender tilbage
  → profile.astro:1113  status 'failed' ≠ 'completed'
  → profile.astro:1119/1125/1129  failFlow("MODEL GENERATION FAILED — …")
```

**B. Langsomt fejl (~16 min) — jobbet kørte aldrig/fuldte aldrig:**
`waitForGenerationToFinish` timeout (`generation-usage.ts:64`) → `profile.astro:1166-1171`.

**C. Før 202 slet nås:** request-catch (`personal-model.ts:277-287`) — reserve-409/429,
`setGenerationStatus`-false, launch-fejl (`BACKGROUND_JOB_SECRET` mangler) → 502 →
`profile.astro:1125-1129`.

**Mest sandsynlige samlet (INFERRED, kan be-/afkræftes kun via logs):** **A** —
altså at **AI-generationen lykkes, men ét af de efterfølgende trin (storage upload
eller publish-RPC'ens fire gates) fejler og sætter status=`failed`**, hvorefter
frontend korrekt viser fejlen via `profile.astro:1113`. Det er præcis det scenarie
opgaven mistænker ("modellen genereret, men fejler bagefter ved Storage/database/status").

Hvorfor ikke C? C giver 502 med en **anden** tekst (fx `Could not start character
generation.`) — og den ville brugeren kunne genkende i Network-panelet. Hvorfor ikke B?
B tager 16 min — brugeren ville nævne ventetiden.

**SQL/RLS i dette første fejlpunkt:** muligt (R3/R4 i §11), men **ikke bekræftet** —
kun en live-log eller read-only DB-tjek kan skelne mellem TRIN A, B, C og D.

## 16. Exact next debugging step

1. **Læs Netlify-function-loggen for `personal-model-background`** og find:
   * `DRESSED character generation failed in the background job.` (`character-job.ts:153`)
     — den medfølgende `error`-værdi navngiver præcist TRIN A/B/C/D.
   * Foregående logs: `Could not store the generated DRESSED character.` (124),
     `Could not publish the generated DRESSED character.` (148),
     `The generated character must be a 1024x1536 PNG.` (111, som throw-tekst),
     `Could not verify the user.` (74) osv.
2. **Aflæs (read-only) brugerens `profiles.model_generation_status` +
   `model_photo_path` + `ai_generation_usage` via service-nøglen** — `failed` + tom
   path bekræfter gren A; `completed` + path bekræfter at fejlen er frontend-læsningen (R2).
3. Samtidigt: `GET /api/ai/usage`-svaret under brugerens session (in_progress/slå op).
4. **Stop her.** Først når loggen/DB-læsningen peger på ét trin (A-D) beslutter vi,
   om noget skal ændres.

---

*Oprettet: analyse-kun. Filer ændret: kun denne fil.*

