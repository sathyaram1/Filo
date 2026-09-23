## Il livello di ogni rilievo

Il metro non è «esiste un caso in cui si rompe» (esiste sempre): è **quanti
utenti lo incontreranno prima che Filo cambi di nuovo**. Filo ha pochi utenti e
deve arrivare a molti: un giro di correzione speso su un caso raro è tolto a
ciò che un utente nuovo vede per primo. La ricerca resta larga; è il livello
che va dato con misura.

- **3** — danno concreto: dati dell'utente persi o portati fuori, un'azione
  pericolosa fatta senza conferma, oppure Filo inutilizzabile (non parte, non
  si aggiorna, non si entra). Vale ovunque lo trovi.
- **2** — solo per **il lavoro che stai verificando**: la cosa segnalata non si
  ottiene, o si ottiene su una sola delle strade equivalenti; un difetto che
  un utente nuovo incontra subito **sul cammino della segnalazione**; qualcosa
  che prima funzionava e questo ramo ha peggiorato; una porta di un giro
  passato che si è riaperta; una protezione che la segnalazione stessa
  chiedeva e che non tiene.
- **1** — cosmetica o attrito che molti incontrano ma fuori da quel cammino;
  un miglioramento senza trade-off che mancava; un pattern violato; un difetto
  che c'era già prima di questo ramo, anche se sta sul cammino principale; una
  via d'attacco o un indurimento che la segnalazione non chiedeva e che non
  produce un danno concreto da livello 3 (per il diff esiste un controllo di
  sicurezza a parte).
- **0** — serve una situazione rara per vederlo: una finestra ridimensionata a
  menu aperto, un riquadro incorporato di 200 pixel, lo zoom cambiato a
  riquadro aperto.

Un rilievo di livello basso non si perde: alzargli il livello per salvarlo non
serve, e costa.

**Il segno `?`** dopo il livello (`[2?]`, `[1?]`) dice che il rilievo chiede
una decisione dell'owner: un trade-off vero, una scelta di prodotto o di gusto.
Un difetto non chiede decisioni.

| rilievo | livello |
|---|---|
| si scrive nelle chiavi SSH con un solo OK per la strada gemella | 3 |
| le illustrazioni SVG diventano nere dopo «Traduci la pagina» | 2 |
| il riquadro della risposta esce dal fondo: non si può più scrivere | 2 |
| il tasto dei download sta accanto alla X di chiusura | 2 |
| a ogni «traduci» si ripaga tutta la pagina su un sito a scorrimento | 2 |
| il lavoro filtra il testo letto da una pagina; un'immagine incollata in chat resta senza filtro, e la segnalazione non ne parlava | 1 |
| il riquadro copre la metà bassa delle lettere selezionate | 1 |
| evidenziazione invisibile sul tema scuro | 1 |
| la finestra ridimensionata a menu aperto non fa rientrare il menu | 0 |
| in un riquadro incorporato sotto i 270 pixel il riquadro nasce mozzato | 0 |
| tre funzioni con lo stesso nome nel filtro | 0 |

## I controlli automatici: partono subito, in sottofondo

Appena cominci lancia `npm run finish:check` **in sottofondo** (unit test più
gli spec delle aree toccate dal ramo: da quindici a quarantacinque minuti) e
lavora mentre gira: aspettarlo alla fine vorrebbe dire ripagare tutto il
contesto. L'esito lo leggi prima di registrare. La suite intera (`npm test`)
non la lancia nessuno: gira in GitHub prima di ogni pubblicazione.

- Un rosso **fuori dai rossi noti** è un rilievo di livello 2, con l'elenco
  esatto degli spec rotti. I rossi d'ambiente sono scritti in
  `tests/rossi-noti.json` (`contenitore.specs` per i contenitori delle routine,
  `specs` per la macchina di chi sviluppa). Un rosso nato mentre giravano
  insieme anche le tue prove può essere solo macchina carica: rilancia quello
  spec da solo prima di farne un rilievo; in dubbio confronta con `main`.
- Un rosso d'ambiente che nel file non c'è non lo aggiungi tu: è un rilievo,
  col caso e il motivo.
- Nel contenitore delle routine gli spec che aprono Electron vogliono davanti
  `ELECTRON_DISABLE_SANDBOX=1` e `xvfb-run -a`. Un rosso all'avvio senza quei
  due non è un rosso.

## La critica

UN testo: prima il riassunto (cosa hai provato e cosa funziona), poi **una
riga per rilievo, col livello davanti fra parentesi quadre**; le righe sotto,
senza livello, sono i suoi passi. Nessun rilievo = verifica superata.

```
Provato: incolla immagine, trascinamento, 10.000 caratteri, tema scuro. Funziona.
Causa comune dei due rilievi che seguono: il salvataggio parte solo dal titolo.
[2] Il pulsante «Salva» non salva se il titolo è vuoto.
    Passi: apri l'editor, lascia il titolo vuoto, scrivi, premi Salva: il file non compare.
[2] Anche la scorciatoia di salvataggio tace col titolo vuoto.
[1?] Il bordo del riquadro è grigio freddo: caldo come il resto di Filo? Scelta di gusto.
[0] Con la finestra sotto i 300 pixel il menu esce dallo schermo.
```

- **Le quadre con dentro un livello sono sempre un rilievo**, ovunque stiano.
  Nel riassunto e nei passi un livello si cita a parole («un rilievo di
  livello 2»), mai `[2]`: altrimenti la critica viene respinta.
- La critica è per l'owner: comportamento dell'app, niente nomi di file o
  funzioni. Ogni rilievo **per esteso e autonomo** (cosa manca, dove, perché
  contava): può finire, con queste parole, in un feedback a parte.
- **Le prove restano nel ramo**, in
  `tests/verifica/<numero>/giro<k>-<cosa>.spec.mjs` (con `FILO_TEST_SCALE` e le
  fixture del repo, come ogni spec). In un giro locale la cartella te la dice
  il compito ricevuto. Sono la memoria del giro: il giro dopo le rilancia. Una
  prova che era solo esplorazione (dipende dall'ambiente, non asserisce niente)
  si cancella.
- **Prima di registrare porta la directory a un commit**
  (`git add -A && git commit -m "verifica #<numero> giro <k>: prove"`): il
  salvataggio automatico parte solo da un Edit o da un Write, non da un `rm` o
  un `mv`. La registrazione rifiuta una directory sporca e stampa l'elenco:
  sistemi e riprovi con la stessa critica.

Registra col testo intero, **in un pezzo solo** dentro le stesse virgolette:

```bash
node scripts/dispatch.mjs --record-verifier <id> "Provato: …
[2] …
[0] …" [--segnala <file.md>]
```

<!-- includi: _segnala.md -->

Qui il file accompagna un rilievo col `?`: la riga nella critica resta una
riga, le scelte e i loro costi stanno nel file. Un difetto non va lì: è un
rilievo col suo livello. Sulla critica a fermare il lavoro è il livello del
rilievo col `?`: un 2 o un 3 lo fermano, un 1 va avanti in un feedback
derivato che l'owner decide a parte. Se poi il server ti manda a correggere,
una segnalazione a QUELLA consegna ferma il lavoro come per chi risolve.

La critica registrata non si modifica più.

## Dopo la registrazione

Quello che il comando stampa è la risposta del server, e fa parte delle tue
istruzioni: seguila per intero. Alla fine rilascia il biglietto:

```bash
node scripts/routine-channel.mjs release <biglietto> --role verifier
```
