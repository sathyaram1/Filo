// Verifica #874, giro 3: esplorazione (aspetto in chiaro e scuro, Wi-Fi spento dalla chat, conferme a vuoto).

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: ['Cuffie'] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app, { stato = PARTENZA, dispositivi = [], reti = [], negato = null } = {}) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__pcChiamate = [];
    const pc = globalThis.__pc;
    const disp = a.dispositivi;
    const reti = a.reti;
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}]);
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) {
        traccia('volume', p);
        const prima = pc.volume.livello;
        if (p.livello != null) pc.volume.livello = p.livello;
        if (p.passo) pc.volume.livello = Math.max(0, Math.min(100, pc.volume.livello + p.passo));
        if (p.muto != null) pc.volume.muto = p.muto;
        else if (p.livello > 0 || p.passo > 0) pc.volume.muto = false;
        return { ok: true, volume: pc.volume.livello, muto: pc.volume.muto, prima };
      },
      async radio(p) {
        traccia('radio', p);
        if (a.negato) return { ok: false, errore: a.negato };
        if (p.radio === 'wifi') {
          pc.wifi.acceso = p.acceso;
          pc.rete = p.acceso ? { online: true, tipo: 'wifi', nome: 'Casa' } : { online: false };
        } else pc.bluetooth = { acceso: p.acceso, dispositivi: p.acceso ? disp.filter((d) => d.collegato).map((d) => d.nome) : [] };
        return { ok: true, acceso: p.acceso };
      },
      async btElenco() { traccia('btElenco'); return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: disp.map((d) => ({ ...d })) }; },
      async btCollega(p) {
        traccia('btCollega', p);
        const d = disp.find((x) => x.indirizzo === p.indirizzo);
        d.collegato = p.collega;
        pc.bluetooth.dispositivi = disp.filter((x) => x.collegato).map((x) => x.nome);
        return { ok: true, collegato: p.collega };
      },
      async wifiElenco() { traccia('wifiElenco'); return { ok: true, acceso: pc.wifi.acceso, reti: reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome || null }; },
      async wifiCollega(p) {
        traccia('wifiCollega', p);
        if (a.negato) return { ok: false, errore: a.negato };
        pc.rete = { online: true, tipo: 'wifi', nome: p.rete };
        return { ok: true, confermato: true };
      },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato, dispositivi, reti, negato });
}

const computer = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__pc)));
const chiamate = (app) => app.evaluate(() => globalThis.__pcChiamate);
const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');
const opzione = (page, testo) => riquadro(page).locator('.sn-select-option', { hasText: testo });

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

async function tema(app, page, t) {
  await app.evaluate(async (_, t2) => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t2 } },
    { url: 'filo://preferences/preferences.html' },
  ), t);
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t, { timeout: 5_000 });
}

test('aspetto: i tre riquadri in chiaro e in scuro, e un errore', async ({ app }) => {
  await computerFinto(app, {
    dispositivi: [
      { indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: true },
      { indirizzo: '00:11:22:33:44:66', nome: 'Tastiera Logitech MX Keys con un nome lunghissimo', collegato: false },
    ],
    reti: ['Casa', 'Ufficio 5G', 'Bar Sport ospiti'],
  });
  const page = await home(app);
  await expect(voce(page, 'volume')).toHaveText('25%', { timeout: 8_000 });
  for (const t of ['light', 'dark']) {
    await tema(app, page, t);
    for (const v of ['volume', 'bluetooth', 'rete']) {
      await voce(page, v).click();
      await expect(riquadro(page)).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `tests/.shots/874-g3-${v}-${t}.png` });
      await page.keyboard.press('Escape');
    }
  }
});

test('Wi-Fi spento dalla chat: cosa vede l\'utente dopo, quando il secondo giro del modello non ha rete', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'w1', name: 'WIFI', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Spento.' },
  ]);
  // Il secondo giro del modello, a Wi-Fi spento, non arriva al fornitore.
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      n += 1;
      if (n >= 2) { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }
      return prima(o);
    };
  });
  await chiedi(page, 'spegni il Wi-Fi');
  await expect.poll(() => confirmText(page)).toContain('Spegnere il Wi-Fi');
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await computer(app)).wifi.acceso).toBe(false);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'tests/.shots/874-g3-wifi-spento-chat.png' });
  const testo = await page.locator('#messages, .dash-chat, main').first().innerText().catch(() => '');
  console.log('CHAT DOPO:', testo.slice(-800));
});

test('«collegati a Casa» quando il computer è già su Casa: chiede conferma per niente?', async ({ app }) => {
  await computerFinto(app, { reti: ['Casa', 'Ufficio'] });
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'w1', name: 'WIFI', arguments: JSON.stringify({ rete: 'Casa' }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'collegati a Casa');
  await page.waitForTimeout(3000);
  const c = await confirmText(page).catch(() => '');
  console.log('CONFERMA:', JSON.stringify(c));
  await page.screenshot({ path: 'tests/.shots/874-g3-gia-collegato.png' });
});

test('cuffie già scollegate: «scollega le cuffie» chiede conferma per niente?', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }], stato: { ...PARTENZA, bluetooth: { acceso: true, dispositivi: [] } } });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'b1', name: 'BLUETOOTH', arguments: JSON.stringify({ dispositivo: 'cuffie', collega: false }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'scollega le cuffie');
  await page.waitForTimeout(3000);
  const c = await confirmText(page).catch(() => '');
  console.log('CONFERMA BT:', JSON.stringify(c));
});

test('rete negata in chat: «collegati a Ufficio» con la posizione negata', async ({ app }) => {
  await computerFinto(app, { reti: ['Casa', 'Ufficio'], negato: 'posizione' });
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await voce(page, 'rete').click();
  await opzione(page, 'Collegati a Ufficio').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/874-g3-rete-negata-riquadro.png' });
  console.log('ERRORE RIQUADRO:', await riquadro(page).innerText());
});
