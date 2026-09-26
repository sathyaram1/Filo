// Giro 5 della verifica «avviso GitHub su github.io»: lo stesso avviso falso resta sui siti github.io veri il cui
// nome contiene un brand, sia quelli ufficiali dei brand sia quelli personali con una parola comune. Rete vera.
import { test, expect } from '../../fixtures/electron.mjs';

const tabLevel = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w._filoTabs) continue;
    for (const t of w._filoTabs.tabs) {
      let u = '';
      try { u = new URL(t.view.webContents.getURL()).hostname; } catch (_) {}
      if (u === h) return t.sbLevel || null;
    }
  }
  return null;
}, host);

const UFFICIALI = [
  ['https://google.github.io/styleguide/', 'google.github.io'],
  ['https://microsoft.github.io/monaco-editor/', 'microsoft.github.io'],
  ['https://googlechromelabs.github.io/chrome-for-testing/', 'googlechromelabs.github.io'],
];

for (const [url, host] of UFFICIALI) {
  test(`sito ufficiale di un brand su GitHub Pages, ${host}: si legge senza avviso`, async ({ app, openTab }) => {
    test.fail(true, 'rilievo aperto del giro 5: il nome del brand come utente di github.io fa scattare «Controlla l\'indirizzo»');
    const page = await openTab(url);
    await page.waitForLoadState('load').catch(() => {});
    const visti = new Set();
    const fine = Date.now() + 10_000;
    while (Date.now() < fine) {
      const l = await tabLevel(app, host);
      if (l) visti.add(l);
      await page.waitForTimeout(500);
    }
    expect((await page.title()).length).toBeGreaterThan(0);
    expect([...visti]).toEqual(['safe']);
    await expect(page.getByText(/Controlla l.indirizzo/)).toHaveCount(0);
  });
}

test('siti personali su github.io con una parola comune che contiene un brand: nessun avviso', async ({ app }) => {
  test.fail(true, 'rilievo aperto del giro 5: pineapple fa scattare Apple, otherwise fa scattare Wise');
  const v = await app.evaluate(() => ['https://pineapple.github.io/', 'https://otherwise.github.io/', 'https://bitwise.github.io/']
    .map((u) => [u, globalThis.SN_SAFEBROWSE.checkSync(u, {}).level]));
  expect(Object.fromEntries(v)).toEqual({
    'https://pineapple.github.io/': 'safe', 'https://otherwise.github.io/': 'safe', 'https://bitwise.github.io/': 'safe',
  });
});
