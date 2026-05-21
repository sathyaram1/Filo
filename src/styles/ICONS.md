# Guida di stile — Icone Filo

Questo documento è la fonte di verità per disegnare nuove icone o ridisegnare quelle esistenti. Vale per tutta l'estensione: menu contestuale, sidebar, popup, pagine interne (Home, Cronologia, Opzioni, Feedback).

> **Regola d'oro.** Mai usare emoji. Le icone vivono in [`src/shared/icons.js`](../shared/icons.js) come stringhe SVG e si consumano via `SN_ICONS.<nome>(size)`.

## Filosofia

1. **Semplice e minimale.** Pochi tratti, leggibili a 16-20px, niente decorazioni superflue.
2. **Familiare.** Quando esiste una convenzione consolidata (lente per "cerca", bookmark, ingranaggio, ecc.) la rispettiamo: la familiarità batte la novità.
3. **Fisico quando ha senso.** Se l'azione richiama un oggetto reale (pipetta, aeroplanino di carta, segnalibro), il disegno evoca quell'oggetto. Il "fisico" rende più memorabile dell'astratto.
4. **Mai grigio o colore per ragioni non funzionali.** Il colore deve sempre veicolare informazione (stato attivo, errore, accent del brand). Per default l'icona è monocroma e segue `currentColor`, ereditando dal contesto. L'unico colore "di brand" è `--sn-accent`.

## Parametri tecnici (famiglia)

Tutte le icone funzionali condividono questi parametri.

| Parametro | Valore |
|---|---|
| Griglia | `viewBox="0 0 24 24"` |
| Disegno utile | entro ~20×20 (margine di sicurezza 2px per lato) |
| Tratto | `stroke-width="1.75"` |
| Terminazioni | `stroke-linecap="round" stroke-linejoin="round"` |
| Raggio angoli interni | 2 |
| Stile | outline puro: `fill="none"`, mai riempimenti |
| Colore | `stroke="currentColor"` (eredita) |

Dimensioni di render correnti (impostate da chi consuma l'icona):

- 16px → cronologia incolla, badge inline
- 18px → riga primaria del menu contestuale e griglia overflow
- 20px → default della libreria, per quando non viene specificato

## API della libreria

```js
// src/shared/icons.js espone:
self.SN_ICONS = {
  filoLogo: (size) => '<svg>…</svg>',
  zoom:     (size) => '<svg>…</svg>',
  // …
};
self.SN_ICONS_UTIL = { isSvgIcon, wrap };
```

- Ogni entry è una **funzione** `(size) => string`. Il consumer può quindi chiedere taglie diverse senza ricreare il wrapper.
- L'output è **stringa**. I consumer la iniettano via `innerHTML` o helper centralizzati (`setIconContent` in `src/content/menu.js`). È sicuro: l'input non viene mai dall'utente.
- `isSvgIcon(s)` è la heuristica usata dal menu per decidere fra SVG (innerHTML) e glifo testuale residuo (textContent).

## Aggiungere un'icona nuova

1. Decidi il nome semantico (camelCase, es. `pinTab`, non `pin_tab` né `tab-pin`).
2. Disegna entro 24×24 rispettando i parametri sopra. Lascia 2px di margine.
3. Aggiungi la entry in `src/shared/icons.js`, mantenendo il file in ordine logico (logo → globali → navigazione → utility).
4. Documentala in fondo a questo file nella sezione **Registro** con una riga "nome — descrizione concettuale".
5. Mai aggiungere una nuova icona "per provare" senza che sia richiesta da una azione reale.

## Errori da evitare

- ❌ Tratti di spessori diversi nella stessa icona (rompe la famiglia).
- ❌ `stroke-linecap="butt"`/`square` (rompe lo stile round).
- ❌ Riempimenti pieni "decorativi" (rompe l'outline puro).
- ❌ Disegnare a 16×16 e poi scalare: parti SEMPRE da 24×24.
- ❌ Usare `<text>` con font di sistema per icone "veloci": la libreria deve essere autosufficiente e indipendente dal font dell'host. Eccezione: glifi linguistici non rappresentabili visivamente (es. `traduzione` con `文` e `A`, dove tipograficamente l'oggetto È il glifo) — in quel caso disegna **anche quei caratteri come path**, non come `<text>`.
- ❌ Dipendere dal tema: l'icona è monocroma e usa `currentColor`. Il contesto decide il colore.

## Registro delle icone esistenti

> Concetto, non descrizione del path. Se il disegno cambia ma il concetto resta, questa tabella non si tocca.

| Nome | Concetto |
|---|---|
| `filoLogo` | Una "f" corsiva con asola alta e traversa: il logo di Filo |
| `zoom` | 4 frecce diagonali che puntano verso gli angoli (espandi a schermo intero) |
| `screenshot` | Cerchio centrale circondato da 4 angoli a L (mirino di cattura) |
| `image` | Cornice rettangolare con sole in alto a sinistra e profilo di montagne (quadro paesaggio) |
| `saveForLater` | Segnalibro classico con punta a V in basso |
| `share` | Aeroplanino di carta in volo |
| `translate` | Glifo 文 in alto a sinistra, freccia diagonale, lettera A in basso a destra |
| `showOriginal` | Variante inversa di `translate`: A → 文 (usata quando una traduzione è già attiva) |
| `back` | Freccia orizzontale verso sinistra con corpo pieno |
| `forward` | Freccia orizzontale verso destra con corpo pieno |
| `reload` | Doppio arco circolare con due frecce contrapposte (ricarica) |
| `close` | Croce X centrata |
| `options` | Ingranaggio a 8 denti con foro centrale |
| `colorPicker` | Pipetta diagonale con ampolla in alto a destra |
| `plus` | Croce simmetrica (nuova scheda) |
| `minimize` | Singola linea orizzontale in basso (minimizza finestra) |
| `maximize` | Quadrato vuoto (massimizza finestra) |
| `restore` | Due quadrati sovrapposti (ripristina da massimizzata) |
| `home` | Tetto a triangolo sopra corpo casa |
| `openForLater` | Alias di `filoLogo` — "Salvati per dopo" mostra il logo |

## Note operative

- L'overflow del menu (`▸`) e gli arrow di sotto-menu (`▾`, `▸`) sono volutamente lasciati come glifi unicode: sono indicatori di affordance UI, non icone semantiche. Cambiarli in SVG appesantirebbe senza beneficio.
- Le 4 icone PNG dell'estensione (`icons/icon-{16,32,48,128}.png`) sono indipendenti da questa libreria: vengono caricate da Chrome per la toolbar/store. Quando si ridisegna il logo Filo, vanno rigenerate a parte mantenendo la stessa identità visiva di `SN_ICONS.filoLogo`.
- Il file `src/shared/icons.js` è caricato dal manifest sia nei content script sia (se ne avranno bisogno) nelle pagine interne: aggiungere `<script src="../../shared/icons.js"></script>` nell'HTML prima del bootstrap.

## Quando un'icona NON va aggiunta alla libreria

- È usata in un solo posto come decorazione una tantum (es. illustrazione di onboarding) → resta inline.
- È un grafo/forma dinamica generata da dati (es. sparkline) → vive col suo componente.
- È fornita dal browser/SO (favicon, emoji nativo nei contenuti dell'utente) → non è "nostra".

---

_Manutentore implicito: chi tocca un'icona aggiorna anche questa pagina._
