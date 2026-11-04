# DRESSED 3D Model View — Clothing Navigation Analysis

> **Type: READ-ONLY UX + TEKNISK ANALYSE.** Ingen produktionskode, ingen
> migrations, ingen Supabase-ændringer, ingen dependencies og intet UI er ændret.
> **Denne fil er det eneste nye artefakt.** Ingen commit/push/merge/stash/reset/
> rebase/checkout er udført.
>
> **Branch:** `safety-branch` (samme state som ved 3D-analysen).
> **Bygger direkte på:** `analysis/dressed-3d-model-z-axis-analysis.md`
> (3D-engine, `placement3d`, front/side/back, hair, adult/teen/child, hash-cache)
> — samt de øvrige `analysis/`-dokumenter og `docs/`-specifikationen.
>
> **Evidensmarkering:**
> **CONFIRMED** = læst i kode/migration/eksisterende analyse i dette repo ·
> **INFERRED** = logisk slutning fra bekræftet materiale ·
> **UNVERIFIED** = kræver brugertest, måling eller ekstern research (ikke kørt her).
>
> **Afgrænsning:** dette er en *specifikation for en fremtidig implementation*.
> Intet her er implementeret. Hvor analysen foreslår ændringer i eksisterende
> adfærd, er det markeret bevidst i §17.

---

## Executive Summary

DRESSED vil gøre modellvisningen til et **interaktivt digitalt prøverum**, hvor
tøjet kan skiftes uden at forlade modellen. Denne analyse vurderer
navigationsmodeller (A–G), krops-/kategorinavigation, gestus-konflikter med den
fremtidige 3D-rotation, `editingItemId`-genbrug, outfits, mobil, performance,
AI-omkostning, hår, adult/teen/child, tilgængelighed og visuel identitet.

De afgørende konklusioner:

1. **Anbefalingen er "Focused Slot Navigation" (mulighed G = F forstærket):**
   navigation sker via **slot-kontroller** (→ i den eksisterende outfit-liste +
   en lille skærmfast pill på modellen for det fokuserede item), **aldrig** ved
   at en horisontal swipe på selve modellen betyder "næste tøj". På modellen er
   den vandrette drag allerede optaget (flytning af valgt tøj i dag,
   kamera-orbit i 3D), og samme flade er optaget af tap-valg, pinch og wheel.
   Bevisførelse: gestus-prioritetsmodellen i §4.

2. **Indfør `clothing_slot` som adfærds-enhed og `body_region` som
   præsentations-enhed.** Kategori (`tops`, `jackets`, …) bliver *data*, ikke
   logik, så `if (category === "tops") …` undgås overalt. Dress/jumpsuit/coat
   håndteres af **eksklusionsregler mellem slots**, ikke hardkodede undtagelser.
   Dette er i tråd med 3D-analysens `placement3d.node`: **slot ↔ node** er det
   samme begreb.

3. **`editingItemId` forbliver det ENE sted, der definerer "det aktive item"**
   (koden siger det allerede bevidst: *"editingItemId is the ONLY selection
   state"*, `wardrobe.astro:854`). Navigation skriver **kun** til det felt og
   genbruger den eksisterende editor-tilstandsmaskine. **Ingen** ny
   selections-tilstand indføres.

4. **Placering følger item'et, aldrig pladsen i outfittet** (uændret princip).
   Når "næste top" erstatter den nuværende, arver den nye top **sin egen**
   placement (persisted eller default). Session-Overrides commit'es via den
   eksisterende `commitPlacementOverride` **før** skiftet, så intet tabes.

5. **Ingen AI, ingen server-kald pr. skift.** Navigation er en ren client-side
   asset-swap: `selectedItems` opdateres, lag-rækkefølgen genbruges, rendret
   fornyes. Front/side/back forbliver konsistent, fordi skiftet udskifter **én
   slot-asset**, mens kameraet frit roterer (3D-analysens "én mesh → alle vinkler").

6. **Ting, der IKKE må ændres:** X/Y-scaling-semantik, drag/pinch/wheel-
   arkitektur, tap-valg, saved outfits, `placement`-JSONB, 5-items-grænsen.
   Navigation er **additiv**; den eneste reelle berøring er, at nye knapper
   placeret *inde* i `#wardrobe-model` skal springe over den delegerede
   pointer-håndterer (dokumenteret præcist i §17).

---

## Scope, Sources and Method

| Kilde | Hvad er brugt |
|---|---|
| `analysis/dressed-3d-model-z-axis-analysis.md` | skærmrum vs. modelrum, `placement3d`, front/side/back-identitet, hair-slots, adult/teen/child, performance-, cache- og AI-modeller |
| `src/pages/wardrobe.astro` (1.486 linjer) | `selectedItems`, `editingItemId`, `placementOverrides`, tap/drag/pinch/wheel, outfit-liste, kategori-filter, saved outfits, 5-items-grænse |
| `src/lib/shared/clothing-categories.ts` | 22 kategorier, 15 anchors, `CLOTHING_LAYER_ORDER`, `CLOTHING_FILTER_GROUPS` |
| `src/lib/shared/clothing-placement.ts` | resolver, clamp, `scaleX/scaleY`-kontrakt |
| `src/lib/client/profile-outfits.ts`, `wardrobe-ai.ts` | samme resolver i Profile, outfit-`item_ids`-kontrakt |
| `docs/DRESSED-PROJECT-SPECIFICATION.md` | Rule 1/2/6/10–17 (bevar adfærd, browser authority, touch safety) |
| `src/styles/wardrobe.css` | outfit-række-layout, saved-outfit-pager, `.placement-readout`, disabled/focus-tilstande |

Ingen ekstern research er nødvendig. Vurderinger af "forståelighed uden
instruktioner" er **UNVERIFIED** (kræver brugertest) og markeres som sådan.

---

## Current Selection & Interaction State (CONFIRMED)

```text
MEMBERSKAB (hvad der er på modellen)   : selectedItems[] (lag-rækkefølge; ved ADD
                                          sorteret via clothingLayerOrder)
AKTIVT ITEM (kan manipuleres)          : editingItemId (string | null)
                                          · sættes af ADJUST-knap OG af tap på lag
                                          · nulstilles af closePlacementEditor()
                                          · lukkes automatisk hvis item fjernes
SESSION-PLACEMENT (usavede justeringer): placementOverrides: Map<itemId, Placement>
PERSISTED PLACEMENT (pr. item)         : wardrobe_items.placement (JSONB)
PARITET-REGEL                          : placement tilhører ITEM'et, aldrig outfittet
GREPPE                                 : tap (≤8 px) = select · drag på aktivt lag = x/y
                                          pinch på aktivt lag = scale · hold+wheel = scale
                                          topmost-box hit-test (clothingLayerAtPoint)
GRÆNSE                                 : max 5 items pr. outfit (wardrobe.astro:1250)
FILTER                                 : 22 kategori-knapper + ALL (renderCategoryFilters)
SAVED OUTFIT                           : item_ids (text[]) — LOAD erstatter selectedItems
```

**To fakta, der styrer hele designet:**

1. **"Valgt" og "redigeres" er i dag det samme felt.** Der findes ikke en
   tilstand, hvor et item er aktivt men panelet lukket. Navigation kan derfor
   (a) altid åbne panelet (én adfærd, genbruger maskinen) eller (b) kræve en ny
   "fokuseret men ikke-redigeret" tilstand — sidstnævnte ville være en **anden
   selections-tilstand**, som opgaven udtrykkeligt ønsker at undgå.
   **Anbefaling: (a)** — begrundelse i §3.
2. **Outfit-rækkerne er allerede en per-item-kontrolflade** (billede, navn,
   ↑/↓, ×, ADJUST). Det er det naturlige, gratis sted at lægge ←/→.

---

## 1. Navigation Models (A–G)

### 1.1 Beskrivelse

| | Model |
|---|---|
| **A** | Faste ← →-pilte ved de relevante kropsområder (`← TOPS →` ved overkroppen osv.) |
| **B** | Vandret swipe direkte på modellvisningen |
| **C** | Swipe specifikt på det valgte tøjstykke |
| **D** | Lille tøj-karrusel rundt om modellen (thumbnails) |
| **E** | Pile + swipe sammen |
| **F** | Kategorikontroller uden for modellen + pile/swipe inde i den |
| **G** | **Hybrid (anbefalet): outfit-liste-knapper + skærmfast fokuserings-pill + (senere) stribe under modellen; swipe KUN på striben** |

### 1.2 Sammenligning på alle krævede kriterier

**INFERRED** (ekspertvurdering ud fra kode + 3D-analyse). `●` = god,
`◐` = acceptabel med betingelser, `○` = svag/konfliktfyldt.

| Kriterie | A Pile ved krop | B Swipe på model | C Swipe på valgt tøj | D Karrusel omkring | E Pile+swipe | F Udefra+indad | **G Hybrid** |
|---|---|---|---|---|---|---|---|
| Desktop-brugbarhed | ◐ meget fokus-træk | ○ mus-swipe unaturligt | ○ samme | ● god | ● | ● | **●** |
| Mobil-brugbarhed | ○ små mål midt på skærmen | ◐ naturlig men konfliktfyldt | ○ optager drag-fladen | ◐ pladsmangel | ● | ● | **●** |
| Opdagelighed | ● synlig ved krop | ○ usynlig | ○ skjult | ● meget synlig | ● | ● | **●** |
| Tilgængelighed | ○ svær at mærke korrekt | ○ ingen knap-kontrol | ○ ingen | ◐ delvist | ● | ● | **●** (rigtige `<button>`er) |
| Visuel renhed | ○ støjer over modellen | ● ren | ● ren | ◐ fylder omkring 2:3-boksen | ◐ | ● | **●** |
| 90s/Clueless-identitet | ◐ risikerer moderne "shoppable model"-look | ○ ingen anker | ○ | ◐ karrusel = ecommerce-signal | ◐ | ● | **●** (genbruger række/pager-sprog) |
| 3D-kompatibilitet | ○ ankring/rotation uklar | ○ konflikter med orbit | ○ konflikter med orbit | ○ kamerafølsom | ◐ | ● | **●** (skærmfaste kontroller) |
| X/Y/Z-placering | ● ingen berøring | ◐ konkurrerer om vandret drag | ○ konkurrerer | ● | ● | ● | **●** |
| Modelrotation | ○ "følger eller ej" uklart | ○ direkte konkurrent | ○ direkte konkurrent | ○ | ◐ | ● | **●** |
| Selection | ◐ pil-zoner kan spise taps | ○ | ○ samme flade | ● uden for model | ◐ | ● | **●** |
| Drag | ○ zoner inde i drag-område | ○ direkte konkurrent | ○ direkte konkurrent | ● | ◐ | ● | **●** |
| Pinch | ● ingen berøring | ◐ 2-finger afbrydes evt. | ○ 3 betydninger samme sted | ● | ◐ | ● | **●** |
| Performance | ● | ● | ● | ◐ thumbnails skal forudindlæses | ◐ | ● | **●** |
| Gestus-konflikter | ● lav | **○ høj** (orbit/drag/scroll) | **○ meget høj** (drag+pinch+wheel+swipe) | ● lav | ○ arver B/C | ● lav | **● lav** |

### 1.3 Hvorfor de enkelte muligheder afvises som primær

- **B (swipe på modellen):** den vandrette akse betyder allerede noget andet.
  I dag: vandret drag = `placement.x` (flytning af tøjet). I 3D: vandret drag på
  tom flade = kamera-orbit (3D-analysens gestus-tabel). At lægge "næste item"
  oveni gør gestusen **timing-afhængig** ("kort drag = næste, langt drag =
  flyt/roter"), hvilket er den klassiske årsag til utilsigtet skift. Afvis.
- **C (swipe på det valgte tøj):** værre end B, fordi netop den overflade er
  allermest optaget: drag (x/y) + pinch (scale) + hold+wheel (scale) + tap
  (skift aktivt item) lever alt sammen på `.dressed-clothing-layer--editing`
  (`wardrobe.css:1065`). En fjerde betydning for samme bevægelse gør systemet
  uforudsigeligt. Afvis.
- **A (faste pilte ved kropsområder):** indeholder kernen i den gode idé
  ("styring knyttet til kroppen"), men som *fast* struktur fejler den på:
  22 kategorier vs. 6 kropsområder, overlap med tøjets hit-box, rotation i 3D
  (følger pilene med — så forsvinder de bagfra — eller er de skærmfaste, og så
  er de ikke længere "ved kroppen"), tastatur/screen-reader-markering og visuel
  støj. **Kernen bevares som den fokuserings-pill, der kun vises for det aktive
  item (§5).**
- **D (karrusel rundt om modellen):** visuelt fristende, men optager plads omkring
  en boks, der allerede er låst til 2:3 (maks 493→413→333 px), og lægger
  thumbnails i modellens luft. Bevares som **variant uden for canvaset** (stribe
  under modellen).
- **E (pile + frit swipe):** arver B/C's konflikter uden at løse dem.
- **F (god base):** rigtig retning — kontroller uden for modellen, suppleret
  indeni. Mangler præcis *hvor* indeni, og hvad "indeni" må gøre.

### 1.4 Anbefaling — "Focused Slot Navigation" (G)

```text
PRIMÆR (desktop + mobil):
  Outfit-listen (#current-outfit-items): hver række = ét slot
     [thumb] PINK SHIRT   [↑] [↓] [×]
        ‹  pink shirt  ›        ← NYE knapper: forrige/næste i samme slot
     [ ADJUST ]

SEKUNDÆR (begge platforme):
  Skærmfast pill på modellen for det FOKUSEREDE item (editingItemId):
     ‹  PINK SHIRT · 2/7 ›      (fast position i canvaset, aldrig over ansigtet)

TERTIÆR (senere fase — "nice to have"):
  Thumb-stribe UNDER modellen for det fokuserede slot.
     ENESTE sted hvor horisontal swipe er tilladt (touch-action: pan-x kun der).

UDEN FOR MODELLEN (består uændret):
  Kategori-filter + ADD/REMOVE i tøjpanelet. Tilføjelse af NYE slots sker her;
  navigation erstatter kun i allerede besatte slots.
```

**Begrundelse:** hvert kontrolpunkt findes allerede i layoutet (outfit-rækker,
`.placement-readout`, saved-outfit-pagerens `‹ n/m ›`-sprog), så genbruddet er
maksimalt, gestus-konflikterne minimale, og adfærden er **identisk i 2D i dag
og 3D senere** — fordi kontrollerne er uafhængige af, hvad der renderes i
canvaset.

---

## 2. Body-Area / Category Navigation

### 2.1 Skal kategorier visuelt hæftes på kropsregioner?

Kropsregioner er en **god mental model for brugeren** og en **dårlig model for
adfærd**. Derfor anbefales et todelt system (detaljeret i §8):

```text
body_region  = PRÆSENTATION   (hvordan grupperes kontroller visuelt)
clothing_slot= ADFÆRD         (hvad kan erstatte hvad, hvad udelukker hvad)
category     = DATA           (tops, jackets, skirts … eksisterer uændret)
```

Vurdering af de fem foreslåede former:

| Form | Vurdering | Konklusion |
|---|---|---|
| **Faste pilte omkring modellen** | Skaber 5–6 faste kontrolpar; allerede afvist som primær i §1.3 | **Nej** som fast struktur |
| **Kontekstuelle kontroller, når et område vælges** | God idé: styringen vises, når den er relevant | **Ja** — det er præcis fokuserings-pillen (ét item = ét slot = ét kontrolpar) |
| **Usynlige hit-zoner** | Farligst af alle: zoner over modellen vil **spise taps** beregnet på selektion/drag (den delegerede pointer-model på `#wardrobe-model` behandler alt indeni ens) og gør tilgængelighed umulig (intet fokus, intet navn) | **Nej** — afvises eksplicit |
| **Labels ved kropsområder** | Passiv information, ingen konflikt, men støjer ved små skærme og ved rotation | **Ja, som valgfri/afskåret detalje** (SHOULD HAVE → senere), aldrig som eneste navigation |
| **Flydende kontroller** | Ja — pillen er netop en flydende, skærmfast kontrol | **Ja** (primær/sekundær) |

**Anbefalet kombination:** kontekstuelle, skærmfaste kontroller for det
fokuserede slot + permanente slot-knapper i outfit-listen + (senere) passive
regions-labels som en valgfri "BODY MAP"-tilstand i 90s-stil. **Ingen usynlige
hit-zoner.**

### 2.2 Tøj, der dækker flere kropsregioner

Eksempler og hvordan slot-modellen håndterer dem uden hardkoding:

| Item | Region (visning) | Slot (adfærd) | Regel |
|---|---|---|---|
| **Kjole (dress)** | `full_body` | `dress` | **Ekskluderer** `top` og `bottom` (og `skirt`) — ét slot ejer hele udtrykket |
| **Jumpsuit** | `full_body` | `dress` (eller `jumpsuit` som alias af samme slot) | Samme eksklusionsregel |
| **Frakke (coat)** | `upper_body` + visuelt `full_body` | `outerwear` | Ingen eksklusion — den lægges **oven i** `top`; lag-styrkes af `CLOTHING_LAYER_ORDER` (jackets = 40 > tops = 30) |
| **Oversize jakke** | som coat | `outerwear` | Samme |
| **Lang cardigan** | `upper_body` | `outerwear` | Samme |
| **Fuld-body accessorie (tørklæde, selebukser)** | efter geometri | sit eget slot | Ingen overlap med `top`/`bottom` |

**Nøgleprincip:** *region bestemmer, hvor knapperne vises; slot bestemmer, hvad
der erstatter hvad; `clothingLayerOrder`/`shell` bestemmer, hvad der er ovenpå.*
Der findes derfor **ingen** kodegren, der skal gætte "dækker dette tøj hofterne?".

### 2.3 Hård regel mod hardkoding

Alt navigation- og regionslogik skal udledes af **én tabel** (se §8), som er
data i `lib/shared`. Ingen steder i UI-koden må sammenligne kategorinavne
direkte. Eksisterende `CLOTHING_LAYER_ORDER` og `CLOTHING_PLACEMENT` bliver
liggende uændret og bruges fortsat til lag-rækkefølge og default-placement
(§17).

---

## 3. Reuse of the Existing Selection System

### 3.1 Kan `editingItemId` forblive single source of truth?

**Ja — bekræftet og anbefalet.** Koden siger det allerede bevidst:

> *"editingItemId is the ONLY selection state — this just re-opens the editor
> for the garment under the tap (same mechanism as the ADJUST button)."*
> (`wardrobe.astro:854-857`)

Navigation skal derfor **ikke** indføre `navigationItemId`, `activeSlot` eller
lignende som ny tilstand. I stedet:

```text
navigateSlot(slot, +1 | -1)
   1. Find det aktive item:  activeItem = selectedItems.find(i => i.id === editingItemId)
      (findes det ikke — ingen pil aktivitet udover outfit-rækken, som selv
       angiver hvilket item den styrer)
   2. Bestem slot for activeItem (via slot-tabellen, §8)
   3. Byg kandidatlisten: AI-ready items i samme slot, tilgængelige for
      primaryCharacterBaseType, i stabil, deterministisk rækkefølge
   4. Skift indekset (wrap-around) → nextItem
   5. COMMIT: await commitPlacementOverride(editingItemId)   ← genbrug, ingen ny logik
      (skipper automatisk hvis intet er ændret — isSamePlacement)
   6. Erstat på samme indeks i selectedItems (bevar lag-position)
   7. editingItemId = nextItem.id  →  openPlacementEditor(nextItem.id)
   8. renderCurrentOutfit(); renderClothingItems();
```

**Ingen ny tilstand, ingen ny persistensvej, ingen ny HTTP-kald.**

### 3.2 Konsekvenser pr. felt (spørgsmålene fra opgaven)

| Felt | Effekt af `CURRENT TOP → NEXT TOP` | Begrundelse |
|---|---|---|
| **`editingItemId`** | Sættes til det nye item-id | Én kilde; panelet viser straks det nye navn og dets placement-readout |
| **`placement` (persisted)** | **Uændret for begge items.** Den nye top har sin egen `wardrobe_items.placement` (eller `null` → default); den gamle beholder sin | Placement tilhører item'et (uforandret princip) |
| **`placementOverrides` (session)** | Den gamle items usavede override commit'es **før** skiftet (trin 5) og bliver derefter siddende i mappen som request-cache; den nye items override (hvis nogen) finder sted via resolveren | Intet tab, ingen overraskende stille tabt justering |
| **`scale` / X / Y (i dag)** | Følger det nye item's egne værdier — **ingen automatisk overførsel af skala fra forrige top** | Overførsel ville bryde "placement = item-ejendom" og skjule brugerens tidligere justering af det nye item |
| **`scaleX/scaleY` (FREE)** | Samme: nyt item, egne akser (eller default) | Samme regel; kontrakten i `clothing-placement.ts` røres ikke |
| **Z (`placement3d.shell` m.m.)** | Samme princip: det nye item har sin egen `placement3d`, ellers kategori-default | Direkte fra 3D-analysens §Z-Axis |
| **Rotation** | Kameraet røres **aldrig** af navigation; item-rotation er item-ejendom | Kamera er aldrig data (3D-analysen, Z4) |
| **Valgt tilstand (`selectedItems`)** | Item'et **erstattes på sit indeks** — antal, lag-rækkefølge og 5-grænsen bevares | Samme `clothingLayerOrder`-bånd (tops/shirts/sweaters = 30), så `zIndex` er identisk |
| **Outfit-tilstand** | Det aktuelle outfit ændres **i hukommelsen**, præcis som ADD/REMOVE gør i dag | Ingen persistens før SAVE OUTFIT |
| **Saved outfit-tilstand** | **Helt urørt** — `savedDressedOutfits` ændres ikke, før brugeren trykker SAVE OUTFIT med det nye `item_ids`-sæt | `saveDressedOutfit(…, selectedItems.map(id))` |
| **Grid-tilstand** | `renderClothingItems()` opdaterer ADD/REMOVE-markeringen (det nye item bliver markeret, det gamle ikke) | Eksisterende funktion |

### 3.3 Kan to tops koeksistere? (forud for §9)

Ja — **men kun på tværs af slots** (fx `top` + `outerwear`). Inden for **ét**
slot er der højst ét item; det er netop det, der gør "→ næste" entydigt.
Eksisterende adfærd bevarer sig selv: dagens bruger kan allerede have både
`tops` (30) og `jackets` (40) valgt, og det er præcis to forskellige slots.

### 3.4 Kandidatliste — hvad er "næste"?

**Designbeslutning (skal fastlægges før implementation):**

```text
KANDIDATER = { item ∈ clothingItems
             · slot(item) == slot(active)
             · aiReadyAssets[baseType].generationVersion === CURRENT (3)
             · ikke allerede optaget af et andet slot i outfittet }

RÆKKEFØLGE (anbefalet): categoryOrder (clothingLayerOrder) → createdAt → id
                        (deterministisk, stabil på tværs af sessioner)
WRAP-AROUND: ja (cirkulær) — som saved-outfit-pageren; vis "2/7"
             Undtagen: kun 0 eller 1 kandidat → begge pile disabled
AFVIS: at tilføje et nyt item, når 5 allerede er valgt (navigation er 1:1-erstatning,
       så grænsen overholdes automatisk; ADD af nyt slot bruger stadig panelet)
```

---

## 4. Future 3D Interaction Conflicts — Gesture Priority Model

### 4.1 Det ubesvarede problem (opgavens eksempel)

En vandret drag på modellen kan betyde tre ting: (1) roter modellen,
(2) flyt det valgte tøj, (3) skift til næste tøj. Svaret her er **ikke** at
finde et smart disambiguerings-trick, men at **fjerne mening nr. 3 fra den
overflade**.

### 4.2 Prioritetsladder (gældende for både 2D i dag og 3D senere)

Prioritet afgøres af **(1) hvor gestusen starter → (2) antal pointers →
(3) bevægelsens retning**. **Aldrig af timing alene** (kort vs. langt drag
afvises bevidst som disambiguering — det er utilregneligt og forårsager
utilsigtet navigation).

| # | Betingelse | Handling | Status |
|---|---|---|---|
| 1 | `pointerdown` på en UI-kontrol **uden for** `#wardrobe-model` (pil i outfit-liste, kategori-knap, slider, ADJUST) | Denne kontrol — modelhåndteringen ser aldrig eventet | Findes i dag |
| 2 | `pointerdown` på en ny knap **inde** i modellen (fokuserings-pill) | Knappen; håndtererens tidlige gren springer pillen over (§17.1) | **NY** |
| 3 | **To eller flere pointers** | Pinch: på aktivt lag = `placement.scale` (uændret); på tom flade = kamera-zoom (3D, senere). **Aldrig navigation** | Findes i dag / 3D-udvidelse |
| 4 | Én pointer, starter på det **aktive** lag (`--editing`) | Flytning x/y (i 3D: u/v i nodens tangentplan) + wheel-scale ved venstre-hold | Findes i dag |
| 5 | Én pointer, starter på **ikke-aktivt** lag eller tom flade | Tap (≤8 px) = skift `editingItemId` (findes). Bevægelse > 8 px: **2D = intet** (som i dag), **3D = kamera-orbit** | Findes / 3D |
| 6 | Vandret bevægelse på modellen | **Er aldrig navigation** | Regel |
| 7 | Vandret bevægelse på thumb-striben (senere) | Navigation i det slot, striben viser (`touch-action: pan-x` kun der) | NY (senere fase) |
| 8 | Pen | Samme sti som mus (Pointer Events); hover kan vise fokuserings-pillen | Findes (de facto) |
| 9 | Wheel over stribe | Horisontal scroll af striben | NY (senere) |
| 10 | Wheel over tom model-flade i 2D | Som i dag: browser-adfærd (intet forbruges) | Findes |

### 4.3 De tre konkrete konflikter og deres løsning

| Konflikt | Løsning |
|---|---|
| **Rotation vs. flytning af tøj** | Beboelses-regel: gestusen starter **på det valgte tøj** = tøj; **andensteds** = kamera. Ingen retnings-deling nødvendig (dette er allerede anbefalingen i 3D-analysen §Mobile) |
| **Rotation vs. navigation** | Navigation bor **ikke** på modellens flade. Pile er knapper; striben er en separat flade med egen `touch-action` |
| **Navigation vs. side-scroll af siden (mobil)** | Pile er knapper (default-adfærd); striben bruger `touch-action: pan-x`; modellen bevarer sin nuværende, lokalt-scopede `touch-action: none` (Rule 16) |

### 4.4 Explicit afvist design

- **"Kort drag = næste item, langt drag = roter/flyt"** — afvises (timing-afhængig).
- **"Rettning afgør: vandret = næste, lodret = scroll"** — afvises på modellen
  (den vandrette er allerede optaget af flytning/orbit); tillades **kun** på
  striben.
- **Mode-knap der skifter "hvad betyder drag?"** — afvises som primær
  (skjult tilstand, dårlig opdagelighed); en evt. "ORBIT/EDIT"-toggle kan senere
  overvejes som SHOULD HAVE, men er **ikke** en forudsætning, fordi
  beboelses-reglen allerede gør gestusserne entydige.

---

## 5. Arrows as a Primary Control

### 5.1 Svaret på hver enkelt undersøgelsespørgsmål

| Spørgsmål | Svar | Begrundelse |
|---|---|---|
| Forståeligt uden instruktion? | **Delvist UNVERIFIED** (kræver brugertest), men `‹ navn ›` med tæller er et stærkt, kendt mønster (bl.a. allerede brugt af saved-outfit-pageren `‹ 1/3 ›` med pile-knapper) | Genkendelse frem for opfindelse |
| Skal pile altid være synlige? | **Nej.** Synlige for **besatte slots** (outfit-rækkerne), skjulte/disablede for ubesatte. På modellen kun for det **fokuserede** item | Undgår 5–6 faste kontrolpar over modellen |
| Kun kategorien har flere items? | **Ja:** 0 eller 1 kandidat → pile `disabled` (stadig synlige, men grå som `.clothing-item-select:disabled`) | Tilgængelighed kræver, at kontrollen findes, også når den er inaktiv |
| Skal de være vedhæftet modellen? | **Kun pillen** — og den er *skærmfast*, ikke model-ancret | Se §6 |
| Skal de bevæge sig med model/kamera? | **Nej.** Data er kamera-uafhængige, og kontroller skal være tilgængelige fra alle vinkler | 3D-analysen Z4 |
| Skal de blive i skærmrum? | **Ja** — HTML-overlay over canvaset (eller helt uden for), aldrig objekter i 3D-scenen | Nem a11y, ingen z-kampe, ingen perspektivforvrængning |
| Skal de være uden for modellen? | **Primært ja** (outfit-listen). **Én** kontrol indeni: fokuserings-pillen | Minimerer gestus-konflikter |
| Skal de vise kategorinavnet? | **Ja — slot-navnet, ikke kategorinavnet** (`TOPS`, ikke `tops/shirts/sweaters`) | Slot er adfærd; kategori er data |
| Skal det nuværende item-navn vises? | **Ja** — navn + position (`‹ PINK SHIRT · 2/7 ›`) | Det er "model wearing current top"-ideen |
| Skal kontroller falme ved inaktivitet? | **Ja, forsigtigt:** pillen kan fade til 40 % efter ~3 s uden interaktion og komme tilbage ved hover/fokus/tap (kun pillen; outfit-listens knapper fader **aldrig**) | Falming må aldrig gemme den primære kontrol |
| Hvordan i DRESSED' visuelle sprog? | Se §16 | — |

### 5.2 Designskitse (tekst)

```text
OUTFIT-LISTEN (permanent, begge platforme):
┌──────────────────────────────────────────────┐
│ [thumb] TOPS · PINK SHIRT        [↑] [↓] [×] │
│          ‹  pink shirt  ›    2/7              │
│          [ ADJUST ]                           │
└──────────────────────────────────────────────┘

MODELLEN (skærmfast pill, kun når editingItemId er sat):
        .---------------------------------.
        | ‹   PINK SHIRT · 2/7   ›        |     ← øverst til højre i canvaset
        '---------------------------------'        (aldrig over hovedet/ansigtet)
              [ model 2:3 ]
```

### 5.3 Hvorfor pile er det rigtige *primære* sprog for DRESSED

1. **De er ikke-gestuelle** — de virker med mus, tastatur, skærmlæser og
   fingerspids, og de skaber **ingen** konflikter med drag/pinch/rotation (§4).
2. **De matcher den allerede eksisterende UI-kultur:** outfit-listens
   `↑ ↓ ×`-knapper, saved-outfit-pagerens `‹ ›`, `.placement-readout`-teksten.
3. **De kan styles som 90s-computer-kontroller** frem for som en moderne
   e-commerce-karrusel (§16).
4. **De er pladsøkonomiske:** ét par pr. besat slot (max 5 i dag), ikke
   22 kategori-knapper.

---

## 6. 3D Model Rotation vs Clothing Navigation

### 6.1 Skal modellen rotere frit 360°?

**Ja** — men kameraet er en *visning*, aldrig data (3D-analysen Z4). Der findes
ingen grund til at gemme vinklen, og navigation må aldrig ændre den.

### 6.2 Regler for kontrolplacering ved rotation

| Spørgsmål | Anbefaling |
|---|---|
| Forbliver pilene faste på skærmen? | **Ja.** Alle navigationskontroller er **HTML-overlay i skærmrum** (uden for eller henover canvaset) |
| Skal de rotere med modellen? | **Nej** — aldrig parentes til 3D-scenen |
| Skal de fortsat være knyttet til kropsregioner? | **Semantisk ja, geometrisk nej:** pillen repræsenterer *slot* (fx TOPS), som er knyttet til overkroppen **betydningsmæssigt**, men sidder fast i skærmen |
| Hvad sker der ved visning af ryggen? | **Intet ændres.** Én garment-mesh findes fra alle vinkler, så "næste top" virker fortsat; udseendet er bare ryggen af samme asset |
| Skal TOPS-pilene stadig være synlige? | **Ja** — tilgængelighed må ikke afhænge af kameravinkel |
| Er samme kategori tilgængelig fra hver vinkel? | **Ja**, altid. Kamera er aldrig en filter |
| Skal pilene ompositioneres efter vinkel? | **Nej.** (Valgfrit senere: pillen kan flyttes til den anden side af canvaset, hvis det valgte items *projicerede* skærmpunkt ligger bag modellen — NICE TO HAVE, kræver raycast/projektion og ændrer aldrig adfærden) |

### 6.3 Én vigtig undtagelse: placering-redigering

Legacy-`placement.x/y` er afledt af **front**-visningen (3D-analysen §4).
Derfor anbefales:

```text
Når brugeren åbner placering-redigering (ADJUST / placement3d-editor) i 3D,
snap kameraet til FRONT-preset (anime 90°) — som et bevidst, tydeligt skift.
Navigation skifter IKKE vinkel; kun redigering gør.
```

Dette er en **bevidst UI-adfærdsændring**, markeret i §17.

---

## 7. Front / Side / Back Clothing + Navigation

### 7.1 Den ufravigelige regel

> Front, side og back er **aldrig items**. De er **vinkler på samme asset**.

Navigation skifter derfor **kun** `slot → asset_id`. Kameraet, vinklen og
`placement3d` forbliver urørte. Systemet må aldrig have datastrukturer, hvor
"pink skjorte forfra" og "pink skjorte bagfra" er to rækker.

### 7.2 Konsekvenser pr. område

| Omåde | Konsekvens |
|---|---|
| **Asset-identitet** | `asset_id` + `asset_hash` (3D-analysen) er den eneste nøgle; alle renders/thumbnail/LOD peger på samme id |
| **Kategori-identitet** | `slot(item)` + `category(item)` uafhængige af vinkel; kandidatlisten bygges én gang pr. slot |
| **Selection** | `editingItemId` er et `wardrobe_items.id` — vinkeluafhængigt; tap/raycast rammer den samme slot-bærer uanset vinkel |
| **Caching** | Der cache's **ét** GLB pr. asset; at rotere koster **nul** cache-opslag. Navigation beder om det næste assets GLB, aldrig om en "side-version" |
| **Loading** | Skift af slot = udskiftning af ét barn under slot-noden; kamera og øvrige slots røres ikke |
| **Transitioner** | Anbefalet: kort cross-fade (100–150 ms) mellem gammelt og nyt mesh på **samme** slot-node; aldrig en "drej for at vise næste"-animation, der låser kameraet |
| **Mobil-performance** | Rotation er gratis (ingen nye filer); navigation indlæser én fil pr. skift — derfor forudindlæsning af naboer (§11) |

### 7.3 Hvad der må undgås

- At lade pilene skifte mellem "front-model" og "side-model" (ville skabe tre
  kandidatlister pr. slot og trippel caching).
- At gemme kameravinkel i `placement3d` eller i outfittet.
- At genbruge "vinkel"-navngivning i slot-tabellen (`front_top` må ikke findes).

---

## 8. Clothing Slot Architecture

### 8.1 Er `clothing_slot` en god abstraktion?

**Ja — og den er allerede halvt til stede i koden:**
`CLOTHING_LAYER_ORDER` (lag-bånd), `CLOTHING_PLACEMENT` (anchor-pr-slot) og
`CLOTHING_FILTER_GROUPS` (gruppering i Closet) er tre forskellige forsøg på at
sige det samme. Slot-modellen samler dem til **én** datakilde for navigation,
beholder de to eksisterende for rendering og tilføjer det, der mangler:
*erstatnings-semantik*.

**Regel:** navigation må aldrig skrive `if (category === "tops")`. Den må kun
slå op i tabellen.

### 8.2 Foreslået tabel (skitse — IKKE implementeret, ikke databaseret)

```text
clothing_slot      body_region     indeholder (categories)                     ekskluderer
─────────────────────────────────────────────────────────────────────────────────────────────
hair               head            (fremtidig hair_assets — ikke category)     —
headwear           head            hats, hair-accessories                     —
eyewear            head            glasses, sunglasses                        —
earrings           head            earrings                                   —
necklace           neck            necklaces, jewelry(overkrop)               —
top                upper_body      tops, shirts, sweaters                     —
outerwear          upper_body      jackets                                    —
dress              full_body       dresses                                    top, bottom, skirt
bottom             lower_body      pants, shorts, skirts                      dress
shoes              feet            shoes                                      —
socks              feet            socks                                      —
bag                hands           bags                                       —
wrist              hands           bracelets, watches                         —
body_accessory     full_body       accessories, other                         —
```

Observationer:

- **15 navne** — samme antal som anchors (bevidst: `slot → default anchor` er en
  1:1-oversættelse af den eksisterende `CLOTHING_PLACEMENT`-tabel).
- `slot` er præcis det, 3D-analysen kalder `placement3d.node`-niveauet: **slot ↔
  node** (jf. `top → torso`, `shoes → feet`, `headwear → head`).
- `body_region` er kun gruppering til visning (`head`, `neck`, `upper_body`,
  `lower_body`, `feet`, `full_body`, `hands`).
- Kategorier, der mangler i tabellen (fremtidige), får default-reglen
  `slot = other → body_accessory` (ligesom `normalizeClothingCategory` i dag
  falder tilbage på `other`).
- Tabellen lever i **`lib/shared`** (klient+server), som `clothing-categories.ts`
  — den er *data*, ikke state, og kræver **ingen migration**.

### 8.3 Hvad tabellen løser

1. **Erstatning:** "next" = næste i samme `slot`.
2. **Eksklusion:** kjole fjerner automatisk top+bottom ved ADD (og genopretter
   ikke dem ved NEXT).
3. **Lag:** `clothingLayerOrder`/`shell` fortsætter som før — slot-tabellen
   tilføjer *erstatning*, ikke *rækkefølge*.
4. **UI-gruppering:** outfit-listen kan grupperes pr. region uden ny logik.
5. **3D:** hver slot får sin scene-node (`slotNodes[“top”]`), så udskiftning er
   lokal og forudsigelig.
6. **Hår/accessories senere:** samme tabel udvides, navigationen ændres ikke.

### 8.4 Hvad tabellen IKKE erstatter

- `wardrobe_items.category` forbliver som i dag (DB + UI-filter).
- `CLOTHING_LAYER_ORDER` og `CLOTHING_PLACEMENT` forbliver (Rule 2/14) —
  tabellen *reference-sætter* dem, duplicerer dem ikke.
- Saved outfits forbliver `item_ids` (intet nyt felt).

---

## 9. Outfits

### 9.1 Det anbefalede model

```text
OUTFIT = mængden af besatte slots → item-ids    (i dag: et array af item-ids)
NAVIGATION = 1:1-ERSTATNING inden for ét slot
ADD/REMOVE (panel) = besæt/frigør et slot
SAVE OUTFIT = persistér de nuværende item-ids (som i dag)
```

| Spørgsmål | Svar |
|---|---|
| Er skiftet straks en del af det aktuelle outfit? | **Ja** — samme hukommelsesmodel som ADD/REMOVE i dag; ingen eksplicit "apply"-knap påkrævet for navigation (APPLY OUTFIT-knappen består uændret til manuel gen-render) |
| Erstattes det forrige item? | **Ja**, inden for samme slot; det forrige item fjernes fra `selectedItems` på sit indeks |
| Kan flere tops koeksistere? | **Kun på tværs af slots** (`top` + `outerwear`), aldrig to i samme slot (§3.3) |
| Hvordan håndteres lag-på-lag-garderinger (jakke over skjorte)? | Forskellige slots + eksisterende `clothingLayerOrder` (jackets 40 > tops 30); i 3D: `shell`-sortering (3D-analysen) |
| Jakker/frakker? | `outerwear`-slot; navigation inden for det slot rører ikke `top` |
| Saved outfits? | **Urørt** indtil SAVE. LOAD erstatter hele `selectedItems` (findes). Navigation skaber et *unsaved* outfit-udkast |
| Skal navigation være reversibel? | **Ja, billigt:** wrap-around-pile betyder, at den forrige altid er ét klik væk. Derudover anbefales en **session-undo** (SHOULD HAVE): en lille ringbuffer af seneste slot-skift (`Ctrl/Cmd+Z`), som kun rører `selectedItems` — ingen server |
| Skal der være Undo? | Se ovenfor; `LOAD OUTFIT` er allerede en "grov undo". Automatisk persistens af hver enkelt navigation anbefales **ikke** (overraskende PATCH-kald, kvote-uforudsigelighed) |

### 9.2 5-items-grænsen

Navigation er 1:1, så grænsen kan aldrig overtrædes. Hvis brugeren har 5 items
og forsøger at **besætte et nyt** slot, gælder den eksisterende besked
(`CHOOSE UP TO FIVE ITEMS FOR ONE OUTFIT.`) uændret.

### 9.3 Hvad der bevarer `saved_dressed_outfits` 100 %

Ingen ny kolumn, ingen ny RPC, ingen ændring af `item_ids: text[]`. Navigation
er udelukkende en ny måde at **redigere det midlertidige udvalg** på.

---

## 10. Mobile

> Mobil-implementation røres **ikke** (Rule 6/16). Dette er kun fremtidig design.

| Emne | Anbefaling |
|---|---|
| **Pile** | Primær mobil-interaktion: min. 44×44 px mål (det eksisterende `.placement-actions button { min-height: 2.25rem }`-mønster løfter), placeret i outfit-rækken (under/ved modelområdet) og i pillen |
| **Swipe** | **Kun** på den fremtidige thumb-stribe under modellen (`touch-action: pan-x` lokalt). **Aldrig** på modellen — den bevarer sin nuværende, lokalt-scopede `touch-action: none` på det redigerede lag |
| **Tap** | Uændret (8 px slop, commit på pointerup) |
| **Drag** | Uændret på aktivt lag; i 3D orbit på tom flade |
| **Pinch** | Uændret på aktivt lag (scale); på tom flade = kamera-zoom (3D, senere) |
| **3D-rotation** | 1 finger på tom flade = orbit; den nye pil-knap skal **altid** findes som alternativ, så brugeren aldrig er tvunget til at rotere for at skifte tøj |
| **Små skærme** | Modellen er allerede låst til 2:3 og max 333 px ved ≤550 px; pillen må ikke dække >~12 % af bredden og placeres i canvasets øverste højre hjørne |
| **Tommel-rækkevidde** | Kontroller i outfit-listen (under/ved modellen) er inden for tommelzonen; **aldrig** kræv "øverst på skærmen" for at skifte tøj |
| **Utilsigtet aktivering** | Pile er knapper (kræver tryk, ikke bevægelse); swipe kræver >8 px vandret + `touch-action`-scoping; pillen kan kun aktiveres ved tryk, ikke ved berøring under scrolling |
| **Tilgængelighed** | Samme aria-labels/disabled-tilstande som desktop (§15) — ingen "touch-only"-genveje |

**Konklusion:** mobil og desktop bruger **samme interaktionsmodel** (pile);
swipe er en *tillægsflade* på striben, ikke en erstatning.

---

## 11. Performance — hurtig navigation

### 11.1 Hvad der sker pr. skift

```text
2D (i DAG, CONFIRMED):  alle preview-URL'er er allerede indlæst i clothingItems
                        → skift = DOM-udskiftning af ét <img> + CSS-variabler
                        → INGEN network-forespørgsel pr. skift (kun ved signering
                          af URL'er, som sker ved indlæsning af garderoben)
3D (FREMTIDIG):         skift = udskiftning af ét mesh-barn under slot-noden
                        → kan kræve GLB-download, hvis cachet miss'er
```

### 11.2 Forudindlæsning (preload)

| Strategi | Anbefaling |
|---|---|
| **Nabo-preload** | Når en slot er fokuseret og roen er (~300 ms efter skift), forudindlæs **forrige + næste** kandidat i det slot (kun ét slot ad gangen) |
| **Kun fokuseret slot** | Aldrig forudindlæs alle 22 kategoriers assets |
| **Krop først** | Krop/hoved/ansigt-cache (fra 3D-analysen) genbruges uændret — den indlæses aldrig igen pr. navigation |
| **Idle-priority** | Brug `requestIdleCallback`-agtig adfærd; en aktiv bruger skal aldrig kæmpe om båndbredde med en preload |

### 11.3 Cache og disposal

```text
GLB-CACHE: LRU (anbefalet 8–12 meshes + krop/hoved uden for LRU'en)
DISPOSE:   geometri + materialer frigives, når en cache-linje smides ud
           (three.js dispose() — ellers lækker mobil-browseren, jf. 3D-analysen)
TEKSTUR:   genbruges på tværs af items KUN hvis filen er identisk (hash);
           ellers én tekstur pr. garment
MESH:      hvert garment har sin egen geometri; SKELET-bind-pose kan deles
           (kloning pr. instans, ikke pr. fil)
```

### 11.4 Race conditions — det vigtigste krav

Brugerens sekvens `NEXT → NEXT → NEXT → NEXT` må aldrig ende i, at en **langsom**
tidligere indlæsning overskriver et **nyere** valg.

```text
PRINCIP: én "target-index"-pr.-slot + versionsnummer

state[slot] = { targetIndex, generation }
navigate(slot, +1) {
   state.targetIndex = (i + 1) % candidates.length
   state.generation += 1
   const myGen = state.generation
   const asset = await loadAsset(candidates[state.targetIndex])
   if (myGen !== state.generation) { cache(asset); return }   // STALE — anvend aldrig
   applyToSlotNode(slot, asset)
}
```

- **Max 1 in-flight loading pr. slot** (nyeste vinder; ældre afbrydes/ignoreres).
- **Aldrig vis en blocking spinner** for navigation; i stedet:
  - hvis asset er cachet → skift **med det samme** (mål: < 16 ms),
  - ellers → behold det nuværende mesh og vis en lille `LOADING…`-markering i
    pillen (100 ms forsinket, så hurtige skift ikke flimrer), opdater når klar.
- **Fail-closed:** mislykket indlæsning → forbliv på det nuværende item, vis
  `COULD NOT LOAD`, marker item'et som ikke-klar i gridet (sammen med den
  eksisterende `NOT AI READY`-markering).

### 11.5 Kandidatliste-hastighed

Kandidatlisten er ren hukommelsesberegning over `clothingItems` (allerede
indlæst). **Ingen server-anmodning pr. navigation** — heller ikke for at
"bestille næste" (kun signerede URLs, som allerede findes; ved udløb fornyes de
som i dag, ikke pr. klik).

---

## 12. AI and Cost

### 12.1 Hård regel

> **Navigation genererer aldrig noget.** Skift af tøj er et client-side
> data-skift, der indlæser et **allerede eksisterende** asset.

```text
TOP A → TOP B :
   INGEN AI-kald · INGEN moderation · INGEN kvote-træk · INGEN server-job
   INGEN ny storage-fil · INGEN ny signering pr. klik
   KUN: selectedItems-erstatning + (3D) cache-opslag på et eksisterende GLB
```

### 12.2 Placering i den tidligere anbefalede AI-model

| Led | AI? | Navigation's berøring |
|---|---|---|
| Identitet (ansigt/hoved) | Ja, én gang pr. bruger | Ingen |
| Oprettelse af clothing-asset (foto → 2D-lag i dag, → 3D-mesh senere) | Ja, én gang pr. unikt design (hash-gated) | **Nej** — navigation forbruger kun resultatet |
| Endeligt outfit-billede (try-on) | Ja, én gang pr. (bruger, outfit, character) via `outfit_key` | Indirekte: navigation kan **gøre det cachede outfit-resultat forældet** (nyt `item_ids`) ⇒ næste try-on er et nyt nøglesæt og koster ét kald — men kun hvis brugeren eksplicit beder om det |
| Navigation, rotation, placering, scaling, z, kamera, front/side/back | **Aldrig AI** | Hele dens område |

### 12.3 Genbrug på tværs af brugere

Navigationen er også den faktor, der gør **asset-genbrug synligt**:

- Bruger A og B med samme design (sha256/pHash-match, 3D-analysen §AI Cost)
  peger på **samme `clothing_assets_3d`-række** → navigation for begge indlæser
  **den samme fil**, som allerede ligger i CDN-cachen ⇒ omkostning pr. skift = 0.
- Fordi kandidatlister bygges pr. `slot` og pr. `base_type`, deles de samme
  kandidatlister logisk mellem brugere med samme garderobe-indhold — men
  **vises altid kun brugerens egne `wardrobe_items`** (RLS/EJERSKAB røres ikke).

### 12.4 Omkostningsfaldgruber, der undgås

1. **Ingen "regenerér for at vise en anden vinkel"** (front/side/back er renders).
2. **Ingen kvote-forbrug ved skift** — ellers ville 5 frit-swip-skift dræne
   `clothing`-kvoten (live: 5) på få sekunder.
3. **Ingen "try-on pr. navigation"** — endeligt billede udløses kun af en
   eksplicit handling (og cache's som i dag).
4. **Ingen forced regeneration** ved navigation (v3-assets forbliver gyldige).

---

## 13. Future Bald Master + Hair

### 13.1 Samme navigationsmodel?

**Ja — 1:1.** Hår er ikke en undtagelse, men endnu et slot:

```text
HAIR-slot:   kandidater = hårmeshes fra det fælles bibliotek (3D-analysen §Hair)
             kildetabel = hair_assets (IKKE wardrobe_items)
             AI = 0 (kurateret bibliotek + farvepalet)
             UI = samme ‹ navn ›-pill og samme plads i outfit-listen

HEAD-region:  ← hair →   ·   ← hats →   ·   ← glasses →   ·   ← earrings →
```

### 13.2 Den eneste arkitektoniske konsekvens

Navigationen må **ikke** antage, at kandidater altid kommer fra
`clothingItems`. Derfor introduceres et lille, eksplicit interface (design, ikke
implementation her):

```text
SlotSource = {
  slotId,
  candidates(): [{ id, label, thumbUrl, isReady }],
  getById(id),
  apply(id)      ← 2D: sæt lag · 3D: udskift barn under slot-noden
  activeId()
}
```

- `wardrobeSlotSource` bruger `clothingItems` + `selectedItems` + `editingItemId`
  (alt som i dag).
- `hairSlotSource` (fremtidig) bruger `hairAssets` + karakterens valgte frisure.
- **Samme UI-kode, samme pile, samme gestusregler** — kun `SlotSource` er byttet.

Dette er grunden til, at **slot** (ikke "clothing category") er den rigtige
abstraktion: den gør hårsystemet til en gratis udvidelse senere.

---

## 14. Adult / Teen / Child

### 14.1 Én navigation, tre kroppe

Fra 3D-analysen: **én garderobe, ét skelet-sprog, udvidet `base_type`**. Det
betyder:

| Element | Delt på tværs af Adult/Teen/Child? |
|---|---|
| Interaktionsmodel (pile, pill, stribe, tastatur) | **Ja — identisk** |
| Slot-tabel + regions | **Ja — identisk** |
| `editingItemId`-statemaskine | **Ja — identisk** |
| Gestus-prioritet | **Ja — identisk** |
| Kandidatlister | **Nej — filtreres** på tilgængeligt `base_type`/`body_type` (som `aiReadyAssets[baseType]` allerede gør) |
| Krops-mesh/ansigt | Nej — pr. kategori |

### 14.2 Hvad der skal være anderledes (og kun det)

- **Filteret** i kandidatlisten udvides fra `baseType ∈ {woman, man}` til den
  udvidede værdimængde (3D-analysen §Adult/Teen/Child, additiv).
- **Fit-varianter** (3D): hvis et item kun findes som `fit=adult`, men brugeren
  er `child`, er kandidaten **ikke klar** → vises som disabled/`NOT READY` i
  pilene i stedet for at fejle (samme idé som dagens `NOT AI READY`).
- **Ingen** separat UI, **ingen** tredje navigation, **ingen** ekstra gestusser.

---

## 15. Accessibility — ikke-swipe-alternativer

**Princip:** *enhver vigtig handling skal kunne udføres uden gestusser.*

| Krav | Løsning |
|---|---|
| Synlige knapper | Pile er rigtige `<button>`-elementer i outfit-listen + i pillen (aldrig `<div>` med click-handler) |
| Tastatur | Tab når mellem pile; **`←`/`→` styrer det fokuserede slot, når fokus er inde i navigationen** (pil-containeren eller outfit-rækken) — aldrig globalt, så sidens scroll ikke kapres; `Enter`/`Mellemrum` = knap (browser-standard) |
| Fokus-tilstande | Synlig `:focus-visible`-outline i pink — samme mønster som `.placement-actions button:focus-visible` / `.adjust-outfit-item:focus-visible` (`wardrobe.css:1033`) |
| Skærmlæser-navne | `aria-label="Previous top"` / `"Next top"` (ikke bare "‹"); pil-navn som `aria-label="Pink shirt, top, 2 of 7"` |
| Live-status | `aria-live="polite"` på pillens navn/tæller, så skift annonceres ("Pink shirt, 2 of 7") — samme teknik som `#outfit-message`-mønstret (`role="status"`) |
| Disabled-tilstande | 0 eller 1 kandidat → `disabled` på begge pile (samme visuelle sprog som `.clothing-item-select:disabled`); **aldrig skjul kontrollen** |
| Ikke-gestuelle alternativer | Den eksisterende tøj-panel-ADD/REMOVE-vej bevares uændret som det fuldgyldige alternativ; outfit-listens pile er det andet |
| Kontrast/zoom | 90s-stilen med faste `font-size` i `rem`-lignende størrelser skal beholdes; ingen info kun via farve (tælleren er tekst) |

**Afvist:** ren swipe-navigation, "skjult" navigation der kræver langt-tryk,
og dobbelt-tap på modellen (det ville kollidere med tap-til-valg).

---

## 16. Visual Design — DRESSED' sprog, ikke e-commerce

### 16.1 Hvad må det IKKE ligne

- En moderne karrusel med prikker, glidende skygge-effekter og "shop now"-følelse.
- En shoppable hot-spot-model med bobler over tøjet (den rykker fokus fra
  *modellen* til *butikken*).
- En generisk 3D-widget med flydende grå kontroller.

### 16.2 Hvad det SKAL ligne (bygget på det, der allerede findes)

| Eksisterende element | Navigationens pendant |
|---|---|
| Saved-outfit-pageren `‹ 1/3 ›` med knapper | **Præcis samme formsprog** til `‹ PINK SHIRT · 2/7 ›` |
| `.placement-readout` (DM Mono, `0.6rem`, `--grey-700`) | Tæller/navn-linjen i pillen |
| `↑ ↓ ×`-knapper i outfit-rækken | `‹ ›` i samme knapstørrelse og ramme |
| `--pixel-shadow` (4/7 px), `--border`, `--pink-500` | Pilknapper med 1px ramme + pixel-shadow ved hover/active; pink ved focus/active |
| Kategori-piller (`category-button--active`) | Aktiv slot markeres med samme "pille"-tilstand |
| `DM Mono`, VERSALER | Alle labels: `TOPS`, `NEXT`, `LOADING…` |
| `.computer-ramme`/`.model-window`-header | Pillen placeres **inde i** `.model-window`-området, som en del af "skærmen i skærmen" |

### 16.3 Anbefalet detalje-sæt

```text
PILKNAP:      ramme 1px var(--border), baggrund var(--white),
              hover: translateY(-1px) + pixel-shadow (som .clothing-item-select)
              active: baggrund var(--pink-100); focus: outline pink 2px
TÆLLER:       "2/7" i DM Mono — tekst, ikke prikker
SLOT-LABEL:   lille VERSAL-label over pilene: "TOPS" (kun i outfit-listen,
              hvor der er plads — ikke på modellen)
LOADING:      "…"-animation i pillen (tekst), aldrig en spinner-grafik
OVERSKIFT:    100–150 ms cross-fade (2D: opacity på lag-img; 3D: material-opacity)
"EMPTY":      INGEN pil-skjul — i stedet "ADD A TOP" som disabled-knap i rækken
```

### 16.4 Diagram (mål, ikke markup)

```text
MODEL-VINDUET (skærmfast pill, kun når editingItemId er sat):
.---------------------------------------------------.
|  MY DRESSED CHARACTER                       ♡     |
|                            ┌───────────────────┐  |
|                            | ‹ PINK SHIRT 2/7 ›|  |
|                            └───────────────────┘  |
|                    [   model 2:3      ]           |
'---------------------------------------------------'

OUTFIT-PANELET (til højre — permanente knapper pr. besat slot):
|  SELECTED ITEMS                                   |
|  [thumb] TOPS · PINK SHIRT        [‹] [›] [↑][×] |
|          [ ADJUST ]                               |
```

---

## 17. Architectural Constraints — hvad der IKKE må ændres

### 17.1 Uændret (ingen berøring overhovedet)

| System | Status |
|---|---|
| X/Y-scaling-semantik (`scale`, `scaleX/scaleY`, clamp 0.4–2.0, "begge eller ingen") | **Uændret** — navigation skriver aldrig til `placement` |
| Drag-arkitektur (`placementDrag`, pointer capture, procent-beregning) | **Uændret** |
| Pinch-arkitektur (`placementPinch`, `pinchPointers`, `setPlacementOverride({scale})`) | **Uændret** |
| Wheel-scaling (`WHEEL_SCALE_RATE`, venstre-hold, `wheelScaleActive`) | **Uændret** |
| Tap-til-valg (`TAP_SLOP_PX = 8`, commit på pointerup, `clothingLayerAtPoint`) | **Uændret** |
| `editingItemId` som eneste selections-tilstand | **Uændret** (genbruges) |
| Saved outfits (`item_ids`, SAVE/LOAD/DELETE) | **Uændret** |
| `placement`-JSONB + `resolveItemPlacement`-prioritet | **Uændret** |
| 5-items-grænsen, kategori-filteret, ADD/REMOVE | **Uændret** |
| `clothingLayerOrder` / `CLOTHING_PLACEMENT` | **Uændret** (slot-tabellen er *ny* data ovenpå) |

### 17.2 Den ENE reelle integration (og hvorfor den er legitim)

Pile placeret **inde** i `#wardrobe-model` (pillen) lander i den delegerede
pointer-model, som behandler alt i containeren ens (`wardrobe.astro:706+`).
Uden en tidlig gren ville et tryk på pillen også starte et tap-kandidat og evt.
en drag.

```text
ANBEFALET (minimal, forklaret):
wardrobeModel.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Element &&
      event.target.closest(".slot-nav-control")) return;   // ← NY én-linjers gren
  … eksisterende logik uændret …
});
```

Dette er **bevidst den eneste ændring** i eksisterende flow, og den er
uundgåelig, hvis en kontrol overhovedet skal bo i modelområdet. Alternativet
(altid placere kontrollerne uden for `#wardrobe-model`) er også gyldigt og
frarådes kun af pladshensyn til pillen.

### 17.3 Bevidste, markerede adfærdsændringer (kræver godkendelse)

1. **Kamera-snap til FRONT ved åbning af placering-redigering i 3D** (§6.3) —
   nødvendig, fordi legacy-placement er front-afledt.
2. **Automatisk commit af usavede placement-overrides før et slot-skift** (§3.1
   trin 5) — genbruger den eksisterende PATCH-vej; ingen ny endpoint.
3. **Kandidat-rækkefølge + wrap-around** (§3.4) — ny UI-adfærd, ingen dataændring.

Alt andet er **rent additivt**.

---

## 18. Final Recommendation

### 18.1 De femten svar

1. **Bedste navigationsmodel:** **"Focused Slot Navigation" (G).**
   Primær = ←/→ pr. besat slot i den eksisterende outfit-liste; sekundær = én
   skærmfast `‹ NAVN · n/m ›`-pill for det fokuserede item på modellen;
   tertiær (senere) = thumb-stribe under modellen. **Ingen swipe på modellen.**

2. **Bedste kategori-/slot-arkitektur:** én **`clothing_slot` + `body_region`-tabel
   i `lib/shared`** (§8), hvor kategori er data. Slot-tabellen leverer
   erstatning, eksklusion (dress ⇄ top/bottom) og 3D-node-binding
   (`slot ↔ placement3d.node`). Ingen `if (category === "tops")` nogensinde.

3. **Bedste desktop-interaktion:** mus-klik på pile (med wrap-around + `n/m`),
   tastatur `←/→` når fokus er i navigationen, `Enter`/`Mellemrum` som standard.
   Bevar hold+wheel = skala og klik+drag = flytning 1:1.

4. **Bedste mobil-interaktion:** **samme pile** (≥44 px), placeret i outfit-rækken
   (tommelzone). Swipe **kun** på striben, aldrig på modellen. Tap/drag/pinch
   uændrede.

5. **Sådan opfører pilene:** synlige for besatte slots, `disabled` ved 0–1
   kandidat, aldrig skjulte; **skærmfaste** (aldrig parentes til 3D-scenen);
   viser **slot-navn + item-navn + tæller**; fade kun på pillen (aldrig på
   outfit-listens knapper); wrap-around som default.

6. **Sådan opfører swipe (hvis det bruges):** kun horisontalt på striben med
   lokal `touch-action: pan-x` og samme 8 px-krav; aldrig på modellen, aldrig på
   det valgte tøj, aldrig som eneste vej.

7. **Modelrotation:** frit 360° kamera-orbit på tom flade (3D); navigation og
   rotation skærer aldrig kryds — navigation bor på knapper, rotation på tom
   flade; kamera gemmes aldrig; placering-redigering snapper til FRONT (bevidst,
   markeret).

8. **Tøjselektion:** forbliver **`editingItemId`** (tap, ADJUST, navigation
   sætter den). Ingen ny selections-tilstand. `selectedItems` = outfittets
   medlemmer; navigation erstatter ét item for ét på samme indeks.

9. **Integration med Z-aksen:** navigation rører **kun** `slot → asset`; det
   nye item medbringer sin egen `placement3d` (eller kategori-default), herunder
   `shell` (z). Kamera/rotation aldrig. Legacy-`placement` fortsætter som
   fallback via den eksisterende resolver.

10. **Integration med front/side/back:** vinkler er renders af samme asset —
    navigation skifter aldrig "vinkel-version". Én cache-post pr. asset,
    nul cache-opslag ved rotation.

11. **Integration med hår:** `hair` er et slot i samme tabel med sin egen
    `SlotSource` (`hair_assets`), samme pil-UI, 0 AI.

12. **Integration med Adult/Teen/Child:** identisk interaktionsmodel; kun
    kandidatfilteret (`base_type`/`body_type`) og fit-readiness ændres.

13. **Integration med `editingItemId`:** navigation = commit (hvis nødvendigt)
    → erstat i `selectedItems` → `editingItemId = nyt id` →
    `openPlacementEditor(nyt id)` → eksisterende renders. Alt genbruges.

14. **Implementér FØRST:** (a) slot-tabellen som ren data i `lib/shared`,
    (b) pilene i outfit-listen (rent UI + `navigateSlot()` i client),
    (c) fokuserings-pillen + den én-linjers pointer-gren,
    (d) tastatur/aria. Alt dette virker i **2D i dag** og forudsætter
    **ingen** 3D, **ingen** migration, **ingen** AI.

15. **Implementér IKKE endnu:** swipe på modellen, hit-zoner, faste pile ved
    kropsområder, thumb-stribe, auto-persistens pr. skift, undo-stak,
    ORBIT/EDIT-toggle, regions-labels på modellen, `SlotSource` for hår,
    `placement3d`, og alt der kræver 3D-engine eller migration.

### 18.2 Prioriteringslister

**MUST HAVE** (kan implementeres på den nuværende 2D-kode uden risiko)

- Slot-tabel + `slotFor(category)` i `lib/shared` (ren data, ingen state).
- `navigateSlot(slot, direction)` med: kandidatliste, wrap-around, 1:1-erstatning
  i `selectedItems`, commit før skift, `editingItemId`-overførsel.
- ←/→-knapper pr. besat slot i outfit-listen (rigtige `<button>`er).
- `aria-label` + `aria-live` + `disabled`-tilstande + pink `:focus-visible`.
- Én pointer-gren, så en kontrol inde i modellen ikke starter tap/drag.
- Visuel stil efter §16 (DM Mono, pixel-shadow, `n/m`-tæller).

**SHOULD HAVE**

- Skærmfast fokuserings-pill på modellen (navn + tæller, fade ved inaktivitet).
- Session-undo for slot-skift (`Ctrl/Cmd+Z`, kun `selectedItems`).
- Kandidat-rækkefølge-gennemgang + `LOAD A TOP`-tomtilstand i outfit-listen.
- Gruppering af outfit-rækker pr. `body_region` (visuel).
- Kort cross-fade ved skift.

**NICE TO HAVE**

- Thumb-stribe under modellen + swipe dér (`touch-action: pan-x`).
- Passive regions-labels / "BODY MAP"-tilstand på modellen.
- Pillen flytter sig efter den valgte genstands projicerede position (3D).
- Hover-preview af næste item ved desktop-hover på pilen (kun billed-preview).

**DO NOT IMPLEMENT YET**

- Swipe på modellen eller på det valgte tøj; hit-zoner; faste kropspilte.
- Automatisk persistence pr. navigation; ny `placement`-/outfit-kolonne;
  enhver SQL/migration; `placement3d`.
- 3D-engine-arbejde (hører til 3D-roadmap'ens faser, ikke hertil).
- AI-kald af nogen art i navigationsflowet.
- Ændringer i drag/pinch/wheel/tap/saved-outfit/logik.

---

## Open Questions

1. **Skal navigation åbne placement-panelet?** Anbefaling (a) = ja, altid.
   Alternativ (b) kræver en ny "fokuseret"-tilstand. Skal bekræftes med en
   brugertest af, om panelet føles som støj under browsing.
2. **Kandidat-rækkefølge:** `clothingLayerOrder → createdAt → id` vs.
   alfabetisk vs. "senest brugt først"? Skal fastlægges før implementation.
3. **Wrap-around vs. klemme i enderne** (anbefalet: wrap med `n/m`-tæller).
4. **Eksklusion ved ADD:** skal en kjole automatisk fjerne `top`+`bottom` (anbefalet),
   eller skal brugeren selv fjerne dem? (Afgør om slot-tabellen får aktiv
   eksklusionslogik allerede i fase 1.)
5. **Faste kandidater vs. "ikke-klar"-kandidater:** skal items uden gyldig v3-asset
   vises som disabled i pilene (anbefalet — giver transparens) eller udelades
   helt (renere, men skjuler indhold)?
6. **Skal `#current-outfit-items`-rækker omarrangeres efter region?** (Visuel
   gevinst vs. ændring af den nuværende lag-rækkefølges-visning.)
7. **En eller to kontrolflader i første implementation?** (Kun outfit-liste vs.
   outfit-liste + pill.) Anbefalet: outfit-liste først, pill bagefter.
8. **Tærskel for "hurtigt skift"** (cross-fade vs. øjeblikkeligt) og hvor mange
   ms "LOADING" må vises, før det registreres som fejl.
9. **Skal navigation fungere, når intet item er valgt?** (Ubesatte slots har ingen
   række — anbefalet: nej; tilføjelse sker i panelet, som i dag.)
10. **Profileringsregel for Profile-siden:** Profile viser kun valgt outfit; skal
    navigation også findes dér? (Anbefaling: **nej** — Profile er read-only
    ifølge `profile-outfits.ts`, som bevidst bruger `editable:false`-mønsteret.)

---

## Appendix — Selvtjek (opgavens punkt 19)

| # | Kontrol | Status |
|---|---|---|
| 1 | Læste `analysis/dressed-3d-model-z-axis-analysis.md` først og bygger videre på den | ✓ brugt i §1, §4, §6, §7, §8, §11, §12, §13, §14, §18 |
| 2 | Gennemlæste relevant kode (`wardrobe.astro`, `clothing-categories.ts`, `clothing-placement.ts`, `wardrobe-ai.ts`, `profile-outfits.ts`, `wardrobe.css`) | ✓ alle påstande i "Current Selection & Interaction State" er linje-verificerede |
| 3 | Ingen implementation, ingen kode-, DB-, dependency- eller UI-ændring | ✓ kun denne fil er oprettet (`git status` viser én ny fil) |
| 4 | Ingen migration/SQL, ingen git-historik-ændring | ✓ |
| 5 | Alle syv navigationsmodeller (A–G) er vurderet på samtlige krævede kriterier | ✓ §1.2-tabel |
| 6 | `editingItemId` som single source of truth er analyseret pr. felt (placement, scale, x/y/z, rotation, selection, outfit, saved outfit) | ✓ §3.2 |
| 7 | Gestus-prioritet inkl. click vs. drag, retning, 2-finger, wheel, touch, pen | ✓ §4.2–4.4 |
| 8 | Flere kropsregioner (dress/jumpsuit/coat/cardigan) håndteres uden hardkoding | ✓ §2.2 + §8 |
| 9 | Front/side/back behandles aldrig som separate items | ✓ §7 |
| 10 | Outfits, lag, saved outfits, undo er analyseret | ✓ §9 |
| 11 | Mobile, performance, AI-omkostning, hår og adult/teen/child er analyseret som dele af det samme system | ✓ §10–§14 |
| 12 | Tilgængelighed + visuel identitet + arkitektur-begrænsninger | ✓ §15–§17 |
| 13 | MUST/SHOULD/NICE/DO-NOT-IMPLEMENT-YET adskilt | ✓ §18.2 |
| 14 | Eksisterende systemer er ikke ændret eller foreslået ændret uden begrundelse | ✓ §17 — kun én pointer-gren + tre markerede adfærdsændringer, alle begrundede |

---

*Slut på analysen. Denne fil er den eneste ændring i repoet, opdaterer ingen
tidligere analyse og indeholder ingen kode, SQL eller afhængighedsændringer.
Næste skridt (kræver særskilt godkendelse): godkendelse af "Focused Slot
Navigation"-modellen og evt. en MUST-HAVE-implementation på en separat gren.*














