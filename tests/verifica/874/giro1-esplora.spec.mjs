// Verifica #874, giro 1: esplorazione del riquadro delle voci con elenchi lunghi, tema scuro, gesti in fretta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app, { reti = [], dispositivi = [], ritardo = 0 } = {}) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__pcChiamate = [];
    const pc = globalThis.__pc;
    const attesa = () => new Promise((r) => setTimeout(r, a.ritardo));
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) { globalThis.__pcChiamate.push(['volume', p]); await attesa(); const prima = pc.volume.livello; if (p.livello != null) pc.volume.livello = p.livello; if (p.muto != null) pc.volume.muto = p.muto; return { ok: true, volume: pc.volume.livello, muto: pc.volume.muto, prima }; },
      async radio(p) { globalThis.__pcChiamate.push(['radio', p]); await attesa(); if (p.radio === 'wifi') pc.wifi.acceso = p.acceso; else pc.bluetooth.acceso = p.acceso; return { ok: true, acceso: p.acceso }; },
      async btElenco() { await attesa(); return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: a.dispositivi.map((d) => ({ ...d })) }; },
      async btCollega(p) { await attesa(); return { ok: true, collegato: p.collega }; },
      async wifiElenco() { await attesa(); return { ok: true, acceso: true, reti: a.reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome }; },
      async wifiCollega(p) { globalThis.__pcChiamate.push(['wifiCollega', p]); await attesa(); pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato: PARTENZA, reti, dispositivi, ritardo });
}

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

test('esplora: tante reti conosciute, si scorre il riquadro e si arriva all\'ultima', async ({ app }) => {
  const reti = ['Casa', ...Array.from({ length: 40 }, (_, i) => `Rete numero ${i + 1}`)];
  await computerFinto(app, { reti });
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await voce(page, 'rete').click();
  const ultima = riquadro(page).locator('.sn-select-option', { hasText: 'Collegati a Rete numero 40' });
  await expect(ultima).toBeAttached({ timeout: 5_000 });
  const misure = await page.evaluate(() => {
    const b = document.querySelector('.dash-sis-box');
    return { scroll: b.scrollHeight, client: b.clientHeight, vh: innerHeight };
  });
  console.log('misure', JSON.stringify(misure));
  await page.screenshot({ path: 'tests/.shots/874-v-reti-tante.png' });
  // Rotella sopra il riquadro: il riquadro deve restare aperto.
  const box = await riquadro(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  await expect(riquadro(page)).toBeVisible();
});

test('esplora: tema scuro, riquadro del volume e dei dispositivi', async ({ app }) => {
  await computerFinto(app, { dispositivi: [
    { indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony WH-1000XM5 di Alessandro, quelle nuove comprate a Natale', collegato: true },
    { indirizzo: '00:11:22:33:44:56', nome: 'Mouse', collegato: false },
  ] });
  const page = await home(app);
  await expect(voce(page, 'volume')).toHaveText('25%', { timeout: 8_000 });
  await voce(page, 'volume').click();
  await page.screenshot({ path: 'tests/.shots/874-v-volume-chiaro.png' });
  await page.keyboard.press('Escape');
  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { url: 'filo://preferences/preferences.html' },
  ));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await voce(page, 'volume').click();
  await page.screenshot({ path: 'tests/.shots/874-v-volume-scuro.png' });
  await page.keyboard.press('Escape');
  await voce(page, 'bluetooth').click();
  await expect(riquadro(page).locator('.sn-select-option', { hasText: 'Collega Mouse' })).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/874-v-bt-scuro.png' });
});

test('esplora: un comando lento, il riquadro chiuso e riaperto a metà', async ({ app }) => {
  await computerFinto(app, { ritardo: 1500 });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await riquadro(page).locator('.sn-select-option', { hasText: 'Spegni il Bluetooth' }).click();
  await page.screenshot({ path: 'tests/.shots/874-v-bt-attesa.png' });
  await page.keyboard.press('Escape');
  await voce(page, 'bluetooth').click();
  await page.screenshot({ path: 'tests/.shots/874-v-bt-riaperto.png' });
  const etichetta = await riquadro(page).locator('.dash-sis-comandi .sn-select-option').first().textContent();
  console.log('riaperto durante il comando:', etichetta);
  await page.waitForTimeout(2500);
  const dopo = await riquadro(page).locator('.dash-sis-comandi .sn-select-option').first().textContent().catch(() => '(chiuso)');
  console.log('dopo il comando:', dopo, JSON.stringify(await app.evaluate(() => globalThis.__pc.bluetooth)));
});
