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

  // ======================================================================
  // Icone delle AZIONI dell'agente Filo (righe del blocco di attività in
  // chat, #521). La corrispondenza azione → icona sta in
  // src/shared/actionIcons.js: qui c'è solo il disegno. Stessa famiglia
  // delle altre: outline, 24×24, tratto 1.75. Le PREVISTE (posta, pagina,
  // voce…) sono già disegnate perché l'agente le avrà a breve.
  // ======================================================================

  // --- Apri una scheda: finestra con freccia che esce dall'angolo in alto a destra.
  const openTab =
    `<path d="M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7"/>` +
    `<path d="M14 4h6v6"/>` +
    `<path d="M20 4l-9 9"/>`;

  // --- Apri un file: cartella con la linguetta.
  const folder =
    `<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>`;

  // --- Timer: cronometro (quadrante, pulsante in alto, lancetta).
  const timer =
    `<circle cx="12" cy="13.5" r="7"/>` +
    `<path d="M12 10v3.5l2.5 1.5"/>` +
    `<path d="M10 3.5h4"/>` +
    `<path d="M12 3.5v3"/>` +
    `<path d="M18 7l1.5-1.5"/>`;

  // --- Sveglia: orologio con le due campanelle e i piedini.
  const alarm =
    `<circle cx="12" cy="13" r="7"/>` +
    `<path d="M12 9v4l2.5 1.5"/>` +
    `<path d="M4 7l3-3"/>` +
    `<path d="M20 7l-3-3"/>` +
    `<path d="M7.5 19l-1.5 2"/>` +
    `<path d="M16.5 19l1.5 2"/>`;

  // --- Sveglia tolta: la stessa sveglia, ma al posto delle lancette una X.
  //     La sbarra universale qui si intrecciava con lancette, campanelle e
  //     piedini (parere dell'owner): il quadrante vuoto con la X è pulito.
  const alarmOff =
    `<circle cx="12" cy="13" r="7"/>` +
    `<path d="M9.5 10.5l5 5"/>` +
    `<path d="M14.5 10.5l-5 5"/>` +
    `<path d="M4 7l3-3"/>` +
    `<path d="M20 7l-3-3"/>` +
    `<path d="M7.5 19l-1.5 2"/>` +
    `<path d="M16.5 19l1.5 2"/>`;

  // --- Sveglia spostata: orologio con una freccia ad arco sopra (riprogramma).
  const alarmShift =
    `<circle cx="12" cy="14" r="6.5"/>` +
    `<path d="M12 10.5V14l2.5 1.5"/>` +
    `<path d="M6 6.5a8 8 0 0 1 12 0"/>` +
    `<path d="M18 3v3.5h-3.5"/>`;

  // --- Lezione fissata nella memoria: puntina da disegno.
  const pin =
    `<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3z"/>` +
    `<path d="M12 13.5V21"/>`;

  // --- Cerca sul web: lente con un globo dentro (meridiano ed equatore).
  const searchWeb =
    `<circle cx="10.5" cy="10.5" r="6.5"/>` +
    `<path d="M4 10.5h13"/>` +
    `<path d="M10.5 4c-3 3-3 10 0 13"/>` +
    `<path d="M10.5 4c3 3 3 10 0 13"/>` +
    `<path d="M20.5 20.5l-5.3-5.3"/>`;

  // --- Intervista di benvenuto: lista di spunte.
  const checklist =
    `<path d="M4.5 6.5l1.5 1.5 3-3"/>` +
    `<path d="M12 7h8"/>` +
    `<path d="M4.5 12.5l1.5 1.5 3-3"/>` +
    `<path d="M12 13h8"/>` +
    `<path d="M4.5 18.5l1.5 1.5 3-3"/>` +
    `<path d="M12 19h8"/>`;

  // --- Manifesto delle capacità: cartellina con la molletta e le righe.
  const clipboard =
    `<rect x="5" y="5" width="14" height="16" rx="2"/>` +
    `<path d="M9 3.5h6v3H9z"/>` +
    `<path d="M9 12h6"/>` +
    `<path d="M9 15.5h4"/>`;

  // --- Leggi un documento: foglio con l'angolo piegato e una lente in basso a destra.
  const readDocument =
    `<path d="M14 3.5H6v17h6"/>` +
    `<path d="M14 3.5v4h4v4.5"/>` +
    `<path d="M9 11h5"/>` +
    `<path d="M9 14.5h3"/>` +
    `<circle cx="16.5" cy="16.5" r="3"/>` +
    `<path d="M18.7 18.7L21 21"/>`;

  // --- Evento in calendario: calendario con i due anelli e un "+" nel foglio.
  const calendar =
    `<rect x="4" y="5" width="16" height="15" rx="2"/>` +
    `<path d="M4 10h16"/>` +
    `<path d="M8 3v4"/>` +
    `<path d="M16 3v4"/>` +
    `<path d="M12 13v4"/>` +
    `<path d="M10 15h4"/>`;

  // --- Pulisci le schede: scopa (manico diagonale + blocco di setole).
  const broom =
    `<path d="M20 4l-8.5 8.5"/>` +
    `<path d="M9.7 10.7l3.6 3.6-3.8 6.2L3.5 14.5z"/>` +
    `<path d="M7.5 12.9l2.4 2.4"/>` +
    `<path d="M5.5 14.9l2.4 2.4"/>`;

  // --- Elimina definitivamente: cestino con coperchio.
  const trash =
    `<path d="M4 7h16"/>` +
    `<path d="M9 7V4.5h6V7"/>` +
    `<path d="M6 7l1 13h10l1-13"/>` +
    `<path d="M10 11v6"/>` +
    `<path d="M14 11v6"/>`;

  // --- Cancella la memoria: gomma da cancellare.
  const eraser =
    `<path d="M4.5 15l9.5-9.5a2 2 0 0 1 2.8 0l3.7 3.7a2 2 0 0 1 0 2.8L13.5 19H8.5z"/>` +
    `<path d="M9.5 10l5.5 5.5"/>` +
    `<path d="M13.5 19H20"/>`;

  // --- Estetica: tavolozza del pittore. Forma a fagiolo con l'incavo del
  //     pollice in basso a destra e tre pozzetti ad anello: il cerchio coi
  //     puntini sembrava un biscotto (parere dell'owner).
  const palette =
    `<path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8s3.8 8 8.5 8c1.2 0 2-.9 2-2 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h1.8c2.5 0 4.5-1.8 4.5-4.2C21 6.5 17 3.5 12 3.5z"/>` +
    `<circle cx="7.5" cy="12" r="1.2"/>` +
    `<circle cx="9.8" cy="7.8" r="1.2"/>` +
    `<circle cx="14.5" cy="7" r="1.2"/>`;

  // --- Comando nel terminale: finestra con il prompt ">_".
  const terminal =
    `<rect x="3" y="4.5" width="18" height="15" rx="2"/>` +
    `<path d="M7 9.5l3 2.5-3 2.5"/>` +
    `<path d="M12.5 15h5"/>`;

  // --- Da un altro paese: globo (equatore + meridiano).
  const globe =
    `<circle cx="12" cy="12" r="8.5"/>` +
    `<path d="M3.5 12h17"/>` +
    `<path d="M12 3.5c-3.5 3-3.5 14 0 17"/>` +
    `<path d="M12 3.5c3.5 3 3.5 14 0 17"/>`;

  // --- Connessione diretta: globo barrato.
  const globeOff =
    globe +
    `<path d="M4 4l16 16"/>`;

  // --- Regola "sempre da un altro paese": globo con un segnalibro nell'angolo.
  const globePinned =
    `<circle cx="11" cy="13" r="7.5"/>` +
    `<path d="M3.5 13h15"/>` +
    `<path d="M11 5.5c-3 2.7-3 12.3 0 15"/>` +
    `<path d="M11 5.5c3 2.7 3 12.3 0 15"/>` +
    `<path d="M15.5 3h5v7l-2.5-2-2.5 2z"/>`;

  // --- Comando della finestra: cornice con barra del titolo e due pallini.
  const windowFrame =
    `<rect x="3" y="4.5" width="18" height="15" rx="2"/>` +
    `<path d="M3 9h18"/>` +
    `<path d="M6 6.75h.01"/>` +
    `<path d="M8.5 6.75h.01"/>`;

  // --- Stile della pagina: pennello (manico diagonale + ciuffo).
  const brush =
    `<path d="M20 4c-3.5 1-8 5.5-10 9l1.5 1.5c3.5-2 8-7 8.5-10.5z"/>` +
    `<path d="M9.5 13.5c-1.5 0-2.8.6-3.3 2S5.2 19 3.5 20c2.5.6 5 .4 6.5-1.1s1.5-3 1-4z"/>`;

  // --- Ripristina: freccia che torna indietro.
  const undo =
    `<path d="M4 10h11a5 5 0 0 1 0 10h-4"/>` +
    `<path d="M8 6l-4 4 4 4"/>`;

  // --- PREVISTE: posta letta (busta aperta) e posta inviata (busta + freccia).
  const mailOpen =
    `<path d="M4 9.5l8-5.5 8 5.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/>` +
    `<path d="M4 9.5l8 5.5 8-5.5"/>`;
  const mailSend =
    `<rect x="3" y="5.5" width="15" height="11" rx="1.5"/>` +
    `<path d="M3 7l7.5 5 7.5-5"/>` +
    `<path d="M15 19.5h6"/>` +
    `<path d="M18.5 17l2.5 2.5-2.5 2.5"/>`;

  // --- PREVISTE: leggi la pagina aperta (finestra con righe di testo).
  const readPage =
    `<rect x="3" y="4.5" width="18" height="15" rx="2"/>` +
    `<path d="M3 8.5h18"/>` +
    `<path d="M7 12.5h10"/>` +
    `<path d="M7 16h6"/>`;

  // --- PREVISTE: clicca nella pagina (freccia del puntatore).
  const click =
    `<path d="M5 3.5l6 14.5 2-6 6-2z"/>` +
    `<path d="M13 13l6 6"/>`;

  // --- PREVISTE: scrivi in un campo (casella con il cursore).
  const typeText =
    `<rect x="3" y="7.5" width="18" height="9" rx="2"/>` +
    `<path d="M7 10.5v3"/>`;

  // --- PREVISTE: modifica un file (matita).
  const pencil =
    `<path d="M4 20l4.5-1L19 8.5a2 2 0 0 0-3-3L5.5 15.5z"/>` +
    `<path d="M14 7.5l3 3"/>`;

  // --- PREVISTE: crea un file (foglio con "+").
  const fileNew =
    `<path d="M14 3.5H6v17h12V7.5z"/>` +
    `<path d="M14 3.5v4h4"/>` +
    `<path d="M12 11v6"/>` +
    `<path d="M9 14h6"/>`;

  // --- PREVISTE: allega (graffetta).
  const attach =
    `<path d="M20.5 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/>`;

  // --- PREVISTE: foto / telecamera (corpo con obiettivo).
  const camera =
    `<rect x="3" y="8" width="18" height="12" rx="2"/>` +
    `<path d="M8 8l1.5-2.5h5L16 8"/>` +
    `<circle cx="12" cy="14" r="3.2"/>`;

  // --- PREVISTE: ascolta (microfono).
  const mic =
    `<rect x="9" y="3.5" width="6" height="10" rx="3"/>` +
    `<path d="M6 11.5a6 6 0 0 0 12 0"/>` +
    `<path d="M12 17.5v3"/>` +
    `<path d="M9 20.5h6"/>`;

  // --- PREVISTE: memoria di Filo (cervello a due lobi).
  const memory =
    `<path d="M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1.5 5A3 3 0 0 0 9.5 20c1.3 0 2.5-.8 2.5-2V6a2.5 2.5 0 0 0-2.5-2z"/>` +
    `<path d="M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1.5 5A3 3 0 0 1 14.5 20c-1.3 0-2.5-.8-2.5-2V6a2.5 2.5 0 0 1 2.5-2z"/>`;

  // --- PREVISTE: copia (due fogli sovrapposti).
  const copy =
    `<rect x="9" y="9" width="11" height="11" rx="2"/>` +
    `<path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>`;

  // --- PREVISTE: promemoria / notifica (campanella).
  const bell =
    `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/>` +
    `<path d="M10 20.5a2 2 0 0 0 4 0"/>`;

  // --- PREVISTE: automazione ricorrente (due frecce a ciclo).
  const repeat =
    `<path d="M17 3l3 3-3 3"/>` +
    `<path d="M20 6H8a4 4 0 0 0-4 4v1"/>` +
    `<path d="M7 21l-3-3 3-3"/>` +
    `<path d="M4 18h12a4 4 0 0 0 4-4v-1"/>`;

  // --- PREVISTE: chiede all'utente (cerchio con "?").
  const question =
    `<circle cx="12" cy="12" r="8.5"/>` +
    `<path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/>` +
    `<path d="M12 17h.01"/>`;

  // --- PREVISTE: schede aperte (finestra con la linguetta di una scheda).
  const tabs =
    `<path d="M3 7.5h18v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>` +
    `<path d="M3 7.5V5.5A1.5 1.5 0 0 1 4.5 4h5A1.5 1.5 0 0 1 11 5.5v2"/>` +
    `<path d="M3 11.5h18"/>`;

  // --- PREVISTE: posizione (goccia del segnaposto).
  const location =
    `<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/>` +
    `<circle cx="12" cy="10" r="2.5"/>`;

  // --- PREVISTE: piano di lavoro (elenco puntato).
  const list =
    `<path d="M5 6.5h.01"/>` +
    `<path d="M9 6.5h11"/>` +
    `<path d="M5 12h.01"/>` +
    `<path d="M9 12h11"/>` +
    `<path d="M5 17.5h.01"/>` +
    `<path d="M9 17.5h11"/>`;

  // --- PREVISTE: genera (immagine, testo…): due scintille.
  const sparkles =
    `<path d="M11 3.5l1.8 5.2 5.2 1.8-5.2 1.8L11 17.5l-1.8-5.2L4 10.5l5.2-1.8z"/>` +
    `<path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>`;

  // --- STATI del lavoro: ragionamento (nuvola di pensiero), fatto, avviso, bloccato.
  const reasoning =
    `<path d="M7.5 16.5h9a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 7.3 8.6 4 4 0 0 0 7.5 16.5z"/>` +
    `<path d="M6 18.5h.01"/>` +
    `<path d="M3.5 21h.01"/>`;
  const check =
    `<path d="M4.5 12.5l5 5 10-11"/>`;
  const warning =
    `<path d="M12 3.5l9 16h-18z"/>` +
    `<path d="M12 10v4"/>` +
    `<path d="M12 17h.01"/>`;
  const blocked =
    `<circle cx="12" cy="12" r="8.5"/>` +
    `<path d="M6 6l12 12"/>`;

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
    transparency: (size) => wrap(transparency, { size }),
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
    // --- Azioni dell'agente (la tabella azione → icona è in actionIcons.js)
    openTab:      (size) => wrap(openTab, { size }),
    folder:       (size) => wrap(folder, { size }),
    timer:        (size) => wrap(timer, { size }),
    alarm:        (size) => wrap(alarm, { size }),
    alarmOff:     (size) => wrap(alarmOff, { size }),
    alarmShift:   (size) => wrap(alarmShift, { size }),
    pin:          (size) => wrap(pin, { size }),
    searchWeb:    (size) => wrap(searchWeb, { size }),
    checklist:    (size) => wrap(checklist, { size }),
    clipboard:    (size) => wrap(clipboard, { size }),
    readDocument: (size) => wrap(readDocument, { size }),
    calendar:     (size) => wrap(calendar, { size }),
    broom:        (size) => wrap(broom, { size }),
    trash:        (size) => wrap(trash, { size }),
    eraser:       (size) => wrap(eraser, { size }),
    palette:      (size) => wrap(palette, { size }),
    terminal:     (size) => wrap(terminal, { size }),
    globe:        (size) => wrap(globe, { size }),
    globeOff:     (size) => wrap(globeOff, { size }),
    globePinned:  (size) => wrap(globePinned, { size }),
    windowFrame:  (size) => wrap(windowFrame, { size }),
    brush:        (size) => wrap(brush, { size }),
    undo:         (size) => wrap(undo, { size }),
    mailOpen:     (size) => wrap(mailOpen, { size }),
    mailSend:     (size) => wrap(mailSend, { size }),
    readPage:     (size) => wrap(readPage, { size }),
    click:        (size) => wrap(click, { size }),
    typeText:     (size) => wrap(typeText, { size }),
    pencil:       (size) => wrap(pencil, { size }),
    fileNew:      (size) => wrap(fileNew, { size }),
    attach:       (size) => wrap(attach, { size }),
    camera:       (size) => wrap(camera, { size }),
    mic:          (size) => wrap(mic, { size }),
    memory:       (size) => wrap(memory, { size }),
    copy:         (size) => wrap(copy, { size }),
    bell:         (size) => wrap(bell, { size }),
    repeat:       (size) => wrap(repeat, { size }),
    question:     (size) => wrap(question, { size }),
    tabs:         (size) => wrap(tabs, { size }),
    location:     (size) => wrap(location, { size }),
    list:         (size) => wrap(list, { size }),
    sparkles:     (size) => wrap(sparkles, { size }),
    reasoning:    (size) => wrap(reasoning, { size }),
    check:        (size) => wrap(check, { size }),
    warning:      (size) => wrap(warning, { size }),
    blocked:      (size) => wrap(blocked, { size }),
  };

  // Heuristica che il menu usa per capire se una stringa di "icona" è SVG
  // o un glifo testuale (emoji/carattere).
  function isSvgIcon(s) {
    return typeof s === 'string' && s.charCodeAt(0) === 60 /* '<' */ && s.startsWith('<svg');
  }

  global.SN_ICONS = ICONS;
  global.SN_ICONS_UTIL = { isSvgIcon, wrap };
})(typeof globalThis !== 'undefined' ? globalThis : self);
