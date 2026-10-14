// #1097 giro 3 — aiuto delle prove: il correttore in un contesto vm con un DOM finto (copiato dalla sua unit).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');

export function correttore() {
  const timers = []; let tid = 0;
  const tick = () => new Promise((r) => setImmediate(r));
  function node(tag) {
    const n = { tagName: tag, nodeType: 1, children: [], style: new Proxy({ setProperty() {} }, {}), dataset: {}, isConnected: true, className: '', textContent: '',
      setAttribute() {}, appendChild(c) { if (c.isFrag) n.children.push(...c.children); else n.children.push(c); return c; }, remove() { n.isConnected = false; } };
    Object.defineProperty(n, 'innerHTML', { set() { n.children = []; }, get() { return ''; } });
    let testo = '';
    Object.defineProperty(n, 'textContent', { set(v) { testo = String(v); n.children = []; }, get() { return testo; } });
    return n;
  }
  const docListeners = {};
  const pending = []; const chiamate = { n: 0 };
  const sb = {
    console, Promise, JSON, Math, Date, RegExp, Array, Object, String, Number, Map, Set, WeakMap, Symbol, Error, Intl, Proxy,
    setTimeout: (fn, ms) => { const t = { id: ++tid, fn, ms, done: false }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.done = true; },
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (f) => f(),
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    document: {
      hidden: false, body: node('BODY'), documentElement: { dataset: {} },
      addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
      createElement: (t) => node(t.toUpperCase()),
      createDocumentFragment: () => ({ isFrag: true, children: [], appendChild(c) { this.children.push(c); } }),
      createTextNode: (t) => ({ text: t }),
    },
    chrome: {
      runtime: { onMessage: { addListener() {} }, sendMessage(m) {
        if (m.action === 'spellcheck_semantic') { chiamate.n += 1; return new Promise((r) => pending.push({ text: m.payload.text, r })); }
        return Promise.resolve({ ok: false });
      } },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
    },
    SN_MSG: { MSG: { AI_REQUEST: 'ai' } },
    SN_GESTO: { prendi: () => true, dentro: () => () => true, CHIUDE: 1 },
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  sb.getComputedStyle = () => ({ borderStyle: '', getPropertyValue: () => '' });
  sb.addEventListener = () => {};
  vm.createContext(sb);
  vm.runInContext(src('src/shared/constants.js'), sb);
  vm.runInContext(src('src/content/spellcheck.js'), sb);
  sb.SN_SPELLCHECK.init({ featureFlags: {} });
  const fireAll = async () => { for (let k = 0; k < 5; k++) { for (const t of timers.filter((x) => !x.done)) { t.done = true; await t.fn(); } await tick(); } };
  function campo() {
    const ls = {};
    return { tagName: 'TEXTAREA', nodeType: 1, value: '', isConnected: true, parentElement: null, scrollTop: 0, scrollLeft: 0,
      getAttribute: () => null, hasAttribute: () => false, getRootNode: () => sb.document, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      addEventListener(t, f) { (ls[t] ||= []).push(f); }, fire(t) { for (const f of ls[t] || []) f({}); } };
  }
  return {
    chiamate, pending, fireAll, tick, campo,
    entra: (el) => docListeners.focusin.forEach((f) => f({ target: el })),
    esce: (el) => docListeners.focusout.forEach((f) => f({ target: el })),
    scrive: (el, v) => { el.value = v; el.fire('input'); },
    risponde: (i, annotated, issues = []) => pending[i].r({ ok: true, text: JSON.stringify({ annotated, issues }) }),
    // Le parole segnate in vista, lette dagli strati sopra i campi.
    segni: () => sb.document.body.children.flatMap((o) => o.children || []).filter((x) => x.className === 'sn-semantic-error').map((x) => x.textContent),
  };
}

