// Verifica #798 giro 3, r2: un <embed type="text/html"> vuoto apre una finestra della pagina raggiungibile per indice,
// che la guardia non prepara: il canvas della pagina letto con le sue funzioni coincide con Off.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const PAGINA = '<!doctype html><meta charset="utf-8"><body><p>ok</p></body>';

async function letture() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const out = { pagina: fnv(c.toDataURL()) };
  const e = document.createElement('embed'); e.type = 'text/html'; e.src = 'about:blank';
  document.body.appendChild(e);
  await new Promise((r) => setTimeout(r, 1000));
  try { out.embed = fnv(window[window.length - 1].HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (err) { out.embed = 'errore ' + err.message; }
  return out;
}

test('r2 un embed vuoto letto per indice ha il rumore della pagina', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  let page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const on = await page.evaluate(letture);
  await setFpMode(openTab, 'off');
  page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const off = await page.evaluate(letture);
  expect(on.pagina).not.toBe(off.pagina);
  expect(off.embed, 'con Off la lettura riesce').toBe(off.pagina);
  expect(on.embed).toBe(on.pagina);
});
