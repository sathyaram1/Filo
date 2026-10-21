// Verifica #1223 giro 1: le altre strade del riquadro di Bluetooth e rete, con gli elenchi fermi in volo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, ripristina } from '../../helpers/chatFinta.mjs';

async function computerFinto(app, { dispositivi = [], reti = [] } = {}) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = {
      batteria: { livello: 70, inCarica: false, collegata: false },
      rete: { online: true, tipo: 'wifi', nome: 'Casa' },
      bluetooth: { acceso: true, dispositivi: [] },
      volume: { livello: 25, muto: false },
      wifi: { acceso: true },
    };
    globalThis.__pcChiamate = [];
    globalThis.__pcLetture = [];
    const pc = globalThis.__pc;
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}]);
    const lettura = () => new Promise((r) => globalThis.__pcLetture.push(r));
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume() { return { ok: true, volume: 25, muto: false, prima: 25 }; },
      async radio(p) {
        traccia('radio', p);
        if (p.radio === 'wifi') {
          pc.wifi.acceso = p.acceso;
          pc.rete = p.acceso ? { online: true, tipo: 'wifi', nome: 'Casa' } : { online: false };
        } else pc.bluetooth = { acceso: p.acceso, dispositivi: [] };
        return { ok: true, acceso: p.acceso };
      },
      async btElenco() { traccia('btElenco'); await lettura(); return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: a.dispositivi.map((d) => ({ ...d })) }; },
      async btCollega() { return { ok: true }; },
      async wifiElenco() { traccia('wifiElenco'); await lettura(); return { ok: true, acceso: pc.wifi.acceso, reti: a.reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome || null }; },
      async wifiCollega(p) { pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { dispositivi, reti });
}

const libera = (app) => app.evaluate(() => { for (const r of globalThis.__pcLetture.splice(0)) r(); });
const pc = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__pc)));
const conta = async (app, nome) => (await app.evaluate(() => globalThis.__pcChiamate)).filter((c) => c[0] === nome).length;
const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');
const opzione = (page, t) => riquadro(page).locator('.sn-select-option', { hasText: t });

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

test('rete: con le reti in lettura il tasto spegne subito il Wi-Fi, e le aperture non accodano letture', async ({ app }) => {
  await computerFinto(app, { reti: ['Casa', 'Ufficio'] });
  const page = await home(app);
  await expect(voce(page, 'rete')).toBeVisible({ timeout: 8_000 });
  for (let i = 0; i < 2; i++) { await voce(page, 'rete').click(); await page.keyboard.press('Escape'); }
  await voce(page, 'rete').click();
  await expect.poll(() => conta(app, 'wifiElenco')).toBe(1);
  await opzione(page, 'Spegni il Wi-Fi').click();
  await expect.poll(async () => (await pc(app)).wifi.acceso, { timeout: 10_000 }).toBe(false);
  await expect(opzione(page, 'Accendi il Wi-Fi')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => conta(app, 'wifiElenco')).toBe(2);
  await libera(app);
  await expect(opzione(page, 'Collegati a Casa')).toBeVisible({ timeout: 10_000 });
  expect(await conta(app, 'wifiElenco')).toBe(2);
});

test('bluetooth: spento e riacceso di fila con l\'elenco in volo, l\'ultimo stato vince e l\'elenco arriva', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11', nome: 'Cuffie', collegato: false }] });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await opzione(page, 'Spegni il Bluetooth').click();
  await expect(opzione(page, 'Accendi il Bluetooth')).toBeVisible({ timeout: 10_000 });
  await opzione(page, 'Accendi il Bluetooth').click();
  await expect(opzione(page, 'Spegni il Bluetooth')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await pc(app)).bluetooth.acceso).toBe(true);
  await libera(app);
  await expect(opzione(page, 'Collega Cuffie')).toBeVisible({ timeout: 10_000 });
  await expect(riquadro(page).locator('.dash-sis-attesa')).toHaveCount(0);
  await libera(app);
  await page.waitForTimeout(300);
  await expect(opzione(page, 'Collega Cuffie')).toHaveCount(1);
});

test('tastiera: Invio sulla voce apre, la freccia giù entra subito nel riquadro, Esc torna sulla voce', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11', nome: 'Cuffie', collegato: false }] });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  await voce(page, 'bluetooth').focus();
  await page.keyboard.press('Enter');
  await expect(riquadro(page)).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dash-sis-box :focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(riquadro(page)).toHaveCount(0);
  await expect(voce(page, 'bluetooth')).toBeFocused();
  // Riaperto col tasto destro, Esc lo chiude subito.
  await voce(page, 'bluetooth').click({ button: 'right' });
  await expect(riquadro(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(riquadro(page)).toHaveCount(0);
});
