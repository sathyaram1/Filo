// #798 — la protezione anti-impronta vale anche nei riquadri che sono la pagina sotto un altro nome: quelli
// vuoti creati dalla pagina (le loro funzioni di disegno e di audio) e quelli dello stesso sito, con
// indirizzo, srcdoc, data: o blob:. Un riquadro di un altro sito resta com'era (scelta a parte).

import { test, expect } from './fixtures/electron.mjs';

// Legge canvas (toDataURL, getImageData), WebGL (readPixels) e audio con le funzioni della finestra `win`,
// su oggetti del documento corrente: è il trucco del riquadro vuoto. `dev` conta i pixel diversi dal colore pieno.
const LEGGI = `function __leggi(win) {
  var W = 64, H = 32;
  var c = document.createElement('canvas'); c.width = W; c.height = H;
  var x = c.getContext('2d'); x.fillStyle = 'rgb(120,60,200)'; x.fillRect(0, 0, W, H);
  var url = win.HTMLCanvasElement.prototype.toDataURL.call(c);
  var d = win.CanvasRenderingContext2D.prototype.getImageData.call(x, 0, 0, W, H).data;
  var dev = 0;
  for (var i = 0; i < d.length; i += 4) if (d[i] !== 120 || d[i + 1] !== 60 || d[i + 2] !== 200) dev++;
  var gl = 'senza webgl';
  try {
    var gc = document.createElement('canvas'); gc.width = 16; gc.height = 16;
    var g = gc.getContext('webgl');
    if (g) {
      g.clearColor(0.47, 0.24, 0.78, 1); g.clear(g.COLOR_BUFFER_BIT);
      var px = new Uint8Array(16 * 16 * 4);
      win.WebGLRenderingContext.prototype.readPixels.call(g, 0, 0, 16, 16, g.RGBA, g.UNSIGNED_BYTE, px);
      gl = Array.prototype.join.call(px, ',');
    }
  } catch (e) { gl = 'errore ' + e.message; }
  var ac = new win.OfflineAudioContext(1, 5000, 44100);
  var o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000;
  var k = ac.createDynamicsCompressor(); o.connect(k); k.connect(ac.destination); o.start(0);
  return ac.startRendering().then(function (b) {
    return { url: url, img: Array.prototype.join.call(d, ','), dev: dev, gl: gl,
             audio: Array.prototype.join.call(b.getChannelData(0).subarray(4500, 5000), ',') };
  });
}`;

// Ogni porta per arrivare alla finestra di un riquadro vuoto appena creato dalla pagina.
const PORTE = `(async () => {
  ${LEGGI}
  var out = {};
  var nuovo = function (dove) { var f = document.createElement('iframe'); (dove || document.body).appendChild(f); return f; };
  out.pagina = await __leggi(window);
  var f0 = nuovo();
  out.contentWindow = await __leggi(f0.contentWindow);
  nuovo();
  out.indice = await __leggi(window[1]);
  nuovo();
  out.frames = await __leggi(frames[2]);
  var f3 = nuovo();
  out.contentDocument = await __leggi(f3.contentDocument.defaultView);
  var box = document.createElement('div'); document.body.appendChild(box);
  box.innerHTML = '<div><iframe></iframe></div>';
  out.innerHTML = await __leggi(window[window.length - 1]);
  var dentro = f0.contentDocument.createElement('iframe'); f0.contentDocument.body.appendChild(dentro);
  out.annidato = await __leggi(f0.contentWindow[0]);
  var host = document.createElement('div'); document.body.appendChild(host);
  var ombra = host.attachShadow({ mode: 'closed' });
  var fo = document.createElement('iframe'); ombra.appendChild(fo);
  out.ombra = await __leggi(fo.contentWindow);
  var fs = nuovo();
  fs.contentDocument.write('<script>' + __leggi.toString() + ';window.__p = __leggi(window);<\\/script>');
  fs.contentDocument.close();
  out.scrittoDentro = await fs.contentWindow.__p;
  return out;
})()`;

const PORTE_NOMI = ['contentWindow', 'indice', 'frames', 'contentDocument', 'innerHTML', 'annidato', 'ombra', 'scrittoDentro'];

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

test('le funzioni di un riquadro vuoto creato dalla pagina danno lo stesso rumore della pagina, da ogni porta', async ({ openTab, testServer }) => {
  const auto = await testServer.openReady(openTab, '<title>RIQ_AUTO</title><p>ok</p>');
  await auto.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const a = await auto.evaluate(PORTE);

  // La controprova su un altro host: openTab ritrova le schede per nome dell'host.
  await setFpMode(openTab, 'off');
  const off = await testServer.openReady(openTab, '<title>RIQ_OFF</title><p>ok</p>', { pubblico: true });
  const o = await off.evaluate(PORTE);

  expect(a.pagina.dev, 'in Automatico la pagina legge il canvas col rumore').toBeGreaterThan(0);
  expect(o.pagina.dev, 'in Off il canvas torna esatto').toBe(0);
  for (const k of ['url', 'img', 'gl', 'audio']) {
    if (k === 'gl' && a.pagina.gl === 'senza webgl') continue;
    expect(a.pagina[k], `${k}: la pagina in Automatico è diversa da Off`).not.toBe(o.pagina[k]);
  }
  for (const porta of PORTE_NOMI) {
    for (const k of ['url', 'img', 'gl', 'audio']) {
      expect(a[porta][k], `${porta} · ${k}: coincide con la pagina in Automatico`).toBe(a.pagina[k]);
      expect(o[porta][k], `${porta} · ${k}: in Off coincide con la pagina in Off`).toBe(o.pagina[k]);
    }
  }
});

// Un documento dello stesso sito che disegna e legge il PROPRIO canvas mentre si carica, prima di ogni altro script.
const LETTORE = `<!doctype html><title>lettore</title><script>${LEGGI}
window.__lettura = __leggi(window).then(function (r) { r.guardia = window.__filoFpGuard === true; return r; });
</script><p>riquadro</p>`;

async function letturaDelRiquadro(page, nome) {
  let frame = null;
  await expect.poll(() => {
    frame = page.frames().find((fr) => fr.name() === nome && /lettore/.test(fr.url() + ' ') !== null);
    return !!frame;
  }, { timeout: 8_000 }).toBe(true);
  await frame.waitForFunction(() => !!window.__lettura, null, { timeout: 8_000 });
  return frame.evaluate(() => window.__lettura);
}

test('un riquadro dello stesso sito che legge il proprio canvas ha il rumore della pagina; uno di un altro sito no', async ({ openTab, testServer }) => {
  const stesso = testServer.html(LETTORE);
  const altro = testServer.html(LETTORE).replace('127.0.0.1', 'blocked.test');
  const pagina = `<!doctype html><title>RIQ_SITI</title><body>
    <iframe id="stesso" name="stesso" src="${stesso}"></iframe>
    <iframe id="altro" name="altro" src="${altro}"></iframe>
    <iframe id="srcdoc" name="srcdoc"></iframe>
    <iframe id="dati" name="dati"></iframe>
    <iframe id="sabbia" name="sabbia" sandbox="allow-scripts"></iframe>
    <iframe id="blob" name="blob"></iframe>
    <script>
      document.getElementById('srcdoc').srcdoc = ${JSON.stringify(LETTORE)};
      document.getElementById('sabbia').srcdoc = ${JSON.stringify(LETTORE)};
      document.getElementById('dati').src = 'data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(LETTORE)});
      document.getElementById('blob').src = URL.createObjectURL(new Blob([${JSON.stringify(LETTORE)}], { type: 'text/html' }));
    </script></body>`;
  const page = await testServer.openReady(openTab, pagina);
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const top = await page.evaluate(`(async () => { ${LEGGI}; return __leggi(window); })()`);
  expect(top.dev).toBeGreaterThan(0);

  for (const nome of ['stesso', 'srcdoc', 'dati', 'sabbia', 'blob']) {
    const r = await letturaDelRiquadro(page, nome);
    expect(r.guardia, `${nome}: guardia montata prima degli script del riquadro`).toBe(true);
    for (const k of ['url', 'img', 'gl', 'audio']) {
      expect(r[k], `${nome} · ${k}: coincide con la pagina`).toBe(top[k]);
    }
  }

  const fuori = await letturaDelRiquadro(page, 'altro');
  expect(fuori.guardia, 'un riquadro di un altro sito resta senza guardia').toBe(false);
  expect(fuori.dev, 'e legge il canvas esatto').toBe(0);
});

test('un riquadro dello stesso sito toccato dalla pagina prima di caricarsi ha comunque il rumore della pagina', async ({ openTab, testServer }) => {
  const stesso = testServer.html(LETTORE);
  const page = await testServer.openReady(openTab, '<title>RIQ_PRESTO</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.id = 'presto'; f.name = 'presto'; f.src = src;
    document.body.appendChild(f);
    // La finestra iniziale (about:blank) passa di mano prima che arrivi il documento vero.
    f.contentWindow.__toccato = true;
  }, stesso);
  const top = await page.evaluate(`(async () => { ${LEGGI}; return __leggi(window); })()`);
  const r = await letturaDelRiquadro(page, 'presto');
  for (const k of ['url', 'img', 'gl', 'audio']) expect(r[k], `presto · ${k}`).toBe(top[k]);
});
