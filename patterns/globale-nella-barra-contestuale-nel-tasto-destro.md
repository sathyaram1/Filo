# Globale nella barra, contestuale nel tasto destro

[← Tutti i pattern](../PATTERNS.md)

Ciò che riguarda la finestra o il sistema (indietro, avanti, ricarica, home,
incognito, schermo intero, chiudi scheda) e le azioni sulla pagina intera (traduci,
screenshot, condividi, salva per dopo, QR…) stanno nella barra laterale che si apre
dal bordo sinistro; il tasto destro resta per l'elemento sotto il mouse e non ha
icone (#1246). La disposizione salvata ha due zone, le icone in vista e quelle
tenute da parte nel cassetto «Altro…» in fondo alla barra: un'icona sta in un
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
- **Esc chiude prima la barra, poi la modalità** ([Esc chiude prima il riquadro
  aperto, poi la modalità](esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md)):
  a schermo intero il primo Esc chiude la barra, il secondo esce.
- **Chi aveva disposto le icone non perde niente**: alla prima apertura con la
  barra, le globali rimaste in «Altro…» vanno nella barra; la riga del tasto
  destro di prima finisce in fondo alla barra, nel suo ordine (#1246).

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
