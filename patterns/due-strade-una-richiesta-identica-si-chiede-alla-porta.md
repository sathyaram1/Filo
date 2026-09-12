# Due strade e una richiesta identica: si chiede alla porta, non dopo

**Regola.** Quando due cammini diversi arrivano al nostro gestore con una
richiesta indistinguibile, e solo uno dei due passa poi da un secondo controllo
dove chiediamo davvero, quella prima richiesta NON si lascia passare per
comodità: la domanda si fa lì, perché è l'unico punto che tutti e due
attraversano. Prima di scrivere «questa la lascio passare, la domanda vera
arriva dopo», cerca chi altro produce esattamente quella forma e dove finisce.

## Il caso che l'ha fatta nascere

I permessi che i siti chiedono (#586). Chromium consegna lo schermo a una
pagina in due modi:

- `navigator.mediaDevices.getDisplayMedia()`, quello moderno, che in Electron
  passa dal gestore della cattura schermo (`setDisplayMediaRequestHandler`):
  lì Filo chiede e fa scegliere quale schermo o finestra condividere;
- `navigator.mediaDevices.getUserMedia({ video: { mandatory: {
  chromeMediaSource: 'desktop' } } })`, quello vecchio, che da quel gestore non
  passa affatto: appena il permesso è concesso Electron consegna lo schermo
  intero, e con `audio` anche il suono del computer.

Al gestore dei permessi arrivano IDENTICI: permesso `media` con
`details.mediaTypes` vuoto. Nessun campo li distingue.

Il primo giro di verifica aveva trovato un difetto vero: quella richiesta
faceva comparire «vuole usare la fotocamera e il microfono» a chi aveva premuto
«condividi lo schermo», e un sì lasciava webcam e microfono concessi per
sempre. La correzione l'ha riconosciuta e l'ha lasciata passare senza chiedere,
per far arrivare `getDisplayMedia` alla sua domanda vera.

Con quella riga, una pagina qualunque si prendeva lo schermo intero e il suono
del computer con una riga di JavaScript, senza un clic, senza che comparisse
niente e senza lasciare traccia da nessuna parte: non restava scritto niente,
quindi in Impostazioni non c'era neanche cosa revocare.

## I tentativi sbagliati

**Negare quella forma e basta.** Provato: uccide anche la condivisione vera. Se
il permesso `media` viene negato, il gestore della cattura schermo non viene
nemmeno chiamato, e il pulsante «condividi» della pagina smette di funzionare
senza che compaia nessuna domanda.

**Concedere e poi accorgersene.** Non esiste: la sequenza è richiesta →
risposta → gestore della cattura. Quando si scopre che il gestore non arriverà,
la traccia è già in mano alla pagina, e da Electron non si spegne una traccia
già consegnata.

**Togliere il vincolo dentro la pagina.** Riscrivere `getUserMedia` nel mondo
della pagina non è una barriera: basta un `<iframe>` per avere un `navigator`
nuovo e non toccato. Va bene come cortesia, mai come serratura.

## Come sta adesso

La domanda si fa al preambolo: `media` con la lista dei tipi vuota È la domanda
dello schermo, e passa dalla pastiglia. Un sì vale per la cattura che segue,
qualunque strada prenda, e viene consumato dal gestore della cattura schermo
(che va dritto alla scelta della fonte invece di richiedere la stessa cosa due
volte di fila). Un no le chiude tutte e due.

La strada vecchia consegna lo schermo intero senza passare dalla scelta della
fonte: non c'è modo di intercettarla. Per quella resta il segno «può vedere il
tuo schermo» sotto le schede, acceso quando il gestore della cattura non si fa
vivo entro un attimo dal sì.

Codice: `preamboloSchermo` in `src/shared/permessiSiti.js`, `decidi` e
`segnaPreambolo`/`consumaPreambolo` in `src/main/services/permessiSito.js`.
Prove: `tests/permessi-siti.spec.mjs` («anche la strada vecchia per lo schermo
passa dalla domanda») e `tests/unit/permessiSiti.test.mjs` («il preambolo della
cattura schermo non concede niente da solo»).
