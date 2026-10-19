// Esplorazione #798 giro 3: altre porte per indice e costo delle funzioni che inseriscono.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const INNER = '<!doctype html><meta charset="utf-8"><body><p>dentro</p></body>';
const PAGINA = `<!doctype html><meta charset="utf-8"><body><p>ok</p>
<div id="dsd"><template shadowrootmode="open"><iframe></iframe></template></div>
<script>window.__dsd = (function(){ try { return window[window.length-1].HTMLCanvasElement.prototype.toDataURL; } catch(e){ return null; } })();</script>
</body>`;

async function porte(innerUrl) {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const leggiF = (fn) => { try { return fnv(fn.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const leggi = (W) => { try { return W ? leggiF(W.HTMLCanvasElement.prototype.toDataURL) : 'nessuna finestra'; } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const attendiLoad = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 3000); });
  const out = { pagina: fnv(c.toDataURL()), lunghezza0: window.length };
  out.dsdParser = window.__dsd ? leggiF(window.__dsd) : 'nessuna';
  { const h = document.createElement('div'); const sr = h.attachShadow({ mode: 'open' }); sr.appendChild(document.createElement('iframe')); document.body.appendChild(h); out.ombraPoiHost = leggi(ultimo()); }
  { const h = document.createElement('div'); document.body.appendChild(h); h.setHTMLUnsafe('<div><template shadowrootmode="open"><iframe></iframe></template></div>'); out.setHTMLUnsafeDsd = leggi(ultimo()); }
  { const f = document.createElement('iframe'); f.src = innerUrl; document.body.appendChild(f); await attendiLoad(f); const i = window.length - 1; f.src = 'about:blank'; await attendiLoad(f); out.srcPoiAboutBlank = leggi(window[i]); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const i = window.length - 1; f.src = 'about:blank'; await attendiLoad(f); out.vuotoPoiAboutBlank = leggi(window[i]); }
  { const e = document.createElement('embed'); e.type = 'text/html'; e.src = 'about:blank'; document.body.appendChild(e); await new Promise((r) => setTimeout(r, 800)); out.embedLen = window.length; out.embed = leggi(ultimo()); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const i = window.length - 1; f.srcdoc = '<p>s</p>'; await attendiLoad(f); out.vuotoPoiSrcdoc = leggi(window[i]); }
  { const f = document.createElement('iframe'); document.body.appendChild(f); const i = window.length - 1; f.src = innerUrl; await attendiLoad(f); out.vuotoPoiStessaOrigine = leggi(window[i]); }
  { const f = document.createElement('iframe'); f.src = "javascript:'<p>js</p>'"; document.body.appendChild(f); const i = window.length - 1; await attendiLoad(f); out.jsUrl = leggi(window[i]); }
  { const f = document.createElement('iframe'); f.name = 'nominato'; f.src = innerUrl; document.body.appendChild(f); await attendiLoad(f); window.nominato.location = 'about:blank'; await attendiLoad(f); out.nomePoiAboutBlank = leggi(window.nominato); }
  { document.body.insertAdjacentHTML('beforeend', '<embed type="text/html" src="about:blank">'); await new Promise((r) => setTimeout(r, 800)); out.embedHtml = leggi(ultimo()); }
  // costo
  const t0 = performance.now(); const box = document.createElement('div'); document.body.appendChild(box);
  for (let i = 0; i < 100000; i++) { const d = document.createElement('div'); d.textContent = 'x'; box.appendChild(d); }
  out.ms100kAppend = Math.round(performance.now() - t0);
  const t1 = performance.now();
  for (let i = 0; i < 3000; i++) { const s = document.createElement('section'); s.innerHTML = '<p>a</p><p>b</p><span>object frame</span>'; box.appendChild(s); }
  out.ms3kInnerHTML = Math.round(performance.now() - t1);
  box.remove();
  return out;
}

test('esplora porte giro 3', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const inner = testServer.html(INNER);
  const url = testServer.html(PAGINA);
  let page = await openTab(url);
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const on = await page.evaluate(porte, inner);
  await setFpMode(openTab, 'off');
  page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const off = await page.evaluate(porte, inner);
  console.log('ESITO ON ' + JSON.stringify(on));
  console.log('ESITO OFF ' + JSON.stringify(off));
});
