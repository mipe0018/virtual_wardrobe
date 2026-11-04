# DRESSED — Full AI Cost, Quota, Failure & Fallback Audit

> **READ-ONLY FORENSISK AUDIT.** Ingen projekt-fil, migration, Supabase-
> indstilling, pakke, konfiguration eller git-tilstand er ændret. **Kun denne
> rapport er skabt.**
>
> **Evidensklasser brugt konsekvent:**
> **[CODE]** = bevist fra DRESSED-kildekoden (fil:linje) ·
> **[SQL]** = bevist fra migrations/Supabase-konfiguration i repoet ·
> **[OPENAI-DOC]** = fra OpenAI's officielle dokumentation (hentet i session) ·
> **[TELEMETRY]** = ejerens OpenAI-dashboard-data ·
> **[ASSUMPTION]** = bevidst antagelse ·
> **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** = kan ikke bevises herfra.

---

## 1. Primary Business Requirement & Executive Summary

**Kravet:** *DRESSED må aldrig utilsigtet skabe en ubehersket AI-omkostning for
ejeren. En Supabase-kvotegrænse beviser IKKE, at en OpenAI-request ikke blev
faktureret.*

### De afgørende fund

| # | Fund | Evidens |
|---|---|---|
| **A1** | **Der findes INGEN max-attempts-kode i repositoryet.** Søgning efter `max_attempt/attempt_count/attempts_remaining` på tværs af alle `.ts/.sql/.astro` = **0 træffere**. Det eneste, der findes, er: `free_limit`-kvoter (1/3/1), en `in_progress`-lås og reservations-regnskab. Hvis et forsøgs-loft findes i live-Supabase, er det **ikke i versionskontrol** — **UNKNOWN/UNVERIFIED**. | [CODE]+[SQL] |
| **A2** | **Der er tre forskellige kvote-regnskabsmodeller** i koden: *character* = betalt ved reservation, refunderes ved fiasko · *clothing* = tælles **kun ved succes**, reservationen er kun en lås · *tryon* = betalt ved reservation, **aldrig refunderet** i det synkrone flow. | [SQL] `0015`, `0008`, `0011`, `0016` |
| **A3** | **Rent økonomisk er "bruger-kvoter" og "DRESSED's AI-omkostninger" to forskellige tal** (§15): moderation-kald, clean-preview-kald og fejlede-forsøg-kald er **ikke talt af nogen kvote**. | [CODE] |
| **A4** | **CLEAN-PREVIEW ER UBEGRÆNSET:** hvert garderobe-upload udløser 1 ukvoteret `images/edits`-kald + 1 moderations-kald; der findes **intet upload-loft, intet preview-loft, ingen reservation**. Set fra koden er omkostningen **UBEGRÆNSET**. | [CODE] `wardrobe/items/index.ts:79,450,556` |
| **A5** | **Scenario D (HIGH ECONOMIC RISK) er muligt i kode:** OpenAI genererer → storage- eller DB-fejl → jobbet refunderer **altid** kvoten ved fiasko → bruger kan prøve igen gratis → **hver gentagelse er et nyt, betalt OpenAI-kald**. Gælder både *character* (refundering) og *clothing* (tælles aldrig ved fiasko). | [CODE] `character-job.ts:152-166`, `clothing-job.ts:214-228` + [SQL] `0016:33-35` |
| **A6** | **Kvote-låsen kan omgås af en ondsindet bruger ved clothing:** `reserve_clothing_ai_generation` tæller først ved succes, **reservation-tokenet sendes til klienten i 202-svaret**, og RPC'en `finish_clothing_ai_generation(token,false)` er **givet til `authenticated`** → bruger kan rydde sin egen lås manuelt og starte en ny generation → **uendeligt mange samtidige OpenAI-kald**. | [SQL] `0008:66-114` + [CODE] `process-clothing.ts:527` |
| **A7** | **Moderering køres FØR kvote-reservation** på personal-model og process-clothing → selv en bruger med opbrugt kvote udløser stadig et OpenAI-kald (`omni-moderation-latest`). Om moderering faktureres: **UNKNOWN — REQUIRES EXTERNAL VERIFICATION**. | [CODE] `personal-model.ts:222→240`, `process-clothing.ts:421→503` |
| **A8** | **Dobbeltklik/automatik: beskyttet.** Alle tre knapper deaktiveres/forsvinder før `fetch`; **ingen auto-retry** findes i klienten; server-lås (`already_in_progress`) er andet lag. | [CODE] `profile.astro:1148,1571-1574,1716` |
| **A9** | **To AI-endpoints er forældede (0 klient-referencer) men stadig kaldbare med et JWT:** `dress-model` (OpenAI, synkron, tæller `tryon`) og `try-on` (FASHN, ikke OpenAI-billede). | [CODE] grep = 0 referencer |
| **A10** | **Reservationerne er atomiske** (én plpgsql-funktion + `FOR UPDATE`-række-lås) → to samtidige reserver **kan ikke** passere kvoten ad ren racevejen; race-vinduer opstår kun via (a) den klient-farlige finish-RPC (A6) og (b) den 5-minutters stale-lås-auto-rydning. | [SQL] `0015:40-56`, `0008:37-56` |

**OVERORDNET: RED** (§18) — én sti (clean-preview) er ubegrænset set fra koden, og
én sti (clothing) kan bevidst gøres uendelig. **12 af 12 AI-stier kan bevirke
et OpenAI-kald, der ikke er talt af nogen bruger-kvote** — hver af dem skal
kortlægges, før DRESSED tager imod rigtige penge (§20).

---

## 2. Complete Map — every path that can result in an AI request

**Søgemetode (hele repoet, [CODE]):** `editImage(`, `moderateImage(`,
`generateFashnTryOn`, `fetch("/api/ai/…")` + nøgleordene
`retry/attempt/quota/usage/fallback/failed/timeout/abort/catch/preview` på
alle `.ts/.astro/.sql` (undtagen `node_modules`, `dist`, `.netlify`, `.kilo`).

### 2.1 De eneste steder, der rører OpenAI (komplet liste)

| # | Fil:linje | Funktion | Type |
|---|---|---|---|
| 1 | `lib/server/ai/openai-images.ts:135` | `editImage` → `POST /v1/images/edits` (`gpt-image-2.5-sunburst`, `quality: high`, `n:1`, PNG) | **billed-generation** |
| 2 | `lib/server/ai/openai-images.ts:94` | `moderateImage` → `POST /v1/moderations` (`omni-moderation-latest`) | moderation |
| 3 | `lib/server/ai/fashn-space.ts` | FASHN/HuggingFace (ikke OpenAI) | ekstern |

### 2.2 Alle kaldesti — fra brugerhandling til OpenAI

| Sti | Klient-adgang | Endpoint | Reservation? | OpenAI-kald pr. handling | Kvote-model |
|---|---|---|---|---|---|
| **S1 — Personlig AI-model** | `profile.astro:1169` (knap) | `POST /api/ai/personal-model` | `reserve("character")` **efter** moderation | **2**: moderation + job `editImage` | +1 ved reservation, −1 ved jobfiasko (service-RPC) |
| **S2 — Beklædning AI-ready** | `profile.astro:1575` → `wardrobe-ai.ts:136` | `POST /api/ai/process-clothing` | `reserve_clothing` **efter** moderation | **2**: moderation + job `editImage` | **+1 KUN ved succes** (lås ellers) |
| **S3 — Clean preview pr. upload** | `profile.astro:1731` → `wardrobe-ai.ts:199` | `POST /api/wardrobe/items` | **INGEN** | **2**: moderation + `editImage` (`1024x1024`, `:79`) | **INGEN KVOTE** |
| **S4 — Kilde-foto moderation** | `profile.astro` (fotoupload) | `POST /api/profile/source-photo` | ingen (ikke en generation) | **1**: moderation | ingen |
| **S5 — Outfit-try-on (synkron)** | **ingen klient (orphant)** — men POST med JWT virker | `POST /api/ai/dress-model` | `reserve("tryon")` **før** `editImage`, **ingen moderation** | **1**: `editImage` (synkron) | +1 ved reservation, **refunderes aldrig** |
| **S6 — FASHN try-on (legacy)** | **ingen klient (orphant)** | `POST /api/ai/try-on` | `reserve("tryon")` efter 2× moderation | 2× moderation + FASHN (ikke OpenAI-billede) | +1, `finish` = kun lås ⇒ konsumeret ved fiasko |
| **S7 — Diagnostik (DEV)** | `?diagnostic=A/B/C`, **kun** `import.meta.env.DEV` | personal-model | **bevidst uden kvote** | 1 `editImage`, **resultat kasseres** | ingen (kompileres ud af produktion) |
| **S8 — Force-regenerate (DEV)** | header `FORCE_REGENERATE`, **kun** DEV | process-clothing | normal | normal | normal |

**Verificeret fravær:** ingen anden OpenAI-brug i repoet; `dress-model` og
`try-on` har **0 klient-referencer**; closet/wardrobe-astro kalder **ingen**
AI-endpoints; `background.ts` indeholder kun de to job-moduler.

### 2.3 Kald pr. handling — det nøgletal, prisen hviler på

```text
Ét klik "GENERATE AI MODEL"   = 1 moderation + 1 billed-generering = 2 OpenAI-requests
Ét klik "MAKE IT AI READY"    = 1 moderation + 1 billed-generering = 2 OpenAI-requests
Ét garderobe-UPLOAD           = 1 moderation + 1 billed-generering = 2 OpenAI-requests  ← INGEN KVOTE
Ét dress-model kald (orphant) = 1 billed-generering                = 1  OpenAI-request
Empirisk pris pr. billed-request ≈ $0,064 ≈ 0,43 DKK [TELEMETRY]
```

---

## 3. Mapped AI Generation Flows (faktisk kode — ikke antaget)

### 3.1 S1 — Personlig AI-model (character)

```text
Bruger klik "GENERATE AI MODEL ✦"                  profile.astro:1137
  └ createModelButton.disabled = true              :1148  ← dobbeltklik-lås FØR fetch
Frontend POST /api/ai/personal-model (JWT)
  └ authenticateSupabaseRequest                    personal-model.ts:175
  └ profil-tjek (gender, kildefoto)                :184-218   [ingen kvote endnu]
  └ moderateImage(kildefoto)                       :222  ← OPENAI-KALD #1 (FØR reservation)
  └ (kun DEV: ?diagnostic → editImage, kasseres)   :233-238
  └ reserveGeneration("character")                 :240  ← +1 og in_progress-lås, FOR UPDATE [SQL 0015]
  └ status pending→processing                      :241-246
  └ readReservationToken (service-rolle)           :249
  └ launchBackgroundJob (Netlify background fn)    :254  ← kører uafhængigt af browseren
      └ job: hent foto → editImage 1024x1536       character-job.ts:99   ← OPENAI-KALD #2
      └ PNG-signatur + mål + decode (lokal)        :106-116
      └ upload model-images/{uid}/…                :120-126
      └ RPC publish_dressed_character              :143
      └ finally: finishGenerationServer(succeeded) :162  ← [SQL 0016] fiasko ⇒ used_count − 1 (REFUND)
  └ 202 → klient poller /api/ai/usage hvert 4. s (timeout 16 min)   generation-usage.ts:42-64
  └ resultat: completed → signed URL + UI-cache    profile.astro:1196-1241
              failed    → "TRY AGAIN"              :1208-1213  ← brugeren kan straks trykke igen
  └ finally (kun hvis job IKKE startede):
        finishGeneration(client,"character")       :289  ← [SQL 0001] KUN lås, INGEN refund
Fallback: UI-cache/legacy-nøgler — ren visning, INGEN nyt AI-kald.
```

### 3.2 S2 — Beklædning AI-ready (clothing)

```text
Bruger klik "MAKE {WOMAN|MAN} AI READY"            profile.astro:1571
  └ processingItemIds.add(key) + renderItems() SYNKront :1572-1574  ← knappen forsvinder (re-entry-sikker)
Frontend POST /api/ai/process-clothing (JWT)       wardrobe-ai.ts:136
  └ auth + validering + hent original (≤ 4 MB)     process-clothing.ts:231-415
  └ moderateImage(original)                        :421  ← OPENAI-KALD #1 (FØR reservation)
  └ cache-tjek: asset i ret version? → returner EKSEISTERENDE, INGEN AI   :354-370
  └ reserveClothingGeneration()                    :503  ← LÅS UDEN tælling [SQL 0008]
  └ launchBackgroundJob                            :506
      └ job: original + basisform → editImage      clothing-job.ts:72   ← OPENAI-KALD #2
      └ PNG-validering                             :119-132
      └ upload model-images/{uid}/…                :172-177
      └ opdater wardrobe_item_ai_assets            :183-196
      └ finally: finishClothingGeneration(persisted) :224  ← [SQL 0011] succes ⇒ +1 ; fiasko ⇒ 0
  └ 202 {usage:{usedCount, freeLimit, reservationStartedAt}} ← TOKEN VISES KLAGENTEN   :527
  └ klient: waitForGenerationToFinish → reload     wardrobe-ai.ts:154-163
  └ fejl → "did not finish. Please try again."     :162  ← brugeren trykker igen (og gør det)
Fallback: kun fejlbesked + knap; ingen skjult AI.
```

### 3.3 S3 — Clean preview pr. upload (HØJ RISIKO — INGEN KVOTE)

```text
Bruger klik "ADD CLOTHING" → udfylder → submit     profile.astro:1691-1716
  └ submitButton.disabled = true FØR async         :1716
Frontend POST /api/wardrobe/items (JWT, ≤ 4 MB)    wardrobe-ai.ts:199
  └ auth + validering                              items/index.ts:386-418
  └ HVIS NY ORIGINAL: moderateImage(original)      :450  ← OPENAI-KALD #1  [INGEN KVOTE]
  └ upload {uid}/clothing-originals/…              :461
  └ opdater wardrobe_items                         :~475-488
  └ HVIS preview_path mangler (første gang):
        createCleanPreview(...)                    :542-568
          └ editImage 1024x1024, "product cutout"  :79-95  ← OPENAI-KALD #2  [INGEN KVOTE, INGEN RESERVATION]
          └ PNG-signatur + decode                  :96-103
          └ upload {uid}/clothing-previews/…       :105-108
          └ opdater wardrobe_items.preview_path    :113-117  ← cache: samme item gen-genereres IKKE
  └ 200 {item:{…, previewError}}                   :589-603
  └ fejl → previewError vist, ORIGINAL BEHOLDES    :1740-1744  ← brugeren kan gemme igen = NYT forsøg
```

**Grænser fundet:** per-request 4 MB (antal requests **ubeskyttet**), preview
gemmes pr. item-id (cache ✓), men **intet loft over antal items, ingen
reservation, ingen tæller, ingen forsøgs-grænse.**

### 3.4 S5 / S6 / S7 — øvrige stier

| Sti | Kritisk sekvens | Eksponering |
|---|---|---|
| **S5 dress-model** (synkron, OpenAI) | cache-slag på `outfit_key` (`:149-173`, **ingen AI ved træf**) → `reserve("tryon")` (`:285`) → `editImage` (`:292`) → upload (`:307`) → insert `wardrobe_results` (`:330`) → **finally: `finishGeneration` = KUN lås** (`:377`) ⇒ **fiasko KONSUMERER kvoten** (aldrig refunderet); **ingen moderering** overhovedet | **0 klienter**, men POST med JWT virker (kaldbar direkte) |
| **S6 try-on.ts** (FASHN, ikke OpenAI-billede) | moderation ×2 (`:200-201`) → `reserve("tryon")` (`:215`) → `generateFashnTryOn` (`:217`, timeout-beskyttet) → upload → **finally `finishGeneration` (kun lås)** (`:297`) | **0 klienter** |
| **S7 diagnostik** | `import.meta.env.DEV`-gate (`personal-model.ts:233`); **uden reservation**; `editImage` med resultat der **kasseres** (`:124`) | **kun udvikling** — kompileret ud af produktion; skal dog **aldrig** eksponeres |

**Notat:** S6 hedder "try-on" men er **ikke** en OpenAI-billed-omkostning;
S5 **er** en OpenAI-omkostning og er stadig aktiv i serverbussen.

---

## 4. Critical Question — hvornår kaldes OpenAI egentlig?

| Q | Spørgsmål | Svar | Bevis [CODE/SQL] |
|---|---|---|---|
| **Q1** | Tjekkes kvoten **før** OpenAI? | **Delvist.** For billed-generering: **JA** (reservationen ligger før job/opkald). For **moderation: NEJ** — modereringen kører FØR reservation på S1, S2, S3, S6 | S1 `:222`→`:240`; S2 `:421`→`:503`; S3 har **ingen** reservation |
| **Q2** | Reserveres/afkortes kvoten **før** OpenAI? | **JA** for S1/S2/S5/S6 (reservation før `editImage`). **NEJ for S3 (clean preview) — der reserveres aldrig** | S1 `:240` før job; S5 `:285` før `:292`; S3: ingen reserve-kald i hele filen |
| **Q3** | Kan flere requests passere kvote-tjekket samtidig? | **Nej ad ren racevej** (én plpgsql-transaktion + `select … for update` serialiserer), **MEN** (a) klienten kan selv rydde låsen via `finish_ai_generation` (ingen token!) og `finish_clothing_ai_generation(token,false)` (token i svaret), og (b) stale-lås ryddes automatisk efter 5 min → to jobs kan overlappe | `0015:40-56`, `0008:37-56`, `0001:343-357`, `0008:79-114`, `process-clothing.ts:527` |
| **Q4** | Kan OpenAI kaldes hvis reservationen fejler? | **JA for moderering** (den er før reservation). **NEJ for billed-generering** — `editImage` findes kun inde i jobbet, som kun lanceres efter en godkendt reservation | S1/S2-rækkefølgen ovenfor; ved `GenerationLimitError` → 409/429 uden job |
| **Q5** | Kan én brugerhandling give >1 billed-kald? | **Nej** — ét `editImage` pr. handling (n:1, ingen interne retries). **Men én handling = 2 OpenAI-HTTP-kald** (moderation + billede) | `openai-images.ts:142-151` (enkelt fetch), `:94-98` |
| **Q6** | Kan frontend-retry skabe flere kald? | **Nej automatisk.** Ingen auto-retry findes (grep=0); brugeren **kan** klikke igen straks efter fejl — det er et nyt, fuldt kald | grep `retry` = kun fejltekster; knap-genskabelse i `finally` |
| **Q7** | Kan API-retry skabe flere kald? | **Ingen intern retry** i `requestOpenAI` (én fetch + `AbortSignal.timeout`). Netlify-genforsøg af svigtende background functions: **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** | `openai-images.ts:53-88` |
| **Q8** | Kan timeout-håndtering skabe et nyt kald? | **Nej af sig selv** (timeout kaster 504, prøver ikke igen). Men: hvis OpenAI **nåede** at generere før timeout ⇒ **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** om det er faktureret | `:67-75` |
| **Q9** | Kan fallback udløse endnu en generation? | **Nej.** Alle fundne fallbacks er UI-lagre/fejlbeskeder (`dressed-character`-cache, legacy `closet-items`, `assetResponse`-cache, `outfit_key`-cache) — **intet fallback kalder AI** | `profile.astro:1236`, `wardrobe-ai.ts:154-183`, `dress-model.ts:149-173` |
| **Q10** | Kan clean-preview omgå den normale kvote? | **JA — helt.** S3 har hverken reservation, tæller eller forsøgs-grænse (bevis i §9) | hele `items/index.ts`-POST'en |

---

## 5. Failed Generation Analysis — finansiel afvigelse pr. scenarie

**Forbehold først — OpenAI-billing kan ikke bevises herfra.**
`platform.openai.com/docs/pricing` og billed-guiden blev hentet i sessionen,
men gav **ingen** entydig tekst om (a) fakturering af fejlede requests,
(b) moderation-endepunktets pris eller (c) timeout-fakturering
(**UNKNOWN — REQUIRES EXTERNAL VERIFICATION**, §20). Derfor bruges kun den
**empiriske** sats $0,064/request [TELEMETRY] og følgende sikre sandhed:
*enhver request der er sendt og accepteret af OpenAI skal betragtes som
muligvis betalt.*

### Scenario A — Requesten når aldrig OpenAI

Eksempler fra koden: auth-fejl (401), profil mangler (404), køn ikke valgt
(409), kildefoto mangler/for stort/format (400/500), kvote-opbrugt (429),
`already_in_progress` (409), reservation-RPC-fejl, job-launch fejl
(`started=false`), JSON-/valideringsfejl.

| Sti | Bruger-kvote | DRESSED-omkostning | OpenAI | Fallback |
|---|---|---|---|---|
| S1 | reservation udført? **Kun hvis fejlen sker efter `:240`** (f.eks. status-opdatering) → da **konsumeret uden refund** (client-finish rydder kun låsen) | 0 | 0 (moderation kan allerede være kørt — se B3) | UI-fejl |
| S2 | lås udført, **0 tælling** ⇒ intet tab for bruger | 0 | 0 (samme moderation-forbehold) | UI-fejl |
| S5 | +1 **konsumeret** ved reservation før fejl | 0 | 0 | UI-fejl |
| S3 | **ingen kvote findes** | 0 for preview (preview nåede ikke), men **moderation kan være kørt** | 0 | `previewError`, original beholdes |

**Konklusion A:** normalt 0 AI-omkostning; **men** moderationen forud for
reservationen betyder at "bruger med opbrugt kvote" **stadig** kan udløse et
OpenAI-kald (A7) — om det koster: **UNKNOWN — REQUIRES EXTERNAL VERIFICATION**.

### Scenario B — Requesten sendes, OpenAI svarer med HTTP/API-fejl

```text
Moderations-422  → bruger-beskedeles fejl (indhold) → INGEN yderligere kald → kvote:
   S1/S2: reservation sker FØRST bagefter ⇒ normalt slet ikke reserveret
editImage 4xx/5xx/429 → OpenAIImageError kastes →
   S1 job: catch → setStatus("failed") → finish(succeeded=false) ⇒ KVOTE REFUNDERET [SQL 0016]
   S2 job: catch → finish(persisted=false) ⇒ ALDRIG TÆLLT [SQL 0011]
   S5:    catch → finally(finish) ⇒ KVOTE FORBRUGT (ingen refund)
Fakturering af selve fejlen:            ★ UNKNOWN — REQUIRES EXTERNAL VERIFICATION ★
```

**Økonomisk mismatch (kernen i auditet):** hvis OpenAI alligevel fakturerer
en delmængde af fejlede requests (timeout midt i generering, content-policy
efter behandling, service-fejl efter arbejde) ⇒ **DRESSED betaler, brugerens
kvote rulles tilbage (S1/S2) → bruger kan straks trykke igen → loop af
betalte kald** ved en systematisk fejl. Dette er præcis det, kvotesystemet
**ikke** beskytter mod.

### Scenario C — OpenAI svarer, men resultatet er ubrugeligt

Kodens validering efter `editImage`: tom/over 20 MB/base64-mismatch
(`openai-images.ts:162-168`), fejlsignatur af PNG, forkerte mål
(`character-job.ts:106-116`, `clothing-job.ts:119-132`), decode-fejl,
upload-fejl (`character-job.ts:120`), publish/RPC-fejl (`:143-150`),
DB-insert-fejl (`dress-model.ts:341`).

| Spørgsmål | Svar |
|---|---|
| Var OpenAI allerede kaldt? | **JA — altid** (fejlen opstår efter `editImage`) |
| Kan DRESSED allerede have en omkostning? | **JA** — en generation er sendt og returneret. *Om et returneret men efterfølgende forkastet billede er faktureret:* **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** (kan ikke afvises) |
| Refunderes brugerens kvote? | **S1 JA** (−1) · **S2 ja-ækvivalent** (aldrig talt) · **S5 NEJ** |
| Kasseres resultatet? | **JA** — S1 fjerner uploade filer (`:154-159`), S2 fjerner uploade filer (`:216-221`), S5 fjerner delresultatet (`:363-368`) |
| Er der retry? | **Ingen automatisk.** Brugeren opfordres til at prøve igen = **nyt, betalt kald** |
| Fortæller brugeren at det fejlede? | **JA** (status `failed`, fejltekst) |

### Scenario D — Storage fejler efter en vellykket generation

```text
[BEKRÆFTET MULIGT I KODE]
editImage OK (OPENAI BETALT) → upload {uid}/… fejler
  S1: character-job.ts:120-126 fejl → catch → finish(succeeded=false) → KVOTE REFUNDERET
      → bruger ser "FAILED — TRY AGAIN" → klik igen → NYT BETALT KALD → kan gentages uendeligt
  S2: clothing-job.ts:172-177 fejl → finish(persisted=false) → 0 TÆLLING
      → "try again" → NYT BETALT KALD → kan gentages uendeligt
  S5: dress-model.ts:307-316 fejl → finally(finish) → kvote FORBRUGT (bruger-tab, ikke omkostnings-loop)

  ★★★ HIGH ECONOMIC RISK — bekræftet for S1 og S2 ★★★
  (Præcis den sekvens opgaven beskriver: OpenAI betalt → storage-fejl →
   kvote refunderet → bruger ser fejl → nyt, betalt kald.)
```

**Begrænsning:** loopet stopper kun ved (a) at fejlen ophører, (b) nettet
fejler, eller (c) et endnu ikke-eksisterende forsøgs-/spend-loft. **Der findes
intet loft i koden** (A1).

---

## 6. Max Attempts / Supabase Audit

### 6.1 Hvad der FAKTISK findes (og ikke findes)

| Påstand fra opgaven | Fund i repoet | Evidens |
|---|---|---|
| "max-attempts er implementeret i Supabase" | **INGEN maks-forsøgs-kode findes** i de 17 migrations eller i nogen kildefil (søgning: `max_attempt/attempt_count/attempts_remaining/max_attempts` = **0 træffere**) | [CODE]+[SQL] |
| Kvoter findes | **JA:** `ai_generation_limits.free_limit` = **character 1 · tryon 1 · clothing 3** (ejereksklusion via `app_metadata.is_owner`) | `0015:6-7`, `0015:29-31` |
| Reservation/lås findes | **JA:** `in_progress` + `started_at`-token med **5-minutters stale-rydning** | `0015:43-63`, `0008:43-56` |
| Refundering findes | **JA men uens:** character-refund via service-RPC (−1 ved fiasko); clothing tælles kun ved succes; **tryon refunderes aldrig** i det synkrone flow | `0016:33-35`, `0008:99`, `0001:353-356` |

> **Ærlig konstatering:** hvis et max-attempts-system kører i det **live**
> Supabase-miljø, er det **ikke versionskontrolleret** og kan derfor ikke
> auditeres herfra → **UNKNOWN — REQUIRES EXTERNAL VERIFICATION**. Alt
> nedenfor bedømmer det system, der **er** i koden.

### 6.2 Hvor systemet kontrolleres (server-side? atomisk?)

| Egenskab | Svar | Bevis |
|---|---|---|
| Hvor lagres grænsen | `ai_generation_limits` (global tabel, `SECURITY DEFINER`-RPC) | `0015:26-31` |
| Hvor kontrolleres den | **Kun server-side**, inde i `reserve_*`-RPC'erne | `0015:58-62`, `0008:58-61` |
| Atomisk? | **JA** — én plpgsql-funktion med `insert … on conflict` + `select … for update` (række-lås) | `0015:33-63` |
| Kan samtidige requests omgå den? | **Ikke ved ren race** (låsen serialiserer). **Ja manuelt** — se §7 | `0015:40-56` |
| Kontrolleret før **hvert** OpenAI-kald? | **NEJ** — moderationen (S1/S2/S3) og **hele S3 (clean preview)** er uden reservation | §4 Q1/Q2/Q10 |
| Gælder alle AI-endpoints? | **NEJ:** S3 (clean preview) og S4 (foto-moderation) har **ingen** kvote | §2.2 |
| Dækker clean-preview? | **NEJ** | §9 |
| Refunderes fejlede requests? | **S1 JA / S2 ækvivalent / S5 NEJ** | §5 |
| Kan refund-skabte gentagelser give flere betalte kald? | **JA — ubegrænset ved systematisk fejl** (ingen forsøgsgrænse) | §5B/D |

### 6.3 Hvad kvotesystemet BESKYTTER mod — og hvad det IKKE gør

**Beskytter mod:** (1) at én bruger opnår flere *vellykkede* resultater end
tilladt; (2) to samtidige jobs af samme type ad ren racevej; (3) ubegrænset
*succesrigt* forbrug; (4) bevidt ejer-undtagelse (`is_owner`).

**Beskytter IKKE mod:** (1) **rene omkostninger** — moderation, clean-preview
og fejlede-forsøg-kald er alle ukvoterede; (2) **refund-loops** efter betalte
fiaskoer; (3) **manuel lås-rydning** via client-RPC'erne; (4) **stale-lås-
overlap** efter 5 min; (5) orphante endpoints med anderledes regnskab (S5);
(6) **nye konti** (kvote er pr. `user_id`); (7) **ejeren selv** (`is_owner`);
(8) nogen form for **dags-/globalt spend-loft** — koden tæller kun
`used_count`, aldrig DKK.

---

## 7. Concurrency / Race Conditions (kode-analyse)

| Scenarie | Muligt? | Bevis | Økonomisk påvirkning |
|---|---|---|---|
| A og B checker kvoten samtidig, begge går videre | **NEJ** (ren race) | `select … for update` i samme transaktion (`0015:40`, `0008:37`) — andet kald ser `in_progress` og afvises (`already_in_progress`) | 0 |
| A og B er **clothing**; B manuelt rydder A's lås midt i | **JA** | `finish_clothing_ai_generation(token,false)` er `grant … to authenticated` (`0008:114`), **token sendes til klienten** (`process-clothing.ts:527`), og `used_count` tælles først ved succes ⇒ næste reserve godkendes | **Ubegrænset antal samtidige jobs = ubegrænset OpenAI-forbrug** (ondsindet bruger) |
| Samme for character/tryon via `finish_ai_generation` | **Kun delvis** | `0001:343-357` har **ingen token-tjek**, men reserve **tæller +1** hver gang ⇒ ved limit 1 afvises andet forsøg | Ingen kvote-omgåelse (lås kan frigives tidligt) |
| Job kører >5 min, bruger klikker igen | **JA** | stale-rydning efter 5 min (`0015:51-56`, `0008:51-56`) ⇒ to jobs overlapper | +1 betalt kald pr. tilfælde (~0,43 DKK); job normalt <5 min [ASSUMPTION] |
| HTTP-duplikat af samme request | **JA** | ingen idempotens-nøgle (§12) | +1 betalt kald pr. duplikat |
| Ren "select-then-update" i applikationskode | **ikke fundet** — al kontrol ligger i SQL-RPC'erne | [SQL] | — |

**Kvantificeret:** den **rene racevej er sikker**; den økonomiske
sikkerhed hviler derfor på de to **men-veje**: manuel lås-rydning (clothing,
potentielt uendeligt) og stale-lås-overlap (enkeltstående +1).

---

## 8. Frontend Double-Click / Retry Audit

| Knap / sti | Deaktiveres mens den arbejder? | Pålidelig? | Auto-retry? | Flere requests mulige? | Bevis |
|---|---|---|---|---|---|
| **GENERATE AI MODEL** (S1) | **JA** — `disabled = true` *før* alle `await` (også før session-tjek) | ✓ knappen genskabes kun i `finally` **efter** polling er slut (op til 16 min) | **Nej** (grep=0) | Kun ved nytteligt tryk **efter** fejl/timeout | `profile.astro:1148`, `:1255-1262` |
| **MAKE … AI READY** (S2) | **JA, men via re-render** — klikket sætter `processingItemIds` + `renderItems()` **synkront først**; knappen eksisterer ikke mens `isProcessing` | ✓ andet klik rammer en fjernet knap; server-lås er lag 2 | **Nej** — men fejlteksten "Please try again" opfordrer brugeren | Manuelt igen ja (server: `already_in_progress` i 5 min) | `profile.astro:1561-1594` |
| **Upload (ADD CLOTHING)** (S3) | **JA** — `submitButton.disabled = true` før async, `finally → false` | ✓ | **Nej** | Ny submit = nyt item = nyt preview-kald | `profile.astro:1716`, `:1778-1781` |
| **dress-model (S5)** | **ingen UI** (orphant) | — | **Nej** | Direkte POST kan gentages frit (kvote 1, cache ved samme `outfit_key`) | §2.2 |
| **Polling `waitForGenerationToFinish`** | — | 16-min timeout → kaster → UI-fejl | fortsætter ved netfejl (`continue`) | **ingen nye AI-kald** (kun `/api/ai/usage` GET) | `generation-usage.ts:49-64` |
| **reloadAfterSuccess** | — | `location.reload()` efter 900 ms | — | **ingen AI-kald** (kun GET) | `profile.astro` (function `reloadAfterSuccess`) |

**Mobil vs. desktop:** samme kode, samme knap-tilstande — **ingen
forskel** fundet [CODE]. **Browser-genforsøg af POST:** `fetch` laver ikke
automatisk retry; genforsøg ved netafbrydelse foretages kun, hvis **brugeren**
klikker igen [ASSUMPTION: standard-browseradfærd].

**Samlet:** frontend-laget er **stærkt** (den svageste enkeltfejl er ikke
dobbeltklik, men den **bruger-styrede gentagelse efter en refunderet fiasko**
— §5D — som knap-tilstanden bevidst inviterer til).

---

## 9. Clean-Preview Audit (HØJ PRIORITET)

| Spørgsmål | Svar | Bevis |
|---|---|---|
| Præcis endpoint | `POST /api/wardrobe/items` (samme route som selve uploadet) | `items/index.ts:385` |
| Præcis model | `gpt-image-2.5-sunburst` via `/v1/images/edits`, `size 1024x1024`, `background: opaque`, `quality: high` | `openai-images.ts:14`, `items/index.ts:79-95` |
| Antal OpenAI-kald pr. upload | **2**: moderering af originalen (`:450`, kun ved ny original) + preview-generering (`:556→79`) | [CODE] |
| Kan én upload give flere kald? | **Nej** per upload (én preview). **Ja** hvis brugeren gemmer igen efter fejl (preview_path mangler → forsøger igen) | `:542-568` |
| Findes der retries? | **Ingen automatisk**; bruger-genskabelse = nyt kald | §8 |
| Findes et upload-loft? | **NEJ** — kun 4 MB pr. fil; **intet loft over antal items** (intet `count()`-tjek i POST'en) | `:394-416` |
| Findes et preview-loft? | **NEJ** — hverken kvote, tæller eller reservation i hele POST'en | søgning: 0 `reserve*`-kald i filen |
| Refunderes fejlede preview-kald? | **Ingen kvote at refunderer** (aldrig talt). Brugeren kan gemme igen = **nyt betalt kald** | `:556-568` |
| Caches et succesfuldt preview? | **JA** pr. item-id (`preview_path` sættes; gen-generering undgås) | `:540-542`, `:113-117` |
| Genbruger det samme billede et nyt kald? | **Nej for samme item-id**. **Ja for et nyt item-id** — hver upload med nyt `crypto.randomUUID()` starter forfra | `profile.astro:1705` (`id: crypto.randomUUID()`) |
| Udløser dublet-upload nye kald? | **JA** — identisk fil med nyt id = nyt preview-kald (ingen hash-dedup) | [CODE] |

### Det teoretiske maksimum i dag

```text
Ét preview-kald pr. unikt item-id. Antal item-ids er UBEGRÆNSET i koden.
  → Teoretisk maks. for ÉN bruger via clean-preview alene:
        UBEGRÆNSET (kun begrænset af rate/timeout/økonomi — ikke af kode)
  → Omkostning: 0,43 DKK pr. preview + moderation [TELEMETRY]

  ★★★ OMKOSTNINGEN ER UBEGRÆNSET SET FRA DEN NUVÆRENDE KODES PERSPEKTIV. ★★★
```

**Yderligere lukket sløjfe:** fejler previewet, bliver originalen **ikke**
fjernet og `previewPath` forbliver `null` ⇒ **hver** gen-forsøgt gemning af
det samme item kalder OpenAI igen — også selv om brugeren bare retter et
navn. (Denne gren træffer kun items uden preview.)

---

## 10. Fallback Audit

**Søgning:** alle `catch`-blokke, cache-/legacy-felter og fejlstier i de AI-
tilknyttede filer. **Konklusion: intet fallback genererer nyt — alle fallbacks
er enten UI-lagre, cache-træf eller fejltekster.** Men flere fallbacks
**skjuler** at DRESSED allerede har betalt (ved at vise noget andet eller ved
at lade brugeren prøve igen).

| Flow | OpenAI kaldet? | Kvote forbrugt? | Kvote refunderet? | Mulig DRESSED-omkostning? | Fallback-karakter |
|---|---|---|---|---|---|
| S1 vellykket | 2 (mod+billede) | +1 | — (beholdes) | **JA** | — |
| S1 fejl i job (inkl. storage/DB efter generering) | 2 | +1 | **JA (−1)** | **JA — omvendt mismatch: betalt kald + refunderet kvote → gratis retry** | UI "TRY AGAIN" + lokal `dressed-character`-cache (visning) |
| S1 reservation fejler efter moderering | 1 (moderation) | 0 eller +1 (uden refund) | nej | **muligvis** (moderation) | UI-fejl |
| S2 vellykket | 2 | 0 → +1 ved succes | — | **JA** | — |
| S2 fejl i job | 2 | 0 (aldrig tælt) | ækvivalent | **JA — gratis retry** | UI "Please try again" |
| S2 allerede AI-ready (cache-træf) | **0** | 0 | — | **0** | `assetResponse` genbruger eksisterende asset |
| S3 upload (preview OK) | 2 | **ingen kvote** | — | **JA — ukvoteret** | ingen |
| S3 upload (preview-fejl) | 2 (mod+kaldet) | 0 | — | **JA** | `previewError`-besked; original beholdes; gentagelse = nyt kald |
| S5 dress-model OK (første gang) | 1 | +1 | — | **JA** | — |
| S5 samme `outfit_key` igen | **0** | 0 | — | **0** | **`outfit_key`-cache** (`dress-model.ts:149-173`) |
| S5 fejl efter generering | 1 | +1 | **NEJ** (taber kvote) | **JA** (men intet loop — bruger blokeret af kvote 1) | delresultat fjernes; fejlbesked |
| S6 FASHN (orphant) | 0 OpenAI-billede + 2 moderation | +1 | NEJ | **muligvis** (moderation) | FASHN-fejltekst |
| S7 DEV-diagnostik | 1 | 0 (bevidst) | — | kun i udvikling | resultat kasseres |
| Legacy `closet-items` / UI-cache (`dressed-character`, `dressed-profile-outfit:*`) | **0** | 0 | — | **0** | ren visning |

**Kan et fallback skjule, at DRESSED har betalt?** **JA, to steder:**
(1) S1/S2-fiaskoer viser kun en fejlmeddelelse — brugeren (og ejeren) ser
ikke, at en betalt generering muligvis allerede er udført; (2) S5's
`outfit_key`-cache viser et tidligere resultat **uden** at afsløre, om det
var gratis eller betalt (dog er dette et *besparelses*-cache, ikke et skjul).

---

## 11. OpenAI Billing Boundary

**Målsætning:** det præcise tidspunkt, hvor DRESSED ikke længere må antage,
at requesten er gratis. **Ingen regler opfindes** — kategoriseret:

| Situation | Klassifikation | Begrundelse |
|---|---|---|
| Request **aldrig sendt** (auth, validering, kvote 429, `already_in_progress`) | **CONFIRMED: gratis** | ingen forbindelse oprettes [CODE] |
| **Vellykket `images/edits` med returneret billede** | **LIKELY faktureret** | støttet af ejerens dashboard: 110 billed-requests ≈ $7,04 [TELEMETRY]; den præcise takst for `quality=high`/1024×1536 findes ikke entydigt på den hentede prisside (**UNKNOWN**) |
| **`omni-moderation-latest`-kald** | **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** | prissiden gav ingen moderation-tekst i det hentede udsnit |
| **4xx/5xx-fejl fra `images/edits`** (f.eks. content-policy, rate-limit) | **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** | ingen officiel ordlyd hentet |
| **Timeout (`AbortSignal.timeout`)** — requesten kan være gennemført server-side | **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** | den mest risikable usikkerhed, fordi netop den slår til ved tunge kald |
| **Delvis/synt fejlrespons** (`b64_json` mangler/ulæselig efter 200 OK) | **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** | koden kasserer den (`openai-images.ts:162-168`) — men arbejdet kan være udført |
| **Forbindelsesnedbrud før afsendelse** | **LIKELY gratis** | [ASSUMPTION] standard HTTP-klientadfærd; ikke bevisbar herfra |
| **Klient/bruger abort** (bruger lukker faneblad midt i et job) | **IRRELEVANT for S1/S2** (jobbet kører videre på Netlify uafhængigt af browseren — **faktureret ved job-input**); for S5 kan serveren stadig fuldføre kaldet [CODE] | |
| **Netlify background-function timeout (15 min) efter `editImage`** | **LIKELY faktureret** + mulig **manglende finalize** ⇒ character-kvote forbliver talt (bruger-tab), clothing-kvote forbliver ulåst efter 5 min | `process-clothing-background.mts` (15 min), `0015:51-56` |

**Den styrende regel for resten af rapporten:**
> *Fra det øjeblik `fetch(...)` til `api.openai.com` er afsendt (moderation
> eller `images/edits`), regnes requesten som **muligvis betalt** — indtil det
> modsatte er bevidst over for OpenAI.*

---

## 12. Idempotency / Duplicate Generation

| Sti | Eksisterende beskyttelse | Mellemrum | Økonomisk risiko |
|---|---|---|---|
| **S1 character** | `in_progress`-lås + `used_count+1` ved reservation + limit 1 | låsen kan frigives uden token (`finish_ai_generation`); HTTP-duplikat af POST'en giver andet reserve-forsøg (afvist pga. +1) | **lav** (limit 1 binder) |
| **S2 clothing** | `in_progress`-lås (kun) + **resultat-cache** (asset i ret version ⇒ 0 AI-kald, `process-clothing.ts:354-370`) | **ingen idempotens-nøgle for selve requesten**; token + client-finish tillader kæder af reserves (§7); ingen `request_id`/`generation_id` | **HØJ — bevidst omgåelig, se §7** |
| **S3 clean preview** | **kun `preview_path`-cache pr. item** | intet pr. fil (ingen hash), intet pr. konto, intet pr. tidsrum | **HØJ — ingen dublet-beskyttelse pr. billede** |
| **S5 dress-model** | **`outfit_key`-cache** (`eq(user_id, character_id, outfit_key)`, `dress-model.ts:149-157`) + limit 1 | to **parallele** POST'er med samme nøgle kan begge passere cache-slaget **før** insert (ingen unik DB-constraint på `outfit_key`) | **lav** (limit 1 + sjælden endpoint) |
| **DB-unikke constraint** | `ai_generation_usage (user_id, generation_type)` findes; **ingen** `wardrobe_results.outfit_key`-unikhed | race mellem to ens resultater | dobbelt-lager, ikke dobbelt-kald |
| **Nøgler der IKKE findes** | idempotens-nøgle i request, `generation_id`, unik `request_id`, klient-lås ud over knappen, server-lås ud over `in_progress` | — | — |

**Svar på opgaven:** *kan samme bruger, samme item og samme request give to
OpenAI-kald?* — **JA** i tre tilfælde: (a) to parallele `process-clothing`-kalde
før nogen lås (og frit efter manuel lås-rydning), (b) to `dress-model`-kalde
før insert, (c) to uploads af **samme fil** med forskellige item-ids (S3).
Økonomisk: **+0,43 DKK pr. duplikat**; den eneste systematiske variant er
fuldt ud ubegrænset (S3).

---

## 13. Failure Cost Matrix

| Failure | OpenAI kaldet? | Bruger-kvoteret? | DRESSED potentielt opkrævet? | Kvote refunderet? | Risiko |
|---|---|---|---|---|---|
| Kvote afvist (429 `limit_reached`) | moderation **muligvis** (kommer før reservation på S1/S2), billed-kald **nej** | nej (afvist) | **muligvis** (moderation) | — | LAV (kun hvis moderation faktureres — **UNKNOWN**) |
| Auth afvist (401) | **nej** | nej | **nej** | — | INGEN |
| Moderation afvist **før** billedkald | kun moderation | S1/S2: nej (reservation kommer bagefter) | **muligvis** (moderation) | — | LAV |
| OpenAI API-fejl (`editImage` 4xx/5xx) | **ja (forsøgt)** | S1: ja → **refunderes** · S2: aldrig talt · S5: ja → **ikke refunderet** | **UNKNOWN — REQUIRES EXTERNAL VERIFICATION** | S1/S2: ja | MELLEM (retry-loop hvis faktureret) |
| OpenAI timeout (45 s) | **ja (sendt)** | samme som ovenfor | **UNKNOWN** (kan være gennemført) | samme | **MELLEM–HØJ** |
| Ugyldigt billede (signatur/mål/base64) | **ja, vellykket** | S1: **refunderet trods betalt kald** · S2: aldrig talt | **JA (sandsynligt)** | S1/S2: ja | **HØJ — refund mod betaling** |
| Storage-fejl efter generering | **ja, vellykket** | S1: **refunderet** · S2: aldrig talt | **JA** | S1/S2: ja | **★ HIGH ECONOMIC RISK (§5D) ★** |
| DB-fejl efter generering (insert/publish) | **ja, vellykket** | S1: refunderet · S2: aldrig talt · S5: forbrugt | **JA** | S1/S2: ja | **HØJ** |
| Klient-abort (luk faneblad) | S1/S2: jobbet **kører videre** · S5: kald kan fuldføres | afsluttes af jobbet | **JA** ved fuldførelse | jobbestemt | MELLEM (bruger ser intet resultat) |
| Dobbeltklik | **nej** (knapper beskyttet, §8) | — | — | — | INGEN/LAV |
| Retry (brugerstyret efter fejl) | **ja, nyt kald** | S1/S2: gratis (refunderet/aldrig talt) | **JA — hver gang** | ja | **HØJ ved systematisk fejl** |
| Clean-preview fejl | **ja** | **ingen kvote findes** | **JA** | ikke relevant | **HØJ + ubegrænset gentagelse** |
| Kvote-opbrugt + gentagne klik (S1/S2) | billed-kald nej, **moderation ja** | afvist | **muligvis** | — | LAV–MELLEM |

---

## 14. Economic Worst Case — pr. Starter-bruger (faktisk kode)

Prisgrundlag: **0,43 DKK pr. billed-request** ($0,064 ved 6,70 DKK/USD
[TELEMETRY+ASSUMPTION]). Moderering tælles **særskilt** (pris: **UNKNOWN**).

### A. Tiltænkt brug (pakken: 1 model + 3 beklædning)

```text
4 × billed-generering = 4 OpenAI billed-kald = 1,71 DKK
4 × moderering        = 4 OpenAI-kald        = pris UNKNOWN (formodentlig minimal)
MINIMUM for pakken:                           1,71 DKK + moderation
```

### B. Fuld normal feature-brug (sådan systemet ER kodet i dag)

```text
A: 4 billed-kald
+ 1 try-on (S5 — kvote 1, kaldbar direkte trods ingen UI)  = +0,43
+ N clean-previews (S3) — én pr. upload, INGEN GRÆNSE       = N × 0,43
+ moderering: 4 (pakke) + N (uploads) + evt. kilde-foto
ANTAL BILLEDKALD = 5 + N        (N = antal uploads)
Ved blot N = 10 uploads:         15 billed-kald ≈ 6,43 DKK
```

### C. Upload-forbrug (rent S3)

```text
Pr. upload = 1 billed-kald + 1 moderering = 0,43 DKK + moderation
Antal uploads pr. konto: INGEN GRÆNSE I KODEN
Teoretisk maks. for én bruger via uploads alene: UBEGRÆNSET
```

### D. Misbrug / utilsigtet overdreven brug

| Vektor | Begrænses af koden? | Teoretisk maks. billed-kald |
|---|---|---|
| Clean-previews (S3) | **NEJ** | **UBEGRÆNSET** |
| Refund-loop efter fejl (S1: −1 ved fiasko; S2: aldrig talt) | **NEJ** (ingen forsøgsgrænse) | **UBEGRÆNSET** ved systematisk fejl |
| Manuel lås-rydning af clothing (token i 202-svaret + client-RPC) | **NEJ** | **UBEGRÆNSET** (ondsindet bruger) |
| Moderation ved opbrugt kvote (S1/S2) | **NEJ** | **UBEGRÆNSET** (pris UNKNOWN) |
| Nye konti (kvote er pr. `user_id`) | kun via 31-dages-cooldown **hvis** den indføres | pr. konto: 5 + N |
| Stale-lås-overlap (>5 min) | delvist (5-min regel) | +1 pr. tilfælde |
| S5 dress-model (orphant) | kvote 1 + `outfit_key`-cache | 1 (+ overgrebsforsøg før reserve) |
| Ejerkonto (`is_owner`) | **bevidst ubegrænset** | ubegrænset (kun ejeren selv) |

**KONKLUSION:** det **tilsigtede** maksimum er **5 billed-kald**; det
**kode-tro** maksimum for én normal bruger er **5 + N**; det **absolute**
maksimum set fra koden er **UBEGRÆNSET**. *Kvotelofterne begrænser
**RESULTATER**, ikke **OMKOSTNINGER**.*

---

## 15. Required Distinction — USER QUOTA vs. AI COST

```text
┌──────────────────────────────────────────────────────────────────────┐
│ USER QUOTA (resultater brugeren må forbruge)                         │
│   character: 1   clothing: 3 (kun vellykkede)   tryon: 1              │
│   tælles: S1 ved reservation (refunderes ved fiasko)                 │
│           S2 ved succes (aldrig ved fiasko)                           │
│           S5 ved reservation (aldrig refunderet)                      │
│   ⚠ findes IKKE for: clean-preview (S3), kilde-foto-moderering (S4), │
│     fejlede-forsøg (refunderes), og ejerkonto                        │
├──────────────────────────────────────────────────────────────────────┤
│ AI COST (hvad DRESSED kan ende med at betale)                         │
│   = alle sendte OpenAI-requests:                                      │
│       billed-genereringer (vellykkede + fejlede + kasserede)          │
│     + modereringer (før reservation, ved opbrugt kvote, ved uploads)  │
│     + dubletter (ingen idempotens)                                    │
│   ⚠ TÆLLES AF INGEN — der findes ingen DKK-tæller i systemet.        │
└──────────────────────────────────────────────────────────────────────┘

Eksempler der viser kløften:
  Bruger med 0/3 clothing klikker "MAKE AI READY" 3 gange
    → 3 × moderering (muligvis betalt) + 0 billed-kald
  Bruger uploader 100 t-shirts
    → 100 billed-kald (previews) + 100 modereringer — 0 forbrugt kvote
  Bruger med 1/1 character oplever 5 storage-fejl
    → 5 billed-kald (muligvis betalt), refunderet hver gang = 0/1 brugt
```

**Dette er rapportens centrale pointe:** *en "grøn" kvote-visning
(`CHARACTER: 0 / 1 used`) siger intet om, hvor mange penge DRESSED har brugt.*

---

## 16. Recommended Protections (IKKE implementeret — anbefalinger)

| # | Anbefaling | Løser hvilket problem | Påvirker UX? | Forhindrer faktiske OpenAI-omkostninger? | Kun bruger-kvote? | Prioritet |
|---|---|---|---|---|---|---|
| **P1** | **Hardt loft over AI-kald pr. konto (inkl. clean-preview)** — én samlet tæller for *alle* `editImage`-kalde, tjekket før afsendelse | S3 ubegrænset + moderation-udsendelser | minimalt (meddelelse ved loft) | **JA — det eneste, der lukker den ubundne vej** | nej | **KRITISK — før betaling** |
| **P2** | **Forsøgsloft pr. generationstype** (f.eks. maks 3 forsøg totalt, uanset refundering) | refund-loop §5D/B | acceptabel ("du har brugt dine forsøg") | **JA** — standser de betalte retry-loops | nej (tæller forsøg, ikke resultater) | **KRITISK — før betaling** |
| **P3** | **Luk klientens lås-adgang**: fjern `grant execute` på `finish_clothing_ai_generation`/`finish_ai_generation` for `authenticated` (kun service-rolle) **og** stop med at returnere `reservationStartedAt` i 202-svaret | §7 manuel lås-rydning = ubegrænset clothing | **ingen** (brugeren bruger aldrig RPC'erne direkte) | **JA** (lukker ondsindet omgåelse) | nej | **KRITISK — før betaling** |
| **P4** | **Flyt modereringen efter reservationen** (eller gør reservation til et lille selvstændigt kald først) | OpenAI-kald efter opbrugt kvote (Q1/Q4) | ingen | **JA** (hvis moderering faktureres — verify først) | nej | **HØJ** |
| **P5** | **Cache/hash for uploadede originaler** (samme fil ⇒ ingen nyt preview) + evt. preview-kvote pr. konto | S3 dubletter, hyppige uploads | ingen mærkbar | **JA** | nej | **HØJ** |
| **P6** | **Idempotens-nøgle pr. generation** (klientgenereret `generation_id`, unik i DB) | parallele dubletter (§12) | ingen | **JA** | nej | **HØJ** |
| **P7** | **Kvotereservation FØR enhver OpenAI-kald, også previews** (én fælles `reserve_ai_call`-RPC med `used_count+1` pr. kald) | den grundlæggende asymmetri mellem kvote og omkostning | skal afbalanceres (previews bør tælle eller have egen kvote) | **JA** — gør AI-COST = QUOTA | nej — **gør dem ens** | **HØJ (arkitektonisk kerne)** |
| **P8** | **Undlad refund, når OpenAI allerede er kaldt** — eller omvendt: refundér kun ved fejl *før* afsendelse (state machine: `reserved → ai_sent → stored → committed`) | mismatch i Scenario C/D | brugeren mister en kvone ved tekniske fejl (alternativt: kompensation via P2) | **dæmper** loopet, men er brugerustraffelig | delvis | **MELLEM** (produktvalg) |
| **P9** | **Blokér/skjul orphante endpoints** (`dress-model`, `try-on`) eller sæt dem bag feature-flag | kaldbare, inkonsistente stier | ingen (ingen UI har dem) | **JA** (lukker S5/S6-vejen) | nej | **MELLEM** |
| **P10** | **Telemetri: log hvert OpenAI-kald med estimeret pris** (request_id, type, user, ok/fail, tid) i en `ai_cost_log`-tabel | intet DKK-syn i systemet (§15) | ingen | **nej alene** — men muliggør P11/P12 | nej | **KRITISK (grundlag for alt andet)** |
| **P11** | **Per-konto dagligt spend-loft** (estimerede DKK, ikke antal) | akkumuleret misbrug over dage | lille | **JA** | nej | **HØJ** |
| **P12** | **Global daglig circuit breaker** (se §17) | ejerens værste tabsscenarie | midlertidig "maintenance"-besked | **JA — stopper alt** | nej | **HØJ** |
| **P13** | **Overvåg OpenAI-balance** (dashboard/alarm uden for appen — ingen kodeændring) | ubemærket tømning (ejeren tabte allerede $7,04 af $15 én måned [TELEMETRY]) | ingen | forebyggende | nej | **HØJ** |
| **P14** | **Upload-loft pr. konto** (f.eks. 30–50 dele) | ubundne previews + lager | mærkbar, men rimelig | **JA** (begrænser N i §14B) | nej | **MELLEM** |

---

## 17. Cost Circuit Breaker (analyse — ikke implementeret)

**Er det teknisk muligt med den nuværende arkitektur? JA — og det er nemt,
fordi alt allerede går gennem få snævre passager:**

```text
Kandidat-målepunkter (findes allerede):
  ① de 5 steder der kalder editImage/moderateImage (kun openai-images.ts!)
  ② reserve_*-RPC'erne (én pr. type)
  ③ ai_generation_usage (findes: tællere pr. bruger/type)
  ④ en ny ai_cost_log (findes ikke — P10)
Anbefalet placering af afbryderen:
  inde i openai-images.ts requestOpenAI() — ALLE OpenAI-kald passerer her
  → globalt dagligt loft (tæller + estimeret DKK) → 503 "AI is temporarily
     paused. Please try again later." til alle brugere
  → ekstra per-konto-loft i reserve-funktionerne (P11)
```

**Funktion:** *hvis estimeret AI-forbrug i dag > grænse → stop nye
ikke-kritiske genereringer → vis vedligeholdelses-besked.* Tillad evt.
`is_owner`-konti for fejlsøgning.

**Designovervejelser (ikke beslutninger):**
1. **Grænse-valg:** meteret skal tælle **DKK-estimater**, ikke antal — ellers
   mislykkes den ved prisændringer (jf. pricing-analysens +50/+100 %).
2. **Genoptagelse:** automatisk ved midnat-UTC eller manuelt — **[DECISION]**.
3. **Bryderen skal sidde FØR moderationen også** (ellers fortsætter
   moderation-kald gennem afbrudt tilstand) — igen: flyt moderering (P4).
4. **Brugeroplevelse:** en global afbryder rammer **alle** brugere samtidig
   (økonomisk sikkerhed > midlertidig tilgængelighed) — acceptabel for et
   lille system; logges tydeligt.
5. **Manglende telemetri i dag:** uden P10 skal afbryderen groft regne
   (antal kald × sidst kendte enhedspris) — **markant mindre præcist**.

---

## 18. Final Risk Rating

**Betydning:** **GREEN** = omkostningen er ordentligt bundet ·
**YELLOW** = overvejende bundet, men bestemte stier kan skabe uventet omkostning ·
**RED** = én eller flere stier kan skabe ubundet/ubehersket OpenAI-omkostning.

| Område | Rating | Kort bevis |
|---|---|---|
| **Personlig AI-model (S1)** | **YELLOW** | Kvoten bundet (limit 1), men refund ved fiasko + bruger-genskabelse = betalt retry-loop ved systematisk fejl (§5D); moderation før reservation |
| **Beklædnings-generation (S2)** | **RED** | Tælles kun ved succes ⇒ fejlede forsøg er gratis for brugeren (loop), **og** manuel lås-rydning via token i 202-svaret + client-RPC gør den bevidst omgåelig (§7) |
| **Try-on (S5 dress-model)** | **GREEN** (økonomisk) | Limit 1 + `outfit_key`-cache + fiasko konsumerer kvoten (ingen refund-loop); men **orphant + ingen moderering** → sikkerhedsnotat |
| **Clean preview (S3)** | **RED** | **Ingen kvote, ingen tæller, ingen loft — omkostningen er UBEGRÆNSET set fra koden** (§9) |
| **Dobbeltklik (frontend)** | **GREEN** | Alle knapper deaktiveres/forsvinder før `fetch`; ingen auto-retry (§8) |
| **Fejlede generationer** | **YELLOW→RED** | Refunderet kvote mod muligvis betalt kald + ubegrænset antal forsøg = vedvarende risiko (§5B/C/D) |
| **Storage-fejl efter generering** | **RED** | **HIGH ECONOMIC RISK** bekræftet i kode for S1/S2 (§5D) |
| **Supabase-kvotesystemet** | **YELLOW** | Atomisk og race-sikkert rent racevejen, men: ingen forsøgsgrænser, klient-farlige finish-RPC'er, tre ulige regnskabsmodeller, ingen DKK-tælling |
| **OVERORDNET DRESSED** | **RED** | Fordi **én** sti (S3) er ubundet og **én** (S2) er bevidst omgåelig — og fordi "kvote ≠ omkostning" er systembredt |

---

## 19. Final Decision Table

| Question | Finding |
|---|---|
| **Can a user cause OpenAI cost after quota is exhausted?** | **JA.** (1) Moderationen kører **før** reservationen på S1/S2 og udløses også med 0 tilbageværende kvoter (`personal-model.ts:222` før `:240`); (2) S3 (clean-preview) har **ingen kvote overhovedet** — opbrugt kvote stopper den ikke. Fakturering af moderering: **UNKNOWN — REQUIRES EXTERNAL VERIFICATION**. |
| **Can a failed generation still cost DRESSED money?** | **JA.** Enhver fiasko efter `editImage` (validering, upload, DB) er sket **efter** at OpenAI blev kaldt; om selve fejlkaldet/timeouten faktureres: **UNKNOWN — REQUIRES EXTERNAL VERIFICATION**. |
| **Can a refunded quota still correspond to a paid OpenAI request?** | **JA — bekræftet i kode.** S1 refunderer (`0016:33-35`) i `finally` uanset hvor i jobbet fejlen skete; S2 tælles aldrig ved fiasko (`0011`). Præcis Scenario C/D → **HIGH ECONOMIC RISK** (§5D). |
| **Can one click create multiple OpenAI requests?** | **Ja, 2 OpenAI-HTTP-kald pr. klik** (moderation + billed-generering). **Nej** til flere billed-genereringer pr. klik (`n:1`, ingen intern retry) — og dobbeltklik er blokeret i UI (§8). |
| **Can clean preview create unlimited cost?** | **JA.** 1 billed-kald + 1 moderering pr. upload, **intet loft over antal uploads eller previews** → **omkostningen er UBEGRÆNSET set fra den nuværende kode** (§9). |
| **Does max-attempts protect against actual AI cost?** | **Der findes intet max-attempts-system i repositoryet** (0 træffere). De eksisterende `free_limit`-kvoter beskytter kun mod flere **vellykkede resultater** — **ikke** mod rene omkostninger (moderation, previews, fejlede forsøg). Hvis et system findes live: **UNKNOWN — REQUIRES EXTERNAL VERIFICATION**. |
| **Is DRESSED currently financially safe?** | **NEJ — RED.** Det tilsigtede forbrug (4–5 kald ≈ 1,71–2,14 DKK) er kontrolleret, men tre ukvoterede/omgængelige veje (S3, S2-lås, refund-loop) kan skabe ubegrænset forbrug, og eksisterende telemetri viser $7,04 brugt på én måned uden nogen indbygget grænse. |
| **What is the single biggest economic risk?** | **Clean-preview uden loft (S3)** — den eneste vej, der er både **ubegrænset i koden** og **ubemærket af enhver kvote**, og som **hver almindelig bruger** udløser ved blot at uploade tøj. Næststørst: refund-loppen i S1/S2 (§5D). |
| **What must be fixed before payment launches?** | Se **MUST FIX BEFORE PAYMENT** nedenfor (§20). |

---

## MUST FIX BEFORE PAYMENT

*Kun problemer der skal løses, før DRESSED modtager rigtige penge.*

1. **Luk den ubundne clean-preview-vej (S3)** — sæt et hårdt loft over AI-kald
   pr. konto, der **også tæller preview- og moderationskald** (P1 + P7).
   *Uden dette er ingen pris sikker* (§9, §14D).
2. **Luk den manuelle lås-rydning for clothing (S2)** — fjern `grant execute`
   til `authenticated` på `finish_clothing_ai_generation` (kun service-rolle),
   og **stop med at returnere `reservationStartedAt`** i 202-svaret (P3).
   *Uden dette kan én bruger starte ubegrænsede samtidige jobs* (§7).
3. **Indfør et forsøgsloft** (maks N forsøg pr. type, uanset refundering) så
   **refundering ikke kan gentages i det uendelige** efter betalte fiaskoer
   (P2 — Scenario C/D, §5D).
4. **Tilføj telemetri over faktiske AI-omkostninger** (log pr. OpenAI-kald med
   estimeret pris, ok/fail, type) — uden den kan ingen grænse eller
   circuit breaker verificeres (P10) og **kvote ≠ omkostning** forbliver usynligt (§15).
5. **Global daglig spend-grænse / circuit breaker** i `requestOpenAI()` —
   det sidste sikkerhedsnet (P12, §17).
6. **Afklar OpenAI-faktureringsreglerne** (§20-spørgsmålene) — indtil da:
   regn **alle** sendte requests som betalt.
7. **Beslut moderationens placering:** flyt den **efter** reservationen, så
   opbrugt kvote stopper **alle** OpenAI-kald (P4).

## SHOULD FIX BEFORE LAUNCH

1. Hash/cache af uploaded originaler så dublet-uploads ikke gen-genererer previews (P5).
2. Idempotens-nøgle pr. generation for at eliminere parallele dubletter (P6).
3. Upload-loft pr. konto (P14) — begrænser både preview-omkostning og lager.
4. Luk eller feature-flag de **orphante** AI-endpoints `dress-model` (S5) og
   `try-on` (S6) — især S5, som har kvote, men **ingen moderering** (P9).
5. Gør refunderings-reglen bevidst (produktvalg): refundér kun fejl **før**
   OpenAI-afsendelse, eller acceptér bruger-tab ved tekniske fejl (P8).
6. Verificér om Netlify genforsøger svigtende background functions (§4 Q7).
7. Undersøg den **5-minutters stale-lås** ift. jobs der kører længere (§7).
8. Overvåg OpenAI-balance eksternt (P13) — ejeren tabte $7,04 af $15 på én
   måned uden alarm [TELEMETRY].

## FUTURE OPTIMIZATIONS

1. Pris-pr.-billede-telemetri i DKK med automatisk opdatering af enhedsprisen
   (beregningen må ikke låses til $0,064).
2. Delvis generation/`quality: medium` hvor kvaliteten tillader det (produktvalg).
3. Deduplisering på tværs af konti kun efter juridisk gennemgang (jf.
   pricing-analysens §13 — GDPR-følsomt).
4. Automatisk oprydning af fejlede/dublerede midlertidige filer.
5. Circuit breaker med per-endpoint-klassificering (kritiske vs. ikke-kritiske
   genereringer) og automatiseret genoptagelse.
6. Dashboard-visning af "AI-cost pr. bruger" til ejeren (først efter P10).

## QUESTIONS REQUIRING OPENAI VERIFICATION

1. **Faktureres `images/edits`-requests der fejler (4xx/5xx, content-policy)?**
   *Ingen officiel ordlyd hentet i sessionen → UNKNOWN.*
2. **Faktureres `omni-moderation-latest`?** (Pris ikke fundet på den hentede
   prisside → UNKNOWN. Afgør om Q1/Q4-overtrædelsen overhovedet koster penge.)
3. **Faktureres en request der timeout'er på klientsiden, men fuldføres
   hos OpenAI?** (Den mest risikable usikkerhed — påvirker §5B/D.)
4. **Faktureres et returneret, men af DRESSED kasseret billede (forkert
   signatur/mål)?** (Scenario C — HIGH ECONOMIC RISK forudsætter "ja".)
5. **Hvad er den præcise takst for `gpt-image-2.5-sunburst`, `quality: high`,
   1024×1024 og 1024×1536?** (Dashboard-gennemsnittet $0,064 er midlertidigt
   bedste tal; prissiden gav ikke denne opdeling i det hentede udsnit.)
6. **Faktureres inputbillederne (kildefoto + basisform) som tokens oveni?**
7. **Har OpenAI et forbrugsloft/budget, der kan sættes på API-niveauet
   (fx hard cap på organisationen)?** — ville være et fjerde sikkerhedsnet.

---

## Appendix — Evidens-separering

| Klasse | Indhold i denne rapport |
|---|---|
| **Bevist fra DRESSED-kodesystemet [CODE]** | Alle stier S1–S7, rækkefølgen moderering→reservation→job, alle `editImage`/`moderateImage`-linjer, refunderingsgrene, knap-tilstande, caches, 0 auto-retries, 0 klient-referencer til S5/S6, DEV-gates, token-i-svar, 0 max-attempts-træffere |
| **Bevist fra migrations/konfiguration [SQL]** | `free_limit` 1/3/1, `FOR UPDATE`-atomik, stale-lås 5 min, refund via `finish_ai_generation_server`, tæl-ved-succes for clothing, `finish_ai_generation`-grants til `authenticated`, service-rolle-grænser |
| **OpenAI-dokumentation [OPENAI-DOC]** | Prisside + billed-guide hentet i sessionen; gav **ikke** bevis for fejl-/moderations-fakturering → alle tre er UNKNOWN |
| **Telemetri [TELEMETRY]** | 110 billed-requests, $7,04, $7.96 tilbage, 0 % cache-hitrate |
| **Antagelser [ASSUMPTION]** | 6,70 DKK/USD, $0,064/request som gennemsnit, job normalt <5 min, standard browser-retryadfærd |
| **UKENDT — kræver ekstern verifikation** | OpenAI-faktureringsregler (7 spørgsmål ovenfor), Netlify-genforsøg, om et max-attempts-system findes i det **live** Supabase-miljø |

**Intet er ændret i denne session:** ingen kildefil, migration, konfiguration,
pakke eller git-tilstand — **kun denne rapport** (`git status` uændret ift.
før sessionen, med undtagelse af denne nye fil).












