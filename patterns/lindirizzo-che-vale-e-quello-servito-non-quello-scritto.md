# L'indirizzo che vale è quello SERVITO, non quello che la pagina si scrive addosso

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Se una decisione di sicurezza guarda l'indirizzo della pagina da cui
si parte, quell'indirizzo dev'essere quello da cui il documento è stato davvero
caricato, non quello che la scheda porta scritto in quel momento. I due
coincidono finché nessuno li separa, e a separarli basta una riga scritta dentro
la pagina.

## Il caso che l'ha fatto nascere

La lista dei siti bloccati (#590) ha una sola eccezione che non passa
dall'utente: si arriva da una pagina di risultati di un motore di ricerca,
quindi l'utente quel sito l'ha cercato apposta.

Quella regola è stata stretta due volte, e tutte e due le volte perché il nome
del motore da solo non basta.

1. **Giro 3, il nome.** La regola riconosceva il motore da una label qualunque
   dell'indirizzo, quindi `google.evil.com` era un motore di ricerca. La cura è
   stata ancorare il nome al dominio registrabile.
2. **Giro 7 (dello stesso feedback), il percorso.** Sul nome di un motore vero
   non ci sono solo i risultati: ci sono pagine che pubblica chiunque, come i
   siti fatti con lo strumento per siti di Google. La cura è stata pretendere un
   percorso di RISULTATI: `/search`, `/sp/search`, la radice con la domanda nei
   parametri. Il commento che accompagnava la correzione diceva: «nessuno di
   questi è un percorso su cui si possa pubblicare una pagina propria».
3. **Giro 9, la scoperta.** Su quel percorso non serve pubblicare niente: ci si
   arriva riscrivendoselo. `history.replaceState({}, '', '/search?q=x')` è una
   riga, gira dentro la propria origine, non chiede permessi e non ricarica
   nulla. Da quel momento l'indirizzo corrente della scheda è quello di una
   ricerca, e la lista non vale più: né sulla scheda, né su una scheda nuova
   aperta da lì, né su un riquadro incorporato, perché tutte e tre chiedono alla
   stessa decisione.

Il difetto non era nell'elenco dei percorsi. Era nell'aver chiesto l'indirizzo a
`webContents.getURL()`, che risponde con quello che la pagina si è scritta
addosso.

## La cura

Un solo posto tiene il conto dell'indirizzo da cui ogni `webContents` è stato
davvero caricato (`URL_SERVITO` in `src/main/tabs.js`, riempito su
`did-navigate`), e tutti i gate della lista lo chiedono a lui
(`urlDiPartenza`). `did-navigate` scatta sui caricamenti veri; pushState,
replaceState e i salti all'ancora passano per `did-navigate-in-page`, che qui
non si guarda. Vale anche per la finestrella di accesso, che ha un cablaggio suo.

Un motore vero non ci rimette niente: i risultati li serve a un indirizzo di
risultati, e le riscritture che fa mentre l'utente affina la ricerca restano
dentro lo stesso percorso.

## Dove vale

Ovunque una decisione guardi «da dove viene questa navigazione» e la risposta
venga da una pagina web: l'eccezione della lista dei siti bloccati oggi, e
qualunque altra deroga futura che si fidi della pagina di partenza. Il referrer
ha lo stesso difetto, ed è anche peggio, perché dopo un `replaceState` la pagina
lo manda già riscritto: usarlo come ripiego va bene solo dove un indirizzo
caricato non esiste ancora.

Il segnale generale: **quello che una pagina può cambiare da sé non è una
prova**. Prima di appoggiarci sopra una deroga, chiediti chi scrive quel valore.

## La metà gemella: un nome non si descrive, si elenca

Anche quando l'indirizzo è quello servito davvero, resta la domanda di chi
possiede il nome. Nella stessa eccezione la regola diceva «un motore di ricerca
è `<nome>` davanti al suffisso pubblico»: una forma, non un'identità. La forma
lascia libere tutte le estensioni, e `searx.xyz`, `searx.top`, `searx.cheap`
sono nomi che chiunque registra in dieci minuti per pochi euro — chi li aveva si
prendeva la deroga su ogni strada insieme, senza nemmeno una notifica. Al posto
della regola c'è un elenco di domini registrabili scritti per esteso: costa una
tabella lunga e un aggiornamento quando un motore cambia nome, e in cambio non
c'è nessuna forma da indovinare.

Il prezzo va detto, perché è una scelta: chi ospita un motore in casa propria,
su un nome suo, perde la deroga, perché per il controllo è indistinguibile da un
nome comprato apposta. La strada gli resta, ed è quella che la deroga non le
toglie: «Apri comunque» sulla notifica.

Lo stesso segnale, allargato: **quello che chiunque può procurarsi non è una
prova**, che sia un valore che la pagina si riscrive o un nome che si compra.
