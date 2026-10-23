// #798 — Una pagina non aggira la protezione anti-fingerprint leggendo canvas, WebGL e audio con le funzioni di un
// riquadro: vuoto creato da lei, scritto nell'HTML, srcdoc, data:, o dello stesso sito. Ogni lettura coincide con
// quella della pagina ed è diversa da Off; un riquadro di un altro sito resta com'è. Senza la correzione le letture
// dai riquadri coincidono con Off.

import { test, expect } from './fixtures/electron.mjs';
import { guardiaAccesa } from './helpers/guardia.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

// Lo script di un'impronta, uguale in ogni documento: una scena fissa, letta con le funzioni della sua finestra.
const IMPRONTA = `
  function fnv(s) {
    var a = 2166136261, b = 33554467;
    for (var i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b ^ s.charCodeAt(i), 16777619) >>> 0; }
    return a.toString(16) + b.toString(16);
  }
  function scena(doc) {
    var c = doc.createElement('canvas'); c.width = 80; c.height = 40;
    var x = c.getContext('2d');
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40);
    x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
    return { c: c, x: x };
  }
  function impronta() { return fnv(scena(document).c.toDataURL()); }
  function manda(chi) { parent.postMessage({ lettura: chi, valore: impronta() }, '*'); }
`;

function documento(chi) {
  return `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}manda(${JSON.stringify(chi)});</script></body>`;
}
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Tutte le strade insieme, nella pagina: hash di ogni lettura.
async function letture() {
  /* global fnv, scena */
  const attendi = (cond) => new Promise((res) => { const t = () => (cond() ? res() : setTimeout(t, 25)); t(); });
  const hashPx = (a) => fnv(Array.prototype.join.call(a, ','));
  const { c, x } = scena(document);
  const out = { pagina: fnv(c.toDataURL()), paginaPx: hashPx(x.getImageData(0, 0, 80, 40).data) };

  const f = document.createElement('iframe');
  document.body.appendChild(f);
  const W = f.contentWindow;
  out.vuotoToDataURL = fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c));
  out.vuotoScena = fnv(W.HTMLCanvasElement.prototype.toDataURL.call(scena(W.document).c));
  out.vuotoPx = hashPx(W.CanvasRenderingContext2D.prototype.getImageData.call(x, 0, 0, 80, 40).data);
  out.vuotoBlob = await new Promise((res) => W.HTMLCanvasElement.prototype.toBlob.call(c, (b) => {
    const fr = new FileReader(); fr.onload = () => res(fnv(fr.result)); fr.readAsDataURL(b);
  }));
  const g = document.createElement('iframe');
  document.body.appendChild(g);
  out.daDocumento = fnv(g.contentDocument.defaultView.HTMLCanvasElement.prototype.toDataURL.call(c));
  const annidato = W.document.createElement('iframe');
  W.document.body.appendChild(annidato);
  out.annidato = fnv(annidato.contentWindow.HTMLCanvasElement.prototype.toDataURL.call(c));
  out.perIndice = fnv(frames[0].HTMLCanvasElement.prototype.toDataURL.call(c));
  out.perNome = fnv(window.nellHtml.HTMLCanvasElement.prototype.toDataURL.call(c));

  const gc = document.createElement('canvas'); gc.width = 32; gc.height = 16;
  const gl = gc.getContext('webgl', { preserveDrawingBuffer: true });
  if (gl) {
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const leggi = (fn, Arr) => { const px = new Arr(32 * 16 * 4); fn.call(gl, 0, 0, 32, 16, gl.RGBA, gl.UNSIGNED_BYTE, px); return hashPx(px); };
    out.paginaGL = leggi(WebGLRenderingContext.prototype.readPixels, Uint8Array);
    out.vuotoGL = leggi(W.WebGLRenderingContext.prototype.readPixels, Uint8Array);
    out.vuotoGLBufferSuo = leggi(W.WebGLRenderingContext.prototype.readPixels, W.Uint8Array);
  }

  const suono = async (Ctor) => {
    const ctx = new Ctor(1, 4410, 44100);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1000;
    const comp = ctx.createDynamicsCompressor();
    o.connect(comp); comp.connect(ctx.destination); o.start(0);
    const buf = await ctx.startRendering();
    return hashPx(new Uint8Array(buf.getChannelData(0).buffer));
  };
  out.paginaAudio = await suono(OfflineAudioContext);
  out.vuotoAudio = await suono(W.OfflineAudioContext);

  // I riquadri con un documento loro, già carichi: si leggono anche da qui, con le loro funzioni.
  await attendi(() => document.getElementById('so').contentDocument?.readyState === 'complete');
  const so = document.getElementById('so').contentWindow;
  out.stessaOrigineDaQui = fnv(so.HTMLCanvasElement.prototype.toDataURL.call(c));
  const cs = scena(so.document).c;
  out.canvasDelRiquadroLettoQui = fnv(HTMLCanvasElement.prototype.toDataURL.call(cs));
  await attendi(() => document.getElementById('sd').contentDocument?.readyState === 'complete');
  out.srcdocDaQui = fnv(document.getElementById('sd').contentWindow.HTMLCanvasElement.prototype.toDataURL.call(c));

  await attendi(() => ['srcdoc', 'sandbox', 'data', 'stessaOrigine', 'stessoSito', 'altroSito'].every((k) => k in window.__l));
  return { ...out, ...window.__l };
}

function paginaDiProva(testServer, sitoGemello) {
  const stessaOrigine = testServer.html(documento('stessaOrigine'));
  const altroSito = testServer.html(documento('altroSito'), { pubblico: true });
  return testServer.html(`<!doctype html><html><head><meta charset="utf-8"><script>${IMPRONTA}
    window.__l = {};
    addEventListener('message', function (e) { if (e.data && e.data.lettura) window.__l[e.data.lettura] = e.data.valore; });
  </script></head><body>
  <iframe name="nellHtml"></iframe>
  <iframe id="sd" srcdoc="${attr(documento('srcdoc'))}"></iframe>
  <iframe sandbox="allow-scripts" srcdoc="${attr(documento('sandbox'))}"></iframe>
  <iframe src="data:text/html;charset=utf-8,${encodeURIComponent(documento('data'))}"></iframe>
  <iframe id="so" src="${stessaOrigine}"></iframe>
  <iframe src="${sitoGemello}"></iframe>
  <iframe src="${altroSito}"></iframe>
  </body></html>`);
}

test('i riquadri della pagina leggono canvas, WebGL e audio col suo rumore; un altro sito resta com\'è', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  // Stesso sito, altra origine: lo stesso indirizzo IP su un'altra porta.
  const gemello = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(documento('stessoSito'));
  });
  await new Promise((r) => gemello.listen(0, '127.0.0.1', r));
  const sitoGemello = `http://127.0.0.1:${gemello.address().port}/`;
  try {
    // Off si legge sulla stessa scheda: openTab sceglie la vista per host, e due schede su 127.0.0.1 si confonderebbero.
    const page = await openTab(paginaDiProva(testServer, sitoGemello));
    const leggi = async () => {
      await page.waitForFunction(() => document.readyState === 'complete' && window.__l, null, { timeout: 10_000 });
      return page.evaluate(letture);
    };
    const on = await leggi();
    await setFpMode(openTab, 'off');
    await page.goto(paginaDiProva(testServer, sitoGemello));
    const off = await leggi();

    expect(on.pagina).not.toBe(off.pagina);
    expect(on.paginaPx).not.toBe(off.paginaPx);
    const comeLaPagina = ['vuotoToDataURL', 'vuotoScena', 'vuotoBlob', 'daDocumento', 'annidato', 'perIndice', 'perNome',
      'stessaOrigineDaQui', 'canvasDelRiquadroLettoQui', 'srcdocDaQui', 'srcdoc', 'sandbox', 'data', 'stessaOrigine', 'stessoSito'];
    for (const k of comeLaPagina) {
      expect.soft(on[k], `${k}: come la pagina, col rumore`).toBe(on.pagina);
      expect.soft(off[k], `${k}: in Off come la pagina, senza rumore`).toBe(off.pagina);
    }
    expect(on.vuotoBlob).not.toBe(off.vuotoBlob);
    expect(on.vuotoPx).toBe(on.paginaPx);
    expect(off.vuotoPx).toBe(off.paginaPx);
    expect(on.paginaGL, 'WebGL disponibile').toBeTruthy();
    expect(on.paginaGL).not.toBe(off.paginaGL);
    expect(on.vuotoGL).toBe(on.paginaGL);
    expect(on.vuotoGLBufferSuo).toBe(on.paginaGL);
    expect(off.vuotoGL).toBe(off.paginaGL);
    expect(on.paginaAudio).not.toBe(off.paginaAudio);
    expect(on.vuotoAudio).toBe(on.paginaAudio);
    expect(off.vuotoAudio).toBe(off.paginaAudio);
    // Il widget di un altro sito non cambia.
    expect(on.altroSito).toBe(off.altroSito);
    expect(on.altroSito).not.toBe(on.pagina);
  } finally {
    gemello.closeAllConnections?.();
    await new Promise((r) => gemello.close(r));
  }
});

// La pagina ha riscritto prima ciò che la guardia usa per prepararsi: il riquadro creato dopo ha lo stesso rumore.
test('un riquadro creato dopo che la pagina ha riscritto Object, call, apply e Object.prototype ha lo stesso rumore', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><title>avvelenata</title><script>${IMPRONTA}</script><p>ok</p>`);
  await page.waitForFunction(guardiaAccesa, null, { timeout: 6_000 });
  const r = await page.evaluate(() => {
    const { c } = scena(document);
    const pagina = fnv(c.toDataURL());
    const salva = {
      dp: Object.defineProperty, gopd: Object.getOwnPropertyDescriptor, sp: Object.setPrototypeOf, ra: Reflect.apply,
      call: Function.prototype.call, apply: Function.prototype.apply,
    };
    const rubate = [];
    const spia = function () { rubate.push(this); throw new Error('rubato'); };
    let dalRiquadro = null;
    try {
      Object.defineProperty(Object.prototype, 'get', { get() { rubate.push('get'); return undefined; }, configurable: true });
      Object.defineProperty(Object.prototype, 'value', { get() { rubate.push('value'); return undefined; }, configurable: true });
      Object.defineProperty = spia; Object.getOwnPropertyDescriptor = spia; Object.setPrototypeOf = spia; Reflect.apply = spia;
      Function.prototype.call = spia; Function.prototype.apply = spia;
      const f = document.createElement('iframe');
      document.body.appendChild(f);
      c.leggi = f.contentWindow.HTMLCanvasElement.prototype.toDataURL;
      dalRiquadro = c.leggi();
    } catch (e) {
      dalRiquadro = 'errore: ' + e.message;
    } finally {
      Function.prototype.call = salva.call; Function.prototype.apply = salva.apply;
      Object.defineProperty = salva.dp; Object.getOwnPropertyDescriptor = salva.gopd; Object.setPrototypeOf = salva.sp; Reflect.apply = salva.ra;
      delete Object.prototype.get; delete Object.prototype.value;
    }
    return { pagina, dalRiquadro: /^data:/.test(dalRiquadro) ? fnv(dalRiquadro) : dalRiquadro, toccate: rubate.length };
  });
  expect(r.dalRiquadro).toBe(r.pagina);
  expect(r.toccate, 'la guardia non passa dalle funzioni riscritte dalla pagina').toBe(0);
});

// Le funzioni del riquadro, e i getter che lo raggiungono, rispondono come in Off a chi le ispeziona da una finestra
// o dall'altra (#799).
async function profiloRiquadro() {
  const f = document.createElement('iframe');
  document.body.appendChild(f);
  const W = f.contentWindow;
  const fnTs = Function.prototype.toString, wTs = W.Function.prototype.toString;
  const desc = (P, k) => Object.getOwnPropertyDescriptor(P, k).get;
  const voci = {
    toDataURL: W.HTMLCanvasElement.prototype.toDataURL,
    getImageData: W.CanvasRenderingContext2D.prototype.getImageData,
    getContext: W.HTMLCanvasElement.prototype.getContext,
    readPixels: W.WebGLRenderingContext.prototype.readPixels,
    startRendering: W.OfflineAudioContext.prototype.startRendering,
    toStringRiquadro: wTs,
    toDataURLPagina: HTMLCanvasElement.prototype.toDataURL,
    contentWindow: desc(HTMLIFrameElement.prototype, 'contentWindow'),
    contentDocument: desc(HTMLIFrameElement.prototype, 'contentDocument'),
    frameContentWindow: desc(HTMLFrameElement.prototype, 'contentWindow'),
    objectContentDocument: desc(HTMLObjectElement.prototype, 'contentDocument'),
    contentWindowRiquadro: desc(W.HTMLIFrameElement.prototype, 'contentWindow'),
  };
  const out = {};
  for (const [k, fn] of Object.entries(voci)) {
    let nuovo;
    try { new fn(); nuovo = 'ok'; } catch (e) { nuovo = e.constructor.name; }
    out[k] = {
      testo: fnTs.call(fn), testoDalRiquadro: wTs.call(fn), nome: fn.name, lunghezza: fn.length,
      proprie: Object.getOwnPropertyNames(fn).sort().join(','), prototype: 'prototype' in fn, nuovo,
      funzioneDellaPagina: fn instanceof Function, funzioneDelRiquadro: fn instanceof W.Function,
    };
  }
  out.illegale = (() => { try { W.HTMLCanvasElement.prototype.toDataURL.call({}); return 'nessun errore'; } catch (e) { return [e instanceof W.TypeError, e instanceof TypeError, e.message]; } })();
  return out;
}

test('le funzioni del riquadro e i getter dei riquadri sono indistinguibili dalle native', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  await page.waitForFunction(guardiaAccesa, null, { timeout: 6_000 });
  const on = await page.evaluate(profiloRiquadro);
  await setFpMode(openTab, 'off');
  await page.goto(testServer.html('<title>FP_OFF</title><p>ok</p>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  expect(await page.evaluate(guardiaAccesa)).toBe(false);
  const off = await page.evaluate(profiloRiquadro);
  expect(on).toEqual(off);
});

// Un riquadro raggiunto per indice o per nome subito dopo che uno script l'ha inserito, da qualunque funzione che
// inserisce, anche dentro un'ombra, o mentre carica un altro sito: la sua finestra è ancora della pagina, col rumore.
async function perIndice() {
  /* global fnv, scena */
  const { c } = scena(document);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const out = { pagina: fnv(c.toDataURL()) };
  { const f = document.createElement('iframe'); document.body.appendChild(f); out.appendChild = leggi(ultimo()); }
  { document.body.insertAdjacentHTML('beforeend', '<iframe></iframe>'); out.insertAdjacentHTML = leggi(ultimo()); }
  { const d = document.createElement('div'); document.body.appendChild(d); d.innerHTML = '<p><iframe name="dentro"></iframe></p>'; out.innerHTMLPerNome = leggi(window.dentro); }
  { const fr = document.createDocumentFragment(); fr.appendChild(document.createElement('iframe')); document.body.append(fr); out.frammento = leggi(ultimo()); }
  { const h = document.createElement('div'); document.body.appendChild(h); const sr = h.attachShadow({ mode: 'closed' }); sr.appendChild(document.createElement('iframe')); out.ombra = leggi(ultimo()); }
  { const f = document.createElement('iframe'); f.src = location.protocol + '//sito-pubblico.test:' + location.port + '/lento'; document.body.appendChild(f); await new Promise((r) => setTimeout(r, 200)); out.altroSitoInCarico = leggi(ultimo()); }
  // Un embed di HTML non dà la finestra dall'elemento: nasce al calcolo della disposizione, raggiungibile per indice.
  {
    const e = document.createElement('embed'); e.type = 'text/html'; e.src = 'about:blank'; document.body.appendChild(e);
    await new Promise((r) => setTimeout(r, 500));
    const w = ultimo(); out.embedNato = !!w && w.frameElement === e; out.embed = leggi(w);
  }
  return out;
}

test('un riquadro raggiunto per indice o per nome subito dopo l\'inserimento ha il rumore della pagina', async ({ openTab }) => {
  test.setTimeout(90_000);
  const srv = createServer((req, res) => {
    if (req.url === '/lento') { setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>lento</p>'); } catch (_) {} }, 8_000); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>indice</title><script>${IMPRONTA}</script><body><p>ok</p></body>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const page = await openTab(url);
    await page.waitForFunction(guardiaAccesa, null, { timeout: 8_000 });
    const on = await page.evaluate(perIndice);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 8_000 });
    const off = await page.evaluate(perIndice);
    expect(on.pagina).not.toBe(off.pagina);
    expect(on.embedNato && off.embedNato, 'l\'embed apre una finestra raggiungibile per indice').toBe(true);
    for (const k of ['appendChild', 'insertAdjacentHTML', 'innerHTMLPerNome', 'frammento', 'ombra', 'altroSitoInCarico', 'embed']) {
      expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
      expect.soft(off[k], `${k}: in Off come la pagina`).toBe(off.pagina);
    }
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

// Un riquadro che cambia documento: riempito dopo l'inserimento, passato a una seconda pagina, tornato vuoto. Ogni
// documento nuovo porta copie native nuove nella stessa finestra, e ognuno deve avere il rumore della pagina.
async function cambiDiDocumento(interno) {
  /* global fnv, scena */
  const dalDocumento = {};
  addEventListener('message', (e) => { if (e.data && e.data.lettura) dalDocumento[e.data.lettura] = e.data.valore; });
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const attendi = (k) => new Promise((r) => { const t0 = Date.now(); const t = () => (k in dalDocumento || Date.now() - t0 > 4000 ? r() : setTimeout(t, 25)); t(); });
  const daFuori = (W) => { try { return fnv(scena(W.document).c.toDataURL()); } catch (e) { return 'errore ' + e.message; } };
  const out = { pagina: fnv(scena(document).c.toDataURL()) };
  const riempiti = {
    srcDopo: (f) => { f.src = interno('srcDopo'); },
    srcdocDopo: (f) => { f.srcdoc = window.__srcdoc; },
  };
  for (const [nome, riempi] of Object.entries(riempiti)) {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const i = window.length - 1;
    riempi(f);
    await carico(f);
    await attendi(nome);
    out[nome + 'Documento'] = dalDocumento[nome];
    out[nome + 'Elemento'] = daFuori(f.contentWindow);
    out[nome + 'Indice'] = daFuori(window[i]);
  }
  // Gli script di un documento da indirizzo javascript: girano prima della guardia (limite accettato dall'owner, nel
  // pattern dei riquadri); letto da fuori dopo il load ha il rumore.
  const js = document.createElement('iframe');
  document.body.appendChild(js);
  const k = window.length - 1;
  js.src = 'javascript:"<!doctype html><body>js</body>"';
  await carico(js);
  out.javascriptElemento = daFuori(js.contentWindow);
  out.javascriptIndice = daFuori(window[k]);
  const pigro = document.getElementById('pigro');
  pigro.src = interno('pigro');
  await carico(pigro);
  await attendi('pigro');
  out.pigroDocumento = dalDocumento.pigro;
  const n = document.createElement('iframe');
  n.src = interno('prima');
  document.body.appendChild(n);
  const j = window.length - 1;
  await carico(n);
  n.src = interno('seconda');
  await carico(n);
  await attendi('seconda');
  out.primaDocumento = dalDocumento.prima;
  out.secondaDocumento = dalDocumento.seconda;
  out.secondaElemento = daFuori(n.contentWindow);
  n.src = 'about:blank';
  await carico(n);
  out.tornatoVuotoIndice = daFuori(window[j]);
  out.tornatoVuotoElemento = daFuori(n.contentWindow);
  return out;
}

test('un riquadro che cambia documento ha il rumore della pagina in ogni documento', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  const pagine = {};
  for (const k of ['srcDopo', 'pigro', 'prima', 'seconda']) pagine[k] = testServer.html(documento(k));
  const apri = async () => {
    const page = await openTab(testServer.html(`<!doctype html><meta charset="utf-8"><script>${IMPRONTA}</script><body><iframe id="pigro"></iframe></body>`));
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    await page.evaluate((s) => { window.__srcdoc = s; }, documento('srcdocDopo'));
    return page.evaluate(`(${cambiDiDocumento})((k) => (${JSON.stringify(pagine)})[k])`);
  };
  const on = await apri();
  await setFpMode(openTab, 'off');
  const off = await apri();
  expect(on.pagina).not.toBe(off.pagina);
  for (const k of Object.keys(on)) {
    if (k === 'pagina') continue;
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
    expect.soft(off[k], `${k}: in Off come la pagina`).toBe(off.pagina);
  }
});

// In Privacy massima un riquadro della stessa origine che dopo qualche secondo non ha caricato niente (un 204, o un
// server lento) si legge per indice col rumore della pagina, e lo tiene quando il contenuto lento arriva.
async function vuotiDopo() {
  /* global fnv, scena */
  const { c } = scena(document);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const out = { pagina: fnv(c.toDataURL()) };
  const muto = document.createElement('iframe'); muto.src = '/204'; document.body.appendChild(muto);
  const iMuto = window.length - 1;
  const lento = document.createElement('iframe'); lento.src = '/lento'; document.body.appendChild(lento);
  const iLento = window.length - 1;
  await new Promise((r) => setTimeout(r, 4_500));
  out.mutoPerIndice = leggi(window[iMuto]);
  out.lentoPerIndice = leggi(window[iLento]);
  await new Promise((r) => { const t = () => (/lento/.test(lento.contentDocument?.body?.textContent || '') ? r() : setTimeout(t, 50)); t(); });
  out.lentoArrivato = leggi(window[iLento]);
  return out;
}

test('in Privacy massima un riquadro dello stesso sito ancora vuoto dopo qualche secondo ha il rumore della pagina', async ({ openTab }) => {
  test.setTimeout(90_000);
  const srv = createServer((req, res) => {
    if (req.url === '/204') { res.writeHead(204); res.end(); return; }
    if (req.url === '/lento') { setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>lento</p>'); } catch (_) {} }, 7_000); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>vuoti</title><script>${IMPRONTA}</script><body><p>ok</p></body>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  try {
    await setFpMode(openTab, 'privacy');
    const page = await openTab(url);
    await page.waitForFunction(guardiaAccesa, null, { timeout: 8_000 });
    const on = await page.evaluate(vuotiDopo);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 8_000 });
    const off = await page.evaluate(() => fnv(scena(document).c.toDataURL()));
    expect(on.pagina).not.toBe(off);
    for (const k of ['mutoPerIndice', 'lentoPerIndice', 'lentoArrivato']) expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

// La protezione non lascia segni che un sito possa vedere: le finestre della pagina e dei suoi riquadri hanno le stesse
// proprietà con la protezione accesa e con Off.
async function proprieta() {
  const f = document.createElement('iframe');
  document.body.appendChild(f);
  const nomi = (w) => Object.getOwnPropertyNames(w).concat(Object.getOwnPropertySymbols(w).map(String)).sort().join(',');
  return { pagina: nomi(window), riquadro: nomi(f.contentWindow) };
}

test('con la protezione accesa la pagina e i suoi riquadri non hanno proprietà in più', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  await page.waitForFunction(guardiaAccesa, null, { timeout: 6_000 });
  const on = await page.evaluate(proprieta);
  await setFpMode(openTab, 'off');
  await page.goto(testServer.html('<title>FP_OFF</title><p>ok</p>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  expect(await page.evaluate(guardiaAccesa)).toBe(false);
  const off = await page.evaluate(proprieta);
  expect(on).toEqual(off);
});
