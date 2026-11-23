// Verifica #349.2, giro 1: la stessa regola sulla pulizia chiesta a mano («Riordina e archivia»), col modello lento.
import { test, expect } from '../../fixtures/electron.mjs';

test('riordino a mano: la scheda ripresa nell’attesa resta, quella chiusa a mano non si conta né si riapre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const titoli = () => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));
  for (const n of ['Uno', 'Due', 'Tre', 'Quattro']) await openTab(testServer.html(`<!doctype html><title>${n}</title><h1>${n}</h1>`));
  await expect.poll(titoli, { timeout: 15_000 }).toEqual(expect.arrayContaining(['Uno', 'Due', 'Tre', 'Quattro']));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const vecchio = Date.now() - 3 * 24 * 3600 * 1000;
    for (const t of tm.tabs) if (!/Quattro/.test(t.title || '')) t.lastInteractionAt = vecchio;
    globalThis.__chiesto = false;
    const via = new Promise((r) => { globalThis.__rispondi = r; });
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
      globalThis.__chiesto = true;
      await via;
      return { decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'test' })) };
    };
    globalThis.__esito = null;
    tm.runAutoTriage({ trigger: 'manual' }).then((e) => { globalThis.__esito = e; });
  });
  await expect.poll(() => app.evaluate(() => globalThis.__chiesto), { timeout: 20_000 }).toBe(true);
  const id = async (re) => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs))
    .find((t) => re.test(t.title || '')).id;
  await shell.evaluate((x) => window.filoShell.tabs.activate(x), await id(/^Due$/));
  await new Promise((r) => setTimeout(r, 400));
  await shell.evaluate((x) => window.filoShell.tabs.activate(x), await id(/^Quattro$/));
  await shell.evaluate((x) => window.filoShell.tabs.close(x), await id(/^Tre$/));
  await expect.poll(titoli, { timeout: 10_000 }).not.toContain('Tre');
  const primaDellaRisposta = (await titoli()).length;
  await app.evaluate(() => globalThis.__rispondi());
  await expect.poll(() => app.evaluate(() => globalThis.__esito), { timeout: 20_000 }).not.toBeNull();
  const t = await titoli();
  expect(t, 'la scheda ripresa nell’attesa è stata chiusa').toContain('Due');
  expect(t).not.toContain('Uno');
  // Il conto della pulizia è quello delle schede che ha chiuso lei, non di più.
  expect((await app.evaluate(() => globalThis.__esito)).archived, 'la scheda chiusa a mano è contata dalla pulizia').toBe(primaDellaRisposta - t.length);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.riapriPulizia(tm._ultimaPulizia.id);
  });
  await expect.poll(titoli, { timeout: 15_000 }).toContain('Uno');
  await new Promise((r) => setTimeout(r, 1500));
  expect(await titoli(), '«Riapri» ha riportato la scheda chiusa a mano').not.toContain('Tre');
});
