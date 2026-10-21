# Il quaderno delle memorie è l'indice del filo

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Ogni riga della memoria (profilo, preferenze, note per argomento, lezioni da riordinare) ricorda gli
eventi del filo da cui è nata, e l'utente la legge, la corregge e la toglie in una pagina sola, il quaderno
(`filo://quaderno/`), che lo porta con un clic al messaggio d'origine. Togliere una riga la nasconde: esce dal prompt
dal messaggio dopo, resta fra le «Nascoste» e non torna dallo stesso tratto del filo. Cancellarla per sempre butta il
testo e tiene solo gli id del tratto.

## Perché

- La memoria entra in ogni conversazione, e prima si poteva solo cancellare intera o riga per riga senza sapere da
  dove veniva una riga. «Da dove l'hai preso?» ha una risposta solo se la fonte viaggia con la nota.
- La spec della home (#872, «Le memorie e le loro fonti») vuole un'app sola per il passato: le chat e le schede chiuse
  stanno nel filo, e la Cronologia come pagina a sé non serve più. Il quaderno ne prende il posto, e ogni strada che
  portava lì (barra laterale, «altro» nella home, i tasti delle pagine, la barra dei menu) porta al quaderno; il
  vecchio indirizzo rimanda.
- Togliere a parole costa 1 perché si disfa (decisione dell'owner): la riga resta fra le nascoste. Il «per sempre» è
  il costo più alto del registro.

## Come è fatto

- **Gli eventi hanno un indirizzo.** `src/shared/filoEventi.js` piega l'id di ogni evento-messaggio accanto al
  messaggio (`dove(stato, id)`, `copiaChat(c, { ids: true })`); `FiloChats.append` torna gli `eids` del turno.
- **Lezione → fonti.** Il creatore di lezioni riceve gli eventi dello scambio (la domanda e la risposta) e
  `appendLesson(testo, { fonti })` li salva con la lezione; SALVA_LEZIONE cita l'ultima domanda dell'utente.
- **Compattatore → note.** `SN_QUADERNO.perCompattatore` dà a ogni riga e lezione un segno (`[R3]`, `[L2]`), il
  modello li cita in fondo a ogni riga (`(fonti: R3, L2)`) e `leggiCompattatore` li trasforma in fonti e data di
  nascita. Il modello non vede mai un id del filo. Una riga senza segni si riconosce per testo; una nuova senza
  niente nasce senza fonti, e nel quaderno non ha il salto.
- **Le fonti stanno a parte** (`FILO_MEMORY_FONTI`), indicizzate dal testo della riga: i moduli restano testo, come li
  legge il prompt.
- **Una riga tolta non torna dallo stesso tratto** (`tornaDaTolta`): una riga nuova che le somiglia e viene solo da
  eventi di quella riga resta fuori, sia come lezione sia nell'uscita del compattatore. Un messaggio nuovo che la
  ridice la riporta. Lezioni e compattatore ricevono anche il testo delle righe tolte, per non riscriverle.
- **Le scritture della memoria vanno in fila** (`inCodaMemoria`), e il compattatore toglie dal buffer solo le lezioni
  che ha letto: una lezione arrivata mentre il modello scriveva non si perde.
- **Il compattatore non scrive sopra l'utente.** Ogni cambio dell'utente (correggere, togliere, rimettere, svuotare)
  alza `versione` nelle fonti; il compattatore la legge per prima e applica la sua uscita solo se è ancora quella,
  altrimenti tutto resta com'è e riparte al giro dopo. Un campo aperto su una riga che intanto è stata riordinata
  resta aperto, e la correzione va alla riga nata da lei (stesse fonti, stesso senso: `erede`), mai a una che ne ha
  assorbite altre.
- **Due righe uguali in un modulo sono una** (`setMemory`): il quaderno riconosce le righe dal testo.
- **Il campo della correzione.** Invio, la spunta o uscire dalla riga salvano; Esc e la × accanto annullano; salvata
  vuota la riga si toglie (fra le nascoste, ritrovata dalle fonti anche dopo un riordino). Un clic dentro la riga o nel
  menu del tasto destro di Filo non è uscire: salverebbe prima di fare quello che l'utente ha chiesto (#872.4).
- **Il salto**: il quaderno apre la home con `?evento=<id>`, la home chiede `FILO_DOVE` e va al messaggio
  (`SN_DASH_CODA.vaiA`). Le fonti che il filo non ha più (una chat tolta) spariscono dalla riga.
- **Le schede chiuse di prima del filo** entrano nel filo alla loro data, legate alla loro voce d'archivio, che tiene
  riassunto e vettore (`entranoSchedeChiuse` in `src/main/services/ilFilo.js`, una volta, e dopo ogni import).

## Cosa non fare

- Non ricomporre una riga dal suo testo dopo una correzione: la correzione tiene le fonti della riga che sostituisce.
- Non far scegliere al modello quale riga è «la stessa» di una tolta: lo decide il codice, con le fonti.

Sentinella: `tests/unit/quaderno.test.mjs`. Prove dell'app: `tests/quaderno-delle-memorie.spec.mjs`.
