# In chat: il blocco di attività della domanda (uno per messaggio, avvolto a lavoro finito)

[← Tutti i pattern](../PATTERNS.md)

Sopra la risposta finale di Filo nella chat della home c'è un blocco smorzato
che raccoglie tutto ciò che Filo fa **prima di rispondere** (#521). Filo non
«ragiona e basta»: agisce, in più giri dentro lo stesso turno (ragiona, cerca,
legge, ragiona ancora). Per l'utente è un lavoro solo, e il blocco è uno solo
(`createActivity()` in `src/pages/dashboard/dashboard-attivita.js`, che la home
chiama come `SN_DASH_ATTIVITA.create(container)`; stili
`.dash-activity*` in `dashboard.css`).

**Chi guida i giri è il main, non la scheda.** Le azioni sono strumenti nativi
del modello (tool calling: `src/shared/actionTools.js`, il ciclo in
`handleFiloChat`): il modello chiama un'azione, il main la esegue, gli rimanda
l'esito come messaggio `tool` e lo richiama, finché risponde senza chiamare
niente. La scheda riceve tre canali e li mette nel blocco nell'ordine in cui
arrivano: `filo:reasoning` (ragionamento), `filo:answer` (testo) e
`filo:action` — `start` appena il modello NOMINA un'azione (la riga in testa
dice subito «Cerco sul web…», prima degli argomenti), `done` a esecuzione
avvenuta (la riga vera, con l'esito), `round` a fine di un giro con azioni (il
testo scritto in quel giro era una nota di lavoro: entra nel blocco e la bolla
riparte). Non esistono più messaggi di spinta mandati dalla scheda come turni
«utente» interni. Il modello che ignora gli strumenti e scrive il vecchio JSON
nel testo viene ancora letto (`legacyEnvelope`), senza ritentativi.

- **Cosa si vede mentre lavora, e dopo**: il filo, i nodi e il gomitolo,
  in [Il filo dell'attesa](il-filo-dell-attesa.md). A lavoro finito il blocco
  è una riga sola (il gomitolo) col riassunto: «Ha cercato sul web, impostato
  una sveglia e letto un documento · 1 min 20 s» (`summarizeActivity`, verbi
  per tipo con i doppioni contati) oppure «Ragionamento · 24 s».
- **Niente frasi inventate.** Le vecchie righe «Consulto la memoria…» erano
  teatro, non stato: l'utente le leggeva come ragionamento del modello.
- **Un clic srotola la cronologia completa**, nell'ordine in cui è avvenuta, un
  nodo per pensiero: dentro ogni nodo il ragionamento (tutto, non le ultime tre
  righe), le **note** e le righe delle azioni «icona + due parole»
  (`ACTIVITY_ROWS` dà il testo; l'icona la dà `src/shared/actionIcons.js`,
  `SN_ACTION_ICONS.svg(type, size)`: SVG della famiglia di Filo, mai emoji —
  l'icona di un'azione sta in un posto solo, e la sentinella
  `tests/unit/actionIcons.test.mjs` pretende che ogni azione registrata in
  `actionLevels.js` ne abbia una), con gli esiti dei comandi eseguiti subito.
  Una nota è il testo di un giro che non era l'ultimo («Provo subito tutti e
  tre…»): era una bolla e diventa una nota dentro il suo nodo. Per l'utente
  conta la risposta, non il commento a metà lavoro. Il prompt chiede al modello
  di lasciare vuoto quel testo salvo lavori lunghi.
- **Ciò che si clicca resta fuori.** Un link da aprire, una conferma da dare,
  l'esito di un comando bloccato: bottoni sotto la risposta, come da regola
  «i passi intermedi sono tracce, i risultati sono bottoni». Una bolla
  intermedia che contiene bottoni NON viene assorbita nel blocco (contenuto
  nascosto: rivelalo, non toccarlo di nascosto).
- Perché una riga compaia il main deve RESTITUIRE l'azione (`kept: true`):
  timer e sveglie prima venivano scartati dopo l'esecuzione e non arrivavano
  mai alla chat.
- Il ragionamento di ogni turno entra nello storico del thread come testo
  (`reasoning`, `reasoningMs`, per la lettura) e come blocchi strutturati del
  fornitore (`reasoningDetails`): questi ultimi tornano al modello nel
  messaggio dell'assistente (`reasoning_details`), dentro il giro e al turno
  dopo, così riprende da dove aveva lasciato invece di ripensare tutto.
- Senza niente da raccontare il blocco si toglie da solo: nessun residuo.
- Test: `tests/dashboard-chat-attivita.spec.mjs` (con screenshot in
  `tests/agent/.out/attivita-*.png`). Gli spec che asseriscono una traccia
  («Cerco sul web», «Verifico cosa so fare») contano l'elemento, non la
  visibilità: vive dentro un nodo chiuso del gomitolo.

Le altre chat (Mazzi, barra laterale) hanno ancora le loro versioni: da
unificare su questa.
