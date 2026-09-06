# Un interruttore che promette una garanzia non ha ripieghi silenziosi

"Solo modelli a pesi aperti" (#461) spegne tutti i modelli proprietari. Un
interruttore così non è una preferenza estetica: è una **garanzia**, e una
garanzia vale solo se regge anche quando le cose vanno male. Il pattern, valido
per qualunque interruttore che prometta "questa cosa non succederà":

- **Sostituisci, non spegnere.** Se quasi tutte le funzioni nascono col modello
  che l'interruttore vieta, spegnerlo e basta spegne mezza app: ogni funzione
  passa all'equivalente ammesso (`OPEN_WEIGHTS_SUBSTITUTES` in `constants.js`).
- **Il sostituto deve saper fare QUEL mestiere.** La sostituzione automatica è
  l'unico punto in cui Filo cambia modello da solo: se ci mette un modello che
  legge solo testo dove la funzione deve ascoltare un audio, la funzione muore
  con un errore qualunque — che per chi la usa è lo stesso ripiego silenzioso,
  con un finale diverso. Si guardano i requisiti della funzione
  (`SN_MODEL_CAPS.requirementsFor`) contro le capacità DICHIARATE del sostituto
  (`OPEN_WEIGHTS_SUBSTITUTE_MODALITIES`); se non combaciano, la funzione si ferma
  dicendolo, e le Opzioni la elencano fra quelle che si fermano invece che fra
  quelle che cambiano modello.
- **Diffidente per costruzione.** Ciò che non si sa classificare vale come
  vietato — e vale anche per le capacità: capacità ignote = niente sostituzione.
  Ammettere l'ignoto trasforma la garanzia in una promessa a caso.
- **Il cancello sta su OGNI cammino che chiama davvero, non solo sul principale.**
  Le funzioni passano da `buildAttemptChain`, ma i pulsanti «Prova» delle Opzioni
  e della pagina di amministrazione costruiscono la chiamata a mano: sono rimasti
  fuori dalla politica finché non ha avuto un punto solo
  (`openWeightsBlockKind` + `openWeightsBlockReason`/`providerRouting`), e stavano
  proprio nella pagina dove l'interruttore si accende. Quando aggiungi un cammino
  che chiama un modello senza passare dalla catena, il cancello va rimesso lì.
- **Niente ripiego verso ciò che l'interruttore vieta.** La catena di fallback
  viene POTATA prima di partire (`applyOpenWeightsPolicy` dentro
  `buildAttemptChain`): i tentativi vietati non esistono, quindi non possono
  scattare quando il sostituto non risponde. Se non resta niente, la funzione si
  ferma con un errore che la nomina — **mai** un ripiego zitto.
- **Dichiara l'effetto PRIMA.** Le Opzioni dicono quante funzioni cambiano
  modello e **quali si fermano**, calcolato sulla configurazione vera
  (`openWeightsImpact`). Scoprirlo usando l'app è il modo peggiore.
- **Verifica a posteriori, non solo a priori.** L'esclusione a monte è una
  speranza finché non si guarda **chi ha davvero servito** la risposta
  (`servedBy`): se risulta escluso, toast + voce di cronologia marchiata.
- **Vale anche dove decide qualcun altro.** L'interruttore sta sopra la config
  condivisa (crediti di Filo) e allunga la lista di esclusione con Anthropic: il
  punto è poter rifiutare anche la scelta dell'owner.
- **Test:** `tests/unit/openWeightsOnly.test.mjs` (parte pura),
  `tests/unit/testDefaultModel.test.mjs` (i pulsanti «Prova»),
  `tests/open-weights-only.spec.mjs` (catena reale costruita dall'app),
  `tests/options-open-weights.spec.mjs` (l'interruttore, cosa dichiara e quali
  «Prova» resta possibile premere).

La stessa politica vale per gli strumenti che testano Filo
(`tests/agent/llm.mjs`): stessa lista di esclusione dell'app — importata, non
ricopiata — e stesso controllo su chi ha servito.
