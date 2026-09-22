# Una pagina di impostazioni aperta non è una fotografia

[← Tutti i pattern](../PATTERNS.md)

Una pagina che salva più impostazioni insieme legge lo stato una volta, quando
si apre, e da lì in poi i suoi controlli **sono** quello stato. Se nel
frattempo la stessa impostazione cambia da un'altra parte — Filo a parole, un
altro pannello, un'altra finestra — la pagina non lo sa: al primo tocco su una
manopola qualunque rispedisce l'intero blocco com'era all'apertura, e il
cambiamento arrivato da fuori sparisce. Nessun errore, nessun avviso: l'utente
scopre che il valore è tornato indietro giorni dopo, e non collega le due cose.

**La regola.** Ogni campo che un salvataggio riscrive va riallineato quando
quella stessa impostazione cambia da fuori: la pagina ascolta
`SETTINGS_UPDATED` e rimette nei controlli i valori arrivati. Vale per OGNI
salvataggio della pagina, non solo per quello principale, e per le copie in
memoria da cui un salvataggio riparte, non solo per i campi del DOM. L'unico
campo che non si tocca è quello che l'utente sta usando in quel momento
(`document.activeElement`), o gli si riscriverebbe sotto le dita ciò che sta
digitando; la stessa chiave va tenuta anche nella copia in memoria, o il
salvataggio successivo perderebbe quello che sta scrivendo.

## Il caso

Feedback #667, «il timer non suona». Il lavoro aveva aggiunto la manopola del
volume della suoneria, in Preferenze e a parole, e la nota della versione
invitava a chiederlo a Filo. Bastava avere Preferenze aperta in un'altra
scheda: si chiedeva a Filo di alzare il volume, si tornava sulla pagina, si
cambiava il tema — e il volume tornava a zero. Cioè di nuovo la segnalazione di
partenza, arrivata dalla strada che il lavoro stesso aveva aperto.

La stessa cosa era già successa una volta, sulla pagina Modelli: la chiave
OpenRouter messa dalla pagina Crediti spariva al primo cambio fatto in
Impostazioni. Lì era stata curata per quel solo campo, e la regola non era
stata scritta da nessuna parte — così la pagina Preferenze, che governa
diciannove manopole, l'ha ripetuta su tutte.

## Cosa non basta

- **Curare il campo che si è visto.** È quello che era stato fatto per la
  chiave OpenRouter: il difetto è del meccanismo, non del campo.
- **Curare il salvataggio che si è visto.** Preferenze salva in tre blocchi
  (le manopole, i token estetici, i colori delle schede) e curarne uno solo ha
  lasciato sparire i colori chiesti a Filo a parole; la pagina Sicurezza e
  privacy, con la stessa forma, non ascoltava affatto.
- **Mandare solo il campo toccato.** Toglie il danno ma lascia la pagina che
  mostra numeri falsi, e chi guarda una manopola per capire com'è messo ci
  crede.
- **Ricaricare tutta la pagina al messaggio.** Ricostruisce le sezioni, perde
  il fuoco e cancella quello che l'utente sta scrivendo.

## Dove sta

`src/pages/preferences/preferences.js` (`riallineaDaFuori` più
`riallineaBlocchiAvanzati`), `src/pages/security/security.js` (`applica`) e
`src/pages/options/options.js`. La sentinella è
`tests/unit/paginaImpostazioniViva.test.mjs`: per ogni pagina di impostazioni
confronta i controlli letti dai suoi salvataggi con quelli riallineati, e
diventa rossa se una manopola nuova, un salvataggio nuovo o una pagina nuova
entra senza entrare anche lì. Le prove dal punto di vista dell'utente sono
`tests/preferences-pagina-viva.spec.mjs` e
`tests/security-pagina-viva.spec.mjs`.
