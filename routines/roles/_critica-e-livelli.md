## Il livello e la sede di ogni rilievo

Ogni rilievo porta DUE cose indipendenti: il **livello** (quanto è grave) e
la **sede** (a chi tocca: a questo lavoro o a un altro). Si scrivono insieme
fra quadre, prima la cifra e poi la lettera: `[3i]`, `[2e]`, `[1i?]`, `[0e]`.
La lettera è obbligatoria: un rilievo senza sede viene respinto con la
spiegazione, non prende un valore in silenzio.

### Il livello: quanti lo incontrano

Il metro è la frequenza — quanti utenti lo incontreranno — non «esiste un
caso in cui si rompe» (esiste sempre). Filo ha pochi utenti e deve arrivare a
molti: un giro di correzione speso su un caso raro è tolto a ciò che un utente
nuovo vede per primo. La ricerca resta larga; è il livello che va dato con
misura.

- **3** — sicurezza (dati cancellati o portati fuori, attacchi alle routine),
  perdite importanti di soldi (un ciclo che fa milioni di chiamate al server),
  Filo inutilizzabile. Solo se ci si arriva con una pagina, un documento o
  un'azione NORMALE, senza condizioni particolari.
- **2** — una funzione che non funziona nel caso normale (quello che la
  maggior parte degli utenti prova per primo) o più di una volta su cinque; un
  danno cosmetico enorme ed evidentissimo; una porta di sicurezza che richiede
  una condizione rara (un gesto insolito, una grafia particolare).
- **1** — una funzione che fallisce di rado (meno di una volta su cinque), non
  cosmetica; un danno cosmetico locale ma evidente.
- **0** — un danno cosmetico raro.

Linea guida: **il 20% dello sforzo che dà l'80% del risultato**; il resto si
rimanda a quando ci saranno i mezzi (utenti paganti, modelli migliori o più
economici). Dopo una cura le vie rimaste sono rare per definizione, e il
livello scende da solo. Vale anche per la sicurezza: una porta che
l'attaccante raggiunge solo con una condizione rara è un 2, non un 3. Un
rilievo di livello basso non si perde: alzargli il livello per salvarlo non
serve, e costa.

Accertati che ogni rilievo sia reale: se hai un dubbio, verificalo prima di
scriverlo. Se sei in dubbio sul livello, scegli il più basso.

### La sede: interno o esterno

**Interno** (`i`) se una delle due:

- il difetto sta nello **scenario scritto nella segnalazione**: i suoi esempi,
  i suoi passi, la cosa che chiede, coi casi ovvi di quella cosa (in «rendi
  allegabili i documenti», un docx che non si allega è interno; il livello lo
  decide il caso: un pdf che non si allega è 2, un formato sconosciuto è 0);
- oppure **l'ha creato questo ramo**: il lavoro o una delle sue correzioni.
  Prima di scrivere `i` per questo motivo lo controlli sul codice, non a
  intuito: `git diff origin/main...HEAD -- <file>` sul punto che hai davanti.

**Esterno** (`e`) tutto il resto: un difetto che c'era già su `main` fuori
dallo scenario; un'altra porta della stessa classe che la segnalazione non
nominava; un difetto in qualcosa che il ramo ha aggiunto oltre il chiesto
(l'aggiunta resta, il suo difetto va in un feedback suo: non si disfa il
lavoro fatto).

La sede non cambia il livello: un 3 esterno resta un 3. Il giro continua solo
per i rilievi interni; ogni esterno esce subito in un feedback suo, con la
priorità uguale al livello, e non ferma questo lavoro — nemmeno col `?`: la
domanda viaggia nel suo feedback.

**Il segno `?`** dopo la lettera (`[2i?]`, `[1e?]`) dice che il rilievo chiede
una decisione dell'owner: un trade-off vero, una scelta di prodotto o di
gusto. Un difetto non chiede decisioni.

| segnalazione e rilievo | livello e sede |
|---|---|
| «Filo legge le pagine web» (esempi: quanto costa, a che ora apre): il listino della pizzeria sparisce dalla lettura | 2i |
| stessa segnalazione: il freno sugli indirizzi non riconosce i dati scritti al contrario | 1e |
| «limita le azioni dopo una lettura» (memoria, schede, impostazioni, terminale, rete): il limite non tiene sulle schede | 2i |
| stessa segnalazione: un collegamento scritto in chat porta fuori i dati con un gesto normale | 3e |
| «il timer non suona»: chiesto a parole, Filo dice che la manopola del volume — aggiunta dalla correzione — non esiste | 1i |
| stessa segnalazione: la pagina Preferenze aperta in un'altra scheda cancella le modifiche fatte altrove (c'era già su `main`, per tutte le pagine) | 2e |
| si scrive nelle chiavi SSH con un solo OK, sul cammino della segnalazione | 3i |
| la finestra ridimensionata a menu aperto non fa rientrare il menu, fuori dallo scenario | 0e |

## I controlli automatici: partono subito, in sottofondo

Appena cominci lancia `npm run finish:check` **in sottofondo** (unit test più
gli spec delle aree toccate dal ramo: da quindici a quarantacinque minuti) e
lavora mentre gira: aspettarlo alla fine vorrebbe dire ripagare tutto il
contesto. L'esito lo leggi prima di registrare. La suite intera (`npm test`)
non la lancia nessuno: gira in GitHub prima di ogni pubblicazione.

- Un rosso **fuori dai rossi noti** è un rilievo di livello 2, interno se
  l'ha rotto il ramo (il confronto con `main` lo dice), con l'elenco esatto
  degli spec rotti. I rossi d'ambiente sono scritti in
  `tests/rossi-noti.json` (`contenitore.specs` per i contenitori delle routine,
  `specs` per la macchina di chi sviluppa). Un rosso nato mentre giravano
  insieme anche le tue prove può essere solo macchina carica: rilancia quello
  spec da solo prima di farne un rilievo; in dubbio confronta con `main`.
- Un rosso d'ambiente che nel file non c'è non lo aggiungi tu: è un rilievo,
  col caso e il motivo.
- Nel contenitore delle routine gli spec che aprono Electron vogliono davanti
  `ELECTRON_DISABLE_SANDBOX=1` e `xvfb-run -a`: `finish:check` ce li mette da
  sé, un `npx playwright test` lanciato a mano no. Un rosso all'avvio senza
  quei due non è un rosso.

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
[1i?] Il bordo del riquadro è grigio freddo: caldo come il resto di Filo? Scelta di gusto.
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
  `tests/verifica/<numero>/giro<k>-<cosa>.spec.mjs` (con `FILO_TEST_SCALE` e le
  fixture del repo, come ogni spec). In un giro locale la cartella te la dice
  il compito ricevuto. Sono la memoria del giro, e a rilanciarle sei solo tu,
  in partenza. Una prova che era solo esplorazione (dipende dall'ambiente, non
  asserisce niente) si cancella. Si cancella anche quella di un rilievo
  **esterno**, nello stesso commit: quel rilievo esce di qui dentro un feedback
  suo, col suo testo, e la prova lasciata indietro sarebbe solo un rosso da
  rispiegare per sempre. Quelle dei rilievi che la risposta del server lascia
  fuori dal giro le toglie chi corregge, coi numeri che il server gli dà; se la
  risposta invece dice che il lavoro passa, le togli tu, seguendola.
- **Prima di registrare porta la directory a un commit**
  (`git add -A && git commit -m "verifica #<numero> giro <k>: prove"`): il
  salvataggio automatico parte solo da un Edit o da un Write, non da un `rm` o
  un `mv`. La registrazione rifiuta una directory sporca e stampa l'elenco:
  sistemi e riprovi con la stessa critica.

Registra col testo intero, **in un pezzo solo** dentro le stesse virgolette:

```bash
node scripts/dispatch.mjs --record-verifier <id> "Provato: …
[2i] …
[0e] …" [--segnala <file.md>]
```

<!-- includi: _segnala.md -->

Qui il file accompagna un rilievo col `?`: la riga nella critica resta una
riga, le scelte e i loro costi stanno nel file. Un difetto non va lì: è un
rilievo col suo livello. Sulla critica fermano il lavoro un rilievo interno
di livello 2 o 3 col `?` e la segnalazione allegata, anche senza rilievi: con
`--segnala` il lavoro aspetta l'owner in ogni esito, e i rilievi da correggere
restano davanti a chi riprende dopo la sua risposta. Un 1 col `?`, o un
esterno di qualunque livello, va avanti in un feedback derivato che l'owner
decide a parte. Se poi il server ti manda a correggere, una segnalazione a
QUELLA consegna ferma il lavoro come per chi risolve.

La critica registrata non si modifica più.

## Dopo la registrazione

Quello che il comando stampa è la risposta del server, e fa parte delle tue
istruzioni: seguila per intero. Alla fine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role verifier
```
