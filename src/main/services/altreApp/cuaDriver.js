// Implementazione del ComputerDriver con Cua Driver (MIT) via MCP su stdio: traduce le quattro operazioni negli
// strumenti del driver e le risposte nella forma grezza che computerDriver.js normalizza. Non decide mai di passare
// al primo piano: chiede sempre lo sfondo. Regole: tests/unit/cuaDriver.test.mjs.

const { avviaMcp } = require('./mcpStdio');

// Gli strumenti senza cui il driver non serve: la prova d'avvio li cerca tutti.
const STRUMENTI_NECESSARI = ['list_windows', 'get_window_state', 'click', 'type_text', 'press_key', 'scroll', 'drag'];
const PULSANTE = { sinistro: 'left', destro: 'right', centrale: 'middle' };
const DIREZIONE = { su: 'up', giu: 'down', sinistra: 'left', destra: 'right' };

function argomentiMcp(piattaforma) {
  // Su macOS il processo figlio che possiede il runtime prende i permessi di chi lo avvia (Filo), non di CuaDriver.app.
  return piattaforma === 'darwin' ? ['mcp', '--direct'] : ['mcp'];
}

// Il driver non parla di sé fuori da qui: niente telemetria, niente controllo degli aggiornamenti, stato nella sua cartella.
function ambiente(base, casa) {
  return {
    ...base,
    DO_NOT_TRACK: '1',
    CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
    CUA_TELEMETRY_ENABLED: '0',
    CUA_TELEMETRY: '0',
    CUA_DRIVER_RS_UPDATE_CHECK: '0',
    ...(casa ? { CUA_DRIVER_RS_HOME: casa } : {}),
  };
}

function leggiIdFinestra(id) {
  const m = /^(\d+):(\d+)$/.exec(String(id || '').trim());
  if (!m) throw new Error('Questa finestra non esiste più: rileggi l\'elenco delle finestre.');
  return { pid: Number(m[1]), windowId: Number(m[2]) };
}

function contenutoStrutturato(r) {
  if (r && r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
  const t = r && Array.isArray(r.content) ? r.content.find((c) => c && c.type === 'text') : null;
  if (t) { try { const j = JSON.parse(t.text); if (j && typeof j === 'object') return j; } catch (_) {} }
  return {};
}
function testoDi(r) {
  const t = r && Array.isArray(r.content) ? r.content.find((c) => c && c.type === 'text' && c.text) : null;
  return t ? String(t.text) : '';
}
function codiceDi(sc) {
  return String((sc && (sc.code || (sc.error && sc.error.code))) || '');
}

function erroreStrumento(nome, r) {
  const sc = contenutoStrutturato(r);
  const e = new Error(testoDi(r).split('\n')[0].slice(0, 300) || `Lo strumento ${nome} ha risposto con un errore.`);
  e.codice = codiceDi(sc);
  return e;
}

function creaCuaDriver({ eseguibile, piattaforma = process.platform, casa = null, cwd, env = process.env, spawn, versione = '0', avvia = avviaMcp, onUscita = null } = {}) {
  let client = null;

  function apriClient() {
    if (client && client.vivo()) return client;
    client = avvia({
      eseguibile,
      argomenti: argomentiMcp(piattaforma),
      env: ambiente(env, casa),
      cwd,
      spawn,
      clientInfo: { name: 'Filo', version: String(versione) },
      onUscita,
    });
    return client;
  }

  async function strumento(nome) {
    const c = apriClient();
    await c.pronto;
    return c.strumenti().find((t) => t.name === nome) || null;
  }

  async function chiama(nome, args, opzioni) {
    const c = apriClient();
    const r = await c.chiama(nome, args, opzioni);
    if (r && r.isError) throw erroreStrumento(nome, r);
    return r || {};
  }

  // Lo schema degli argomenti cambia da un sistema all'altro: si legge quello che il driver dichiara.
  function argomentiPer(def, { pid, windowId, token, punto }) {
    const props = (def && def.inputSchema && def.inputSchema.properties) || {};
    const a = {};
    if (props.target) a.target = { kind: 'window', pid, window_id: windowId };
    else {
      if (props.pid) a.pid = pid;
      if (props.window_id && !(token && props.element_token)) a.window_id = windowId;
    }
    if (token && props.element_token) a.element_token = token;
    else if (punto && props.x && props.y) { a.x = punto.x; a.y = punto.y; }
    else if (token || punto) return { a, manca: true };
    if (props.delivery_mode) a.delivery_mode = 'background';
    return { a, props };
  }

  async function finestre() {
    const r = await chiama('list_windows', {});
    const sc = contenutoStrutturato(r);
    return (Array.isArray(sc.windows) ? sc.windows : []).filter((w) => w && w.window_id != null && w.pid != null).map((w) => ({
      id: `${w.pid}:${w.window_id}`,
      app: w.app_name,
      titolo: w.title,
      posizione: w.bounds,
      visibile: typeof w.is_on_screen === 'boolean' ? w.is_on_screen : null,
      ridotta: typeof w.minimized === 'boolean' ? w.minimized : null,
    }));
  }

  async function albero(id) {
    const { pid, windowId } = leggiIdFinestra(id);
    const def = await strumento('get_window_state');
    const props = (def && def.inputSchema && def.inputSchema.properties) || {};
    const args = { pid, window_id: windowId };
    if (props.include_screenshot) args.include_screenshot = false;
    if (props.include_accessibility_tree) args.include_accessibility_tree = true;
    const r = await chiama('get_window_state', args, { attesaMs: 60000 });
    const sc = contenutoStrutturato(r);
    const elementi = Array.isArray(sc.elements) ? sc.elements : [];
    return {
      finestra: { app: sc.app_name, titolo: sc.window_title, posizione: sc.window_bounds },
      troncato: sc.truncated === true || sc.elements_complete === false,
      nodi: elementi.filter((e) => e && typeof e === 'object').map((e) => ({
        id: e.element_token || null,
        ruolo: e.role,
        sottoruolo: e.subrole,
        password: e.is_password === true || e.isPassword === true || e.password === true,
        nome: e.label,
        valore: e.value,
        abilitato: e.enabled,
        selezionato: e.selected,
        posizione: e.frame,
        profondita: e.depth,
        genitore: e.parent_index,
        indice: e.element_index,
      })),
    };
  }

  function immagineDi(r, sc) {
    const img = r && Array.isArray(r.content) ? r.content.find((c) => c && c.type === 'image' && c.data) : null;
    if (!img) return null;
    return {
      mime: img.mimeType || 'image/png',
      base64: img.data,
      larghezza: sc.screenshot_width,
      altezza: sc.screenshot_height,
    };
  }

  async function foto(id) {
    if (id == null) {
      const r = await chiama('get_desktop_state', {}, { attesaMs: 60000 });
      return immagineDi(r, contenutoStrutturato(r));
    }
    const { pid, windowId } = leggiIdFinestra(id);
    const def = await strumento('get_window_state');
    const props = (def && def.inputSchema && def.inputSchema.properties) || {};
    const args = { pid, window_id: windowId };
    if (props.include_screenshot) args.include_screenshot = true;
    if (props.include_accessibility_tree) args.include_accessibility_tree = false;
    const r = await chiama('get_window_state', args, { attesaMs: 60000 });
    return immagineDi(r, contenutoStrutturato(r));
  }

  async function chiamaGesto(nome, base, extra) {
    const def = await strumento(nome);
    if (!def) return { ok: false, codice: 'non-supportato', motivo: `Il componente non sa fare questo gesto (${nome}).` };
    const { a, props, manca } = argomentiPer(def, base);
    if (manca) return { ok: false, codice: 'bersaglio', motivo: 'Per questo gesto serve un punto della finestra, non un elemento.' };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && (props[k] || k === 'text' || k === 'key')) a[k] = v;
    const c = apriClient();
    const r = await c.chiama(nome, a, { attesaMs: 60000 });
    const sc = contenutoStrutturato(r);
    const codice = codiceDi(sc);
    if (r && r.isError) {
      const sfondo = codice === 'background_unavailable';
      return {
        ok: false,
        codice: sfondo ? 'sfondo-non-disponibile' : (codice || 'errore'),
        motivo: sfondo ? 'Questo gesto non si può fare senza portare la finestra in primo piano.' : (testoDi(r).split('\n')[0].slice(0, 300) || 'Il gesto non è andato a segno.'),
        primoPiano: sfondo,
      };
    }
    if (sc.effect === 'refused') {
      const primoPiano = !!(sc.escalation && (sc.escalation.target === 'foreground' || sc.escalation.recommended === 'foreground'));
      return { ok: false, codice: primoPiano ? 'sfondo-non-disponibile' : 'rifiutato', motivo: String(sc.summary || 'Il componente ha rifiutato il gesto.'), primoPiano };
    }
    return { ok: true, effetto: sc.effect || 'sconosciuto', via: sc.route || null };
  }

  async function agisci(b, g) {
    const { pid, windowId } = leggiIdFinestra(b.finestra);
    const base = { pid, windowId, token: b.nodo, punto: b.punto };
    switch (g.tipo) {
      case 'clic': {
        const destro = g.pulsante === 'destro' ? await strumento('right_click') : null;
        const click = await strumento('click');
        const propsClick = (click && click.inputSchema && click.inputSchema.properties) || {};
        if (destro && !propsClick.button) return chiamaGesto('right_click', base, {});
        return chiamaGesto('click', base, { button: PULSANTE[g.pulsante], count: g.volte > 1 ? g.volte : undefined });
      }
      case 'scrivi':
        return chiamaGesto('type_text', { ...base, punto: b.nodo ? null : b.punto }, { text: g.testo });
      case 'scorri':
        return chiamaGesto('scroll', base, { direction: DIREZIONE[g.direzione], amount: g.quantita });
      case 'tasto': {
        if (!g.modificatori.length) return chiamaGesto('press_key', { pid, windowId }, { key: g.tasto });
        const pk = await strumento('press_key');
        const pkProps = (pk && pk.inputSchema && pk.inputSchema.properties) || {};
        if (pkProps.modifiers) return chiamaGesto('press_key', { pid, windowId }, { key: g.tasto, modifiers: g.modificatori });
        return chiamaGesto('hotkey', { pid, windowId }, { keys: [...g.modificatori, g.tasto] });
      }
      case 'trascina': {
        if (!b.punto) return { ok: false, codice: 'bersaglio', motivo: 'Un trascinamento parte da un punto della finestra.' };
        return chiamaGesto('drag', { pid, windowId }, { from_x: b.punto.x, from_y: b.punto.y, to_x: g.a.x, to_y: g.a.y });
      }
      default:
        return { ok: false, codice: 'gesto', motivo: 'Gesto sconosciuto.' };
    }
  }

  // La prova d'avvio: il driver parte, risponde e ha gli strumenti che servono.
  async function prova() {
    const c = apriClient();
    const { strumenti } = await c.pronto;
    const nomi = new Set(strumenti.map((t) => t.name));
    return { mancano: STRUMENTI_NECESSARI.filter((n) => !nomi.has(n)) };
  }

  function chiudi() {
    if (client) { try { client.chiudi(); } catch (_) {} }
    client = null;
  }

  return { finestre, albero, foto, agisci, prova, chiudi, vivo: () => !!(client && client.vivo()) };
}

module.exports = { creaCuaDriver, argomentiMcp, ambiente, STRUMENTI_NECESSARI };
