// #873 giro 4, rilievo 2 — con qualche avviso nella colonna destra, ora e batteria finiscono sotto il bordo della
// finestra: per vederle bisogna scorrere tutta la home.
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

test('con quindici avvisi nella colonna destra ora e batteria restano dentro la finestra', async ({ app }) => {
  await app.evaluate(async () => {
    globalThis.__f = { batteria: { livello: 64, inCarica: false, collegata: false }, rete: { online: true, tipo: 'wifi', nome: 'Casa' }, bluetooth: { acceso: true, dispositivi: ['Cuffie'] } };
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__f);
    const M = globalThis.SN_FILO_MEMORY;
    await M.addTimer({ label: 'Pasta', seconds: 600 });
    for (let i = 0; i < 15; i++) await M.addNotification({ kind: 'info', text: `Avviso numero ${i} scaduto` });
  });
  const page = await newtab(app);
  const batteria = page.locator('#sistema .dash-sis-voce[data-voce="batteria"]');
  await expect(batteria).toHaveText('64%', { timeout: 8000 });
  await page.waitForTimeout(500);
  const dentro = await page.evaluate(() => {
    const r = document.querySelector('#sistema .dash-sis-voce[data-voce="batteria"]').getBoundingClientRect();
    return r.bottom <= window.innerHeight && r.top >= 0;
  });
  expect(dentro, 'la batteria si vede senza scorrere').toBe(true);
});
