## Visione

Un editor di testo ripensato da zero come UX e progettato per lavorare con un LLM. Il principio guida: lo spazio è del
testo, gli strumenti arrivano quando servono e se ne vanno quando non servono; l'utente sceglie quali tenere a portata.

Fino a #1433 gli strumenti stavano in una griglia di moduli a fianco del foglio (7×10 caselle, a pagine, con uno
splitter). La griglia è stata tolta: gli strumenti sono diventati elementi del pannello di destra, la chat è l'Aiuto.

---

## Layout Generale

```
┌──────────────────────────────────────────────────────────────┬─┐
│ [Documento ▾]                                     Salvato    │ │
│                                                              │ │
│              ┌──────────────────────────┐        ┌─────────┐ │▒│
│              │                          │        │ 🔒      │ │▒│
│              │      COLONNA DI TESTO    │        │ 123     │ │ │
│              │      (centrata, 720px)   │        │ parole  │ │ │
│              │                          │        │ Cerca…  │ │ │
│              │                          │        │ Commenta│ │ │
│              │                          │        │    +    │ │ │
│              └──────────────────────────┘        └─────────┘ │ │
│                         FOGLIO                     PANNELLO  │↕│
└──────────────────────────────────────────────────────────────┴─┘
                                                     barra di scorrimento
```

- Il foglio prende tutta la larghezza; la colonna di testo resta centrata (720 px al massimo).
- La barra di scorrimento del foglio sta all'estremo bordo destro.
- Il pannello degli strumenti si apre dal bordo destro e sta alla sinistra della barra di scorrimento. Sbloccato si apre
  sopra il foglio senza spostare il testo; bloccato (lucchetto) resta aperto e il foglio si stringe per fargli posto.
- L'Aiuto, quando è aperto, sta sul bordo; il pannello si posa alla sua sinistra.

---

## Il pannello degli strumenti

Il meccanismo è quello di ogni app di Filo che ha un pannello (regole e trappole in
`patterns/globale-nella-barra-contestuale-nel-tasto-destro.md`, sezione «A destra, il pannello dell'app»):

- **Si apre** fermando il mouse contro il bordo destro (fuori dalla fila delle schede), cliccando la striscia sottile
  accanto alla barra di scorrimento, con Ctrl+\ (Cmd+\ su Mac), chiedendolo a Filo. Scorrere in verticale lungo il bordo
  non lo apre: lì si mira la barra di scorrimento, conta solo il puntatore fermo.
- **Si chiude** uscendo col mouse, con Esc, cliccando sul foglio o sulla barra di scorrimento (se non è bloccato), col
  tasto e a parole.
- **In cima gli strumenti scelti**, poi un «+» che allarga il pannello con il catalogo intero: da lì gli strumenti si
  trascinano dentro, fuori e fra loro. Si mettono e si tolgono anche col tasto destro e a parole.
- **Le regolazioni** (attesa sul bordo, chiusura dopo l'uscita, striscia visibile, lucchetto) stanno in Preferenze →
  Avanzate → «Pannello degli strumenti», nel tasto destro sulla striscia e a parole.

### Gli strumenti dell'Editor

Catalogo e partenza in `src/shared/pannelliApp.js`; come si disegnano in `src/pages/editor/editor.js`.

| Strumento | Di partenza | Scorciatoia | Cosa fa |
|---|---|---|---|
| Conteggio | sì | sì | parole, caratteri, frasi o paragrafi (si sceglie); il clic apre le statistiche |
| Cerca e sostituisci | sì | sì (anche Ctrl+F) | cerca, evidenzia, sostituisce una o tutte le corrispondenze |
| Commenta | sì | sì | seleziona il testo da commentare; accanto, i commenti aperti |
| Dimensione testo | no | no | ingrandisce o rimpicciolisce il testo selezionato |
| Allineamento | no | no | sinistra, centro, destra, giustificato |
| Font | no | no | sceglie il carattere del testo selezionato |
| Indietro, Avanti | no | sì | annulla e ripete |
| Impostazioni | no | no | le regolazioni di ogni strumento (scorciatoia, cosa conta il conteggio) |
| Grassetto, Corsivo, Sottolineato | no | sì | di partenza passano dal tasto destro e da Ctrl+B, Ctrl+I, Ctrl+U |

Le scorciatoie restano agli strumenti e valgono anche quando lo strumento non sta nel pannello: Cerca e
sostituisci, che ha bisogno del suo campo, ci rientra da solo. La configurazione di uno strumento vale per tutti i
documenti.

### La chat è l'Aiuto

La chat del documento è l'Aiuto di Filo (`src/content/sidebar.js`): si apre dall'icona dell'Aiuto nella barra
laterale, dalla voce «Aiuto» del tasto destro e a parole. Nell'Editor legge tutto il documento (fino a 350.000
caratteri, oltre lo dice) e, se l'utente lo chiede, ne cambia la formattazione con le azioni che la pagina applica
(`applyFormatActions`): grassetto, corsivo, sottolineato, barrato, dimensione, font, allineamento, su tutto, sui titoli,
sui paragrafi, sulle liste, sulla selezione o sui blocchi che contengono un testo. Ogni modifica crea un punto di
ripristino con l'«Annulla».

---

## Il testo

### Funzionalità base

- Testo ricco: grassetto, corsivo, sottolineato, barrato.
- Titoli: H1, H2, H3.
- Liste puntate e numerate.
- Citazioni (blockquote).
- Undo / Redo.
- I titoli sono collassabili (freccia a lato per nascondere/mostrare il contenuto della sezione).
- Immagini incollate nel foglio.

Il foglio è un `contenteditable` serializzato in JSON compatibile ProseMirror (niente TipTap).

### Shortcut tastiera

- `Ctrl+S`: salva.
- `Ctrl+\`: apre e chiude il pannello degli strumenti.
- `Ctrl+F`: porta al campo di Cerca e sostituisci (se lo strumento era stato tolto, rientra nel pannello).
- Markdown shortcuts per titoli e formattazione inline.
- `Ctrl+Z` / `Ctrl+Y`: undo/redo.
- Su Mac Cmd al posto di Ctrl.

---

## Formato di Salvataggio

I documenti stanno in una collezione (`filo.editor.collection` in localStorage, rispecchiata sull'archivio dell'app).
Ogni documento:

```json
{
  "id": "file-…",
  "meta": {
    "title": "Titolo del documento",
    "created": "2026-05-21T10:00:00Z",
    "modified": "2026-05-21T15:30:00Z",
    "version": 1
  },
  "content": {
    // Formato JSON compatibile ProseMirror
  },
  "comments": [
    {
      "id": "comment-uuid",
      "text": "Contenuto del commento",
      "anchor": { "from": 120, "to": 145, "text": "testo commentato" },
      "created": "2026-05-21T14:00:00Z",
      "resolved": false
    }
  ],
  "modules": []
}
```

`modules` resta vuoto: le disposizioni della vecchia griglia (e `meta.grid`) si buttano alla prima apertura dopo
#1433, e quello che i moduli sapevano ancora usare (cosa conta il conteggio, le scorciatoie) passa agli strumenti.

Gli strumenti del pannello non stanno nei documenti: li conserva il main (`sn_pannelli_app` nell'archivio dell'app),
uno stato per app:

```json
{
  "editor": {
    "elementi": ["word-count", "search-replace", "comment"],
    "config": {
      "word-count": { "count": "chars", "shortcut": "Ctrl+Shift+1", "tasto": "cs|Digit1" }
    },
    "migrato": true
  }
}
```
