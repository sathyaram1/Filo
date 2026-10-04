// #874 giro 6, rilievo 1: la carta «Impostazioni rapide» della home comanda anche Bluetooth, Wi-Fi e volume, e il
// suo tasto fa la stessa cosa di «spegni il Bluetooth» in chat (criterio 2 della segnalazione).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

// L'esecutore finto cambia la stessa lettura che il lettore finto restituisce: come un computer vero.
async function computerFinto(app, { stato = PARTENZA, dispositivi = [], reti = [], negato = null, letturaMs = 0 } = {}) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__pcChiamate = [];
    const pc = globalThis.__pc;
    const disp = a.dispositivi;
    const reti = a.reti;
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}]);
    const lettura = () => new Promise((r) => setTimeout(r, a.letturaMs));
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
      async btElenco() { traccia('btElenco'); await lettura(); return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: disp.map((d) => ({ ...d })) }; },
      async btCollega(p) {
        traccia('btCollega', p);
        const d = disp.find((x) => x.indirizzo === p.indirizzo);
        d.collegato = p.collega;
        pc.bluetooth.dispositivi = disp.filter((x) => x.collegato).map((x) => x.nome);
        return { ok: true, collegato: p.collega };
      },
      async wifiElenco() { traccia('wifiElenco'); await lettura(); return { ok: true, acceso: pc.wifi.acceso, reti: reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome || null }; },
      async wifiCollega(p) {
        traccia('wifiCollega', p);
        pc.rete = { online: true, tipo: 'wifi', nome: p.rete };
        return { ok: true, confermato: true };
      },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato, dispositivi, reti, negato, letturaMs });
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



const rapide = (page) => page.locator('.dash-carta', { hasText: 'Impostazioni rapide' }).first();

test('«spegni il Bluetooth» in chat e il tasto nelle impostazioni rapide danno lo stesso risultato', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  await expect(rapide(page)).toBeVisible();

  await modelloFinto(app, [
    { toolCalls: [{ id: 'b1', name: 'BLUETOOTH', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'spegni il Bluetooth');
  await expect.poll(() => confirmText(page)).toContain('Spegnere il Bluetooth');
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await computer(app)).bluetooth.acceso).toBe(false);
  await ripristina(app);

  const tasto = rapide(page).locator('button', { hasText: /Bluetooth/ });
  await expect(tasto).toBeVisible({ timeout: 5_000 });
  await tasto.click();
  await expect.poll(async () => (await computer(app)).bluetooth.acceso).toBe(true);
  await tasto.click();
  await expect.poll(async () => (await computer(app)).bluetooth.acceso).toBe(false);
  await expect(rapide(page).locator('button', { hasText: /Wi-Fi/ })).toBeVisible();
  await expect(rapide(page).locator('button', { hasText: /[Mm]uto|[Vv]olume/ })).toBeVisible();
});
