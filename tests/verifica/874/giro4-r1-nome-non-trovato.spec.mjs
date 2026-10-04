// Giro 4 di #874, rilievo 1: quando il nome detto non trova una rete o un dispositivo solo, la frase che il modello
// deve riportare all'utente dice il vero (non «nessuna rete», non «nessun dispositivo», non un nome vuoto).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

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
const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');
const opzione = (page, testo) => riquadro(page).locator('.sn-select-option', { hasText: testo });
const esitoAlModello = async (app) => {
  const c = await chiamateAlModello(app);
  const ultimo = c[c.length - 1] || [];
  return ultimo.filter((m) => m.role === 'tool').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n---\n');
};

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

test('rete sconosciuta, dispositivo sconosciuto o ambiguo: la frase per l\'utente non nega i nomi che il sistema conosce', async ({ app }) => {
  await computerFinto(app, {
    reti: ['Casa', 'Ufficio'],
    dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony', collegato: true }, { indirizzo: '00:11:22:33:44:66', nome: 'Cuffie Bose', collegato: true }],
  });
  const page = await home(app);
  const casi = [
    ['collegati alla rete del bar', 'WIFI', { rete: 'bar' }],
    ['collega la tastiera', 'BLUETOOTH', { dispositivo: 'tastiera' }],
    ['scollega le cuffie', 'BLUETOOTH', { dispositivo: 'cuffie', collega: false }],
  ];
  for (const [i, [frase, nome, args]] of casi.entries()) {
    await modelloFinto(app, [{ toolCalls: [{ id: `n${i}`, name: nome, arguments: JSON.stringify(args) }] }, { text: 'ok' }]);
    await chiedi(page, frase);
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(1);
    const esito = await esitoAlModello(app);
    // I nomi arrivano al modello, quindi esistono: la frase non può dire che non ce ne sono, né citarne uno vuoto.
    expect(esito, frase).toContain(nome === 'WIFI' ? 'Casa' : 'Cuffie Sony');
    expect(esito, frase).not.toContain('non conosce nessuna rete');
    expect(esito, frase).not.toContain('Non ci sono dispositivi Bluetooth abbinati');
    expect(esito, frase).not.toContain('«»');
    await ripristina(app);
  }
});
