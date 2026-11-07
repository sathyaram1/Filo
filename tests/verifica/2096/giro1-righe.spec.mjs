// Verifica #2096 giro 1: il tasto destro sulle righe di sistema della chat (Annulla) e sulle pastiglie delle
// Impostazioni rapide (Accendi/Spegni, Apri la voce in Preferenze).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app) {
  await app.evaluate(async (_, stato) => {
    globalThis.__pc = JSON.parse(JSON.stringify(stato));
    const pc = globalThis.__pc;
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) {
        const prima = pc.volume.livello;
        if (p.livello != null) pc.volume.livello = p.livello;
        if (p.muto != null) pc.volume.muto = p.muto;
        return { ok: true, volume: pc.volume.livello, muto: pc.volume.muto, prima };
      },
      async radio(p) { return { ok: true, acceso: p.acceso }; },
      async btElenco() { return { ok: true, acceso: true, dispositivi: [] }; },
      async wifiElenco() { return { ok: true, acceso: true, reti: [], attuale: null }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, PARTENZA);
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

test('riga «Volume al 40%» nella chat: il tasto destro annulla e il volume torna al 25%', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'v1', name: 'VOLUME', arguments: JSON.stringify({ livello: 40 }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'volume al 40');
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.livello), { timeout: 20_000 }).toBe(40);
  const riga = page.locator('.dash-activity-row', { hasText: 'Volume al 40%' }).first();
  await expect(riga).toBeAttached();
  if (!(await riga.isVisible())) {
    const blocco = page.locator('.dash-activity', { has: riga }).first();
    await blocco.locator('.dash-activity-head').first().click();
  }
  await expect(riga).toBeVisible({ timeout: 5_000 });
  await riga.click({ button: 'right' });
  const voce = page.locator('.sn-menu-item', { hasText: 'Annulla' });
  await expect(page.locator('.sn-menu-item', { hasText: 'Apri il riquadro di sistema' })).toBeVisible();
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.livello)).toBe(25);
});

test('pastiglia «Tema scuro»: il tasto destro la accende e porta alla sua voce in Preferenze', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  const pas = page.locator('.dash-pastiglia', { hasText: 'Tema scuro' });
  await expect(pas).toBeVisible({ timeout: 10_000 });
  await pas.click({ button: 'right' });
  const accendi = page.locator('.dash-menu-voce', { hasText: /Accendi|Spegni/ });
  await expect(accendi).toBeVisible();
  await expect(page.locator('.dash-menu-voce', { hasText: 'Apri la voce in Preferenze' })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-2096-pastiglia.png' });
  await accendi.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snTheme || document.body.dataset.snTheme || '')).toBe('dark');
});
