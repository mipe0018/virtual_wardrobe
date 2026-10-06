# DRESSED — MODEL GENERATION DEBUG — STEP 01

*Type: ANALYSIS ONLY. Intet production-code, SQL, migration, database, API, Supabase,
Storage, environment eller dependencies er ændret.*

---

## Symptom

Bruger rapporterer: PROFILE → **MAKE AI READY** → modellen bliver ikke genereret,
og brugeren ender med fallback-teksten:

> `Can't generate model`

---

## Exact fallback source

**TEKSTEN FINDES IKKE I DETTE REPOSITORY.** Kilde til præcis `Can't generate model`
er **ikke fundet** — hverken i working tree, build-output, git-historik eller på
nogen branch/remote.

Søgninger udført (alle uden fund):

| Metode | Mønster | Resultat |
|---|---|---|
| Codebase-søgning (1134 filer) | `Can't generate model`, `can't generate model`, `cannot generate model`, `generate model`, `model generation` | 0 fund |
| PowerShell fuld-træ (alle filer udenfor `.git`/`node_modules`, inkl. `dist/`, `.netlify/`, `.kilo/worktrees/`) | `generate model` (case-insensitive) | 0 fund |
| Samme fuld-træ | `Can.t generate` (regex — dækker apostrof-varianter) | 0 fund |
| Escaped-varianter i `src`, `public`, `scripts`, `netlify` | `Can&#39;t`, `Can&apos;t`, `Can\'t`, `Can\u2019t` | 0 fund |
| `git log --all -S "generate model"` / `-S "Can't generate"` | history-pickaxe på alle refs | 0 commits |
| `git grep -i` på `main`, `origin/main`, `clothes`, `origin/clothes` | `generate model`, `can't generate`, `cannot generate` | `EXIT=1` (ingen match) |

**Konklusion (opgave-kategori A–E):** Kategorien bliver **E — Noget andet**.
Hverken frontend (A), API (B), database-status (C) eller en generisk error-handler (D)
indeholder denne konkrette tekst. Teksten må enten (E1) stamme fra en **anderledes
deployed version** end denne working tree, (E2) fra en **hosted/live database-funktion
der ikke ligger i repoet**, (E3) fra en **ekstern service-besked der vises råt**, eller
(E4) være brugerens **gengivelse/paraphrase** af en af de faktiske fallback-tekster
nedenfor. Dette kan **ikke afgøres fra kode alene**.

### Faktiske fallback-tekster der KAN nå brugeren i denne flow-klasse

Display-kanaler (frontend-genereret — gælder for de rigtige beskeder, kategori A):

* `src/lib/client/generation-flow.ts:100-113` — `failFlow(message)` renderer
  `state.label` i `.flow-progress`-panelet (`render()` linje 67:
  `labelElement.textContent = state.label`).
* `src/pages/profile.astro` — `modelDescription.textContent = ...` (statuslinje).

Kandidat-tekster, model-generering (`GENERATE AI MODEL`-knap, `profile.astro:1054`):

| Linje | Tekst | Udløser |
|---|---|---|
| 1057 | `UPLOAD A SOURCE PHOTO BEFORE GENERATING YOUR MODEL.` | guard: `!sourcePhotoPath` |
| 1061 | `CHOOSE WOMAN OR MAN BEFORE GENERATING YOUR DRESSED CHARACTER.` | guard: gender ≠ woman/man |
| 1076 | `MODEL GENERATION FAILED — PLEASE LOG IN AGAIN.` | session/token-fejl |
| 1119 | `MODEL GENERATION FAILED. PLEASE TRY AGAIN.` | HTTP 202 men efter polling: `model_generation_status ≠ completed` **eller** `model_photo_path` mangler |
| 1127+1129 | `result.error ?? MODEL GENERATION FAILED. PLEASE TRY AGAIN.` + `failFlow(...)` | ikke-202 og (!ok **eller** `modelPhotoPath` mangler) |
| 1169+1171 | `MODEL GENERATION FAILED. PLEASE CHECK YOUR CONNECTION...` | catch/undtagelse i flowet |
| 767 | `MODEL GENERATION FAILED. YOU CAN TRY AGAIN.` | sideindlæsning: DB `model_generation_status === "failed"` |

Kandidat-tekster for **MAKE AI READY**-knappen (`profile.astro:1487-1510` →
`prepareClosetItem` `profile.astro:939` → `processClothingItem` `wardrobe-ai.ts:132`
→ `POST /api/ai/process-clothing`):

| Linje | Tekst | Udløser |
|---|---|---|
| `process-clothing.ts:283` | `Generate a DRESSED character before making clothing AI ready.` | HTTP 409: ingen primary character (= **model mangler**) |
| `process-clothing.ts:290` | `Generate a new DRESSED character before making clothing AI ready.` | HTTP 409: geometry-contract ≠ `normalized-v1` |
| `wardrobe-ai.ts:162` | `The clothing generation did not finish. Please try again.` | 202 men asset ikke persisted efter polling |
| `wardrobe-ai.ts:181` | `result.error ?? Could not prepare this clothing item.` | API !ok eller manglende `result.item` |
| `profile.astro:1500-1505` | `error.message ?? COULDN'T PREPARE ITEM...` → `failFlow(message)` | catch i knap-handleren |

API-tekster fra `POST /api/ai/personal-model` (vises via `result.error`):
`Your profile could not be found.` (194), `Choose and save Woman or Man...` (196),
`Upload a source photo before generating your character.` (199),
`The saved source photo path is invalid.` (202), quota/OpenAI-fejl via
`error.message` (282-285), fallback `Character generation failed. Please try again.` (285).

---

## Trigger condition

```text
Hvad udløser fallback?
        ↓  (for den rapporterede tekst: UKENDT — teksten findes ikke i repoet)
Hvilken variable?
        ↓  modelDescription.textContent  ELLER  state.label via failFlow(message)
Hvilken status?
        ↓  model_generation_status ("failed") ELLER response.ok === false
           ELLER (202 + polling færdig uden completed+model_photo_path)
           ELLER (MAKE AI READY: 409 pga. manglende primary character)
Hvilken API response?
        ↓  POST /api/ai/personal-model (4xx/5xx/202-uden-resultat)
           POST /api/ai/process-clothing (409)
Hvilken error?
        ↓  se tabellerne ovenfor — hver kandidat har en konkret, dokumenteret betingelse
```

Visningen sker gennem præcis to kanaler: `failFlow()`-panelet
(`generation-flow.ts:100`) og `modelDescription.textContent`/`itemPreview.textContent`
i `profile.astro`. Ingen anden kode i projektet viser fejltekster i dette flow.

---

## First failure point

For **den rapporterede tekst** kan første fejlpunkt **ikke** fastsættes (teksten
findes ikke i koden — jf. ovenfor). Stop her for denne del.

For de **faktiske** nærmeste kandidater er første konkrete condition:

```text
MODEL-GENERERINGS-FLOW:
GENERATE AI MODEL (profile.astro:1054)
    ↓
POST /api/ai/personal-model  →  HTTP 202 (job startet)
    ↓
waitForGenerationToFinish (generation-usage.ts:42-65, timeout 16 min)
    ↓
outcome = SELECT model_generation_status, model_photo_path FROM profiles
    ↓
betingelse (profile.astro:1113): status !== "completed" ELLER model_photo_path === null
    ↓
profile.astro:1119  "MODEL GENERATION FAILED. PLEASE TRY AGAIN."
    ↓
profile.astro:1129  failFlow("MODEL GENERATION FAILED — " + ...)
```

```text
MAKE AI READY UDEN MODEL (mest relevante for den rapporterede bruger-flow):
MAKE <BASETYPE> AI READY-knap (profile.astro:1487)
    ↓
POST /api/ai/process-clothing
    ↓
response 409 (process-clothing.ts:283: !primaryCharacter)
    ↓
wardrobe-ai.ts:181 kaster Error(result.error)
    ↓
profile.astro:1505 failFlow(message) → panelet viser "Generate a DRESSED
character before making clothing AI ready."
```

---

## Evidence

1. Codebase-søgning på `Can't generate model` / `generate model` / `model generation`
   / `cannot generate model`: 0 fund i 1134 filer.
2. PowerShell `Select-String` over **hele træet** (inkl. `dist/_astro/*.js`,
   `.netlify/functions-serve/**`, `.kilo/worktrees/quilt-ticket/**`):
   `generate model` simple-match: 0 fund; `Can.t generate`: 0 fund.
3. `git log --all -S`: 0 commits introducerende mønsteret.
4. `git grep -i` på alle 4 refs (`main`, `origin/main`, `clothes`, `origin/clothes`):
   `EXIT=1` (ingen match).
5. Display-mekanisme påvist: `generation-flow.ts:58-69` (render), `:100-113` (failFlow),
   `profile.astro:1125-1131`, `:1498-1506` (hvor fejltekster sættes).
6. API-guard i `process-clothing.ts:283` (manglende model → 409).
7. Status-læsning ved sideindlæsning: `profile.astro:765-770`.

---

## Confirmed

* Den eksakte tekst `Can't generate model` findes **ikke** i working tree, bygget
  output, git-historik eller nogen ref.
* Fallback-tekster i dette flow er **frontend-genererede** (kategori A for de faktiske
  tekster) — ikke hentet fra API eller DB som rå tekst.
* De to display-kanaler er `failFlow()` og `modelDescription`/`itemPreview`.
* De dokumenterede trigger-betingelser i tabellerne ovenfor (linje-verificerede).

## Inferred

* Brugeren har højst sandsynligt set én af de faktiske fallback-tekster (nærmest:
  `MODEL GENERATION FAILED...` eller 409-beskeden `Generate a DRESSED character
  before making clothing AI ready.`) og gengivet den frit.
* Alternativt kører den deployede Netlify-side en anden kodeversion end denne
  working tree.

## Unverified

* Præcis hvilket DOM-element/Network-response brugeren så teksten i.
* Indholdet af den deployede Netlify-produktion (kan afvige fra `dist/` her).
* Hosted Supabase: om en RPC/trigger retter en fejlbesked (kun migrations i repoet
  er gennemsøgt — ingen fund).
* Om brugeren paraphraserer vs. citerer ordret.

---

## Next debugging step

1. Få den **præcise placering** fra brugeren: screenshot + "inspect element" på
   teksten (HTML-element-klasse) + Netværk-fanen: hvilket request/response bærer
   teksten (URL + statuskode).
2. Kør `PROFILE → GENERATE AI MODEL` og `MAKE AI READY` med DevTools åbent og notér
   `POST /api/ai/personal-model` respektive `POST /api/ai/process-clothing`
   statuskode + JSON-body (`error`-feltet).
3. Sammenlign den deployede version med denne working tree for at afvise (E1).
4. Først når teksten er lokaliseret ét konkret sted, gå videre til STEP 2
   (fejlen bag betingelsen — ikke hele model-generationen).

---

*Oprettet: analyse-kun. Filer ændret: kun denne fil.*

