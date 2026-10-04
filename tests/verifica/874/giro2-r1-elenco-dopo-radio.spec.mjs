// Verifica #874, giro 2, rilievo 1: spento o acceso il Bluetooth o il Wi-Fi dal riquadro, l'elenco sotto non resta
// quello di prima (cuffie «da scollegare» col Bluetooth spento, «Collegato a Casa» col Wi-Fi spento).

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

test('spento il Bluetooth dal riquadro, le cuffie non restano «da scollegare»', async ({ app }) => {
  const cuffie = { indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: true };
  await computerFinto(app, { dispositivi: [cuffie], stato: { ...PARTENZA, bluetooth: { acceso: true, dispositivi: ['Cuffie'] } } });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await expect(opzione(page, 'Scollega Cuffie')).toBeVisible({ timeout: 5_000 });
  await opzione(page, 'Spegni il Bluetooth').click();
  await expect(opzione(page, 'Accendi il Bluetooth')).toBeVisible({ timeout: 5_000 });
  // Col Bluetooth spento le cuffie non sono collegate: il riquadro aperto non le offre da scollegare.
  await expect(opzione(page, 'Scollega Cuffie')).toHaveCount(0, { timeout: 5_000 });
});

test('spento il Wi-Fi dal riquadro, la rete di prima non resta «Collegato a»', async ({ app }) => {
  await computerFinto(app, { reti: ['Casa', 'Ufficio'] });
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await voce(page, 'rete').click();
  await expect(opzione(page, 'Collegato a Casa')).toBeVisible({ timeout: 5_000 });
  await opzione(page, 'Spegni il Wi-Fi').click();
  await expect(opzione(page, 'Accendi il Wi-Fi')).toBeVisible({ timeout: 5_000 });
  await expect(riquadro(page)).toContainText('Il Wi-Fi è spento');
  await expect(opzione(page, 'Collegato a Casa')).toHaveCount(0, { timeout: 5_000 });
});
