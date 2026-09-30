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
  senza cornice: né la striscia né la pagina ricevono il puntatore. Quando la
  pagina lo vede andare verso il bordo (o uscire), il main lo guarda da sé
  (`screen.getCursorScreenPoint`) finché resta lì, e dopo l'attesa apre;
  mentre la finestra si ridimensiona o si sposta, no. Il mouse di Playwright
  entra dritto in una vista e salta questa scelta: la prova è col puntatore
  vero (`tests/barra-laterale-bordo.spec.mjs`, XTest sotto xvfb).
- **Tutto si regola** (Preferenze → Avanzate, a parole, tasto destro sulla
  striscia o sulla linguetta): apertura dal bordo, attesa, chiusura dopo
  l'uscita, striscia visibile. I limiti stanno in `opzioniBarraLaterale`
  (`src/shared/constants.js`).
- **Solo gesti veri.** Un sito non arriva alla vista della barra; nella pagina
  il trascinamento dal menu parte solo da eventi `isTrusted`, perché un
  trascinamento finto aprirebbe la barra a comando del sito.
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
