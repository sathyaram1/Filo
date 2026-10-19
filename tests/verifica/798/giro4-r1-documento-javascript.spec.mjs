// Verifica #798 giro 4, r1: un riquadro vuoto già nella pagina che riceve un documento da un indirizzo javascript: (src
// dato dopo, location, setAttribute, riquadro scritto nell'HTML) esegue gli script di quel documento senza rumore.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const IMPRONTA = `
  function fnv(s) { var a = 2166136261; for (var i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); }
  function impronta(doc) {
    var c = doc.createElement('canvas'); c.width = 80; c.height = 40;
    var x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40);
    x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
    return fnv(c.toDataURL());
  }`;
const interno = (chi) => `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  parent.postMessage({ chi: ${JSON.stringify(chi)}, valore: impronta(document) }, '*');</script></body>`;
const PAGINA = `<!doctype html><meta charset="utf-8"><body><iframe id="scritto"></iframe><script>${IMPRONTA}</script></body>`;

async function letture(html) {
  /* global impronta */
  const dalDocumento = {};
  window.addEventListener('message', (e) => { if (e.data && e.data.chi) dalDocumento[e.data.chi] = e.data.valore; });
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (h) => 'javascript:' + encodeURIComponent(JSON.stringify(h));
  const nuovo = () => { const f = document.createElement('iframe'); document.body.appendChild(f); return f; };
  const out = { pagina: impronta(document) };
  { const f = nuovo(); f.src = js(html.srcDopo); await carico(f); await pausa(300); }
  { const f = nuovo(); f.contentWindow.location.href = js(html.location); await carico(f); await pausa(300); }
  { const f = nuovo(); f.setAttribute('src', js(html.attributo)); await carico(f); await pausa(300); }
  { const f = document.getElementById('scritto'); f.src = js(html.nellHtml); await carico(f); await pausa(300); }
  for (const k of Object.keys(html)) out[k] = dalDocumento[k] || 'nessuna risposta';
  return out;
}

async function leggi(openTab, testServer) {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const html = {};
  for (const k of ['srcDopo', 'location', 'attributo', 'nellHtml']) html[k] = interno(k);
  return page.evaluate(letture, html);
}

test('r1 un riquadro vuoto che riceve un documento da un indirizzo javascript: ha il rumore della pagina', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const on = await leggi(openTab, testServer);
  await setFpMode(openTab, 'off');
  const off = await leggi(openTab, testServer);
  expect(on.pagina).not.toBe(off.pagina);
  for (const k of Object.keys(on)) {
    if (k === 'pagina') continue;
    expect.soft(off[k], `${k}: con Off la lettura riesce`).toBe(off.pagina);
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  }
});
