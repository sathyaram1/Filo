# Una funzione in pausa sparisce da ogni porta, e i dati dell'utente restano suoi

[← Tutti i pattern](../PATTERNS.md)

Una funzione non ancora finita (il Red Team, #896; la Bacheca e il Deck builder, #1592) si nasconde a chi non è
l'owner con un interruttore suo, finché l'owner non la apre a tutti. La regola:

- **Un cancello solo, nel main.** `cancelloOwner.js` dice chi la vede: interruttore acceso, oppure owner. Un
  interruttore mai letto, assente o illeggibile vale «in pausa»; la copia si rilegge dopo un quarto d'ora quando
  qualcuno chiede, e ogni cambio si annuncia alla shell e alle pagine di Filo, che si ridisegnano senza riavvio.
  L'owner non aspetta mai la prima lettura. Un documento `config/<nome>` per funzione, con le stesse regole
  (`interruttoreValido`), lettura pubblica, scrittura dell'owner: le regole le pubblica una mano, dopo la fusione.
- **Tutte le porte, non quella vista.** Menu App, carte della home (anche fra le tolte, anche quando l'agente le
  rimette), il tasto destro, l'indirizzo scritto a mano (il protocollo serve la pagina della pausa per ogni nome
  della cartella), gli handler che scrivono (un voto da una pagina vecchia si ferma nel main), il manifesto delle
  capacità (`cancello` sulla voce, `{se:<nome>}…{/se}` dentro le altre voci) e i testi fissi del prompt.
- **Quello che è dell'utente resta raggiungibile.** Se la funzione ospita dati suoi (le segnalazioni mandate stanno
  in cima alla Bacheca), in pausa la pagina mostra solo quella parte, e la voce del menu porta lì col suo nome. I
  dati salvati di una funzione in pausa (i mazzi) non si toccano: tornano com'erano alla riapertura.
- **La pagina parte in pausa.** Finché non sa, la pagina mostra la versione in pausa e si allarga per chi la vede:
  il contrario farebbe lampeggiare la funzione davanti a chi non deve vederla.
- **Nelle prove sono aperte.** La fixture le apre (`inPausaAperte`, solo con `NODE_ENV=test`); chi prova la pausa
  la chiude con `test.use({ inPausaAperte: false })` e finge Firestore.

Dove vive: `src/main/services/cancelloOwner.js`, `inPausa.js`, `redteamGate.js`, `handlers/inPausa.js`,
`src/main/protocol.js` (`CARTELLE_IN_PAUSA`), Gestione → «In pausa». Prove: `tests/in-pausa.spec.mjs`,
`tests/redteam-pausa.spec.mjs`, `tests/unit/inPausa.test.mjs`, `tests/unit/capabilities.test.mjs`.
