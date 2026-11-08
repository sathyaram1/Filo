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
    .toEqual(['66:77:88:99:AA:BB']);

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

  // Dimentica chiede conferma; il no non tocca niente, il sì toglie il dispositivo. Il preferito resta: toglierlo darebbe
  // al filo un Annulla che rimette fra i preferiti un dispositivo che il computer non conosce più.
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
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti)).toEqual(['66:77:88:99:AA:BB']);
});

test('gli interruttori Bluetooth e Wi-Fi del riquadro: il tasto destro li accende o spegne', async ({ app }) => {
  test.setTimeout(90_000);
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }], reti: ['Casa'] });
  const page = await home(app);
  for (const [v, radio, etichetta] of [['bluetooth', 'bluetooth', 'Spegni il Bluetooth'], ['rete', 'wifi', 'Spegni il Wi-Fi']]) {
    await expect(voce(page, v)).toBeVisible({ timeout: 8_000 });
    await voce(page, v).click();
    const interruttore = opzione(page, etichetta);
    await expect(interruttore).toBeVisible();
    await interruttore.click({ button: 'right' });
    expect(await etichette(page)).toContain(etichetta);
    await menuDi(page).voce(etichetta).first().click();
    await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'radio' && c[1].radio === radio).map((c) => c[1].acceso)).toEqual([false]);
    await page.keyboard.press('Escape');
  }
});

// Su Linux la voce non c'è: si finge Windows e Mac per attraversare la strada vera, dal menu all'indirizzo che si apre.
test('le voci «Impostazioni … del sistema» aprono il pannello giusto di Windows e del Mac', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }], reti: ['Casa', 'Ufficio'] });
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    globalThis.__openExternal = shell.openExternal;
    shell.openExternal = async (u) => { globalThis.__aperti.push(u); };
  });
  const aperti = () => app.evaluate(() => globalThis.__aperti.splice(0));
  try {
    for (const [piattaforma, attesi] of [
      ['win32', ['ms-settings:bluetooth', 'ms-settings:network-wifi', 'ms-settings:sound']],
      ['darwin', ['x-apple.systempreferences:com.apple.BluetoothSettings', 'x-apple.systempreferences:com.apple.wifi-settings-extension', 'x-apple.systempreferences:com.apple.Sound-Settings.extension']],
    ]) {
      await app.evaluate((_, p) => globalThis.SN_COMANDI_SISTEMA._perProve.usaPiattaformaPannelli(p), piattaforma);
      const page = await home(app);
      await page.reload();
      await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });

      await voce(page, 'bluetooth').click();
      await opzione(page, 'Cuffie').click({ button: 'right' });
      await menuDi(page).voce('Impostazioni Bluetooth del sistema').first().click();
      await expect.poll(aperti).toEqual([attesi[0]]);
      await page.keyboard.press('Escape');

      await voce(page, 'rete').click();
      await opzione(page, 'Ufficio').click({ button: 'right' });
      await menuDi(page).voce('Impostazioni Wi-Fi del sistema').first().click();
      await expect.poll(aperti).toEqual([attesi[1]]);
      await page.keyboard.press('Escape');

      await voce(page, 'volume').click();
      await riquadro(page).locator('.dash-sis-cursore').click({ button: 'right' });
      await menuDi(page).voce('Impostazioni audio del sistema').first().click();
      await expect.poll(aperti).toEqual([attesi[2]]);
      await page.keyboard.press('Escape');
    }
  } finally {
    await app.evaluate(({ shell }) => {
      shell.openExternal = globalThis.__openExternal;
      globalThis.SN_COMANDI_SISTEMA._perProve.usaPiattaformaPannelli(null);
    });
  }
});

// Una riga della chat sa disfare quello che dice: collegare un dispositivo e accendere o spegnere una radio. I preferiti
// no: sono un'impostazione, e l'Annulla del filo c'è già.
test('le righe di Bluetooth nella chat: Annulla scollega, rispegne, e sui preferiti non ce n\'è un secondo', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  const rigaDi = async (testo) => {
    const blocco = page.locator('#bubbles .dash-activity').last();
    await expect(blocco).toHaveAttribute('data-phase', 'done', { timeout: 10_000 });
    if (await blocco.getAttribute('data-filo') === 'gomitolo') await blocco.locator('.dash-activity-head').click();
    const riga = blocco.locator('.dash-activity-row', { hasText: testo }).first();
    if (!(await riga.isVisible())) await blocco.locator('.dash-activity-seg-head').last().click();
    await expect(riga).toBeVisible();
    return riga;
  };

  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'BLUETOOTH', arguments: JSON.stringify({ dispositivo: 'Cuffie', collega: true }) }] },
    { text: 'Collegate.' },
  ]);
  await chiedi(page, 'collega le cuffie');
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btCollega').map((c) => c[1].collega), { timeout: 20_000 }).toEqual([true]);
  await (await rigaDi('Cuffie')).click({ button: 'right' });
  await expect(menuDi(page).voce('Annulla · Scollega').first()).toBeVisible();
  await menuDi(page).voce('Annulla · Scollega').first().click();
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btCollega').map((c) => c[1].collega)).toEqual([true, false]);

  await modelloFinto(app, [
    { toolCalls: [{ id: 's1', name: 'BLUETOOTH', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Spento.' },
  ]);
  await chiedi(page, 'spegni il bluetooth');
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'radio').map((c) => c[1].acceso), { timeout: 20_000 }).toContain(false);
  const spento = await rigaDi('Bluetooth spento');
  await spento.click({ button: 'right' });
  await menuDi(page).voce('Annulla · Riaccendi il Bluetooth').first().click();
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'radio').map((c) => c[1].acceso)).toEqual([false, true]);

  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'BLUETOOTH', arguments: JSON.stringify({ dispositivo: 'Cuffie', preferito: true }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'metti le cuffie fra i preferiti');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti), { timeout: 20_000 }).toEqual(['00:11:22:33:44:55']);
  await (await rigaDi('Fra i preferiti')).click({ button: 'right' });
  const voci = await etichette(page);
  expect(voci).toContain('Apri il riquadro di sistema');
  // Uno solo: quello del filo, che sa anche rifare.
  expect(voci.filter((v) => /^Annulla\b/.test(v))).toHaveLength(1);
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
  for (const v of ['Volume allo 0%', 'Volume al 25%', 'Volume al 50%', 'Volume al 100%', 'Metti muto']) expect(delVolume).toContain(v);
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
  // A lavoro finito il blocco è avvolto: lo si srotola, come farebbe l'utente.
  const blocco = page.locator('#bubbles .dash-activity').last();
  await expect(blocco).toHaveAttribute('data-phase', 'done', { timeout: 10_000 });
  if (await blocco.getAttribute('data-filo') === 'gomitolo') await blocco.locator('.dash-activity-head').click();
  // La riga sta nel nodo del suo giro di azioni: si apre col suo nome.
  const riga = blocco.locator('.dash-activity-row', { hasText: 'Volume al 60%' }).first();
  if (!(await riga.isVisible())) await blocco.locator('.dash-activity-seg-head').last().click();
  await expect(riga).toBeVisible();
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

// Le voci che danno un comando si cliccano, non basta che compaiano: Collega, Togli dai preferiti, Collegati, Metti muto.
test('le voci di comando del tasto destro fanno quello che dicono: Collega, Togli dai preferiti, Collegati, Metti muto', async ({ app }) => {
  test.setTimeout(120_000);
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }], reti: ['Casa', 'Albergo'] });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ bluetoothPreferiti: ['00:11:22:33:44:55'] }));
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  await expect(righe(page).first()).toHaveClass(/dash-sis-preferito/);

  await opzione(page, 'Cuffie').click({ button: 'right' });
  await menuDi(page).voce('Collega').first().click();
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btCollega').map((c) => c[1].collega)).toEqual([true]);

  await opzione(page, 'Cuffie').click({ button: 'right' });
  await menuDi(page).voce('Togli dai preferiti').first().click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti)).toEqual([]);
  await expect(righe(page).first()).not.toHaveClass(/dash-sis-preferito/);
  await page.keyboard.press('Escape');

  await voce(page, 'rete').click();
  await opzione(page, 'Collegati a Albergo').click({ button: 'right' });
  await menuDi(page).voce('Collegati').first().click();
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'wifiCollega').map((c) => c[1].rete)).toEqual(['Albergo']);
  await page.keyboard.press('Escape');

  await voce(page, 'volume').click();
  await riquadro(page).locator('.dash-sis-cursore input').click({ button: 'right' });
  await menuDi(page).voce('Metti muto').first().click();
  await expect.poll(() => app.evaluate(() => globalThis.__pc.volume.muto)).toBe(true);
});

test('a parole: «togli le cuffie dai preferiti» le toglie, scritte come il sistema le chiama', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie Sony', collegato: false }] });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ bluetoothPreferiti: ['00:11:22:33:44:55', '66:77:88:99:AA:BB'] }));
  const r = await app.evaluate(async () => {
    const via = await globalThis.SN_COMANDI_SISTEMA.comanda({ cosa: 'bluetooth', dispositivo: 'cuffie', preferito: false });
    return { via, fine: (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti };
  });
  expect(r.via).toMatchObject({ ok: true, dispositivo: 'Cuffie Sony', preferito: false });
  expect(r.fine).toEqual(['66:77:88:99:AA:BB']);
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
  expect(r.dopo).toEqual(['00:11:22:33:44:55']);
  expect(r.via).toMatchObject({ ok: true, dispositivo: 'Cuffie Sony', dimenticato: true });
  expect(r.fine).toEqual(['00:11:22:33:44:55']);
  // Dimenticare chiede sempre conferma, a qualunque livello di autonomia: costo 3.
  const costo = await app.evaluate(() => globalThis.SN_ACTION_LEVELS.costoFor({ type: 'BLUETOOTH', _richiestaSistema: { cosa: 'bluetooth', nome: 'Cuffie Sony', dimentica: true } }));
  expect(costo).toBe(3);
});
