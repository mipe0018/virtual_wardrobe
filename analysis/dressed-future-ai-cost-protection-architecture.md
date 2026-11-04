# DRESSED — Future AI Cost Protection Architecture Analysis

> **READ-ONLY ARKITEKTUR-ANALYSE.** Intet implementeres. Ingen kildefil,
> migration, Supabase-indstilling, pakke, OpenAI-/betalingskonfiguration eller
> git-tilstand er ændret — **kun denne rapport er skabt.**
>
> **BETALING ER UDEN FOR SCOPE** (se §24). Denne rapport er et planlægnings-
> dokument til brug, når implementeringen engang begynder.
>
> **Grundlag:** den forensiske audit
> `analysis/dressed-ai-failed-generation-cost-audit.md` (alle fund med
> fil:linje-beviser) samt `analysis/dressed-pricing-storage-svg-analysis.md`
> (økonomisk kontekst). Evidensmarkeringer genbruges:
> **[CODE]** = bevist i nuværende kode · **[SQL]** = bevist i migrations ·
> **[ASSUMPTION]** = bevidst antagelse · **[DECISION]** = skal besluttes senere.

---

## 1. Purpose

DRESSED har i dag **flere AI-genereringsstier med uensartet kvoteregnskab**
[CODE/SQL] — den forensiske audit konkluderede:

| # | Kendt problem (fra audit, med bevis) |
|---|---|
| 1 | **Tre ulige kvotemodeller:** character tælles ved reservation og **refunderes ved fiasko**; clothing tælles **kun ved succes**; tryon tælles ved reservation og **refunderes aldrig** (`0015`/`0008`/`0011`/`0016`/`0001`) |
| 2 | **Clean-preview er ubegrænset** — 1 `images/edits` + 1 moderering pr. upload, ingen reservation/tæller/loft (`wardrobe/items/index.ts:79,450,556`) |
| 3 | **Reservations-token sendes til klienten** i 202-svaret (`process-clothing.ts:527`) og finish-RPC'en er `grant … to authenticated` (`0008:114`) ⇒ manuel lås-rydning |
| 4 | **Refunderet kvote ≠ refund omkostning:** betalt OpenAI-generering + storage/DB-fejl ⇒ gratis retry (`character-job.ts:152-166`, `clothing-job.ts:214-228`) — **HIGH ECONOMIC RISK** |
| 5 | **To orphante endpoints** (`dress-model`, `try-on`) uden klient, men kaldbare (`dress-model` desuden uden moderering) |
| 6 | **Ingen repository-synlig global circuit breaker**, ingen DKK-telemetri, ingen forsøgsloft (0 `max_attempts`-træffere) |
| 7 | **Ingen fælles AI-omkostningsarkitektur** — hvert route genopfinder rækkefølgen moderering→reservation→job |

**Formålet med dette dokument:** designe **én sammenhængende, fremtidig
arkitektur** der løser alle syv punkter som et system — ikke som syv individuelle
prikfiks. Betaling, kvoter-produktlogik og selve genereringen holdes adskilt
og defineres én gang.

---

## 2. Business Requirement

> **DRESSED må aldrig udsætte ejeren for en ubehersket AI-regning.**

Arkitekturen skal modstå (efter kravlisten): normal brug · utilsigtet
gentagne requests · dobbeltklik · samtidige requests · frontend-fejl ·
backend-fejl · kvote-fejl · fejlede genereringer · storage-fejl ·
database-fejl · retry-loops · misbrug · ondsindede brugere · **fremtidige
AI-endpoints** · **uventede AI-prisstigninger**.

**Designprincip (det styrende):** *beskyttelsen må ikke hvile på ét lag.* Et
kunne fejle (kvote-bug), tre kunne fejle samtidig (kvote + idempotens +
budget). Arkitekturen bygger derfor i **lag**, hvor det yderste lag (global
circuit breaker + manuel nødstop) **altid** begrænser det absolutte tab, uanset
hvor mange indre lag der fejler — og hvor **betaling bevidst lades ude** (§24).

---

## 3. Important Distinction — USER ENTITLEMENT vs. COST PROTECTION

De to begreber må **aldrig** blandes sammen. Det er kernen i hele auditet.

| | **A. USER ENTITLEMENT** (brugerens rettigheder) | **B. COST PROTECTION** (ejerenes risikogrænser) |
|---|---|---|
| **Spørgsmål** | *Hvad må brugeren bruge?* | *Hvad er DRESSED villig til at risikere pr. konto/globalt?* |
| **Eksempler** | 1 personlig model · 3 beklædnings-generationer · fremtidige try-on · fremtidige previews | max AI-kald pr. time/døgn · max estimeret forbrug pr. konto · max livstids-forbrug for en gratis/Starter-konto · global dagsgrænse |
| **Enheder** | **resultater** (heltal, "generationer") | **penge** (DKK/USD-estimater) + **kald** |
| **Regnskab** | `used_count` vs. `free_limit` | reserverede/afregnede **omkostninger** pr. kald |
| **Hvem ejer den?** | produktet (fremtidig betaling, pakker) | ejerens økonomi — **findes ikke i dag** |
| **Fejltilstand** | "du har brugt dine 3" | "denne konto kan ikke starte flere kald lige nu" |
| **Refundering** | brugerens kvone rulles tilbage | **omkostningen rulles ALDRIG tilbage automatisk** (se §5) |

**Hvorfor de må være adskilt:**
1. **De bevæger sig i forskellige retninger:** en bruger kan have kvote
   tilovers, mens budgettet er opbrugt (flere fejlede forsøg), og omvendt
   (cache-træf giver kvote men 0 omkostning).
2. **Refundering er kun en entitets-handling:** at rulle `used_count` tilbage
   siger **intet** om, om OpenAI allerede har faktureret (audit §5D —
   *HIGH ECONOMIC RISK*). Blander man dem, **skjuler man omkostningen**.
3. **Udvikling uafhængigt:** pakker/priser (betaling) kan ændres uden at røre
   sikkerhedsgrænserne — og omvendt.
4. **Fremtidige betalingskonti** (§24) vil ændre *entitlement*, aldrig
   *cost-protection*: en betalende bruger må stadig ikke kunne skabe et
   ubegrænset tab.

**Anbefaling:** to **separate tabeller/regioner** i databasen
(`ai_entitlements` vs. `ai_budgets/ai_cost_ledger`) og to **separate
kontrol-trin** i koden (§4). Ingen funktion må læse begge med samme værdi.

---

## 4. Unified AI Generation Model

### 4.1 Er den foreslåede pipeline passende?

```text
AI generation request
    ↓ authenticate                    ← JWT-verifikation (findes: authenticateSupabaseRequest)
    ↓ identify operation              ← ÉN registrering pr. operationstype (NYT)
    ↓ check entitlement               ← brugerens rettigheder (A)
    ↓ check account cost protection   ← konto-budget (B1)
    ↓ check global circuit breaker    ← global grænse (B2)
    ↓ reserve cost budget             ← pengene låses FØR afsendelse (NYT)
    ↓ perform AI request              ← éneste sted med provider-kald (findes: openai-images.ts)
    ↓ record actual outcome           ← tilstand + estimeret/aktuel pris (NYT)
    ↓ finalize accounting             ← kun server-til-server (NYT)
```

**Vurdering: JA — pipeline'en er den rigtige, og den passer uventet godt til
det eksisterende kodegrundlag [CODE]:**
- **Alle** OpenAI-kald passerer allerede **én** chokepoint-fil
  (`openai-images.ts` — kun `editImage` + `moderateImage` er eksporteret).
  Trin 4–9 kan derfor indfases **uden at røre 12 routes**.
- **Autentificeringen er centraliseret** (`authenticateSupabaseRequest`,
  `src/lib/server/supabase.ts:37`) — trin 1 findes.
- **Det, der mangler, er netop trin 2, 3, 5, 6, 8, 9** — de fire steder hvor
  nutiden afviger: moderering før reservation, preview uden reservation,
  tre ulige regnskaber og refundering der skjuler omkostning.

### 4.2 Operations-registret (trin 2)

Én **operations-definition pr. AI-handling** — kodeordet *operation* er fælles
for entitet, omkostning og telemetri:

| `operation` | Moderering? | Provider-kald | Estimeret enhedsomkostning | Entitlement-kilde i dag | Noter |
|---|---|---|---|---|---|
| `character` | ja | `images/edits` 1024×1536 | målt gennemsnit × **sikkerhedsfaktor** | `free_limit=1` | baggrundsjob |
| `clothing` | ja | `images/edits` 1024×1536 | idem | `free_limit=3` | baggrundsjob |
| `tryon` | **bør tilføjes** | `images/edits` 1024×1536 | idem | `free_limit=1` | synkron; i dag **ingen moderering** [CODE] |
| `clean_preview` | ja | `images/edits` 1024×1024 | idem | **ingen i dag** | **ubegrænset i dag** [CODE] |
| *(fremtidige)* | valgfrit | provider-afhængig | fra pris-tabel (§17) | ny linje | automatisk omfattet |

**Regel:** *enhver ny AI-funktion i fremtiden er **én ny linje** i registret
— aldrig en ny håndskrevet sekvens.* Det er den egentlige "fremtidige
endpoints"-beskyttelse: **en operation uden for registret kan ikke køre**,
fordi chokepointet afviser ukendte operationer (fail-closed).

### 4.3 Hvad pipeline'en IKKE skal gøre

- Den må **ikke** tage imod priser, `user_id`, `operation` eller
  `provider` fra klienten (§20).
- Den må **ikke** slå entitets- og budget-tjek sammen til én "kvote" (§3).
- Den må **ikke** returnere reservationsdata til klienten (§10).

---

## 5. Generation State Machine

### 5.1 Hvilke states er faktisk nødvendige?

Af den foreslåede liste er **11 nødvendige**; 2 kan droppes:

| State | Nødvendig? | Begrundelse |
|---|---|---|
| `requested` | **JA** | identitet skabes før noget sker (grundlag for idempotens, §9) |
| `authorized` | **JA** | entitet + budget + breaker godkendt — men intet reserveret endnu |
| `reserved` | **JA** | budget-lås + entitets-lås aktiv (før afsendelse) |
| `processing` | **JA** | provider-kald i gang |
| `provider_success` | **JA** | billede returneret OK |
| `provider_failure` | **JA** | entydig provider-fejl (4xx/5xx) |
| `validation_failed` | **JA** | returneret men ugyldigt (signatur/mål/base64) |
| `storage_failed` | **JA** | **kritisk adskillelse** — se §18 |
| `completed` | **JA** | artifact + DB-commit begge OK |
| `unknown` | **JA** | **se §12 — den vigtigste state af alle** |
| `refunded` | **JA** (men kun som *entitets*-markering, §5.2) |
| `cancelled` | valgfri (klient-abort efter afsendelse = irrelevant; før = `cancelled` kan droppes til fordel for `provider_failure`/udløb) | **[DECISION]** |
| `moderation_rejected` | **NEJ** — fold ind i `provider_failure` med `error_category=moderation` | §14 |

### 5.2 Den afgørende struktur: TO adskilte regnskaber pr. generation

> **Grundreglen:** *en kvote-refundering må aldrig automatisk betyde, at
> DRESSED's AI-omkostning er refunderet.*

Derfor repræsentères **én generation med tre ortogonale dimensioner** (ikke
én linje-lignende status):

```text
Generation (generation_id)
│
├─ lifecycle_state:  requested → authorized → reserved → processing →
│                    provider_success → {validation_failed | storage_failed}
│                    → completed    | provider_failure | unknown
│
├─ entitlement_state: not_consumed → consumed → RESTORED   ← "brugerens ret"
│                    (RESTORED sættes ved fejl — SIGER INTET OM PENGE)
│
└─ cost_state:       none → reserved → incurred | released → reconciled
                     unknown (muligvis faktureret — §12)
                     ← "ejerens penge" — MÅ IKKE nulstilles af
                        entitlement_state
```

**Eksplicit invariant (skal testes ved implementering):**

```text
HVIS entitlement_state = RESTORED
OG   cost_state ∈ {incurred, unknown, reserved}
SÅ   er operationen IKKE gratis — retry kræver nyt budget-lås,
     tæller i telemetri som "retried_after_incurred_cost"
     og kan ikke udløses uden for budgetgrænsen.
```

**Præcisering af `refunded`:** den foreslåede state `refunded` er derfor
**misvisende som én state** — den erstattes af
`entitlement_state = RESTORED` + `cost_state = released|incurred|unknown`.
Dette er præcis den repræsentation, opgaven efterspørger:

```text
"User entitlement restored"   = entitlement_state: consumed → RESTORED
"BUT AI provider cost may have occurred" = cost_state: reserved → incurred
                                            (eller → unknown, §12)
```

---

## 6. Cost Reservation

### 6.1 Den foreslåede mekanisme

```text
FØR provider-kald:
  estimated_max_cost = price_table[op, model, size, quality] × safety_multiplier
  RESERVER fra konto-budgettet:  budget.reserved += estimated_max_cost
  RESERVER fra det globale budget: global.reserved += estimated_max_cost
  (atomisk, i samme transaktion som lifecycle_state → "reserved")

EFTER provider-kald:
  actual_or_estimate = kendt faktisk pris ELLER seneste bedste estimat
  AFREGN:  budget.reserved -= estimated_max_cost
           budget.spent    += actual_or_estimate      (cost_state → incurred)
  VED entydig fejl FØR afsendelse:
  FRIGIV:  budget.reserved -= estimated_max_cost      (cost_state → released)
  VED ukendt udfald:
  BEHOLD reservationen som "unknown" indtil afstemning (§12)
```

### 6.2 Er reservation at foretrække frem for blot at dekrementere en kvote?

**Ja — fordi en kvote tæller det forkerte tal.** Sammenligning:

| Egenskab | Dekrementering af kvote (i dag) | Kost-reservation (fremtid) |
|---|---|---|
| Tæller | **resultater** (heltal) | **penge** (DKK-estimater) |
| Fejlede forsøg | refunderes ⇒ gratis ⇒ loop [CODE] | reservation **forbliver låst** indtil afregning ⇒ loopet koster budget, ikke er gratis |
| Prisstigning (+50/+100 %) | ufølsom — men også **blind** | estimatet stiger automatisk fra pris-tabellen (§17) |
| Flere providers | kræver omkodning | én model, provider-specifik estimering bag abstraktionen (§16) |
| Ukendt faktureret udfald | **kan ikke repræsentere** | `cost_state=unknown` bevarer reservationen (§12) |
| Overensstemmelse med telemetri | nej | ja — samme enhed i hele systemet |

**Designvalg:** reservationen er den **maksimale forventede omkostning**
(estimat × sikkerhedsfaktor), aldrig den gennemsnitlige — fordi målet er
*aldrig at tillade mere risiko end budgettet* (konservativt over-estimat
frigiver penge ved afregning; det omvendte beskytter aldrig).

**Behandler følgende kloge tilfælde:**
- **Fejlede requests:** `provider_failure` **før** afsendelse ⇒ `released`;
  fejl **efter** afsendelse ⇒ `incurred`/`unknown` (aldrig gratis).
- **Ukendt billing-udfald:** reservationen forbliver (§12) — den må
  **ikke** frigives på et gæt.
- **Valutakurser:** pris-tabellen lagres i **provider-valuta (USD)** med
  `fx_rate_used` + `fx_rate_as_of` (sidst opdaterede kurs, `[DECISION]` om
  kilde) — estimater afrundes opad.
- **Fremtidige providers:** reservationen er provider-uafhængig; kun
  *estimeringen* er provider-specifik (§16).

**Anbefaling:** reservation er **obligatorisk** for alle billed-operationer;
en simplere "tæl-kald"-variant er kun acceptabel som midlertidigt mellemtrin
i en implementeringsfase (§23).

---

## 7. Account-Level Protection

Grænser der gælder **uafhængigt af produktets entiteter** (§3B). Vurderet
pr. krav: *nødvendig* = manglen giver direkte ubegrænset/ubehersket risiko.

| # | Grænse | Nødvendig? | Hvor den sidder | Begrundelse |
|---|---|---|---|---|
| 1 | **Max AI-operationer pr. konto pr. døgn** (alle operationer inkl. `clean_preview` + moderering) | **NØDVENDIG** | konto-budget-tjek før reservation | aflukker §"ubegrænset preview" + moderation-vildtvildt |
| 2 | **Max estimeret AI-forbrug pr. konto pr. døgn** (DKK) | **NØDVENDIG** | budget-reservationen | penge ≠ antal (dyre operationer) |
| 3 | **Max livstids-forbrug pr. gratis/Starter-konto** (DKK) | **NØDVENDIG** for en fast pakke | konto-budget | den reelle "aldrig mere end X" for ejeren; *størrelsen er [DECISION]* |
| 4 | **Forsøgsloft pr. operation** (tæller *forsøg*, ikke kun succes — inkl. `unknown`) | **NØDVENDIG** | entitets-laget (men separate fra cost-laget) | lukker refund-loppen |
| 5 | **Cooldown efter gentagne fejl** (eksponentiel pause pr. konto efter N `provider_failure/unknown`) | **NØDVENDIG** | pipeline før `processing` | stopper fejl-loops automatisk uden manuel indblanding |
| 6 | **Pr. time-grænse** | valgfri (døgn-grænsen + cooldown dækker hovedsagen) | pipeline | [DECISION] finjustering |
| 7 | **Max preview-operationer pr. konto** (særskilt, §8) | **NØDVENDIG** | entitets-laget for `clean_preview` | previews er det ukvoterede hul i dag |
| 8 | **Akut konto-lock** (service-rolle sat `locked=true`) | **NØDVENDIG** (drifts-redskab) | pipeline trin 1 | manuel nødstop for én konto |
| 9 | **Pr. model-/operation-undergrænser** | valgfri | operation-registret | finjustering |

**Fælles regler for alle grænser:**
- De sidder **kun server-side**, læses **kun** af pipeline'en, og er
  **uværende af** entiteter (§3).
- De er **konfiguration**, ikke kode: `ai_budget_policies`-tabel/[settings]-modul
  (svarer til `ai_generation_limits`, men i DKK-enheder).
- De må **aldrig** nulstilles af bruger-handlinger (logout, sletning af konto,
  ny browser, ny e-mail) — en slettet konto arver sit forbrug via det
  anonymiserede bill-lag i en given periode **[DECISION/juridisk]** (jf.
  cooldown-analysens §11-mønster).

---

## 8. Clean-Preview Protection (PRIORITET — ubegrænset i dag [CODE])

### 8.1 De fire muligheder

| Option | Beskrivelse | + | − | Vurdering |
|---|---|---|---|---|
| **A: Normal AI-kvote** (deler "3 beklædnings-generationer") | preview = 1 af brugerens 3 | 0 nye mekanismer | **uberettiget:** en upload-sided-effect æder produktrettigheder; brugeren kan ikke længere lave 3 rigtige genereringer efter at have uploadet tøj; UX-forvirring | **afvises** |
| **B: Særskilt preview-kvote** (f.eks. "20 previews/konto") | tydelig, UI-visbar grænse | begrænser antal, **ikke penge** (prisstigning/nye operationer glider igennem); isolerer fra produktets kvoter | **utilstrækkelig alene** | delvis |
| **C: Kun konto-budget** (ingen synlig kvote, kun DKK-grænse) | ren økonomisk sandhed; ingen kunstig tælling | brugeren får en **uforståelig** 403 uden varsel; ingen UX-grænse at vise; alt belaster det samme budget | **utilstrækkelig alene** | delvis |
| **D: Hybrid** = særskilt preview-entitet **+** konto-budget | begge lag: UX-synlig grænse + økonomisk sandhed | to tal at holde styr på | **ANBEFALING** |

### 8.2 Anbefaling: **OPTION D (hybrid)**

```text
clean_preview
  ├─ ENTITLEMENT: særskilt preview-kvote (f.eks. "N previews pr. konto",
  │    [DECISION] om tal; tæller FORSØG, ikke kun succes)
  │    ⇒ brugeren ser "preview-kreditter tilbage", og loftet er uafhængigt
  │      af produktets beklædnings-kvote (A afvises) og af priser (B alene
  │      er blind for prisstigninger)
  └─ COST PROTECTION: som alle andre operationer indgår preview i
       konto-budgettet + circuit breakeren (C's sandhed bevares)
```

**Hvorfor netop hybrid:** B giver brugeren en forklaring, C garanterer
ejeren økonomisk kontrol — kun sammen opfylder både kravet om
*forståelig UX* og kravet om *ubehersket-regning-beskyttelse*. Option A
bryder produktets entitetsløfte, og B eller C alene efterlader det andet lag
åbent.

### 8.3 Konkrete kontrolpunkter for uploads/preview

| Problem fra auditet | Fremtidig kontrol | Lag |
|---|---|---|
| Antal uploads | **Upload-loft pr. konto** (f.eks. 30–50) i entitets-laget | entitet |
| Preview-frekvens | preview-kvote + pr. minut-takst i pipeline | entitet + budget |
| **Dublet-upload (samme fil, nyt item-id)** | **ekstakt SHA-256 af originalen** ⇒ cache-træf ⇒ **0 provider-kald** (se §19) | teknisk |
| Gentaget upload af *lignende* billede | pHash **kun inden for samme bruger** (GDPR, jf. pricing-analysen §13) — **[DECISION]** | entitet |
| Fejlede previews | tæller som *forsøg* (aldrig gratis); `cost_state=incurred/unknown` hvis afsendt | begge |
| Vellykkede previews | gemmes pr. item ⇒ **gentagne kald for samme item er forbudt** (unik `generation` pr. `(item, operation)`) | idempotens |
| Cached previews | eksisterende `preview_path`-mønster bevares — men flyttes ind i `generation`-modellen som `completed`-generation med artifact-reference | state |

**Hovedpointen:** *preview bliver en helt almindelig operation i registret
(§4.2) — det er det, der gør det umuligt at "glemme" en ny AI-funktion igen.*

---

## 9. Duplicate Request Protection

### 9.1 Anbefalet løsning (tre lag, alle server-side)

```text
LAG 1 — IDEMPOTENS-NØGLE (mod dobbeltklik / browser- og netværks-retry)
  Klienten genererer idempotency_key (UUID) pr. BRUGER-HENSIGT (ikke pr. forsøg)
  Server: INSERT generation (user_id, idempotency_key) med
          UNIQUE (user_id, idempotency_key)
  → andet kald med samme nøgle returnerer EKSEISTERENDE generation_id
    (og dennes status) — INGEN ny provider-kald.

LAG 2 — GENERATION-ID som eneste reference (mod replay/paralleler)
  Klienten kender KUN generation_id (aldrig tokens — §10).
  Status = GET /api/ai/generations/{id} (kun egne, JWT).
  Unikke constraints pr. semantic:
    · UNIQUE (user_id, operation, item_id, active) for preview/clothing
      (bevirker at ét item kun har én aktiv generering)
    · reserverings-lås pr. (user_id, operation) som i dag — men kun
      server-til-server (§10)

LAG 3 — REQUEST-FINGERPRINT (mod systematiske dubletter uden nøgle)
  Fingerprint = hash(user_id, operation, input_artifact_hash)
  → gentagen identisk forespørgsel inden for et vindue [DECISION, f.eks. 10 min]
    returnerer forrige generation i stedet for et nyt kald.
```

### 9.2 Hvorfor netop dette

- **`idempotency_key` er den eneste sikre måde** at gøre en HTTP-retry
  harmløs på: uden den er "tjek-lås-udfør"-sekvenser uundgåeligt sårbare over
  for klientsider der sender to gange (auditets §12: tre konkrete dublet-veje).
- **Kun `generation_id` til klienten** fjerner både replay-muligheder og den
  token-lækage, auditet fandt (§10).
- **Semantiske unikke constraints er sidste forsvar:** selv en bugged
  idempotens-logik kan ikke skabe to aktive genereringer for ét item, hvis
  databasen nægter det (**DB er sidste autoritet, ikke koden**).

**Supplerende:** serveren skal behandle **klient-abort** som irrelevant —
generationen kører uafhængigt til sit logiske slutpunkt (som i dag med
baggrundsfunktioner [CODE]), så abort ≠ refund ≠ gratis retry.

---

## 10. Reservation Token Security

### 10.1 Svaret på hvert spørgsmål

| Spørgsmål | Anbefaling | Begrundelse (auditets fund) |
|---|---|---|
| Må reservations-tokens **nogen sinde** eksponeres for klienter? | **NEJ — aldrig.** | I dag returneres `reservationStartedAt` i 202-svaret (`process-clothing.ts:527`) og finish-RPC'en er `grant … to authenticated` (`0008:114`) ⇒ brugeren kan rydde sin egen lås ⇒ ubegrænsede samtidige jobs |
| Skal finalisering kun ske server-til-server? | **JA.** Kun service-rollen/RPC'er med service-rolle-kontrol (mønstret findes allerede i `finish_*_server` [SQL `0011`/`0016`]) | de eksisterende `finish_ai_generation`/`finish_clothing_ai_generation`-grants til `authenticated` **fjernes** (de er overflødige, når jobbet altid finaliserer selv) |
| Skal klienten kun have et generation-ID? | **JA — det eneste, den får:** `generation_id` + `status` + estimeret fremdrift | fjerner replay, token-lækage og `user_id`-manipulation på én gang |
| Skal serveren finde reservationen via auth-bruger + generation-ID? | **JA — nøjagtig denne kobling:** `WHERE id = $1 AND user_id = auth.uid() AND in_progress` | token erstattes af **identitet**: den, der ejer reservationen, er den, der kan spørge — men **kun** om status, aldrig om at afslutte |
| Hvordan ryddes forladte generationer? | **Sweeper-job** (planlagt, service-rolle): se 10.3 | den nuværende 5-min stale-lås [SQL] rydder låsen, men **mister omkostningssporingen** — det må fremtidens sweeper ikke |

### 10.2 Den fremtidige sikre kontrakt

```text
Klient                          Server (eneste sted med logik)
  │  POST /api/ai/generations        │
  │   { operation, idempotency_key,  │
  │     itemId? }                    │   ← INGEN user_id, INGEN pris,
  │ ───────────────────────────────► │     INGEN provider, INGEN token
  │                                  │   authenticate → entitlement
  │                                  │   → budget → breaker → reserve
  │  { generation_id, status }       │   opret generation (atomisk)
  │ ◄─────────────────────────────── │
  │  GET /api/ai/generations/{id}    │   (poll — kun egne rækker,
  │ ───────────────────────────────► │    RLS + eq(user_id))
  │  { status, artifact? }           │
  │                                  │   jobbet: provider-kald →
  │                                  │   finalize (kun service-rolle)
```

- **Ingen finish-endpoint findes overhovedet** — finalisering er en
  **internt** operation inde i jobbet (som allerede i dag [CODE]).
- Client-RPC'erne `finish_ai_generation`, `finish_clothing_ai_generation`
  og `reserve_*`-grants til `authenticated` **fjernes** ved implementeringen;
  fremtidige reserver er kun mulige fra serverens egne klienter.

### 10.3 Oprydning af forladte generationer (sweeper)

```text
Planlagt job (service-rolle, eksisterende Netlify-mønster):
  • reserved/processing ældre end X min (f.eks. > jobbegrænsning + margin)
        → lifecycle_state = unknown      (ALDRIG bare "udløbet")
        → cost_state bevares (reserved → muligvis incurred, §12)
        → entitets-lås frigives EFTER at cost_state er sat
  • unknown ældre end Y dage → tving afstemning (§12/§15)
  • afviste/seneste-generation-pr.-item renter
```

**Kritisk forskel fra nutiden:** nutidens stale-lås [SQL `0015:51-56`] gør
låsen gratis at miste; fremtidens sweeper **må aldrig kunne nulstille
`cost_state`** — ellers genopstår auditets §5D-lukning i ny form.

---

## 11. Failed Generations — adfærd pr. fejltype

| Fejltype | Entitlement (A) | DRESSED kost-regnskab (B) | Retry-adfærd | Nyt provider-kald ved retry? | Bliver `unknown`? |
|---|---|---|---|---|---|
| **Provider afviser request** (auth/rate-limit *før* arbejde) | frigives (`RESTORED`) | `released` (ingen afsendelse ⇒ ingen risiko) | tilladt med det samme (tæller stadig som *forsøg*) | ja (nyt kald, nyt budget-lås) | nej |
| **Moderation afviser** | frigives | `released` — **kun hvis moderering dokumenteres som gratis [OPENAI-VERIFY]**, ellers `incurred` | tilladt, men tæller som forsøg | ja | nej |
| **Provider API-fejl (5xx/timeout)** | frigives **kun** efter forsøgsloft er overholdt | `unknown` (kan være faktureret) eller `incurred` — **aldrig automatisk `released`** | pause via fejl-cooldown (§7-5) | ja — men gennem budgettet | **ofte ja** |
| **Ugyldigt billede (signatur/mål/base64)** | `RESTORED` | **`incurred`** (provideren returnerede et billede ⇒ sandsynligt betalt) | tæller forsøg; efter loft: pause | ja (men hver retry koster budget) | nej |
| **Moderationsfejl (netværk)** | frigives | `unknown` | pause kort | ja | ja |
| **Storage-fejl efter generering** | `RESTORED` | **`incurred`** | **først: storage-only retry uden nyt provider-kald (§18)** — først derefter (ved udløb) ny generering som nyt forsøg | **NEJ i første omgang** | nej |
| **Database-fejl efter generering** | `RESTORED` | `incurred` | samme som ovenfor: artifact bevarres midlertidigt ⇒ DB-commit kan gentages | **NEJ** | nej |
| **Klient-forbindelse brydes** | irrelevant — generationen kører videre (server-uafhængig, som i dag [CODE]) | afregnes efter jobbets udfald | klient poll'er `generation_id` | nej (samme generation) | nej |
| **Ukendt provider-udfald** | `RESTORED` (brugeren fik intet) | **`unknown`** — reservationen **beholdes** | **midlertidig blokering** af samme operation for brugeren indtil afstemning (§12) | kun efter afstemning | **JA — definerende tilfælde** |

**Den regel, der skal forhindre auditets fund:**

> *`RESTORED` betyder alene, at brugeren fik sin ret tilbage. Så snart
> `provider_success` er registreret, er `cost_state` **incurred** (eller
> **unknown**), og **ingen** efterfølgende handling — retry, fejl, fejl i
> fejlhåndteringen — må kunne sætte den tilbage til `released`.*

Den eneste vej tilbage til `released` er **afstemning mod providerens
faktiske forbrugsdata** (§15), ikke en software-gætning.

---

## 12. Unknown Billing Outcome

### 12.1 Hvorfor denne state er den vigtigste i hele arkitekturen

Auditet kunne **ikke bevise** OpenAI's faktureringsregler for fejlede
requests, timeouts og kasserede billeder (**UNKNOWN — REQUIRES EXTERNAL
VERIFICATION**, audit §11). Ethvert system, der **gætter** ("fejl ⇒ gratis"),
kan derfor **systematisk** underrapportere omkostninger. `unknown`-tilstanden
er den strukturelle erkendelse af, at *vi ikke ved*.

### 12.2 Hvad `unknown` skal gøre

| Spørgsmål | Anbefaling | Begrundelse |
|---|---|---|
| Skal den **midlertidigt blokere retry?** | **JA** — samme operation for samme bruger sættes på pause (via fejl-cooldown) indtil afstemning eller manuel frigivelse | ellers kan et ukendt antal "ukendte" requests akkumulere |
| Skal den **forbruge en kost-reservation?** | **JA — reservationen fastholdes** (den må **ikke** frigives) | den er den bedste tilgængelige sandhed for "måske betalt" |
| Skal den **kræve afstemning?** | **JA** — `unknown` er en **midlertidig** tilstand med deadline (f.eks. 7 dage [DECISION]); efter deadline tvinges en status (`incurred` = forsigtigheds-princippet) | systemet må ikke have `unknown`-rækker for evigt |
| Skal den **markeres som potentielt faktureret?** | **JA** — eksplicit `potentially_billed = true` + tæller i telemetri | gør usikkerheden **synlig**, ikke skjult |
| Skal den **udløse telemetri?** | **JA** — straks-advarsel ved spring i `unknown`-rate (kan indikere provider-problem eller fejl-loop) | tidlig varsling er gratis beskyttelse |
| Kan den **endelig løses via providerens forbrugsdata?** | **JA — det er den eneste reelle løsning:** afstemning mod providerens usage-API/dashboard (§15) ⇒ `cost_state = reconciled` med faktisk beløb (eller `released` hvis bevis for ikke-faktureret) | software må aldrig selv omgøre `unknown` til `released` |

### 12.3 Definition (skal implementeres bogstaveligt)

```text
unknown  =  "Vi kan ikke fastslå, om provideren fuldførte/fakturerede
             requesten."
  · sættes: timeout EFTER afsendelse · forbindelsesbrud EFTER afsendelse ·
            uklar 5xx · crash mellem afsendelse og svarregistrering ·
            sweeper der finder en 'processing'-række efter deadline
  · må ALDRIG sættes tilbage til 'released' af kode — kun af afstemning
  · reservationen står: cost_state = unknown (beholdt)
  · entitetslås: frigives (brugeren skal kunne komme videre), men med
    forsøgs-tæller + cooldown (§7)
```

---

## 13. Global AI Circuit Breaker

### 13.1 Den fremtidige tilstandsmodel

```text
        ┌──────────── NORMAL ────────────┐
        │ overvåger: estimeret forbrug   │
        │ i dag, i måned, pr. minut      │
        ▼ (≥ 50 % af dagsgrænse)        │
      WARNING ── advarsel-log + dashboard-notits
        ▼ (≥ 80 %)                      │
      SAFETY   ── kun kritiske operationer [DECISION: hvilke]
        ▼ (≥ 100 %, eller manuel stop,  │
           eller anomali-detektion)      │
      PAUSE ─── ALLE AI-kald afvises med
                503 "AI is temporarily paused."
        └── nulstilling: automatisk ved dagsskift [DECISION]
            eller manuel genoptagelse (service-rolle)
```

### 13.2 Hvad analysen skal afgøre

| Emne | Analyse | Anbefaling |
|---|---|---|
| **Dagsgrænse** | udregnes som: *ventet maks-forbrug pr. dag + margin*, **ikke** et hårdkodet tal | konfiguration i `ai_budget_policies` **[DECISION]** |
| **Månedlig grænse** | beskytter mod "langsomt dræn" (dagligt under grænsen, månedligt over) | **nødvendig** — to grænser, begge |
| **Estimeret vs. faktisk** | breakeren kører på **estimater** (livstids sandhed, §17); afstemning (§15) retter estimaterne bagud | breakeren må aldrig vente på faktiske tal |
| **Provider-fejl (spike)** | høj `unknown`-rate eller 5xx-rate ⇒ midlertidig pause (beskytter mod fejl-loop der brænder budget af) | **nødvendig** — anden trigger |
| **Anomali-detektion** | requests pr. minut over N × normal [DECISION] ⇒ pause | anbefalet (fanger misbrug *før* dagsgrænsen) |
| **Misbrugsdetektion** | samlet: én konto over konto-grænser ⇒ lås; mange konti samtidig ⇒ global pause | lagdelt (§7 + denne) |
| **Manuel nødstop** | 1) miljø-flag/`kill-switch`-env der afviser alt nyt, 2) service-rolle der sætter breakeren på PAUSE | **nødvendig** — den eneste, der virker, selvom selve koden er i stykker |

### 13.3 Hvor den skal sidde

```text
Tilføjelsessted 1 (det vigtigste): inde i openai-images.ts requestOpenAI()
    → sidste udvej: INGEN kodevej når OpenAI uden at passere breakeren
Tilføjelsessted 2: pipeline før 'reserve' (giver bedre fejlmeddelelse,
    spilder ikke reservationer)
Begge skal læse SAMME atomiske global-tæller-state (DB eller in-memory
    med DB-copies) — [DECISION] præcis mekanisme; DB er den sikre.
```

**Mål:** *selv ved en alvorlig fejl skal DRESSED have en økonomisk
nødbremse.* Derfor er breakeren **det eneste lag der må antages at virke,
selvom alle andre fejler** — den skal være **enkel nok til at kunne læses og
styres manuelt** (ingen kompleks ML-tilstand).

---

## 14. AI Cost Telemetry

### 14.1 Felter pr. AI-operation — vurderet for nødvendighed

Én `ai_generation`-række (fortsættelse af §5) + tilhørende omkostningsfelter:

| Felt | Nødvendigt? | Hvorfor / GDPR-notat |
|---|---|---|
| `generation_id` | **JA** | primær nøgle, delbar med klient |
| `user_id` | **JA** | nødvendigt for konto-grænser, isolation, RLS — persondata, der **kun** bruges til dette |
| `operation` | **JA** | analyse pr. type |
| `provider` + `model` | **JA** | multi-provider (§16), pris-afstemning (§17) |
| `request_timestamp` / `reservation_timestamp` / `completed_timestamp` | **JA** | latens, dag-tælling, sweeper-deadlines |
| `success/failure` + `error_category` (moderation/api/validation/storage/db/unknown) | **JA** | fejl-rate → breakeren (§13) |
| `provider_request_id` | **JA** | **grundlaget for afstemning** (§12/§15) — påkrævet, hvis udbyderen tilbyder det |
| `estimated_cost` (ved reservation) | **JA** | budgetregnskabet |
| `actual_cost` (hvis kendt) | **JA** (nullable) | afstemt beløb |
| `currency` + `fx_rate_used`/`fx_rate_as_of` | **JA** | USD→DKK-sporet (§17) |
| `image_size` + `quality` | **JA** | pris-varians (audit: $0,064 er et blandet gennemsnit) |
| `entitlement_consumed` / `entitlement_restored` | **JA** | §3A-regnskabet |
| `quota_consumed`/`quota_refunded` (dagens begreber) | **overflødigt** når §5 indføres | erstattes af `entitlement_state` |
| `storage_result` (ok/failed/path-class) | **JA** | §18-korrelationen |
| `lifecycle_state` + `cost_state` | **JA** | kernen |
| `potentially_billed` | **JA** | §12 |
| **Prompt-tekst** | **NEJ — gemmes IKKE** | kan indeholde brugerens varenavne/labels ⇒ dataminimering; log kun `prompt_template_version` (hvis nødvendigt) |
| **Billedeindhold / base64 / input-filer** | **NEJ** | aldrig i telemetri |
| **E-mail/navn/køn** | **NEJ** | `user_id` er nok (§20) |
| **IP / user-agent** | **NEJ** | ikke nødvendigt for omkostning; undgås bevidst (jf. cooldown-analysens §6) |

**GDPR-notat:** `user_id` + tidsstempler er persondata — men de er
**nødvendige** for at beskytte ejeren (formålsbegrænsning: kun omkostnings-
styring, isolation og drift). Anbefaling: bevare i den varme periode,
**anonymisér** `user_id` efter en fastholdelsesperiode **[DECISION/juridisk]**
mens beløb/operationer beholdes til regnskab.

---

## 15. Global Cost Accounting

### 15.1 Hvordan de fem spørgsmål besvares

```text
AI cost today        = SUM(actual_cost ellers estimated_cost)
                         over generations med completed_timestamp = i dag
AI cost this month   = samme over måneden
AI cost per operation/operation/type/model = GROUP BY på de felter
AI cost per account  = GROUP BY user_id  (kun i systemet — aldrig i exports)
```

### 15.2 Database vs. provider-dashboard vs. afstemning — valget er HYBRID

| Kilde | Rolle | Styrke | Svaghed |
|---|---|---|---|
| **Database (telemetri)** | **primær, realtid** — driver budget, konto-grænser og circuit breaker | med det samme, per operation, estimeret | kun estimater; kan være forkert ved prisændring/fejl |
| **Provider-dashboard/-API** | **sandhed for penge** — forbrug målt hos udbyderen | faktiske beløb | forsinket; ikke pr. DRESSED-operation; kræver adgang/verifikation |
| **Planlagt afstemning (reconciliation-job)** | **broen:** dagligt match på `provider_request_id`/dato ⇒ opdater `actual_cost`, løs `unknown`, ret `estimated_cost`-afvigelse | lukker usikkerheden systematisk | afhænger af at udbyderen stiller data til rådighed **[VERIFY]** |

**Anbefaling: HYBRID** — databasen styrer *hårdheden* (kan vi køre?),
afstemningen styrer *sandheden* (hvad kostede det?).
Uden afstemning er al statistik (§15.1) **estimater og skal mærkes sådan**
(f.eks. `cost_basis = estimated | reconciled` pr. række).

**Det faste spørgsmål for ejeren** ("hvad har jeg brugt denne måned?") skal
derfor kunne svares **to gange**: *estimat fra systemet* og *revideret tal
efter afstemning* — de må ikke blandes i samme tal uden mærkat.

---

## 16. Future Multi-Provider Support

```text
                 DRESSED AI-lag (pipeline, §4)
                          │
        ┌─────────────────┼─────────────────┐
        │   PROVIDER-ABSTRAKTION (grænseflade) │
        │   · estimate(operation, model, …)    │
        │   · moderate(image)                  │
        │   · generate(images, prompt, …)      │
        │   · parseOutcome(response) →         │
        │     {state, provider_request_id,     │
        │      actual_cost?}                   │
        └───────┬─────────┬──────────┬────────┘
             OpenAI   Provider B  Provider C
```

### 16.1 Hvad der skal være PROVIDER-UAFHÆNGIGT

| Element | Hvorfor |
|---|---|
| `generation_id` | identitet på tværs af udbydre (afstemning, support) |
| `operation` | produktbegrebet ("clothing") er ikke udbyderens |
| **Entitlement** (§3A) | brugerens pakke er DRESSED's — aldrig udbyderens |
| **Cost reservation** (§6) | budgettet måles i DRESSED-øjemed, ikke i udbyder-valuta |
| **State machine** (§5) | `provider_success/unknown/…` er fælles sprog; `unknown` er endnu vigtigere ved flere udbydre |
| **Telemetri** (§14) | ét sæt spørgsmål, mange udbydre |
| **Idempotens + tokensikkerhed** (§9/§10) | sikkerhed må aldrig afhænge af udbyderen |
| **Circuit breaker** (§13) | penge er penge — den tæller på tværs |

### 16.2 Hvad der skal være PROVIDER-SPECIFIKT

| Element | Notat |
|---|---|
| API-request (URL, headers, payload) | inde i abstraktionen |
| Modelnavn (`gpt-image-2.5-sunburst` i dag) | **aldrig** hårdkodet uden for registret/pris-tabellen |
| Faktureringsrespons / usage-ID | `provider_request_id`-formen varierer — abstraktionen normaliserer til ét felt |
| Provider-fejlklassifikation | mappes til fælles `error_category` (f.eks. rate-limit ⇒ `api`) |
| Enhedspriser (USD) | pris-tabel pr. provider (§17) |
| Moderering | nogle udbydere har det indbygget — abstraktionen udfører det kun, hvis operationen kræver det |

### 16.3 Vurdering

**Anbefaling: abstraktionen skal indføres som et TYNDT lag, ikke som et
stort framework** — kun de fem metoder ovenfor. DRESSED bør **ikke**
bygge et provider-udskiftnings-middleware før et andet faktisk behov findes
(**[DECISION]**: enkelt-provider i første fase, men **kontrakterne** fra
tabellen sættes fra begyndelsen, så udskiftningen senere er en tilføjelse,
ikke en omskrivning). Dette lever op til "ingen unødvendige
dependencies/servicer" (prisanalysens del 19).

---

## 17. AI Price Changes

### 17.1 Hovedreglen

> **Forretningsantagelser om pris må aldrig hardkodes i logikken.**
> Nutidens $0,064/request [TELEMETRY] er et **momentbillede**, ikke en lov.

### 17.2 Versioneret pris-tabel (koncept)

```text
ai_model_prices
  provider, model, operation? (valgfri præcision),
  size, quality,
  unit            (per_image | per_mtok)
  price_per_unit  (i provider-valuta — USD)
  valid_from, valid_until
  safety_multiplier   (f.eks. 1.5 ⇒ estimat = pris × 1.5)
  source, notes        (hvorfra prisen stammer — dashboard/dokumentation)
  created_at
  ── aktive rækker vælges af: WHERE now() BETWEEN valid_from AND valid_until
  ── ingen aktiv række ⇒ FAIL-SAFE (se nedenfor)
```

### 17.3 Hvordan systemet fejler sikkert ved stale/ukendt priser

| Situation | Adfærd | Konsekvens |
|---|---|---|
| Ingen aktiv pris-række for operation/model | **FAIL-SAFE: afvis operationen** (503 "AI is temporarily unavailable") | mere sikker end at køre gratis; **aldrig** "gæt en pris" |
| Pris-række ældre end X dage [DECISION] | driftsadvarsel + benyt med **forhøjet** safety_multiplier | estimeringen bliver kun dyrere, aldrig billigere |
| Afstemning viser systematisk afvigelse (estimat ≪ faktisk) | automatisk forslag/opdatering af rækken (via ny `valid_from`-linje — **aldrig** rediger historik) | lukker loopet tilbage til §15 |
| Valutakurs | gemt pr. reservation (`fx_rate_used`); opdateres pr. planlagt job **[DECISION om kilde]** | USD-priser + lokal afrunding opad |
| Prisændring hos udbyderen midt i en reservation | reservationen fastholder sit estimat; afstemningen retter | intet tab af sporbarhed |
| Prisstigning (+50/+100 %, jf. pricing-analysen §6) | rammer **automatisk** budgettet og breakeren gennem tabellen | ingen kodeændring nødvendig |

**Testkrav (til fremtidig implementering):** *en migration er ikke færdig,
før der findes ≥1 aktiv pris-række pr. operation* — ellers stopper systemet
sikkert, men ubrugeligt. Det er den ønskede fejlretning.

---

## 18. Storage Failure Scenario (kritisk — analyse af den præcise sekvens)

```text
Bruger beder om beklædnings-generation
↓ entitets-tjek godkendt (entitlement_state = consumed)
↓ kost-reservation låst (cost_state = reserved, beløb = estimat)
↓ AI-request sendt → OpenAI genererer VELLYKKET
↓ DRESSED modtager billedet      ← herfra er cost_state = incurred
↓ Supabase Storage-upload FEJLER
↓ DRESSED viser "generation failed"
```

### 18.1 De syv spørgsmål — svar

| Spørgsmål | Svar | Begrundelse |
|---|---|---|
| **Genoprettes brugerens entitet?** | **JA** — `entitlement_state → RESTORED` (brugeren fik intet) | retfærdigt over for brugeren; men se næste linje |
| **Betraktes AI-omkostningen som muligvis brugt?** | **JA — `cost_state = incurred`** (ikke `released`, ikke `unknown` — vi **ved**, at genereringen skete, fordi billedet blev modtaget) | kernen i §5.2-invarianten |
| **Må brugeren straks prøve igen?** | **Ja, men ikke gratis:** ny generering kræver et **nyt budget-lås** og tæller som nyt *forsøg* (§7-4) indtil loftet — derefter cooldown | forhindrer auditets §5D "gratis retry-loop" |
| **Skal retry kræve en ny entitet?** | **Nej** — entiteten er allerede `RESTORED`; men den tæller som **forsøg** i entitets-regnskabet | adskiller "ret" fra "penge" (§3) |
| **Kan det fejlslagne asset genoprettes?** | **JA — se 18.2** | |
| **Kan DRESSED retry storage-upload'et UDEN at kalde OpenAI igen?** | **JA — og det SKAL den:** artifactet fastholdes midlertidigt ved `provider_success` **før** upload (18.2) | den eneste måde at undgå at betale to gange |
| **Hvordan undgår vi at betale to gange for samme generering?** | **Tre mekanismer:** (1) artifact-bevaring + storage-only retry; (2) samme `generation_id` må aldrig få et nyt provider-kald; (3) idempotens (§9) | |

### 18.2 Den anbefalede redningsrækkefølge

```text
provider_success
  ① GEM artifact MIDLERTIDIGT FØRST (f.eks. {uid}/tmp/{generation_id}
     med TTL — placering er [DECISION]; aldrig globalt læsbart)
  ② registrér lifecycle=provider_success + cost_state=incurred
     + provider_request_id
  ③ forsøg egentlig storage-commit (model-images/{uid}/…)
      ├─ OK  → completed; ryd midlertidig fil
      └─ FEJL → lifecycle=storage_failed; artifactet BEVARES (TTL)

RETRY-VEJ 1 (at foretrække — INGEN ny OpenAI-kald):
  samme generation_id → genkør KUN trin ③ fra det bevarede artifact
  (upload-only; tæller IKKE som nyt forsøg, kun som teknisk retry)
  → betaler aldrig for det samme billede to gange

RETRY-VEJ 2 (kun hvis artifactet er udløbet):
  ny generering = NY generation_id, NYT budget-lås, NYT forsøg
  (her betales der reelt — derfor er TTL + begrænset antal veje vigtige)
```

**Alternativt (mindre lager, mere risiko):** behold artifactet kun i
hukommelsen — jobbet dør ved fejl ⇒ muligheden for storage-retry forsvinder
⇒ Vej 2 hver gang. **Anbefaling: ① (midlertidig fastholdelse med TTL)** —
omkostningen ved midlertidigt lager er **langt mindre** end at betale OpenAI
to gange (jf. pricing-analysens kerneprincip).

**Konkret svar til brugeren med denne model:**
- Fejl **kun i storage:** brugeren kan gentage **genindsættelsen** (knappen
  "Prøv lagring igen") — **gratis for både bruger og ejer**.
- Artefakt udløbet: helt normal ny generering (forsøg + budget).

---

## 19. AI Result Caching / Reuse

| Metode | Scope | GDPR | Omkostningseffekt | Anbefaling |
|---|---|---|---|---|
| **Ekstakt SHA-256 af input** | **pr. bruger** (default) | lav (kun sammenlignet inden for samme `user_id`) | dublet-upload ⇒ 0 nye kald | **JA — fra begyndelsen** |
| **Generation-fingerprint** (`hash(user_id, operation, input_hash, prompt_version)`) | pr. bruger | som ovenfor | gentagen handling ⇒ genbrug inden for et vindue **[DECISION]** | **JA** |
| **Same-user reuse** af eksisterende `completed`-generation | pr. bruger | **ingen ny persondata** | den største sikre gevinst | **JA — anbefales** |
| **Clean-preview caching** (eksisterende `preview_path` flyttes ind i `generation`-modellen) | pr. item | som i dag | allerede delvist [CODE] | **JA — formelisér** |
| **Clothing-generation caching** (`generation_version`-træf [CODE]) | pr. item + version | ingen ny | allerede der | **JA — bevares** |
| **pHash (lignende input)** | **kun inden for én bruger** | ⚠ tværs af brugere ville udlede signaler mellem konti ⇒ **kræver juridisk vurdering** | moderat | same-user kun **[DECISION/juridisk]** |
| **Globalt delbart DRESSED-asset** (basisformer, systemgrafik) | **globalt** | kun hvis asset'et **ikke** kan identificere nogen (basisformer er allerede globale [CODE]) | stor (delt omkostning) | **KUN** for åbenlyst ikke-personlige, globale-fra-start assets |

**De to klasser holdes adskilt:**
- **Bruger-ejet data** (foto, figur, garderobe, person-visende resultater):
  **aldrig** cache-delt på tværs af brugere, **aldrig** global, slettes ved
  konto-sletning — **uden undtagelse**.
- **Globale DRESSED-assets:** **aldrig** `user_id`, **aldrig** slettet ved
  bruger-sletning, **aldrig** serveret fra `{uid}/`-stier.

**Reglen for tværgående reuse:** *kun når asset'et er skabt som globalt fra
begyndelsen og ikke kan identificere en person — aldrig som en senere
optimering af en privat fil.* Alt andet kræver juridisk vurdering
(**[DECISION/juridisk]**).

---

## 20. Security — alle trust boundaries

| # | Grænse | Hvad klienten MÅ | Hvad klienten MÅ IKKE | Håndhævelse |
|---|---|---|---|---|
| 1 | **Klient → API** | anmode om en generation med `{operation, idempotency_key}`, spørge om status med `generation_id` | bestemme `user_id`, pris, provider, model, budget, kvote-sluttilstand, reservation/completion | JWT (`authenticateSupabaseRequest`) + server-validering af alle felter |
| 2 | **API → Database** | læse/skrive via faste server-queries | skrive til budget-, pris- eller tilstandsfelter direkte | **RLS slået til uden policyer** på alle nye AI-tabeller (service-rolle kun) — samme mønster som anbefalet i cooldown-analysen §9 |
| 3 | **API → Provider** | server sender med server-nøgle | **nøglen aldrig i browser/bundle** (bevist i dag: 0 references i `.astro`) [CODE] | miljøvariabler kun i funktioner |
| 4 | **Klient → Reservation/completion** | **intet** | kalde finish/reserve-RPC'er | grants til `authenticated` fjernes (§10); kun `generation_id`-status-læsning |
| 5 | **Pris-sætning** | læse evt. estimeret fremdrift | påvirke `ai_model_prices`, safety_multiplier, FX | server-konfiguration, ingen write-grants |
| 6 | **Provider-valg** | intet | vælge/model-udskifte | operation-registret er server-side |
| 7 | **Service-rolle** | aldrig | nås fra klienten | kun server-funktioner (bevist i dag [CODE]) |
| 8 | **Generering på tværs af brugere** | kun **egne** `generation_id`-rækker | læse andres status/artifacts | RLS + `eq(user_id)` + `{uid}/`-stier (ufortyndet fra den eksisterende isolationsmodel) |
| 9 | **Telemetri/budget-læsning** | aldrig direkte | hente eller ændre konti-grænser | kun server-læsning; ejer-dashboard er senere **[DECISION]** |
| 10 | **Breakeren** | kun modtage 503 | nulstille/sætte PAUSE | manuel nødstop via service-rolle/env (aldrig HTTP fra klienten) |

**Uændret fundament (fra den eksisterende audit):** `auth.uid()`-RLS,
private buckets + `{userId}/`-stier, signerede URLs, `no-store` på API-svar,
session udelukkende fra verificeret JWT. Den nye arkitektur **tilføjer**
beskyttelse oven i — den erstatter intet.

---

## 21. Abuse Model

| Forsøg | Hvem | Hvem stopper det | Hvor |
|---|---|---|---|
| **Hurtige, gentagne genereringer** | ondsindet/uskadelig | konto-døgn-loft + DKK-loft + fejl-cooldown (§7) | pipeline før reserve |
| **Parallelle requests (10 faneblade)** | ondsindet | idempotens-nøgle + entitets-lås + **unikt constraint** i DB (§9) + budget-lås (låst først) | §9/§6 |
| **Gentagne uploads** | ondsindet | upload-loft + preview-kvote + SHA-256-dublet-cache (§8/§19) | entitet + cache |
| **Dublet-billeder (kopieret fil)** | ondsindet | ekstakt hash ⇒ 0 nye kald; ellers tæller som normal preview (§8) | cache |
| **Reservation replay** (gentag et gammelt kald) | ondsindet | **intet reservation-token eksisterer** — kun `generation_id` + idempotens (§10) | §10 |
| **Generation-ID replay (andres ID)** | ondsindet | JWT + `eq(user_id)` + RLS ⇒ 404 (som den eksisterende isolation) | §20-8 |
| **Udløbet generation replay** | ondsindet | sweeper sat `unknown/afsluttet`; en afsluttet generation kan ikke genkøres — nyt kald = nyt id + nyt budget | §10.3 |
| **Kvote-race (to samtidige reserves)** | ondsindet | `FOR UPDATE`-atomik (findes i dag [SQL]) + budget-reservation der låses i samme transaktion | §6/§9 |
| **Opdagelse af endpoints** (fuzzer `/api/ai/*`) | ondsindet | **kun** registrets operationer eksisterer; ukendt operation ⇒ 400 (fail-closed); orphante endpoints fjernes (§23-fase) | §4.2 |
| **Direkte kald uden frontend** | ondsindet | server-valideringen er den eneste autoritet — frontend-kontrol er aldrig sikkerhed (audit §8: frontend er UX, server er regel) | §4/§20 |
| **Omgå frontend-knapper** | ondsindet | samme — **alt gentages server-side**: entitet, budget, breaker, idempotens | §4 |
| **Mange små konti (spray)** | ondsindet | globalt dags-/månedsloft + anomali-detektion (§13) + (fremtidig) betalings-cooldown **[OUT OF SCOPE her, §24]** | §13 |
| **Fejl-loop som angreb** (tving systemet til at fejle gentagne gange) | utilsigtet/ondsin­det | forsøgsloft + fejl-cooldown + `unknown`-pause + fejl-rate-trigger i breakeren (§13-2) | §7/§12/§13 |

**Mønsteret:** *hvert enkelt angreb rammer mindst ét lag, og de fleste rammer
flere* — se §27 for, hvad der sker, når lag fejler.

---

## 22. Recommended Future Architecture

```text
┌────────────────────────── CLIENT ───────────────────────────┐
│ MÅ:  POST /api/ai/generations {operation, idempotency_key}  │
│      GET  /api/ai/generations/{id}  (status/artifact)       │
│ MÅ IKKE: user_id · pris · provider · token · completion     │
└───────────────────────────┬──────────────────────────────────┘
                            │ JWT
┌───────────────────────────▼───────────────── API (Astro routes) ┐
│ ① authenticateSupabaseRequest (findes)                          │
│ ② operations-registret: validér operation (fail-closed)         │
│ ③ ENTITLEMENT (A): resterende rettigheder + forsøgstæller      │
│ ④ COST PROTECTION (B1): konto-budget + fejl-cooldown + lock     │
│ ⑤ BREAKER (B2): global dags-/måneds-/anomali-tilstand           │
│ ⑥ idempotens-opslag → RETURNÉR eksisterende generation_id      │
│ ⑦ RESERVER: budget.reserved += pris-tabel-estimat × 1,5 (atomisk)│
│ ⑧ opret generation-række: requested→reserved                   │
│ ⑨ launch job (server-til-server, som i dag)                    │
└───────────────┬────────────────────────────────┬───────────────┘
                │                                │
┌───────────────▼──────────────┐  ┌──────────────▼───────────────┐
│ DATABASE (Supabase)          │  │ AI PROVIDER-LAG              │
│ ai_entitlements (A)          │  │ (openai-images.ts = eneste   │
│ ai_budgets (B1) + breaker    │  │  chokepoint — BREAKER sidder │
│ ai_model_prices (§17)        │  │  også her som sidste udvej)  │
│ ai_generations:              │  │ → moderate / images.edits    │
│  lifecycle_state (§5)        │  │ ← {billede, request_id}      │
│  entitlement_state (§5)      │  └──────────────┬───────────────┘
│  cost_state (§5) + beløb     │                 │
│  idempotency_key UNIQUE      │  ┌──────────────▼───────────────┐
│  RLS: slået til, 0 policyer  │  │ STORAGE                       │
└───────────────┬──────────────┘  │ ① midlertidig {uid}/tmp (TTL)│
                │                 │ ② commit {uid}/…              │
                │                 │ fejl → storage_failed + §18   │
                │                 └──────────────┬───────────────┘
┌───────────────▼────────────────────────────────▼───────────────┐
│ ACCOUNTING (telemetri §14)              SAFETY (§13)           │
│ ai_generation-rækker → dag/måned/pr.    NORMAL→WARNING→SAFETY  │
│ operation/pr. konto/pr. model           →PAUSE · manuel kill-  │
│ afstemnings-job mod provider (§15)      switch · fejl-rate-trig │
└────────────────────────────────────────────────────────────────┘
```

**Syv lag, ét mål:** 22.1 **Klienten** beder kun om *lov* og *status*.
22.2 **API'en** validerer alt og sidder foran pengepungen. 22.3
**Databasen** er den eneste sandhed (tilstand + begge regnskaber + unikke
constraints). 22.4 **Provider-laget** er ét chokepoint med breaker.
22.5 **Storage** tager imod i to trin (midlertidig ⇒ commit) så fejl kan
repareres uden ny betaling. 22.6 **Accounting** gør omkostninger synlige.
22.7 **Safety** er den sidste, enkle, manuelt styrbare nødbremse.

---

## 23. Implementation Phases (fremtidig ruteplan — intet implementeres nu)

| Fase | Indhold | Afhænger af | Lukker dette audit-fund |
|---|---|---|---|
| **A — Fælles generation-ID & tilstandsmodel** | `ai_generations`-tabel med de tre state-dimensioner (§5); alle stier skriver til den (stadig med eksisterende kvoter) | — | ulige regnskaber; usynlige fejl |
| **B — Sikker reservationslukning** | fjern client-grants på finish/reserve; stop med at returnere token; kun `generation_id` udad; server-til-server finalisering + sweeper (§10) | A | **token-lækage; manuel lås-rydning** |
| **C — Clean-preview-limite** | preview-kvote + upload-loft + SHA-256-dublet-cache + preview i registret (§8/§19) | A | **ubegrænset preview** |
| **D — Idempotens** | `idempotency_key` UNIQUE + semantiske constraints (§9) | A | dubletter/replay |
| **E — Kost-telemetri + konto-budget** | estimerede/aktuelle beløb pr. generation; døgn-/livstids-loft pr. konto; fejl-cooldown (§6/§7/§14) | A | **refund-loop; kvote ≠ omkostning** |
| **F — Global circuit breaker** | NORMAL/WARNING/SAFETY/PAUSE + manuel kill-switch i `requestOpenAI` (§13) | E | **ingen global nødbremse** |
| **G — Provider-afstemning** | usage-API/dashboard-match, løs `unknown`, revider estimater (§12/§15) | E | **ukendt billing; blinde estimater** |
| **H — Pris-tabel + provider-abstraktion** | versionerede priser, fail-safe ved staleness, tyndt provider-lag (§16/§17) | E, G | **hardcodede pris-antagelser** |
| **(I) — Fjernelse af orphante endpoints** | deaktiver `dress-model`/`try-on` eller læg dem bag registret | A–D | kaldbare stier uden moderering |
| **(J) — Fremtidig entitets-/betalingssystem** | kobler §3A på pakker | **[OUT OF SCOPE — §24]** | — |

**Rækkefølge-logik:** A er fundamentet (alt andet skriver til samme model);
B og C lukker de to **aktive** sårbarheder hurtigst; E–F er den økonomiske
kerne; G–H gør tallene sande. **Fase H kan udskydes — men E kan ikke**, fordi
uden telemetri/budget er F og G meningsløse.

---

## 24. Payment Must Remain Out of Scope

> **Betalingsimplementering er IKKE en del af dette projekt-fase.**

Denne arkitektur er **kun kompatibel med** et fremtidigt entitets-/betalingssystem
— den designer det ikke. Eksplikt **ikke** designet her:

- Stripe-integration · Apple IAP · Google Play Billing ·
  betalings-webhooks · checkout · abonnementer · refusioner

**Sådan holdes grænsen ren:**
- §3A *entitlement* er **et hul i form af en grænseflade**, ikke en
  betalingslogik: i dag leveret af konfiguration (`free_limit`-lignende værdier),
  i fremtiden af et betalingssystem **uden at arkitekturen ændres** — det er
  hele pointen med at holde A og B adskilt (§3).
- Ingen tabel i dette design har felter som `price_charged`, `payment_id`
  eller `subscription` — de hører til den selvstændige, senere analyse.
- Den **31-dages betalings-/konto-cooldown** (dokumenteret i
  `analysis/dressed-31-day-account-cooldown-analysis.md`) er ligeledes
  **uden for scope** og indgår kun som fremtidig afhængighed (§23-fase J).

---

## 25. Final Risk Matrix

| Area | Current Risk | Future Requirement | Priority |
|---|---|---|---|
| **Character generation** | **YELLOW** — refund ved fiasko + ubegrænset antal forsøg; moderering før reservation | tilstandsmodel med `cost_state`; forsøgsloft; moderering efter reservation; budget-lås (§5/§11) | HØJ |
| **Clothing generation** | **RED** — tælles kun ved succes + client-farlige finish-RPC'er + token i 202-svaret | fjern client-grants/token (fase B); forsøgsbaseret regnskab; budget (§10) | **KRITISK** |
| **Try-on** | **GREEN/YELLOW** — økonomisk bundet (limit 1, cache), men **orphant + ingen moderering** | lægges i registret med moderering; fjern/flag som orphant (fase I) | LAV–MELLEM |
| **Clean preview** | **RED** — **ubegrænset, ukvoteret** | preview-kvote + upload-loft + hash-cache + budget (fase C, §8) | **KRITISK** |
| **Quota system** | **YELLOW** — atomisk men tre ulige modeller, ingen forsøgsgrænser, ingen DKK-syn | samles i §5's to regnskaber; bevares som entitets-lag under budget (§3) | HØJ |
| **Reservation token** | **RED** — eksponeret; finish-RPC åben for `authenticated` | **aldrig eksponeret**; kun `generation_id`; server-til-server (fase B, §10) | **KRITISK** |
| **Failed generations** | **RED/YELLOW** — refund = gratis retry mod muligvis betalt kald | `RESTORED` ≠ `released`; forsøgsloft + cooldown; `unknown`-state (§11/§12) | **KRITISK** |
| **Storage failure** | **RED** — **HIGH ECONOMIC RISK** (audit §5D) | to-trins storage + artifact-fastholdelse + upload-only-retry (fase A+E, §18) | **KRITISK** |
| **Duplicate requests** | **YELLOW** — frontend er sikker; serveren har ingen idempotens | `idempotency_key` UNIQUE + semantiske constraints (fase D, §9) | HØJ |
| **Cost telemetry** | **RED** — **findes ikke** (ingen DKK-tæller overhovedet) | `ai_generations` med estimater/faktiske beløb + `cost_basis` (fase E, §14) | **KRITISK** |
| **Global circuit breaker** | **RED** — **findes ikke i repositoryet** (audit: 0 træffere) | NORMAL/WARNING/SAFETY/PAUSE + manuel kill-switch i chokepointet (fase F, §13) | **KRITISK** |
| **AI provider billing** | **UNKNOWN** — OpenAI's fejl-/timeout-regler ubekræftede (audit §11) | `unknown`-state + daglig afstemning + fail-safe priser (fase G+H, §12/§15/§17) | HØJ |
| **Fremtidig 3D** | **GREEN** — ingen 3D-AI-kald findes; 3D-fasen bruger ikke AI til rotation/rendering (3D-analysen) | **alt nyt AI tilføjes som én linje i registret** (§4.2) — 3D-assets gemmes som normal storage, ikke som generationer, medmindre AI genererer dem | LAV (nu) |

---

## 26. Final Decision Document

### MUST FIX BEFORE DRESSED CAN SAFELY ACCEPT PAYMENT

*Kun arkitekturmæssige krav — intet her er implementeret i denne fase.*

1. **Fælles generationsmodel med de tre adskilte regnskaber** (§5):
   `lifecycle_state` + `entitlement_state` + `cost_state`, så
   *entitets-refundering aldrig kan nulstille omkostningstilstanden*.
2. **Kost-reservation før ethvert provider-kald** fra både konto-budget og
   global budget (§6) — ellers findes der ingen penge-grænse at bryde.
3. **Konto-beskyttelse uafhængig af entiteter** (§7): døgn-loft (kald + DKK),
   livstids-loft for gratis/Starter-konti, **forsøgsloft**, fejl-cooldown,
   akut konto-lock.
4. **Clean-preview under kontrol** (§8, **option D hybrid**): særskilt
   preview-entitet + budget-deltagelse + upload-loft + SHA-256-dublet-cache.
5. **Idempotens** (§9): `idempotency_key` UNIQUE + semantiske constraints;
   `generation_id` er eneste reference udadtil.
6. **Token-sikkerhed** (§10): ingen reservations-tokens til klienter; fjern
   `finish_*`/`reserve_*`-grants til `authenticated`; kun server-til-server
   finalisering; sweeper med `unknown`-bevaring.
7. **`unknown`-state** (§12): reservationen beholdes, retry midlertidigt
   blokeres, afstemning kræves — aldrig et software-gæt til `released`.
8. **Global circuit breaker med manuel kill-switch** i `requestOpenAI`
   (§13) — sidste, enkle nødbremse.
9. **Kost-telemetri pr. generation** (§14) uden prompt-tekst/billedindhold —
   grundlaget for alt andet.
10. **Versioneret pris-tabel med fail-safe** (§17): ingen aktiv pris-række ⇒
    afvisning, aldrig et gæt; ingen hardcode af nutidens enhedspris.

### SHOULD FIX BEFORE PUBLIC LAUNCH

1. To-trins storage med midlertidig artifact-fastholdelse + upload-only-retry
   (§18) — lukker auditets HIGH ECONOMIC RISK.
2. Daglig provider-afstemning og løsning af `unknown`-rækker (§15).
3. Fejl-rate-trigger i breakeren (§13-2) ud over spend-trigger.
4. Fjernelse/flagning af orphante endpoints `dress-model` + `try-on`, og
   moderering tilføjet `tryon` (§4.2, fase I).
5. Anomali-detektion (requests/min) i breakeren (§13-2).
6. Præcisering af sweeper-deadlines og `unknown`-tvangsløsning (§10.3/§12).
7. Mærkning af alle tal som `estimated` vs `reconciled` i ethvert dashboard
   (§15).

### FUTURE OPTIMIZATIONS

1. Tynd provider-abstraktion + eventuel anden udbyder (§16) — først ved
   reelt behov.
2. Same-user pHash-genbrug og (efter juridisk vurdering) globalt
   dele-katalog (§19).
3. Automatiske pris-forslag fra afstemnings-afvigelser (§17).
4. Automatisk nulstilling af breaker samt dashboard-notits (§13).
5. Pris-simulering ("hvad koster næste måned ved +50 %?") oven på
   telemetri (jf. pricing-analysens §6).
6. Anonymisering af `user_id` i telemetri efter fastholdelsesperioden (§14).

### OUT OF SCOPE FOR NOW

- **Betalingsimplementering** (alt) — §24
- **App Store-betaling** (Apple IAP)
- **Google Play-betaling**
- **Webbetaling** (udbydervalg, checkout, webhooks)
- **31-dages betalings-/konto-cooldown-implementering**
  (`analysis/dressed-31-day-account-cooldown-analysis.md` — kun fremtidig
  afhængighed, fase J)
- Refusioner, abonnementer, prissætning af pakker
- Andre rapporters emner (SVG/lager/3D) — dækket separat

---

## 27. Most Important Final Question

> **Hvis DRESSED implementerer denne arkitektur korrekt, kan en fejl, en
> ondsindet bruger, en fejlet generering, en storage-fejl eller et fremtidigt
> AI-endpoint så uforvarende skabe en ubehersket OpenAI-regning?**

### Det nuancerede svar

**Nej som *ubegrænset* regning — men ja som *begrænset* regning, og
"aldrig muligt" ville være en usand påstand.**

Hvad arkitekturen faktisk garanterer (hvis alle lag virker):

1. **Intet kan køre uden for registret** (§4.2) — et fremtidigt endpoint
   eller en fejl-kodevej, der glemmer at tælle, **når aldrig provideren**,
   fordi chokepointet afviser ukendte operationer (fail-closed).
2. **Intet kan køre uden penge** (§6 + §7) — hvert kald låser et
   estimeret beløb fra både konto- og globalt budget; loop, dobbeltklik,
   race og retry-loops konsumerer budget i stedet for at være gratis.
3. **Refundering kan aldrig skjule omkostning** (§5/§11) — `RESTORED` kan
   aldrig omgøre `incurred/unknown`; auditets §5D-lukning ("betalt kald +
   refunderet kvote = gratis retry") lukkes strukturelt.
4. **Ukendt faktureringsopførsel bliver synlig, ikke skjult** (§12) —
   `unknown` fastholder reservationen og kræver afstemning mod provideren.
5. **Selvom alle ovenstående fejler** (fx en rigtig alvorlig logik-fejl):
   **circuit breakeren + den manuelle kill-switch** (§13) standser nye kald
   inden for minutter, og det **månedlige loft** sætter et absolut tag på
   tabet. Det yderste lag er bevidst designet til at være **enkelt nok til
   at virke, når alt andet er i stykker** — og kan suppleres af udbyderens
   eget forbrugsloft **[VERIFY — auditets spørgsmål 7]**.

**Hvad den IKKE kan udelukke (ærligt):**
- en **fejl i selve breakeren/budgettælleren** (én kodefejl i det lag) —
  derfor er den manuelle kill-switch og en ekstern alarm(er) ikke valgfri;
- **prisændring mellem reservation og fakturering** (begrænset af
  sikkerhedsfaktoren, ikke fjernet);
- **misbrug i de første minutter før telemetri reagerer** (begrænset af
  dags-/månedsloftet);
- **udbyderens egne regler**, som DRESSED ikke styrer (§12/§17);
- **en ondsindet bruger med adgang til ejerens `is_owner`-konto** — den
  bevidste undtagelse i nutidens system bør genovervejes ved implementering
  **[DECISION]**.

**Konklusionen i én sætning:** med dette design bliver risikoen
*acceptabelt lav* — ikke fordi ét lag er ufejlbarligt, men fordi
**tabsstørrelsen er begrænset i det yderste lag** (globalt loft + manuel
stop), **alle mellemliggende lag er designet så fejl bliver dyre i stedet for
gratis**, og **den eneste tilbageværende usikkerhed — udbyderens faktiske
fakturering — aktivt spores og afstemmes** i stedet for at blive gættet på.

---

**Status for dette dokument:** planlægningsdokument. **Intet er implementeret
i denne session** — ingen kildefil, migration, Supabase- eller
konfigurationsændring, ingen betaling, ingen kvoter, ingen git-handlinger.
**Kun denne rapport er skabt.**













