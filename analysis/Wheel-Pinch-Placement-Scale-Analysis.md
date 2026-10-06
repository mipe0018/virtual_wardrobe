# Wheel / Pinch → Placement Scale Analysis

> Teknisk analyse af den nuværende implementation af clothing scale via **scale slider**, **desktop left click + wheel** og **mobile pinch**.
> Baseret på faktiske målinger: lokal app-runtime, DevTools/CDP-runtime på den byggede kilde, Device-Mode-emulation og de eksisterende testsuites. Alt er mærket med sit evidensniveau — ingen resultater er gættet.

## 1. Formål

At verificere og dokumentere, at de tre inputs

```text
Scale slider          ─┐
Left click + wheel    ─┼─►  placement.scale  ─►  --clothing-scale  ─►  clothing transform
Mobile pinch          ─┘
```

er **ét samlet scale-system**, der fungerer gennem det eksisterende placement-system, uden canvas/model-zoom, uden separat persistens og uden at forstyrre normal mobil-scrolling.

## 2. Testgrundlag

Fem niveauer, adskilt bevidst:

| Niveau | Hvad | Hvordan |
|---|---|---|
| Statis kode | Kilder + greps | `wardrobe.astro`, `wardrobe.css`, forbudte-konstruktions-grep |
| Lokal app-runtime | Kørende `astro dev` (pid11348) | HTTP mod `/wardrobe` + de serverede Vite-kilder |
| Bygget runtime (CDP) | `dist`-builden i headless Chrome | DevTools-protokollen: mouse-wheel, touch, click, evaluate |
| Syntetiske/native suites |8 eksisterende tests | jsdom, CDP native mouse, Chrome syntetisk, touch, persistence E2E, wheel/pinch |
| Device-Mode | Emulering390×844, DPR3, touch til | `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` + CDP-touch |

**Ikke en del af grundlaget:** faktisk Supabase (stubkald i tests), fysisk telefon, rigtig mus/trackpad-følelse.
**Login-gate:** et rigtigt browser-load af `http://localhost:4321/wardrobe` ender på loginsiden (`Closet — Log In`) uden session — derfor er den interaktive runtime undersøgt på den **byggede app-kode med stubbed backend via CDP** (samme kildekode som `dist`), ikke på en indloget dev-session.

## 3. Nuværende implementation

Alt vedrører `src/pages/wardrobe.astro` (placement-sektionen); **ingen CSS-ændringer var nødvendige** for denne feature.

- **State (kun gestus-tilstand, aldrig persisterbar):** `placementPinch {ids, startDistance, startScale}`, `pinchPointers` (positioner for pointers startet på det aktive lag), `wheelScaleActive`.
- **`pointerdown`** på `.dressed-clothing-layer--editing`: registrerer pointers; når to fingers er på laget → pinch startes og det igangværende single-finger-drag stoppes.
- **`pointermove`**: pinch-grenen regner `scale = startScale × (distance / startDistance)` og kalder **kun** `setPlacementOverride(…, {scale})`.
- **`wheel`-listener** (`{passive:false}` på `#wardrobe-model`): aktiveres KUN når `placementDrag` er sat (venstre tryk startede på det aktive lag) OG cursoren er over laget; `preventDefault()` kaldes kun i den behandlede gren. Rate: `WHEEL_SCALE_RATE = 0.0005` (≈0.05 pr. hjul-notch).
- **`endPlacementPointer`** på `pointerup`/`pointercancel`/`lostpointercapture`: rydder drag + pinch + wheel-flag.

## 4. Scale-systemet

**Ét system, én værdi.** Alle tre inputs ender i `setPlacementOverride` → `placementOverrides`-Map → `--clothing-scale` → CSS `scale()` på det aktive lag:

- `PLACEMENT_SCALE_MIN = 0.4`, `PLACEMENT_SCALE_MAX = 2.0` (delt clamp ét sted). *(BEKRÆFTET VIA KODE + VIA TEST: clamp greb i begge retninger.)*
- **Der findes INGEN canvas/model-zoom, intet `zoomState`, ingen pan, ingen transform på `.dressed-canvas`** — grep efter `zoomState|canvasZoom|modelZoom|canvas.*transform.*scale|pan-` i hele `src/` = **0 træffere**. *(BEKRÆFTET VIA KODE)*
- **Modellen ændrer aldrig størrelse** — runtime-måling: `canvas.style.transform === ""`, computed `transform: none` på både canvas og base-billede efter wheel og pinch. *(BEKRÆFTET I RUNTIME — Device-Mode + wheel/pinch-suite)*
- **Scale er en DEL af placement**, ikke en separat værdi: `wardrobe_items.placement` = `{anchor, x, y, scale}` (jsonb, CHECK-godkendt). *(BEKRÆFTET VIA KODE)*
- RESET nulstiller **hele** placement til defaults; DONE gemmer hele objektet via den eksisterende PATCH. *(BEKRÆFTET VIA TEST)*
- Layer/z-index påvirkes **ikke** af scale — z styres stadig af `selectedItems`-rækkefølgen. *(BEKRÆFTET VIA TEST: z uændret gennem wheel/pinch/slider)*

## 5. Desktop: Left Click + Wheel

| Case | Forventet | Observeret | Niveau |
|---|---|---|---|
| **A:** cursor over aktivt lag + venstre hold + wheel | scale ændres; x/y/anchor/z uændret; kun aktivt item; model/canvas urørt | scale1→1.3 efter6 notches; x/y/anchor/z uændret; jacket forblev `1`; `defaultPrevented=true`; jitter-under-hold flyttede ikke x/y; canvas/base `transform: none` | BEKRÆFTET VIA TEST (wheel/pinch25/25) |
| **B:** wheel **uden** venstre knap | ingen scale-ændring; normal browser-adfærd | scale uændret; `defaultPrevented=false` | BEKRÆFTET VIA TEST |
| **C:** venstre hold + wheel **uden for** det aktive lag | samme princip | scale uændret; `defaultPrevented=false` | BEKRÆFTET VIA TEST |

`wheelScaleActive`-beskyttelsen (jitter-suppression) fungerer som designet: pointerbevægelser under et hjul-hold ændrer ikke x/y. *(BEKRÆFTET VIA TEST)*

## 6. Mobile: Pinch

- **To fingers, begge startet på det aktive lag** → afstandsforholdet opdaterer **kun** `placement.scale`; x, y, anchor og z forbliver uændrede. *(BEKRÆFTET VIA TEST ×2: wheel/pinch-suite + Device-Mode-probe)*
- **En finger løftet → pinch slutter**; press uden bevægelse ændrer intet; `pointercancel` fjerner `is-dragging` og stopper bevægelsen. *(BEKRÆFTET I RUNTIME — Device-Mode-probe14/14)*
- Pinch stoppede det forrige single-finger-drag (én gesture ad gangen). *(BEKRÆFTET VIA KODE + TEST)*

**DevTools-grænsen (vigtigt):**

- **Device Mode-GUI'en (Emulate touch screen): `IKKE VERIFICERBAR I DEVTOOLS`** for pinch. GUI'en kan kun simulere **én** finger ad gangen (musen bliver ét touch-point) og har ingen kontrol til to samtidige touch-points — ægte multi-touch findes ikke i Device Mode-panelet.
- **DevTools-protokollen (CDP `Input.dispatchTouchEvent` med to samtidige `touchPoints`)** kan — og **er brugt her**: pinchen kørte mod den byggede app i Device-Mode-emulering og bestod. *(BEKRÆFTET VIA TEST (CDP-touch))* — men det er **ikke** GUI'ens touch-emulering, og **ikke** en fysisk telefon.

## 7. Touch og normal scrolling

- **CSSOM-runtime-gennemgang** af samtlige stylesheets: **præcis2 regler med `touch-action`** — `.dressed-clothing-layer--editing` og `.placement-field input[type="range"]`. *(BEKRÆFTET I RUNTIME)*
- **Ingen global lås:** computed `touch-action = auto` for `body`, `main` og `.wardrobe-screen`; kilde-grep: hverken `body {touch-action:none}` eller `.wardrobe-screen {touch-action:none}` findes. *(BEKRÆFTET I RUNTIME + VIA KODE)*
- **Normal side-scroll uden for det aktive lag:** swipe på `.wardrobe-toolbar` i Device Mode forøgede `scrollY` (0→220+). *(BEKRÆFTET I RUNTIME; også BEKRÆFTET VIA TEST i touch-suitten)*
- **Event scope/delegation:** alle gestus-lyttere sidder på `#wardrobe-model` og bruger `closest('.dressed-clothing-layer--editing')` — intet globalt `touchstart/touchmove`-lytter findes (grep). `preventDefault()` kaldes kun (a) i `pointerdown` på det redigerede lag og (b) i den behandlede wheel-gren. *(BEKRÆFTET VIA KODE)*

## 8. Placement og persistence

Wheel og pinch bruger **præcis samme** state som slidersen — der findes ingen anden skrivevej end `setPlacementOverride`:

```text
DONE → parsePlacement(placementOverrides.get(id)) → saveItemPlacement() →
PATCH /api/wardrobe/items/:id  {placement:{anchor,x,y,scale}}
→ lokal item.placement → GET ved næste load → DRESSED + Profile resolver
```

- **I lokal runtime blev PATCH-requesten observeret** med værdien `"scale":1.2` i body. *(BEKRÆFTET I RUNTIME — fetchLog)*
- Fuld shape forventes `{"placement":{"anchor":"torso","x":0,"y":0,"scale":1.2}}` (efter RESET + slider1.2): shape+ værdier **BEKRÆFTET VIA KODE** (parsePlacement:4 nøgler, afrunding) + delvist VIA TEST (requesten set med scale-værdien).
- **Faktisk Supabase: `IKKE LIVE VERIFICERET`** — testsuites kører mod en stub-backend, og undersøgelsen havde ingen indlogeret session. Hverken skriv til `wardrobe_items.placement` eller svaret fra den rigtige database er bekræftet her.
- RESET → `placement = null` → defaults ved næste load; DONE → bevarer resten af objektet. *(BEKRÆFTET VIA TEST — persistence-E2E25/25)*

**Niveauskelnen (eksplicit):** *statis kode* ≠ *lokal runtime* ≠ *stub-test* ≠ *faktisk Supabase* ≠ *fysisk telefon*.

## 9. Forholdet mellem clothing scale og model/canvas

- Clothing-lag og base-billede deler samme `absolute inset:0`-boks i `.dressed-canvas`; `--clothing-scale` er en **indre** `scale()` omkring anchor inde i den boks.
- Wheel/pinch/slider ændrer **kun** denne indre skala — `.dressed-canvas` og `dressed-character-base` forbliver transform-fri efter begge gestures. *(BEKRÆFTET I RUNTIME + VIA TEST)*
- Da zoom-laget ikke findes, er der ingen risiko for at placement "følger en zoom": placement er og bliver canvas-fraktioner i det uændrede koordinatsystem (1024×1536-forholdet, `aspect-ratio: 2/3`). *(BEKRÆFTET VIA KODE)*

## 10. Testresultater

| Suite/test | Type | Resultat |
|---|---|---|
| Build (`npm run build`) | statisk | **Complete** ✓ |
| TypeScript (`tsc --noEmit`) | statisk | **12 fejl = pre-eksistente baseline;0 nye** ✓ |
| jsdom | syntetisk DOM | **39/39 PASS** |
| CDP native mouse | native input i rigtig Chrome | **43/43 PASS** |
| Chrome syntetisk | syntetisk DOM-events | **43/43 PASS** |
| Touch-suite | syntetisk CDP-touch | **33/33 PASS** |
| Persistence E2E | syntetisk + stub-DB | **25/25 PASS** |
| Wheel/Pinch-suite | native CDP wheel + touch | **25/25 PASS** |
| **Device-Mode-probe** (ny, midlertidig — ikke en testsuite) | DevTools-emulering + CDP-touch | **14/14 PASS** |

Samtlige8 eksisterende tests kørte uden ændringer. Alle resultater er **BEKRÆFTET VIA TEST** — men de er automatiserede i headless Chrome/jsdom, ikke en håndholdt enhed.

## 11. Bekræftede observationer

- `BEKRÆFTET VIA KODE`: én skrivevej (`setPlacementOverride`), delt clamp0.4–2.0, ingen zoom-state (grep0), wheel-gates, RESET/DONE-flows, z-index uafhængig af scale, `wardrobe_items.placement` indeholder scale.
- `BEKRÆFTET I RUNTIME`: serverede dev-kilder indeholder wheel+pinch+rate; kun2 `touch-action`-regler (CSSOM); body/main/wardrobe-screen = `auto`; single-touch drag, pointercancel-oprydning, scroll udenfor, canvas/base transform `none`; PATCH-requesten med `scale`; den rigtige app viser login-gate uden session.
- `BEKRÆFTET VIA TEST`: alle8 suites (se §10) — herunder A/B/C-wheel, clamp, "kun aktivt item", pinch-kun-scale.
- Observeret under harness-opbygning (**ikke et app-fund**): koordinat-taps i emuleret Device Mode ramte undertiden forkert element (event-log: `click→HTML`, `click→current-outfit-item`) pga. re-render/scroll-race i tap-vinduet — opsætningen er derfor flyttet til DOM-klik, mens alle **gesture**-torts fortsat er ægte touch.

## 12. Ikke verificeret

- **Faktisk Supabase-persistens** (skriv + svar + reload fra rigtig DB): `IKKE LIVE VERIFICERET`.
- **DevTools GUI-pinch**: `IKKE VERIFICERBAR I DEVTOOLS` (kun én finger ad gangen — se §6).
- **Rigtig mus/trackpad-følelse** (wheel-hastighed, notch-adfærd): delvigt repræsenteret af CDP-wheel, men ikke fysisk hardware.

## 13. Kræver fysisk telefon

1. Pinch-følelse på rigtig skærm: to fingre på tøjet, skalaen følger, x/y hopper ikke.
2. Page-scroll med swipe andre steder; ingen uønsket scroll når fingre starter på tøjet.
3. System-gestusser (langt-tryk/kontekstmenu) afbryder ikke drag/pinch — `pointercancel` rydder korrekt.
4. **DONE → refresh → værdien findes stadig** mod den rigtige Supabase (den kendte PATCH-live-fejl skal være løst først).
5. Slider + anchor + RESET + DONE på touch.
6. Desktop: rigtig mus med venstre-hold + hjul (pinch forbliver touch-only pr. spec).

## 14. Eventuelle problemer eller trade-offs

- **`wheelScaleActive`:** efter at have hjul-scalet under et hold, flytter samme hold ikke tøjet (løft og tryk igen). Beskytter x/y mod musejitter — men kan føles uventet. Skal afprøves på rigtig hardware.
- **Pinch afslutter single-finger-drag:** anden finger på tøjet skifter gesture-type med det samme; når én finger løftes, slutter pinchen helt (ingen "forsæt med én finger"). Bevidst valg, men et UX-valg.
- **Discoverability:** venstre-hold + hjul er ikke kommunikeret i UI'et (intet hint; kun `cursor: grab`).
- **Wheel-rate0.0005:** ≈0.05 pr. notch; `deltaMode`-normalisering (×16/×400) dækker linje-baserede hjul (Firefox/Edge), men hastighedsfølelsen er ikke finjusteret på tværs af enheder.
- **Tap-race (kun harness):** koordinat-taps kunne ramme forkert element pga. list-re-render — viser at outfits-listen genopbygges inden for et tap-vindue; relevant viden ved fremtidige UI-ændringer.
- **Ingen visuel feedback** på, at hjul-scaling er aktiv (kun slideren flytter sig).

## 15. Konklusion

Den ønskede arkitektur er implementeret som **ét samlet scale-system**: slider, left-click+wheel og pinch skriver alle `placement.scale` gennem samme clamp og samme persistence-vej. Der findes ingen canvas/model-zoom, ingen separat zoom-state og ingen global touch-lock — verificeret på fem evidensniveauer (undtagen faktisk Supabase og fysisk telefon, som bevidst er markeret som ikke-verificeret). De8 eksisterende tests er uændrede og grønne; den nye Device-Mode-probe gav14/14.

## 16. Anbefalinger

*(Fremtidige forbedringer — intet er implementeret i denne omgang.)*

1. **Fysisk testplan** (§13) køres som næste skridt, inkl. PATCH-live-verifikation mod rigtig Supabase.
2. **UX-overvejelser:** et lille hint i panelet ("HOLD + SCROLL TO SCALE" / "PINCH TO SCALE") overvejes; eventuelt ekstra cursor-feedback under hjul-hold — kræver særskilt godkendelse før implementering.
3. **Følsomheds-finjustering:** hvis hjul føles for hurtig/langsom på rigtig hardware, justeres KUN `WHEEL_SCALE_RATE` (én konstant).
4. **Overvågning ved fremtidige ændringer:** kør altid touch-suitten + wheel/pinch-suitten efter ændringer i placement-sektionen; ny gestus-state må aldrig persisteres (kun `placement.scale`).
5. **Edge cases at følge:** finger der forlader laget uden capture, `pointercancel` fra OS-gestusser på iOS, interaktionen mellem `wheelScaleActive` og senere drag, og listens re-render under tap (§14).

---
*Dokumentet opdaterer ingen tidligere analyse og indeholder ingen kodeændringer. Det eneste nye artefakt er denne fil.*

---

## Efterfølgende status (dokumentationsrunden)

- **PERSISTENCE ER NU LIVE-VERIFICERET** (overhaler den daværende
  "IKKE LIVE-VERIFICERET"-status for persistence): `ADJUST → DONE → PATCH200 →
  SUPABASE → REFRESH → SAME PLACEMENT`, bl.a. `{"x":0,"y":-4.2106,"scale":0.63,
  "anchor":"torso"}` gemt. Baggrunden: CHECK-fejlen (`jsonb_typeof = 'text'`)
  er rettet i `supabase/migrations/202610050003_fix_wardrobe_items_placement_check.sql`.
- **Wheel/pinch forbliver: IMPLEMENTED + AUTOMATED TESTED, BUT NOT LIVE-ACCEPTED**
  (25/25 automatiseret; live-godkendelse mangler fortsat).
- Gældende overordnet status: `analysis/DRESSED-CURRENT-STATUS.md`;
  regler: `docs/DRESSED-PROJECT-SPECIFICATION.md`.

