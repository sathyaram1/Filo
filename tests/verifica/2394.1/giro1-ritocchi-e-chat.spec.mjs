// Verifica #2394.1, giro 1: il volume cambiato e il caricatore non fanno passare nella home il Bluetooth di prima
// della pausa per letto; in chat «spegni il Wi-Fi» col Wi-Fi spento letto prima della pausa chiede la conferma.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: false, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app, stato) {
  await app.evaluate(async (_, s) => {
    globalThis.__pc = JSON.parse(JSON.stringify(s));
    globalThis.__pcChiamate = [];
    globalThis.__pcLetture = [];
    const pc = globalThis.__pc;
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}]);
    const lettura = () => new Promise((r) => globalThis.__pcLetture.push(r));
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) { traccia('volume', p); const prima = pc.volume.livello; pc.volume.livello = p.livello; return { ok: true, volume: pc.volume.livello, muto: false, prima }; },
      async radio(p) {
        traccia('radio', p);
        if (p.radio === 'wifi') pc.wifi.acceso = p.acceso; else pc.bluetooth = { acceso: p.acceso, dispositivi: [] };
        return { ok: true, acceso: p.acceso };
      },
      async btElenco() { traccia('btElenco'); await lettura(); return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: [] }; },
      async wifiElenco() { traccia('wifiElenco'); await lettura(); return { ok: true, acceso: pc.wifi.acceso, reti: [], attuale: null }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, stato);
}

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const liberaTutto = (app) => app.evaluate(() => {
  for (const libera of (globalThis.__pcLetture || []).splice(0)) libera();
  if (globalThis.__liberaLettore) globalThis.__liberaLettore();
});

// Il lettore ha dormito, il Bluetooth si è acceso da fuori e la lettura nuova tarda.
async function lettoreCheHaDormito(app, cambia) {
  await app.evaluate((_, c) => {
    if (c === 'bluetooth') globalThis.__pc.bluetooth = { acceso: true, dispositivi: [] };
    else globalThis.__pc.wifi = { acceso: true };
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(() => new Promise((r) => { globalThis.__liberaLettore = () => r(globalThis.__pc); }));
    globalThis.SN_SISTEMA_MAIN._perProve.invecchia(5 * 60 * 1000);
  }, cambia);
}

test.afterEach(async ({ app }) => {
  await liberaTutto(app).catch(() => {});
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

test('volume cambiato e caricatore attaccato mentre il lettore riparte: la home dice «leggo», mai il Bluetooth spento di prima, poi acceso', async ({ app }) => {
  await computerFinto(app, PARTENZA);
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', 'spento', { timeout: 8_000 });
  await lettoreCheHaDormito(app, 'bluetooth');
  await app.evaluate(() => globalThis.SN_COMANDI_SISTEMA.comanda({ cosa: 'volume', livello: 40 }));
  await expect(voce(page, 'volume')).toHaveText('40%', { timeout: 5_000 });
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', 'leggendo', { timeout: 5_000 });
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('on-ac'));
  await page.waitForTimeout(600);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', 'leggendo');
  expect(await app.evaluate(() => globalThis.SN_SISTEMA_MAIN.stato().vecchio)).toContain('bluetooth');
  await app.evaluate(() => globalThis.__liberaLettore());
  await expect(voce(page, 'bluetooth')).toHaveAttribute('aria-label', /^Bluetooth acceso/, { timeout: 8_000 });
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', '');
});

test('in chat, col Wi-Fi spento letto prima di una pausa, «spegni il Wi-Fi» chiede la conferma e lo spegne davvero', async ({ app }) => {
  await livelloAutonomia(app, 'conservativo');
  await computerFinto(app, { ...PARTENZA, wifi: { acceso: false } });
  const page = await home(app);
  await expect.poll(() => app.evaluate(() => globalThis.SN_SISTEMA_MAIN.stato() && globalThis.SN_SISTEMA_MAIN.stato().wifi), { timeout: 8_000 }).toEqual({ acceso: false });
  await lettoreCheHaDormito(app, 'wifi');
  expect(await app.evaluate(() => globalThis.SN_SISTEMA_MAIN.stato().vecchio)).toContain('wifi');
  await modelloFinto(app, [
    { toolCalls: [{ id: 'w1', name: 'WIFI', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Spento.' },
  ]);
  await chiedi(page, 'spegni il Wi-Fi');
  await expect.poll(() => confirmText(page), { timeout: 15_000 }).toContain('Wi-Fi');
  await clickConfirm(page, 'ok');
  await expect.poll(() => app.evaluate(() => globalThis.__pc.wifi.acceso)).toBe(false);
  expect((await app.evaluate(() => globalThis.__pcChiamate)).filter((c) => c[0] === 'radio')).toEqual([['radio', { radio: 'wifi', acceso: false }]]);
});
