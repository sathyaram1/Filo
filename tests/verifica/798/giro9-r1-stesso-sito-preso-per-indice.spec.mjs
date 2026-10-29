// Verifica #798 giro 9. r1: un riquadro della stessa origine che la pagina prende per indice (o per nome) prima che
// carichi resta senza rumore per sempre: il suo documento legge il proprio canvas come con Off, e lo stesso la pagina
// con le funzioni di quel riquadro dopo il carico.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const IMPRONTA = `
  function fnv(s) { var a = 2166136261; for (var i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); }
  function scena(doc) { var c = doc.createElement('canvas'); c.width = 80; c.height = 40; var x = c.getContext('2d');
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24); return c; }
  window.__l = {};
  addEventListener('message', function (e) { if (e.data && e.data.lettura) window.__l[e.data.lettura] = e.data.valore; });
`;
const interno = (chi) => `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  parent.postMessage({ lettura: ${JSON.stringify(chi)}, valore: fnv(scena(document).toDataURL()) }, '*');
</script></body>`;

async function letture(urls) {
  const attendi = (k) => new Promise((res) => { const t0 = Date.now(); const t = () => (window.__l[k] || Date.now() - t0 > 8000 ? res(window.__l[k] || 'nessuna risposta') : setTimeout(t, 25)); t(); });
  const c = scena(document);
  const out = { pagina: fnv(c.toDataURL()) };
  const daQui = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  // Preso per indice subito dopo l'aggiunta.
  { const f = document.createElement('iframe'); f.src = urls.indice; document.body.appendChild(f); const w = window[window.length - 1];
    out.indiceDentro = await attendi('indice'); out.indiceDaQui = daQui(w); }
  // Preso con frames[n].
  { const f = document.createElement('iframe'); f.src = urls.frames; document.body.appendChild(f); const w = frames[frames.length - 1];
    out.framesDentro = await attendi('frames'); out.framesDaQui = daQui(w); }
  // Preso per nome.
  { const f = document.createElement('iframe'); f.name = 'perNome'; f.src = urls.nome; document.body.appendChild(f); const w = window.perNome;
    out.nomeDentro = await attendi('nome'); out.nomeDaQui = daQui(w); }
  // Scritto nell'HTML e preso per indice dallo script che lo segue.
  out.htmlDentro = await attendi('html'); out.htmlDaQui = daQui(window.__html);
  return out;
}

test('r1 un riquadro della stessa origine preso per indice prima del carico ha il rumore della pagina', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const urls = { indice: testServer.html(interno('indice')), frames: testServer.html(interno('frames')), nome: testServer.html(interno('nome')) };
  const pagina = testServer.html(`<!doctype html><html><head><meta charset="utf-8"><script>${IMPRONTA}</script></head><body>
    <iframe src="${testServer.html(interno('html'))}"></iframe><script>window.__html = frames[0];</script></body></html>`);
  const page = await openTab(pagina);
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const on = await page.evaluate(letture, urls);
  await setFpMode(openTab, 'off');
  await page.goto(pagina + '?off');
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const off = await page.evaluate(letture, urls);
  expect(on.pagina).not.toBe(off.pagina);
  for (const k of ['indiceDentro', 'indiceDaQui', 'framesDentro', 'framesDaQui', 'nomeDentro', 'nomeDaQui', 'htmlDentro', 'htmlDaQui']) {
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  }
});
