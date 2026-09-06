# Azioni di Filo: livello di sicurezza statico nel registro, mai deciso dall'LLM

Ogni azione che Filo (l'AI) può intraprendere dichiara il proprio livello nel
**registro** `src/shared/actionLevels.js` (#146.2): 1 = reversibile, esegue
subito; 2 = popup di conferma con spiegazione (OK/Annulla); 3 = irreversibile,
l'utente digita "conferma". Il dispatch (`executeFiloAction` nel main)
**rifiuta le azioni non registrate**: un nuovo potere di Filo che non dichiara
il livello non viene eseguito.

- **Regola operativa:** quando aggiungi un'azione Filo, registrala in
  `actionLevels.js` con livello + `describe()` (la spiegazione in chiaro per il
  popup) E in `actionTools.js` con descrizione + parametri: è lì che il modello
  la vede, come strumento nativo (tool calling), non più in un elenco nel
  prompt. Il nome dello strumento È il tipo dell'azione. La sentinella
  `tests/unit/actionTools.test.mjs` pretende che i due elenchi combacino: uno
  strumento senza livello non si esegue, un livello senza strumento non si può
  chiamare. Le descrizioni che dipendono dal sistema (shell, percorsi) sono
  funzioni di `{ sistema }`, mai testo fisso con un esempio di Windows.
- **L'esito di un'azione ha due assi, non uno.** `executed` dice se è andata
  a buon fine; `kept` dice se in chat c'è qualcosa da CLICCARE (un bottone).
  Un appunto scritto o una lezione fissata sono `executed: true, kept: false`.
  Chi costruisce l'esito per il modello legge `executed` (e `rejected` per
  «non è un'azione»), mai `kept`: leggere `kept` come «fallita» faceva
  ritentare al modello appunti e lezioni già salvati, duplicandoli.
- **Il diario racconta TUTTO quello che Filo fa, e non promette il
  contrario.** `kept: false` non vuol dire invisibile: l'azione torna comunque
  alla chat marcata `_traccia` e diventa una riga. Prima sparivano appunto,
  lezione, spunta dell'accoglienza, proxy e stile della pagina: un turno di
  sole azioni «silenziose» non lasciava nemmeno il blocco, e l'utente non
  sapeva dove fosse finito il suo appunto. Ogni azione porta anche `_executed`:
  a `false` la riga dice cosa NON è riuscito e il riassunto non la conta —
  un documento inesistente diceva «Leggo il documento…» e si riassumeva in
  «letto un documento». Riga e bottone non si escludono: l'appunto ha la riga
  che racconta e il bottone che porta all'editor; un'azione in attesa di
  conferma ha la riga «Conferma chiesta …» e il bottone per rispondere (senza
  quella riga un turno di sola richiesta non lasciava blocco, e alla conferma
  non c'era più dove scrivere che era stata data).
- **Quello che succede DOPO la risposta deve arrivare al modello.** Una
  conferma data nel popup (livello 2 e 3) e le azioni già eseguite in un
  tentativo interrotto da un guasto non stanno in nessun messaggio: rientrano
  nel contesto del turno successivo come righe di sistema
  (`confirmedActionsForPrompt`, `interruptedActionsForPrompt`). Senza, a «l'hai
  attivato?» il modello tirava a indovinare, e un «Riprova» rifaceva il timer
  che aveva appena messo. Per le preferenze il livello è per-setter in `preferences.js`
  (`level: 2` su ciò che tocca sicurezza/shell). La sospensione e la conferma
  passano da `needsConfirm` → bottone in chat → `MSG.FILO_CONFIRM_ACTION`; il
  main **riclassifica** alla conferma, non si fida del client.
- **Il popup di livello 2 spiega COSA Filo fa e i RISCHI (#183).** Non basta
  nominare la modifica: ogni setter di `preferences.js` di livello 2 **deve**
  dichiarare un campo `risk` — una frase in chiaro su cosa controlla
  l'impostazione e cosa si rischia a toccarla. `describe()` compone
  label + `risk`, e il popup mostra entrambi. Un setter di livello 2 senza
  `risk` è un bug: lo intercetta `tests/unit/preferences.test.mjs`.
- **Il livello guarda l'EFFETTO, non il nome del flag (#284 → #479).** Nei
  comandi shell (`src/shared/cmdClassify.js`) è la tentazione ricorrente:
  riconoscere il flag che si è visto nella segnalazione e chiamarla fatta. Ma
  `curl` senza `-o` stampa a schermo mentre `wget` senza flag scrive comunque un
  file, quindi la stessa regola sui due programmi lascia scoperta la strada
  equivalente. Formula la regola come invariante sull'effetto ("se scarica dalla
  rete e fa atterrare un file su disco, allora conferma rigorosa") e poi verifica
  che copra le strade che non hai visto: `-P` sceglie la cartella invece del
  nome, `-c`/`-N` accodano o sovrascrivono un file già lì, `-K` prende le opzioni
  da un file. Un check per flag si aggira con un altro flag.
- **Un'ESENZIONE non si decide leggendo il testo del comando (#479).** Alzare
  il livello guardando una parola è sicuro (al massimo costa attrito); ABBASSARLO
  perché una parola compare non lo è mai, perché il classificatore legge un
  testo mentre il programma legge un `argv` costruito dalla shell, e le due cose
  divergono ovunque: dopo `--` un'opzione diventa un operando
  (`wget -N -- <url> --spider` scarica), le virgolette incollano la parola in un
  argomento che non è un'opzione (`wget "<url>" " --spider "` scarica), e dentro
  l'URL non è nemmeno un token (`wget "<url>#  --spider "` scarica). Ricostruire
  "è davvero un'opzione?" vuol dire riprodurre getopt e il quoting — cioè il
  parsing di shell che `cmdClassify.js` si vieta per principio. Quindi: se la
  forma esente è rara, TOGLI l'esenzione (una conferma in più su un comando che
  quasi nessuno usa, e la porta è chiusa per costruzione); se è comune, indirizza
  l'utente alla forma equivalente già al livello giusto (per la sola verifica di
  un indirizzo, `curl -I` stampa a schermo e resta 2).
- **La conferma dice il CONTESTO che nel comando non si legge (#479).** La
  cartella di lavoro dell'assistente è persistente e la sposta lui con un `cd`
  (livello 1: nessuna conferma), quindi `wget http://x/authorized_keys` è
  innocuo nella home e sovrascrive una chiave dentro `~/.ssh` con lo stesso
  identico testo. Il main inietta la cartella come `_cwd` prima del gate e
  `describe()` la scrive nel popup, come già fa con `_targets`/`_illegible`. Due
  vincoli: il contesto è solo TESTO e non tocca mai il livello (quello lo decide
  il comando), e va abbreviato per la lettura (`~/.ssh`, non
  `/home/mario/.ssh`), che tiene anche il nome utente fuori da un popup disegnato
  dentro una pagina web qualsiasi.
- **UI:** le conferme usano i componenti riusabili `SN_CONFIRM_UI.confirm`
  (livello 2) e `SN_CONFIRM_UI.confirmTyped` (livello 3) in
  `src/shared/confirmUi.js` — mai `window.confirm` nativo.
- **Sicurezza (#249):** il dialogo vive in uno **Shadow DOM chiuso** agganciato
  a un host neutro `.sn-confirm-host`: gli script della pagina non possono
  trovarne i bottoni (querySelector/MutationObserver) né auto-cliccare OK. NON
  tornare mai ad appendere i bottoni al DOM del documento. Nei test Playwright
  i locator non attraversano il root chiuso: usa `tests/helpers/confirm.mjs`
  (presenza → host `.sn-confirm-host`; contenuto/click/input → hook
  `SN_CONFIRM_UI._test` via `page.evaluate`, disponibili sulle pagine filo://).
- **Test:** `tests/unit/actionLevels.test.mjs`, `tests/filo-action-levels.spec.mjs`,
  `tests/audit-confirm-dom-bypass.spec.mjs`.

**Filo ESEGUE, non mostra bottoni inerti (#162/#159).** Quando l'utente chiede
un'azione, Filo la compie — non lascia un bottone "da cliccare per davvero":
- **NAVIGA apre subito** la scheda (in `executeFiloAction`, via `tm.openTab`); il
  chip che resta nella bolla è solo un riferimento per RIAPRIRE e ha SEMPRE
  un'etichetta (favicon + hostname), mai un favicon muto. Quando l'unica cosa che
  Filo fa è aprire un link, `text` resta vuoto: niente "(vuoto)" di riempimento
  (il fallback "(vuoto)" vale solo per la risposta davvero vuota, senza azioni).
  Per PROPORRE link tra cui scegliere si usano link markdown nel testo, non NAVIGA
  (che aprirebbe da solo).
- **Le impostazioni di livello 2 sono SEMPRE un popup, mai un chip inerte (#183).**
  `renderActions` riceve `autoConfirm:true` sulle risposte fresche e apre da sé il
  popup di conferma dei bottoni `IMPOSTA_PREFERENZA`/`IMPOSTA_ESTETICA` di livello 2.
  Se nella stessa risposta ce ne sono **più d'una**, i popup si aprono **uno alla
  volta** (`renderActions` attende `_runConfirm()` di ciascuno prima del successivo):
  niente stacking di modali, ma neanche bottoni lasciati lì da cliccare a mano. Il
  bottone resta solo come ripiego se l'utente **annulla**. Vale anche per la
  segnalazione che Filo propone da sé (`INVIA_FEEDBACK`, #414): il popup non invia
  nulla, mostra il testo e aspetta l'OK — è la stessa cosa che fa da sempre la
  sidebar, e lasciare un chip da cliccare aggiungeva un passaggio prima ancora di
  poter leggere cosa sarebbe partito. Restano a click esplicito solo le azioni
  distruttive (livello 3) e i comandi: niente auto-conferma di cose irreversibili.
- **Il popup di livello 2 mostra il testo INTERO, non un estratto (#414).** Se è
  lungo scorre dentro il box (`.sn-confirm-text` ha `max-height` + `overflow-y`),
  mai un `…` a metà frase: un consenso su un testo che l'utente non ha potuto
  leggere per intero non è un consenso. Vale in particolare per il feedback, che
  parte a nome suo.
- **Test:** `tests/filo-open-link-direct.spec.mjs`, `tests/filo-action-levels.spec.mjs`
  (più popup di livello 2 → si aprono in sequenza, nessun chip resta da cliccare).
