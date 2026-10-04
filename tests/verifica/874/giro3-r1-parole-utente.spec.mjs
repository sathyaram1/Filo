// Verifica #874, giro 3, rilievo 1: un dispositivo o una rete detti con le parole dell'utente («le cuffie Sony»,
// «la rete di casa»), come chiedono la descrizione dello strumento e il prompt, si trovano al primo colpo.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
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


test('«collega le cuffie Sony»: il modello passa le parole dell\'utente e le cuffie si collegano al primo colpo', async ({ app }) => {
  await computerFinto(app, {
    dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony', collegato: false }, { indirizzo: '00:11:22:33:44:66', nome: 'Casse JBL', collegato: false }],
    stato: { ...PARTENZA, bluetooth: { acceso: true, dispositivi: [] } },
  });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'b1', name: 'BLUETOOTH', arguments: JSON.stringify({ dispositivo: 'le cuffie Sony' }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'collega le cuffie Sony');
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btCollega').length, { timeout: 8_000 }).toBe(1);
  expect((await chiamate(app)).find((c) => c[0] === 'btCollega')[1]).toEqual({ indirizzo: '00:11:22:33:44:55', collega: true });
});

test('«collegati alla rete di casa»: la conferma nomina «Casa» senza un giro in più del modello', async ({ app }) => {
  await computerFinto(app, { reti: ['Casa', 'Ufficio 5G'], stato: { ...PARTENZA, rete: { online: true, tipo: 'wifi', nome: 'Ufficio 5G' } } });
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Ufficio 5G', { timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'w1', name: 'WIFI', arguments: JSON.stringify({ rete: 'la rete di casa' }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'collegati alla rete di casa');
  await expect.poll(() => confirmText(page), { timeout: 8_000 }).toContain('alla rete Wi-Fi «Casa»');
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await computer(app)).rete.nome).toBe('Casa');
});
