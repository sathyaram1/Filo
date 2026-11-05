// Il correttore nel campo con DOM, orologio e modello finti (copia dell'harness di tests/unit/correttoreNelCampo.test.mjs),
// per le prove del giro 1 di #1302. Non è una prova.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';

const src = (p) => readFileSync(join(process.cwd(), p), 'utf8');
export function correttore({ sbagliate = [], impostazioni = {} } = {}) {
  let ora = 1_000_000;
  const timers = [];
  let tid = 0;
  const tick = () => new Promise((r) => setImmediate(r));
  function node(tag) {
    const n = {
      tagName: tag, nodeType: 1, children: [], style: new Proxy({ setProperty() {} }, {}), dataset: {}, isConnected: true, className: '',
      setAttribute() {}, appendChild(c) { if (c.isFrag) n.children.push(...c.children); else n.children.push(c); return c; },
      remove() { n.isConnected = false; const fratelli = sb.document.body.children; if (fratelli.includes(n)) fratelli.splice(fratelli.indexOf(n), 1); },
    };
    Object.defineProperty(n, 'innerHTML', { set() { n.children = []; }, get() { return ''; } });
    let testo = '';
    Object.defineProperty(n, 'textContent', { set(v) { testo = String(v); n.children = []; }, get() { return testo; } });
    return n;
  }
  const docListeners = {};
  const richieste = [];
  const dizionario = new Set(sbagliate);
  // Come il dizionario vero (src/preload/dizionario.js): ogni chiamata è un viaggio al processo principale.
  const viaggi = [];
  const sbagliataFinta = (w) => w === 'qzxwvkjh' || dizionario.has(w);
  class FintaData extends Date {
    constructor(...a) { super(...(a.length ? a : [ora])); }
    static now() { return ora; }
  }
  const sb = {
    // La pagina intorno al campo qui non c'è: chi la cerca lo dice, e qui si tace.
    console: { ...console, warn() {} }, Promise, JSON, Math, RegExp, Array, Object, String, Number, Map, Set, WeakMap, WeakSet, Symbol, Error, Intl, Proxy,
    Date: FintaData,
    setTimeout: (fn, ms = 0) => { const t = { id: ++tid, fn, at: ora + ms, done: false }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.done = true; },
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0,
    ResizeObserver: class { observe() {} disconnect() {} },
    location: { protocol: 'https:', hostname: 'chat.example' },
    document: {
      hidden: false, title: 'Chat', body: node('BODY'), documentElement: { dataset: {} },
      addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
      createElement: (t) => node(t.toUpperCase()),
      createDocumentFragment: () => ({ isFrag: true, children: [], appendChild(c) { this.children.push(c); } }),
      createTextNode: (t) => ({ text: t }),
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(m) {
          if (m.type !== 'ai') return Promise.resolve({ ok: false });
          return new Promise((r) => richieste.push({ action: m.action, payload: m.payload, suRichiesta: !!m.suRichiesta, riprova: !!m.riprova, r }));
        },
      },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
    },
    SN_MSG: { MSG: { AI_REQUEST: 'ai' } },
    SN_GESTO: { prendi: () => true, dentro: () => () => true, CHIUDE: 'chiude' },
    SN_DIZIONARIO: {
      sbagliata: (w) => { viaggi.push([w]); return sbagliataFinta(w); },
      sbagliate: (ws) => { viaggi.push(ws.slice()); return ws.map(sbagliataFinta); },
      proposte: () => [],
    },
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  sb.getComputedStyle = () => ({ borderStyle: '', direction: 'ltr', getPropertyValue: () => '' });
  sb.addEventListener = () => {};
  vm.createContext(sb);
  for (const f of ['src/shared/politicaModelli.js', 'src/shared/constants.js', 'src/content/coerenza.js', 'src/content/correttoreRegole.js', 'src/content/spellcheck.js']) {
    vm.runInContext(src(f), sb);
  }
  sb.SN_SPELLCHECK.init({ featureFlags: { spellcheck: true, spellcheckContext: true }, ...impostazioni });
  // Il tempo passa, e partono i timer scaduti, in ordine.
  async function passa(ms) {
    const fine = ora + ms;
    for (;;) {
      const prossimo = timers.filter((t) => !t.done && t.at <= fine).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!prossimo) break;
      ora = Math.max(ora, prossimo.at);
      prossimo.done = true;
      // Senza aspettarlo: un controllo resta in viaggio finché la prova non risponde.
      prossimo.fn();
      await tick();
    }
    ora = fine;
    await tick();
  }
  function campo() {
    const ls = {};
    const el = {
      tagName: 'TEXTAREA', nodeType: 1, value: '', selectionStart: 0, selectionEnd: 0, spellcheck: true, isConnected: true,
      parentElement: null, scrollTop: 0, scrollLeft: 0, offsetWidth: 100, clientWidth: 100, offsetHeight: 100, clientHeight: 100,
      getAttribute: () => null, hasAttribute: () => false, closest: () => null, getRootNode: () => sb.document,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      addEventListener(t, f) { (ls[t] ||= []).push(f); }, fire(t, e = {}) { for (const f of ls[t] || []) f(e); },
    };
    return el;
  }
  const testoDi = (n) => (n.text !== undefined ? n.text : (n.children || []).map(testoDi).join(''));
  function segni(classe) {
    const out = [];
    const giro = (n) => {
      if (typeof n.className === 'string' && n.className.split(' ').includes(classe)) out.push({ testo: testoDi(n), dubbio: n.className.includes('sn-dubbio') });
      for (const c of n.children || []) giro(c);
    };
    for (const o of sb.document.body.children) giro(o);
    return JSON.parse(JSON.stringify(out));
  }
  const rapide = () => richieste.filter((r) => r.action === 'spellcheck_semantic');
  const ragionate = () => richieste.filter((r) => r.action === 'spellcheck_context');
  return {
    sb, richieste, rapide, ragionate, passa, campo, segni, tick, viaggi,
    entra: (el) => docListeners.focusin.forEach((f) => f({ target: el })),
    esce: (el) => docListeners.focusout.forEach((f) => f({ target: el })),
    visibile: () => (docListeners.visibilitychange || []).forEach((f) => f()),
    // Scrive come una tastiera: il cursore resta in fondo.
    scrive: (el, v, e = {}) => { el.value = v; el.selectionStart = el.selectionEnd = v.length; el.fire('input', e); },
    risponde: async (r, testo) => { r.r({ ok: true, text: testo }); await tick(); await tick(); },
  };
}
