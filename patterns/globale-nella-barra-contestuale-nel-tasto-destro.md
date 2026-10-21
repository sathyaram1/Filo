# Globale nella barra, contestuale nel tasto destro

[← Tutti i pattern](../PATTERNS.md)

Le icone stanno tutte nella barra laterale che si apre dal bordo sinistro: quelle
della finestra o del sistema (indietro, avanti, ricarica, home, incognito,
schermo intero, chiudi scheda) e quelle che agiscono sulla pagina intera
(traduci, screenshot, condividi, salva per dopo, QR). Il tasto destro resta per
ciò che riguarda l'elemento o il punto sotto il mouse, e icone non ne ha. La
disposizione salvata ha due zone, la barra e la sua piega «Altro…»: un'icona sta
in un posto solo, e spostarla la toglie dall'altro.

## Perché

Indietro si raggiungeva solo da tasto destro → «Altro…» o da tastiera, mentre la
mano andava in alto a sinistra dove non c'era niente (#871). Un menu che
cambia a seconda di dove clicchi non è il posto di un comando che vale ovunque:
ogni voce globale lo allungava e seppelliva le voci dell'elemento. Per la stessa
ragione la fila di icone in cima al tasto destro è passata nella barra (#1246):
erano azioni sulla pagina, non sul punto cliccato.

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
- **«Altro…» è una piega del gruppo, non un altro menu.** Chiusa dice quante
  icone tiene; aperta le mostra sotto la piega, nello stesso gruppo che scorre,
  così si riordina e si sposta con lo stesso trascinamento. Fermarsi sulla piega
  chiusa con un'icona in mano la apre; il tasto destro su un'icona la mette in
  «Altro…» o la riporta in vista. Trascinata fuori dal pannello un'icona non
  cade da nessuna parte.
- **Un bottone che resta non si rifà.** Il gruppo si ridisegna rimettendo in
  ordine gli stessi nodi: un nodo rifatto o spostato perde la cattura del
  puntatore, e «Altro…» che si apre a metà trascinamento lo farebbe cadere
  ([Un elenco che si aggiorna da solo non rifà i pulsanti](un-elenco-che-si-aggiorna-non-rifa-i-pulsanti.md)).
- **Il gruppo che scorre lo dice**: senza barra di scorrimento, sfuma dal lato
  dove ci sono altre icone, e l'icona appena arrivata si porta in vista.
- **Tutto si regola** (Preferenze → Avanzate, a parole, tasto destro sulla
  striscia o sulla linguetta): apertura dal bordo, attesa, chiusura dopo
  l'uscita, striscia visibile, schede a schermo intero. I limiti stanno in
  `opzioniBarraLaterale` (`src/shared/constants.js`).
- **Solo gesti veri.** Un sito non arriva alla vista della barra, e la barra
  conta solo gli eventi `isTrusted`.
- **La barra agisce su quello che l'utente vede.** Quando l'avviso del sito
  pericoloso copre la scheda, le icone della pagina (QR, Salva per dopo,
  Traduci…) sono spente: agirebbero sulla pagina nascosta e quello che mostrano
  resterebbe dietro l'avviso. Tornano alla conferma. È la stessa regola del
  vuoto (`vistaSottoIlVuoto`, `tests/barra-laterale-vuoto.spec.mjs`), e vale
  anche al contrario: il puntatore che la barra sente (spinta sul bordo, clic
  che la chiude, uscita) è quello di chi sta sotto, l'avviso quando copre la
  scheda (`inputDa`). Ogni cosa nuova che la barra prende dalla «pagina» passa
  da lì: la famiglia è rientrata tre volte (giri 4, 5 e 6 di #871).
- **La disposizione la scrive il main, uno solo**
  (`src/main/services/layoutIcone.js`): barra, chat e annulli ci passano, il
  main mette le scritture in fila e annuncia la disposizione alle barre delle
  finestre dello stesso tipo ([Chi rilegge tutto e riscrive tutto mette le
  scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md)).
  Le regole pure (migrazione del salvato, dove cade un'icona) stanno in
  `src/shared/disposizioneIcone.js`. Il content script della pagina non legge
  né scrive la disposizione: esegue le azioni della pagina che la barra gli
  manda e ne dice il nome di adesso («Traduci» o «Mostra originale»).
- **Ogni posa è un cambio** ([Un cambio di stato lo registra chi salva, non chi
  chiede](un-cambio-di-stato-lo-registra-chi-salva-non-chi-chiede.md), #867.1):
  il registro vede la scrittura, ne ricava l'icona mossa e l'annullo rimette
  quella sola, anche dopo altri spostamenti. Due pose di fila non si fondono:
  sono due gesti. Riscrivere il salvato nella forma nuova è una migrazione,
  non un cambio di nessuno.
- **Esc chiude prima la barra, poi la modalità** ([Esc chiude prima il riquadro
  aperto, poi la modalità](esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md)):
  a schermo intero il primo Esc chiude la barra, il secondo esce.
- **A schermo intero le schede si chiamano dal bordo in alto**
  (`src/main/schedeInAlto.js`, #1246), con l'attesa e l'uscita della barra: la
  scheda davanti scende sotto la fila delle schede senza cambiare misura, così
  la pagina non si ridispone. Lo schermo pieno di un video tiene per sé il
  bordo in alto, dove ha i suoi comandi.
- **Chi si era disposto le icone non perde niente**: alla prima apertura senza
  la riga del tasto destro, le sue icone scendono in fondo alla barra nel loro
  ordine; prima ancora, le globali rimaste in «Altro…» erano andate nella barra.

## L'Aiuto nella barra, e la risposta che accende la striscia (#1432)

- **L'icona Aiuto dice cosa farà il clic**: punto di domanda ad Aiuto chiuso o ridotto (lo apre), microfono ad Aiuto
  aperto (detta, lo stesso microfono della casella), microfono acceso mentre ascolta (ferma, anche ad Aiuto ridotto).
  Col mouse la barra resta aperta: due clic nello stesso punto e si parla. Lo stato lo riferisce la pagina
  (`MSG.AIUTO_STATO`), il clic lo decide lei sul suo stato vero; aspetto e clic escono dalla stessa `aspettoAiuto`
  (`src/shared/disposizioneIcone.js`), per la barra: due regole separate avevano
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
