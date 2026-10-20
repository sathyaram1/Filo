# La risposta di un invoke sorpassa gli eventi in diretta

[← Tutti i pattern](../PATTERNS.md)

Una pagina che riceve eventi in diretta (`webContents.send`) mentre aspetta la risposta di un
`ipcRenderer.invoke` non chiude la diretta quando arriva la risposta: aspetta un segno di fine
mandato sullo stesso canale degli eventi, dietro all'ultimo. Oppure la risposta porta tutto quello
che la diretta ha mostrato, e gli eventi in ritardo si buttano senza perdere niente.

## Il caso (#1321)

Nella chat della home il main racconta il turno sui canali `filo:reasoning`, `filo:answer` e
`filo:action`, e alla fine risponde all'invoke `filo:message`. Nella scheda i due arrivano su code
diverse: quando la scheda è occupata (macchina carica, una pagina pesante, un'animazione) gli eventi
restano in coda e la risposta passa davanti. La chat chiudeva la diretta alla risposta e toglieva i
suoi ascoltatori: gli eventi ancora in coda finivano nel vuoto.

L'utente vedeva un blocco del lavoro senza la nota scritta a metà turno, o senza l'ultimo
ragionamento prima della risposta. La bolla della nota veniva riusata per la risposta finale, quindi
la risposta c'era e nient'altro faceva sospettare. Le prove lo prendevano una volta su quattro sotto
carico, mai da sole.

Bloccando la scheda per due secondi mentre il main manda venti eventi e la risposta, la risposta
arriva per prima tre volte su tre: non è un caso raro di Electron, è come sono fatte le code.

## La regola

- Il main manda il segno di fine sullo stesso canale degli eventi, subito prima di rispondere, e
  nella risposta scrive che l'ha mandato (`diretta: true`). Il canale è uno solo e ordinato, quindi
  quando la scheda vede il segno ha già visto tutto quello che c'era prima.
- La scheda, con la risposta in mano, aspetta il segno solo se la risposta dice che è partito. Senza
  quella promessa non aspetta: un turno fallito prima di cominciare non lascia la chat appesa.
- Un tempo d'attesa al posto del segno non serve: la scheda che ha ricevuto la risposta riceverà
  anche il segno, che è partito prima.
- La strada alternativa vale quando la risposta può portare tutto: la chat dei mazzi rimanda il
  ragionamento intero nella risposta, e lì un evento in ritardo non toglie niente.

## Dove vive

- `src/main/services/handlers/filo.js`: `chiudiDiretta`, attorno al gestore di `FILO_CHAT`.
- `src/pages/dashboard/dashboard.js`: `runFiloTurn`, `direttaFinita`.
- Prova: `tests/dashboard-chat-strumenti.spec.mjs`, «A2». Il main trattiene gli eventi verso la home
  dalla fine del primo giro. Quando la risposta è partita, una seconda richiesta dalla pagina fa da
  segno: le risposte arrivano nell'ordine in cui partono, quindi tornata quella, la scheda ha già la
  risposta del turno. Solo allora gli eventi trattenuti partono. Senza la correzione la nota manca.

Vicino: [Una prova che guarda un momento lo tiene aperto lei](una-prova-che-guarda-un-momento-lo-tiene-aperto-lei.md).
