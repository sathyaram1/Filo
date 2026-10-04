// Verifica #874, giro 1, rilievo 2: il tasto «Spegni il Bluetooth» non aspetta in fila la lettura dei dispositivi
// abbinati, che parte a ogni apertura del riquadro (su Windows sono secondi).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const LETTURA_MS = 4000;

async function computerFinto(app) {
  await app.evaluate(async (_, lettura) => {
    globalThis.__pc = {
      batteria: { livello: 70, inCarica: false, collegata: false },
      rete: { online: true, tipo: 'wifi', nome: 'Casa' },
      bluetooth: { acceso: true, dispositivi: [] },
      volume: { livello: 25, muto: false },
      wifi: { acceso: true },
    };
    const pc = globalThis.__pc;
    const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume() { return { ok: true, volume: 25, muto: false, prima: 25 }; },
      async radio(p) { await attesa(200); pc.bluetooth.acceso = p.acceso; return { ok: true, acceso: p.acceso }; },
      async btElenco() { await attesa(lettura); return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] }; },
      async btCollega(p) { return { ok: true, collegato: p.collega }; },
      async wifiElenco() { return { ok: true, acceso: true, reti: [], attuale: null }; },
      async wifiCollega() { return { ok: true, confermato: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, LETTURA_MS);
}

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

test('aperto il riquadro, «Spegni il Bluetooth» spegne subito, senza aspettare l\'elenco dei dispositivi', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  // Aperto e richiuso due volte (cercando la voce giusta), poi il gesto.
  await voce(page, 'bluetooth').click();
  await page.keyboard.press('Escape');
  await voce(page, 'bluetooth').click();
  await page.keyboard.press('Escape');
  await voce(page, 'bluetooth').click();
  await riquadro(page).locator('.sn-select-option', { hasText: 'Spegni il Bluetooth' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__pc.bluetooth.acceso), { timeout: 2_000 }).toBe(false);
});
