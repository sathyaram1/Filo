// Verifica #874, giro 1, rilievo 1: con tante reti conosciute il riquadro della rete scorre, e scorrendo non si chiude.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const RETI = ['Casa', ...Array.from({ length: 40 }, (_, i) => `Rete numero ${i + 1}`)];

async function computerFinto(app) {
  await app.evaluate(async (_, reti) => {
    globalThis.__pc = {
      batteria: { livello: 70, inCarica: false, collegata: false },
      rete: { online: true, tipo: 'wifi', nome: 'Casa' },
      bluetooth: { acceso: true, dispositivi: [] },
      volume: { livello: 25, muto: false },
      wifi: { acceso: true },
    };
    globalThis.__pcCollegate = [];
    const pc = globalThis.__pc;
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume() { return { ok: true, volume: 25, muto: false, prima: 25 }; },
      async radio(p) { return { ok: true, acceso: p.acceso }; },
      async btElenco() { return { ok: true, acceso: true, dispositivi: [] }; },
      async btCollega(p) { return { ok: true, collegato: p.collega }; },
      async wifiElenco() { return { ok: true, acceso: true, reti: reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome }; },
      async wifiCollega(p) { globalThis.__pcCollegate.push(p.rete); pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, RETI);
}

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

test('con la rotella sul riquadro si arriva all\'ultima rete conosciuta e ci si collega', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await voce(page, 'rete').click();
  const ultima = riquadro(page).locator('.sn-select-option', { hasText: 'Collegati a Rete numero 40' });
  await expect(ultima).toBeAttached({ timeout: 5_000 });
  const b = await riquadro(page).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  await expect(riquadro(page)).toBeVisible();
  await ultima.click();
  await expect.poll(() => app.evaluate(() => globalThis.__pcCollegate)).toEqual(['Rete numero 40']);
});

test('con le frecce si arriva all\'ultima rete conosciuta senza che il riquadro si chiuda', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await voce(page, 'rete').click();
  await expect(riquadro(page).locator('.sn-select-option', { hasText: 'Collegati a Rete numero 40' })).toBeAttached({ timeout: 5_000 });
  // Dalla prima voce, freccia su gira all'ultima, che sta sotto il bordo del riquadro.
  await riquadro(page).locator('.sn-select-option').first().focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await expect(riquadro(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__pcCollegate)).toEqual(['Nascondi la rete'].length ? [] : []);
});
