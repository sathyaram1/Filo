// Esplorazione 3 del giro 3: quello che il mondo della pagina vede di una scheda che le passa sopra. Si cancella.

import { test, expect } from '../../fixtures/electron.mjs';
import { disponibili, finestraASchermo, trascina } from '../../helpers/gestiVeri.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2) * o.z), y: Math.round(o.y + (r.y + r.height / 2) * o.z) };
}
async function sulloSchermo(app, doc, sel) {
  const r = await doc.locator(sel).first().boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    const tm = w._filoTabs;
    const vb = tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
    return { x: cb.x + vb.x, y: cb.y + vb.y };
  });
  return { x: Math.round(o.x + r.x + r.width / 2), y: Math.round(o.y + r.y + r.height / 2) };
}

test.describe.configure({ retries: 0 });
test.beforeEach(() => { test.skip(!disponibili(), 'niente XTest'); });

const SPIA = `<script>
  window.__visto = [];
  const cerca = (s) => { try { s = typeof s === 'string' ? s : JSON.stringify(s); } catch (_) { s = String(s); } if (/SEGRETO|Conto corrente/.test(s)) window.__visto.push(s.slice(0, 200)); };
  for (const t of ['message','dragenter','dragover','drop','paste','beforeinput','input','focus','mousemove','pointermove','filo','custom']) addEventListener(t, (e) => { cerca(e.data); cerca(e.detail); try { cerca(e.dataTransfer && e.dataTransfer.getData('text')); } catch (_) {} }, true);
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') cerca(m.target.getAttribute(m.attributeName)); for (const n of m.addedNodes || []) cerca(n.outerHTML || n.textContent); if (m.type === 'characterData') cerca(m.target.data); } }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(() => { cerca(document.documentElement.outerHTML); }, 100);
</script>`;

test('L una scheda che passa sopra una pagina senza esserci lasciata: la pagina non ne vede titolo né indirizzo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const segreta = testServer.html('<title>Conto corrente di Mario</title><p>saldo') + '?SEGRETO=1';
  await openTab(segreta);
  const id = await idPerUrl(shell, segreta);
  const altra = testServer.html('<title>Altra</title><p>x');
  await openTab(altra);
  const pagina = await openTab(testServer.html(`<title>Spia</title>${SPIA}<p style="margin-top:300px">testo</p>
    <textarea id="t" style="width:300px;height:60px"></textarea><iframe src="${testServer.html('<title>f</title>' + SPIA + '<textarea id=u></textarea>', { pubblico: true })}" style="width:300px;height:100px"></iframe>`));
  await finestraASchermo(app);
  await pagina.waitForTimeout(800);
  const t = await sulloSchermo(app, pagina, '#t');
  const p = await sulloSchermo(app, pagina, 'p');
  const fr = await sulloSchermo(app, pagina, 'iframe');
  const da = await linguetta(app, shell, id);
  // Sopra la pagina, sopra il campo, sopra il riquadro, e ritorno alla fila.
  trascina(da, p, t, fr, { x: da.x + 5, y: da.y });
  await pagina.waitForTimeout(800);
  const visto = await pagina.evaluate(() => window.__visto);
  const vistoF = await pagina.frames()[1]?.evaluate(() => window.__visto).catch(() => 'n/d');
  console.log('L-PAGINA', JSON.stringify(visto), 'L-RIQUADRO', JSON.stringify(vistoF));
  // Rilascio sopra il testo della pagina (non un campo).
  trascina(await linguetta(app, shell, id), p);
  await pagina.waitForTimeout(800);
  console.log('L-RILASCIO-NON-CAMPO', JSON.stringify(await pagina.evaluate(() => window.__visto)));
  console.log('L-ORDINE', JSON.stringify((await schede(shell)).map((x) => x.title)));
});
