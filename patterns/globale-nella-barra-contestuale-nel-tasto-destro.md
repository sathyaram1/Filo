# Globale nella barra, contestuale nel tasto destro

[← Tutti i pattern](../PATTERNS.md)

Ciò che riguarda la finestra o il sistema (indietro, avanti, ricarica, home,
incognito, schermo intero, chiudi scheda) e le azioni sulla pagina intera (traduci,
screenshot, condividi, salva per dopo, QR…) stanno nella barra laterale che si apre
dal bordo sinistro (#1246); il tasto destro resta per l'elemento sotto il mouse, e
in cima ha la fila delle sue azioni più probabili (#1434, sezione sotto). La
disposizione salvata ha le zone della barra (le icone in vista e il cassetto
«Altro…» in fondo) e, per ogni contesto, la fila e il suo «+»: un'icona sta in un
posto solo, e spostarla la toglie dall'altro.

## Perché

Indietro si raggiungeva solo da tasto destro → «Altro…» o da tastiera, mentre la
mano andava in alto a sinistra dove non c'era niente (#871). Un menu che
cambia a seconda di dove clicchi non è il posto di un comando che vale ovunque:
ogni voce globale lo allungava e seppelliva le voci dell'elemento. Lo stesso vale
per le azioni sulla pagina intera, che stavano in una fila in cima al menu (#1246).

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
- **A finestra staccata dal bordo dello schermo la fascia è una presa** (#1292).
  Se subito a sinistra della finestra, all'altezza del puntatore, c'è ancora uno
  schermo, il puntatore lì non si spinge contro niente: chi si ferma sulla fascia
  sta per ridimensionare, e la spinta aspetta `ATTESA_STACCATA_MS` in più. Contro
  il bordo dello schermo (o massimizzata) vale l'attesa scelta. Regola pura:
  `staccataDalBordo` in `src/main/barraLaterale.js`. La spinta che vede la pagina
  della barra conta l'attesa scelta: dove vale quella lunga decide la sonda.
- **Bloccata, la barra nasce all'avvio**, a volte prima che la fila delle schede
  si annunci: una prova che riavvia Filo bloccato apre la scheda dal main, non
  dalla prima finestra.
- **Il gruppo che scorre lo dice**: senza barra di scorrimento, sfuma dal lato
  dove ci sono altre icone, e l'icona appena arrivata si porta in vista.
- **Tutto si regola** (Preferenze → Avanzate, a parole, tasto destro sulla
  striscia o sulla linguetta): apertura dal bordo, attesa, chiusura dopo
  l'uscita, striscia visibile. I limiti stanno in `opzioniBarraLaterale`
  (`src/shared/constants.js`).
- **Solo gesti veri.** Un sito non arriva alla vista della barra, e la barra
  ascolta solo eventi `isTrusted`. Le azioni sulla pagina le esegue il content
  script della scheda davanti quando il main gliele manda (`TOP_FRAME_COMMAND` con
  `daBarra`); un riquadro incorporato non le comanda.
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
  (`src/main/services/layoutIcone.js`): barra, chat (`SPOSTA_ICONA`) e annullo
  mandano lo spostamento, il main lo mette in fila e lo annuncia alle barre delle
  finestre dello stesso tipo. Una barra con la copia vecchia, al primo
  trascinamento, riscriverebbe quella ([Chi rilegge tutto e riscrive tutto mette
  le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md)).
  Le regole pure (migrazione del salvato, dove cade un'icona, chi si è spostato)
  stanno in `src/shared/disposizioneIcone.js`.
- **Ogni spostamento è un cambio del filo** (#867.1): il registro dei cambi
  osserva `sn_icon_layout` come le impostazioni, e `layoutIcone` gli dice quale
  icona ha mosso (fra due vicine scambiate il confronto da solo non lo sa).
  Un cambio è un'icona con dov'era e dove è finita: «rimetti come prima» rimette
  solo lei, davanti alla stessa vicina o allo stesso posto, e le icone spostate
  dopo restano dove sono. Riscrivere un salvato di prima nella forma nuova è una
  migrazione, non un cambio.
- **Il cassetto «Altro…»** è in fondo alle icone in vista: la freccia lo apre e
  si richiude con la barra; un'icona rilasciata sulla freccia chiusa va da parte,
  e durante un trascinamento la freccia c'è anche a cassetto vuoto. Il tasto
  destro su un'icona la sposta fra le due zone.
- **Il lucchetto** (#1431, `barraLaterale.bloccata`, quindi anche in Preferenze
  e a parole; tasto destro sul lucchetto, sul vuoto della barra, sulla striscia e
  sulla linguetta; Ctrl+Alt+Shift+B): bloccata resta aperta e spinge la pagina.
  Il posto della pagina lo dà una funzione sola, `_areaPagina` in
  `src/main/tabs.js`, usata anche dalla riserva della nuova scheda; chi si
  allinea alla pagina (avviso del sito, riquadri, conferme) legge i bounds della
  sua vista. Accanto alla pagina la barra è una colonna della finestra: niente
  ombra, vista larga quanto il pannello. Non si chiude da sola (uscita, clic e Esc
  sulla pagina, una scelta fatta): `chiudi()` senza `forza` la lascia aperta e
  rende la tastiera alla pagina; il tasto e la chat la chiudono lo stesso, e il
  gesto dopo la riapre bloccata. A schermo intero vale da sbloccata (si chiude, e
  torna uscendo), come il pannello di destra in una finestra stretta. Prova:
  `tests/barra-laterale-lucchetto.spec.mjs`.
- **Da ogni chat** (#1292): la home con `COMANDO_FINESTRA`, l'Aiuto con la sua
  azione «shell»; i quattro comandi (apri, chiudi, blocca, sblocca) stanno in
  `COMANDI_CHAT` e li esegue `comandoChat`.
- **Esc chiude prima la barra, poi la modalità** ([Esc chiude prima il riquadro
  aperto, poi la modalità](esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md)):
  a schermo intero il primo Esc chiude la barra, il secondo esce.
- **Chi aveva disposto le icone non perde niente**: alla prima apertura con la
  barra, le globali rimaste in «Altro…» vanno nella barra; la riga del tasto
  destro di prima finisce in fondo alla barra, nel suo ordine (#1246).

## La fila contestuale in cima al tasto destro (#1434)

- **Il contesto lo sceglie lo stesso ramo che sceglie le voci** del menu: fila e
  voci parlano sempre dello stesso elemento. Ogni tipo di elemento ha il suo
  contesto, come chiede [Menu contestuale: se Filo sostituisce il menu nativo,
  deve coprire OGNI tipo di
  elemento](menu-contestuale-se-filo-sostituisce-il-menu-nativo.md): testo
  selezionato dove si scrive con la formattazione, in una casella, in una
  pagina; immagine; collegamento; filmato o audio; campo col cursore senza
  selezione; pagina (niente sotto il mouse). Un tipo nuovo di elemento è un
  contesto nuovo, non una fila che manca.
- **Una selezione rimasta altrove non decide** il menu di un'immagine, un
  collegamento o un filmato: vale solo se il clic le sta sopra.
- **Ogni contesto ha due zone**, la fila e il suo «+», scritte dal main come
  quelle della barra (una porta sola, ogni spostamento un cambio annullabile).
  Un'azione di un contesto resta nel suo contesto: nella barra o su un altro
  elemento non avrebbe su cosa agire. Un'icona della barra può entrare nella
  fila di qualunque contesto, e lascia la barra.
- **Di partenza nessuna azione sulla pagina intera** nella fila: la fila della
  pagina è vuota e nascosta, e si fa vedere quando ci si porta sopra un'icona
  dalla barra. L'ordine è fisso per contesto; sceglierlo con un modello è una
  decisione dell'owner ancora aperta (#1377).
- **L'icona dice lo stato quando conta** (Riproduci o Pausa, audio acceso o
  spento): disegno e nome del catalogo valgono per trascinarla e per la chat,
  quelli dati dall'elemento per il menu aperto. Uno stile che la selezione ha
  già (Grassetto, Evidenzia) accende la sua icona, e premerla lo toglie: il fondo
  della selezione Chromium lo dice solo con `backColor` (giro 2).
- **Un'immagine o un filmato dentro un collegamento è anche il collegamento**:
  la sua fila ha Apri in nuova tab, e il «+» Copia URL, azioni del suo contesto
  che compaiono solo dove il collegamento c'è (giro 2).
- **Tante icone vanno a capo**, mai fuori dal bordo del menu.
- **Un'azione vive in un posto solo, e voci e fila la prendono da lì** (#1434.2): `azioniDellImmagine`,
  `azioniDelLink`, `azioniDellaSelezione` (`content.js`), `azioniDelMedia` (`actions.js`), coi nomi che dicono lo
  stato. Due copie avevano già diviso la stessa azione sullo stesso elemento. Taglia fa come il sistema: appunti, poi
  una cancellazione vera che Ctrl+Z annulla, anche nelle caselle per l'email o i numeri (che non espongono la
  selezione); in un campo coperto (password) né Taglia né Copia, come nel menu del sistema.
- **Le icone della finestra portate nella fila le descrive e le esegue la barra** (`_descrivi`, `iconeFila`,
  `esegui` con `via: 'fila'` in `src/main/barraLaterale.js`): spente quando lo sono nella barra (Indietro senza dove
  tornare), «Feedback» solo all'owner. La pagina chiede lo stato prima di aprire il menu, insieme agli appunti.
- **Il trascinamento verso la barra è uno solo** (`ponteVersoLaBarra` in `src/content/menu.js`): la pagina e lo
  strato del menu passano solo la strada verso il main, e quale icona può andare nella barra lo dice il catalogo.
- **La parola detta a Filo e il posto** si traducono in `zonaDellAzione` e `doveDaZona`: chi sposta, la conferma, la
  riga nelle attività e il filo passano da lì.
- Catalogo: `src/shared/disposizioneIcone.js`; chi esegue:
  `src/content/content.js` (`filaContestuale`); chi disegna:
  `src/content/menuIcons.js`.

## A schermo intero le schede scendono dal bordo alto (#1246)

- Lo stesso gesto della barra: puntatore fermo sulla prima riga di pixel, senza
  tasti premuti, per l'attesa della barra; la pagina scende sotto la fila delle
  schede, e risale quando il puntatore torna sulla pagina, dopo il tempo d'uscita
  della barra. Sulla fila il puntatore la tiene giù. Codice: `src/main/schedeInAlto.js`.
- Solo nello schermo intero di Filo: in quello chiesto da un sito (un video) in
  alto c'è l'avviso col nome del sito, e le schede non scendono.
- **Il bordo alto è quello dello schermo, da ogni strada.** In cima alla pagina
  può esserci un riquadro di un altro sito, che il riquadro principale non vede:
  i movimenti passano anche dai riquadri, e un trascinamento, quando la pagina
  smette di parlarne, si segue sul puntatore del sistema. Il bordo alto di un
  riquadro a metà pagina non conta. Tre giri di #1343 sono rientrati da qui.
- **Quello che l'utente sta usando non si muove sotto il puntatore quando la
  fila risale**: i menu e le finestrelle aperte dalla fila la tengono giù, e la
  barra laterale aperta sotto la fila resta dov'è finché non si chiude.
- A schermo intero la striscia d'indizio è spenta come da Preferenze (#871.6,
  D-11): sopra un film non resta una linea accesa; il bordo e il tasto aprono.
- Si spegne con `barraLaterale.schede` (Preferenze, chat). Nelle prove il mouse
  va mosso con `page.mouse`: quello di `sendInputEvent` arriva col tasto sinistro
  premuto, e conta come una selezione (`tests/schermo-intero-schede.spec.mjs`).

## L'Aiuto nella barra, e la risposta che accende la striscia (#1432)

- **L'icona Aiuto dice cosa farà il clic**: punto di domanda ad Aiuto chiuso o ridotto (lo apre), microfono ad Aiuto
  aperto (detta, lo stesso microfono della casella), microfono acceso mentre ascolta (ferma, anche ad Aiuto ridotto).
  Col mouse la barra resta aperta: due clic nello stesso punto e si parla. Lo stato lo riferisce la pagina
  (`MSG.AIUTO_STATO`), il clic lo decide lei sul suo stato vero; aspetto e clic escono dalla stessa `aspettoAiuto`
  (`src/shared/disposizioneIcone.js`), per la barra e per il pannello Aiuto della pagina: due regole separate avevano
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
  (#1431, con le icone `lock` e `lockOpen`).
- **Il lucchetto** (`pannelloDestro.bloccato` nelle impostazioni, quindi anche in Preferenze e a parole): bloccato
  resta aperto e spinge il contenuto (`--pd-spinta`, che l'app aggiunge ai suoi margini: nell'Editor il foglio si
  stringe e la barra di scorrimento resta sul bordo); sbloccato si apre sopra il foglio senza spingerlo, così il testo
  non si risistema a ogni apertura. Bloccato non si chiude da solo; il tasto e la chat lo chiudono lo stesso.
- **L'Aiuto e il pannello insieme**: l'Aiuto resta sul bordo, il pannello si posa alla sua sinistra (`--pd-destra`).
- **Il foglio fa posto a ciò che sta fisso a destra**, con una regola sola (`--pd-spinta`): l'Aiuto aperto, anche
  ridotto, e il pannello bloccato. Il testo non finisce mai sotto di loro (rientrato tre volte da porte diverse:
  lucchetto con l'Aiuto, finestra stretta, Aiuto da solo). Sotto il foglio minimo l'Aiuto torna sopra il foglio e il
  lucchetto smette di spingere.
- **Gli strumenti li conserva il main, uno solo** (`src/main/services/pannelliApp.js`): la pagina manda la mossa
  (posa, togli, configura), il main la mette in fila e annuncia il risultato a ogni pagina di Filo aperta ([Chi rilegge
  tutto e riscrive tutto mette le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md)).
  Cataloghi e mosse sono logica pura in `src/shared/pannelliApp.js`; la chat ci arriva con l'azione `PANNELLO_APP`.
- **Gli strumenti scelti sono nodi che restano** fra un annuncio e l'altro: un campo di Cerca e sostituisci a metà
  scrittura non si perde quando un'altra pagina sposta uno strumento ([Una lista che si rilegge da sola aggiorna le
  righe al loro posto](una-lista-che-si-rilegge-da-sola-aggiorna-le-righe-al-loro-posto.md)).
- **Una risposta di Filo in un pannello chiuso** accende la sua striscia e passa al main con la fonte `app`, come
  l'Aiuto (#1432).
- **Le scorciatoie restano agli strumenti**, dentro o fuori dal pannello: una scorciatoia mostrata nelle regolazioni
  funziona sempre. Chi controlla che una combinazione sia libera legge i pannelli salvati
  (`SN_TASTI.usaScorciatoiePannelli`).

Prove: `tests/pannello-destro-bordo.spec.mjs` (puntatore vero, XTest), `tests/pannello-destro.spec.mjs`,
`tests/unit/pannelliApp.test.mjs`.
