// Cattura visiva temporanea (#536): colonna live e registro in Preferenze,
// tema chiaro e tema scuro. Non fa parte della suite.
import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';

async function homePage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no newtab');
}

for (const tema of ['light', 'dark']) {
  test(`vista ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    const home = await homePage(app);
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: t });
      const TG = globalThis.SN_TEXT_GUARDIAN;
      TG.configure({ pausaMs: 0, eseguiModello: async () => '{"esito":"passa"}' });
      await TG.proponiNotifica({
        testo: 'Marco ha caricato le foto del weekend: [apri l’album](https://album.esempio.it/weekend)',
        kind: 'info', fiducia: 'contaminato', origine: 'una mail di Marco Bianchi',
      });
      await TG.proponiNotifica({
        testo: 'Conferma le credenziali: [banca-esempio.it](https://banca-esempio.it.attacco.ru/login)',
        kind: 'alert', fiducia: 'contaminato', origine: 'una mail di Banca Esempio',
        regolaAutomazione: 'avvisami delle mail importanti',
      });
      TG.configure({ pausaMs: 0, eseguiModello: async () => { throw new Error('giu'); } });
      await TG.proponiNotifica({
        testo: 'Un avviso ancora da controllare.',
        kind: 'info', fiducia: 'contaminato', origine: 'una mail di Assistenza',
      });
    }, tema);
    await home.reload();
    await expect(home.locator('.dash-live-card').first()).toBeVisible({ timeout: 10_000 });
    await home.screenshot({ path: `/tmp/claude-0/-home-user-Filo/afefbe1e-114f-576f-9c1e-2da7d1d6c63d/scratchpad/live-${tema}.png` });

    const pref = await openTab('filo://preferences/preferences.html');
    await expect(pref.locator('#guardBlocksList .guard-item').first()).toBeVisible({ timeout: 10_000 });
    await pref.locator('.guard-toggle').first().click();
    await pref.locator('#sec-guard-blocks').scrollIntoViewIfNeeded();
    await pref.screenshot({ path: `/tmp/claude-0/-home-user-Filo/afefbe1e-114f-576f-9c1e-2da7d1d6c63d/scratchpad/pref-${tema}.png` });
  });
}
