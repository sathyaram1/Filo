# Dati che cambiano ALTROVE (cloud): si chiede la VERSIONE, non il dato

[← Tutti i pattern](../PATTERNS.md)

Il pattern qui sopra vale quando chi produce l'evento sta sulla stessa macchina
e può suonare un campanello. La dashboard di gestione legge i feedback da
Firestore, dove scrivono le routine in cloud e il server: nessun campanello
arriva fin qui, e senza SDK (che non usiamo) non c'è un canale in ascolto.
Quindi la pagina DEVE chiedere — ma chiedere costa, e ricaricare tutto
(5 MB, poi la decifratura) era il motivo per cui la pagina si apriva in dieci
secondi e nessuno la ricaricava.

- **A ogni giro si chiedono le sole versioni** (id + ultima scrittura del
  documento, la mette Firestore da sé: proiezione `__name__`, ~130 KB per 500
  feedback), si confrontano con quelle in mano, e **si rileggono solo i
  documenti cambiati o nuovi**, in una richiesta sola (`batchGet`). Un giro
  senza novità non ridisegna niente e non decifra niente.
- **Il ritmo è una spesa, e va detto dove si regola**: ogni giro paga una
  lettura per feedback in pagina anche quando torna "niente di nuovo".
  Sessanta secondi tiene il passo con le routine (lavorano per minuti) per
  pochi euro al mese; è UNA costante (`SN_FEEDBACK_LIVE.POLL_MS`), non un
  numero sparso.
- **Si gira solo da visibili**, e il rientro (scheda tornata in vista,
  finestra in primo piano) anticipa il giro se è passato abbastanza tempo:
  chi apre la dashboard dopo un'ora vede subito le novità.
- **Il ridisegno non toglie niente dalle mani dell'owner**: la lista conserva
  scorrimento e selezione; il pannello aperto si aggiorna solo se non ci sta
  scrivendo dentro (i dati sotto si fondono comunque, e si vedono al giro dopo
  o riaprendo la scheda).
- **La prima lettura parte per prima**: la lista è la cosa più lenta (secondi
  di rete), quindi si avvia all'apertura della pagina e le altre letture di
  avvio girano mentre viaggia — non in fila davanti. E la decifratura di
  centinaia di feedback importa la chiave privata **una volta** e lavora in
  parallelo (pool di thread di Node): da sei secondi a meno di due.
- **Dati finti = giro fermo.** Un hook di test che inietta la lista spegne
  l'aggiornamento continuo, altrimenti il primo giro la rimpiazzerebbe con
  Firestore a metà spec; chi vuole provare il giro sostituisce le sorgenti.
- **Dove:** `src/shared/feedbackLive.js` (confronto + fusione, puro),
  `listVersions`/`getMany` in `src/shared/feedback.js`, la sezione
  "Aggiornamento continuo" di `src/pages/manage/manage.js`. Test:
  `tests/unit/feedbackLive.test.mjs`, `tests/unit/feedbackListLight.test.mjs`,
  `tests/unit/feedbackCryptoKeyCache.test.mjs`, `tests/manage-live-update.spec.mjs`.
