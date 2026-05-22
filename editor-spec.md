## Visione

Un editor di testo ripensato da zero come UX, con un sistema di moduli configurabili nella sidebar e progettato per integrazione con LLM. Il principio guida: separare la scrittura dalla formattazione, dare all'utente il controllo totale dello spazio di lavoro, e trattare l'editor come un ambiente orchestrabile, non un programma monolitico.

---

## Layout Generale

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   ┌───────────────────────┐  ┌────────────────────────┐ │
│   │                       │  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │ │
│   │                       │  │  │  │ │  │ │  │ │  │  │ │
│   │                       │  │  └──┘ └──┘ └──┘ └──┘  │ │
│   │                       │  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │ │
│   │     AREA TESTO        │  │  │  │ │  │ │  │ │  │  │ │
│   │                       │  │  └──┘ └──┘ └──┘ └──┘  │ │
│   │                       │  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │ │
│   │                       │  │  │  │ │  │ │  │ │  │  │ │
│   │                       │  │  └──┘ └──┘ └──┘ └──┘  │ │
│   │                       │  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐  │ │
│   │                       │  │  │  │ │  │ │  │ │  │  │ │
│   │                       │  │  └──┘ └──┘ └──┘ └──┘  │ │
│   │                       │  │        GRIGLIA         │ │
│   │                       │  │        MODULI          │ │
│   └───────────────────────┘  └────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- L'area testo occupa ~60% della larghezza, sidebar ~40%.
---

## Griglia Moduli

### Struttura

- Griglia di **5 colonne × 7 righe** (28 celle visibili).
- Ogni cella è un quadrato con bordi arrotondati.
- Gap piccolo tra le celle (4-6px).
- La griglia è **fissa** (non scrollabile). Lo spazio è finito e l'utente sceglie cosa mostrare.

###  Moduli
- ongi modulo può occupare una o più celle.
- ogni moulo può essere trascinato e spostato.
- Celle vuote sono visibili come slot disponibili (bordo tratteggiato leggero).

### Workspace / Pagine

- L'utente può avere **più configurazioni** della griglia (workspace).
- Un modulo speciale (sempre presente) permette di switchare tra workspace.
- Ogni workspace ha un nome e un'icona.
- Questo permette set diversi per attività diverse: "Scrittura" (minimale), "Revisione" (outline + commenti + agente), "Formattazione" (font, colori, layout).

---

## Moduli — Prototipo Iniziale

Per il prototipo, implementare questi moduli funzionanti:
### 0. impostazioni
- sostituisce lo spazio del testo con l'elenco di tutti i moduli (che potranno esere spostati della sidebar)
- un clik su un modulo mentre sono aperte le impostazioni non lo attiva ma apre un box per personalizzare il modulo. in questo box è possibile scegliere una shotcut.
ogni modulo ha anche altre caratteristiche configuramizzabili dipendenti dal modulo stesso.

### 1. swith (3+x1)
- ha 2-4 icone al suo interno. se cliccate cambia il livello (z) e quindi i moduli mostrati.
- ai lati ha delle freccette per espanderlo modificando la dimensione del modulo e il numero di icone (il numero di icone mostrate è dimensione orizzontale -1)
- le icone sono semplicemente numeri di base
- in personalizzazione è possibile modificare le icone ed il nome (ce ne sono alcune predefinite fra cui scegliere: penna per "scritura", bolla di chat per "chat", A in font con grazie per "formattazione" ). questi sono solo cambi estetici e non dettano che moduli possano stare in ogni pagina.
- lo switch non può essere ampliato se non ha abbastanza spazio in tutte le pagine

### 2. Conteggio Parole (1×1)
- Mostra il numero di parole nel documento.
- Click → overlay con: caratteri, paragrafi, frasi, tempo di lettura stimato.
- Si aggiorna in tempo reale durante la digitazione.
- in personalizzazione si può scegliere se conta le parole/caratteri/ frasi...

### 3. Cerca e Sostituisci (2×2)
- Due campi: cerca / sostituisci.
- Evidenzia tutte le occorrenze nel testo.
- Bottoni: prossimo, precedente, sostituisci, sostituisci tutto.

### 4. comenta (1x1)
- quando cliccato cambia il cursore. è possibile selezionare una parte del testo (tasto sinistro + drag) finita la selezione si apre un box (sopra alla pagina attuale) per scrivere il commento. 
- I commenti sono salvati nel JSON del documento.

### 5. chat (AxB, min 3x3)
- è una chat con LLM che può vedere il testo e rispondere nella chat.
---

## Editor di Testo (TipTap)

### Funzionalità base

- Testo ricco: grassetto, italico, sottolineato, barrato.
- Titoli: H1, H2, H3.
- Liste puntate e numerate.
- Citazioni (blockquote).
- Undo / Redo.
- I titoli sono collassabili (freccia a lato per nascondere/mostrare il contenuto della sezione).

### Shortcut tastiera

- `Ctrl+S`: salva (JSON in localStorage).
- `Ctrl+\` (o altro): toggle sidebar.
- `Ctrl+F`: focus sul modulo cerca e sostituisci (se presente nella griglia).
- Markdown shortcuts per titoli e formattazione inline.
- `Ctrl+Z` / `Ctrl+Y`: undo/redo.

---

## Formato di Salvataggio

Il documento è un **singolo file JSON** con questa struttura:

```json
{
  "meta": {
    "title": "Titolo del documento",
    "created": "2026-05-21T10:00:00Z",
    "modified": "2026-05-21T15:30:00Z",
    "version": 1
  },
  "content": {
    // Formato JSON nativo di TipTap/ProseMirror
  },
  "comments": [
    {
      "id": "comment-uuid",
      "text": "Contenuto del commento",
      "anchor": {
        "from": 120,
        "to": 145
      },
      "created": "2026-05-21T14:00:00Z",
      "resolved": false
    }
  ],
  "modules": [
    {
      "id": "mod-001",
      "type": "word-count",
      "cells": [
        { "x": 0, "y": 0, "z": 0 }
      ],
      "data": {}
    },
    {
      "id": "mod-002",
      "type": "outline",
      "cells": [
        { "x": 0, "y": 1, "z": 0 },
        { "x": 1, "y": 1, "z": 0 },
        { "x": 0, "y": 2, "z": 0 },
        { "x": 1, "y": 2, "z": 0 }
      ],
      "data": {}
    },
    {
      "id": "mod-003",
      "type": "workspace-switcher",
      "cells": [
        { "x": 3, "y": 6, "z": 0 },
        { "x": 3, "y": 6, "z": 1 }
      ],
      "data": {
        "activePage": 0,
        "pages": [
          { "z": 0, "name": "Scrittura", "icon": "pen" },
          { "z": 1, "name": "Revisione", "icon": "eye" }
        ]
      }
    },
    {
      "id": "mod-004",
      "type": "custom-prompt",
      "cells": [
        { "x": 2, "y": 0, "z": 1 },
        { "x": 3, "y": 0, "z": 1 }
      ],
      "data": {
        "prompt": "Elenca 5 sinonimi di: {selection}",
        "model": "gemini-flash"
      }
    }
  ]
}
```

---


## Interazioni Chiave da Implementare nel Prototipo

1. **Scrivere testo** con TipTap e vederlo formattato.
2. **Toggle sidebar** con shortcut e bottone.
3. **Drag-and-drop moduli** nella griglia.
4. **Conteggio parole** che si aggiorna in tempo reale.
5. **Outline** che riflette i titoli e permette navigazione.
6. **Cerca e sostituisci** funzionante.
7. **Commenti**: aggiungere, visualizzare, navigare.
8. **Switch workspace** tra almeno 2 configurazioni.
9. **Salvataggio/caricamento** da localStorage.
10. **Celle vuote** con "+" per aggiungere moduli.

---

