// Gli strati del correttore (segni, valori, lampi). Su un sito stanno in un'ombra chiusa (#2299), dove i locator non
// arrivano: `segniDi` dà un oggetto che si usa come un Locator e legge dal mondo dei content script, per expect e misure.
import { nelMondoDelFrame } from './riquadri.mjs';

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Gira nel mondo di Filo: i nodi che rispondono al selettore, anche dentro i riquadri chiusi, filtrati per testo come
// fa `hasText` (spazi compressi, senza maiuscole, sottostringa). `chiama` è una funzione da applicare ai nodi.
const LEGGI = ({ sel, filtri, indice, chiama, arg }) => {
  const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
  const piano = (s) => String(s || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
  let els = T ? T.trovaTutti(sel) : [...document.querySelectorAll(sel)];
  for (const f of filtri) {
    if (f.testo != null) els = els.filter((e) => piano(e.textContent).toLowerCase().includes(piano(f.testo).toLowerCase()));
    if (f.regex) els = els.filter((e) => new RegExp(f.regex.s, f.regex.f).test(e.textContent || ''));
  }
  if (indice != null) els = els.length ? [els[indice < 0 ? els.length + indice : indice]].filter(Boolean) : [];
  if (chiama) {
    const fn = (0, eval)(`(${chiama.fn})`);
    return chiama.tutti ? fn(els, arg) : (els[0] ? { v: fn(els[0], arg) } : null);
  }
  return els.map((e) => {
    const r = e.getBoundingClientRect();
    return {
      testo: e.textContent || '', classi: String(e.getAttribute('class') || ''),
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      visibile: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden',
    };
  });
};

const normale = (s) => String(s || '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
function combacia(testo, atteso) {
  let t = atteso.normalizeWhiteSpace ? normale(testo) : String(testo || '');
  if (atteso.regexSource != null) return new RegExp(atteso.regexSource, atteso.regexFlags).test(t);
  let a = atteso.normalizeWhiteSpace ? normale(atteso.string) : atteso.string;
  if (atteso.ignoreCase) { t = t.toLowerCase(); a = a.toLowerCase(); }
  return atteso.matchSubstring ? t.includes(a) : t === a;
}

class Segni {
  constructor(page, sel, { iframe = null, filtri = [], indice = null } = {}) {
    this._page = page;
    this._sel = sel;
    this._iframe = iframe;
    this._filtri = filtri;
    this._indice = indice;
    // `expect(...)` accetta un Locator riconoscendolo da qui: i suoi confronti passano da `_expect`.
    this._apiName = 'Locator';
  }

  _con(o) {
    return new Segni(this._page, this._sel, { iframe: this._iframe, filtri: this._filtri, indice: this._indice, ...o });
  }
  filter({ hasText } = {}) {
    const f = hasText instanceof RegExp ? { regex: { s: hasText.source, f: hasText.flags } } : { testo: hasText };
    return this._con({ filtri: [...this._filtri, f], indice: null });
  }
  first() { return this._con({ indice: 0 }); }
  last() { return this._con({ indice: -1 }); }
  nth(i) { return this._con({ indice: i }); }
  toString() { return `segni ${this._sel}${this._filtri.map((f) => ` «${f.testo ?? f.regex?.s}»`).join('')}`; }

  async _frame() {
    if (!this._iframe) return { frame: null, dx: 0, dy: 0 };
    const h = await this._page.waitForSelector(this._iframe);
    const frame = await h.contentFrame();
    const box = await h.boundingBox();
    const [bx, by] = await h.evaluate((f) => {
      const cs = getComputedStyle(f);
      return [f.clientLeft + parseFloat(cs.paddingLeft), f.clientTop + parseFloat(cs.paddingTop)];
    });
    return { frame, dx: box.x + bx, dy: box.y + by };
  }
  async _leggi(chiama = null, arg = null) {
    const { frame, dx, dy } = await this._frame();
    const v = await nelMondoDelFrame(this._page, frame, LEGGI, { sel: this._sel, filtri: this._filtri, indice: this._indice, chiama, arg });
    if (chiama) return v;
    return v.map((s) => ({ ...s, box: { ...s.box, x: s.box.x + dx, y: s.box.y + dy } }));
  }
  async _aspetta(prova, timeout) {
    const fine = Date.now() + (timeout ?? 5000);
    for (;;) {
      const v = await prova();
      if (v != null) return v;
      if (Date.now() > fine) return null;
      await pausa(50);
    }
  }

  async count() { return (await this._leggi()).length; }
  async allTextContents() { return (await this._leggi()).map((s) => s.testo); }
  async textContent({ timeout } = {}) { return this._aspetta(async () => (await this._leggi())[0]?.testo ?? null, timeout); }
  async isVisible() { return !!(await this._leggi())[0]?.visibile; }
  async boundingBox({ timeout } = {}) { return this._aspetta(async () => (await this._leggi())[0]?.box ?? null, timeout); }
  async evaluate(fn, arg = null, { timeout } = {}) {
    const r = await this._aspetta(() => this._leggi({ fn: fn.toString() }, arg), timeout);
    if (!r) throw new Error(`${this}: nessun nodo da valutare`);
    return r.v;
  }
  async evaluateAll(fn, arg = null) { return this._leggi({ fn: fn.toString(), tutti: true }, arg); }

  // Il protocollo dei confronti di expect sui Locator: si rilegge finché il confronto riesce o scade il tempo.
  async _expect(come, { expectedNumber, expectedText, isNot, timeout }) {
    const fine = Date.now() + (timeout ?? 5000);
    for (;;) {
      const segni = await this._leggi();
      const [primo] = segni;
      let matches;
      let value;
      if (come === 'to.have.count') { value = segni.length; matches = value === expectedNumber; }
      else if (come === 'to.have.text.array') {
        value = segni.map((s) => s.testo);
        matches = value.length === expectedText.length && value.every((t, i) => combacia(t, expectedText[i]));
      } else if (come === 'to.have.text') { value = primo ? primo.testo : ''; matches = !!primo && combacia(value, expectedText[0]); }
      else if (come === 'to.have.class') { value = primo ? primo.classi : ''; matches = !!primo && combacia(value, expectedText[0]); }
      else if (come === 'to.be.visible' || come === 'to.be.hidden') {
        value = primo && primo.visibile ? 'visible' : 'hidden';
        matches = (value === 'visible') === (come === 'to.be.visible');
      } else if (come === 'to.be.attached' || come === 'to.be.detached') {
        value = primo ? 'attached' : 'detached';
        matches = !!primo === (come === 'to.be.attached');
      } else throw new Error(`${this}: «${come}» non si sa ancora confrontare negli strati del correttore`);
      const scaduto = Date.now() > fine;
      if (matches !== isNot || scaduto) return { matches, received: { value }, log: [], timedOut: scaduto && matches === isNot };
      await pausa(100);
    }
  }
}

// I nodi degli strati che rispondono a `sel` (come `page.locator(sel, { hasText })`); `iframe` è il selettore del
// riquadro incorporato in cui stanno.
export function segniDi(page, sel, { hasText, iframe } = {}) {
  const s = new Segni(page, sel, { iframe });
  return hasText === undefined ? s : s.filter({ hasText });
}

// Il riquadro di un segno del correttore. Lo strato si ridisegna (fine di un passaggio, un controllo che torna) e fra
// la ricerca e la misura di `boundingBox()` il nodo può essere già sostituito: null vuol dire «riprova», non «non c'è».
export async function riquadroDelSegno(loc, { timeout = 5000 } = {}) {
  const fine = Date.now() + timeout;
  for (;;) {
    const b = await loc.boundingBox({ timeout });
    if (b && b.width > 0) return b;
    if (Date.now() > fine) throw new Error(`il segno ${loc} non ha un riquadro`);
    await pausa(50);
  }
}

// Gli stili calcolati di un segno, `{ proprietà: valore }`. Stessa corsa: un nodo già sostituito risponde con stringhe
// vuote, che non vogliono dire «trasparente»; si rilegge finché il nodo letto è ancora nello strato.
export async function stileDelSegno(loc, proprieta, { timeout = 5000 } = {}) {
  const fine = Date.now() + timeout;
  for (;;) {
    const v = await loc.evaluate((el, ps) => {
      if (!el.isConnected) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]));
    }, proprieta, { timeout });
    if (v) return v;
    if (Date.now() > fine) throw new Error(`il segno ${loc} non resta nello strato abbastanza per leggerne lo stile`);
    await pausa(50);
  }
}
