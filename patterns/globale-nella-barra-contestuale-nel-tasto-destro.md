# Globale nella barra, contestuale nel tasto destro

[← Tutti i pattern](../PATTERNS.md)

Ciò che riguarda la finestra o il sistema (indietro, avanti, ricarica, home,
incognito, schermo intero, chiudi scheda) sta nella barra laterale che si apre
dal bordo sinistro; il tasto destro resta per ciò che riguarda l'elemento o la
pagina sotto il mouse. Le due superfici usano lo stesso registro di icone e la
stessa disposizione salvata, con tre zone (riga, «Altro…», barra): un'icona sta
in un posto solo, e spostarla la toglie dall'altro.

## Perché

Indietro si raggiungeva solo da tasto destro → «Altro…» o da tastiera, mentre la
mano andava in alto a sinistra dove non c'era niente (#871). Un menu che
cambia a seconda di dove clicchi non è il posto di un comando che vale ovunque:
ogni voce globale lo allungava e seppelliva le voci dell'elemento.

## Come è fatta, e le trappole già viste

- **Una vista sopra la scheda**, non la shell: la shell sta sotto le schede e
  nessuno la vedrebbe ([La shell non disegna sopra la pagina: ci vuole una vista
  in cima](la-shell-non-disegna-sopra-la-pagina.md)). A barra chiusa la vista è
  larga quanto la striscia d'indizio, aperta quanto il pannello e la sua ombra.
  Codice: `src/main/barraLaterale.js`, `src/renderer/barra.*`.
- **Spingere, non sfiorare.** Si apre se il puntatore resta sulla striscia per
  un attimo senza tasti premuti: passarci di corsa, trascinare una scheda o
  selezionare del testo non la aprono. Per chi il bordo non lo raggiunge ci sono
  il clic sulla striscia, la linguetta nella fila delle schede e Ctrl+Shift+B
  (non Ctrl+B, che è il grassetto di ogni editor).
- **Il bordo che la vista non vede.** A finestra non massimizzata i primi 5
  pixel dentro il bordo sono del sistema, che lì ridimensiona una finestra
  senza cornice: né la striscia né la pagina ricevono il puntatore. Il main lo
  guarda da sé (`screen.getCursorScreenPoint`) finché non è dentro la pagina
  lontano dal bordo: chi ci arriva con un lancio, rientra da fuori della
  finestra o scende dalla fila delle schede nella pagina non lascia traccia
  (giro 2 di #871, la seconda volta di questa famiglia). Il tasto premuto si
  legge sia dalla pagina sia dalla fila delle schede; dopo un rilascio, una
  chiusura o un ridimensionamento il bordo conta solo quando il puntatore si
  muove. Il mouse di Playwright entra dritto in una vista e salta questa
  scelta: la prova è col puntatore vero (`tests/barra-laterale-bordo.spec.mjs`,
  XTest sotto xvfb). Una prova che spinge la striscia col mouse di Playwright
  prima chiama `puntatoreCheSegue` (`tests/helpers/barra.mjs`): sennò il main
  legge il puntatore del sistema lontano e, se il pannello tarda a dire
  «dentro», chiude la barra appena aperta (#1216.2).
- **Il menu aperto dove si apre la barra** non si copre: trascinando un'icona
  da un menu che comincia nella fascia del pannello, la barra si apre solo al
  bordo, a sinistra del menu, e si richiude se il puntatore torna sul menu.
- **Il gruppo che scorre lo dice**: senza barra di scorrimento, sfuma dal lato
  dove ci sono altre icone, e l'icona appena arrivata si porta in vista.
- **Tutto si regola** (Preferenze → Avanzate, a parole, tasto destro sulla
  striscia o sulla linguetta): apertura dal bordo, attesa, chiusura dopo
  l'uscita, striscia visibile. I limiti stanno in `opzioniBarraLaterale`
  (`src/shared/constants.js`).
- **Solo gesti veri.** Un sito non arriva alla vista della barra; nella pagina
  il trascinamento dal menu parte solo da eventi `isTrusted`, perché un
  trascinamento finto aprirebbe la barra a comando del sito.
- **La barra agisce su quello che l'utente vede.** Quando l'avviso del sito
  pericoloso copre la scheda, le icone della pagina portate nella barra (QR,
  Salva per dopo, Traduci…) sono spente: agirebbero sulla pagina nascosta e
  quello che mostrano resterebbe dietro l'avviso. Tornano alla conferma. È la
  stessa regola del vuoto (`vistaSottoIlVuoto`, `tests/barra-laterale-vuoto.spec.mjs`),
  e vale anche al contrario: il puntatore che la barra sente (spinta sul bordo,
  clic che la chiude, uscita) è quello di chi sta sotto, l'avviso quando copre
  la scheda (`inputDa`). Ogni cosa nuova che la barra prende dalla «pagina» passa
  da lì: la famiglia è rientrata tre volte (giri 4, 5 e 6 di #871).
- **La disposizione la scrive il main, uno solo**
  (`src/main/services/layoutIcone.js`): menu e barra mandano lo spostamento,
  il main lo mette in fila e lo annuncia a tutte le schede e alle barre delle
  finestre dello stesso tipo. Una scheda con la copia vecchia, al primo
  trascinamento, riscriverebbe quella ([Chi rilegge tutto e riscrive tutto mette
  le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md)).
  Le regole pure (migrazione del salvato, dove cade un'icona) stanno in
  `src/shared/disposizioneIcone.js`.
- **Il puntatore resta di chi ha ricevuto la pressione.** Trascinando dal menu
  verso la barra, la pagina continua a ricevere il puntatore anche sopra la
  vista della barra: è lei a dire al main dove cade l'icona, e il main lo passa
  alla barra. Al contrario, dalla barra verso il menu è la barra che manda le
  coordinate e la pagina disegna l'icona che arriva.
- **Esc chiude prima la barra, poi la modalità** ([Esc chiude prima il riquadro
  aperto, poi la modalità](esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md)):
  a schermo intero il primo Esc chiude la barra, il secondo esce.
- **Chi aveva spostato le globali non perde niente**: alla prima apertura con la
  barra, le globali rimaste in «Altro…» vanno nella barra; quelle che l'utente
  aveva portato nella riga restano lì.

## L'Aiuto nella barra, e la risposta che accende la striscia (#1432)

- **L'icona Aiuto dice cosa farà il clic**: punto di domanda ad Aiuto chiuso o ridotto (lo apre), microfono ad Aiuto
  aperto (detta, lo stesso microfono della casella), microfono acceso mentre ascolta (ferma, anche ad Aiuto ridotto).
  Col mouse la barra resta aperta: due clic nello stesso punto e si parla. Lo stato lo riferisce la pagina
  (`MSG.AIUTO_STATO`), il clic lo decide lei sul suo stato vero; aspetto e clic escono dalla stessa `aspettoAiuto`
  (`src/shared/disposizioneIcone.js`), per la barra e per la riga del tasto destro: due regole separate avevano
  già divergito sul pannello ridotto (giro 1 di #1432). Dove la voce «Aiuto» non c'è l'icona è spenta e il suggerimento dice
  perché; sotto l'avviso del sito fa la domanda a Filo su quel sito, come la scorciatoia.
- **Una risposta arrivata a pannello ridotto o chiuso dall'utente non si apre da sola e non si perde**: la striscia
  si accende ferma, d'accento, e l'icona che apre il pannello porta un punto, finché la risposta non si apre. Chi
  riduce o chiude mentre Filo pensa sta dicendo «non adesso». La regola è di ogni pannello dove Filo risponde
  (l'Aiuto, il pannello di destra delle app): la pagina manda `MSG.RISPOSTA_IN_ATTESA` con la sua `fonte`, il main
  la tiene per scheda e per fonte (`src/main/risposteInAttesa.js`, una fonte nuova va in `FONTI`), la striscia
  segue la scheda davanti. La fine la constata il main: documento nuovo, pagina caduta, scheda chiusa.
- **Ridotto dall'utente vince sul modello**, ridotto dal modello (un passo da cliccare sulla pagina) non accende
  niente: lì la risposta è il segno sulla pagina. **Chiuso a metà di un turno**, il pannello si nasconde invece di
  sparire: la risposta ci entra, i passi da solo e i segni sulla pagina no, e ogni strada che riapre l'Aiuto mostra
  quella conversazione. Prova: `tests/barra-laterale-aiuto.spec.mjs`.

## A destra, il pannello dell'app (#1433)

Il bordo sinistro apre la barra di Filo, con quello che vale su ogni pagina; il bordo destro delle pagine di Filo che
ne hanno uno apre il pannello dell'app, con i suoi strumenti. Stesso meccanismo per tutte e due (sosta sul bordo,
striscia, clic, tasto, richiesta a parole, regolazioni in Preferenze → Avanzate), struttura uguale in ogni app,
contenuto diverso: ogni app dichiara il catalogo e gli strumenti di partenza, l'utente sceglie gli altri.

### Perché

L'Editor teneva gli strumenti in una griglia a moduli (7×10 caselle, a pagine, con uno splitter) che si mangiava il
40% della finestra anche mentre si scriveva soltanto, e chiudeva la chat in un modulo 3×3 (#256.4, #1433). La griglia
era nata prima dei principi di oggi: lo spazio al contenuto, gli strumenti quando servono. Il pannello di destra li
porta fuori dal foglio e li riporta con un gesto; la chat è diventata l'Aiuto, che c'è già su ogni pagina.

### Come è fatto, e le trappole già viste

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
  l'Aiuto (#1432).
- **Le scorciatoie restano agli strumenti**, e valgono finché lo strumento sta nel pannello. Chi controlla che una
  combinazione sia libera legge i pannelli salvati (`SN_TASTI.usaScorciatoiePannelli`).

Prove: `tests/pannello-destro-bordo.spec.mjs` (puntatore vero, XTest), `tests/pannello-destro.spec.mjs`,
`tests/unit/pannelliApp.test.mjs`.
