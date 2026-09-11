// Verifica #536 — giro 1: come si vedono le righe del guardiano, nei due temi.
//
// Cattura la colonna della home con le tre righe che questo lavoro introduce
// (avviso passato con un collegamento, riga di blocco, riga «in attesa») e la
// sezione «Avvisi fermati» delle Preferenze, in tema chiaro e in tema scuro.
// Le immagini restano in tests/.shots/ come traccia del giro.

// Nota del giro 2: chi propone un avviso contaminato dichiara anche QUALE
// modello ne ha scritto il testo (`produttore`). Senza, il controllo non ha
// nessuno da escludere dalla propria catena e l'avviso resta in coda: qui
// serve solo a far arrivare l'avviso dove la prova lo aspetta.
import { test, expect } from '../../fixtures/electron.mjs';

async function homePage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function riempi(app) {
  await app.evaluate(async () => {
    const TG = globalThis.SN_TEXT_GUARDIAN;
    TG.configure({ pausaMs: 0, eseguiModello: async () => '{"esito":"passa"}' });
    await TG.proponiNotifica({
      testo: 'Marco ha caricato le foto del weekend: [apri le foto](https://album.esempio.it/weekend)',
      kind: 'info', fiducia: 'contaminato', origine: 'una mail di Marco Bianchi',
      produttore: 'deepseek',
    });
    await TG.proponiNotifica({
      testo: 'Conferma il conto: [banca-esempio.it](https://banca-esempio.it.attacco.ru/login)',
      kind: 'alert', fiducia: 'contaminato', origine: 'una mail di Banca Esempio',
      produttore: 'deepseek',
    });
    TG.configure({ eseguiModello: async () => { throw new Error('giu'); } });
    await TG.proponiNotifica({
      testo: 'Il rendiconto trimestrale è pronto.',
      kind: 'info', fiducia: 'contaminato', origine: 'una mail di banca@esempio.it',
      produttore: 'deepseek',
    });
  });
}

for (const tema of ['light', 'dark']) {
  test(`le righe del guardiano nel tema ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    const home = await homePage(app);
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: t });
    }, tema);
    await riempi(app);

    await expect(home.locator('.dash-live-card[data-guardiano="blocco"]')).toHaveCount(1, { timeout: 8_000 });
    await expect(home.locator('.dash-live-card[data-guardiano="attesa"]')).toHaveCount(1);
    await home.reload();
    await expect(home.locator('.dash-live-card').first()).toBeVisible({ timeout: 8_000 });
    await home.screenshot({ path: `tests/.shots/verifica-536-home-${tema}.png` });

    const pref = await openTab('filo://preferences/preferences.html');
    await expect(pref.locator('#guardBlocksList .guard-item')).toHaveCount(1, { timeout: 8_000 });
    await pref.locator('.guard-toggle').first().click();
    await pref.locator('#sec-guard-blocks').screenshot({ path: `tests/.shots/verifica-536-pref-${tema}.png` });
  });
}
