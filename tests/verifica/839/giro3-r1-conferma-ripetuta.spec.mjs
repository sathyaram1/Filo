// Verifica #839 giro 3, rilievo 1 — la conferma di ripiego di Alt+S compare UNA volta anche quando davanti c'è una pagina di Filo.
// Rossa senza la cura: sulle pagine di Filo la conferma non torna al main, che la rimanda per dieci secondi e la fa ricomparire.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body style="background:#fda085"><h1>${t}</h1></body></html>`;

function dispatchAltS(app) {
  return app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
}
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const blocca = (page) => page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });

// Conta le conferme che nascono nella pagina durante `ms`, compresa quella già presente.
function contaComparse(pagina, ms) {
  return pagina.evaluate(async (durata) => {
    const viste = new Set();
    const guarda = () => { for (const p of document.querySelectorAll('.sn-save-confirm')) viste.add(p); };
    guarda();
    const mo = new MutationObserver(guarda);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    await new Promise((r) => setTimeout(r, durata));
    mo.disconnect();
    return viste.size;
  }, ms);
}

test('pagina bloccata con «Aperti per dopo» davanti: la conferma compare una volta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const lista = await openTab('filo://home/home.html');
  await lista.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
  const url = testServer.html(PAGINA('Bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await blocca(page);
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  await expect.poll(() => schede(app).then((s) => s.includes(url)), { timeout: 12000 }).toBe(false);
  await lista.waitForSelector('.sn-save-confirm', { timeout: 12000 });
  expect(await contaComparse(lista, 12000), 'la conferma è ricomparsa più volte sulla pagina di Filo').toBe(1);
});

test('unica scheda bloccata: nella nuova scheda la conferma compare una volta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const url = testServer.html(PAGINA('Unica'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    for (const t of tm.tabs.filter((y) => y.url.startsWith('filo://newtab/'))) tm.closeTab(t.id);
  });
  await blocca(page);
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  let nuova = null;
  await expect.poll(() => { nuova = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab/'); } catch (_) { return false; } }); return !!nuova; }, { timeout: 12000 }).toBe(true);
  await nuova.waitForSelector('.sn-save-confirm', { timeout: 12000 });
  expect(await contaComparse(nuova, 12000), 'la conferma è ricomparsa più volte nella nuova scheda').toBe(1);
});
