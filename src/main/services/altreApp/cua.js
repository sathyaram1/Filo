// Il motore del ComputerDriver sul Cua Driver: `cua-driver mcp --direct`, figlio del main, parlato in MCP su stdio.
// Chiama solo gli strumenti dell'elenco qui sotto (mai shell, appunti, processi, estensioni) e consegna i gesti in
// background: quando il driver risponde che serve il primo piano, l'esito torna a chi chiama e Filo non insiste da sé.
'use strict';

const Mcp = require('./mcp');

const STRUMENTI_AMMESSI = new Set([
  'list_windows', 'get_window_state', 'get_desktop_state', 'check_permissions',
  'click', 'right_click', 'double_click', 'type_text', 'scroll', 'press_key', 'hotkey', 'drag',
]);
// Senza questi il ponte non sta in piedi: una versione che non li ha si dichiara rotta, non si usa a metà.
const STRUMENTI_NECESSARI = ['list_windows', 'get_window_state', 'click', 'type_text', 'scroll', 'press_key', 'drag'];

// Il driver da solo manderebbe statistiche d'uso e chiederebbe a GitHub se c'è una versione nuova: la versione la fissa
// Filo, e del suo uso a fuori non esce niente. Su Mac resta dentro i permessi di Filo, senza un'identità sua.
const AMBIENTE_FILO = {
  DO_NOT_TRACK: '1',
  CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
  CUA_TELEMETRY_ENABLED: 'false',
  CUA_DRIVER_RS_UPDATE_CHECK: '0',
  CUA_DRIVER_EMBEDDED: '1',
  CUA_DRIVER_PERMISSION_MODE: 'standard',
};
// Le chiavi e i segreti dell'ambiente di Filo non servono a un programma di terzi.
const VARIABILI_TOLTE = /(API_?KEY|TOKEN|SECRET|PASSW|CREDENTIAL|PRIVKEY|^FILO_|^ELECTRON_|^NODE_OPTIONS$|^OPENROUTER|^ANTHROPIC|^OPENAI|^GH_|^GITHUB_|^NPM_)/i;

function ambiente(base = process.env, idApp = '') {
  const out = {};
  for (const [k, v] of Object.entries(base || {})) if (!VARIABILI_TOLTE.test(k)) out[k] = v;
  return { ...out, ...AMBIENTE_FILO, ...(idApp ? { CUA_DRIVER_HOST_BUNDLE_ID: idApp } : {}) };
}

const INATTIVO_MS = 2 * 60 * 1000;

function strutturato(r) {
  if (r && r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
  // Le versioni che non danno il blocco strutturato lo scrivono come JSON nel primo testo.
  const t = r && Array.isArray(r.content) ? r.content.find((c) => c && c.type === 'text') : null;
  if (t && typeof t.text === 'string' && t.text.trim().startsWith('{')) { try { return JSON.parse(t.text); } catch (_) {} }
  return {};
}

/** I campi che lo schema dello strumento dichiara; null se ne manca uno obbligatorio. */
function argomenti(schema, voluti) {
  const props = schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : null;
  const out = {};
  for (const [k, v] of Object.entries(voluti)) {
    if (v === undefined || v === null) continue;
    if (!props || Object.prototype.hasOwnProperty.call(props, k)) out[k] = v;
  }
  const richiesti = schema && Array.isArray(schema.required) ? schema.required : [];
  return richiesti.every((k) => k in out) ? out : null;
}

const haCampo = (schema, k) => !!(schema && schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, k));

/** Dal risultato di un'azione: serve il primo piano? Il driver lo dice col codice o con la scala che consiglia. */
function chiedePrimoPiano(s) {
  const esc = s && s.escalation;
  if (esc && (esc.recommended === 'foreground' || esc.target === 'foreground')) return true;
  return typeof s.code === 'string' && /^background_/.test(s.code);
}

function esitoAzione(r) {
  const s = strutturato(r);
  const errore = (s && s.error && typeof s.error === 'object') ? s.error : null;
  if (chiedePrimoPiano(s)) {
    return { ok: false, codice: 'serve-primo-piano', motivo: 'l\'applicazione non accetta questo gesto senza venire in primo piano' };
  }
  if (r && r.isError) {
    const codice = String((errore && errore.code) || s.code || '').slice(0, 60);
    if (codice === 'permission_required' || (s.escalation && s.escalation.reason === 'permission_required')) {
      return { ok: false, codice: 'permessi', motivo: 'il sistema non dà ancora a Filo il permesso di agire sulle finestre' };
    }
    return { ok: false, codice: 'gesto-fallito', motivo: codice ? `il driver ha rifiutato il gesto (${codice})` : 'il driver ha rifiutato il gesto' };
  }
  if (s.effect === 'refused') return { ok: false, codice: 'gesto-fallito', motivo: 'il driver ha rifiutato il gesto' };
  return { ok: true, effetto: typeof s.effect === 'string' ? s.effect : (s.verified === true ? 'confirmed' : 'sconosciuto') };
}

/**
 * `eseguibile()` → percorso del cua-driver installato, o null. `avvia` è Mcp.avvia (nelle prove un server finto).
 * La connessione nasce alla prima richiesta e si chiude dopo due minuti senza richieste.
 */
function creaMotoreCua({ eseguibile, avvia = Mcp.avvia, ambienteBase = process.env, idApp, versioneFilo = '0', log = () => {}, inattivoMs = INATTIVO_MS } = {}) {
  let connessione = null;
  let inArrivo = null;
  let timer = null;

  function riarma() {
    clearTimeout(timer);
    timer = setTimeout(() => ferma(), inattivoMs);
    if (timer.unref) timer.unref();
  }

  async function collega() {
    if (connessione && connessione.vivo()) { riarma(); return connessione; }
    if (inArrivo) return inArrivo;
    const exe = eseguibile();
    if (!exe) throw new Mcp.ErroreMcp('avvio', 'driver non installato');
    const path = require('path');
    inArrivo = avvia({
      comando: exe,
      argomenti: ['mcp', '--direct'],
      cwd: path.dirname(exe),
      env: ambiente(ambienteBase, idApp),
      cliente: { name: 'Filo', version: String(versioneFilo) },
    }).then((c) => {
      connessione = c;
      c.suUscita((e) => {
        if (connessione === c) connessione = null;
        if (e && e.codice !== 'chiuso') log(`[altreApp] il driver si è chiuso: ${e.message}${c.stderr() ? ` — ${c.stderr().slice(-500)}` : ''}`);
      });
      riarma();
      return c;
    }).finally(() => { inArrivo = null; });
    return inArrivo;
  }

  async function chiama(nome, voluti, tempoMs) {
    if (!STRUMENTI_AMMESSI.has(nome)) throw new Error(`strumento non ammesso: ${nome}`);
    const c = await collega();
    if (!c.strumenti.has(nome)) return { assente: true };
    const args = argomenti(c.strumenti.get(nome), voluti);
    if (!args) return { assente: true };
    const r = await c.chiama(nome, args, tempoMs);
    riarma();
    return r;
  }

  function ferma() {
    clearTimeout(timer);
    const c = connessione;
    connessione = null;
    if (c) c.chiudi();
  }

  async function prova() {
    const c = await collega();
    const mancano = STRUMENTI_NECESSARI.filter((n) => !c.strumenti.has(n));
    if (mancano.length) return { ok: false, codice: 'non-parte', motivo: `il driver non offre ${mancano.join(', ')}` };
    // Su Linux il driver sa dire se il desktop espone l'accessibilità: senza, gli alberi tornano vuoti.
    const mancanti = [];
    if (c.strumenti.has('check_permissions') && process.platform === 'linux') {
      try {
        const s = strutturato(await c.chiama('check_permissions', {}, 15000));
        if (s.atspi === false) mancanti.push('atspi');
        if (s.x11 === false && !(s.wayland && s.wayland_enabled)) mancanti.push('display');
      } catch (_) {}
    }
    return { ok: true, mancanti };
  }

  return {
    prova,
    ferma,
    attivo: () => !!(connessione && connessione.vivo()),

    async finestre() {
      const r = await chiama('list_windows', {});
      if (r.assente) throw new Mcp.ErroreMcp('protocollo', 'list_windows non disponibile');
      const s = strutturato(r);
      return (Array.isArray(s.windows) ? s.windows : []).map((w) => ({
        pid: w.pid,
        idFinestra: w.window_id,
        applicazione: w.app_name,
        titolo: w.title,
        posizione: w.bounds,
        visibile: w.is_on_screen !== false,
        ridotta: w.minimized === true,
        livello: Number.isInteger(w.z_index) ? w.z_index : null,
      }));
    },

    async albero(f, { maxNodi, cerca } = {}) {
      const r = await chiama('get_window_state', {
        pid: f.pid,
        window_id: f.idFinestra,
        include_screenshot: false,
        include_accessibility_tree: true,
        tree_format: 'elements',
        max_elements: maxNodi,
        timeout_ms: 5000,
        query: cerca,
      }, 60000);
      if (r.assente) return { ok: false, codice: 'guasto', motivo: 'il driver non sa leggere l\'albero' };
      const s = strutturato(r);
      if (r.isError) return { ok: false, codice: 'finestra', motivo: 'la finestra non c\'è più o non si lascia leggere' };
      if (!Array.isArray(s.elements)) return { ok: false, codice: 'guasto', motivo: 'il driver non ha mandato l\'albero' };
      const perIndice = new Map();
      for (const e of s.elements) if (e && Number.isInteger(e.element_index)) perIndice.set(e.element_index, e);
      const idDi = (e) => (e ? (typeof e.element_token === 'string' && e.element_token) || (Number.isInteger(e.element_index) ? `#${e.element_index}` : null) : null);
      const nodi = s.elements.filter((e) => e && typeof e === 'object').map((e) => ({
        id: idDi(e),
        genitore: Number.isInteger(e.parent_index) ? idDi(perIndice.get(e.parent_index)) || `#${e.parent_index}` : null,
        profondita: e.depth,
        ruolo: e.role,
        sottoruolo: e.subrole,
        nome: e.label,
        valore: e.value,
        idAutomazione: e.automation_id || e.identifier,
        abilitato: e.enabled,
        selezionato: e.selected,
        posizione: e.frame,
        password: e.is_password === true || e.isPassword === true || e.protected === true,
      }));
      return {
        ok: true,
        applicazione: s.app_name,
        titolo: s.window_title,
        posizione: s.window_bounds,
        nodi,
        troncato: s.truncated === true || s.elements_complete === false,
        totali: Number.isInteger(s.total_element_count) ? s.total_element_count : undefined,
      };
    },

    async immagine(f) {
      const r = f
        ? await chiama('get_window_state', { pid: f.pid, window_id: f.idFinestra, include_screenshot: true, include_accessibility_tree: false }, 60000)
        : await chiama('get_desktop_state', {}, 60000);
      if (r.assente) return { ok: false, codice: 'guasto', motivo: 'il driver non sa fotografare' };
      if (r.isError) return { ok: false, codice: 'finestra', motivo: 'la finestra non c\'è più o non si lascia fotografare' };
      const img = Array.isArray(r.content) ? r.content.find((c) => c && c.type === 'image' && typeof c.data === 'string') : null;
      if (!img) return { ok: false, codice: 'guasto', motivo: 'il driver non ha mandato l\'immagine' };
      const s = strutturato(r);
      return {
        ok: true,
        dati: Buffer.from(img.data, 'base64'),
        tipo: img.mimeType || s.screenshot_mime_type || 'image/png',
        larghezza: s.screenshot_width,
        altezza: s.screenshot_height,
      };
    },

    async gesto(b, g) {
      const base = { pid: b.finestra.pid, window_id: b.finestra.idFinestra, element_token: b.elemento || undefined };
      const xy = b.punto ? { x: b.punto.x, y: b.punto.y } : {};
      const sfondo = (nome) => (connessione && haCampo(connessione.strumenti.get(nome), 'delivery_mode') ? { delivery_mode: 'background' } : {});
      let r;
      if (g.tipo === 'clic') {
        const c = await collega();
        const schema = c.strumenti.get('click');
        if (g.tasto === 'left' && g.volte === 1) r = await chiama('click', { ...base, ...xy, ...sfondo('click') });
        else if (haCampo(schema, 'button') || haCampo(schema, 'count')) {
          if (g.tasto !== 'left' && !haCampo(schema, 'button')) r = { assente: true };
          else if (g.volte !== 1 && !haCampo(schema, 'count')) r = { assente: true };
          else r = await chiama('click', { ...base, ...xy, ...sfondo('click'), button: g.tasto !== 'left' ? g.tasto : undefined, count: g.volte !== 1 ? g.volte : undefined });
        } else if (g.tasto === 'right' && g.volte === 1) r = await chiama('right_click', { ...base, ...xy, ...sfondo('right_click') });
        else if (g.tasto === 'left' && g.volte === 2) r = await chiama('double_click', { ...base, ...xy, ...sfondo('double_click') });
        else r = { assente: true };
      } else if (g.tipo === 'scrivi') {
        r = await chiama('type_text', { ...base, ...xy, text: g.testo, ...sfondo('type_text') }, 120000);
      } else if (g.tipo === 'scorri') {
        r = await chiama('scroll', { ...base, ...xy, direction: g.direzione, amount: g.quanto, by: 'line', ...sfondo('scroll') });
      } else if (g.tipo === 'tasto') {
        const c = await collega();
        if (!g.modificatori.length || haCampo(c.strumenti.get('press_key'), 'modifiers')) {
          r = await chiama('press_key', { ...base, ...xy, key: g.tasto, modifiers: g.modificatori.length ? g.modificatori : undefined, ...sfondo('press_key') });
        } else {
          r = await chiama('hotkey', { ...base, ...xy, keys: [...g.modificatori, g.tasto], ...sfondo('hotkey') });
        }
      } else if (g.tipo === 'trascina') {
        r = await chiama('drag', { pid: base.pid, window_id: base.window_id, from_x: g.da.x, from_y: g.da.y, to_x: g.a.x, to_y: g.a.y, ...sfondo('drag') });
      }
      if (!r || r.assente) return { ok: false, codice: 'gesto-non-supportato', motivo: 'questa versione del driver non sa fare questo gesto su questo sistema' };
      return esitoAzione(r);
    },
  };
}

module.exports = { creaMotoreCua, ambiente, argomenti, esitoAzione, STRUMENTI_AMMESSI, STRUMENTI_NECESSARI };
