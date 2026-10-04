// #874 — volume, Bluetooth e Wi-Fi si comandano a parole in chat e dal riquadro delle voci della home, con lo stesso
// risultato. Il computer è finto in due punti del main (il lettore di #873 e l'esecutore dei comandi, che cambiano lo
// stesso oggetto): sopra c'è la strada vera, chat, livelli, conferma, home. Senza il lavoro le azioni non esistono.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from './helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

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

test('«alza il volume al 40%» in chat: il volume del computer è al 40% e la voce della home lo mostra', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'volume')).toHaveText('25%', { timeout: 8_000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'v1', name: 'VOLUME', arguments: JSON.stringify({ livello: 40 }) }] },
    { text: 'Fatto, volume al 40%.' },
  ]);
  await chiedi(page, 'alza il volume al 40%');
  await expect.poll(async () => (await computer(app)).volume.livello).toBe(40);
  await expect(voce(page, 'volume')).toHaveText('40%', { timeout: 5_000 });
  await expect(page.locator('.dash-activity-row', { hasText: 'Volume al 40%' }).first()).toBeAttached();
  expect(await chiamate(app)).toEqual([['volume', { livello: 40 }]]);
});

test('«spegni il Bluetooth» in chat e il tasto nel riquadro della home fanno la stessa cosa allo stesso computer', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });

  // La chat: spegnere chiede conferma (tastiere e cuffie si scollegano), poi spegne.
  await modelloFinto(app, [
    { toolCalls: [{ id: 'b1', name: 'BLUETOOTH', arguments: JSON.stringify({ acceso: false }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'spegni il Bluetooth');
  await expect.poll(() => confirmText(page)).toContain('Spegnere il Bluetooth');
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await computer(app)).bluetooth.acceso).toBe(false);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth spento', { timeout: 5_000 });
  const dallaChat = (await chiamate(app)).filter((c) => c[0] === 'radio');
  await ripristina(app);

  // Il riquadro: lo riaccende e lo rispegne, senza conferma (è un gesto dell'utente).
  await voce(page, 'bluetooth').click();
  await expect(opzione(page, 'Accendi il Bluetooth')).toBeVisible();
  await opzione(page, 'Accendi il Bluetooth').click();
  await expect.poll(async () => (await computer(app)).bluetooth.acceso).toBe(true);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 5_000 });
  await expect(opzione(page, 'Spegni il Bluetooth')).toBeVisible();
  await opzione(page, 'Spegni il Bluetooth').click();
  await expect.poll(async () => (await computer(app)).bluetooth.acceso).toBe(false);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth spento', { timeout: 5_000 });

  const tutte = (await chiamate(app)).filter((c) => c[0] === 'radio');
  expect(dallaChat).toEqual([['radio', { radio: 'bluetooth', acceso: false }]]);
  expect(tutte.slice(-1)).toEqual(dallaChat, 'chat e riquadro chiedono al computer la stessa identica cosa');
});

test('senza il permesso del sistema: la frase, dove si concede e il tasto che ci porta, in chat e nella home', async ({ app }) => {
  await computerFinto(app, { negato: 'accesso-DeniedByUser' });
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    globalThis.__openExternal = shell.openExternal;
    shell.openExternal = async (u) => { globalThis.__aperti.push(u); };
  });
  try {
    const page = await home(app);
    await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });

    await voce(page, 'bluetooth').click();
    await opzione(page, 'Spegni il Bluetooth').click();
    const errore = riquadro(page).locator('.dash-sis-errore').first();
    await expect(errore).toContainText('Windows non lascia a Filo accendere e spegnere le radio');
    await expect(errore).toContainText('Privacy e sicurezza → Radio');
    await page.screenshot({ path: 'tests/.shots/874-permesso-riquadro.png' }).catch(() => {});
    await errore.getByRole('button', { name: 'Apri le impostazioni' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual(['ms-settings:privacy-radios']);
    expect((await computer(app)).bluetooth.acceso).toBe(true);
    await page.keyboard.press('Escape');

    await modelloFinto(app, [
      { toolCalls: [{ id: 'b2', name: 'BLUETOOTH', arguments: JSON.stringify({ acceso: true }) }] },
      { text: 'Windows non me lo lascia fare: te lo dico sotto.' },
    ]);
    await chiedi(page, 'accendi il Bluetooth');
    await expect(page.locator('.dash-activity-row', { hasText: 'Bluetooth non cambiato' }).first()).toBeAttached({ timeout: 8_000 });
    const tasto = page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Apri le impostazioni' }).last();
    await expect(tasto).toBeVisible();
    await tasto.click();
    await expect.poll(() => app.evaluate(() => globalThis.__aperti.length)).toBe(2);
  } finally {
    await app.evaluate(({ shell }) => { shell.openExternal = globalThis.__openExternal; });
  }
});

test('il riquadro del volume: il cursore porta il volume dove lo lasci, e «Metti muto» lo silenzia', async ({ app }) => {
  await computerFinto(app);
  const page = await home(app);
  await expect(voce(page, 'volume')).toHaveText('25%', { timeout: 8_000 });
  await voce(page, 'volume').click();
  const cursore = riquadro(page).locator('input[type="range"]');
  await expect(cursore).toHaveValue('25');
  await cursore.evaluate((el) => { el.value = '60'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await expect.poll(async () => (await computer(app)).volume.livello).toBe(60);
  await expect(voce(page, 'volume')).toHaveText('60%', { timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/874-volume-riquadro.png' }).catch(() => {});
  await opzione(page, 'Metti muto').click();
  await expect(voce(page, 'volume')).toHaveAttribute('title', 'Muto', { timeout: 5_000 });
  await expect(voce(page, 'volume')).toHaveAttribute('data-stato', 'spento');
  await expect(opzione(page, 'Togli il muto')).toBeVisible();
  expect((await computer(app)).volume).toEqual({ livello: 60, muto: true });
});

test('le cuffie abbinate si collegano dal riquadro del Bluetooth, e una rete conosciuta da quello della rete', async ({ app }) => {
  const nomeStrano = 'Cuffie <b>di Ale</b> "pro"';
  await computerFinto(app, {
    dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: nomeStrano, collegato: false }],
    reti: ['Casa', 'Bar <img src=x onerror=alert(1)>'],
  });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  const collega = opzione(page, `Collega ${nomeStrano}`);
  await expect(collega).toBeVisible();
  await expect(riquadro(page).locator('b, img')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/874-bluetooth-riquadro.png' }).catch(() => {});
  await collega.click();
  await expect(opzione(page, `Scollega ${nomeStrano}`)).toBeVisible({ timeout: 5_000 });
  await expect(voce(page, 'bluetooth')).toHaveText('1', { timeout: 5_000 });
  await page.keyboard.press('Escape');

  await voce(page, 'rete').click();
  await expect(opzione(page, 'Collegato a Casa')).toBeVisible();
  const bar = opzione(page, 'Collegati a Bar <img src=x onerror=alert(1)>');
  await expect(bar).toBeVisible();
  await expect(riquadro(page).locator('img')).toHaveCount(0);
  await bar.click();
  await expect(voce(page, 'rete')).toHaveText('Bar <img src=x onerror=alert(1)>', { timeout: 5_000 });
  expect((await chiamate(app)).filter((c) => c[0] === 'wifiCollega')).toEqual([['wifiCollega', { rete: 'Bar <img src=x onerror=alert(1)>' }]]);
});

test('in chat: una rete detta a metà si trova, e cambiare rete chiede conferma prima di partire', async ({ app }) => {
  await computerFinto(app, { reti: ['Casa', 'Ufficio 5G'] });
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'w1', name: 'WIFI', arguments: JSON.stringify({ rete: 'ufficio' }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'collegati alla rete dell\'ufficio');
  await expect.poll(() => confirmText(page)).toContain('Collegare il computer alla rete Wi-Fi «ufficio»');
  expect((await chiamate(app)).some((c) => c[0] === 'wifiCollega')).toBe(false);
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await computer(app)).rete.nome).toBe('Ufficio 5G');
  await expect(voce(page, 'rete')).toHaveText('Ufficio 5G', { timeout: 5_000 });
});

test('con tante reti conosciute il riquadro scorre, con la rotella e con le frecce, e si arriva all\'ultima', async ({ app }) => {
  const reti = ['Casa', ...Array.from({ length: 40 }, (_, i) => `Rete numero ${i + 1}`)];
  await computerFinto(app, { reti });
  const page = await home(app);
  await expect(voce(page, 'rete')).toHaveText('Casa', { timeout: 8_000 });
  await voce(page, 'rete').click();
  const ultima = opzione(page, 'Collegati a Rete numero 40');
  await expect(ultima).toBeAttached({ timeout: 5_000 });
  const b = await riquadro(page).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(300);
  await expect(riquadro(page)).toBeVisible();
  await expect(ultima).toBeInViewport();
  // La pagina sotto che scorre invece lo chiude, come prima.
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect(riquadro(page)).toHaveCount(0);

  // Dalla prima voce, freccia su gira in fondo (Nascondi, Copia, poi l'ultima rete), sotto il bordo del riquadro.
  await voce(page, 'rete').click();
  await expect(ultima).toBeAttached({ timeout: 5_000 });
  await riquadro(page).locator('.sn-select-option').first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  await expect(page.locator(':focus')).toHaveText('Collegati a Rete numero 40');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await computer(app)).rete.nome).toBe('Rete numero 40');
});

test('aperto il riquadro del Bluetooth, il tasto spegne subito: non aspetta l\'elenco dei dispositivi, e le letture non si accodano', async ({ app }) => {
  await computerFinto(app, { letturaMs: 4000, dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  // Aperto e richiuso due volte cercando la voce giusta, poi il gesto.
  for (let i = 0; i < 2; i++) {
    await voce(page, 'bluetooth').click();
    await page.keyboard.press('Escape');
  }
  await voce(page, 'bluetooth').click();
  await opzione(page, 'Spegni il Bluetooth').click();
  await expect.poll(async () => (await computer(app)).bluetooth.acceso, { timeout: 2_000 }).toBe(false);
  await expect(opzione(page, 'Accendi il Bluetooth')).toBeVisible({ timeout: 2_000 });
  // Tre aperture con la lettura ancora in volo sono una lettura sola, e il suo elenco arriva nel riquadro aperto.
  await expect(opzione(page, 'Collega Cuffie')).toBeVisible({ timeout: 10_000 });
  expect((await chiamate(app)).filter((c) => c[0] === 'btElenco').length).toBe(1);
});

test('un sito non comanda il computer: le due porte rispondono «rifiutato» fuori da Filo', async ({ app, shell }) => {
  void shell;
  await computerFinto(app);
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const MSG = globalThis.SN_MSG.MSG;
    const web = { url: 'https://sito-ostile.example/', tab: { url: 'https://sito-ostile.example/' } };
    const filo = { url: 'filo://newtab/' };
    const a = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.SISTEMA_COMANDA, richiesta: { cosa: 'volume', livello: 100 } }, web);
    const b = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.SISTEMA_APRI_IMPOSTAZIONI, chiave: 'win-radio' }, web);
    const c = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.SISTEMA_COMANDA, richiesta: { cosa: 'volume', livello: 30 } }, filo);
    const d = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'VOLUME', livello: 100 }, { sender: web });
    // Il modello non può scriversi da sé la richiesta che decide il livello: il main la riscrive sempre.
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const e = await globalThis.SN_EXECUTE_FILO_ACTION(
      { type: 'BLUETOOTH', acceso: false, _richiestaSistema: { cosa: 'bluetooth', acceso: true } },
      { sender: { win, wc: win.webContents, url: 'filo://newtab/' } },
    );
    return { a, b, c, d, e };
  });
  expect(out.a.code).toBe('forbidden');
  expect(out.b.code).toBe('forbidden');
  expect(out.c.ok).toBe(true);
  expect(out.d.executed).toBe(false);
  expect(out.e.needsConfirm).toBe(2);
  expect(out.e.executed).toBe(false);
  const dopo = await computer(app);
  expect(dopo.volume.livello).toBe(30);
  expect(dopo.bluetooth.acceso).toBe(true);
});
