// #874 riallineamento: le zone fuse con main (#949 fonte unica delle impostazioni, esito del bottone confermato,
// righe d'attività) tengono sia il lavoro di #874 sia quello arrivato da main.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app, { negato = null } = {}) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    const pc = globalThis.__pc;
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) {
        const prima = pc.volume.livello;
        if (p.livello != null) pc.volume.livello = p.livello;
        if (p.muto != null) pc.volume.muto = p.muto; else if (p.livello > 0) pc.volume.muto = false;
        return { ok: true, volume: pc.volume.livello, muto: pc.volume.muto, prima };
      },
      async radio(p) {
        if (a.negato) return { ok: false, errore: a.negato };
        if (p.radio === 'wifi') { pc.wifi.acceso = p.acceso; pc.rete = p.acceso ? { online: true, tipo: 'wifi', nome: 'Casa' } : { online: false }; }
        else pc.bluetooth = { acceso: p.acceso, dispositivi: [] };
        return { ok: true, acceso: p.acceso };
      },
      async btElenco() { return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: [] }; },
      async btCollega() { return { ok: true, collegato: true }; },
      async wifiElenco() { return { ok: true, acceso: pc.wifi.acceso, reti: [], attuale: pc.rete.nome || null }; },
      async wifiCollega(p) { pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato: PARTENZA, negato });
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

const ultimoBottone = (page) => page.locator('.dash-bubble-actions .dash-action-btn').filter({ hasText: /^[✓✗]/ }).last();

test('confermato in chat: «spegni il Bluetooth» dice il risultato vero; col permesso negato la frase e il tasto per concederlo', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'b1', name: 'BLUETOOTH', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'spegni il Bluetooth');
  await expect.poll(() => confirmText(page)).toContain('Spegnere il Bluetooth');
  await clickConfirm(page, 'ok');
  await expect(ultimoBottone(page)).toHaveText(/^✓ .*Bluetooth/, { timeout: 8_000 });
  console.log('esito ok:', await ultimoBottone(page).textContent());
  await ripristina(app);

  await computerFinto(app, { negato: 'accesso-DeniedByUser' });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'b2', name: 'BLUETOOTH', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'spegni il Bluetooth');
  await expect.poll(() => confirmText(page)).toContain('Spegnere il Bluetooth');
  await clickConfirm(page, 'ok');
  await expect(ultimoBottone(page)).toContainText('Windows non lascia a Filo', { timeout: 8_000 });
  console.log('esito negato:', await ultimoBottone(page).textContent());
  await expect(page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Apri le impostazioni' }).last()).toBeVisible();
});

test('«alza il volume al 40%»: la riga d\'attività dice il numero', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'v1', name: 'VOLUME', arguments: JSON.stringify({ livello: 40 }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'alza il volume al 40%');
  await expect(page.locator('.dash-activity-row', { hasText: 'Volume al 40%' }).first()).toBeAttached({ timeout: 8_000 });
});

test('il volume nella home si toglie dalla chat (fonte unica di #949): Preferenze e home lo seguono, la lettura lo dice', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await computerFinto(app);
  const page = await home(app);
  await expect(page.locator('#sistema .dash-sis-voce[data-voce="volume"]')).toBeVisible({ timeout: 8_000 });
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#homeSisVolume')).toBeChecked({ timeout: 8_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'i1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'volume_home', valore: false }) }] },
    { text: 'Fatto.' },
  ]);
  await page.bringToFront();
  await chiedi(page, 'togli il volume dalla home');
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).homeSistema?.volume, { timeout: 8_000 }).toBe(false);
  await expect(page.locator('#sistema .dash-sis-voce[data-voce="volume"]')).toBeHidden({ timeout: 5_000 });
  await prefs.bringToFront();
  await expect(prefs.locator('#homeSisVolume')).not.toBeChecked({ timeout: 3_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'volume' }) }] },
    { text: 'Letto.' },
  ]);
  await page.bringToFront();
  await chiedi(page, 'il volume compare nella home?');
  const esitoLettura = async () => {
    const giri = await chiamateAlModello(app);
    const ultimo = giri.length ? [...giri[giri.length - 1]].reverse().find((m) => m.role === 'tool') : null;
    return ultimo ? String(ultimo.content || '') : '';
  };
  await expect.poll(esitoLettura, { timeout: 8_000 }).toContain('- voce «volume» nella home: nascosta [chiave volume_home]');

  await prefs.bringToFront();
  await prefs.locator('#homeSisVolume').check();
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).homeSistema, { timeout: 5_000 })
    .toEqual({ ora: true, batteria: true, rete: true, bluetooth: true, volume: true });
});
