// ComputerDriver: le quattro operazioni con cui Filo guarda e tocca le altre applicazioni, uguali per qualunque driver.
// Non lancia mai: senza driver risponde { ok:false, disponibile:false, codice, motivo }. Il valore di un campo password non
// esce mai da qui (al suo posto «campo password»), qualunque cosa mandi il driver. Regole: tests/unit/computerDriver.test.mjs.
'use strict';

const CAMPO_PASSWORD = 'campo password';

// Ruoli dei tre sistemi (UIA, AX senza il prefisso, AT-SPI) nello stesso vocabolario: chi classifica un bersaglio guarda questo.
const RUOLI = {
  pulsante: ['button', 'pushbutton', 'splitbutton', 'togglebutton', 'menubutton', 'disclosuretriangle'],
  campo: ['edit', 'textfield', 'textarea', 'entry', 'passwordtext', 'securetextfield', 'searchfield', 'textbox', 'terminal'],
  casella: ['checkbox', 'checkmenuitem'],
  opzione: ['radiobutton', 'radiomenuitem'],
  collegamento: ['hyperlink', 'link'],
  'voce-menu': ['menuitem'],
  menu: ['menu', 'menubar', 'popupmenu', 'menubaritem'],
  scheda: ['tabitem', 'pagetab', 'tab'],
  'elenco-schede': ['tablist', 'tabgroup', 'pagetablist'],
  'elemento-elenco': ['listitem'],
  elenco: ['list', 'listbox', 'outline'],
  'elemento-albero': ['treeitem', 'outlinerow'],
  albero: ['tree', 'treetable', 'treegrid'],
  tendina: ['combobox', 'popupbutton'],
  cursore: ['slider', 'spinner', 'spinbutton', 'incrementor', 'progressbar', 'progressindicator', 'levelindicator'],
  intestazione: ['headeritem', 'header', 'columnheader', 'rowheader', 'tableheader'],
  cella: ['dataitem', 'cell', 'tablecell', 'gridcell'],
  tabella: ['table', 'datagrid', 'grid'],
  testo: ['text', 'statictext', 'label', 'paragraph', 'heading', 'caption'],
  immagine: ['image', 'icon', 'picture'],
  finestra: ['window', 'frame'],
  dialogo: ['dialog', 'alert', 'sheet', 'filechooser'],
  gruppo: ['group', 'pane', 'panel', 'filler', 'section', 'splitgroup', 'scrollarea', 'scrollpane', 'custom', 'layeredpane', 'form'],
  barra: ['toolbar', 'statusbar', 'titlebar', 'appbar'],
  'barra-scorrimento': ['scrollbar'],
  documento: ['document', 'webarea', 'documentweb', 'documentframe', 'documenttext'],
};
const RUOLO_DI = new Map();
for (const [ruolo, nomi] of Object.entries(RUOLI)) for (const n of nomi) RUOLO_DI.set(n, ruolo);

const chiaveRuolo = (r) => String(r || '').toLowerCase().replace(/^ax/, '').replace(/[\s_-]+/g, '');

function ruoloNormale(grezzo) {
  return RUOLO_DI.get(chiaveRuolo(grezzo)) || 'altro';
}

// I ruoli che sono password per definizione (AT-SPI «password text», AX «AXSecureTextField»).
const RUOLI_PASSWORD = new Set(['passwordtext', 'securetextfield', 'password']);
// UIA non ha un ruolo password e il driver oggi non riporta IsPassword: per un campo si guarda anche nome e valore.
const NOME_PASSWORD = /password|passwort|passwd|passphrase|passcode|\bpass\b|contrase|mot de passe|senha|wachtwoord|parola d.ordine|has[lł]o|heslo|jelsz|şifre|sifre|lösenord|losenord|adgangskode|salasana|пароль|パスワード|密码|密碼|비밀번호|\bpin\b|codice segreto|\bpwd\b/i;
const SOLO_MASCHERA = /^[•●∙·*◦⦁⚫✱⬤]+$/;

/** Vero se il nodo grezzo è un campo password, con qualunque segno lo dica il driver o il campo stesso. */
function ePassword(n) {
  if (!n || typeof n !== 'object') return false;
  if (n.password === true || n.isPassword === true || n.is_password === true || n.IsPassword === true || n.protetto === true) return true;
  if (RUOLI_PASSWORD.has(chiaveRuolo(n.ruolo)) || RUOLI_PASSWORD.has(chiaveRuolo(n.sottoruolo))) return true;
  if (ruoloNormale(n.ruolo) !== 'campo') return false;
  if (typeof n.nome === 'string' && NOME_PASSWORD.test(n.nome)) return true;
  if (typeof n.idAutomazione === 'string' && NOME_PASSWORD.test(n.idAutomazione)) return true;
  return typeof n.valore === 'string' && SOLO_MASCHERA.test(n.valore.trim());
}

const stringa = (v, tetto = 2000) => (typeof v === 'string' && v ? v.slice(0, tetto) : null);
const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function posizione(p) {
  if (!p || typeof p !== 'object') return null;
  const x = numero(p.x), y = numero(p.y), w = numero(p.w ?? p.width), h = numero(p.h ?? p.height);
  return x == null || y == null || w == null || h == null ? null : { x, y, w, h };
}

/** Il nodo come esce da Filo: solo i campi dichiarati, e mai il valore (né un nome ricavato dal valore) di un campo password. */
function nodoNormale(n) {
  const isPassword = ePassword(n);
  const valore = stringa(n.valore);
  let nome = stringa(n.nome, 500);
  // Su Windows il nome di un campo senza etichetta è il suo valore: in un campo password non si mostra.
  if (isPassword && nome && (nome === valore || (valore && nome.includes(valore)) || SOLO_MASCHERA.test(nome.trim()))) nome = null;
  const stato = {};
  if (typeof n.abilitato === 'boolean') stato.abilitato = n.abilitato;
  if (typeof n.selezionato === 'boolean') stato.selezionato = n.selezionato;
  if (typeof n.attivo === 'boolean') stato.attivo = n.attivo;
  return {
    id: stringa(n.id, 200),
    genitore: stringa(n.genitore, 200),
    profondita: Number.isInteger(n.profondita) ? n.profondita : 0,
    ruolo: ruoloNormale(n.ruolo),
    ruoloOriginale: stringa(n.ruolo, 80) || '',
    nome,
    valore: isPassword ? CAMPO_PASSWORD : valore,
    stato,
    posizione: posizione(n.posizione),
    isPassword,
  };
}

// ── Validazione di bersaglio e gesto: la forma la decide Filo, non il driver ───────────────────────────────────────────

function finestraDa(f) {
  if (typeof f === 'string') {
    const m = /^(\d{1,10}):(\d{1,20})$/.exec(f.trim());
    return m ? { pid: Number(m[1]), idFinestra: Number(m[2]) } : null;
  }
  if (f && typeof f === 'object') {
    if (typeof f.id === 'string') return finestraDa(f.id);
    const pid = Number(f.pid), idFinestra = Number(f.idFinestra);
    if (Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(idFinestra) && idFinestra > 0) return { pid, idFinestra };
  }
  return null;
}
const idFinestra = (f) => `${f.pid}:${f.idFinestra}`;

const TETTO_TESTO = 100000;
const MODIFICATORI = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift', maiusc: 'shift', cmd: 'cmd', meta: 'cmd', command: 'cmd', win: 'cmd', super: 'cmd' };
const DIREZIONI = { su: 'up', giu: 'down', giù: 'down', sinistra: 'left', destra: 'right' };
const TASTI_MOUSE = { sinistro: 'left', destro: 'right', centrale: 'middle' };
const punto = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);

/** → { ok:true, gesto } con i campi già nella forma del driver, o { ok:false, motivo }. */
function gestoValido(g) {
  if (!g || typeof g !== 'object') return { ok: false, motivo: 'manca il gesto' };
  switch (g.tipo) {
    case 'clic': {
      const tasto = TASTI_MOUSE[g.tasto || 'sinistro'];
      const volte = g.volte == null ? 1 : Number(g.volte);
      if (!tasto) return { ok: false, motivo: 'il tasto del mouse è sinistro, destro o centrale' };
      if (![1, 2, 3].includes(volte)) return { ok: false, motivo: 'un clic si ripete da una a tre volte' };
      return { ok: true, gesto: { tipo: 'clic', tasto, volte } };
    }
    case 'scrivi': {
      if (typeof g.testo !== 'string' || !g.testo.length) return { ok: false, motivo: 'manca il testo da scrivere' };
      if (g.testo.length > TETTO_TESTO) return { ok: false, motivo: `il testo è di ${g.testo.length} caratteri, il tetto è ${TETTO_TESTO}` };
      return { ok: true, gesto: { tipo: 'scrivi', testo: g.testo } };
    }
    case 'scorri': {
      const direzione = DIREZIONI[g.direzione];
      const quanto = g.quanto == null ? 3 : Number(g.quanto);
      if (!direzione) return { ok: false, motivo: 'si scorre su, giù, a sinistra o a destra' };
      if (!Number.isInteger(quanto) || quanto < 1 || quanto > 50) return { ok: false, motivo: 'si scorre da 1 a 50 righe' };
      return { ok: true, gesto: { tipo: 'scorri', direzione, quanto } };
    }
    case 'tasto': {
      if (typeof g.tasto !== 'string' || !g.tasto.trim() || g.tasto.length > 40) return { ok: false, motivo: 'manca il tasto' };
      const mod = Array.isArray(g.modificatori) ? g.modificatori : [];
      const modificatori = [];
      for (const m of mod) {
        const k = MODIFICATORI[String(m).toLowerCase()];
        if (!k) return { ok: false, motivo: `modificatore sconosciuto: ${String(m).slice(0, 20)}` };
        if (!modificatori.includes(k)) modificatori.push(k);
      }
      return { ok: true, gesto: { tipo: 'tasto', tasto: g.tasto.trim(), modificatori } };
    }
    case 'trascina': {
      const da = punto(g.da), a = punto(g.a);
      if (!da || !a) return { ok: false, motivo: 'un trascinamento vuole il punto di partenza e quello di arrivo' };
      return { ok: true, gesto: { tipo: 'trascina', da, a } };
    }
    default:
      return { ok: false, motivo: 'i gesti sono clic, scrivi, scorri, tasto e trascina' };
  }
}

function bersaglioValido(b, gesto) {
  if (!b || typeof b !== 'object') return { ok: false, motivo: 'manca il bersaglio' };
  const finestra = finestraDa(b.finestra);
  if (!finestra) return { ok: false, motivo: 'il bersaglio vuole la finestra, come la dà windows()' };
  const elemento = typeof b.elemento === 'string' && b.elemento.length <= 200 ? b.elemento : null;
  const p = punto(b);
  if (gesto.tipo === 'clic' && !elemento && !p) return { ok: false, motivo: 'un clic vuole un elemento dell\'albero o un punto' };
  return { ok: true, bersaglio: { finestra, elemento, punto: p } };
}

// ── L'interfaccia ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `disponibile()` → { ok:true, motore } | { ok:false, codice, motivo }: dice se il driver c'è, è acceso e può partire.
 * Il motore fa il lavoro grezzo (finestre, albero, immagine, gesto); qui si valida l'ingresso e si pulisce l'uscita.
 */
function creaComputerDriver({ disponibile, log = () => {} } = {}) {
  async function conMotore(fn) {
    let d;
    try { d = await disponibile(); } catch (e) { d = { ok: false, codice: 'guasto', motivo: 'il driver non risponde' }; log(e); }
    if (!d || !d.ok || !d.motore) {
      return { ok: false, disponibile: false, codice: (d && d.codice) || 'assente', motivo: (d && d.motivo) || 'il driver non è installato' };
    }
    try {
      return await fn(d.motore);
    } catch (e) {
      log(e);
      const giu = e && (e.codice === 'avvio' || e.codice === 'uscito' || e.codice === 'chiuso');
      return {
        ok: false,
        disponibile: !giu,
        codice: giu ? 'non-parte' : (e && e.codice === 'tempo' ? 'tempo' : 'guasto'),
        motivo: giu ? 'il driver non parte' : (e && e.codice === 'tempo' ? 'il driver non ha risposto in tempo' : 'il driver ha risposto in un modo che Filo non capisce'),
      };
    }
  }

  return {
    async windows() {
      return conMotore(async (m) => {
        const grezze = await m.finestre();
        const finestre = [];
        for (const f of Array.isArray(grezze) ? grezze : []) {
          const w = finestraDa(f);
          if (!w) continue;
          finestre.push({
            id: idFinestra(w),
            applicazione: stringa(f.applicazione, 200) || '',
            titolo: stringa(f.titolo, 500) || '',
            pid: w.pid,
            posizione: posizione(f.posizione),
            visibile: f.visibile !== false,
            ridotta: f.ridotta === true,
            livello: Number.isInteger(f.livello) ? f.livello : null,
          });
        }
        return { ok: true, finestre };
      });
    },

    async tree(finestra, opzioni = {}) {
      const w = finestraDa(finestra);
      if (!w) return { ok: false, disponibile: true, codice: 'bersaglio', motivo: 'la finestra si indica con l\'id che dà windows()' };
      const maxNodi = Math.min(5000, Math.max(1, Number(opzioni.maxNodi) || 1500));
      return conMotore(async (m) => {
        const r = await m.albero(w, { maxNodi, cerca: typeof opzioni.cerca === 'string' ? opzioni.cerca.slice(0, 200) : undefined });
        if (!r || !r.ok) return { ok: false, disponibile: true, codice: (r && r.codice) || 'guasto', motivo: (r && r.motivo) || 'albero non leggibile' };
        const nodi = (Array.isArray(r.nodi) ? r.nodi : []).map(nodoNormale);
        return {
          ok: true,
          finestra: {
            id: idFinestra(w),
            applicazione: stringa(r.applicazione, 200) || '',
            titolo: stringa(r.titolo, 500) || '',
            posizione: posizione(r.posizione),
          },
          nodi,
          // Un albero tagliato lo si dice col numero: chi legge sceglie se chiederne di più.
          troncato: r.troncato === true,
          nodiTotali: Number.isInteger(r.totali) ? r.totali : nodi.length,
        };
      });
    },

    async shot(finestra) {
      let w = null;
      if (finestra != null) {
        w = finestraDa(finestra);
        if (!w) return { ok: false, disponibile: true, codice: 'bersaglio', motivo: 'la finestra si indica con l\'id che dà windows()' };
      }
      return conMotore(async (m) => {
        const r = await m.immagine(w);
        if (!r || !r.ok || !Buffer.isBuffer(r.dati) || !r.dati.length) {
          return { ok: false, disponibile: true, codice: (r && r.codice) || 'guasto', motivo: (r && r.motivo) || 'immagine non arrivata' };
        }
        return { ok: true, immagine: r.dati, tipo: r.tipo || 'image/png', larghezza: numero(r.larghezza), altezza: numero(r.altezza) };
      });
    },

    async act(bersaglio, gesto) {
      const g = gestoValido(gesto);
      if (!g.ok) return { ok: false, disponibile: true, codice: 'gesto', motivo: g.motivo };
      const b = bersaglioValido(bersaglio, g.gesto);
      if (!b.ok) return { ok: false, disponibile: true, codice: 'bersaglio', motivo: b.motivo };
      return conMotore(async (m) => {
        const r = await m.gesto(b.bersaglio, g.gesto);
        // Dal driver tornano solo esito e codice: un testo di ritorno potrebbe ripetere quello che si è scritto.
        if (r && r.ok) return { ok: true, effetto: stringa(r.effetto, 40) || 'sconosciuto' };
        return { ok: false, disponibile: true, codice: (r && r.codice) || 'gesto-fallito', motivo: (r && r.motivo) || 'il gesto non è riuscito' };
      });
    },
  };
}

module.exports = { creaComputerDriver, nodoNormale, ePassword, ruoloNormale, finestraDa, gestoValido, CAMPO_PASSWORD };
