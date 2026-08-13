// Libreria di icone SVG.
// Parametri di famiglia (vedi src/styles/ICONS.md per la guida completa):
//   - viewBox 24x24, disegno entro ~20x20
//   - tratto 1.75, linecap/linejoin "round"
//   - outline puro, fill="none", stroke="currentColor" (eredita il colore dal contesto)
// Renderizza un <svg> come stringa: i consumer la iniettano via innerHTML.
// Le icone NON contengono input utente, quindi innerHTML è sicuro.

(function (global) {
  'use strict';

  function wrap(inner, opts = {}) {
    const size = opts.size || 20;
    return (
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
      `fill="none" stroke="currentColor" stroke-width="1.75" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `${inner}` +
      `</svg>`
    );
  }

  // --- Logo Filo: una "f" in corsivo, tratto unico con asola alta e coda
  //     terminale verso sinistra, più traversa orizzontale. Pensata per
  //     evocare un filo che si annoda.
  const filoLogo =
    `<path d="M14.6 5.4c-1.2-1-3-.6-3.6 1.3L7.4 18c-.5 1.7-1.9 2.2-2.9 1.4"/>` +
    `<path d="M6.2 11.6h7.3"/>`;

  // --- Zoom (espandi a tutto schermo): 4 frecce diagonali verso gli angoli
  const zoom =
    // angolo TL
    `<path d="M9 4H4v5"/>` +
    `<path d="M4 4l5 5"/>` +
    // angolo TR
    `<path d="M15 4h5v5"/>` +
    `<path d="M20 4l-5 5"/>` +
    // angolo BL
    `<path d="M9 20H4v-5"/>` +
    `<path d="M4 20l5-5"/>` +
    // angolo BR
    `<path d="M15 20h5v-5"/>` +
    `<path d="M20 20l-5-5"/>`;

  // --- Shrink (esci da schermo intero): 4 frecce diagonali verso il centro
  const shrink =
    // angolo TL
    `<path d="M4 9h5V4"/>` +
    `<path d="M9 9l-5-5"/>` +
    // angolo TR
    `<path d="M20 9h-5V4"/>` +
    `<path d="M15 9l5-5"/>` +
    // angolo BL
    `<path d="M4 15h5v5"/>` +
    `<path d="M9 15l-5 5"/>` +
    // angolo BR
    `<path d="M20 15h-5v5"/>` +
    `<path d="M15 15l5 5"/>`;

  // --- Screenshot: cerchio centrale circondato da 4 angoli (mirino)
  const screenshot =
    `<circle cx="12" cy="12" r="3.2"/>` +
    `<path d="M4 8V6a2 2 0 0 1 2-2h2"/>` +
    `<path d="M16 4h2a2 2 0 0 1 2 2v2"/>` +
    `<path d="M20 16v2a2 2 0 0 1-2 2h-2"/>` +
    `<path d="M8 20H6a2 2 0 0 1-2-2v-2"/>`;

  // --- Screenshot parziale: stesso mirino ad angoli ma con un rettangolo
  //     tratteggiato al centro a indicare "selezione di una regione".
  const screenshotCrop =
    `<path d="M4 8V6a2 2 0 0 1 2-2h2"/>` +
    `<path d="M16 4h2a2 2 0 0 1 2 2v2"/>` +
    `<path d="M20 16v2a2 2 0 0 1-2 2h-2"/>` +
    `<path d="M8 20H6a2 2 0 0 1-2-2v-2"/>` +
    `<rect x="8" y="9" width="8" height="6" rx="0.5" stroke-dasharray="1.4 1.4"/>`;

  // --- Trascrivi: foglio con righe di testo + piccola "T" che evoca OCR.
  //     Tre righe orizzontali (lunghezze decrescenti) dentro una pagina,
  //     piegolino in alto a destra.
  const transcribe =
    `<path d="M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>` +
    `<path d="M14 3v4h4"/>` +
    `<path d="M7.5 11h7"/>` +
    `<path d="M7.5 14h7"/>` +
    `<path d="M7.5 17h4.5"/>`;

  // --- Immagine: cornice + sole in alto a sinistra + due montagne.
  //     Le montagne sono un unico polyline che va da bordo a bordo della
  //     cornice (niente segmenti scollegati). La montagna sotto il sole è
  //     più piccola e non lo tocca.
  const image =
    `<rect x="3.5" y="5" width="17" height="14" rx="2"/>` +
    `<circle cx="7" cy="9" r="1.3"/>` +
    `<path d="M3.5 17L8 12.5L11 15.5L15 10L20.5 17"/>`;

  // --- Salva per dopo (bookmark)
  const saveForLater =
    `<path d="M7 4h10a1 1 0 0 1 1 1v15.2l-6-3.8-6 3.8V5a1 1 0 0 1 1-1z"/>`;

  // --- Download: freccia verso il basso che entra in un vassoio.
  const download =
    `<path d="M12 3v11"/>` +
    `<path d="M8 10.5l4 4 4-4"/>` +
    `<path d="M4 19h16"/>`;

  // --- Condividi (aeroplanino di carta)
  const share =
    `<path d="M21 3L3 11l7 2.5L13 21l8-18z"/>` +
    `<path d="M10 13.5L21 3"/>`;

  // --- Traduzione: glifo "文" in alto a sinistra + "A" in basso a destra.
  //     Niente freccia: la sola disposizione (uno alto, uno basso) comunica
  //     la trasformazione. Entrambi disegnati come path (no <text>).
  const translate =
    // 文 (area x: 1-10, y: 2-12). I quattro tratti tradizionali:
    // 1. puntino in alto, 2. tratto orizzontale, 3. pie (piede sx curvo),
    // 4. na (piede dx dritto). Pie e na partono dallo stesso punto (5,7).
    `<path d="M6 2.5l-1.5 1.7"/>` +
    `<path d="M1 6h9"/>` +
    `<path d="M5 7C4 8.7 2.7 10.3 1 11.5"/>` +
    `<path d="M5 7L10 11.5"/>` +
    // A (area x: 12-22, y: 12-21.5)
    `<path d="M13 21.5l4.5-9.5 4.5 9.5"/>` +
    `<path d="M14.7 18h5.6"/>`;

  // Variante "mostra originale": A in alto a sinistra, 文 in basso a destra.
  const showOriginal =
    // A (area x: 1.5-11.5, y: 2.5-12)
    `<path d="M1.5 12l4.5-9.5 4.5 9.5"/>` +
    `<path d="M3.2 8.5h5.6"/>` +
    // 文 (area x: 13-22, y: 12-21.5)
    `<path d="M18 12.5l-1.5 1.7"/>` +
    `<path d="M13 16h9"/>` +
    `<path d="M17 17C16 18.7 14.7 20.3 13 21.5"/>` +
    `<path d="M17 17L22 21.5"/>`;

  // --- Navigazione: indietro, avanti, ricarica, chiudi
  const back =
    `<path d="M19 12H5"/>` +
    `<path d="M11 6l-6 6 6 6"/>`;

  const forward =
    `<path d="M5 12h14"/>` +
    `<path d="M13 6l6 6-6 6"/>`;

  const reload =
    // Singolo arco ~300° in senso orario; apertura in alto a destra con
    // freccia che indica la direzione di rotazione.
    `<path d="M20 8.5A8 8 0 1 0 20 15.5"/>` +
    `<path d="M20 4v5h-5"/>`;

  const close =
    `<path d="M6 6l12 12"/>` +
    `<path d="M18 6L6 18"/>`;

  // --- Opzioni: ingranaggio a 6 denti + foro centrale.
  //     Costruzione geometrica: denti su raggio 9 (tip) e 6.5 (base), con
  //     half-angle 12.5° al tip e 17.5° alla base (profilo "trapezoidale"
  //     che richiama l'involuta). Archi A r=6.5 fra un dente e il successivo.
  const options =
    `<path d="M18.20 13.96L20.79 13.95L20.79 10.05L18.20 10.04` +
    `A6.5 6.5 0 0 0 16.79 7.61` +
    `L18.08 5.36L14.71 3.42L13.41 5.65` +
    `A6.5 6.5 0 0 0 10.59 5.65` +
    `L9.29 3.42L5.92 5.36L7.21 7.61` +
    `A6.5 6.5 0 0 0 5.80 10.04` +
    `L3.21 10.05L3.21 13.95L5.80 13.96` +
    `A6.5 6.5 0 0 0 7.21 16.39` +
    `L5.92 18.64L9.29 20.58L10.59 18.35` +
    `A6.5 6.5 0 0 0 13.41 18.35` +
    `L14.71 20.58L18.08 18.64L16.79 16.39` +
    `A6.5 6.5 0 0 0 18.20 13.96Z"/>` +
    `<circle cx="12" cy="12" r="2.5"/>`;

  // --- Color picker (pipetta): outline singolo. Cap rettangolare
  //     perpendicolare all'asse + corpo diagonale fino al tip in basso-sinistra.
  const colorPicker =
    `<path d="M14 4l6 6l-3 3l-2-2l-9 9h-3v-3l9-9l-1-1z"/>`;

  // --- Lock (lucchetto): corpo rettangolare con archetto sopra. Usato per la
  //     voce "Sicurezza" nel menu Impostazioni.
  const lock =
    `<rect x="5" y="11" width="14" height="9" rx="1.5"/>` +
    `<path d="M8 11V8a4 4 0 0 1 8 0v3"/>`;

  // --- Trasparenza: libro APERTO. Il lucchetto (sicurezza) e il foglio piegato
  //     (appunti) erano già presi, e volevano dire il contrario: qui il senso è
  //     "sta scritto e lo puoi leggere". ATTENZIONE: copia gemella in
  //     src/main/popup-menu.js (il popup è una BrowserWindow a parte).
  const transparency =
    `<path d="M12 6.6C10.4 5.1 8.3 4.6 4 4.6v12.6c4.3 0 6.4.5 8 2 1.6-1.5 3.7-2 8-2V4.6c-4.3 0-6.4.5-8 2z"/>` +
    `<path d="M12 6.6v14.6"/>`;

  // --- Incognito: tesa del cappello (brim) + due lenti tonde da "spia" con
  //     ponte centrale. Glifo classico della navigazione privata. Usato sia
  //     nel menu Impostazioni sia nel menu secondario tasto destro.
  const incognito =
    `<path d="M3 13h18"/>` +
    `<path d="M6 13l1.4-3.8A2.2 2.2 0 0 1 9.5 7.8h5a2.2 2.2 0 0 1 2.1 1.4L18 13"/>` +
    `<circle cx="8" cy="16.2" r="2.3"/>` +
    `<circle cx="16" cy="16.2" r="2.3"/>` +
    `<path d="M10.3 16.2h3.4"/>`;

  // --- User: testa + spalle (avatar segnaposto per "Accedi"/account).
  const user =
    `<circle cx="12" cy="8" r="4"/>` +
    `<path d="M5 20a7 7 0 0 1 14 0"/>`;

  // --- Plus: croce simmetrica (usata per "nuova scheda" nella tab bar).
  const plus =
    `<path d="M12 5v14"/>` +
    `<path d="M5 12h14"/>`;

  // --- Minimize: una sola linea orizzontale in basso (Windows-like).
  const minimize =
    `<path d="M5 18h14"/>`;

  // --- Maximize: quadrato vuoto (finestra non massimizzata).
  const maximize =
    `<rect x="5" y="5" width="14" height="14" rx="1"/>`;

  // --- Restore: due quadrati sovrapposti (toggle quando già massimizzata).
  const restore =
    `<rect x="5" y="8" width="11" height="11" rx="1"/>` +
    `<path d="M8 8V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-2"/>`;

  // --- Home: tetto + corpo casa (per il bottone "nuova scheda" in addr bar).
  const home =
    `<path d="M4 11l8-7 8 7"/>` +
    `<path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>`;

  // --- App launcher: griglia 3x3 di puntini/quadratini (stile "tutte le app").
  const apps =
    `<rect x="4" y="4" width="4" height="4" rx="1"/>` +
    `<rect x="10" y="4" width="4" height="4" rx="1"/>` +
    `<rect x="16" y="4" width="4" height="4" rx="1"/>` +
    `<rect x="4" y="10" width="4" height="4" rx="1"/>` +
    `<rect x="10" y="10" width="4" height="4" rx="1"/>` +
    `<rect x="16" y="10" width="4" height="4" rx="1"/>` +
    `<rect x="4" y="16" width="4" height="4" rx="1"/>` +
    `<rect x="10" y="16" width="4" height="4" rx="1"/>` +
    `<rect x="16" y="16" width="4" height="4" rx="1"/>`;

  // --- Caret giù: piccola freccetta per i menu a tendina.
  const caretDown =
    `<path d="M6 9l6 6 6-6"/>`;

  // --- Modelli AI: tre nodi connessi (rete neurale stilizzata).
  //     Un nodo in alto, due in basso, collegati a coppie. Da distinguere
  //     visivamente dall'ingranaggio "Impostazioni".
  const models =
    `<circle cx="12" cy="5" r="2"/>` +
    `<circle cx="5.5" cy="18" r="2"/>` +
    `<circle cx="18.5" cy="18" r="2"/>` +
    `<path d="M11 6.7L6.5 16.3"/>` +
    `<path d="M13 6.7L17.5 16.3"/>` +
    `<path d="M7.5 18L16.5 18"/>`;

  // --- QR code: i tre "occhi" (finder pattern) agli angoli + qualche modulo
  //     centrale, per evocare un codice QR senza disegnarlo per intero.
  const qrCode =
    // occhio in alto a sinistra
    `<rect x="3.5" y="3.5" width="6" height="6" rx="1"/>` +
    `<rect x="5.75" y="5.75" width="1.5" height="1.5" fill="currentColor" stroke="none"/>` +
    // occhio in alto a destra
    `<rect x="14.5" y="3.5" width="6" height="6" rx="1"/>` +
    `<rect x="16.75" y="5.75" width="1.5" height="1.5" fill="currentColor" stroke="none"/>` +
    // occhio in basso a sinistra
    `<rect x="3.5" y="14.5" width="6" height="6" rx="1"/>` +
    `<rect x="5.75" y="16.75" width="1.5" height="1.5" fill="currentColor" stroke="none"/>` +
    // moduli del quadrante in basso a destra
    `<path d="M14.5 14.5h2"/>` +
    `<path d="M20 14.5v2"/>` +
    `<path d="M14.5 20h2.5"/>` +
    `<path d="M20 19.5v.5"/>` +
    `<path d="M17.5 17h0.01"/>`;

  // --- Alias semantico: "Salvati per dopo" usa il logo di Filo
  const openForLater = filoLogo;

  // --- Feedback: fumetto/balloon di chat con tre puntini (un messaggio).
  const feedback =
    `<path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4 4v-4H5a1 1 0 0 1-1-1z"/>` +
    `<path d="M8.5 9.5h.01"/>` +
    `<path d="M12 9.5h.01"/>` +
    `<path d="M15.5 9.5h.01"/>`;

  // --- Leggi ad alta voce: altoparlante che emette due onde sonore.
  const readAloud =
    `<path d="M4 9.5v5h3l4.5 3.5v-12L7 9.5H4z"/>` +
    `<path d="M15.5 9.5a4 4 0 0 1 0 5"/>` +
    `<path d="M18 7a7.5 7.5 0 0 1 0 10"/>`;

  // --- Interrompi lettura: stesso altoparlante, ma con una "X" al posto
  //     delle onde (muto/stop) per comunicare "ferma".
  const stopReading =
    `<path d="M4 9.5v5h3l4.5 3.5v-12L7 9.5H4z"/>` +
    `<path d="M15.5 10l4 4"/>` +
    `<path d="M19.5 10l-4 4"/>`;

  // --- Cronologia: orologio con freccia antioraria (il classico "indietro nel
  //     tempo") + lancette. Usata dall'icona Cronologia in alto a destra nella home.
  const history =
    `<path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1"/>` +
    `<path d="M3.5 18v-4h4"/>` +
    `<path d="M12 7.5V12l3 2"/>`;

  // --- Crediti: moneta forata cinese (cerchio + foro quadrato) con un FILO che
  //     passa nel foro e risale in un cappio annodato sopra la moneta. Unisce i
  //     due simboli del prodotto: la moneta (i crediti) e il filo (il brand).
  const credits =
    `<circle cx="12" cy="13.5" r="7"/>` +
    `<rect x="9.75" y="11.25" width="4.5" height="4.5" rx="0.5"/>` +
    `<path d="M12 11.25V5.5"/>` +
    `<path d="M12 5.5a2 2 0 1 0 0.01 0"/>`;

  // --- Red-team: scudo (sicurezza) con un mirino/bersaglio al centro (l'attacco
  //     che prova a forare le difese). Usata dall'icona Red-team in alto a destra
  //     nella home e dalla voce "Invia attacco" del menu tasto destro.
  const redteam =
    `<path d="M12 3.5l6.5 2.5v5c0 4.2-2.8 7.2-6.5 8.5-3.7-1.3-6.5-4.3-6.5-8.5v-5z"/>` +
    `<circle cx="12" cy="11" r="2.4"/>` +
    `<path d="M12 6.8v1.4"/>` +
    `<path d="M12 13.8v1.4"/>` +
    `<path d="M7.8 11h1.4"/>` +
    `<path d="M14.8 11h1.4"/>`;

  // --- Mazzi (deck builder Commander): due carte a ventaglio, quella davanti
  //     dritta e quella dietro ruotata — il gesto di sventagliare una mano.
  const decks =
    `<rect x="8" y="5" width="10" height="14" rx="1.5"/>` +
    `<path d="M6.5 7.2l-2.9.8 3.1 11 3.4-.9"/>`;

  // --- Appunti di Filo: un foglio con l'angolo piegato e due righe di testo —
  //     il gesto di "prendere nota". Coerente con la famiglia outline.
  const note =
    `<path d="M6 3.5h8l4 4v13H6z"/>` +
    `<path d="M14 3.5v4h4"/>` +
    `<path d="M9 12.5h6"/>` +
    `<path d="M9 15.8h4"/>`;

  // --- Ricerca: la classica lente d'ingrandimento (cerchio + manico).
  const search =
    `<circle cx="11" cy="11" r="6"/>` +
    `<path d="M20 20l-4.3-4.3"/>`;

  // Esposizione: ciascuna icona è una FUNZIONE (size) => stringa SVG.
  // Permette ai consumer di chiedere taglie diverse (es. 16 per la riga,
  // 20 per la griglia overflow) senza ricreare manualmente il wrapper.
  const ICONS = {
    filoLogo:     (size) => wrap(filoLogo, { size }),
    zoom:         (size) => wrap(zoom, { size }),
    shrink:       (size) => wrap(shrink, { size }),
    screenshot:   (size) => wrap(screenshot, { size }),
    screenshotCrop: (size) => wrap(screenshotCrop, { size }),
    transcribe:   (size) => wrap(transcribe, { size }),
    image:        (size) => wrap(image, { size }),
    saveForLater: (size) => wrap(saveForLater, { size }),
    download:     (size) => wrap(download, { size }),
    share:        (size) => wrap(share, { size }),
    translate:    (size) => wrap(translate, { size }),
    showOriginal: (size) => wrap(showOriginal, { size }),
    back:         (size) => wrap(back, { size }),
    forward:      (size) => wrap(forward, { size }),
    reload:       (size) => wrap(reload, { size }),
    close:        (size) => wrap(close, { size }),
    options:      (size) => wrap(options, { size }),
    colorPicker:  (size) => wrap(colorPicker, { size }),
    lock:         (size) => wrap(lock, { size }),
    incognito:    (size) => wrap(incognito, { size }),
    user:         (size) => wrap(user, { size }),
    plus:         (size) => wrap(plus, { size }),
    minimize:     (size) => wrap(minimize, { size }),
    maximize:     (size) => wrap(maximize, { size }),
    restore:      (size) => wrap(restore, { size }),
    home:         (size) => wrap(home, { size }),
    apps:         (size) => wrap(apps, { size }),
    caretDown:    (size) => wrap(caretDown, { size }),
    // L'editor usa l'SVG degli appunti (foglio con angolo piegato): ora che
    // l'editor È anche il posto degli appunti, è l'icona più riconoscibile.
    // ATTENZIONE: il popup del menu App/tasto destro della shell è una
    // BrowserWindow a parte e NON carica questo file — tiene una COPIA dei
    // path in `ICON_PATHS` (src/main/popup-menu.js). Se cambi un'icona qui e
    // quel nome esiste anche là, aggiorna entrambe o le due superfici
    // disegneranno icone diverse per la stessa cosa.
    editor:       (size) => wrap(note, { size }),
    models:       (size) => wrap(models, { size }),
    openForLater: (size) => wrap(openForLater, { size }),
    qrCode:       (size) => wrap(qrCode, { size }),
    feedback:     (size) => wrap(feedback, { size }),
    readAloud:    (size) => wrap(readAloud, { size }),
    stopReading:  (size) => wrap(stopReading, { size }),
    history:      (size) => wrap(history, { size }),
    credits:      (size) => wrap(credits, { size }),
    redteam:      (size) => wrap(redteam, { size }),
    decks:        (size) => wrap(decks, { size }),
    note:         (size) => wrap(note, { size }),
    search:       (size) => wrap(search, { size }),
  };

  // Heuristica che il menu usa per capire se una stringa di "icona" è SVG
  // o un glifo testuale (emoji/carattere).
  function isSvgIcon(s) {
    return typeof s === 'string' && s.charCodeAt(0) === 60 /* '<' */ && s.startsWith('<svg');
  }

  global.SN_ICONS = ICONS;
  global.SN_ICONS_UTIL = { isSvgIcon, wrap };
})(typeof globalThis !== 'undefined' ? globalThis : self);
