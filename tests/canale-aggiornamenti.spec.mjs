// Il canale degli aggiornamenti (SPEC-DOMANDE.md §4.2): veloce di serie, stabile prende solo la minor del lunedì.
// Si sceglie in Preferenze o in chat; sullo stabile una patch delle sei ore non diventa una carta, e quella già trovata
// se ne va. L'aggiornatore è finto, nel main (la scelta della release vera sta in tests/unit/canaleAggiornamenti).

import { test, expect } from './fixtures/electron.mjs';
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
const canale = async (app) => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).aggiornamenti?.canale;

// Trova sempre la patch 0.2.250, come il feed veloce; `emetti` fa arrivare una versione qualunque.
async function aggiornatoreFinto(app) {
  await app.evaluate(async () => {
    const ascolta = {};
    const u = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      controlli: 0,
      on(e, f) { (ascolta[e] ||= []).push(f); return u; },
      removeListener(e, f) { ascolta[e] = (ascolta[e] || []).filter((x) => x !== f); return u; },
      emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
      async checkForUpdates() {
        u.controlli += 1;
        u.emit('update-available', { version: '0.2.250', tag: 'v0.2.250' });
        return {};
      },
      downloadUpdate() { return new Promise(() => {}); },
    };
    globalThis.__aggFinto = u;
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { automatici: false } });
    await globalThis.__filoUpdater.avviaAggiornatore(u, {
      automatici: false, annuncia: () => globalThis.__filoHandlers.broadcastLiveUpdate(),
    });
  });
}
const emetti = (app, versione) => app.evaluate((_e, v) => globalThis.__aggFinto.emit('update-available', { version: v, tag: `v${v}` }), versione);

async function tema(page, t) {
  await page.evaluate((x) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: x } }), t);
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t);
}

test('Preferenze: veloce di serie; scelto lo stabile, la patch trovata se ne va, le patch nuove non arrivano e la minor sì', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await aggiornatoreFinto(app);
  const cartaDi = (v) => home.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: `versione ${v}` });
  await expect(cartaDi('0.2.250')).toBeVisible({ timeout: 8_000 });

  const pref = await openTab('filo://preferences/preferences.html');
  const gruppo = pref.locator('#sec-advanced #sec-aggiornamenti #aggiornamentiCanale');
  await expect(gruppo.locator('input[value="veloce"]')).toBeChecked({ timeout: 8_000 });
  await expect(gruppo).toContainText('Veloce');
  await expect(gruppo).toContainText('Stabile');

  await gruppo.locator('label', { hasText: 'Stabile' }).click();
  await expect.poll(() => canale(app)).toBe('stabile');
  await expect(gruppo.locator('input[value="stabile"]')).toBeChecked();
  // La patch delle sei ore, trovata quando il canale era veloce, non resta come carta da installare.
  await expect(cartaDi('0.2.250')).toHaveCount(0, { timeout: 5_000 });
  // Il cambio richiede subito: il feed ridà la patch, e sullo stabile non diventa niente.
  await expect.poll(() => app.evaluate(() => globalThis.__aggFinto.controlli)).toBeGreaterThan(1);
  await emetti(app, '0.2.251');
  await home.waitForTimeout(300);
  await expect(cartaDi('0.2.251')).toHaveCount(0);
  // La minor del lunedì sì.
  await emetti(app, '0.3.0');
  await expect(cartaDi('0.3.0')).toBeVisible({ timeout: 5_000 });

  await pref.locator('#sec-aggiornamenti').scrollIntoViewIfNeeded();
  mkdirSync(SHOTS, { recursive: true });
  for (const t of ['light', 'dark']) {
    await tema(pref, t);
    await gruppo.locator('label', { hasText: 'Veloce' }).hover();
    await pref.locator('#sec-aggiornamenti').screenshot({ path: `${SHOTS}/canale-aggiornamenti-${t}.png` });
  }
  await tema(pref, 'light');

  // Riaperta, la pagina ricorda la scelta; e si torna indietro.
  await pref.reload();
  await expect(pref.locator('#aggiornamentiCanale input[value="stabile"]')).toBeChecked({ timeout: 8_000 });
  await pref.locator('#aggiornamentiCanale label', { hasText: 'Veloce' }).click();
  await expect.poll(() => canale(app)).toBe('veloce');
});

test('«passa agli aggiornamenti stabili» in chat sceglie lo stabile, e le Preferenze aperte lo seguono', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#aggiornamentiCanale input[value="veloce"]')).toBeChecked({ timeout: 8_000 });

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const giri = [
      { toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'canale_aggiornamenti', valore: 'stabile' }) }] },
      { text: 'Fatto: aggiornamenti stabili.' },
    ];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n, giri.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  });
  await chat.bringToFront();
  await chat.locator('#input').fill('passa agli aggiornamenti stabili');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto: aggiornamenti stabili.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => canale(app), { timeout: 5_000 }).toBe('stabile');
  await expect(pref.locator('#aggiornamentiCanale input[value="stabile"]')).toBeChecked({ timeout: 5_000 });
});

test('sullo stabile «Scarica Filo» dell’avviso apre la pagina della minor, non il sito che dà l’ultima patch', async ({ app }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { canale: 'stabile' } });
    globalThis.__filoUpdater.seguiImpostazioni(await globalThis.SN_STORAGE.getSettings());
    await globalThis.__filoUpdater.avvisaInstallazioneFallita('0.4.0');
  });
  const page = await homeDi(app);
  await page.reload();
  const carta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: '0.4.0' });
  await expect(carta).toBeVisible({ timeout: 10_000 });
  await expect(carta.locator('.dash-carta-stato')).toContainText('releases/tag/v0.4.0');
  await carta.locator('.dash-carta-az.principale', { hasText: 'Scarica Filo' }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.map((t) => String(t.url || '')).find((u) => /releases\/tag\/v0\.4\.0|filo\.red/.test(u)) || '';
  })).toBe('https://github.com/sathyaram1/Filo/releases/tag/v0.4.0');
});
