# "Vai a guardare in quell'altro posto": quel posto deve accorgersene DA APERTO

Quando una superficie manda l'utente su un'altra (il terminale che dice
"approvala dalla dashboard di gestione"), la seconda è quasi sempre **già
aperta** — la pagina di gestione lasciata lì in una scheda. Se carica
il suo elenco solo all'apertura, l'avviso compare soltanto a chi pensa di
riaprirla: cioè a nessuno. È successo il giorno stesso in cui l'indicazione è
stata scritta.

- **Chi PRODUCE l'evento lo dice; nessuno chiede a ripetizione.** Se il
  produttore gira sulla stessa macchina (qui `npm run finish`), gli basta
  scrivere un file in un punto che main e script calcolano **allo stesso modo**
  (`FILO_USER_DATA` nei test, la cartella temporanea fuori — mai il percorso
  dell'app: uno script Node non sa come si chiama). Il main guarda la
  **cartella** dedicata, non il file (che può ancora non esistere) e non la
  cartella temporanea intera (si sveglierebbe a ogni file del sistema).
  Costo a riposo: zero. Se i due percorsi divergessero, il campanello non
  suonerebbe **in silenzio** — per questo il calcolo sta in un posto solo, con
  uno unit test sopra.
- **La rilettura la fa il MAIN, non ogni pagina.** Una lettura sola con dieci
  schede aperte, il cancello del proprietario in un punto solo, e il dato
  viaggia **dentro** il messaggio di broadcast: la pagina ridisegna senza
  richiedere niente.
- **Un broadcast che porta dati dell'utente va SOLO alle pagine `filo://`**
  (`broadcastToFiloPages`, il gemello di `broadcastToTabs`): `broadcastToTabs`
  raggiunge anche il content script del sito visitato. È il gate d'origine
  visto dal verso opposto — se un sito non lo può *chiedere*, non glielo si
  manda nemmeno da soli.
- **Rete di sicurezza guidata da una persona, non da un orologio.** Il
  campanello può mancare (app chiusa quando è arrivato l'evento, cartella
  ripulita, un domani un produttore remoto). Il ripiego è il **rientro nella
  finestra** (`browser-window-focus`, e solo la finestra vera: il popup dei menu
  è una BrowserWindow sua e ogni menu conterebbe come un rientro), con un
  intervallo **largo** — cinque minuti: il caso vero lo copre già il campanello,
  quindi la rete non deve costare. Chi resta sulla pagina per ore non genera
  nemmeno una chiamata. Un intervallo fisso invece paga sempre, soprattutto
  quando non c'è niente da mostrare.
- **Se l'elenco non è cambiato, non si tocca la pagina**: un avviso che si
  ridisegna sotto le dita (magari con "Confermi?" già armato) è rumore.
- **Dove:** `src/main/services/mergeApprovalSignal.js` (campanello + decisione
  con l'I/O iniettato), `broadcastToFiloPages` in
  `src/main/services/handlers.js`, `MSG.MERGE_APPROVALS_CHANGED`. Test:
  `tests/unit/mergeApprovalSignal.test.mjs`, `tests/merge-approvals.spec.mjs`.
