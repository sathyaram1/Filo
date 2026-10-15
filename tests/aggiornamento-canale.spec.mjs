// #1160 — Il canale degli aggiornamenti, veloce o stabile, si sceglie in Preferenze o in chat e l'aggiornatore lo segue
// subito: la carta di una patch del veloce sparisce sullo stabile e torna sul veloce. Quale release prende ogni canale
// lo prova tests/unit/aggiornamentoCanale.test.mjs sull'electron-updater vero; qui l'aggiornatore è finto. Foto in tests/.shots/.

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
const finto = (app) => app.evaluate(() => ({ canale: globalThis.__aggFinto.filoCanale, controlli: globalThis.__aggFinto.controlli }));

// Il finto risponde come la scelta della release di electron-updater: sul veloce c'è la patch 0.4.3, sullo stabile niente
// di più nuovo della 0.4.0 in uso. Da spento la patch diventa la carta «Installa» nella home.
async function aggiornatoreFinto(app) {
  await app.evaluate(async () => {
    globalThis.__filoUpdater.perProva({ piattaforma: 'win32', versione: '0.4.0' });
    const ascolta = {};
    const u = {
      controlli: 0,
      on(e, f) { (ascolta[e] ||= []).push(f); return u; },
      removeListener(e, f) { ascolta[e] = (ascolta[e] || []).filter((x) => x !== f); return u; },
      emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
      async checkForUpdates() {
        u.controlli += 1;
        if (u.filoCanale === 'stabile') u.emit('update-not-available', { version: '0.4.0', tag: 'v0.4.0' });
        else u.emit('update-available', { version: '0.4.3', tag: 'v0.4.3' });
        return {};
      },
      downloadUpdate() { return new Promise(() => {}); },
    };
    globalThis.__aggFinto = u;
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { automatici: false } });
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.__filoUpdater.avviaAggiornatore(u, {
      automatici: false, canale: s.aggiornamenti.canale, annuncia: () => globalThis.__filoHandlers.broadcastLiveUpdate(),
    });
  });
}

async function tema(page, t) {
  await page.evaluate((x) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: x } }), t);
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t);
}

test('Preferenze: veloce di serie; stabile toglie la carta della patch, il veloce la riporta', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await aggiornatoreFinto(app);
  const carta = home.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 0.4.3' });
  await expect(carta).toBeVisible({ timeout: 8_000 });

  const pref = await openTab('filo://preferences/preferences.html');
  const canale = pref.locator('#sec-advanced #sec-aggiornamenti #aggiornamentiCanale');
  await expect(canale).toHaveValue('veloce', { timeout: 8_000 });
  expect((await impostazioni(app)).aggiornamenti.canale).toBe('veloce');
  const prima = (await finto(app)).controlli;

  await canale.selectOption('stabile');
  await expect.poll(async () => (await impostazioni(app)).aggiornamenti?.canale).toBe('stabile');
  expect((await finto(app)).canale).toBe('stabile');
  await expect.poll(async () => (await finto(app)).controlli, { timeout: 5_000 }).toBeGreaterThan(prima);
  await expect(carta).toHaveCount(0, { timeout: 5_000 });
  expect((await app.evaluate(() => globalThis.__filoUpdater.statoAggiornamento())).canale).toBe('stabile');

  await pref.bringToFront();
  await pref.locator('#sec-aggiornamenti').scrollIntoViewIfNeeded();
  mkdirSync(SHOTS, { recursive: true });
  for (const t of ['light', 'dark']) {
    await tema(pref, t);
    await pref.locator('#sec-aggiornamenti').screenshot({ path: `${SHOTS}/aggiornamenti-canale-${t}.png` });
  }
  await tema(pref, 'light');

  await canale.selectOption('veloce');
  await expect.poll(async () => (await impostazioni(app)).aggiornamenti?.canale).toBe('veloce');
  await expect(carta).toBeVisible({ timeout: 5_000 });
});

// Il modello finto della chat: un giro per elemento, come in aggiornamenti-da-soli.spec.mjs.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const C = globalThis.SN_CONST;
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

test('«passa al canale stabile» in chat: cambia il canale, l\'aggiornatore lo segue e le Preferenze aperte anche', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await aggiornatoreFinto(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#aggiornamentiCanale')).toHaveValue('veloce', { timeout: 8_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'canale_aggiornamenti', valore: 'stabile' }) }] },
    { text: 'Fatto: canale stabile.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('passa al canale stabile degli aggiornamenti');
  await chat.locator('#sendBtn').click();
  // Se l'autonomia chiede conferma, la conferma dice cosa cambia.
  await expect.poll(async () => {
    const c = await confirmState(chat);
    if (c?.text) {
      expect(c.text).toMatch(/Canale degli aggiornamenti → stabile/);
      await clickConfirm(chat, 'ok');
    }
    return (await impostazioni(app)).aggiornamenti?.canale;
  }, { timeout: 10_000 }).toBe('stabile');
  expect((await finto(app)).canale).toBe('stabile');
  await expect(chat.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 0.4.3' })).toHaveCount(0, { timeout: 5_000 });
  await expect(pref.locator('#aggiornamentiCanale')).toHaveValue('stabile', { timeout: 5_000 });
});
