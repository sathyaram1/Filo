// #786 — «Installa gli aggiornamenti da solo»: spenta, Filo non scarica né installa la versione nuova e mette in
// home una carta con «Installa»; premuto, la scarica mostrando a che punto è e la installa alla chiusura. La stessa
// scelta si fa dalle Preferenze o chiedendola a Filo, che chiede conferma spiegando il rischio. L'aggiornatore vero
// gira solo nelle build installate: qui ce n'è uno finto nel main, guidato dalla prova. Foto in tests/.shots/.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmState } from './helpers/confirm.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const finto = (app) => app.evaluate(() => {
  const u = globalThis.__aggFinto;
  return { scaricamenti: u.scaricamenti, autoDownload: u.autoDownload, autoInstallOnAppQuit: u.autoInstallOnAppQuit };
});

// L'aggiornatore finto: trova la `versione` sul feed; lo scaricamento si ferma al 37% finché la prova non lo finisce.
async function aggiornatoreFinto(app, { automatici, versione = '9.9.9' }) {
  await app.evaluate(async (_e, { automatici: auto, versione: v }) => {
    const ascolta = {};
    const u = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      scaricamenti: 0,
      on(e, f) { (ascolta[e] ||= []).push(f); return u; },
      emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
      async checkForUpdates() {
        u.emit('update-available', { version: v });
        return { downloadPromise: u.autoDownload ? u.downloadUpdate() : null };
      },
      checkForUpdatesAndNotify() { return u.checkForUpdates(); },
      downloadUpdate() {
        u.scaricamenti += 1;
        setTimeout(() => u.emit('download-progress', { percent: 37.4 }), 50);
        return new Promise((ok) => { u.finisci = () => { u.emit('update-downloaded', { version: v }); ok([]); }; });
      },
    };
    globalThis.__aggFinto = u;
    await globalThis.__filoUpdater.avviaAggiornatore(u, {
      automatici: auto, annuncia: () => globalThis.__filoHandlers.broadcastLiveUpdate(),
    });
  }, { automatici, versione });
}

async function tema(page, t) {
  await page.evaluate((x) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: x } }), t);
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t);
}

test('spenta: la versione nuova non parte da sola; «Installa» sulla carta la scarica, mostra a che punto è e la installa alla chiusura', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await aggiornatoreFinto(app, { automatici: false });

  const carta = home.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 9.9.9' });
  await expect(carta).toBeVisible({ timeout: 8_000 });
  await expect(carta.locator('.dash-carta-tit')).toHaveText('Aggiornamento');
  await expect(carta.locator('.dash-carta-stato')).toContainText('C\'è la versione 9.9.9 di Filo.');
  await expect(carta.locator('.dash-carta-az.principale')).toHaveText('Installa');
  await expect(carta.locator('.dash-carta-az.secondaria')).toHaveText('Chiudi');
  expect(await finto(app)).toEqual({ scaricamenti: 0, autoDownload: false, autoInstallOnAppQuit: false });

  // Il tasto destro offre le stesse azioni dei pulsanti, e la strada per la preferenza.
  await carta.click({ button: 'right', position: { x: 30, y: 12 } });
  const menu = home.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Installa', { exact: true })).toBeVisible();
  await expect(menu.getByText('Preferenze sugli aggiornamenti', { exact: true })).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await home.screenshot({ path: `${SHOTS}/aggiornamenti-carta-menu.png` });
  await home.keyboard.press('Escape');

  for (const t of ['light', 'dark']) {
    await tema(home, t);
    await home.mouse.move(640, 300);
    await home.waitForTimeout(250);
    await home.screenshot({ path: `${SHOTS}/aggiornamenti-carta-${t}.png` });
  }
  await tema(home, 'light');

  await carta.locator('.dash-carta-az.principale').click();
  await expect(carta.locator('.dash-carta-stato')).toHaveText('Scarico la versione 9.9.9: 37%', { timeout: 5_000 });
  await expect(carta.locator('.dash-carta-avanza')).toBeVisible();
  await expect(carta.locator('.dash-carta-az.principale')).toHaveCount(0);
  expect(await finto(app)).toEqual({ scaricamenti: 1, autoDownload: false, autoInstallOnAppQuit: true });
  await home.screenshot({ path: `${SHOTS}/aggiornamenti-carta-scarica.png` });

  await app.evaluate(() => globalThis.__aggFinto.finisci());
  await expect(carta.locator('.dash-carta-stato')).toHaveText('La versione 9.9.9 è pronta: si installa quando chiudi Filo.', { timeout: 5_000 });
  await home.screenshot({ path: `${SHOTS}/aggiornamenti-carta-pronta.png` });
  // Chiusa, la carta di questa versione non torna a un nuovo controllo.
  await carta.locator('.dash-carta-togli').click();
  await expect(carta).toHaveCount(0);
  await aggiornatoreFinto(app, { automatici: false });
  await home.waitForTimeout(500);
  await expect(home.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 9.9.9' })).toHaveCount(0);
});

test('accesa: tutto come prima, la versione nuova si scarica da sola e in home non compare niente', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await aggiornatoreFinto(app, { automatici: true });
  expect(await finto(app)).toEqual({ scaricamenti: 1, autoDownload: true, autoInstallOnAppQuit: true });
  await home.waitForTimeout(500);
  await expect(home.locator('#accade .dash-carta[data-tipo="avviso"]')).toHaveCount(0);
});

test('Preferenze, Impostazioni avanzate: l\'opzione è accesa di serie, spenta vale subito e si riaccende', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await aggiornatoreFinto(app, { automatici: true });
  const pref = await openTab('filo://preferences/preferences.html');
  const casella = pref.locator('#sec-advanced #sec-aggiornamenti #aggiornamentiAutomatici');
  await expect(casella).toBeChecked({ timeout: 8_000 });
  await expect(pref.locator('#sec-aggiornamenti')).toContainText('Installa gli aggiornamenti da solo');

  await casella.uncheck();
  await expect.poll(async () => (await impostazioni(app)).aggiornamenti?.automatici).toBe(false);
  // Già scaricata all'avvio, spenta adesso: alla chiusura non si installa.
  expect((await finto(app)).autoInstallOnAppQuit).toBe(false);
  await pref.locator('#sec-aggiornamenti').scrollIntoViewIfNeeded();
  mkdirSync(SHOTS, { recursive: true });
  for (const t of ['light', 'dark']) {
    await tema(pref, t);
    await pref.locator('#sec-aggiornamenti').screenshot({ path: `${SHOTS}/aggiornamenti-preferenze-${t}.png` });
  }
  await tema(pref, 'light');

  await casella.check();
  await expect.poll(async () => (await impostazioni(app)).aggiornamenti?.automatici).toBe(true);
  expect((await finto(app)).autoInstallOnAppQuit).toBe(true);
});

test('la voce del tasto destro della carta porta alla preferenza, anche in fondo alla pagina', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await aggiornatoreFinto(app, { automatici: false });
  const carta = home.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 9.9.9' });
  await expect(carta).toBeVisible({ timeout: 8_000 });
  await carta.click({ button: 'right', position: { x: 30, y: 12 } });
  await home.locator('.sn-menu').getByText('Preferenze sugli aggiornamenti', { exact: true }).click();
  const pref = await trovaPagina(app, (u) => u.startsWith('filo://preferences/'));
  const casella = pref.locator('#aggiornamentiAutomatici');
  await expect(casella).not.toBeChecked({ timeout: 8_000 });
  await expect(casella).toBeInViewport({ timeout: 5_000 });
});

// Il modello finto della chat: un giro per elemento, come in impostazioni-dalla-chat.spec.mjs.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

test('«non aggiornarti da solo» in chat: la conferma spiega il rischio, e solo dopo l\'OK l\'opzione si spegne', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await aggiornatoreFinto(app, { automatici: true });
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#aggiornamentiAutomatici')).toBeChecked({ timeout: 8_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'a1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'aggiornamenti_automatici', valore: false }) }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('non aggiornarti da solo');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 5_000 }).toContain('Installa gli aggiornamenti da solo');
  expect((await confirmState(chat)).text).toMatch(/problemi di sicurezza già corretti/);
  expect((await impostazioni(app)).aggiornamenti.automatici, 'cambiata prima dell\'OK').toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/aggiornamenti-chat-conferma.png` });

  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await impostazioni(app)).aggiornamenti.automatici, { timeout: 5_000 }).toBe(false);
  expect((await finto(app)).autoInstallOnAppQuit).toBe(false);
  // La versione trovata all'avvio, che non si installerà più da sola, diventa la carta con «Installa».
  await expect(chat.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 9.9.9' })).toBeVisible({ timeout: 5_000 });
  // Le Preferenze già aperte seguono il cambio.
  await expect(pref.locator('#aggiornamentiAutomatici')).not.toBeChecked({ timeout: 5_000 });
});
