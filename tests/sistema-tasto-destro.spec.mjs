// #2096 — il tasto destro sulle righe del riquadro di sistema della home: un dispositivo Bluetooth si collega, va fra i
// preferiti (in cima all'elenco, anche dopo aver riaperto la home), si dimentica con conferma, se ne copia il nome; una
// rete Wi-Fi si dimentica; il volume ha i valori pronti. Il computer è finto (comandiSistema e lettore del main).

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

async function computerFinto(app, { dispositivi = [], reti = [] } = {}) {
  await app.evaluate(async (_, a) => {
    const pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__pc = pc;
    globalThis.__pcChiamate = [];
    const disp = a.dispositivi;
    let reti = a.reti.slice();
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
      async btElenco() { traccia('btElenco'); return { ok: true, acceso: true, dispositivi: disp.map((d) => ({ ...d })) }; },
      async btCollega(p) {
        traccia('btCollega', p);
        disp.find((x) => x.indirizzo === p.indirizzo).collegato = p.collega;
        return { ok: true, collegato: p.collega };
      },
      async btDimentica(p) {
        traccia('btDimentica', p);
        disp.splice(disp.findIndex((x) => x.indirizzo === p.indirizzo), 1);
        return { ok: true };
      },
      async wifiElenco() { traccia('wifiElenco'); return { ok: true, acceso: true, reti: reti.map((r) => ({ nome: r, attiva: pc.rete.nome === r })), attuale: pc.rete.nome }; },
      async wifiCollega(p) { traccia('wifiCollega', p); pc.rete = { online: true, tipo: 'wifi', nome: p.rete }; return { ok: true, confermato: true }; },
      async wifiDimentica(p) { traccia('wifiDimentica', p); reti = reti.filter((r) => r !== p.rete); return { ok: true }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato: PARTENZA, dispositivi, reti });
}

const chiamate = (app) => app.evaluate(() => globalThis.__pcChiamate);
const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');
const righe = (page) => riquadro(page).locator('.dash-sis-elenco .sn-select-option');
const opzione = (page, testo) => riquadro(page).locator('.sn-select-option', { hasText: testo });
const etichette = (page) => menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
});

test('un dispositivo Bluetooth: le sue voci, i preferiti in cima anche riaprendo la home, e Dimentica con conferma', async ({ app }) => {
  test.setTimeout(90_000);
  await computerFinto(app, {
    dispositivi: [
      { indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false },
      { indirizzo: '66:77:88:99:AA:BB', nome: 'Tastiera', collegato: true },
    ],
  });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await expect(righe(page)).toHaveCount(2);
  await expect(righe(page).first()).toContainText('Cuffie');

  const tastiera = opzione(page, 'Tastiera');
  await tastiera.click({ button: 'right' });
  const voci = await etichette(page);
  for (const v of ['Scollega', 'Metti fra i preferiti', 'Dimentica…', 'Copia il nome']) expect(voci).toContain(v);
  // Il pannello del sistema c'è solo dove il sistema ha un indirizzo per aprirlo (non su Linux).
  const pannello = await app.evaluate(() => process.platform !== 'linux');
  expect(voci.includes('Impostazioni Bluetooth del sistema')).toBe(pannello);
  await page.screenshot({ path: 'tests/.shots/2096-sistema-menu-bt.png' });

  await menuDi(page).voce('Metti fra i preferiti').first().click();
  await expect(righe(page).first()).toContainText('Tastiera', { timeout: 5_000 });
  await expect(righe(page).first()).toHaveClass(/dash-sis-preferito/);
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti))
    .toEqual([{ indirizzo: '66:77:88:99:AA:BB', nome: 'Tastiera' }]);

  // Riaperta la home, il preferito resta in cima.
  await page.reload();
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await expect(righe(page).first()).toContainText('Tastiera', { timeout: 5_000 });

  // Copia il nome.
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await opzione(page, 'Cuffie').click({ button: 'right' });
  await menuDi(page).voce('Copia il nome').first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()).catch(() => '')).toBe('Cuffie');

  // Dimentica chiede conferma; il no non tocca niente, il sì toglie il dispositivo (e dai preferiti).
  await opzione(page, 'Tastiera').click({ button: 'right' });
  await menuDi(page).voce('Dimentica…').first().click();
  expect(await confirmText(page)).toContain('Tastiera');
  await clickConfirm(page, 'cancel');
  expect((await chiamate(app)).some((c) => c[0] === 'btDimentica')).toBe(false);
  await opzione(page, 'Tastiera').click({ button: 'right' });
  await menuDi(page).voce('Dimentica…').first().click();
  await clickConfirm(page, 'ok');
  await expect(righe(page)).toHaveCount(1, { timeout: 5_000 });
  expect((await chiamate(app)).filter((c) => c[0] === 'btDimentica')).toEqual([['btDimentica', { indirizzo: '66:77:88:99:AA:BB' }]]);
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti)).toEqual([]);
});

test('una rete Wi-Fi: Collegati e Dimentica la rete; il volume: valori pronti e muto', async ({ app }) => {
  test.setTimeout(90_000);
  await computerFinto(app, { reti: ['Casa', 'Albergo'] });
  const page = await home(app);
  await expect(voce(page, 'rete')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'rete').click();
  await expect(opzione(page, 'Collegati a Albergo')).toBeVisible();

  await opzione(page, 'Collegati a Albergo').click({ button: 'right' });
  const voci = await etichette(page);
  for (const v of ['Collegati', 'Dimentica la rete…', 'Copia il nome']) expect(voci).toContain(v);
  await menuDi(page).voce('Dimentica la rete…').first().click();
  expect(await confirmText(page)).toContain('Albergo');
  await clickConfirm(page, 'ok');
  await expect(opzione(page, 'Albergo')).toHaveCount(0, { timeout: 5_000 });
  expect((await chiamate(app)).filter((c) => c[0] === 'wifiDimentica').map((c) => c[1].rete)).toEqual(['Albergo']);
  await page.keyboard.press('Escape');

  await voce(page, 'volume').click();
  await riquadro(page).locator('.dash-sis-cursore input').click({ button: 'right' });
  const delVolume = await etichette(page);
  for (const v of ['Volume al 0%', 'Volume al 25%', 'Volume al 50%', 'Volume al 100%', 'Metti muto']) expect(delVolume).toContain(v);
  await page.screenshot({ path: 'tests/.shots/2096-sistema-menu-volume.png' });
  await menuDi(page).voce('Volume al 50%').first().click();
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.livello)).toBe(50);
});

test('la riga di sistema nella chat: apre il riquadro della sua voce e si annulla', async ({ app }) => {
  test.setTimeout(90_000);
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'volume')).toHaveText('25%', { timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'v1', name: 'VOLUME', arguments: JSON.stringify({ livello: 60 }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'volume al 60%');
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.livello)).toBe(60);
  const riga = page.locator('.dash-activity-row', { hasText: 'Volume al 60%' }).first();
  await expect(riga).toBeAttached();
  // A lavoro finito il blocco è avvolto: lo si srotola, come farebbe l'utente.
  if (!(await riga.isVisible())) await page.locator('.dash-activity-head').last().click();
  await riga.click({ button: 'right' });
  const voci = await etichette(page);
  expect(voci).toContain('Apri il riquadro di sistema');
  expect(voci).toContain('Annulla · Rimetti il volume al 25%');
  await menuDi(page).voce('Annulla · Rimetti il volume al 25%').first().click();
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.livello)).toBe(25);
  await riga.click({ button: 'right' });
  await menuDi(page).voce('Apri il riquadro di sistema').first().click();
  await expect(riquadro(page)).toHaveAttribute('data-voce', 'volume');
});

test('una pastiglia delle Impostazioni rapide ha il suo menu: accenderla e la sua voce in Preferenze', async ({ app, shell }) => {
  const page = await home(app);
  const pastiglia = page.locator('.dash-pastiglia', { hasText: 'Anteprima schede' });
  await expect(pastiglia).toBeVisible({ timeout: 8_000 });
  const acceso = (await pastiglia.getAttribute('aria-pressed')) === 'true';
  await pastiglia.click({ button: 'right' });
  const menu = page.locator('.dash-menu');
  await expect(menu.locator('.dash-menu-voce')).toHaveText([`${acceso ? 'Spegni' : 'Accendi'}: anteprima schede`, 'Apri la voce in Preferenze']);
  await menu.locator('.dash-menu-voce').first().click();
  await expect(pastiglia).toHaveAttribute('aria-pressed', acceso ? 'false' : 'true');
  await pastiglia.click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Apri la voce in Preferenze' }).click();
  await expect.poll(async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url)))
    .some((u) => u === 'filo://preferences/preferences.html#tabPreviewEnabled')).toBe(true);
});

test('a parole: «metti le cuffie fra i preferiti» e «dimentica le cuffie» passano dalla stessa porta', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony', collegato: false }] });
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_COMANDI_SISTEMA;
    const pref = await C.comanda({ cosa: 'bluetooth', dispositivo: 'cuffie sony', preferito: true });
    const dopo = (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti;
    const via = await C.comanda({ cosa: 'bluetooth', dispositivo: 'cuffie', dimentica: true });
    return { pref, dopo, via, fine: (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti };
  });
  expect(r.pref).toMatchObject({ ok: true, dispositivo: 'Cuffie Sony', preferito: true });
  expect(r.dopo).toEqual([{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony' }]);
  expect(r.via).toMatchObject({ ok: true, dispositivo: 'Cuffie Sony', dimenticato: true });
  expect(r.fine).toEqual([]);
  // Dimenticare chiede sempre conferma, a qualunque livello di autonomia: costo 3.
  const costo = await app.evaluate(() => globalThis.SN_ACTION_LEVELS.costoFor({ type: 'BLUETOOTH', _richiestaSistema: { cosa: 'bluetooth', nome: 'Cuffie Sony', dimentica: true } }));
  expect(costo).toBe(3);
});
