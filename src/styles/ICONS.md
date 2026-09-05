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
| `openTab` | Finestra con freccia che esce dall'angolo: Filo apre una scheda |
| `folder` | Cartella con linguetta: apre un file |
| `timer` | Cronometro con pulsante in alto e lancetta |
| `alarm` | Sveglia con due campanelle e piedini |
| `alarmOff` | La stessa sveglia con una X al posto delle lancette (tolta) |
| `alarmShift` | Orologio con freccia ad arco sopra (spostata) |
| `pin` | Puntina da disegno: una lezione fissata nella memoria |
| `searchWeb` | Lente con un globo dentro: cerca sul web |
| `checklist` | Tre righe con spunte: l'intervista di benvenuto |
| `clipboard` | Cartellina con molletta e righe: il manifesto delle capacità |
| `readDocument` | Foglio con angolo piegato e lente in basso a destra: legge un documento |
| `calendar` | Calendario con anelli e "+" nel foglio: evento creato |
| `broom` | Scopa: pulisce le schede |
| `trash` | Cestino con coperchio: elimina definitivamente |
| `eraser` | Gomma da cancellare: cancella la memoria |
| `palette` | Tavolozza a fagiolo con l'incavo del pollice e tre pozzetti: estetica |
| `terminal` | Finestra con ">_": comando nel terminale |
| `globe` | Globo con equatore e meridiano: scheda da un altro paese |
| `globeOff` | Globo barrato: connessione diretta |
| `globePinned` | Globo con segnalibro nell'angolo: regola "sempre da un altro paese" |
| `windowFrame` | Cornice con barra del titolo e due pallini: comando della finestra |
| `brush` | Pennello: stile della pagina |
| `undo` | Freccia che torna indietro: ripristina |
| `mailOpen` | Busta aperta: posta letta (prevista) |
| `mailSend` | Busta con freccia: posta inviata (prevista) |
| `readPage` | Finestra con righe di testo: legge la pagina aperta (prevista) |
| `click` | Freccia del puntatore: clicca nella pagina (prevista) |
| `typeText` | Casella con cursore: scrive in un campo (prevista) |
| `pencil` | Matita: modifica un file (prevista) |
| `fileNew` | Foglio con "+": crea un file (prevista) |
| `attach` | Graffetta: allega (prevista) |
| `camera` | Macchina fotografica: foto/telecamera (prevista) |
| `mic` | Microfono: ascolta (prevista) |
| `memory` | Cervello a due lobi: la memoria di Filo (prevista) |
| `copy` | Due fogli sovrapposti: copia (prevista) |
| `bell` | Campanella: promemoria/notifica (prevista) |
| `repeat` | Due frecce a ciclo: automazione ricorrente (prevista) |
| `question` | Cerchio con "?": Filo chiede all'utente (prevista) |
| `tabs` | Finestra con due linguette: le schede aperte (prevista) |
| `location` | Goccia del segnaposto: posizione (prevista) |
| `list` | Elenco puntato: piano di lavoro (prevista) |
| `sparkles` | Due scintille: genera (prevista) |
| `reasoning` | Nuvola di pensiero: sta ragionando (stato) |
| `check` | Spunta: fatto (stato) |
| `warning` | Triangolo con "!": avviso (stato) |
| `blocked` | Cerchio barrato: bloccato (stato) |

### Icone delle azioni dell'agente

La corrispondenza azione → icona (`NAVIGA` → `openTab`, …) vive in
`src/shared/actionIcons.js` (`SN_ACTION_ICONS.svg(type, size)`): l'icona di
un'azione sta in un posto solo, e una sentinella (`tests/unit/actionIcons.test.mjs`)
diventa rossa se un'azione registrata in `actionLevels.js` resta senza icona.
Le icone marcate "prevista" sono disegnate per poteri che l'agente non ha
ancora: quando l'azione nasce, si sposta da `PREVISTE` ad `AZIONI` col nome vero.

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
