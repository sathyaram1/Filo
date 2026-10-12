# L'Aiuto di un sito cerca i documenti col sì dato fuori dal sito

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando l'Aiuto, che vive nel documento di un sito, deve toccare
i dati dell'utente, il lavoro lo fa il main e il sì lo chiede il main, nella
vista di Filo sopra la scheda. Alla pagina tornano solo cose da mostrare (nomi,
cartelle coi nomi di Filo) e chiavi a caso che valgono per quella scheda. Mai un
percorso.

## Il caso (#947.3)

Sul sito del fornitore, dove si carica la bolletta, l'utente chiede all'Aiuto
«mi serve la bolletta della luce di marzo». È il momento in cui un documento
serve davvero, ma la ricerca fra i documenti era solo della home. Le porte
chiuse ai siti (`AZIONI_WEB`, «nemmeno confermato») avevano un motivo preciso:
la conferma disegnata nella pagina la preme anche la pagina. Il sito, poi,
guida la casella dell'Aiuto come vuole, e il testo della pagina può convincere
il modello a cercare.

La strada che regge:

- **Il sì sta fuori dal documento.** La ricerca chiesta da un sito passa da
  `chiediDalMain` (`src/main/confermeSopraPagina.js`): la domanda la scrive il
  main, con l'host della scheda e la richiesta in una riga corta, e la risposta
  torna al main. Da una pagina di Filo il sì serve solo se la cartella esce dal
  perimetro di lettura, come in chat.
- **Alla pagina niente percorsi.** Il content script riceve nome, cartella detta
  coi nomi di Filo («Download › Bollette») e una chiave a caso per ogni
  candidato. Le chiavi vivono nel mondo isolato e valgono solo per la scheda che
  ha cercato, dal suo documento principale, fino alla prossima ricerca o
  navigazione. Aprire, mostrare nella cartella e trascinare passano dalla
  chiave.
- **Il modello non vede percorsi.** I candidati per il modello li mette il main
  nel messaggio (`payload.esterno.documenti` viene sempre riscritto, la pagina
  manda solo il segno), con `PROMPTS.documentiTrovati(…, { per: 'aiuto' })`:
  la risposta dell'Aiuto la legge il sito. Il modello sceglie col numero
  (`"file": 1`), non con un percorso.
- **Il file arriva al sito solo col gesto dell'utente.** Il bottone si
  trascina col trascinamento del sistema (`webContents.startDrag`): la pagina
  riceve il file come da una cartella, nel campo per caricarlo. Il clic apre il
  documento col programma del sistema; il tasto destro apre il menu di Filo
  (`fileSotto`).
- **Quello che il modello ha letto conta.** I pezzi di testo dei candidati
  entrano nella porta delle uscite (#810) e sporcano il compito come un
  documento letto (#530).

## Dove vive

- `src/main/services/aiutoDocumenti.js`: il sì, le chiavi, quello che vede il
  modello. La porta in `src/main/services/handlers/file.js`.
- `src/content/sidebar.js`: l'azione `documenti`, il bottone, la riga
  «leggo i documenti nuovi» con «Ferma».
- Prove: `tests/aiuto-cerca-documenti.spec.mjs`,
  `tests/unit/aiutoDocumenti.test.mjs`.
