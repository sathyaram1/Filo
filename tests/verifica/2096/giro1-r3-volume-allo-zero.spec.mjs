// Verifica #2096 giro 1, rilievo 3: nel tasto destro del volume la prima voce si legge «Volume al 0%» invece di
// «Volume allo 0%». Il computer è finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

test('r3 il tasto destro sul volume dice «Volume allo 0%»', async ({ app }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    globalThis.__pc = {
      batteria: { livello: 70, inCarica: false, collegata: false },
      rete: { online: true, tipo: 'wifi', nome: 'Casa' },
      bluetooth: { acceso: true, dispositivi: [] },
      volume: { livello: 25, muto: false },
      wifi: { acceso: true },
    };
    const pc = globalThis.__pc;
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) { const prima = pc.volume.livello; if (p.livello != null) pc.volume.livello = p.livello; return { ok: true, volume: pc.volume.livello, muto: false, prima }; },
      async radio(p) { return { ok: true, acceso: p.acceso }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  });
  const page = await home(app);
  await expect(page.locator('#sistema .dash-sis-voce[data-voce="volume"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('#sistema .dash-sis-voce[data-voce="volume"]').click();
  const cursore = page.locator('.dash-sis-box .dash-sis-cursore');
  await expect(cursore).toBeVisible();
  await cursore.click({ button: 'right' });
  await expect(menuDi(page).voce('Volume al 50%')).toBeVisible();
  await expect(menuDi(page).voce('Volume allo 0%')).toBeVisible();
});
