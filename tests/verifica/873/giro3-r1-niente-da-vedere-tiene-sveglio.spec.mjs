// #873 giro 3, rilievo 1: una home che non mostra nessuna voce letta dal computer non deve tenere sveglio il lettore.
// Porte: batteria, rete e Bluetooth tutte nascoste dall'utente; finestra stretta, dove la colonna destra sparisce.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('la home non si è aperta');
}

const PIENO = {
  batteria: { livello: 42, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: ['Cuffie'] },
};

async function contaRichieste(app) {
  await app.evaluate(async (_, l) => {
    globalThis.__sistemaFinto = l;
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sistemaFinto);
    globalThis.SN_SISTEMA_MAIN._perProve.veglia(2_000);
  }, PIENO);
}
const attivo = (app) => app.evaluate(() => globalThis.SN_SISTEMA_MAIN._perProve.attivo());
const richieste = async (app) => ((await attivo(app)) ? 1 : 0);

test('con batteria, rete e Bluetooth nascoste la home non tiene sveglio il lettore', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtab(app);
  await contaRichieste(app);
  await page.evaluate(() => window.filo.message({
    type: window.SN_MSG.MSG.UPDATE_SETTINGS,
    settings: { homeSistema: { batteria: false, rete: false, bluetooth: false } },
  }));
  for (const v of ['batteria', 'rete', 'bluetooth']) {
    await expect(page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`)).toBeHidden({ timeout: 5_000 });
  }
  await expect.poll(() => attivo(app), { timeout: 10_000 }).toBe(false);
  // La home richiama ogni 30 secondi: dopo 33 nessuna richiesta deve averla tenuta sveglia.
  await expect.poll(() => attivo(app), { timeout: 34_000, intervals: [500] }).toBe(true).catch(() => {});
  expect(await richieste(app)).toBe(0);
});

test('in una finestra stretta, dove la colonna destra non c\'è, la home non tiene sveglio il lettore', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await newtab(app);
  await contaRichieste(app);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.unmaximize();
    w.setSize(700, 700);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 5_000 }).toBeLessThanOrEqual(720);
  await expect(page.locator('#right')).toBeHidden();
  await expect.poll(() => attivo(app), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => attivo(app), { timeout: 34_000, intervals: [500] }).toBe(true).catch(() => {});
  expect(await richieste(app)).toBe(0);
});
