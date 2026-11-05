<!-- includi: _livelli-e-sede.md -->

## I controlli automatici: partono subito, in sottofondo

Appena cominci lancia `npm run finish:check` **in sottofondo** (unit test più
gli spec delle aree toccate dal ramo: da quindici a quarantacinque minuti) e
lavora mentre gira: aspettarlo alla fine vorrebbe dire ripagare tutto il
contesto. L'esito lo leggi prima di registrare, e il rilascio aspetta che
sia finito. Se si ferma al tetto di un comando in sottofondo, rilancialo: riparte
dagli spec non ancora verdi, anche se nel frattempo hai committato le prove del
giro (un cambio al codice invece li rifà tutti). La suite intera (`npm test`)
non la lancia nessuno: gira in GitHub a ogni fusione su main.

- Un rosso **fuori dai rossi noti** è un rilievo di livello 2, interno se
  l'ha rotto il ramo (il confronto con `main` lo dice), con l'elenco esatto
  degli spec rotti. I rossi d'ambiente sono scritti in
  `tests/rossi-noti.json` (`contenitore.specs` per i contenitori delle routine,
  `specs` per la macchina di chi sviluppa). Un rosso nato mentre giravano
  insieme anche le tue prove può essere solo macchina carica: rilancia quello
  spec da solo prima di farne un rilievo; in dubbio confronta con `main`.
- Un rosso d'ambiente che nel file non c'è non lo aggiungi tu: è un rilievo,
  col caso e il motivo.
- Nel contenitore delle routine `npx playwright test` si accende da solo lo
  schermo virtuale con la sandbox spenta, come `finish:check`; senza xvfb si
  ferma prima di aprire Electron e lo dice. Quello stop non è un rosso del
  codice.

## La critica

UN testo: prima il riassunto (cosa hai provato e cosa funziona), poi **una
riga per rilievo, con livello e sede davanti fra parentesi quadre**; le righe
sotto, senza livello, sono i suoi passi. Nessun rilievo = verifica superata.

```
Provato: incolla immagine, trascinamento, 10.000 caratteri, tema scuro. Funziona.
[2i] Il salvataggio parte solo dal titolo: col titolo vuoto non salva né il pulsante «Salva» né la scorciatoia.
    Passi: apri l'editor, lascia il titolo vuoto, scrivi, premi Salva: il file non compare.
    Con la scorciatoia di salvataggio, uguale.
[2e] La pagina Preferenze aperta in due schede cancella le modifiche fatte nell'altra: c'era già su main, per tutte le pagine.
[1v] Nell'editor, che il ramo modifica, il contatore delle parole conta due volte le parole col trattino: c'era già su main.
[1i?] Il bordo del riquadro è grigio freddo: caldo come il resto di Filo? Scelta di gusto; consiglio caldo.
[0i] Con la finestra sotto i 300 pixel il menu esce dallo schermo.
```

- **Una famiglia con una causa sola è UN rilievo**: la causa nella riga con
  livello e sede, le porte come righe sotto, senza livello. Così una famiglia
  esterna diventa un feedback solo, non uno per porta.
- **Le quadre con dentro un livello sono sempre un rilievo**, ovunque stiano.
  Nel riassunto e nei passi un livello si cita a parole («un rilievo di
  livello 2»), mai `[2i]`: altrimenti la critica viene respinta.
- La critica è per l'owner: comportamento dell'app, niente nomi di file o
  funzioni. Ogni rilievo **per esteso e autonomo** (cosa manca, dove, perché
  contava): ogni esterno diventa, con queste parole, un feedback a parte, col
  titolo preso dalla prima frase.
- **Le prove restano nel ramo**, in
  `tests/verifica/<numero>/giro<k>-r<n>-<cosa>.spec.mjs` (con `FILO_TEST_SCALE` e le
  fixture del repo, come ogni spec), e si committano rosse: il segno di rosso
  atteso (`test.fail`) va solo su quella di un rilievo messo da parte che resta
  nel ramo, mai su una di un rilievo che registri. Segnata, conta il corpo: se
  fallisce non è un rilievo nuovo, se passa («Expected to fail, but passed») la
  porta è chiusa e le togli il segno. Una prova che era solo esplorazione
  (dipende dall'ambiente, non asserisce niente) si cancella. Si cancella anche
  quella di un rilievo **esterno**, o di uno col `?` di livello 0 o 1 (o vicino),
  nello stesso commit: quel rilievo esce di qui dentro un feedback suo in ogni
  esito, e la prova lasciata indietro sarebbe solo un rosso da rispiegare per
  sempre. La prova di un `[2i?]` resta: si corregge con l'opzione che consigli.
  Se la critica ha un `[3i?]` o un `[2i?!]`, il lavoro si ferma e i `?`
  restano a chi riprende: lì esce solo la prova degli esterni.
  **La pulizia che non dipende dall'esito si fa prima del verdetto**:
  dopo, ogni commit è una spinta che il registro della fiducia non vede, e un
  lavoro fidato finisce fermo alla fusione. La registrazione rifiuta una critica
  che ha ancora nel ramo una prova di questi, e dice quale.
- **`r<n>` è il numero del rilievo che la prova riproduce**: il suo posto nella
  critica che registri, contando da 1 le righe con livello e sede, interne ed
  esterne, nell'ordine in cui le scrivi. Una prova che ne copre più d'uno li
  porta tutti (`giro2-r1-r3-salva.spec.mjs`), e il titolo di ogni suo caso comincia
  col numero del suo rilievo (`test('r3 …')`): la pulizia lascia uscire per intero
  solo un caso rosso che porta il numero di un messo da parte. Una che non ne riproduce nessuno
  (una porta di un giro passato ri-provata e chiusa) non ha numero. Una prova di
  un giro passato che riporti di nuovo come rilievo la rinomini (`git mv`) col
  giro e il numero di adesso: il numero che porta è di una critica vecchia.
  Serve alla pulizia: quelle dei rilievi che la risposta del server mette da
  parte le togli tu appena la leggi, in un commit che toglie solo quelle, e lo
  registri con `--record-pulizia` (la risposta ti dà il comando e ripete il
  numero davanti a ogni rilievo). Esce solo una prova che nel
  nome porta soli numeri di rilievi messi da parte, scritta o rinominata in
  questa verifica; a una che copre anche un rilievo da correggere togli solo il
  caso dei messi da parte. Un file di supporto (un aiuto, una pagina) non è una
  prova: se ne togli righe, la registrazione rilancia le prove che lo usano.
  Prima di registrare `--record-pulizia` rilancia le prove a cui hai tolto un
  caso o un aiuto, sul codice della critica: un caso rosso diventato verde, o
  una prova senza più un rosso, la respinge (può durare qualche minuto: lanciala
  in sottofondo). Da quel commit una prova rossa tolta ferma la consegna, e una
  a cui hai tolto un caso si rilancia: quello che resta, se è rosso, la ferma.
  Una che la pulizia ha dimenticato esce con un'altra: un commit a parte che
  toglie solo lei, registrato finché è l'ultimo.
  Se la risposta dice che il lavoro passa, togli solo le prove che lei elenca
  (i rilievi che il server ha messo da parte); se non ne elenca, dopo il
  verdetto il ramo non si tocca più.
- **Prima di registrare porta la directory a un commit**
  (`git add -A && git commit -m "verifica #<numero> giro <k>: prove"`): il
  salvataggio automatico parte solo da un Edit o da un Write, non da un `rm` o
  un `mv`. La registrazione rifiuta una directory sporca e stampa l'elenco:
  sistemi e riprovi con la stessa critica.

Registra col testo intero, **in un pezzo solo** dentro le stesse virgolette:

```bash
node scripts/dispatch.mjs --record-verifier <id> "Provato: …
[2i] …
[1i?] …
[0e] …" [--domanda <file.json>]
```

<!-- includi: _segnala.md -->

**Ogni rilievo col `?` porta la sua domanda**, lo stesso JSON di
`domanda.mjs chiedi` con almeno due opzioni: la riga nella critica resta una
riga, le scelte e i loro costi stanno nella domanda. Con un rilievo `?` il
file di `--domanda` ha la domanda; con più rilievi `?` ha un elenco JSON di
domande, una per rilievo, nell'ordine in cui stanno nella critica. Un rilievo
`?` senza la sua domanda, o una domanda senza il suo rilievo, e la critica non
parte. Le opzioni agiscono su `payload.id`; per un rilievo che esce in un
feedback derivato il server le sposta sul derivato, che nasce col titolo della
domanda. Un difetto non va lì: è un rilievo col suo livello.

Sulla critica fermano il lavoro i rilievi interni col `?` di livello 3 o col
`!` (`[2i?!]`): con la loro domanda che blocca il lavoro aspetta l'owner in
ogni esito, e i rilievi da correggere restano davanti a chi riprende dopo la
sua risposta; con `"blocca": false` la critica va avanti col suo esito e la
domanda resta aperta. Un `[2i?]` va avanti: chi corregge applica l'opzione che
consigli, e la sua domanda esce in un feedback derivato. Un 1 col `?`, o un
esterno di qualunque livello, va avanti in un feedback derivato con la sua
domanda, che l'owner decide a parte.

La critica registrata non si modifica più.

## Dopo la registrazione

Quello che il comando stampa è la risposta del server, e fa parte delle tue
istruzioni: seguila per intero. Alla fine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role verifier
```
