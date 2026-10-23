# A sinistra Filo, a destra l'app

[← Tutti i pattern](../PATTERNS.md)

Il bordo sinistro apre la barra di Filo, con quello che vale su ogni pagina; il bordo destro delle pagine di Filo che
ne hanno uno apre il pannello dell'app, con i suoi strumenti. Stesso meccanismo per tutte e due (sosta sul bordo,
striscia, clic, tasto, richiesta a parole, regolazioni in Preferenze → Avanzate), struttura uguale in ogni app,
contenuto diverso: ogni app dichiara il catalogo e gli strumenti di partenza, l'utente sceglie gli altri.

## Perché

L'Editor teneva gli strumenti in una griglia a moduli (7×10 caselle, a pagine, con uno splitter) che si mangiava il
40% della finestra anche mentre si scriveva soltanto, e chiudeva la chat in un modulo 3×3 (#256.4, #1433). La griglia
era nata prima dei principi di oggi: lo spazio al contenuto, gli strumenti quando servono. Il pannello di destra li
porta fuori dal foglio e li riporta con un gesto; la chat è diventata l'Aiuto, che c'è già su ogni pagina.

## Come è fatto, e le trappole già viste

- **Il rilevamento è quello della barra**, il pannello è della pagina. Il bordo che la pagina non vede (i 5 px che il
  sistema si prende a finestra non massimizzata) lo guarda il main con `screen.getCursorScreenPoint`, dagli stessi
  ingressi della barra di sinistra: `src/main/bordoDestro.js`, creato e nutrito da `src/main/barraLaterale.js`. Il
  pannello invece sta nella pagina (`src/shared/pannelloDestro.js`, `src/styles/pannelloDestro.css`), perché il suo
  contenuto è dell'app: una vista sopra la scheda avrebbe dovuto disegnare i campi di Cerca e sostituisci da fuori.
- **La pagina dice al main che ha il pannello** (`MSG.PANNELLO_APP_STATO`, solo dalle pagine di Filo): il bordo
  destro e il tasto valgono solo lì. Sulle pagine dei siti il bordo destro non apre niente e Ctrl+\ resta al sito; per
  questo la voce della barra dei menu del Mac scrive il tasto senza registrarlo.
- **La fila delle schede è fuori dalla zona**: in alto a destra ci sono riduci, ingrandisci e chiudi.
- **Sul bordo destro sta la barra di scorrimento**, all'estremo, dove l'owner la vuole (lì è il gesto più probabile).
  Il pannello sta alla sua sinistra e non la copre; striscia e pannello si posano sulla misura vera della barra
  (`scrollbar-gutter: stable`, così non saltano quando il testo si allunga). Chi scorre in verticale lungo il bordo la
  sta mirando: conta come sosta solo il puntatore fermo (con il tremolio di una mano appoggiata, `TREMOLIO`). Un clic
  sulla pagina, barra di scorrimento compresa, chiude il pannello che non è bloccato.
- **Due schermi**: il puntatore che passa sull'altro schermo è lontano, quello fermo negli ultimi pixel della finestra
  apre. La regola è la stessa del puntatore fermo, e vale anche per la barra di sinistra quando avrà il lucchetto
  (#1431, che riusa le icone `lock` e `lockOpen`).
- **Il lucchetto** (`pannelloDestro.bloccato` nelle impostazioni, quindi anche in Preferenze e a parole): bloccato
  resta aperto e spinge il contenuto (`--pd-spinta`, che l'app aggiunge ai suoi margini: nell'Editor il foglio si
  stringe e la barra di scorrimento resta sul bordo); sbloccato si apre sopra il foglio senza spingerlo, così il testo
  non si risistema a ogni apertura. Bloccato non si chiude da solo; il tasto e la chat lo chiudono lo stesso.
- **L'Aiuto e il pannello insieme**: l'Aiuto resta sul bordo, il pannello si posa alla sua sinistra (`--pd-destra`).
- **Gli strumenti li conserva il main, uno solo** (`src/main/services/pannelliApp.js`): la pagina manda la mossa
  (posa, togli, configura), il main la mette in fila e annuncia il risultato a ogni pagina di Filo aperta ([Chi rilegge
  tutto e riscrive tutto mette le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md)).
  Cataloghi e mosse sono logica pura in `src/shared/pannelliApp.js`; la chat ci arriva con l'azione `PANNELLO_APP`.
- **Gli strumenti scelti sono nodi che restano** fra un annuncio e l'altro: un campo di Cerca e sostituisci a metà
  scrittura non si perde quando un'altra pagina sposta uno strumento ([Una lista che si rilegge da sola aggiorna le
  righe al loro posto](una-lista-che-si-rilegge-da-sola-aggiorna-le-righe-al-loro-posto.md)).
- **Una risposta di Filo in un pannello chiuso** accende la sua striscia e passa al main con la fonte `app`, come
  l'Aiuto ([Globale nella barra, contestuale nel tasto destro](globale-nella-barra-contestuale-nel-tasto-destro.md)).
- **Le scorciatoie restano agli strumenti**, e valgono finché lo strumento sta nel pannello. Chi controlla che una
  combinazione sia libera legge i pannelli salvati (`SN_TASTI.usaScorciatoiePannelli`).

Prove: `tests/pannello-destro-bordo.spec.mjs` (puntatore vero, XTest), `tests/pannello-destro.spec.mjs`,
`tests/unit/pannelliApp.test.mjs`.
