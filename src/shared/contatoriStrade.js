// I contatori delle strade (#1468): da quale strada parte ogni azione, i tasti dei browser, le scorciatoie a vuoto, il menu
// nativo, il contesto del tasto destro, indietro e avanti, le pagine di Filo aperte e l'Aiuto. Nomi da elenchi chiusi e
// numeri, mai un testo, un indirizzo, un sito o un tasto scritto. Regole: tests/unit/firestoreRulesContatoriStrade.test.mjs.

(function (global) {
  'use strict';

  // Un documento per pseudonimo e ora, con l'id dell'ora (#1461): le regole dell'ora sono già al tetto di espressioni.
  const VERSIONE = 1;
  const COLLEZIONE = 'contatori-strade';
  const ALTRO = 'altro';

  // ── Gli elenchi chiusi: copie di quelli del codice, tests/unit/contatoriStrade.test.mjs li confronta ──────────
  // Le icone di SN_DISPOSIZIONE_ICONE.ICONE, tranne la finestra in incognito: da quale strada parte non esce.
  const ICONE = Object.freeze(['help', 'translate', 'screenshot', 'screenshotCrop', 'transcribe', 'share', 'saveForLater',
    'qrCode', 'colorPicker', 'fullscreen', 'back', 'forward', 'reload', 'closeTab', 'newTab', 'openOptions', 'home',
    'editorApp', 'feedbackApp']);
  const NON_CONTATE = Object.freeze(['incognito']);
  // Le quattro di SN_TASTI.AZIONI_FILO: Salva per dopo e Aiuto hanno anche un'icona, e una cosa sola ha un nome solo.
  const AZIONI_FILO = Object.freeze(['explain-selection', 'translate-selection', 'save-for-later', 'open-help-sidebar']);
  const STESSA_DI = Object.freeze({ 'save-for-later': 'saveForLater', 'open-help-sidebar': 'help' });
  // I versi dello zoom di SN_ZOOM.VERSI.
  const ZOOM = Object.freeze({ in: 'zoom_piu', out: 'zoom_meno', reset: 'zoom_reset' });
  const AZIONI = Object.freeze([...ICONE, ...AZIONI_FILO.filter((a) => !STESSA_DI[a]), ...Object.values(ZOOM), 'barra_laterale', ALTRO]);
  // «tasto_destro_riga»: la riga di icone del tasto destro, che non c'è più (#1246); «tasto_destro_altro»: una voce del box.
  const VIE_AZIONE = Object.freeze(['scorciatoia', 'barra', 'tasto_destro_riga', 'tasto_destro_altro', 'menu_scheda',
    'menu_app', 'pulsante_scheda', 'clic_centrale', 'tasto_mouse', 'swipe', 'comando_slash', 'carta_home', 'chat']);

  // I tasti di chi arriva da un altro browser, per nome: mai il tasto premuto.
  const TASTI = Object.freeze(['ctrl_t', 'ctrl_shift_t', 'ctrl_w', 'ctrl_l', 'ctrl_r', 'salto_scheda', 'alt_freccia',
    'ctrl_tab', 'ctrl_shift_tab', 'ctrl_h', 'ctrl_j', 'ctrl_d', 'ctrl_f', 'f5', 'f6', 'f11']);
  // Ctrl/Cmd+Shift+T che dà una scheda chiusa subito senza navigare, Ctrl/Cmd+L che porta alla home lasciata senza scrivere.
  const MANCATA = 'aspettativa_mancata';
  const MANCATE = Object.freeze(['ctrl_shift_t', 'ctrl_l']);
  const MANCATA_MS = 10 * 1000;
  // Ctrl o Cmd con una lettera, senza Alt (AltGr scrive); la lettera senza Shift, salvo T e Tab.
  const LETTERE = Object.freeze({ t: 'ctrl_t', w: 'ctrl_w', l: 'ctrl_l', r: 'ctrl_r', h: 'ctrl_h', j: 'ctrl_j', d: 'ctrl_d', f: 'ctrl_f' });
  const FUNZIONE = Object.freeze({ F5: 'f5', F6: 'f6', F11: 'f11' });

  // Il toast di «nessuna selezione» lo conta già #1461 (avviso:err_no_selection): qui solo le scorciatoie mute.
  const MOTIVI_A_VUOTO = Object.freeze(['pagina_interna', 'avviso_sito', 'filo_spento_sul_sito']);

  const VOCI_NATIVO = Object.freeze(['shift_tasto_destro', 'menu_del_sito:voce', 'menu_del_sito:sempre_acceso',
    'menu_del_sito:sempre_spento']);

  // «pagina»: nessun'altra bandiera; «livelli»: l'elemento trovato sotto un altro che lo copre.
  const BANDIERE = Object.freeze(['selezione', 'collegamento', 'immagine', 'media', 'campo', 'livelli', 'pagina', 'avviso', 'file']);
  const SOLE = Object.freeze(['pagina', 'avviso', 'file']);
  const COMBINAZIONI = Object.freeze(['selezione+collegamento', 'selezione+campo', 'collegamento+immagine',
    'collegamento+livelli', 'immagine+livelli', 'media+livelli', 'collegamento+immagine+livelli']);
  const MISTO = 'misto';

  const VERSI = Object.freeze(['indietro', 'avanti']);
  // «barra_lista»: il tasto destro su Indietro o Avanti della barra laterale, poi una pagina dell'elenco.
  const VIE_CRONOLOGIA = Object.freeze(['alt_freccia', 'tasto_mouse', 'swipe', 'barra', 'barra_lista', 'tasto_destro_riga', 'menu_app']);
  const LISTA = 'barra_lista';
  // L'elenco mostra al più 15 pagine (PAGINE_NEL_MENU in src/main/barraLaterale.js).
  const FASCE_LISTA = Object.freeze([['p1', 1], ['p2_3', 3], ['p4_6', 6], ['p7_15', 15]]);
  // Ogni via della cronologia, com'è fra le strade di un'azione: l'elenco non è una scorciatoia di Indietro.
  const AZIONE_DELLA_VIA = Object.freeze({
    alt_freccia: 'scorciatoia', tasto_mouse: 'tasto_mouse', swipe: 'swipe', barra: 'barra', tasto_destro_riga: 'tasto_destro_riga', menu_app: 'menu_app',
  });

  // Le chiavi di FILO_TAB_LABELS (src/renderer/shell.js) e le pagine in più del feedback; ogni altra pagina è «altro».
  const ETICHETTE = Object.freeze(['newtab', 'options/options.html', 'options/altro.html', 'security/security.html',
    'preferences/preferences.html', 'editor/editor.html', 'feedback/feedback.html', 'history/history.html',
    'quaderno/quaderno.html', 'home/home.html', 'spellcheck/spellcheck.html']);
  const IN_PIU = Object.freeze(['archive', 'credits', 'board', 'decks', 'downloads', 'transparency']);
  const idDellaChiave = (k) => {
    const [host, file] = String(k).split('/');
    return !file || file === `${host}.html` ? host : `${host}_${file.replace(/\.html$/, '')}`;
  };
  const PAGINE = Object.freeze([...ETICHETTE.map(idDellaChiave), ...IN_PIU, ALTRO]);
  const VIE_PAGINA = Object.freeze(['barra', 'menu_app', 'comando_slash', 'carta_home', 'collegamento_interno', 'chat', 'sessione_ripristinata']);
  // Le pagine che un'icona della barra apre: aprirle da un'altra strada è la stessa azione.
  const AZIONE_DELLA_PAGINA = Object.freeze({ options: 'openOptions', editor: 'editorApp', feedback: 'feedbackApp', newtab: 'newTab' });
  const VISTA = 'vista';
  // Le fasce dei contatori dell'ora (SN_CONTATORI.FASCE): sotto i 2 s non era la pagina cercata.
  const FASCE_VISTA = Object.freeze([
    ['ms500', 500], ['s1', 1000], ['s2', 2000], ['s5', 5000], ['s10', 10000], ['s30', 30000], ['oltre', Infinity],
  ]);
  // Il tempo in vista vale per la pagina che arriva davanti entro questo tempo dall'apertura.
  const APERTURA_MS = 3000;

  const VIE_AIUTO = Object.freeze(['scorciatoia', 'tasto_destro', 'menu_scheda', 'menu_app', 'avviso_sito', 'barra', 'chat']);

  const MAX_CONTO = 999999999;
  const nomi = (fasce) => Object.freeze(fasce.map(([k]) => k));
  const intero = (n) => Number.isInteger(n) && n >= 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const conto = (n) => (intero(n) ? Math.min(n, MAX_CONTO) : 0);
  const testo = (v) => (typeof v === 'string' ? v : '');

  function fasciaIn(fasce, v) {
    const n = Number(v);
    if (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(n) || n < 0) return '';
    const f = fasce.find(([, fino]) => n <= fino);
    return f ? f[0] : '';
  }

  // ── Da un nome a una chiave dell'elenco ─────────────────────────────
  // Un id fuori elenco esce come «altro»; l'incognito non esce per niente.
  function azioneDi(id) {
    const a = testo(id);
    if (!a || NON_CONTATE.includes(a)) return '';
    const b = STESSA_DI[a] || a;
    return AZIONI.includes(b) ? b : ALTRO;
  }
  function chiaveAzione(id, via) {
    const a = azioneDi(id);
    return a && VIE_AZIONE.includes(via) ? `${a}:${via}` : '';
  }

  // L'input di `before-input-event` (Electron) o un KeyboardEvent: il nome del tasto, o '' per tutto il resto. Un tasto
  // tenuto premuto non conta; uno senza Ctrl/Cmd, che non sia un tasto funzione, non esce mai.
  function tastoDaBrowser(input, piattaforma) {
    const T = global.SN_TASTI;
    const i = input || {};
    if (i.type && !/^(keyDown|rawKeyDown|keydown)$/.test(i.type)) return '';
    if (i.isAutoRepeat || i.repeat) return '';
    const key = testo(i.key);
    const code = testo(i.code);
    if (has(FUNZIONE, key)) return FUNZIONE[key];
    const ctrl = !!(i.control || i.ctrlKey || i.meta || i.metaKey);
    const alt = !!(i.alt || i.altKey);
    const shift = !!(i.shift || i.shiftKey);
    // Cmd+freccia su Mac muove il cursore nei campi: la conta chi la vede tornare dalla pagina inusata.
    if (T && typeof T.comandoNavigazione === 'function' && T.comandoNavigazione(i, piattaforma)) return 'alt_freccia';
    if (!ctrl || alt) return '';
    if (key === 'Tab' || code === 'Tab') return shift ? 'ctrl_shift_tab' : 'ctrl_tab';
    if (!shift && (/^[1-9]$/.test(key) || /^Digit[1-9]$/.test(code))) return 'salto_scheda';
    const lettera = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : key.toLowerCase();
    if (lettera === 't') return shift ? 'ctrl_shift_t' : 'ctrl_t';
    return !shift && has(LETTERE, lettera) ? LETTERE[lettera] : '';
  }

  function chiaveVuoto(comando, motivo) {
    return AZIONI_FILO.includes(comando) && MOTIVI_A_VUOTO.includes(motivo) ? `${comando}:${motivo}` : '';
  }

  // `bandiere`: un elenco o un oggetto { selezione: true, … }. Fuori dalle sette combinazioni dichiarate è «misto».
  function chiaveContesto(bandiere) {
    const l = Array.isArray(bandiere) ? bandiere : oggetto(bandiere) ? Object.keys(bandiere).filter((k) => bandiere[k]) : [];
    const su = BANDIERE.filter((b) => l.includes(b));
    if (!su.length) return '';
    const resto = su.filter((b) => b !== 'pagina');
    if (!resto.length) return 'pagina';
    if (resto.length === 1) return resto[0];
    if (resto.some((b) => SOLE.includes(b))) return MISTO;
    const k = resto.join('+');
    return COMBINAZIONI.includes(k) ? k : MISTO;
  }

  // `posizione` da 1, solo per l'elenco della barra.
  function chiaveCronologia(verso, via, posizione) {
    if (!VERSI.includes(verso) || !VIE_CRONOLOGIA.includes(via)) return '';
    if (via !== LISTA) return `${verso}:${via}`;
    const f = Number(posizione) >= 1 ? fasciaIn(FASCE_LISTA, posizione) : '';
    return f ? `${verso}:${LISTA}:${f}` : '';
  }

  // L'indirizzo di una pagina di Filo → il suo nome nell'elenco; '' per tutto quello che non è filo://.
  // Senza file è <host>/<host>.html, come lo carica il protocollo: filo://preferences/ sono le Preferenze.
  function paginaDi(url) {
    const m = /^filo:\/\/([a-z0-9_-]+)\/?([^?#]*)/i.exec(testo(url));
    if (!m) return '';
    const host = m[1].toLowerCase();
    const file = m[2].replace(/\/+$/, '').toLowerCase() || `${host}.html`;
    const chiave = `${host}/${file}`;
    if (ETICHETTE.includes(chiave)) return idDellaChiave(chiave);
    if (ETICHETTE.includes(host) || IN_PIU.includes(host)) return host;
    return ALTRO;
  }
  function chiavePagina(url, via) {
    const p = paginaDi(url);
    return p && VIE_PAGINA.includes(via) ? `${p}:${via}` : '';
  }
  function chiaveVista(pagina, ms) {
    const f = PAGINE.includes(pagina) ? fasciaIn(FASCE_VISTA, ms) : '';
    return f ? `${VISTA}:${pagina}:${f}` : '';
  }

  // ── Le chiavi di ogni misura: l'elenco chiuso intero, e la forma che ne tengono le regole ──────────────────────
  const prodotto = (...liste) => liste.reduce((acc, l) => acc.flatMap((a) => l.map((b) => (a ? `${a}:${b}` : b))), ['']);
  const MAPPE = Object.freeze(['via_azione', 'tasto_da_browser', 'scorciatoia_a_vuoto', 'menu_nativo_scelto', 'contesto_box',
    'navigazione_cronologia', 'pagina_di_filo_aperta', 'aiuto_aperto']);
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', ...MAPPE]);
  const SENZA_LISTA = Object.freeze(VIE_CRONOLOGIA.filter((v) => v !== LISTA));

  function chiaviDi(campo) {
    switch (campo) {
      case 'via_azione': return prodotto(AZIONI, VIE_AZIONE);
      case 'tasto_da_browser': return [...TASTI, ...prodotto([MANCATA], MANCATE)];
      case 'scorciatoia_a_vuoto': return prodotto(AZIONI_FILO, MOTIVI_A_VUOTO);
      case 'menu_nativo_scelto': return [...VOCI_NATIVO];
      case 'contesto_box': return [...BANDIERE, ...COMBINAZIONI, MISTO];
      case 'navigazione_cronologia': return [...prodotto(VERSI, SENZA_LISTA), ...prodotto(VERSI, [LISTA], nomi(FASCE_LISTA))];
      case 'pagina_di_filo_aperta': return [...prodotto(PAGINE, VIE_PAGINA), ...prodotto([VISTA], PAGINE, nomi(FASCE_VISTA))];
      case 'aiuto_aperto': return [...VIE_AIUTO];
      default: return [];
    }
  }

  // Le regole confrontano stringhe: il trattino e il più si scrivono come classi, così nessun nome diventa un operatore.
  const esc = (s) => String(s).replace(/[-+]/g, (c) => `[${c}]`);
  const alternative = (l) => `(${l.map(esc).join('|')})`;
  const CHIAVI_FORMA = Object.freeze({
    via_azione: `${alternative(AZIONI)}[:]${alternative(VIE_AZIONE)}`,
    tasto_da_browser: `(${alternative(TASTI)}|${MANCATA}[:]${alternative(MANCATE)})`,
    scorciatoia_a_vuoto: `${alternative(AZIONI_FILO)}[:]${alternative(MOTIVI_A_VUOTO)}`,
    menu_nativo_scelto: alternative(VOCI_NATIVO).replace(/:/g, '[:]'),
    contesto_box: alternative([...BANDIERE, ...COMBINAZIONI, MISTO]),
    navigazione_cronologia: `${alternative(VERSI)}[:](${alternative(SENZA_LISTA)}|${LISTA}[:]${alternative(nomi(FASCE_LISTA))})`,
    pagina_di_filo_aperta: `(${alternative(PAGINE)}[:]${alternative(VIE_PAGINA)}|${VISTA}[:]${alternative(PAGINE)}[:]${alternative(nomi(FASCE_VISTA))})`,
    aiuto_aperto: alternative(VIE_AIUTO),
  });
  const unite = (voce) => `^(${voce}(#${voce})*)?$`;
  const FORME = Object.freeze({
    CHIAVI: Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, unite(CHIAVI_FORMA[c])]))),
    CONTI: unite('[0-9]{1,9}'),
  });
  // I tetti di caratteri delle chiavi unite e dei conti uniti, per misura: almeno il doppio dell'elenco intero di oggi.
  const TETTI = Object.freeze({
    via_azione: [16000, 7000], tasto_da_browser: [500, 400], scorciatoia_a_vuoto: [1000, 300], menu_nativo_scelto: [200, 100],
    contesto_box: [500, 400], navigazione_cronologia: [1000, 400], pagina_di_filo_aperta: [11000, 5500], aiuto_aperto: [200, 150],
  });

  // ── L'ora, in memoria ─────────────────────────────────────────────────
  // Sta nell'ora dei contatori sotto `strade`: i suoi conti hanno già la chiave che esce.
  function vuota() {
    return Object.fromEntries(MAPPE.map((c) => [c, {}]));
  }
  function dati(ora) {
    if (!oggetto(ora)) return vuota();
    if (!oggetto(ora.strade)) ora.strade = vuota();
    const d = ora.strade;
    for (const c of MAPPE) if (!oggetto(d[c])) d[c] = {};
    return d;
  }
  function piuUno(ora, campo, chiave) {
    if (!chiave || !chiaviDi(campo).includes(chiave)) return false;
    const m = dati(ora)[campo];
    m[chiave] = conto(m[chiave]) + 1;
    return true;
  }

  const registraAzione = (ora, id, via) => piuUno(ora, 'via_azione', chiaveAzione(id, via));
  const registraTasto = (ora, id) => (TASTI.includes(id) ? piuUno(ora, 'tasto_da_browser', id) : false);
  const registraMancata = (ora, id) => (MANCATE.includes(id) ? piuUno(ora, 'tasto_da_browser', `${MANCATA}:${id}`) : false);
  const registraVuoto = (ora, comando, motivo) => piuUno(ora, 'scorciatoia_a_vuoto', chiaveVuoto(comando, motivo));
  const registraNativo = (ora, voce) => (VOCI_NATIVO.includes(voce) ? piuUno(ora, 'menu_nativo_scelto', voce) : false);
  const registraContesto = (ora, bandiere) => piuUno(ora, 'contesto_box', chiaveContesto(bandiere));
  const registraCronologia = (ora, verso, via, posizione) => piuUno(ora, 'navigazione_cronologia', chiaveCronologia(verso, via, posizione));
  const registraPagina = (ora, url, via) => piuUno(ora, 'pagina_di_filo_aperta', chiavePagina(url, via));
  const registraVista = (ora, pagina, ms) => piuUno(ora, 'pagina_di_filo_aperta', chiaveVista(pagina, ms));
  const registraAiuto = (ora, via) => (VIE_AIUTO.includes(via) ? piuUno(ora, 'aiuto_aperto', via) : false);

  // ── Il documento che esce: ricostruito dagli elenchi chiusi, mai copiato ───────────────────────────────────
  function contiPuliti(mappa, ammesse) {
    const out = {};
    for (const k of ammesse) {
      const n = oggetto(mappa) && has(mappa, k) ? mappa[k] : 0;
      if (intero(n) && n > 0) out[k] = String(conto(n));
    }
    return out;
  }

  // `dati`: l'ora dei contatori com'è sul disco.
  function documento({ pseudonimo, chiave, app, os, dati: ora }) {
    const C = global.SN_CONTATORI;
    const grezzo = oggetto(ora) && oggetto(ora.strade) ? JSON.parse(JSON.stringify(ora.strade)) : {};
    const d = dati({ strade: grezzo });
    const [giorno, h] = String(chiave || '').split('T');
    const doc = {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: String(giorno || '').slice(0, 7),
      ora: String(h || ''),
      app: C ? C.versioneApp(app) : String(app || ''),
      os: C && C.OS.includes(os) ? os : 'altro',
    };
    for (const c of MAPPE) doc[c] = contiPuliti(d[c], chiaviDi(c));
    return doc;
  }
  // Un'ora senza niente di questi contatori non ha il suo documento.
  function senzaDati(doc) {
    return !doc || MAPPE.every((c) => !oggetto(doc[c]) || !Object.keys(doc[c]).length);
  }

  // La forma che chiedono le regole, e in più le chiavi dell'elenco chiuso intero.
  function valida(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    const C = global.SN_CONTATORI;
    if (!oggetto(doc)) return no('non è un documento');
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI.length || !CAMPI.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE) return no('versione');
    if (!C) return no('contatori non caricati');
    if (!C.PSEUDONIMO_RE.test(String(doc.pseudonimo))) return no('pseudonimo');
    if (!C.GIORNO_RE.test(String(doc.giorno)) || doc.mese !== String(doc.giorno).slice(0, 7)) return no('giorno');
    if (!C.ORA_RE.test(String(doc.ora))) return no('ora');
    if (!C.APP_RE.test(String(doc.app))) return no('versione dell\'app');
    if (!C.OS.includes(doc.os)) return no('sistema');
    const conti = new RegExp(FORME.CONTI);
    for (const c of MAPPE) {
      const m = doc[c];
      if (!oggetto(m)) return no(c);
      const ammesse = new Set(chiaviDi(c));
      const ks = Object.keys(m);
      if (ks.some((k) => !ammesse.has(k))) return no(`${c}: chiave fuori elenco`);
      const vs = Object.values(m);
      if (!vs.every((v) => typeof v === 'string')) return no(`${c}: valori`);
      const [tk, tv] = TETTI[c];
      if (ks.join('#').length > tk || vs.join('#').length > tv) return no(`${c}: oltre il tetto`);
      if (!new RegExp(FORME.CHIAVI[c]).test(ks.join('#')) || !conti.test(vs.join('#'))) return no(`${c}: forma`);
    }
    return { ok: true, motivo: '' };
  }

  global.SN_CONTATORI_STRADE = {
    VERSIONE, COLLEZIONE, ALTRO, CAMPI, MAPPE, FORME, TETTI, CHIAVI_FORMA,
    ICONE, NON_CONTATE, AZIONI_FILO, STESSA_DI, ZOOM, AZIONI, VIE_AZIONE, TASTI, MANCATA, MANCATE, MANCATA_MS, MOTIVI_A_VUOTO,
    VOCI_NATIVO, BANDIERE, COMBINAZIONI, MISTO, VERSI, VIE_CRONOLOGIA, FASCE_LISTA, AZIONE_DELLA_VIA, ETICHETTE, IN_PIU,
    PAGINE, VIE_PAGINA, AZIONE_DELLA_PAGINA, FASCE_VISTA, APERTURA_MS, VIE_AIUTO,
    fasciaIn, azioneDi, chiaveAzione, tastoDaBrowser, chiaveVuoto, chiaveContesto, chiaveCronologia, paginaDi, chiavePagina,
    chiaveVista, chiaviDi, vuota, dati,
    registraAzione, registraTasto, registraMancata, registraVuoto, registraNativo, registraContesto, registraCronologia,
    registraPagina, registraVista, registraAiuto,
    documento, senzaDati, valida,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
