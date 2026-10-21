// #1432 — L'icona Aiuto della barra laterale: un clic apre l'Aiuto sulla pagina, il secondo nello stesso punto
// detta nella sua casella, il terzo ferma. Una risposta arrivata ad Aiuto ridotto o chiuso accende la striscia
// finché non la si apre. Dove la voce «Aiuto» non c'è l'icona è spenta e dice perché; nel menu fa lo stesso.
// Microfono finto nella cornice (un tono), trascrizione e modello finti nel main: il resto è il codice vero.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SHOTS = 'tests/.shots';
const DETTO = 'dove si cambia la password';
const RISPOSTA = 'In alto a destra, sotto il tuo nome.';
const SITO = '<!doctype html><title>Sito</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1><p>Testo.</p></body>';

async function prepara(app, { modelloDettatura = true } = {}) {
  await app.evaluate(async (_e, { detto, risposta, modelloDettatura: md }) => {
    const C = globalThis.SN_CONST;
    const models = { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' };
    if (!md) models[C.ACTIONS.TRANSCRIBE_AUDIO] = '';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models,
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      dictation: { autoSend: false },
    });
    globalThis.__trascrizioni = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64 }) => {
      globalThis.__trascrizioni += 1;
      const bytes = Buffer.from(String(audioBase64 || ''), 'base64').length;
      return { text: ` ${detto} `, usage: { seconds: bytes / 32000, costUsd: 0.00001 }, generationId: null };
    };
    // L'Aiuto risponde quando la prova lo lascia andare.
    globalThis.__aiuto = { chiamate: 0, rilascia: null };
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      globalThis.__aiuto.chiamate += 1;
      await new Promise((r) => { globalThis.__aiuto.rilascia = r; });
      return { ...base, text: JSON.stringify({ text: risposta, status: 'done' }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  }, { detto: DETTO, risposta: RISPOSTA, modelloDettatura });
}

// Un tono al posto del microfono, nella cornice che sui siti lo apre per Filo.
async function microfonoFinto(shell) {
  await shell.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      return dest.stream;
    };
  });
}

// Quello che il main sa dell'Aiuto della scheda davanti.
const nelMain = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t ? { aiuto: t.aiuto || null, risposta: !!(t._risposteInAttesa && t._risposteInAttesa.size) } : null;
});

// Come dalle Preferenze: la porta delle impostazioni è delle pagine di Filo.
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const imposta = (app, settings) => app.evaluate(async (_e, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });

async function sito(app, openTab, testServer, html = SITO) {
  const page = await testServer.openReady(openTab, html);
  // La pagina ha detto alla barra com'è il suo Aiuto.
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  return page;
}

async function barraAperta(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra;
}

const icona = (barra) => barra.locator('#nav .ico[data-id="help"]');
const lascia = (app) => app.evaluate(() => { const r = globalThis.__aiuto.rilascia; globalThis.__aiuto.rilascia = null; if (r) r(); return !!r; });

async function chiedi(app, page, testo) {
  const ta = page.locator('.sn-sidebar textarea');
  await ta.click();
  await ta.fill(testo);
  await page.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto.chiamate), { timeout: 8_000 }).toBeGreaterThan(0);
}

test('in cima alla barra: un clic apre l\'Aiuto, il secondo detta nella sua casella, il terzo ferma', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await sito(app, openTab, testServer);
  const barra = await barraAperta(app);
  mkdirSync(SHOTS, { recursive: true });
  const help = icona(barra);
  // Per partenza sta in cima, col punto di domanda.
  expect(await barra.locator('#nav .ico').first().getAttribute('data-id')).toBe('help');
  await expect(help).toHaveAttribute('data-icona', 'help');
  await expect(help).toHaveAttribute('aria-label', 'Aiuto');
  await expect(help).toHaveAttribute('aria-disabled', 'false');
  await barra.screenshot({ path: `${SHOTS}/barra-aiuto-chiuso.png` });

  await help.click();
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible({ timeout: 8_000 });
  await expect(aiuto).not.toHaveClass(/sn-sidebar-collapsed/);
  // La barra resta aperta sotto il puntatore, e l'icona adesso è il microfono.
  await expect(help).toHaveAttribute('data-icona', 'mic');
  await expect(help).toHaveAttribute('aria-label', 'Parla');
  expect((await statoBarra(app)).aperta).toBe(true);
  await barra.screenshot({ path: `${SHOTS}/barra-aiuto-aperto.png` });

  await help.click();
  const mic = aiuto.locator('.sn-voce-btn');
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await expect(help).toHaveClass(/\bascolta\b/);
  await expect(help).toHaveAttribute('aria-label', 'Ferma');
  await expect(help).toHaveAttribute('aria-pressed', 'true');
  await barra.screenshot({ path: `${SHOTS}/barra-aiuto-ascolta.png` });
  await page.waitForTimeout(1500);

  await help.click();
  // Fermata: quello che ha detto è nella casella dell'Aiuto, e l'icona torna al microfono.
  await expect(aiuto.locator('textarea')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await expect(help).not.toHaveClass(/\bascolta\b/);
  await expect(help).toHaveAttribute('aria-label', 'Parla');
  expect(await app.evaluate(() => globalThis.__trascrizioni)).toBeGreaterThan(0);
  // Nessuno ha chiesto niente al modello dell'Aiuto: dettare non è inviare.
  expect(await app.evaluate(() => globalThis.__aiuto.chiamate)).toBe(0);
});

// Giro 1 della verifica: l'icona diceva «Ferma» ma il clic riapriva il pannello, col microfono acceso.
test('Aiuto ridotto mentre detta: l\'icona dice «Ferma» e il clic ferma, nella barra e nella riga del tasto destro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await sito(app, openTab, testServer);
  const barra = await barraAperta(app);
  const help = icona(barra);
  await help.click();
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible({ timeout: 8_000 });
  await help.click();
  const mic = aiuto.locator('.sn-voce-btn');
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await aiuto.locator('.sn-sidebar-collapse').click();
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(help).toHaveAttribute('aria-label', 'Ferma');
  await help.click();
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
  // Fermato, a pannello ridotto l'icona torna a dire che lo apre, e lo fa.
  await expect(mic).toHaveAttribute('data-stato', 'pronto', { timeout: 10_000 });
  await expect(help).toHaveAttribute('aria-label', 'Aiuto');
  await help.click();
  await expect(aiuto).not.toHaveClass(/sn-sidebar-collapsed/);

  // La stessa regola per l'icona portata nella riga del tasto destro.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'help', target: 'primary', beforeId: 'translate' }, {}));
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('help');
  await comandaBarra(app, 'chiudi');
  await page.locator('h1').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]').click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await aiuto.locator('.sn-sidebar-collapse').click();
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  await page.locator('h1').click({ button: 'right' });
  const nelMenu = menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]');
  await expect(nelMenu).toHaveAttribute('aria-label', 'Ferma', { timeout: 8_000 });
  await nelMenu.click();
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
  // Il testo dettato e il cursore rimesso in fondo non riaprono il pannello che l'utente ha ridotto, nemmeno quando la
  // pagina riprende il fuoco.
  await expect(mic).toHaveAttribute('data-stato', 'pronto', { timeout: 10_000 });
  await page.locator('h1').click();
  await page.waitForTimeout(400);
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
});

test('Filo risponde ad Aiuto ridotto: la striscia si accende e si spegne aprendo la risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const page = await sito(app, openTab, testServer);
  let barra = await barraAperta(app);
  await icona(barra).click();
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible({ timeout: 8_000 });
  await comandaBarra(app, 'chiudi');
  await chiedi(app, page, 'dove si cambia la password?');
  // Mentre Filo pensa, l'utente lo riduce.
  await aiuto.locator('.sn-sidebar-collapse').click();
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  expect(await lascia(app)).toBe(true);
  barra = await barraPage(app);
  const striscia = barra.locator('#striscia');
  await expect(striscia).toHaveClass(/\brisposta\b/, { timeout: 8_000 });
  // La risposta è arrivata, e il pannello non si è riaperto da solo.
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: RISPOSTA })).toBeHidden();
  // Accesa davvero, e ferma.
  const acceso = () => striscia.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { opacita: s.opacity, animazione: s.animationName, colore: s.backgroundImage === 'none' ? s.backgroundColor : s.backgroundImage };
  });
  await expect.poll(async () => (await acceso()).opacita).toBe('1');
  expect((await acceso()).animazione).toBe('none');
  mkdirSync(SHOTS, { recursive: true });
  await barra.screenshot({ path: `${SHOTS}/barra-aiuto-striscia-accesa.png` });
  // A barra aperta la striscia non si vede: l'icona porta il punto, e dice cosa c'è.
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const help = icona(barra);
  await expect(help).toHaveClass(/\brisposta\b/);
  await expect(help).toHaveAttribute('aria-label', 'Leggi la risposta');
  await barra.screenshot({ path: `${SHOTS}/barra-aiuto-risposta.png` });

  await help.click();
  await expect(aiuto).not.toHaveClass(/sn-sidebar-collapsed/);
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: RISPOSTA })).toBeVisible();
  await expect(striscia).not.toHaveClass(/\brisposta\b/);
  await expect(help).not.toHaveClass(/\brisposta\b/);
  expect((await nelMain(app)).risposta).toBe(false);

  // Riaprirla cliccando nella casella del pannello ridotto è la stessa cosa.
  await comandaBarra(app, 'chiudi');
  await chiedi(app, page, 'e l\'email?');
  await aiuto.locator('.sn-sidebar-collapse').click();
  await lascia(app);
  await expect(striscia).toHaveClass(/\brisposta\b/, { timeout: 8_000 });
  await aiuto.locator('textarea').click();
  await expect(aiuto).not.toHaveClass(/sn-sidebar-collapsed/);
  await expect(striscia).not.toHaveClass(/\brisposta\b/);
});

test('chiuso mentre Filo risponde: la risposta non si perde, e riaprendo l\'Aiuto la ritrovi', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const page = await sito(app, openTab, testServer);
  const barra = await barraAperta(app);
  const help = icona(barra);
  await help.click();
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible({ timeout: 8_000 });
  await comandaBarra(app, 'chiudi');
  await chiedi(app, page, 'dove si cambia la password?');
  await aiuto.locator('.sn-sidebar-close').click();
  await expect(aiuto).toBeHidden();
  await expect.poll(async () => (await nelMain(app)).aiuto.pannello).toBe('chiuso');
  await lascia(app);
  await expect(barra.locator('#striscia')).toHaveClass(/\brisposta\b/, { timeout: 8_000 });
  await expect(aiuto).toBeHidden();
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(help).toHaveAttribute('aria-label', 'Leggi la risposta');
  await expect(help).toHaveAttribute('data-icona', 'help');
  await help.click();
  await expect(aiuto).toBeVisible();
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: RISPOSTA })).toBeVisible();
  await expect(aiuto.locator('.sn-sidebar-msg-user', { hasText: 'dove si cambia la password?' })).toBeVisible();
  await expect(barra.locator('#striscia')).not.toHaveClass(/\brisposta\b/);
  // Letta, la × chiude davvero: la volta dopo l'Aiuto riparte da capo.
  await aiuto.locator('.sn-sidebar-close').click();
  await expect(aiuto).toHaveCount(0);
  // Il clic sulla pagina ha chiuso la barra.
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await help.click();
  await expect(page.locator('.sn-sidebar')).toBeVisible();
  await expect(page.locator('.sn-sidebar-msg-assistant')).toHaveCount(0);

  // Chiuso e poi la pagina cambia: la risposta se ne va con lei, e la striscia si spegne.
  await comandaBarra(app, 'chiudi');
  await chiedi(app, page, 'ancora una cosa');
  await page.locator('.sn-sidebar-close').click();
  await lascia(app);
  await expect(barra.locator('#striscia')).toHaveClass(/\brisposta\b/, { timeout: 8_000 });
  await page.evaluate((u) => { location.href = u; }, testServer.html(SITO));
  await expect(barra.locator('#striscia')).not.toHaveClass(/\brisposta\b/, { timeout: 8_000 });
});

test('dove la voce «Aiuto» non c\'è l\'icona è spenta e dice perché; senza modello di dettatura avvisa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, { modelloDettatura: false });
  await microfonoFinto(shell);
  const page = await sito(app, openTab, testServer);
  const barra = await barraAperta(app);
  const help = icona(barra);

  // Senza modello di dettatura: l'Aiuto si apre, il microfono parte, e l'errore arriva come per gli altri modelli.
  await help.click();
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await help.click();
  await expect(page.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await page.waitForTimeout(1500);
  await help.click();
  await expect(page.locator('.sn-toast').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'pronto');

  // Filo spento su questo sito.
  const host = new URL(page.url()).hostname;
  await imposta(app, { blocklist: [host] });
  await expect(help).toHaveAttribute('aria-disabled', 'true', { timeout: 8_000 });
  await expect(help).toHaveAttribute('data-sugg', 'Filo è spento su questo sito');
  await help.click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-sidebar')).toBeVisible();

  // L'Aiuto spento in Preferenze: il pannello se ne va e l'icona lo dice.
  await imposta(app, { blocklist: [], featureFlags: { help: false } });
  await expect(help).toHaveAttribute('data-sugg', 'Aiuto spento in Preferenze', { timeout: 8_000 });
  await expect(help).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);
  mkdirSync(SHOTS, { recursive: true });
  await barra.screenshot({ path: `${SHOTS}/barra-aiuto-spento.png` });

  // Riacceso, si riaccende anche l'icona.
  await imposta(app, { featureFlags: { help: true } });
  await expect(help).toHaveAttribute('aria-disabled', 'false', { timeout: 8_000 });
  await expect(help).toHaveAttribute('aria-label', 'Aiuto');
});

test('l\'icona si toglie dalla barra e nel menu del tasto destro fa lo stesso; la voce «Aiuto» riapre l\'Aiuto ridotto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app);
  const page = await sito(app, openTab, testServer);
  const barra = await barraPage(app);
  // Nella riga del tasto destro, in testa: in fondo sarebbe lei a scendere in «Altro…».
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'help', target: 'primary', beforeId: 'translate' }, {}));
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('help');
  await expect(icona(barra)).toHaveCount(0);

  await page.locator('h1').click({ button: 'right' });
  const nelMenu = menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]');
  await expect(nelMenu).toBeVisible({ timeout: 8_000 });
  await expect(nelMenu).toHaveAttribute('aria-label', 'Aiuto');
  await nelMenu.click();
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible({ timeout: 8_000 });
  // Con l'Aiuto aperto la stessa icona è il microfono.
  await page.locator('h1').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]')).toHaveAttribute('aria-label', 'Parla', { timeout: 8_000 });
  await page.keyboard.press('Escape');

  // Ridotto, la voce «Aiuto» lo riapre intero (prima non faceva niente).
  await aiuto.locator('.sn-sidebar-collapse').click();
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  await page.locator('h1').click({ button: 'right' });
  await menuDi(page).voce('Aiuto').first().click();
  await expect(aiuto).not.toHaveClass(/sn-sidebar-collapsed/);

  // Spento in Preferenze: nella riga è spenta e dice perché, come nella barra.
  await imposta(app, { featureFlags: { help: false } });
  await expect(aiuto).toHaveCount(0, { timeout: 8_000 });
  await page.locator('h1').click({ button: 'right' });
  const spenta = menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]');
  await expect(spenta).toHaveClass(/sn-menu-btn-disabled/, { timeout: 8_000 });
  await expect(spenta).toHaveAttribute('aria-label', 'Aiuto spento in Preferenze');
  await page.keyboard.press('Escape');
  await imposta(app, { featureFlags: { help: true } });

  // E si rimette nella barra.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'help', target: 'bar', beforeId: 'back' }, {}));
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 2)).toEqual(['help', 'back']);
});

// La scheda nuova nasce già pronta dietro le quinte: quello che la sua pagina ha detto alla barra vale quando arriva.
test.describe('la scheda nuova già pronta', () => {
  test.use({ riservaNuovaScheda: true });
  test('con Ctrl+T l\'icona Aiuto è accesa subito, e il clic apre l\'Aiuto', async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const r = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.riserva;
      const wc = r && r.webContents();
      return !!(wc && wc.getURL() === 'filo://newtab/' && !wc.isLoading() && r.campi && r.campi.aiuto);
    }), { timeout: 20_000, message: 'la riserva non ha ancora detto com\'è il suo Aiuto' }).toBe(true);
    await shell.keyboard.press('Control+t');
    await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 5_000 }).toBe('chiuso');
    const barra = await barraAperta(app);
    const help = icona(barra);
    await expect(help).toHaveAttribute('aria-disabled', 'false');
    await help.click();
    await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('aperto');
    await expect(help).toHaveAttribute('data-icona', 'mic');
  });
});
