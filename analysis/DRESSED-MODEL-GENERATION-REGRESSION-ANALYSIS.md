# DRESSED – Model Generation Regression Analysis

> **Type: READ-ONLY ANALYSE.** Intet production-code, SQL, migration, database,
> Supabase, Storage, config eller dependencies er ændret. **Kun denne fil er
> oprettet.**
>
> Klassifikation bruges konsekvent nedenfor:
> **CONFIRMED** = direkte dokumenteret i git/code/SQL ·
> **INFERRED** = sandsynlig slutning ud fra ændringerne ·
> **UNVERIFIED** = kræver live runtime/database/log-evidens som ikke findes her.

---

## 1. Starting hypothesis

**Udgangspunkt (fra opgaven):** model-generationen virkede i
`b9a94ca1ed50a2cc21f4419b7e043259febd83a3` (*"funktions work in male"*), men
fejler nu — set sammen med fejlen

```text
The character reservation was already released or expired.
```

**Hvad analysen fandt om udgangspunktet:**

| Faktum | Klassifikation |
|---|---|
| `b9a94ca` ændrer **præcis én fil**: `src/styles/profile.css` (5+/11−). Ingen kilde-, SQL-, storage- eller config-fil røres. | **CONFIRMED** (`git show --stat b9a94ca`) |
| `b9a94ca` kan derfor **ikke i sig selv** være årsagen til at model-generation virkede — det er en ren CSS-commit der arver hele sin tilstand fra sin parent `70bd54c`. | **CONFIRMED** |
| `b9a94ca` beviser **ikke** runtime-funktionalitet. Commit-message *"funktions work in male"* henviser til køns-specifikt UI/arbejde. | **INFERRED** |
| Den mistænkte fejltekst `The character reservation was already released or expired.` **eksisterede allerede i `b9a94ca`** (den kom ind i `70bd54c`). Hvis præcis denne tekst ses i dag, kan `b9a94ca` **umuligt** være en version hvor den var ukendt. | **CONFIRMED** |

**Revideret mistanke:** Hvis modellen virkede omkring `b9a94ca`, så er den
*felle* grænse mellem virkelig/beskadiget tilstand enten `70bd54c`
(baggrundsjob-omlægningen, lige før `b9a94ca`) eller `16fc958` (den eneste
commit efter `b9a94ca` der rører model-generation).

---

## 2. Commit b9a94ca1 analysis

```text
hash     : b9a94ca1ed50a2cc21f4419b7e043259febd83a3
author   : mipe0018 <mipe0018@stud.ek.dk>
date     : Mon Oct 5 00:51:52 2026 +0200
subject  : funktions work in male
parent   : 70bd54c0a60d48d6410a52837c6a453ee946e92f
child    : 16fc95875cb10717727947fcf77ef61e4341e71b (HEAD, gren clothes)
```

**Ændrede filer (hele committen):** `src/styles/profile.css` | +5 / −11

**Svar på opgavens punktliste for denne commit:**

| Emne | Fund i `b9a94ca` | Klassifikation |
|---|---|---|
| Model-generation | **Ingen ændringer** | CONFIRMED |
| `personal-model` | **Ingen ændringer** | CONFIRMED |
| `character-job` | **Ingen ændringer** | CONFIRMED |
| Generation usage / reservation | **Ingen ændringer** | CONFIRMED |
| Storage | **Ingen ændringer** | CONFIRMED |
| profiles / status | **Ingen ændringer** | CONFIRMED |
| SQL / RPC / migrations | **Ingen ændringer** | CONFIRMED |

**Konklusion for §2:** `b9a94ca` er en *tilstands*-commit, ikke en
*funktions*-commit. Den er brugbar som **tidsligstempel** (den peger tilbage på
`70bd54c` som den sidste commit der ændrede model-generation før `b9a94ca`),
men den kan **ikke** være den commit der "gjorde at det virkede".

---

## 3. Git timeline

Gren `clothes` (8 commits, root → HEAD). Aflæst med
`git log --pretty='%h|%p|%ad|%s' --date=iso`:

```text
0257145  2026-10-04 16:41:49  "first commit"                       [ROOT]
   ↓                        tilføjer migrations 0001,0002,0005,0008,0010,0011,0012
d973d1b  2026-10-04 18:32:29  "working solution with size"
3193b8a  2026-10-04 21:27:53  "funktional dressed duh'"
   ↓                        +migration 0013, generation-flow.ts, personal-model.ts +165
63a399d  2026-10-04 21:55:05  "try on + save outfits working"
   ↓                        +migration 0014
75f63b1  2026-10-04 22:18:37  "alle funktioner virker"             ← sidste "virker"-påstand
   ↓ ── RELEVANT CHANGE #1 (70bd54c): model-generation flyttes fra synkron
   ↓     Astro-route til Netlify-baggrundsfunktion + reservations-token +
   ↓     ny RPC finish_ai_generation_server (migration 0016) +
   ↓     frontend skifter fra 200/modelPhotoPath til 202/polling
70bd54c  2026-10-05 00:26:35  "new commit"
   ↓ ── RELEVANT CHANGE #2 (b9a94ca): INGEN relevant ændring (kun profile.css)
b9a94ca  2026-10-05 00:51:52  "funktions work in male"             ← brugerens hypotese
   ↓ ── RELEVANT CHANGE #3 (16fc958): character-job prompt + læsning af forrige
   ↓     primær-character + sletning af erstattet model-billede +
   ↓     migration 202610050001 (KUN clothing-kvote)
16fc958  2026-10-05 21:43:48  "Clothes editor implementet"         ← HEAD / origin/clothes
   ↓
[UNCOMMITTED working tree] 6 modificerede filer + 2 nye migrations
   202610050002_wardrobe_items_placement.sql
   202610050003_fix_wardrobe_items_placement_check.sql
   ↓
Current broken state
```

**Sidefund (vigtigt for ærligheden):** repoet indeholder også
**checkpoint-refs** (cline/agent-sessioner). Den tidligste ref der indeholder
fejlteksten er `f1e93d64f7c121b7eb1282104838f43f9051cedd`
*"Agent host session … turn 33"*, **2026-10-05 00:01:42** — samme
arbejdssession, 25 min før `70bd54c`. Det bekræfter at teksten hører til
baggrundsjob-arbejdet og ikke til `b9a94ca`. **CONFIRMED** (via
`git log --all -S "already released or expired"`).

**Migrations-tidslinje:**

| Migration | Introduceret i | Commit-besked |
|---|---|---|
| `202610040001 … 0012` (7 stk.) | `0257145` | first commit |
| `202610040013_add_socks_category.sql` | `3193b8a` | funktional dressed duh' |
| `202610040014_fix_save_dressed_outfit_ambiguity.sql` | `63a399d` | try on + save outfits working |
| `202610040015_ai_quota_limits_and_owner_exemption.sql` | `75f63b1` | alle funktioner virker |
| `202610040016_background_ai_generation_finalization.sql` | `70bd54c` | new commit |
| `202610050001_clothing_quota_override_test_user.sql` | `16fc958` | Clothes editor implementet |
| `202610050002 / 0003` (placement) | **IKKE COMMITTED** (kun working tree) | — |

**CONFIRMED** (`git log --stat` + `git ls-tree HEAD supabase/migrations`).

---

## 4. Candidate working versions

| Kandidat | Bevis | Status |
|---|---|---|
| `0257145` … `63a399d` | Commit-beskeder (*"working solution with size"*, *"try on + save outfits working"*) | **UNVERIFIED** — midlertidige funktioner, ikke model-generation specifikt |
| **`75f63b1` "alle funktioner virker"** | Commit-message udsiger explicit at **alle funktioner virker**; er den **sidste commit med synkron model-generation** (`git ls-tree 75f63b1` på `src/lib/server/ai/jobs`, `background.ts`, `netlify` → tom; `git grep readReservationToken 75f63b1` → exit 1) | **INFERRED (stærkest)** + **UNVERIFIED** (runtime) |
| `70bd54c` "new commit" | Omlægger hele model-generation til baggrundsjob. Ingen bevis for at det virkede | **UNVERIFIED** |
| **`b9a94ca` "funktions work in male"** (brugerens hypotese) | Kun CSS. Arver `70bd54c`'s tilstand | **UNVERIFIED** — kan hverken be- eller afkræftes ud fra git |
| `16fc958` "Clothes editor implementet" | Ændrer `character-job.ts` (prompt + forrige-character-læsning + sletning) | **UNVERIFIED** |

> **Klarhedspunkt (krævet af opgaven):** **Git history kan IKKE bevise
> runtime-funktionalitet for nogen af kandidaterne.** Ingen commit indeholder
> en test, et log eller en verifikation af at model-generation kørte
> succesfuldt. Al valg nedenfor er derfor **INFERRED ud fra commit-beskeder og
> kodeændringer**, og markeret **UNVERIFIED** hvor det gælder den faktiske
> kørsel.

---

## 5. Last known/suspected working version

### Bedste kandidat: `75f63b1505e0ca98ebeda5a2507f5bc1afe761e1` — *"alle funktioner virker"*

**Dato:** 2026-10-04 22:18:37 +0200 · **Parent:** `63a399d`

Grunde (**INFERRED**, ikke bevist):

1. Commit-message'en er den eneste i hele historikken der **påstår at alle
   funktioner virker**.
2. Det er den **sidste commit før** model-generation blev flyttet til et
   baggrundsjob — sidste commit hvor hele flowet var ét synkront
   `try`-blok-i-`POST`-endpoint uden reservations-token, uden Netlify-funktion
   og uden `finish_ai_generation_server`.
3. Reservationen blev frigivet med den enkle, token-løse `finish_ai_generation`
   (`personal-model.ts` finally: `if (reservation)`), som **ikke** kan fejle
   med "already released or expired" — teksten findes ganske enkelt ikke i
   træet på `75f63b1` (`git grep "already released or expired" 75f63b1` →
   **exit 1**).
4. `202610040015` (kvote-funktionerne) blev netop tilføjet i denne commit, så
   reserve-funktionerne er her i deres nye form, men **før** token-matchingen
   blev gjort obligatorisk.

### Alternativ kandidat (brugerens): `b9a94ca1ed50a2cc21f4419b7e043259febd83a3`

Kan **ikke** afvises, men kan **heller ikke bekræftes**: den ændrer kun CSS og
indeholder allerede reservations-fejlteksten. Hvis nogen *vidner* om at
modellen virkede præcis dér, er forklaringen at `b9a94ca` ≡ `70bd54c` mht.
model-generation.

**Svar:** Bedste *last known/suspected working* = **`75f63b1`**.
**Klassifikation: INFERRED (tekstligt bevis) / UNVERIFIED (runtime).**

---


## 6. First relevant regression

### Hvis `75f63b1` er arbejdskandidaten → første relevante ændring er `70bd54c`

```text
75f63b1  "alle funktioner virker"          ← last suspected working
    ↓
70bd54c  "new commit"                      ← FIRST RELEVANT CHANGE (regressionskandidat #1)
    ↓   (b9a94ca = kun CSS, ingen relevante ændringer)
16fc958  "Clothes editor implementet"      ← regressionskandidat #2 (begrænset)
    ↓
Current broken state
```

**Hvad `70bd54c` (2026-10-05 00:26:35) ændrede — 18 filer, +822/−340:**

| Fil | Hvad der ændrede sig | Effekt |
|---|---|---|
| `src/pages/api/ai/personal-model.ts` | **Synkron → 202 baggrundsjob.** Hele `editImage → validate → upload → publish`-blokken flyttes UD af route'en. Nyt: `readReservationToken`, `launchBackgroundJob`, `finishGenerationServer` ved launch-fejl. Svar skiftes fra `{status:"completed", modelPhotoPath}` (200) til `{status:"processing"}` (202). Finally ændres `if (reservation)` → **`if (reservation && !jobStarted)`** (`personal-model.ts:289`) | **HIGH** |
| `src/lib/server/ai/jobs/character-job.ts` (**NY**, 145 linjer) | Jobbet der nu udfører AI + upload + publish + **`finishGenerationServer` i `finally`** (`:162-165`) | **HIGH** |
| `src/lib/server/ai/background.ts`, `job-launcher.ts` | Ny transport: `x-job-secret` → `/.netlify/functions/personal-model-background`; i DEV køres jobbet **fire-and-forget in-process** (`job-launcher.ts:19-31`) | **HIGH** |
| `netlify/functions/personal-model-background.mts` | Ny Netlify Background Function (403 ved forkert secret, 500 ved manglende env) | **HIGH** |
| `src/lib/server/ai/generation-usage.ts` (+43) | Ny `finishGenerationServer()` (RPC + token-match, returnerer `boolean`) og `readReservationToken()` | **HIGH** |
| `supabase/migrations/202610040016_background_ai_generation_finalization.sql` | **NY RPC**: `finish_ai_generation_server(uuid,text,timestamptz,boolean)`, `security definer`, guard `auth.role()='service_role'` (`:20-23`), **`and in_progress and started_at = p_reservation_started_at`** (`:40-41`), `released := found` (`:43`) | **HIGH** |
| `src/pages/profile.astro` (+29/−7) | Frontend: **202 → polling** → `SELECT profiles.model_generation_status, model_photo_path` → kræver `status === "completed" && model_photo_path` (`profile.astro:1100-1119`) | **HIGH** |
| `src/lib/client/generation-usage.ts` (+27) | Ny `waitForGenerationToFinish()` (4 s interval, 16 min deadline) | MEDIUM |
| `src/lib/client/generation-flow.ts` (31) | `keepOnReload` fjernes; failed/completed states vises aldrig igen | LOW |
| `src/lib/server/ai/openai-images.ts` (16) | `openAiApiKey` erstattes af `setOpenAiApiKey()`-injektion; `editImage` får `timeoutMs` (default **45 s** bevares) | MEDIUM |
| `src/lib/server/ai/config.ts` (4), `supabase.ts` (2) | Astro-side side-effekt der registrerer OpenAI-nøglen | MEDIUM |
| `.env.example` (+1) | Ny `BACKGROUND_JOB_SECRET` | MEDIUM (mangler i deploy → 502) |

---


### Hvis `b9a94ca` er arbejdskandidaten → første relevante ændring er `16fc958`

`16fc958` (2026-10-05 21:43:48) er den **eneste** commit efter `b9a94ca` der
rører model-generation, og den rører kun `src/lib/server/ai/jobs/character-job.ts`:

1. **Prompten skrives kraftigt om** (`character-job.ts:26-45`) — nye
   "MASTER GEOMETRY IS A HARD CONSTRAINT", "CONFLICT RULE", "TRANSPLANT RULE".
2. **Ny for-handling:** læsning af nuværende primære characters `model_path`
   via `userClient` *før* publish (`character-job.ts:129-141`). Fejl her
   **kun logges**, kastes ikke → kan ikke i sig selv fejle jobbet.
3. **Ny efter-handling:** sletning af det *erstattede* model-billede fra
   `model-images` efter succes (`character-job.ts:168-182`), non-fatal.
4. Migration `202610050001` (kun clothing-kvote, se §11).
5. Øvrige ændringer (`process-clothing.ts` DEV-header, `source-photo.ts`
   sletning af forrige kildefoto, `profile-outfits.ts` anchor-hjælper,
   `wardrobe.astro`, CSS) påvirker **ikke** model-generation.

**Risikovurdering af `16fc958` for selve generationen: LOW.** Ingen af de
fire punkter kan påvist blokere `publish` eller `model_generation_status`.
Den reelle risiko er **INFERRED**: prompt-ændringen kan ændre
*outputkvaliteten*, og sletningen af det gamle billede kan efterlade en
`dressed_characters`-række der peger på en fjernet fil (se §9).

**Svar:** Første relevante ændring efter bedste kandidat = **`70bd54c`
("new commit")**. Klassifikation: **INFERRED** (ud fra omfang) /
**UNVERIFIED** (bevis for at det er *den* der brød det).

---

## 7. Character reservation

### 7.1 Hvornår og hvor blev teksten introduceret?

| Emne | Fund |
|---|---|
| Tekst | `The character reservation was already released or expired.` |
| Forekomster i HEAD | `src/lib/server/ai/jobs/character-job.ts:**165**` og bygget output `.netlify/functions-serve/personal-model-background/…/personal-model-background.mjs:**322**` |
| Commit der introducerede den på gren `clothes` | **`70bd54c0a60d48d6410a52837c6a453ee946e92f`** — *"new commit"* (2026-10-05 00:26:35), dengang `character-job.ts:143` |
| Tidligste ref overhovedet | `f1e93d64f7c121b7eb1282104838f43f9051cedd` — *"Agent host session … turn 33"* (2026-10-05 00:01:42), checkpoint-ref i samme session |
| Findes den i `75f63b1`? | **NEJ** (`git grep` → exit 1) |
| Findes den i `b9a94ca`? | **JA** (arvet fra `70bd54c`) |
| Metode | `git log --all -S "already released or expired"` |

**Klassifikation: CONFIRMED.**

### 7.2 Hvordan opstår beskeden?

`character-job.ts:161-166` (alle job-kørsler, **både succes og fejl**):

```ts
} finally {
  const released = await finishGenerationServer(
    serviceClient, userId, "character", reservationStartedAt, succeeded
  );
  if (!released) console.error("The character reservation was already released or expired.");
}
```

`generation-usage.ts:141-159` returnerer `false` når:

* RPC'et kastede fejl (`error`) — fx `42501` fra `auth.role()`-guarden i
  `0016:20-23`, eller funktionen ikke findes/ikke er grant'et; **eller**
* `data !== true`, dvs. `UPDATE … WHERE … and in_progress and
  started_at = p_reservation_started_at` (`0016:38-41`) **matchede 0 rækker**
  (`released := found`, `0016:43`).

**Vigtigt (CONFIRMED):** beskeden er en `console.error` i `finally`. Den kan
logges **selv når generationen lykkedes**. Den er i sig selv **ikke** et bevis
på at model-generation fejlede — den beviser kun at *denne* jobs reservation
ikke længere kunne finaliseres med det givne token.

---

### 7.3 Ændringer i reservationssystemet efter `75f63b1`

| Emne | Ændret? | Detalje | Klassifikation |
|---|---|---|---|
| Lifetime / expiry (`5 min` stale-vindue) | **NEJ** | `now() - interval '5 minutes'` findes i `0001:313`, bevares ordret i `0015:42` og `202610050001:89`. **Ingen migration efter `75f63b1` rører den.** | CONFIRMED |
| Release-logik (hvem der må frigive) | **JA** | Før: `finish_ai_generation(type)` (bruger-rolle, tokenløs, `0001:343-358`). Nu også: `finish_ai_generation_server(...)` (**kun service-role, token-match**, `0016`) — tilføjet i `70bd54c` | CONFIRMED |
| Hvordan token bruges | **JA** | `70bd54c` tilføjer `readReservationToken()` (`personal-model.ts:249`) og fører `reservationStartedAt` med i job-payloaden | CONFIRMED |
| `personal-model` finally-betingelse | **JA** | `75f63b1`: `if (reservation) await finishGeneration(...)`. `70bd54c`→HEAD: `if (reservation && !jobStarted)` (`personal-model.ts:289`) — ellers ville route'en **udslette jobbets reservation** umiddelbart efter 202 | CONFIRMED |
| `personal-model`/`character-job` ændrer måden reservationen bruges på | **JA** | Reservationen går fra at være en *lås der bare nulstilles* til at være en *token-identificeret transaktion der skal matche præcist* | CONFIRMED |

### 7.4 Konkrete scenarier der giver præcis denne besked

| # | Scenarie | Klassifikation |
|---|---|---|
| R-a | **Ny reserve midt i en kørende job.** `reserve_ai_generation` nulstiller `in_progress/started_at` når den nuværende reservation er >5 min gammel (`0015:47-52`) og tildeler et **nyt** `started_at`. Det gamle job finaliserer så med et token der ikke længere findes → `released=false`. Et baggrundsjob med 8 min AI-timeout (`character-job.ts:10`) og 16 min frontend-timeout kan *lovligt* løbe længere end 5 minutters-vinduet | **INFERRED** (mekanismen er CONFIRMED, om det sker live er UNVERIFIED) |
| R-b | **`finish_ai_generation_server` fejler** (manglende grant/`42501`/forkert service-nøgle/migration 0016 ikke kørt) → `error`-grenen → `false` | **UNVERIFIED** (live-inspektion hævder dog at RPC'en *findes*, se §12) |
| R-c | **Reservationen var allerede frigivet** af en anden kilde. Gennemgået: `finishGeneration('character')` kaldes kun fra `personal-model.ts:289` og kun når `!jobStarted`; `try-on.ts:297` og `dress-model.ts:377` bruger `'tryon'` og rammer en anden række | **CONFIRMED** (at der ikke findes anden kilde i kode) |
| R-d | To samtidige requests: den anden får 409 (`already_in_progress`) og kaster `GenerationLimitError` → sætter **ikke** `failed` og udløser **ikke** finish (`personal-model.ts:279`, `:289`) | **CONFIRMED** (afviser denne som kilde) |

**Konklusion §7:** Reservationssystemet **ER** blevet ændret efter den
mistænkte arbejdsversion (`70bd54c`), men **expiry-tiden er ikke ændret**.
Fejlen er **ikke bevist at være årsagen** — den er lige så sandsynligt en
*følge* (token der ikke matcher længere, eller en RPC-fejl). Se §15-H.

---

## 8. AI generation

Sammenligning `75f63b1` ↔ `b9a94ca` ↔ HEAD (`git grep` på begge commits):

| Dimension | `75f63b1` | HEAD `16fc958` | Ændret? |
|---|---|---|---|
| Model | `gpt-image-2.5-sunburst` (`openai-images.ts:7`) | samme (`:14`) | **NEJ** — CONFIRMED |
| Endpoint | `https://api.openai.com/v1/images/edits` | samme | NEJ |
| Input-billeder | kilde-foto + kanonisk base form (2 billeder) | samme | NEJ |
| `size` | `"1024x1536"` (`personal-model.ts:136`) | `"1024x1536"` (`character-job.ts:101`) | NEJ |
| `background` | `"opaque"` default | samme | NEJ |
| `output_format` | `"png"` | samme | NEJ |
| Output-håndtering | PNG-signatur + `IHDR` + 1024×1536 + `PNG.sync.read` | samme (`character-job.ts:106-117`) — *flyttet* fra route til job | **Placering** ændret i `70bd54c` — CONFIRMED |
| **Prompt** | `personal-model.ts:36-52` (kort) | **`character-job.ts:20-45` (kraftigt omskrevet)** | **JA** — kun i `16fc958` — CONFIRMED |
| **Timeout** | hardcodet **45 s** (`openai-images.ts:143`) | `timeoutMs ?? 45_000`; character-job bruger **8 min** (`character-job.ts:10`, `:103`) | **JA** — `70bd54c`; gjorde grænsen *largere* — CONFIRMED |
| Nøgle-injektion | `openAiApiKey` importeres direkte | `setOpenAiApiKey()` + side-effekt i `config.ts` / `supabase.ts` | **JA** — `70bd54c` — CONFIRMED; hvis side-effekten ikke løber i den bundlede Netlify-funktion → `OpenAIImageError 503` |

**Bedømmelse:** Selve AI-kaldet (model, inputs, størrelse, baggrund, output)
er **ikke ændret**. Det der *er* ændret er **(a)** placering (route → job),
**(b)** timeout, **(c)** prompt (`16fc958`) og **(d)** nøgle-injektionen
(`70bd54c`).
**Risiko: MEDIUM for `70bd54c` (nøgle/transport), LOW–MEDIUM for `16fc958`
(prompt).** Klassifikation: **CONFIRMED** (ændringerne), **UNVERIFIED** (om de
fejler live).

---

## 9. Storage

| Dimension | Tilstand | Klassifikation |
|---|---|---|
| Bucket | `model-images` — uændret (`character-job.ts:120-121`) | CONFIRMED |
| Path-mønster | `${userId}/personal-model-${uuid}.${ext}` — uændret (`character-job.ts:119`) | CONFIRMED |
| Upload-klient | **Bruger-klienten** (`userClient`, dvs. JWT som `authenticated`) — samme før og efter `70bd54c` | CONFIRMED |
| Ownership-tjek i SQL | `publish_dressed_character` kræver `storage.objects`-række med `bucket_id='model-images' AND name=p_model_path AND owner_id::text = auth.uid()` (`0012:207-215`, identisk med `0001:86-93`). **Ingen migration efter `75f63b1` ændrer den.** | CONFIRMED |
| Storage-policies i repo | **Findes ikke.** Eneste policy er SELECT for de to base-form-filer (`0010:91-101`). Upload-policies for `model-images`/`profile-images` er aldrig kommet i version control | CONFIRMED (at de mangler) / UNVERIFIED (live) |
| Signed/public URLs | Ikke en del af denne flow-kæde (status læses fra `profiles`, ikke fra URL) | CONFIRMED |
| **Nyt: sletning af erstattet model-billede** | `16fc958` tilføjer `serviceClient.storage.from("model-images").remove([replacedModelPath])` (`character-job.ts:171-182`) | **CONFIRMED — NY OPFØRSEL** |
| **Nyt: sletning af erstattet kildefoto** | `16fc958` tilføjer fjernelse af forrige `source_photo_path` (`source-photo.ts:102-117`) | CONFIRMED — NY OPFØRSEL |
| Publish-flow | `userClient.rpc("publish_dressed_character", …)` uændret siden `0012` (`character-job.ts:143-146`) | CONFIRMED |

**Risiko (INFERRED, MEDIUM):** sletningen i `16fc958` fjerner filen for den
**gamle** character, men `dressed_characters`-rækken for den gamle character
består stadig (`is_primary=false`). Hvis frontend kan skifte tilbage til den
character (`set_primary_dressed_character`) eller vise den, vises en død
reference. Dette forklarer **ikke** reservations-fejlen, men er den eneste
reelt nye storage-risiko efter `b9a94ca`.

**Svar:** Storage-delen er **ændret** efter `b9a94ca` (sletninger), men **ikke**
hvad angår bucket, path, upload-metode, ownership-tjek eller publish-flow.
Klassifikation: **CONFIRMED**.

---

## 10. Profiles/status

| Dimension | `75f63b1` (synkron) | `b9a94ca` / HEAD (baggrund) |
|---|---|---|
| Svar fra API | **200** `{status:"completed", modelPhotoPath, characterId, …}` | **202** `{status:"processing"}` (`personal-model.ts:273-276`) |
| Frontend-venten | ingen — resultatet kom i samme svar | `waitForGenerationToFinish(accessToken,"character")` (`profile.astro:1103`), 4 s interval, **16 min timeout** (`generation-usage.ts:47-48`) |
| Frontend-læsning | ingen læsning | `SELECT model_generation_status, model_photo_path, gender FROM profiles` (`profile.astro:1104-1112`) |
| Success-betingelse | `response.ok && modelPhotoPath` | **`outcome.model_generation_status === "completed" && outcome.model_photo_path`** (`profile.astro:1113`) |
| Failed-state | `result.error` fra serveren | begge dele: server-fejl **ELLER** status ≠ completed **ELLER** `model_photo_path` null (`:1113-1119`) |
| Timeout-tekst | — | `MODEL GENERATION FAILED. PLEASE CHECK YOUR CONNECTION…` (`:1169-1171`) |
| Status-skrivning | route: `pending → processing → (publish sætter 'completed')` / `failed` | **uændret rækkefølge**, men nu spredt over route (`personal-model.ts:241,244,280`, user-klient) og job (`character-job.ts:55-61`, service-klient) |

### Svar på opgavens spørgsmål

> *"Find den første ændring der kan få frontend til at rapportere fejl, selv
> hvis AI-generationen lykkes."*

**Svaret er `70bd54c` (`src/pages/profile.astro:1100-1119` + `:1103`).**

Før denne commit kunne frontend **kun** fejle på svaret fra samme
HTTP-request. Efter den kan frontend fejle på tre nye ting, uafhængigt af om
AI lykkedes:

1. at `waitForGenerationToFinish` aldrig ser `in_progress=false` (16 min →
   timeout);
2. at `SELECT … FROM profiles` returnerer `null` eller en række med
   `model_generation_status ≠ 'completed'` — fx hvis **RLS filtrerer rækken
   fra**, eller status aldrig blev skrevet;
3. at `model_photo_path` er `null`.

**Klassifikation:** Punkterne 1–3 er **CONFIRMED** som *mekanismer* i koden;
at de *faktisk* slår ud live er **UNVERIFIED** (kræver Netlify-log +
DB-læsning). Bemærk mods-beviset: `loadProfile` ved sideindlæsning
(`profile.astro:616-622`) bruger samme SELECT — virker den, virker nr. 2
sandsynligvis også.

---

## 11. SQL migrations

### 11.1 Alle migrations, klassificeret

| Migration | I `75f63b1`? | I `b9a94ca`? | I HEAD? | Introduceret efter arbejdskandidat? |
|---|---|---|---|---|
| `202610040001_dressed_ai_wardrobe.sql` | ja | ja | ja | nej |
| `202610040002_character_bound_clothing_assets.sql` | ja | ja | ja | nej |
| `202610040005_clothing_previews_and_asset_versions.sql` | ja | ja | ja | nej |
| `202610040008_clothing_ai_generation_commit.sql` | ja | ja | ja | nej |
| `202610040010_base_type_clothing_assets.sql` | ja | ja | ja | nej |
| `202610040011_secure_clothing_generation_finalization.sql` | ja | ja | ja | nej |
| `202610040012_normalized_character_geometry_and_saved_outfits.sql` | ja | ja | ja | nej |
| `202610040013_add_socks_category.sql` | ja | ja | ja | nej |
| `202610040014_fix_save_dressed_outfit_ambiguity.sql` | ja | ja | ja | nej |
| `202610040015_ai_quota_limits_and_owner_exemption.sql` | **ja (ny i denne)** | ja | ja | **grænse-tilfælde: tilføjet *i* kandidaten** |
| **`202610040016_background_ai_generation_finalization.sql`** | **nej** | ja | ja | **JA — `70bd54c`** |
| **`202610050001_clothing_quota_override_test_user.sql`** | nej | **nej** | ja | **JA — `16fc958`** |
| `202610050002_wardrobe_items_placement.sql` | — | — | **kun working tree (untracked)** | IKKE COMMITTED |
| `202610050003_fix_wardrobe_items_placement_check.sql` | — | — | **kun working tree (untracked)** | IKKE COMMITTED |

### 11.2 Hvad post-kandidat-migrations faktisk rører

| Migration | `profiles` | `dressed_characters` | `ai_generation_usage` | RLS | Storage-policies |
|---|---|---|---|---|---|
| `0016` | **nej** (kun ny funktion; *"No schema, policy or data changes"*, `:4`) | nej | ja — **kun via den nye funktion** | nej | nej |
| `202610050001` | nej | nej | kun `'clothing'`-rækker | ja — men kun for **ny** tabel `ai_generation_limit_overrides` (deny-all, `:22-28`) | nej |
| `202610050002/0003` (untracked) | nej | nej | nej | nej | nej |

**Verificeret med** søgning over alle migrations på mønstrene
`profiles|dressed_characters|model_generation|storage|policy` samt
`alter table public.profiles` / `alter table public.dressed_characters` /
`enable row level security`.

**Resultat (CONFIRMED):** **Ingen migration efter `75f63b1` ændrer
`profiles`, `dressed_characters`, deres constraints, deres triggers eller
deres RLS-policies.** De eneste `alter table public.profiles` i hele repoet er
kolonetilføjelser i `0001:5` og `0001:16`.

### 11.3 Fokus-områder fra opgaven

* **profiles** — `model_generation_status`, `model_photo_path` skrives kun af
  (1) `setGenerationStatus` i route/job (bruger- bzw. service-klient) og
  (2) `publish_dressed_character` (`0012:238-244`). Ingen af de to stier er
  ændret i SQL efter kandidaten. **CONFIRMED.**
* **dressed_characters** — primary-flip + INSERT sker i
  `publish_dressed_character` (`0012:225-236`), uændret siden `0012`.
  Ejerskab via CHECK `dressed_character_path_owned_by_user`
  (`0001:49-50`) — uændret. **CONFIRMED.**
* **AI generation usage** — `0001` (reserve/finish/get), `0015` (reserve
  redefineret), `0016` (ny server-finish), `202610050001` (clothing-reserve
  redefineret). Se §12. **CONFIRMED.**
* **RLS** — se §13. **Storage** — se §9.

---

## 12. RPC functions

| Funktion | Sidst ændret i | Commit | Ændret efter arbejdskandidat? |
|---|---|---|---|
| `publish_dressed_character(text,text)` | `0012:187-250` | `0257145` (first commit) | **NEJ** — CONFIRMED |
| `reserve_ai_generation(text)` | `0015:8-70` | `75f63b1` | **NEJ efter** (grænse-tilfælde: *i* kandidaten) — CONFIRMED |
| `finish_ai_generation(text)` | `0001:343-358` | `0257145` | NEJ — men **ikke revokeret** af `0016` |
| **`finish_ai_generation_server(uuid,text,timestamptz,boolean)`** | **`0016:6-51`** | **`70bd54c`** | **JA — NY** — CONFIRMED |
| `reserve_clothing_ai_generation()` | `202610050001:35-122` | `16fc958` | JA (kun clothing) — CONFIRMED |
| `finish_clothing_ai_generation_server(...)` | `0011` | `0257145` | NEJ |
| `get_ai_generation_usage()` | `0001:360-375` | `0257145` | NEJ |
| `save_dressed_outfit`, `delete_dressed_character`, `set_primary_dressed_character` | `0014` / `0010` / `0001` | før kandidat | NEJ |

**Nøglepunkter:**

* `finish_ai_generation_server` er `security definer` med
  `set search_path = ''` og **guard `coalesce(auth.role(),'') <> 'service_role'`
  → exception `42501`** (`0016:20-23`), grant kun til `service_role`
  (`0016:48-51`). Dens `UPDATE` kræver **både** `in_progress` **og**
  `started_at = p_reservation_started_at` (`0016:38-41`);
  `released := found` (`0016:43`). **CONFIRMED.**
* `0016` **revokerede ikke** den bruger-scoped `finish_ai_generation`
  (`0001:377-382` stadig gældende) — bevidst asymmetri, ikke en regression,
  men to finaliseringsstier eksisterer. **CONFIRMED.**
* Live-inspektion (`analysis/DRESSED-LIVE-DATABASE-INSPECTION.md:59-61`, læst
  via PostgREST med service-nøglen) hævder at **alle 11 RPC'er findes live,
  inkl. `finish_ai_generation_server`** — klassificeret dér som *VERIFIED IN
  DATABASE*. Jeg kan ikke genkørsle den aflæsning her, så den citeres som
  **UNVERIFIED her, men indikerende**.

**Svar (opgavens C og F):** **JA** — en RPC kan nu fejle hvor den tidligere
ikke eksisterede: `finish_ai_generation_server` er helt ny, og dens
`found`-betingelse/guard er årsagen til præcis den sete besked.
**Klassifikation: CONFIRMED (mekanisme) / UNVERIFIED (live-opførsel).**

---

## 13. RLS

| Tabel | RLS i repo | Policy-tekst | Ændret efter arbejdskandidat? |
|---|---|---|---|
| `dressed_characters` | ENABLE (`0001:57`) | **kun SELECT** (`0001:58-62`), `revoke all` + `grant select` (`0001:63-64`) | **NEJ** — CONFIRMED |
| `ai_generation_usage` | ENABLE (`0001:273`) | **kun SELECT egne rækker** (`0001:274-277`) — skrivning kun via SECURITY DEFINER | **NEJ** — CONFIRMED |
| `ai_generation_limits` | ENABLE (`0001:267`) | SELECT `using (true)` | NEJ |
| `ai_generation_limit_overrides` | ENABLE (`202610050001:22`) | **0 policies (bevidst deny-all)** + revoke + `grant select to service_role` | **JA** (ny tabel), men deny-all kan ikke påvirke generationen, da den kun læses indefra en definer-funktion |
| `saved_dressed_outfits` | ENABLE (`0012:36`) | SELECT + DELETE egne | NEJ |
| **`profiles`** | **findes IKKE i repoet** | **ukendt** | **ingen migration rører det** — CONFIRMED (at repoet ikke styrer det) / **UNVERIFIED (live)** |
| `storage.objects` | kun SELECT for base-form-filer (`0010:91-101`) | **upload-policies findes ikke i repoet** | NEJ |

**Service-role bypass:** `character-job.ts` bruger `serviceClient` til
`setStatus(failed)` (`:160`) og `finishGenerationServer` (`:162`) — begge
bypasser RLS. `publish_dressed_character` er `security definer` og bypasser
egne policies, men **læser stadig `storage.objects`** (`0012:209`).
**CONFIRMED.**

**Svar (opgavens B):** **Ingen RLS-ændring efter den mistænkte arbejdsvige
kandidat kan forhindre `UPDATE profiles … model_generation_status='completed'`**
— fordi `publish_dressed_character` er `SECURITY DEFINER` og slet ikke er
RLS-underkast i dette led, og fordi **ingen** migration efter `75f63b1`
ændrer RLS. **Klassifikation: CONFIRMED (negativt fund) for repoet;
UNVERIFIED for den live `profiles`-RLS som ikke er i version control.**

---

## 14. Database constraints

| Constraint / trigger | Fil:linje | Introduceret | Rørt efter arbejdskandidat? |
|---|---|---|---|
| `profiles_gender_check` | `0001:16-21` | `0257145` | **NEJ** — CONFIRMED |
| Trigger `profiles_gender_is_locked` (BEFORE UPDATE OF gender) | `0001:36-39` | `0257145` | **NEJ** — trigges kun på `gender`, ikke på `model_generation_status`/`model_photo_path` — CONFIRMED |
| `dressed_character_path_owned_by_user` CHECK (`split_part(model_path,'/',1)=user_id`) | `0001:49-50` | `0257145` | NEJ |
| `dressed_characters.gender` CHECK `('woman','man')` | `0001:45` | `0257145` | NEJ |
| Unik `dressed_characters_one_primary_per_user` | `0001:53-55` | `0257145` | NEJ |
| `dressed_character_geometry_contract_version_check` | `0012:15-17` | `0257145` | NEJ |
| FK `ai_generation_usage → ai_generation_limits` | `0001` | `0257145` | NEJ |
| `ai_generation_limit_overrides.clothing_free_limit CHECK > 0` | `202610050001:18` | `16fc958` | JA — men påvirker kun clothing-kvote |
| `wardrobe_items_placement_check` (fix i `0003`, **untracked**) | working tree | ikke commit't | JA, men `wardrobe_items` har **ingen relation** til model-generation — CONFIRMED |

**Svar (opgavens D):** **NEJ** — ingen CHECK-constraint eller FK tilføjet
efter den mistænkte arbejdsvige version kan blokere `UPDATE profiles` med
`model_generation_status='completed'`/`model_photo_path`, og ingen kan
blokere `dressed_characters`-INSERT'en i publish (dens stier var uændrede).
**Klassifikation: CONFIRMED.**

---


## 15. SQL regression assessment

### A — Kan en migration efter arbejdskandidaten forhindre `UPDATE profiles` med `model_generation_status='completed'` / `model_photo_path`?

> **NEJ.** De eneste post-kandidat-migrations er `0016` (rent funktionelt,
> *"No schema, policy or data changes"*, `0016:4`) og `202610050001`
> (clothing-kvote + ny deny-all-tabel). Ingen rører `profiles`.
> **Klassifikation: CONFIRMED.**

### B — Kan RLS forhindre det?

> **Ikke via en ændring efter kandidaten — ingen RLS-ændringer findes
> (CONFIRMED).** Selve `UPDATE profiles` i publish køres af
> `SECURITY DEFINER` og er derfor **ikke** RLS-underkast
> (CONFIRMED, `0012:187-247`).
> **Rest-risiko: UNVERIFIED** — `profiles`-RLS er slet ikke i version control
> (`DRESSED-LIVE-DATABASE-INSPECTION.md:184` medregner stadig policy-tekster
> som ukendte). Det rammer især `setGenerationStatus` (bruger-klient,
> `personal-model.ts:155-165`) og frontendens `SELECT` efter 202
> (`profile.astro:1104-1112`), **ikke** publish.

### C — Kan en RPC nu fejle, selvom den tidligere fungerede?

> **JA.** `finish_ai_generation_server` er **ny** (`0016`, `70bd54c`) og kan
> fejle på tre måder: `42501`-guard (`0016:20-23`), type-guard
> (`0016:25-27`) eller `found=false` pga. token/`in_progress`-mismatch
> (`0016:38-43`). Alle tre giver `released=false` → `character-job.ts:165`.
> Tilsvarende kan `reserve_ai_generation` afvise med 409/429 — men den
> opfører sig uændret siden `0015`.
> **Klassifikation: CONFIRMED (mekanisme) / UNVERIFIED (hvad der faktisk
> fejler live).**

### D — Kan en CHECK-constraint eller FK forhindre database-write'et?

> **NEJ.** Se §14. **CONFIRMED.**

---

### E — Kan reservation/quota-SQL nu frigive reservationen for tidligt?

> **Expiry-tiden er IKKE ændret** (5 min, `0001:313` → `0015:42` →
> `202610050001:89`) — **CONFIRMED**.
> Men **adfærden omkring den er ændret**: `reserve_ai_generation` nulstiller
> fortsat en >5 min gammel reservation (`0015:47-52`), og fra `70bd54c` kan et
> job **lovligt** køre længere end 5 min (8 min AI-timeout,
> `character-job.ts:10`). Kombinationen *langt job + ny reserve-anmodning*
> giver et nyt token → det gamle job frigiver "for tidligt" i recursionens
> forstand.
> **Klassifikation: INFERRED** (mekanismen er CONFIRMED i SQL, udløsningen
> live er UNVERIFIED).

### F — Kan en migration have ændret funktionssignatur, return values eller `SECURITY DEFINER`?

> **JA — men som *tilføjelse*, ikke som breaking-ændring:**
> * `0016` tilføjer en **ny** `security definer`-funktion med ny signatur
>   `(uuid, text, timestamptz, boolean)` og nyt grant-set
>   (`0016:6-11, 48-51`) — **CONFIRMED**.
> * `202610050001:35-122` **redefinerer** `reserve_clothing_ai_generation()`
>   med **uændret** signatur/return-shape (kommentar `:8-12`) — **CONFIRMED**.
> * `reserve_ai_generation(text)`, `finish_ai_generation(text)` og
>   `publish_dressed_character(text,text)` er **ikke** blevet ændret efter
>   kandidaten — **CONFIRMED**.
> * **Ingen** eksisterende funktion fik ændret sit return-type efter
>   kandidaten — **CONFIRMED**.
>
> **Samlet: INFERRED (lav risiko for eksisterende kald), CONFIRMED for den nye
> funktions tilkomst.**

### G — Kan Storage ownership-checks i SQL nu afvise et ellers korrekt upload?

> **Ikke som følge af en migration.** Ejerskabstjekket
> (`storage.objects.owner_id::text = auth.uid()`, `0012:207-215`) er
> **uændret** siden `0001` — **CONFIRMED**. Ingen migration opretter eller
> ændrer storage-policies (kun base-form-SELECT i `0010`, før kandidaten) —
> **CONFIRMED**.
> **Rest-risiko: UNVERIFIED** — upload-policies for `model-images` findes
> **overhovedet ikke** i repoet, så deres live-tilstand kan hverken be- eller
> afkræftes her (`DRESSED-SQL-MIGRATIONS-ANALYSIS.md:406`, fund F4).
> Bemærk at tjekket er *præ-eksisterende* — det kan have fejlet før også og
> vil derfor ikke være en *regression*.

### H — Kan SQL/RLS forklare `The character reservation was already released or expired`?

> **Delt svar:**
> * **At teksten *kommer fra* SQL: NEJ — CONFIRMED.** Den er en TypeScript
>   `console.error` i `character-job.ts:165` (og build-output `.mjs:322`).
>   Den findes i **ingen** migration, funktion eller trigger
>   (`git log -S` beviser at kun to *kode*-commits introducerede den).
> * **At SQL *forårsager* at den logges: JA, muligt — INFERRED.** Præcis to
>   SQL-tilstande giver `released=false`: (`i`) `in_progress=false` eller
>   `started_at`-mismatch i `0016:38-41`, (`ii`) RPC-fejl i `0016:20-27`.
>   RLS kan **ikke** direkte — `finish_ai_generation_server` kører som
>   `SECURITY DEFINER` med service-rolle og bypasser RLS
>   (**CONFIRMED**, `0016:14-15, 50-51`).
> * **At SQL/RLS *forklarer hele fejlen*: UNVERIFIED.** Beskeden logges i
>   `finally` og kan forekomme ved **succesfuld** generation; den er altså
>   ikke i sig selv forklaringen på at modellen ikke bliver genereret.

---

## 16. Compare SQL directly (`b9a94ca` ↔ current HEAD)

Kun relevante forskelle (`git diff b9a94ca HEAD -- supabase/`):

| # | Migration / funktion | Commit | Hvad der ændrede sig | Effekt på model-generation | Risiko |
|---|---|---|---|---|---|
| 1 | `supabase/migrations/202610050001_clothing_quota_override_test_user.sql` (NY, 122 linjer) | `16fc958` *"Clothes editor implementet"* | Ny tabel `ai_generation_limit_overrides` (RLS deny-all, `:22-28`), seedet række for testbruger `619b975b-…` = 100 (`:30-33`), og **redefinition af `reserve_clothing_ai_generation()`** (`:35-122`) | **Ingen** — `reserve_ai_generation('character')` røres eksplicit ikke (`:7`), `publish_dressed_character` røres ikke, `profiles` røres ikke | **LOW** |
| 2 | Alt andet i `supabase/` mellem `b9a94ca` og HEAD | — | **identisk** | — | — |

**Sammenligning `75f63b1` ↔ `b9a94ca` (SQL):**

| # | Migration | Commit | Hvad der ændrede sig | Effekt | Risiko |
|---|---|---|---|---|---|
| 1 | `202610040016_background_ai_generation_finalization.sql` (NY) | `70bd54c` | Ny `finish_ai_generation_server(uuid,text,timestamptz,boolean)`, `security definer`, `auth.role()='service_role'`-guard, token-match `started_at = p_reservation_started_at`, refund `greatest(used_count-1,0)` ved fejl, grant **kun** til `service_role` | **Direkte på model-generation** — det er denne funktion `character-job.ts:162` kalder, og `false` her er præcis den sete besked | **HIGH** |

**Kodeændringer (ikke-SQL) mellem `b9a94ca` og HEAD med relevans:**

| # | Fil | Commit | Hvad der ændrede sig | Effekt | Risiko |
|---|---|---|---|---|---|
| 1 | `src/lib/server/ai/jobs/character-job.ts` | `16fc958` | Prompt omskrevet (`:26-45`); ny SELECT af primær character før publish (`:129-141`); ny sletning af erstattet billede efter succes (`:168-182`) | Kan ændre output; sletningen kan efterlade død reference på den gamle character | **MEDIUM** |
| 2 | Working tree (ikke commit't): `wardrobe-ai.ts`, `items/[id].ts`, `items/index.ts`, `profile-outfits.ts`, `wardrobe.astro`, `wardrobe.css` + migrations `0002/0003` | — | Placement-arbejde | Ingen pålidelig forbindelse til model-generation | **LOW** |

---

## 17. Confirmed

1. **`b9a94ca` ændrer kun `src/styles/profile.css` (+5/−11)** — ingen
   model-generation-, SQL-, storage- eller config-fil (`git show --stat`).
2. **`b9a94ca`'s parent er `70bd54c`**, og `b9a94ca` er selv parent til HEAD
   `16fc958`. Kæden `75f63b1 → 70bd54c → b9a94ca → 16fc958` er lineær.
3. **Fejlteksten `The character reservation was already released or expired.`
   blev introduceret i `70bd54c`** (`character-job.ts:143` dengang, `:165` i
   HEAD); tidligste ref `f1e93d6` (checkpoint, 2026-10-05 00:01:42);
   **findes ikke i `75f63b1`**.
4. **Hele model-generationen blev omlagt fra synkront endpoint til
   Netlify-baggrundsjob i `70bd54c`** — 18 filer, inkl. ny `character-job.ts`,
   `background.ts`, `job-launcher.ts`,
   `netlify/functions/personal-model-background.mts` og migration `0016`.
5. **`personal-model.ts`-finally ændrede betingelse** fra
   `if (reservation)` til `if (reservation && !jobStarted)` i `70bd54c`
   (nu `:289`).
6. **`readReservationToken` og `finishGenerationServer` findes ikke i
   `75f63b1`** (`git grep` → exit 1).
7. **Ingen migration efter `75f63b1` ændrer `profiles`, `dressed_characters`,
   deres constraints, deres triggers eller RLS på eksisterende tabeller.**
8. **`publish_dressed_character` er uændret siden `0012`** (inkl. dens
   `storage.objects.owner_id`-tjek).
9. **`reserve_ai_generation` er uændret siden `0015`** (inkl.
   5-minutters-stale-vinduet).
10. **Ingen storage-upload-policy findes i repoet** — kun base-form-SELECT i
    `0010`.
11. **AI-model, inputs, `size`, `background` og `output_format` er uændrede**
    fra `75f63b1` til HEAD; **kun prompten blev ændret** (`16fc958`) og
    **timeouten** (`70bd54c`, 45 s → 8 min for character).
12. **Frontend-kravet `status === "completed" && model_photo_path` plus
    16-minutters polling blev tilføjet i `70bd54c`**
    (`profile.astro:1100-1119`).
13. **To uncommitted migrations (`202610050002/0003`) + 6 modificerede filer
    findes i working tree** ud over HEAD (`git status`).
14. **Reservations-beskeden logges i `finally` og kan forekomme ved
    succesfuld generation** — den er ikke i sig selv et fejlbvis.

---

## 18. Inferred

1. **Bedste "last known/suspected working" er `75f63b1` "alle funktioner
   virker"** — udelukkende fordi det er den eneste commit hvis besked påstår
   fuld funktionalitet, og fordi den er den sidste med den enkle, tokenløse
   reservationsafslutning.
2. **Den mest sandsynlige regression er `70bd54c` "new commit"** — den eneste
   commit der *omskriver* hele model-generationens kontrolflow, og samtidig
   introducerer både reservations-fejlteksten og det nye frontend-krav.
3. **Hvis `b9a94ca` alligevel virkede, er `16fc958` den eneste kandidat** —
   men dets ændringer er for små til at forklare et totalt break; mest
   sandsynligt ændrer prompten kun outputkvaliteten.
4. **Reservations-beskeden er højst sandsynligt en *følge* snarere end en
   *årsag*** — den logges i `finally`, også ved succes, og efterlader kun
   `in_progress=true` (som reserve automatisk nulstiller efter 5 min).
5. **Et >5-minutters baggrundsjob kombineret med et nyt tryk på knappen er den
   mest plausible kilde til token-mismatch** (`0015:47-52` vs. 8 min
   AI-timeout).
6. **`BACKGROUND_JOB_SECRET` i Netlify-miljøet er en reel enkeltstående
   fejlkilde** — lokal `.env` har nøglen (kun *navne* aflæst, ingen værdier
   vist), men deploy-miljøet er ukendt; mangler den → `false` → 502
   (`job-launcher.ts:33-37`).
7. **Sletning af det erstattede model-billede (`16fc958`) er den mest
   plausible nye storage-bivirkning**, men rammer genbrug af *gamle*
   characters, ikke selve generationen.

---


## 19. Unverified

* **Hvilken commit der sidst *faktisk* fungerede i produktionen.** Git kan
  kun vise påstande (commit-beskeder), ikke runtime.
* **Netlify-function-loggen for `personal-model-background`** — den ville
  navngive det konkrete trin:
  `DRESSED character generation failed in the background job.`
  (`character-job.ts:153`) + `console.error`-felterne på `:74, :124, :148`.
* **Live `profiles`-RLS** (policy-tekster, `USING`/`WITH CHECK`) — slet ikke i
  version control.
* **Live storage-policies for `model-images`/`profile-images`** — findes ikke
  i repoet.
* **Live grants for `finish_ai_generation_server`** og om `auth.role()`
  returnerer `service_role` for den deployede service-nøgle
  (`DRESSED-LIVE-DATABASE-INSPECTION.md:59-61` hævder at funktionen findes
  live — ikke genkørslet her).
* **Deployed kodeversion** — er den deployede Netlify-version `16fc958`,
  `b9a94ca` eller noget tredje? Ingen `netlify.toml` findes i repoet.
* **Brugerens `used_count` vs. live-kvote** (`ai_generation_limits` live =
  character 3 / clothing 5 / tryon 1 ≠ repo 1/3/1 — dokumenteret som
  afvigelse L2 i `DRESSED-LIVE-DATABASE-INSPECTION.md:174`).
* **Hvordan `profiles`-rækker oprettes** (auth-trigger vs. lazy-insert).
* **Hvad brugeren præcist så** — HTTP-status, Network-body, konsol-beskeder.

---


## 20. Exact next debugging step

**Read-only, i denne rækkefølge — ingen fixes før regningen er lukket:**

1. **Hent Netlify-loggen for `personal-model-background` for det konkrete
   fejltidspunkt.** Lige præcis én af disse linjer navngiver trinnet:
   * `DRESSED character generation failed in the background job.` +
     vedhæftet `error` (**`character-job.ts:153`**) → trinnet er fundet
     (AI / upload / publish / PNG-check).
   * `Could not store the generated DRESSED character.` (`:124`) → Storage.
   * `Could not publish the generated DRESSED character.` (`:148`) →
     publish-RPC (læs den vedhæftede exception-tekst: `…not stored in the
     user-owned private bucket.` / `The character model type does not
     match…`).
   * `Could not finalize the character generation reservation.`
     (`generation-usage.ts:155`) → **RPC-fejl, ikke token-mismatch** → læs
     `error.code` (`42501` = guard/grant).
   * `BACKGROUND_JOB_SECRET is not configured.` (`job-launcher.ts:35`) →
     deploy-config.
2. **Aflæs read-only brugerens tilstand med service-nøglen:**
   `profiles.model_generation_status`, `profiles.model_photo_path`,
   `ai_generation_usage {used_count, in_progress, started_at}` for
   `generation_type='character'`.
   * `failed` → bekræfter gren A (efterfølgende trin fejlede).
   * `completed` + path → **AI lykkedes**, fejlen er i frontend-læsningen
     (R2, `profile.astro:1104-1113`).
   * `in_progress=true` i lang tid → bekræfter at
     `finish_ai_generation_server` returnerede `false` → sammenlign
     `started_at` med token'et i loggen.
3. **Aflæs `pg_proc` for `finish_ai_generation_server`** (argnames,
   `prosecdef`, grants) for at bekræfte at `0016` faktisk kørte på live (den
   live-inspektion der findes i repoet siger ja, men er ikke genkørslet).
4. **Aflæs RLS-policy-teksterne for `profiles`** (findes ikke i repoet) for
   at entydigt afvise/bekræfte R2.
5. **Afgør først derefter** om `70bd54c` (baggrundsarkitektur) eller
   `16fc958` (prompt/sletning) er regressions-commit'en — og **først derefter**
   eventuelle ændringer.

---

*Oprettet: kun denne fil. Ingen production-code, SQL, migration, database,
Supabase, Storage, dependencies eller config er ændret.*

**STEP REGRESSION + SQL ANALYSIS COMPLETE**

