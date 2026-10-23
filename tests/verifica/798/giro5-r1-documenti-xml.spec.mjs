// Verifica #798 giro 5, r1: un riquadro della stessa origine con un documento XML o SVG (dal sito, da un blob, in un
// object) dà funzioni di esportazione del canvas che leggono il canvas della pagina senza rumore.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>';

async function letture({ svgUrl, xmlUrl, SVG }) {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const blobHash = (b) => b.arrayBuffer().then((a) => { const u = new Uint8Array(a); let t = ''; for (let i = 0; i < u.length; i++) t += String.fromCharCode(u[i]); return fnv(t); });
  const comeBlob = (W) => new Promise((r) => { try { W.HTMLCanvasElement.prototype.toBlob.call(c, (b) => blobHash(b).then(r)); } catch (e) { r('errore ' + e.message); } });
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const blob = (s, t) => URL.createObjectURL(new Blob([s], { type: t }));
  const out = { pagina: fnv(c.toDataURL()), paginaBlob: await comeBlob(window) };
  const casi = {
    svgDelSito: (f) => { f.src = svgUrl; },
    xmlDelSito: (f) => { f.src = xmlUrl; },
    svgDaBlob: (f) => { f.src = blob(SVG, 'image/svg+xml'); },
    xmlDaBlob: (f) => { f.src = blob('<a/>', 'text/xml'); },
  };
  for (const [nome, riempi] of Object.entries(casi)) {
    const f = document.createElement('iframe'); riempi(f); document.body.appendChild(f); await carico(f);
    await new Promise((r) => setTimeout(r, 300));
    out[nome] = leggi(f.contentWindow);
  }
  const o = document.createElement('object'); o.type = 'image/svg+xml'; o.data = blob(SVG, 'image/svg+xml');
  document.body.appendChild(o); await carico(o); await new Promise((r) => setTimeout(r, 300));
  out.objectSvg = leggi(o.contentWindow);
  out.objectSvgBlob = await comeBlob(o.contentWindow);
  return out;
}

test('r1 le funzioni di un riquadro XML o SVG della stessa origine leggono il canvas col rumore della pagina', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const svgUrl = testServer.asset(SVG, 'image/svg+xml');
  const xmlUrl = testServer.asset('<a/>', 'text/xml');
  const leggi = async () => {
    const page = await openTab(testServer.html('<!doctype html><meta charset="utf-8"><body><p>ok</p></body>'));
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    return page.evaluate(letture, { svgUrl, xmlUrl, SVG });
  };
  const on = await leggi();
  await setFpMode(openTab, 'off');
  const off = await leggi();
  expect(on.pagina).not.toBe(off.pagina);
  for (const k of ['svgDelSito', 'xmlDelSito', 'svgDaBlob', 'xmlDaBlob', 'objectSvg']) {
    expect.soft(off[k], `${k}: con Off la lettura riesce`).toBe(off.pagina);
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  }
  expect.soft(on.objectSvgBlob, 'toBlob da un object SVG: col rumore della pagina').toBe(on.paginaBlob);
});
