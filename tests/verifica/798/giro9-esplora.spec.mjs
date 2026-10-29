// Verifica #798 giro 9: esplorazione.
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
    x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24); return { c: c, x: x }; }
  function impronta() { return fnv(scena(document).c.toDataURL()); }
`;
const interno = (chi) => `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  parent.postMessage({ lettura: ${JSON.stringify(chi)}, valore: impronta(), csi: typeof (window.chrome && chrome.csi), pronto: document.documentElement.dataset.filoReady || '' }, '*');
  setTimeout(function () { parent.postMessage({ lettura: ${JSON.stringify(chi)} + '_dopo', valore: impronta(), csi: typeof (window.chrome && chrome.csi), pronto: document.documentElement.dataset.filoReady || '' }, '*'); }, 1500);
</script></body>`;

async function prove(urls) {
  const out = {};
  const msgs = {};
  addEventListener('message', (e) => { if (e.data && e.data.lettura) msgs[e.data.lettura] = e.data; });
  const attendi = (k, ms = 6000) => new Promise((res) => { const t0 = Date.now(); const t = () => (msgs[k] || Date.now() - t0 > ms ? res(msgs[k] || null) : setTimeout(t, 25)); t(); });
  const { c } = scena(document);
  out.pagina = fnv(c.toDataURL());
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };

  // 1. riquadro della stessa origine toccato prima del carico
  { const f = document.createElement('iframe'); f.src = urls.toccato; document.body.appendChild(f); try { void f.contentWindow.document; } catch (e) {} out.toccato = await attendi('toccato'); out.toccato_dopo = await attendi('toccato_dopo'); }
  { const f = document.createElement('iframe'); f.src = urls.liscio; document.body.appendChild(f); out.liscio = await attendi('liscio'); }
  { const f = document.createElement('iframe'); f.src = urls.soloRif; document.body.appendChild(f); const w = f.contentWindow; out.soloRif = await attendi('soloRif'); out.soloRifW = !!w; }
  // 2. blob
  { const b = new Blob([urls.blobHtml], { type: 'text/html' }); const f = document.createElement('iframe'); f.src = URL.createObjectURL(b); document.body.appendChild(f); out.blob = await attendi('blob'); await new Promise((r) => setTimeout(r, 300)); out.blobDaQui = leggi(f.contentWindow); }
  // 3. document.body = nuovo body con riquadro
  { const nb = document.createElement('body'); const vecchio = document.body; nb.innerHTML = '<p>b</p>'; const f = document.createElement('iframe'); nb.appendChild(f);
    document.body = nb; out.bodySetter = leggi(window[window.length - 1]); document.documentElement.replaceChild(vecchio, nb); }
  // 4. funzione presa da un riquadro poi tolto
  { const f = document.createElement('iframe'); document.body.appendChild(f); const fn = f.contentWindow.HTMLCanvasElement.prototype.toDataURL; f.remove(); try { out.staccato = fnv(fn.call(c)); } catch (e) { out.staccato = 'errore ' + e.message; } }
  // 5. annidato per indice subito
  { const f = document.createElement('iframe'); document.body.appendChild(f); const d = f.contentDocument; const g = d.createElement('iframe'); d.body.appendChild(g); out.annidatoIndice = leggi(window[window.length - 1][0]); }
  // 6. table.tHead setter / caption setter con riquadro dentro
  { const t = document.createElement('table'); document.body.appendChild(t); const th = document.createElement('thead'); th.appendChild(document.createElement('iframe')); t.tHead = th; out.tHead = leggi(window[window.length - 1]); }
  { const t = document.createElement('table'); document.body.appendChild(t); const cap = document.createElement('caption'); cap.appendChild(document.createElement('iframe')); t.caption = cap; out.caption = leggi(window[window.length - 1]); }
  // 7. template content adottato con importNode e inserito con cloneNode? (appendChild coperto) — outerText/ textContent no.
  // 8. riquadro spostato con appendChild (nuova finestra)
  { const f = document.createElement('iframe'); document.body.appendChild(f); const div = document.createElement('div'); document.body.appendChild(div); div.appendChild(f); out.spostato = leggi(window[window.length - 1]); }
  return out;
}

test('esplora', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const urls = { toccato: testServer.html(interno('toccato')), liscio: testServer.html(interno('liscio')), soloRif: testServer.html(interno('soloRif')), blobHtml: interno('blob') };
  const pagina = testServer.html(`<!doctype html><html><head><meta charset="utf-8"><script>${IMPRONTA}</script></head><body><p>ok</p></body></html>`);
  const page = await openTab(pagina);
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const on = await page.evaluate(prove, urls);
  await setFpMode(openTab, 'off');
  await page.goto(pagina + '?off');
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  const off = await page.evaluate(prove, urls);
  console.log('ON', JSON.stringify(on, null, 1));
  console.log('OFF', JSON.stringify(off, null, 1));
});
