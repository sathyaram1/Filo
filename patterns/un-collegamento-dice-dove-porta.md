# Un collegamento dice dove porta

**Regola.** Quando Filo trasforma in collegamento un indirizzo che arriva da
fuori, la scritta che si legge deve nominare il sito dove si finisce. Un
indirizzo si accorcia sempre dal lato del percorso, mai dal lato del sito; se è
il sito a non entrare, si taglia da DAVANTI e la fine — la parte che dice dove
si è — resta. E un indirizzo accorciato lo dichiara con un carattere di
troncamento.

Non si mostra mai quello che sta prima della chiocciola: non è il sito, sono
credenziali, e in un indirizzo costruito apposta stanno lì solo per riempire la
scritta.

## Il caso che l'ha fatta nascere

Verifica del feedback #582, giro 3. Nell'elenco dei feedback, in cima a ogni
scheda, c'è l'indirizzo della pagina da cui la segnalazione è partita ed è un
collegamento: chi guarda la segnalazione lo apre, perché è il posto dove il
problema è successo. Quell'indirizzo però non lo sceglie Filo — sta dentro la
segnalazione, e una segnalazione la manda chiunque, anche senza account e senza
avere Filo installato. L'elenco lo apre ogni tester (menu del tasto destro,
elenco delle app) e mostra le segnalazioni di tutti: un'esca lì dentro la
vedevano tutti.

La scritta erano i primi 80 caratteri dell'indirizzo, tagliati senza nemmeno un
puntino. Due forme, misurate:

- **sottodomini**: `https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.sito-di-un-estraneo.invalid/accedi`
  si leggeva `https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.si`.
  Il sito vero, che è la coda, non compariva affatto.
- **credenziali**: `https://filo.app-aggiornamento-…-okay@sito-di-un-estraneo.invalid/accedi`
  si leggeva fino alla chiocciola esclusa, quindi come un indirizzo di Filo.

## I tentativi sbagliati

- **Togliere il collegamento e basta.** È la cura della pillola di un allegato
  (giro 2), dove è giusta: un allegato che non sta nel deposito di Filo non è un
  allegato. Qui no: quella pagina serve, è la prima cosa che si apre guardando
  una segnalazione. Togliere la strada per non doverla spiegare è attrito
  (`filo_filosofia.txt`).
- **Fermarsi all'host, o confrontarlo con una regex.** È l'errore gemello del
  pattern [Una credenziale si manda all'indirizzo esatto, non all'host](una-credenziale-si-manda-all-indirizzo-esatto-non-all-host.md):
  un indirizzo si parsa con `new URL`, che normalizza maiuscole, chiocciola e
  `..`; una regex su una stringa si fa fregare da tutte e tre.
- **Accorciare dalla coda perché è quello che fanno i puntini di sospensione.**
  Su un indirizzo la coda è l'informazione, non l'ornamento.

## Dove vive

- `SN_FEEDBACK.linkLabel` in `src/shared/feedback.js` — pura, una fonte sola.
- Chi la usa: `src/pages/feedback/feedback.js` (l'indirizzo in cima alla scheda).
- Guardie: `tests/unit/feedbackLinkLabel.test.mjs` (la forma della scritta, caso
  per caso) e `tests/feedback-indirizzo-della-pagina.spec.mjs` (che la pagina la
  usi davvero).
