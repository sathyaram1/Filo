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
- **Le voci del registro dichiarano le modalità** (`inputs`/`outputs`) e chi
  valida (editor delle Opzioni, menu «Detta», pulsanti «Prova») le legge via
  `entryModalities`: un modello dal nome muto non passa per "forse sa tutto".
- **Test:** `tests/unit/openrouterAudio.test.mjs`, `dictationSegmenter.test.mjs`,
  `ttsVoices.test.mjs`; `tests/tts-voice-openrouter.spec.mjs`,
  `dictation-live.spec.mjs`, `dictation-open-weights-reason.spec.mjs`,
  `tab-semantic-search.spec.mjs` (reindicizzazione).
