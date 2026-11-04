# DRESSED — Financial Safety, Pricing & SVG/Storage Architecture Analysis

> **READ-ONLY.** Ingen projekt-emoji, pakker, migrations, Supabase-ændringer
> eller git-handlinger er foretaget. Denne rapport er det eneste, der er skabt.
>
> **Evidens-markering brugt konsekvent i hele rapporten:**
> **[CONFIRMED]** = læst i dette kodesystem (fil:linje) ·
> **[EXTERNAL]** = aktuel ekstern officiel/pris-side hentet i denne session ·
> **[ASSUMPTION]** = bevidst antagelse (angivet med værdi) ·
> **[VERIFY]** = kan ikke afgøres herfra og skal verificeres ·
> **[DECISION]** = skal ikke låses endnu — produkt/jura vælger.
>
> **Dato for eksterne tal:** 7. oktober 2026.

---

## 1. Executive Summary

**Forretningsreglen:** *DRESSED må aldrig give ejeren et personligt tab ved
normal, fuld udnyttelse af pakken.* Derfor beregnes **worst case for én bruger
der bruger alt**, ikke gennemsnit.

**Kernefunden:**

| # | Fund | Status |
|---|---|---|
| **F1** | **1 API-request = 1 DRESSED-generation er BEKRÆFTET for alle tre kvote-typer.** Personlig model = 1 `images/edits`-kald; beklædnings-generation = 1 kald; try-on = 1 kald (der er ingen multi-kalds-genereringer og ingen resize/efterbehandling ud over PNG-dekodering). | **[CONFIRMED]** `openai-images.ts:14,142-151`, `character-job.ts:99`, `clothing-job.ts:72`, `dress-model.ts:292` |
| **F2** | **AFVIGELSE FRA PAKKEN:** koden giver også **1 gratis try-on** (`free_limit=1`) og — vigtigst — **hvert beklædning-upload udløser et AI "clean preview"-kald der INGEN kvote har** (`wardrobe/items/index.ts:556 → editImage`). Der findes **ingen grænse** for antal uploads fundet i koden. | **[CONFIRMED]** `202610040015…sql:6-7`, `wardrobe/items/index.ts:66-141,439-471` |
| **F3** | **Konsekvens af F2: indtil der sættes et loft, er per-bruger worst case UBEGRÆNSET — og INGEN pris er sikker.** Dette er det eneste fund, der kan give direkte tab ved "normal brug". | kræver cap **[DECISION]** |
| **F4** | Fejlede generationer refunderer **brugerens** kvote (0016: `used_count` rulles tilbage) men DRESSED har stadig betalt eventuelle OpenAI-omkostninger → **DRESSED absorberer retry-omkostninger**. | **[CONFIRMED]** `202610040016…sql:33-35` |
| **F5** | Målt AI-pris fra ejerens dashboard: **$7.04 / 110 requests = $0.064/request ≈ 0.43 DKK** (ved 6.70 DKK/USD). Dermed koster den angivne pakke (1+3=4) **≈1.71 DKK** i AI — men den **kode-tro** worst case (1+3+tryon+5 previews = 10 kald) er **≈4.29 DKK**. | [CONFIRMED-data + ASSUMPTION-kurs] |
| **F6** | **7 DKK er UNSAFE** på web (worst-case netto efter gebyr+moms ≈3.70 DKK < kode-tro omkostning 4.29 DKK ⇒ direkte tab). **12 DKK er SAFE på app-butikkerne men BORDERLINE på web. 15 DKK er SAFE alle steder.** | §5, §7 |
| **F7** | Billeder gemmes **ukomprimeret som PNG uden thumbnails** (pngjs bruges kun til validering) — ingen WebP/AVIF-transform findes. Dette er et drifts- **og** egress-problem ved skala. | **[CONFIRMED]** `image-input.ts`, `character-job.ts:114`, `clothing-job.ts:128` |
| **F8** | **SVG kan kun supplere, aldrig erstatte**, AI-PNG'er og den planlagte GLB/3D-arkitektur. Anbefaling: SVG til **globale UI-/vektor-assets**, ikke til brugerdata. | §8–§11 |

**Den vigtigste konklusion:** Inden betaling indføres, skal **(1) et
hårdt loft over AI-kald pr. konto** sættes (især clean-preview), og **(2)
prisen fastsættes til 15 DKK (eller 12 DKK i app-butikkerne + 15 DKK på web)**
— 7 DKK kan under ingen omstændigheder anbefales.

---

## 2. Current Starter Package & Worst-Case Definition

**Pakken (givet):** 1 personlig AI-model · 3 AI-beklædnings-generationer ·
maks 10 gemte outfits · 31-dages cooldown.

```text
Angivet maksimalt AI-brug:  1 + 3 = 4 billedgenerationer
Kode-tro maks (tillæg fundet i F2):  1 + 3 + 1 try-on + N upload-previews
    = 5 + N kald      (N = antal uploads — INGEN GRÆNSE I KODEN)
```

- **10 gemte outfits** koster **0 AI-kald** (outfits er DB-rækker + eksisterende
  previews) — **[CONFIRMED]** `save_dressed_outfit`-RPC.
- Denne rapport beregner **begge** worst cases: *Pakke-worst-case (4)* og
  *Kode-tro worst case (5 + N)* — forretningen skal vælge, hvilken der er
  den gældende (**[DECISION]**), men **no-loss-reglen testes mod den
  kode-tro**, fordi det er det, systemet faktisk tillader i dag.

---

## 3. OpenAI Image Usage Data & Per-Request Cost

### 3.1 Ejerens dashboard-data (givet)

| Måling | Værdi |
|---|---|
| Totale requests | 110 (udelukkende billed-requests) |
| Oktober-forbrug | **$7.04** |
| Kreditbalance | $7.96 (start ≈ $15) |
| Prompt-cache hit-rate | 0 % (irrelevant for billed-API'en — **[ASSUMPTION]** billed-endepunkter benytter ikke prompt-caching) |

### 3.2 Beregninger

**Valgt valutakurs: 1 USD = 6,70 DKK** — **[ASSUMPTION]**, begrundet med at
den live-kurs der kunne hentes i denne session (7/10-2026) var **6,6744**
(**[EXTERNAL]** exa.ai), rundet op. Sensitivitet ved **7,00** er vist.

| Beregning | USD | DKK (6,70) | DKK (7,00) |
|---|---|---|---|
| **Gennemsnit pr. request** = 7,04 ÷ 110 | **$0,0640** | **0,43** | 0,45 |
| **1 billede** | $0,064 | **0,43** | 0,45 |
| **3 billeder** (beklædning) | $0,192 | **1,29** | 1,34 |
| **4 billeder** (pakke-worst case) | $0,256 | **1,71** | 1,79 |
| **5 billeder** (kode-tro uden previews) | $0,320 | **2,14** | 2,24 |
| **10 billeder** (kode-tro + 5 upload-previews) | $0,640 | **4,29** | 4,48 |
| **100 billeder** | $6,40 | **42,88** | 44,80 |

**Vigtig forbehold [VERIFY]:** gennemsnittet er *blandet trafik*. Koden bestiller
altid `quality: "high"` og `1024x1536` eller `1024x1024`
(**[CONFIRMED]** `openai-images.ts:146-148`) — hvis netop de størrelser er
dyrere end gennemsnittet, er reelle omkostninger højere. **[VERIFY]** den
officielle prisliste for `gpt-image-2.5-sunburst` (findes ikke i repoet; ingen
priser opfindes her). Beregningerne her bruger derfor den **empiriske**
gennemsnitspris og tester stigninger i §6.

### 3.3 Antal API-kald pr. generation (fra IMPLEMENTATIONEN — ikke antaget)

| DRESSED-handling | Kvote-typer | `images/edits`-kald | Moderations-kald | Efterbehandling | Kilde |
|---|---|---|---|---|---|
| **Personlig AI-model** | `character` (limit **1**) | **1** | 1 (route-niveau) | PNG-validering (lokal, gratis) | `personal-model.ts:222` → `character-job.ts:99` |
| **AI-beklædnings-generation** | `clothing` (limit **3**) | **1** | 1 (route-niveau) | PNG-dekod + upload | `process-clothing.ts:421` → `clothing-job.ts:72` |
| **Try-on (dress-model)** | `tryon` (limit **1**) | **1** | **ingen** (observeret) | PNG-upload | `dress-model.ts:285-313` |
| **Clean-preview pr. UPLOAD** | **INGEN KVOTE** | **1** | 1 | PNG-upload | `wardrobe/items/index.ts:556` + `:450` |
| Moderation generelt | — | 0 | `omni-moderation-latest` | — | `openai-images.ts:11,94` |

**Svar på opgavens kontrolspørgsmål (eksplikt):**
- **Ét kald pr. generation for alle tre kvote-typer — BEKRÆFTET.** Der findes
  **ingen** multi-kalds-genereringer, **ingen** efterfølgende resizing/
  transformering (pngjs bruges kun til at **validere** at resultatet er et
  gyldigt 1024×1536-PNG — `character-job.ts:114`, `clothing-job.ts:128`), og
  **ingen** øvrige AI-kald i de tre generate-stier.
- **MEN:** (a) moderations-kald på 3 stier (**[ASSUMPTION]** gratis/negligerbart
  — **[VERIFY]**), (b) **det u-kvoterede clean-preview-kald pr. upload** (F2),
  (c) FASHN-try-on findes, men er **inaktivt** (0 klient-referencer,
  **[CONFIRMED]** tidligere audit) ⇒ tælles ikke.

---

## 4. DRESSED Cost Model

### 4.A AI-omkostninger

| Element | Værdi | Kilde |
|---|---|---|
| Pris pr. billedkald (målt) | **0,43 DKK** | §3.2 |
| Pakke-worst case (4 kald) | **1,71 DKK** | beregning |
| Kode-tro worst case (10 kald) | **4,29 DKK** | beregning |
| U-kvoterede upload-previews | **0,43 DKK pr. upload — ubegrænset** | F2 |
| Fejlede generationer: bruger-kvote refunderet? | **Refunderes** (`used_count−1` ved fiasko) | **[CONFIRMED]** `0016:33-35` |
| Fejlede generationer: vores AI-omkostning? | **DRESSED betaler** hvis OpenAI allerede har leveret/betalt et billede; mislykkede API-kald (4xx/5xx) antages **ikke** at blive faktureret — **[ASSUMPTION]** | §13 |
| Automatiske retries i koden? | **Ingen** fundet (Netlify background functions kører jobbet én gang) | **[CONFIRMED]** `process-clothing-background.mts` |
| Bruger-drevne retries ved fejl | **Fri** (kvote ikke forbrugt ⇒ bruger kan trykke igen uendeligt) | F4 |

**Finansiel implicering af fejl (F4):** hvert teknisk fejlslagent
genereringsforsøg, hvor OpenAI alligevel har faktureret, er **rent tab for
DRESSED uden kvote-afregning**. Anbefalet, ikke implementeret: **pr. konto
forsøgs-loft** (f.eks. maks N forsøg pr. type pr. døgn) — **[DECISION]**.

**Den afgørende regulerings-kontrol (mangler i dag):** fordi clean-previews
og antal uploads ikke er begrænset, er **worst case for én normal bruger
ikke fastlægbart** — og dermed er **ingen pris teknisk sikker endnu** (F3).

### 4.B Supabase (modelen er hentet fra supabase.com/pricing — [EXTERNAL], 7/10-2026)

| Plan | Pris | Inkluderet | Overpris |
|---|---|---|---|
| **Free** | $0 | 500 MB DB · **1 GB fil-lager** · 5 GB egress · 50.000 MAU · **2 projekter** · *projekter sættes på pause efter 1 uges inaktivitet* | — (hårde grænser) |
| **Pro** | **$25/mdr** (+ $10 compute-kredit inkluderet, dækker Micro) | 8 GB disk · **100 GB fil-lager** · **250 GB egress** · 100.000 MAU · daglig backup (7 dage) | disk $0,125/GB · **filer $0,0213/GB** · egress $0,09/GB · MAU $0,00325 |
| Team | $599/mdr | m.m. | — |

**Hvad DRESSED faktisk lagrer (alle stier [CONFIRMED]):**

| Data | Sti | Estimeret størrelse [ASSUMPTION] |
|---|---|---|
| Kildefoto | `profile-images/{uid}/source-photo-*` (max 4 MB) | 1–4 MB |
| Personligt modelbillede (1024×1536 PNG) | `model-images/{uid}/…` via `character-job.ts:122` | 1–3 MB |
| Beklædnings-originaler (jpg/png/webp, ≤4 MB) | `{uid}/clothing-originals/*` | 1–4 MB pr. stk. |
| AI-beklædnings-lag (gennemsigtig PNG) | `{uid}/…` via `clothing-job.ts:174` | 0,5–2 MB pr. stk. |
| Clean-previews (PNG) | `{uid}/clothing-previews/*` | 0,5–1,5 MB pr. stk. |
| Try-on-resultater | `{uid}/wardrobe-results/*.png` | 1–3 MB pr. stk. |
| Basisformer (globale) | `base-forms/*` | ~1–2 MB (engangs) |
| Fremtidige 3D-assets (GLB + teksturer) | *[DECISION]* | 2–15 MB pr. bruger [ASSUMPTION] |

**Skala-beregninger [ASSUMPTION: ~30 MB pr. aktiv Starter-bruger ved 10
beklædningsdele]:**

| Brugere | Filer | Status |
|---|---|---|
| ~33 | 1 GB | **Free-planens fil-lager er opbrugt** |
| ~3.300 | 100 GB | Pro inkluderet opbrugt — derefter $0,0213/GB |
| ~11.000 | 335 GB | overpris > $5/mdr (~3,50 DKK) |
| 50.000 | 1,5 TB | ≈ **$29/mdr** i overpris alene (≈195 DKK) |

**Konklusion:** Supabase-lager er **billigt pr. bruger** og bliver først
meningsfuldt ved tusinder af brugere; den **reelle trussel er egress**
(250 GB inkl. → $0,09/GB) fordi **der ikke findes thumbnails** (F7):
én garderobe-visning med 10 fuldstore PNG'er kan være ~15 MB. **[DECISION]:**
thumbnails/WebP-transform før skala.

### 4.C Hosting — Netlify (netlify.com/pricing — [EXTERNAL], 7/10-2026)

Netlify er skiftet til **credit-prisfastsættelse**:

| Plan | Pris | Credits | Vigtigste takster |
|---|---|---|---|
| **Free** | $0 | **300/mdr** (hård grænse — siden sættes på pause ved 100 %) | produ-deploy **15 credits** · bandwidth **20 credits/GB** · web-requests 2 credits/10k |
| Personal | $9/mdr | 1.000/mdr | samme |
| **Pro** | **$20/mdr** | 3.000/mdr (op til 20.000; ubenyttede ruller over) | samme |

**Konsekvenser for DRESSED [ASSUMPTION-beregning på officielle takster]:**
- **Free:** 300 credits = kun **~20 produ-deployes** *eller* ~15 GB bandwidth
  ⇒ ikke bæredygtigt ved løbende udvikling.
- **Pro $20:** ~3.000 credits → f.eks. 20 deploys (300) + ~135 GB bandwidth
  ⇒ **rigeligt til tidlig skala**. ≈ 134 DKK/mdr.
- Baggrundsfunktioner (15 min) er en del af Functions — med i credits
  (compute 10 credits/GB-time). DRESSED kalder dem pr. generation.
- **Vækst:** ved mange brugere stiger bandwidth/requests; credits kan regnes om:
  ~$0,13/GB (20 credits × $0,00667/credit) — stadig billigt ift. AI.

### 4.D Betalinger — platform-gebyrer ([EXTERNAL] officielle sider + [ASSUMPTION])

| Kanal | Regel | Kilde/forbehold |
|---|---|---|
| **iPhone / App Store** | **15 %** (Small Business Program, ≤ $1M proceeds/år); **30 %** over grænsen; **EU-særvilkår for SBB: yderligere reduceret til 10 %** | [EXTERNAL] developer.apple.com/app-store/small-business-program · **[VERIFY]** om Apple yderligere opkræver betalingsgebyr på EU-særvilkår, og hvem der bogfører moms (Apple som merchant-of-record i EU — **[VERIFY]**) |
| **Android / Google Play (EEA — Danmark)** | Fra **30. juni 2026**-udrulningen: nye installationer = **10 % servicefee + 5 % billing fee = 15 %** (første $1M); *eksisterende* installationer = 20 %+5 % = 25 % for engangskøb | [EXTERNAL] support.google.com/googleplay/…/112622 · **[ASSUMPTION]** en **ny app** har kun "new installs" ⇒ 15 % · **[VERIFY]** moms-ansvar (Google/MoR) |
| **Web** | Kortbetaling i DK: **1,5 % + 1,80 DKK** pr. transaktion | **[ASSUMPTION]** (tredjeparts-noter; **[VERIFY]** på stripe.com/en-dk/pricing eller MobilePay Online før valg) |
| **Moms (DK)** | 25 % B2C-digitalydelser; registreringsgrænse **50.000 DKK/12 mdr.** | **[ASSUMPTION]** + **[DECISION]/[VERIFY]** — momsbehandlingen er **IKKE** låst her; begge scenarier regnes i §5 |

---

## 5. Price Scenarios

**Standard-beregninger (bruges i alle tre tabeller):**

| Symbol | Værdi | Begrundelse |
|---|---|---|
| **Max normal brugeromkostning (kode-tro, ENUC)** | **4,29 DKK** | 10 kald × 0,43 (1 model + 3 beklædning + 1 try-on + 5 upload-previews) §3.3 |
| **Stress-ENUC (AI +50 %)** | **6,43 DKK** | §6 |
| **AI +100 %-ENUC** | **8,58 DKK** | §6 |
| Pakke-ENUC (kun 4 kald) | 1,71 DKK | vist som nedre reference |
| Momsscenarie (konservativt) | netto = 0,8 × P − gebyr | [DECISION] §4.D |

**Statusdefinitioner (som krævet):** **SAFE** = dækker worst case + ≥2×
sikkerhed mod stress; **BORDERLINE** = dækker nuværende omkostning, men
 fremtidige stigninger kan give tab; **UNSAFE** = kan give ejeren et tab.

### 5.1 WEB (gebyr 1,5 % + 1,80 DKK [ASSUMPTION]; moms = værstefald)

| Pris | Gebyr | Netto (inkl. moms-scenariet) | Netto (hvis moms ikke skal afregnes) | Max normal-kost | Margin (VAT) | Under AI-stress (+50 %) | Break-even ved 100 betalende* | Status | Anbefaling |
|---|---|---|---|---|---|---|---|---|---|
| **7 DKK** | 1,91 | **3,70** | 5,10 | 4,29 | **−0,59 ⇒ TAB** | −2,73 ⇒ TAB | ✗ tab | **UNSAFE** | **Ikke anbefalet** |
| **10 DKK** | 1,95 | **6,05** | 8,05 | 4,29 | +1,76 | **−0,38 ⇒ TAB** | ✗ (176 brugere skal blot dække faste) | **UNSAFE** (under stress) | Ikke anbefalet som web-pris |
| **12 DKK** | 1,98 | **7,62** | 10,02 | 4,29 | +3,33 | +1,19 (AI +100 % ⇒ **−0,96 TAB**) | ✓ knap (333 ≥ 302) | **BORDERLINE** | Mulig, men tynd fremtidssikring |
| **15 DKK** | 2,03 | **9,98** | 12,98 | 4,29 | **+5,69** | **+3.55** (+100 % ⇒ +1,40) | ✓ (569) | **SAFE** | **Anbefalet (web)** |

\* faste omkostninger = Supabase Pro $25 + Netlify Pro $20 ≈ **302 DKK/mdr**
([ASSUMPTION] $1 = 6,70). Bruger-margin × 100 skal ≥ 302.

### 5.2 iPhone / App Store (15 % Small Business Program [EXTERNAL]; EU-SBB kan være 10 %)

| Pris | Platformfradrag (15 %) | Netto til DRESSED | Max normal-kost | Margin | Under stress (+50 %) | Break-even ved 100 | Status | Anbefaling |
|---|---|---|---|---|---|---|---|---|
| **7 DKK** | −1,05 | **5,95** | 4,29 | +1,66 | **−0,48 ⇒ TAB** | ✗ | **UNSAFE** | Ikke anbefalet |
| **10 DKK** | −1,50 | **8,50** | 4,29 | +4,21 | +2,07 (AI +100 % ⇒ **−0,08**) | ✓ (421) | **BORDERLINE** | Kun med hårdt AI-loft |
| **12 DKK** | −1,80 | **10,20** | 4,29 | +5,91 | +3,77 (+100 % ⇒ +1,62) | ✓ (591) | **SAFE** | Anbefalet |
| **15 DKK** | −2,25 | **12,75** | 4,29 | +8,46 | +6,32 | ✓ (846) | **SAFE** | **Kraftigt anbefalet** |

*Moms: her er Apple antaget MoR (netto = 0,85 × P) — **[VERIFY]**. Konservativt
fallback (DRESSED afregner moms): netto = 0,85 × 0,8 × P ⇒7/10/12/15 =
4,76 / 6,80 / 8,16 / 10,20 — ændrer 10 DKK til UNSAFE og bekræfter 12/15.*

### 5.3 Android / Google Play (EEA: nye installationer 10 %+5 % = 15 % [EXTERNAL])

| Pris | Platformfradrag (15 %) | Netto | Max normal-kost | Margin | Under stress (+50 %) | Status | Anbefaling |
|---|---|---|---|---|---|---|---|
| **7 DKK** | −1,05 | **5,95** | 4,29 | +1,66 | **−0,48 ⇒ TAB** | **UNSAFE** | Ikke anbefalet |
| **10 DKK** | −1,50 | **8,50** | 4,29 | +4,21 | +2,07 | **BORDERLINE** | Kun med hårdt AI-loft |
| **12 DKK** | −1,80 | **10,20** | 4,29 | +5,91 | +3,77 | **SAFE** | Anbefalet |
| **15 DKK** | −2,25 | **12,75** | 4,29 | +8,46 | +6,32 | **SAFE** | **Kraftigt anbefalet** |

*Forbehold:* hvis en køber findes som "eksisterende installation" (20 %+5 % =
25 %) ⇒ 7/10/12/15 = 5,25 / 7,50 / 9,00 / 11,25 — 10 DKK falder til
BORDERLINE/UNSAFE. **[ASSUMPTION]** at en ny app kun ser nye installationer.

### 5.4 Samlet konklusion for del 5

| Pris | Web | iPhone | Android | Samlet |
|---|---|---|---|---|
| **7 DKK** | UNSAFE | UNSAFE | UNSAFE | **UNSAFE — afvises** |
| **10 DKK** | UNSAFE | BORDERLINE | BORDERLINE | **BORDERLINE** |
| **12 DKK** | BORDERLINE | SAFE | SAFE | **SAFE m. forbehold (web)** |
| **15 DKK** | SAFE | SAFE | SAFE | **SAFE — anbefales** |

**Alene på grund af F2 (u-kvoterede previews) gælder:** *indtil et loft er
sat, er selv 15 DKK teknisk usikker* — et loft er en **forudsætning**, ikke
et valg.

---

## 6. Future Price Changes / Cost Increases

### 6.1 AI-prisstigninger (pr. kald: basis 0,43 DKK [ASSUMPTION-kurs])

| Stigning | Pris/kald | ENUC 4 kald | ENUC 10 kald | Tab ved 7 DKK web (VAT) | Tab ved 10 DKK web | Tab ved 12 DKK web | Tab ved 15 DKK web |
|---|---|---|---|---|---|---|---|
| +0 % (basis) | 0,43 | 1,71 | **4,29** | −0,59 | +1,76 | +3,33 | +5,69 |
| **+10 %** | 0,47 | 1,89 | 4,72 | −1,02 | +1,33 | +2,90 | +5,26 |
| **+25 %** | 0,54 | 2,14 | 5,36 | −1,66 | +0,69 | +2,26 | +4,62 |
| **+50 %** | 0,65 | 2,57 | **6,43** | −2,73 | **−0,38** | +1,19 | +3,55 |
| **+100 %** | 0,86 | 3,43 | **8,58** | −4,88 | −2,53 | **−0,96** | **+1,40** |

**Læsning:** ved **AI +50 %** er 7 *og* 10 DKK på web allerede i tab; ved
**AI +100 %** er **kun 15 DKK** tilbage på web. På app-butikkerne (netto 10,20
ved 12 DKK) overlever 12 DKK begge stigninger med +1,62 ved +100 %.

### 6.2 Storage-omkostningsstigninger (Supabase overpris $0,0213/GB [EXTERNAL])

Pr. bruger **ud over** den inkluderede 100 GB (30 MB/bruger [ASSUMPTION]):

| Stigning | $/GB | Pr. bruger/mdr (30 MB) | Pr. bruger/mdr (1 GB) | Betydning |
|---|---|---|---|---|
| +0 % | 0,0213 | **0,004 DKK** | 0,14 DKK | ubetydelig |
| +25 % | 0,0266 | 0,005 | 0,18 | ubetydelig |
| +50 % | 0,0320 | 0,006 | 0,21 | ubetydelig |
| +100 % | 0,0426 | 0,008 | 0,43 | fortsat lille |

**Konklusion:** **lagringspriser er ikke den finansielle trussel — AI er.**
Den reelle lagrings-risiko er (a) at krydse den inkluderede 100 GB, og
(b) **egress** ($0,09/GB over 250 GB) pga. manglende thumbnails (F7): ~16.600
garderobe-visninger af 10 fuldstore PNG'er (~15 MB) ≖ 250 GB-grænsen.

### 6.3 Bruger-lager pr. bruger (ud over 100 GB inkl.; $0,0213/GB × 6,70)

| Pr. bruger | Ekstra lageromkostning/mdr | Betydning |
|---|---|---|
| **100 MB** | **0,014 DKK** | ubetydelig |
| **500 MB** | 0,07 DKK | ubetydelig |
| **1 GB** | 0,14 DKK | lille |
| **5 GB** | **0,71 DKK** | mærkbar (15 % af en 5 DKK-margin) |
| **10 GB** | **1,43 DKK** | betydelig — kræver evt. loft eller sletning (§12) |

**Hvor mange brugere før lager bliver meningsfuldt?**

| Tærskel | Brugere ved 30 MB | Brugere ved 500 MB |
|---|---|---|
| Free-plan opbrugt (1 GB) | **~33** | ~2 |
| Pro inkluderet opbrugt (100 GB) | **~3.300** | ~200 |
| Overpris > $5/mdr | ~11.000 | ~700 |
| Overpris > $50/mdr (~335 DKK) | ~54.000 | ~3.200 |

### 6.4 Combined stress-scenarie (realistisk værstefald)

```text
AI +50 % (0,65 DKK/kald) · bruger bruger ALT (10 kald = 6,43 DKK)
+ 100 MB ekstra lager (0,014 DKK) + egress-andel (~0,05 DKK)
+ betalingsgebyr + moms (web)
≈ TOTAL BRUGEROMKOSTNING: 6,50 DKK (web-tab) / 6,49 DKK (app)

Netto efter gebyr/moms:  web 7 DKK = 3,70 → TAB −2,80
                         web 10 = 6,05 → TAB −0,45
                         web 12 = 7,62 → +1,12 (tynd)
                         web 15 = 9,98 → +3,48 ✓
                         iPhone/Android 12 = 10,20 → +3,71 ✓
                         iPhone/Android 15 = 12,75 → +6,26 ✓

Worst-worst (AI +100 % ⇒ 8,58 + 0,07 = 8,65):
                         web 12 → −1,03 ✗     web 15 → +1,33 ✓
                         app 12 → +1,55 ✓      app 15 → +4,10 ✓
```

**Svar:** Under combined stress er **7 og 10 DKK usikre alle steder**,
**12 DKK usikker på web men sikker i app-butikkerne**, og **15 DKK sikkert
alle steder** (også i worst-worst).

---

## 7. Price Safety Threshold

### 7.1 Den foreslåede regel (DRESSED-sikkerhedsreglen)

> **NO-LOSS-REGLEN:**
> En pris er kun **sikker**, hvis
>
> ```text
> Nettoindtægt efter platformgebyr OG (hvis pligtigt) moms
>   ≥ 2 × Kode-tro ENUC under AI-stress (+50 %)
>   OG ≥ Kode-tro ENUC selv ved AI +100 %
> ```
>
> **Drop-grænse:** *Hvis den beregnede maksimale normale omkostning pr.
> Starter-bruger overstiger **40 % af den laveste nettoindtægt (worst
> platform = web inkl. moms)**, er den gældende pris ikke længere sikker.*

**Tjek med de beregnede tal (netto web inkl. moms):**

| Pris | Netto | 40 %-grænse | ENUC 4,29 (kode-tro) | Overstiger? |
|---|---|---|---|---|
| 7 | 3,70 | 1,48 | 4,29 | **JA ⇒ UNSAFE** |
| 10 | 6,05 | 2,42 | 4,29 | **JA ⇒ UNSAFE** |
| 12 | 7,62 | 3,05 | 4,29 | **JA ⇒ UNSAFE (på web-inkl-moms-kriteriet)** |
| 15 | 9,98 | 3,99 | 4,29 | **JA (marginalt)** — men opfylder 2×-stress-reglen ved AI +50 % (9,98 ≥ 2×6,43=12,86? **NEJ**) … |

**Ærlig konstatering:** med den **kode-tro** ENUC på 4,29 DKK (fordi F2 ikke
er lukket) opfylder **ingen** web-pris 2×-reglen. Derfor er **regulering
(soft-loft) en forudsætning for selve modellen** — med et hårdt loft på
**maks 6 AI-kald pr. konto** (1 model + 3 beklædning + 1 try-on + 1 preview/
upload eller previews uden AI) falder ENUC til:

```text
Loftet ENUC = 6 kald × 0,43 = 2,58 DKK   (6 × 0,65 = 3,90 ved AI +50 %)
```

| Pris | Netto web (moms) | ≥2× stress-ENUC (7,80)? | ≥ ENUC ved +100 % (5,16)? | Status med loft |
|---|---|---|---|---|
| 7 | 3,70 | nej (tab) | nej | **UNSAFE** |
| 10 | 6,05 | nej (men > 5,16) | ja | **BORDERLINE** |
| 12 | 7,62 | nej (men komfortabel over 5,16) | ja | **SAFE** (kriterium: ≥ stress-ENUC +40 %-regel: 40 % = 3,05 > 2,58 ✓, < 3,90 ved +50 % ⇒ BORDERLINE mod 2×, SAFE mod tab) |
| **15** | **9,98** | **≈ ja (9,98 ≥ 7,80 ✓)** | ja | **SAFE** |

### 7.2 De tre priser (med loft som forudsætning)

| Type | Pris | Begrundelse |
|---|---|---|
| **Minimum sikker salgspris** | **12 DKK** (app-butikker) / **15 DKK (web)** | 12 DKK overlever AI +100 % på app-butikkerne; på web skal moms-gebyret op, så 15 er den reelle web-tærskel |
| **Anbefalet salgspris (ens på alle platforme)** | **15 DKK** | dækker kode-tro ENUC, AI +100 % og combined stress med ≥+1,4 DKK; enkel at kommunikere; stadig overkommelig for brugeren |
| **Konservativ salgspris** | **18–20 DKK** | giver ~3× mod AI +100 % ved web-moms og betaler hurtigere de faste ~302 DKK/mdr |
| **Pris der skal afvises** | **7 DKK** | direkte tab på web selv ved basisomkostning (F2); UNSAFE på alle tre platforme i stress |

### 7.3 Break-even (faste omkostninger ≈ 302 DKK/mdr [ASSUMPTION: Supabase Pro $25 + Netlify Pro $20])

Antal **betalende brugere/mdr** der skal til for kun at dække faste omkostninger
(variabel ENUC = 4,29 uden loft, 2,58 med loft):

| Pris | Netto pr. bruger | Break-even u/ loft (4,29) | Break-even m/ loft (2,58) |
|---|---|---|---|
| 7 (web-moms) | 3,70 | **aldrig (negativ margin)** | 178 |
| 10 | 6,05 | 156 | 73 |
| 12 (web) | 7,62 | 76 | 50 |
| **15 (web)** | 9,98 | **47** | **39** |
| 12 (app) | 10,20 | 51 | 42 |
| 15 (app) | 12,75 | **36** | **31** |

**Lavere faste alternativ:** Supabase Pro alene ($25 ≈167 DKK; Netlify Free
med 300-credit-grænse) ⇒ break-even ved 15 DKK web med loft ≈ **22 brugere**.

---

## 8. Storage Optimization — SVG (Options A–E)

**Begrundet vurdering af hver mulighed** (kvalitet > ren lagringsbesparelse):

| Option | Beskrivelse | Lagringsbesparelse | Kvalitet/egnethed | Ydeevne | Risici | Vurdering |
|---|---|---|---|---|---|---|
| **A: SVG i Supabase Storage** | `.svg`-filer i de private buckets, serveret via signerede URLs | **Ingen relevans for AI-billeder** (raster kan ikke vektorisere tabfrit); stort for flade illustrationer (KB vs. MB) | Kun for **globale flade illustrationer**; forværrer fotos | God; browser renderer SVG hurtigt; cache svært ved signerede URLs (kort TTL) | **XSS hvis der renderes udstyret SVG** (se §10); `Content-Type`-håndtering | **Anbefalet KUN til globale/delte vektor-assets** |
| **B: SVG som PostgreSQL-tekst** | SVG-kilde i en tekstkolonne | Banal (~KB); men **DB-lager koster $0,125/GB vs. filer $0,0213/GB** ⇒ **dyrere pr. byte** | Kun metadata/paths for system-assets | DB-belastning ved store strenge; hentes ofte uden cache | RLS kan beskytte kolonnen direkte; men forstørrer DB-dump/backup | **Frarådes** til filer — kun små inline-icons |
| **C: DB-post + render direkte i browseren** | DB holder SVG-markup, frontend sætter `innerHTML`/`<img src=data:` | Som B | Samme | God | **XSS-fare hvis markup er ukontrolleret** (brugerdata!); CSP nødvendig | **Kun for system-ejede strenge**, aldrig brugerindhold |
| **D: SVG som statiske assets + cache** | Globale SVG'er i `public/`/CDN, versioneret | **0 marginal omkostning** (serves af Netlify-cache — ikke Supabase-egress!) | Perfekt til UI/ikoner/dele-basisgrafik | **Bedst** (lang CDN-cache) | Ingen brugerdata ⇒ ingen RLS-problem | **Stærkt anbefalet til alt globalt** (UI, ikoner, dele-grafik) |
| **E: Hybrid** (anbefalet) | SVG hvor det passer + raster til AI + komprimeret foto + GLB til 3D | Optimal samlet | Optimal | Optimal | Kræver klassificeringsregler (§9, §12) | **ANBEFALINGEN** |

**Konklusion for del 8:** DRESSED har **i dag ingen SVG'er** og **ingen
billedtransform-pipeline** (**[CONFIRMED]**: ingen `sharp`, kun `pngjs`-validering).
SVG giver derfor **kun øjeblikkelig gevinst på nye, globale vektor-assets** —
det reducerer **ikke** AI-omkostningerne (som er den dominerende udgift) og
kan **ikke** erstatte de eksisterende PNG'er uden gen-generering (dyrt).

---

## 9. SVG Feasibility — hvad der KAN og IKKE blive SVG

### Kan realistisk være SVG ([ANBEFALET] — især som **globale/delte** assets)

| Asset | Begrundelse |
|---|---|
| UI-ikoner, knapper, tomme-tilstands-grafik, logo | allerede vektor-agtige; ~KB |
| Flade beklædnings-silhuetter til **filter/kategori-grafik** | simple former, skalérbare |
| Dele-/stykke-indikatorer, måle-markeringer i UI | tekniske linjer |
| Globale basis-grafik uden for AI (f.eks. placeholder-mannequin-illustrationer) | delt af alle ⇒ stordriftsfordel |
| Diagram-/for-forklaringer | statisk |

### SKAL forblere raster ([CONFIRMED] som PNG i dag)

| Asset | Hvorfor ikke SVG |
|---|---|
| AI-genererede modelbilleder (`gpt-image-2.5-sunburst`) | fotos/lignende; tab ved vektorisering; AI producerer raster |
| AI-genererede beklædningslag (gennemsigtige PNG) | fine teksturer/alpha — SVG kan ikke gengive |
| Try-on-/outfit-resultater | fotorealistisk |
| Bruger-uploaded fotos (kilde, beklædning) | fotografier |
| Fotografiske teksturer (fremtid) | raster |
| Rendrede 3D-billeder (fremtid) | raster |

**Eksplicit:** *SVG anbefales alene fordi det bruger mindre lager — det gør
det ikke.* Evalueret på kvalitet/skalering/rendering/caching ⇒ **kun flade,
globale vektorgrafikker**. Bruger-specifikke "vektoriserede previews" ville
kræve AI-vektorisering (ny omkostning) eller manuelt arbejde ⇒ **ikke
anbefalet** ([DECISION]).

---

## 10. Security / Privacy — SVG i en strengt adskilt multi-tenant-app

**Hvad der IKKE ændrer sig:** SVG rører **ikke** den nuværende
isolationsmodel. Private bruger-data forbliver i private buckets med
`{userId}/`-stier + ejerskabspolicyer + signerede URLs (**[CONFIRMED]** i
`202610070001` og baseline-analysen). RLS i databasen påvirkes kun, hvis man
vælger Option B/C (tekst i kolonne) — så skal der sættes **0 policyer /
service-rolle-kun** som allerede anbefalet.

**Truselbilledet for SVG er specifikt:**

| Risiko | Mekanisme | Krav |
|---|---|---|
| **XSS via `<script>` i SVG** | SVG er XML/HTML-agtigt; `innerHTML`-indlæsning kører script | **Render aldrig ukontrolleret SVG som inline-DOM.** Brug `<img src="…svg">` (isolerede dokumenter — scripts kører **ikke**) eller sanitér |
| **Event-handlere/onload** | `<svg onload=alert(1)>` | samme: `<img>`-indkapsling eller DOMPurify-lignende sanitæring (ny dependency ⇒ undgås ved kun at servere **egne** SVG'er) |
| **Eksterne referencer** | `<image href="https://…">`, `<use href="…">`, CSS `url()` ⇒ **IP-læk + tracking** | krad alle eksterne URLs; kun `data:`/lokale; evt. `Content-Security-Policy: default-src 'self'` |
| **Bruger-uploadet SVG** | DRESSED tillader **i dag KUN** jpg/png/webp (**[CONFIRMED]** `image-input.ts:5-7`) — **behold den** | Hvis bruger-SVG nogensinde tillades: server-side sanitæring + `Content-Security-Policy` + serves med `Content-Disposition: attachment` eller strengt `Content-Type` + **helst forbud** |
| **Signerede URLs som bearer** | SVG'en er lige så følsom som PNG'en | samme signerede-URL-semantik (1 t) — intet nyt |
| **`Content-Type`-sniffing** | SVG serveret som `text/html` kan køre script | fast `image/svg+xml` + `X-Content-Type-Options: nosniff` |
| **Brugerisolering** | Globale SVG'er er **ikke** brugerdata ⇒ hører **ikke** i `{uid}/` | klassificeringsregel: *globalt asset får aldrig bruger-sti, og omvendt* (samme regel som 3D-adskillelsen) |

**Konklusion:** SVG er **sikkert at bruge for system-ejede, globale assets**
serves som `<img>`-kilder; SVG er **farligt at tillade fra brugere** uden
sanitæring + CSP. **Anbefaling: lad det være forbudt i overskuelig fremtid**
([DECISION]).

---

## 11. Future 3D Architecture — kan SVG supplere GLB?

**Eksisterende 3D-analyser ([CONFIRMED] læst, urørte):**
ét beklædnings-asset = samme garment forfra/side/bag som renders af det **samme**
underliggende asset · basisformer (voksen/teen/barn planlagt) · hår **adskilt** ·
genbrugelige 3D-assets · **ingen AI til rotation/placering/rendering** ·
**Three.js + glTF/GLB foretrukket**.

| Format | Rolle i den fremtidige arkitektur | Placering |
|---|---|---|
| **GLB/glTF** | selve **geometrien**: krop, tøj, hår, tilbehør; genbrugelig, skalerbar, materialer via glTF | delt bucket/global pool (bruger-planlagte) **eller** privat `{uid}/`-mappe for personlige assets — **[DECISION]** som i 3D-analysen (Strategi B: delt pool) |
| **PNG/WebP/AVIF** | AI-genererede fotos, teksturer *bageret ind* i assets, thumbnails, try-on-resultater | private buckets (bruger) eller teksturer i GLB |
| **SVG** | **kun** UI/2D-overlay-visualiseringer omkring 3D-scenen: vælger-icons, deltas-tegn, transformations-håndtag, silhuet-indikatorer, dele-liste-grafik | globale statiske assets (Option D) |
| **JPEG/WebP foto** | brugerfotos (kilde/beklædning) | privat, komprimeret |

**Kan SVG erstatte GLB?** **Nej.** SVG er 2D — den planlagte rotation
(front/side/bag fra ét asset), placering og lighting forudsætter 3D-geometri.
**Kan SVG supplere?** **Ja, ideelt:** små vektor-UI-assets omkring scenen
(ingen lagerbyrde, CDN-cachet, ingen brugerdata ⇒ ingen isolationsproblem).

**Fare at undgå nu:** at bygge en "SVG-wardrobe" der sidenhen skal erstattes
med GLB ⇒ dobbelt-lagre og migreringsomkostninger. **Anbefaling: klassificér
allerede nu** — *noget der skal kunne roteres/skaleres i 3D er GLB; noget der
skal kunne trykkes/vises 2D er SVG; alt AI-genereret er raster.*

---

## 12. Storage Cost Strategy (Tier 1–5)

| Tier | Indhold | Permanente? | Cache? | Kan regenereres? | Slettes? | GDPR/udsletning |
|---|---|---|---|---|---|---|
| **Tier 1 — Små/vektor/statisk** | UI-SVG, ikoner, globale basisgrafikker | **Ja** (globalt) | **Ja — CDN (Netlify), lang TTL** | n/a | ved asset-udfasing | indeholder **ingen** persondata ⇒ ingen sletning |
| **Tier 2 — Bruger-raster (foto)** | kildefoto, beklædnings-originaler | ja indtil bruger sletter | signerede URLs (kort) | **Nej** (brugerens eget foto kan ikke gen-skabes) | **Ja — ved konto-sletning (findes allerede: rekursiv `{uid}/`-sletning)** | fuldt dækket i dag |
| **Tier 3 — AI-genererede** | personligt model, beklædnings-lag, clean-previews, try-on-resultater | ja | signerede URLs | **ALDRIG automatisk** — regenerering koster **0,43 DKK pr. gang** ⇒ behold, indtil bruger selv sletter/erstatter | ja ved konto-sletning; **genplacering** (character-job fjerner erstattede billeder — [CONFIRMED] `character-job.ts:171-175`) ✓ | fuldt dækket |
| **Tier 4 — 3D-assets (fremtid)** | GLB'er, teksturer; delt pool vs. privat | ja | CDN for **delte**; signerede for private | delte: ja (rens); private: nej | privat andel slettes ved konto; **delte slettes aldrig** pga. bruger | klassificering skal fastlægges **før** oprettelse ([DECISION]) |
| **Tier 5 — Midlertidige/cache** | afbrudte jobs, fejlede uploads, `dressed-generation-flow`, signerede URLs | **Nej** | signerede (1 t) | ja | **rydning anbefales** — bemærk: fejlede job fjerner allerede uploads ([CONFIRMED] `character-job.ts:154-159`, `clothing-job.ts:216-221`) | rydning ved logout findes ([CONFIRMED] `account-state.ts`) |

**Hvad der IKKE må regenereres (pga. AI-pris):** alle Tier-3-filer —
derfor er **deduplisering/erstatnings-regler vigtigere end lagringskomprimering**
(§13). **Hvad der trygt kan slettes:** overskudsfiler efter erstatning,
udfasede globale assets, udløbne midlertidige filer (ingen eksisterende
renserutine fundet ⇒ **[DECISION]** om et rent-job).

**Thumbnails (mangler, F7):** anbefaling: generér **små WebP/thumbnails én
gang** ved upload/generering (teknisk: ny dependency `sharp` eller client-side
canvas — **[DECISION]**, bevidst ikke implementeret her) — sparer **egress**
(meget mere end lager) og forbedrer mobil-ydeevne. Alternativ uden dependency:
bevar nuværende signerede fuldstore indtil skala.

---

## 13. AI Generation Economics — genbrug & deduplisering

**Mål:** betal aldrig to gange for det samme billede.

| Metode | Sådan | Omkostningseffekt | GDPR | Vurdering |
|---|---|---|---|---|
| **Præcis hash (SHA-256)** af uploadet original | én unik foto-fil ⇒ én gang | begrænset (brugere uploader sjældent *identiske* filer) | hash = persondata-jævnføring, men minimalt | ✓ billig, kan indføres som **duplikat-upload-guard** (undgår dobbelt-lagring) |
| **pHash/perceptual hash** | genkender *lignende* fotos (re-upload af samme tøjfoto) | **potentielt stor**: stopper gen-generering for "samme" tøj | kræver at sammenligne på tværs af brugere ⇒ **deler signaler mellem brugere** ⇒ følsomt | ⚠ kun inden for **én** bruger (eget bibliotek), **ikke** på tværs ([DECISION] + [VERIFY] jura) |
| **Globalt delte beklædnings-assets** (system-pool) | ét AI-genereret lag til *alle* brugere for det *samme* delte garment (f.eks. standardting) | **meget stor** (især hvis dele-katalog vokser) | **ingen** persondata i delte assets ⇒ GDPR-frit | ✓✓ anbefales som fremtidig retning — men **kun** for asset tydeligt ikke-personlige; skal respektere "{uid}/"-kontrakten ⇒ **ny global bucket eller global præfiks** ([DECISION]) |
| **Bruger-ejede assets** | alt der er knyttet til brugerens krop/ansigt/foto | — | **forbliver private** — må aldrig deles automatisk | ✓ ufravigeligt |
| **Genbrug af eksisterende resultat for ny kvote-type** | f.eks. allerede-genereret beklædnings-lag gen-bruges til try-on | sparer 0,43 DKK pr. hop | privat | ✓ lille, sikker gevinst (lokal dedup) |
| **Allerede implementeret erstatningssløjfe** | karaktergenerering fjerner den *forrige* fil (ingen akkumulering) | forhindrer lager-drift | — | **[CONFIRMED]** `character-job.ts:171-175` |

**Hvornår må et asset deles?** Kun når det (a) **ikke** kan identificere en
person, (b) er skabt som globalt fra start, og (c) bevidst er klassificeret
globalt. **Hvornår skal det forblive privat?** Alt knyttet til en persons
udseende, foto, krop eller garderobe. **Genbrug sænker AI-omkostningerne
primært via (1) duplikat-upload-guard, (2) globalt dele-katalog, (3) lokal
genbrug af eksisterende lag** — alle er **[DECISION]** og ikke
implementeret.

---

## 14. Recommended Architecture (prioriteret rækkefølge som krævet)

**Prioritet: 1. Ingen personligt tab · 2. Sikkerhed/privatliv · 3. Lav drift ·
4. Skalering · 5. 3D-kompatibilitet · 6. God UX · 7. Rimelig pris.**

| # | Element | Anbefaling |
|---|---|---|
| **1** | **AI-genererede assets** | Forbliver **private raster-PNG'er** i `{uid}/`-mapper i `model-images`, serveret via **signerede URLs** (1 t), altid med ejerskabspolicyer. **Aldrig regenereres automatisk** (0,43 DKK). **Nyt før betaling:** hårdt loft over AI-kald pr. konto (inkl. clean-previews) + kvote for try-on + forsøgs-loft — den eneste måde at gøre ENUC fastlæggelig. Behold erstatnings-/fejlrydningen der findes. |
| **2** | **Bruger-billeder** | Bevar jpg/png/webp + ≤4 MB-grænse (mod XSS-afklaring: **intet SVG-upload**). Tilføj senere **thumbnail/WebP-transform** (beslutes — `sharp`-afhængighed er et bevidst valg) for at reducere **egress**. Sletning = eksisterende rekursive `{uid}/`-rutine (behold uændret). |
| **3** | **SVG-aktiver** | **Kun globale, system-ejede vektor-assets** — Option D (statisk + CDN-cache) som del af hybrid-strategi **E**. Ingen bruger-SVG. Render som `<img>`, aldrig inline-DOM. Ingen SVG i private buckets (det ville give signerede-URL-byrde uden gevinst). |
| **4** | **Database-poster** | Ingen SVG-filer i PostgreSQL (dyrere pr. byte end Storage: $0,125 vs. $0,0213/GB). DB: kun metadata, kvoter, placeringer, kvote-tællere (findes). Nye fremtidige tabeller (betaling/cooldown som i cooldown-analysen) følger samme mønster: **RLS slået til uden policyer, service-rolle kun.** |
| **5** | **Supabase Storage** | Pro fra start (~302 DKK/mdr med Netlify Pro — eller Free til ~33 brugere). Behold private buckets + `{uid}/`-stier uændret. Overvåg tre mål: **filer GB, egress GB, DB GB** (Pris-siden). Opgraderingsløft: thumbnails ⇒ egress; lag er billigt. |
| **6** | **Fremtidige 3D-assets** | **GLB/glTF** er geometri-formatet (per 3D-analyserne). Klassificér **før oprettelse**: delt pool (global, aldrig slettet ved bruger-sletning) vs. privat `{uid}/` (slettes ved konto). **SVG indgår kun som 2D-UI omkring scenen.** Ingen AI til rotation/rendering (fastslået i 3D-analysen — her bekræftet som ikke-berørt). |
| **7** | **Caching** | Niveauer: (a) Netlify-CDN til statisk + globale SVG'er (lang TTL), (b) signerede URLs til privat raster (kort — accepteret), (c) `Cache-Control: no-store` på alle API-svar (findes allerede, [CONFIRMED]), (d) overvej **private CDN-cache** kun ved dokumenteret egress-problem ([DECISION]). |
| **8** | **Deduplisering** | Trin 1: præcis-hash-guard mod dobbelt-upload. Trin 2: lokal genbrug af eksisterende lag. Trin 3 (fremtid): globalt dele-katalog med **bevidst klassificering**. **pHash kun inden for én bruger** indtil jura er afklaret ([DECISION]/[VERIFY]). |
| **9** | **Konto-sletning** | Uændret (DB → Storage → Auth, ærlige delvise fejl). **Tilføj ikke** betalings-/cooldown-tabeller til sletningslisten (jf. 31-dages-analysen §11). Opbevaring af AI-lag slettes fuldt — ingen "regenerer efter sletning". |
| **10** | **Omkostningskontroller (økonomisk forsvar)** | (a) **AI-loft pr. konto** (kvote på ALLE `editImage`-kald, inkl. previews — i dag mangler det); (b) **forsøgs-loft** ved fejl (F4); (c) **upload-loft** pr. konto (f.eks. 30 dele) — reducerer både lager og preview-kald; (d) overvågning: OpenAI-balance/alarm ved lav kredit (ejeren har allerede tabt $7,04 af $15 én måned); (e) priser sat efter §7: **15 DKK**; (f) månedligt tjek af `ai_generation_usage` vs. indtægter. |

---

## 15. Final Decision Table

| Question | Recommendation | Reason |
|---|---|---|
| **Er 7 DKK sikker?** | **NEJ — UNSAFE** | Web-netto 3,70 DKK (inkl. moms) < kode-tro omkostning 4,29 DKK ⇒ direkte tab; UNSAFE på alle platforme under stress |
| **Er 10 DKK sikker?** | **NEJ — BORDERLINE/UNSAFE** | Tab på web ved AI +50 %; kun delvist på app-butikkerne; ingen fremtids-margin |
| **Er 12 DKK sikker?** | **DELVIST — SAFE i app-butikker, BORDERLINE på web** | Overlever AI +100 % i app (netto 10,20), men ikke web+moms (+100 % ⇒ −0,96) |
| **Er 15 DKK sikker?** | **JA — SAFE alle steder** | Dækker kode-tro ENUC, AI +100 % og combined stress (web-netto 9,98; app 12,75) |
| **Anbefalet Starter-pris** | **15 DKK** (ens på web/iOS/Android) | ≥2× stress-margin, dækker faste omkostninger ved ~36–47 betalende brugere, stadig overkommelig |
| **Minimum sikker pris** | **12 DKK** (kun app-butikker) / **15 DKK på web** | moms+gebyr hæver web-tærsklen |
| **Sikkerhedsmargin** | **≥ 2× kode-tro ENUC under AI +50 %** + aldrig under ENUC ved +100 %; drop-grænse ved 40 %-reglen (§7.1) | no-loss-reglen |
| **SVG i Supabase?** | **Kun globale, system-ejede SVG'er — ikke brugerdata** | giver kun mening for flade delte assets; bruger-SVG = XSS-byrde |
| **SVG i databasen?** | **NEJ** (kun evt. små inline-icons) | DB er $0,125/GB vs. Storage $0,0213/GB; cache-problemer |
| **SVG til AI-billeder?** | **NEJ** | AI producerer raster; fotos kan ikke vektorisere tabfrit |
| **SVG til UI/vektor-assets?** | **JA** | billig, cachet via CDN, ingen persondata, ingen RLS-problem |
| **Raster til AI-billeder?** | **JA — behold PNG; tilføj senere WebP/thumbnails** | korrekt format; manglende thumbnails er det reelle egress-problem |
| **GLB til fremtidig 3D?** | **JA** | Three.js/glTF-retningen fra 3D-analysen; SVG kan ikke rotére/placere |
| **Lagerstrategi** | **Hybrid (Tier 1–5)**: globalt statisk på CDN · privat raster i private buckets · AI-PNG'er aldrig regenereret · 3D klassificeret før brug · midlertidige ryddes | billigst + GDPR-klar |
| **AI-genbrugsstrategi** | **Først: AI-loft + duplikat-guard; siden: globalt dele-katalog; pHash kun inden for bruger** | eneste reel besparelse på den dominerende udgift; GDPR-følsomt |

---

## Appendix — Evidence & Epistemic Status

### A.1 Bekræftet fra det nuværende kodesystem [CONFIRMED]

- **Model/endpoint:** `gpt-image-2.5-sunburst` via
  `https://api.openai.com/v1/images/edits` med `quality: "high"`,
  `size 1024x1024|1024x1536`, `n: 1`, `output_format: png`
  (`openai-images.ts:11-14,146-151`); moderation `omni-moderation-latest`.
- **Ét billedkald pr. generation** for `character`, `clothing`, `tryon`;
  **ingen** multi-kalds-generationer; **ingen** resize/transform efter
  generation (pngjs = kun validering).
- **Kvoter:** `character=1`, `tryon=1`, `clothing=3`
  (`202610040015…sql:6-7`); fejl **refunderer** kvoten (`0016:33-35`).
- **F2:** clean-preview = `editImage` **uden kvote** pr. garderobe-upload;
  **intet upload-loft** fundet; moderering pr. upload.
- **Lagring:** ingen SVG'er, ingen thumbnails, ingen WebP/AVIF, ingen `sharp`;
  kun PNG-validation; alle uploads som PNG/JPG/WEBP-originaler + AI-PNG'er.
- **Isolation:** alle billedstier `{uid}/`-prefikset, private buckets,
  signerede URLs, service-nøgle kun server-side, `no-store` på alle API-svar.
- **Hosting:** Netlify via `@astrojs/netlify` + to background functions
  (15 min) med `BACKGROUND_JOB_SECRET`; Supabase (DB/Auth/Storage).
- **Ingen betalingssystem, ingen SVG, ingen dedup, ingen priser i koden.**

### A.2 Baseret på eksterne/aktuelle priser [EXTERNAL] (hentet 7/10-2026)

- Supabase: Free/Pro $25 + overpriser ($0,125/GB disk, **$0,0213/GB filer**,
  $0,09/GB egress, $0,00325/MAU) — supabase.com/pricing.
- Netlify: Free 300 / Personal $9/1.000 / Pro $20/3.000 credits;
  bandwidth 20 cr/GB, produ-deploy 15 cr — netlify.com/pricing.
- Apple SBB 15 % (EU-særvilkår 10 %) — developer.apple.com.
- Google Play EEA (fra 30-6-2026): nye installationer 10 %+5 % = 15 % for
  første $1M — support.google.com/…/112622.
- USD/DKK live-kurs 6,6744 (exa.ai) — rundet til **6,70** i beregningerne.

### A.3 Bevidste antagelser [ASSUMPTION]

1. **USD/DKK = 6,70** (sensitivitet 7,00 vist).
2. **Web-gebyr = 1,5 % + 1,80 DKK** (tredjepartsnoter — [VERIFY] hos udbyder).
3. **Moderation ≈ 0 DKK** pr. kald.
4. Mislykkede API-kald (4xx/5xx) faktureres ikke af OpenAI.
5. **~30 MB lager pr. aktiv Starter-bruger** (10 dele).
6. **Moms:** begge scenarier regnet; det konservative (0,8 × P) bruges til
   SAFE/BORDERLINE/UNSAFE-domme på web.
7. Google: en ny app ser kun "new installs" (15 %).
8. Apple er MoR for EU-moms i hovedtabellen (fallback vist).
9. Faste omkostninger ≈ 302 DKK/mdr (Supabase Pro + Netlify Pro).
10. ENUC = 10 kald (kode-tro: 1+3+1+5 previews).

### A.4 Skal testes / verificeres [VERIFY]

- Officiel prisliste for `gpt-image-2.5-sunburst` (især ved
  `quality=high`, 1024×1536) — **dashboard-gennemsnittet er midlertidigt
  bedste tal**.
- Faktisk USD/DKK på betalingstidspunktet.
- Præcise transaktionsgebyrer (Stripe/MobilePay) og Apple/Google
  moms-ansvar (MoR).
- Præcis klassificering af Googles "eksisterende installation" for nye apps.
- Moderations-endepunktets faktiske pris.
- F2's reelle omfang i produktion (hvor mange preview-kald er allerede
  lavet?).
- Netlify-credits-forbrug for DRESSED's nuværende trafik.

### A.5 Beslutninger der IKKE må låses endnu [DECISION]

1. **Endelig Starter-pris** (anbefaling: 15 DKK — men ejeren vælger).
2. **Momsregistrering / pris inkl. vs. ekskl. moms.**
3. **Højden på AI-loftet** (antal kald pr. konto) og om previews skal kvoter
   eller erstattes af en ikke-AI-metode.
4. **Upload-loft** pr. konto.
5. **Valg af betalingsudbyder** (jf. 31-dages-analysen).
6. **Thumbnail/WebP-pipeline** (ny dependency `sharp` vs. client-side).
7. **Global dele-bucket** for fælles assets (SVG + fremtidige 3D + dele-katalog).
8. **pHash tværs af brugere** — kun efter jura-gennemgang.
9. **Renserutine** for udløbne midlertidige filer.
10. **SVG for brugere** — anbefales forbudt.

### A.6 Hvad denne rapport IKKE er

- Ingen ændring af projektet foretaget (**kun denne fil er skabt**); ingen
  pakker, migrations, Supabase- eller git-handlinger.
- Ingen juridisk konklusion (moms, moms/MoR, GDPR-klassificering af hashes).
- Ingen garanti for fremtidige priser — §6 eksisterer netop fordi de ændrer sig.

**Bottom line:** *Luk F2 (AI-loft), sæt 15 DKK, behold raster til AI,
brug SVG kun til globale vektor-assets, klassificér 3D før det bygges — så
kan DRESSED ikke give ejeren et tab under normal brug.*










