// Verifica #2096 giro 1: il tasto destro sulle righe del riquadro di sistema (dispositivi, reti, volume) fa quello che
// dice, sopra un computer finto; i preferiti restano riaprendo la home e si mettono anche a parole.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};
const DISP = [
  { indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony', collegato: false },
  { indirizzo: '00:11:22:33:44:66', nome: 'Casse JBL', collegato: false },
  { indirizzo: '00:11:22:33:44:77', nome: 'Mouse', collegato: true },
];

async function computerFinto(app) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__disp = JSON.parse(JSON.stringify(a.disp));
    globalThis.__reti = ['Casa', 'Ufficio'];
    globalThis.__pcChiamate = [];
    const pc = globalThis.__pc;
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}]);
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async volume(p) {
        traccia('volume', p);
        const prima = pc.volume.livello;
        if (p.livello != null) pc.volume.livello = p.livello;
        if (p.muto != null) pc.volume.muto = p.muto;
        return { ok: true, volume: pc.volume.livello, muto: pc.volume.muto, prima };
      },
      async radio(p) { traccia('radio', p); return { ok: true, acceso: p.acceso }; },
      async btElenco() { traccia('btElenco'); return { ok: true, acceso: true, dispositivi: globalThis.__disp.map((d) => ({ ...d })) }; },
      async btCollega(p) { traccia('btCollega', p); const d = globalThis.__disp.find((x) => x.indirizzo === p.indirizzo); d.collegato = p.collega; return { ok: true, collegato: p.collega }; },
      async btDimentica(p) { traccia('btDimentica', p); globalThis.__disp = globalThis.__disp.filter((x) => x.indirizzo !== p.indirizzo); return { ok: true }; },
      async wifiElenco() { traccia('wifiElenco'); return { ok: true, acceso: true, reti: globalThis.__reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome || null }; },
      async wifiCollega(p) { traccia('wifiCollega', p); pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
      async wifiDimentica(p) { traccia('wifiDimentica', p); globalThis.__reti = globalThis.__reti.filter((r) => r !== p.rete); return { ok: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato: PARTENZA, disp: DISP });
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');
const opzione = (page, testo) => riquadro(page).locator('.sn-select-option', { hasText: testo });
const chiamate = (app) => app.evaluate(() => globalThis.__pcChiamate);

test('riga Bluetooth: preferito in cima e ancora lì riaprendo la home, Copia il nome, Dimentica con conferma', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app);
  let page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await expect(opzione(page, 'Casse JBL')).toBeVisible();
  await opzione(page, 'Casse JBL').click({ button: 'right' });
  const menu = menuDi(page);
  for (const v of ['Collega', 'Metti fra i preferiti', 'Dimentica', 'Copia il nome']) await expect(menu.voce(v)).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-2096-bt-menu.png' });
  await menu.voce('Metti fra i preferiti').click();
  await expect(riquadro(page).locator('.sn-select-option').first()).toContainText('Casse JBL', { timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/verifica-2096-bt-preferito.png' });

  await page.reload();
  page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await expect(riquadro(page).locator('.sn-select-option').first()).toContainText('Casse JBL', { timeout: 5_000 });

  // Copia il nome.
  await opzione(page, 'Mouse').click({ button: 'right' });
  await menuDi(page).voce('Copia il nome').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Mouse');

  // Dimentica, con conferma.
  await opzione(page, 'Cuffie Sony').click({ button: 'right' });
  await menuDi(page).voce('Dimentica').click();
  await clickConfirm(page, 'Dimentica');
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btDimentica').map((c) => c[1].indirizzo)).toEqual(['00:11:22:33:44:55']);
  await expect(opzione(page, 'Cuffie Sony')).toHaveCount(0, { timeout: 5_000 });
});

test('riga Wi-Fi e volume: Collegati, Dimentica la rete, valori pronti', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'rete')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'rete').click();
  await expect(opzione(page, 'Ufficio')).toBeVisible();
  await opzione(page, 'Ufficio').click({ button: 'right' });
  const menu = menuDi(page);
  for (const v of ['Collegati', 'Dimentica la rete', 'Copia il nome']) await expect(menu.voce(v)).toBeVisible();
  await menu.voce('Collegati').click();
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'wifiCollega').map((c) => c[1].rete)).toEqual(['Ufficio']);
  await page.keyboard.press('Escape');

  await expect(voce(page, 'volume')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'volume').click();
  const cursore = riquadro(page).locator('.dash-sis-cursore');
  await expect(cursore).toBeVisible();
  await cursore.click({ button: 'right' });
  await expect(menuDi(page).voce('50%')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-2096-volume-menu.png' });
  await menuDi(page).voce('50%').click();
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.livello)).toBe(50);
});

test('a parole: «metti le casse fra i preferiti» le porta in cima all\'elenco', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'BLUETOOTH', arguments: JSON.stringify({ dispositivo: 'Casse JBL', preferito: true }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'metti le casse JBL fra i preferiti');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti), { timeout: 20_000 }).toEqual(['00:11:22:33:44:66']);
});
