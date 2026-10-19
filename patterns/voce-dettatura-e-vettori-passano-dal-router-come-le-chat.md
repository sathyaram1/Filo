# Voce, dettatura e vettori passano dal router come le chat (niente API del produttore)

[← Tutti i pattern](../PATTERNS.md)

Lettura ad alta voce, dettatura e indicizzazione dell'archivio erano le tre
funzioni rimaste sull'API diretta di Google: la politica sui modelli non la
ammette, e finché esisteva un cammino "speciale" la politica valeva a metà.
Oggi passano dagli endpoint audio/embedding del router (`openrouter.js`:
`synthesizeSpeech`, `transcribe`, `embed`), con la stessa lista di esclusione
delle chat. Regole che ne seguono:

- **Un fornitore si trova per nome** (`SN_PROVIDER_<NOME>` su globalThis,
  `getProvider` in `providers/index.js`); `PRODUCER_DIRECT_PROVIDERS` resta
  come meccanismo ma è vuota. Un fornitore nuovo (es. modelli in locale) si
  registra, non si aggiunge a un `if`.
- **Chi ha servito si chiede dopo, se la risposta non lo dice.** Gli endpoint
  audio rispondono coi byte e un `x-generation-id`; il nome dell'host arriva
  qualche secondo più tardi da `/generation`. `auditServedByLater` (handlers.js)
  lo chiede fuori dal cammino della risposta, marchia la voce di cronologia
  (`History.patch`) e, per la lettura, registra anche il costo che il router
  riporta lì. Senza questo riscontro la lista di esclusione è solo una speranza.
- **Sugli endpoint audio il router ignora il blocco `provider`** (#713:
  `ignore`, `only` e `order` lì non valgono). Per voce e dettatura la lista di
  esclusione si applica PRIMA di chiamare: `hostVerdict` (openrouter.js) legge
  chi serve il modello da `/models/{id}/endpoints` (un'ora di cache; un elenco
  scaduto si usa mentre si rilegge) e **si parte solo se gli host sono noti e
  TUTTI ammessi** (`hostPolicyViolation`, constants.js; decisione dell'owner,
  #1141): con host misti il router sceglie per prezzo e può dare l'audio proprio
  all'escluso. Altrimenti `ensureAllowedHost` non chiama e lancia
  `NO_ALLOWED_HOST` con un motivo per caso (tutti esclusi, misti, ignoti), che
  lettura, dettatura e «Prova» mostrano così com'è. Una lettura fallita si
  ritenta dopo pochi secondi, non a ogni frase. Lo stesso verdetto arriva
  mentre si sceglie il modello (`AUDIO_HOST_CHECK`: Opzioni, Modelli
  predefiniti, «Detta ▸» dal tasto destro), come avviso che non blocca la
  scelta. Senza niente da escludere non si legge niente. Resta il riscontro a
  posteriori.
- **La lista la sceglie la chiave con cui la chiamata parte** (#962): con la
  chiave propria e «Con la mia chiave, usa anche i fornitori esclusi» vale
  `ownKeyIgnore` del routing, coi crediti di Filo sempre l'intera. Il ripiego
  dalla chiave rifiutata ai crediti riparte quindi con l'intera, e su voce,
  dettatura e classificatori, dove il router non la applica, parte solo se gli
  host passano il controllo dei crediti (`hostCheckedFetch`); altrimenti risale
  il rifiuto della chiave. Prove: `tests/unit/chiavePropriaFornitori.test.mjs`.
- **Coi crediti di Filo vale anche la ritenzione zero** (#831): `providerBlock`
  aggiunge `zdr: true` a ogni corpo pagato da una chiave che non è la propria
  (ripiego compreso), tranne i modelli da comprare solo dal produttore. Per
  voce, dettatura e classificatori `hostVerdict` chiede in più che TUTTI gli
  host compaiano nel catalogo `/endpoints/zdr` (motivi `zdr`, `zdrmixed`,
  `zdrunknown`); un 404 delle chat senza host ammessi a ritenzione zero diventa
  `NO_ALLOWED_HOST` con `reason: 'zdr'`, la frase di #828. Anche i tre motivi
  dell'audio passano dal cancello alla frase condivisa (funzione, modello,
  motivo, dove cambiarlo); quelli degli host esclusi tengono la loro. Prove:
  `tests/unit/ritenzioneZero.test.mjs`, `tests/voce-ritenzione-zero.spec.mjs`.
- **Gli embedding non hanno il controllo preventivo**: la documentazione del
  router dice che lì il blocco `provider` vale, e la risposta porta chi ha
  servito. Non è provato con una chiamata vera: se un riscontro a posteriori
  marchia un vettore servito da un escluso, vale la stessa regola dell'audio.
- **Il costo dell'audio è quello del router**, non un listino a token:
  `usage.costUsd` ha la precedenza in `estimateCostEur` (costTracker.js).
- **I vettori portano il nome del modello che li ha fatti** (`embedModel` sulla
  scheda archiviata): la ricerca confronta solo quelli del modello in uso e
  reindicizza gli altri in background (`reindexArchivedEmbeddings`). Cambiare
  modello di indicizzazione è un cambio di "lingua", non un dettaglio.
- **La dettatura è a spezzoni, non un file alla fine**: `dictationSegmenter.js`
  (puro, testato sui campioni) chiude una frase a ogni pausa → trascrizione
  definitiva nel campo; ogni ~1,2 s di parlato → provvisoria nel riquadro. Il
  main riceve `{ audioBase64, format, lang, interim }`; le provvisorie non
  finiscono in cronologia, il costo sì.
- **Il microfono è uno solo** (#948): `ascolto.js` apre il microfono, spezza in
  frasi, chiede la trascrizione al main e dice ogni guasto con una frase che
  dice cosa fare. Lo usano «Detta» e il tasto microfono delle chat
  (`voceChat.js`, accanto all'invio della home, dell'Aiuto e della chat
  dell'Editor): una strada sola verso la trascrizione, quindi lo stesso
  controllo degli host. Il tasto invia con la funzione della sua chat, mai con
  una copia; nella casella di una chat «Detta» gli passa la mano; risponde solo
  a gesti veri, perché dentro un sito un clic fabbricato accenderebbe il
  microfono di Filo. Quando chi parla ha finito lo decide `endOfSpeech`
  (dictationSegmenter.js, pura), su tutta la registrazione e non sullo
  spezzone, che a ogni frase si azzera.
- **Le voci del registro dichiarano le modalità** (`inputs`/`outputs`) e chi
  valida (editor delle Opzioni, menu «Detta», pulsanti «Prova») le legge via
  `entryModalities`: un modello dal nome muto non passa per "forse sa tutto".
- **Test:** `tests/unit/openrouterAudio.test.mjs`, `vocePoliticaHost.test.mjs`,
  `dictationSegmenter.test.mjs`, `ttsVoices.test.mjs`, `voceChat.test.mjs`;
  `tests/voce-chat.spec.mjs`, `tts-voice-openrouter.spec.mjs`, `voce-dettatura-host-esclusi.spec.mjs`,
  `dictation-live.spec.mjs`, `dictation-open-weights-reason.spec.mjs`,
  `tab-semantic-search.spec.mjs` (reindicizzazione).
