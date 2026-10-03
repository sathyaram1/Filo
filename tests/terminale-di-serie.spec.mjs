// #892 — la modalità terminale è accesa di serie e serve anche a chi non sa
// cos'è un terminale: Filo dice a parole cosa fa ogni comando, la prima volta
// spiega cosa succede (una volta sola, anche dopo un riavvio), e i livelli
// restano quelli di cmdClassify. Il modello è finto: i comandi sono veri.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIRM_HOST, confirmState, clickConfirm } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRASE = 'Per questo uso il terminale del computer';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Provider finto: una risposta per giro del modello, nell'ordine.
async function fakeProvider(app, giri) {
  await app.evaluate(async (_electron, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

const comando = (id, cmd, spiegazione) => ({
  toolCalls: [{ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: cmd, spiegazione }) }],
});

async function chiedi(page, testo, risposta) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: risposta }).last()).toBeVisible({ timeout: 15_000 });
}

const impostazioni = (page) => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

test('profilo nuovo: una lettura parte subito con la frase della prima volta, una cancellazione chiede «conferma»', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await expect(input).toBeVisible();
  expect((await impostazioni(page)).terminal.enabled, 'su un profilo nuovo il terminale è acceso').toBe(true);
  await expect(input).toHaveAttribute('placeholder', 'Chiedi qualsiasi cosa…');
  await expect(page.locator('#dashDir')).toBeHidden();

  await configureModel(app);
  await fakeProvider(app, [
    comando('c1', 'echo spazio-libero-892', 'Misuro lo spazio libero sul disco'),
    { text: 'Hai parecchio spazio libero.' },
    comando('c2', 'rm -rf cartella-892-che-non-esiste', 'Cancello la cartella cartella-892-che-non-esiste'),
    { text: 'Ti chiedo conferma prima di cancellare.' },
  ]);

  // Lettura: nessun popup, l'esito è già lì; la frase spiega cosa è successo e dove si spegne.
  await chiedi(page, 'quanto spazio ho sul disco?', 'Hai parecchio spazio libero.');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  const frase = page.locator('.dash-cmd-primavolta');
  await expect(frase).toHaveCount(1);
  await expect(frase).toContainText(`${FRASE}: quello che legge parte subito, quello che cambia qualcosa te lo chiedo prima. Si spegne in Preferenze.`);
  const blocco = page.locator('.dash-activity').last();
  await blocco.locator('.dash-activity-head').click();
  const esito = blocco.locator('.dash-activity-cmd');
  await expect(esito.locator('.dash-cmd-cosa')).toHaveText('Misuro lo spazio libero sul disco');
  await expect(esito.locator('.dash-cmd-line')).toHaveText('$ echo spazio-libero-892');
  await expect(esito.locator('.dash-cmd-output')).toContainText('spazio-libero-892');
  // Girato un comando, la chat mostra dove lavora e come scriverne uno.
  await expect(input).toHaveAttribute('placeholder', /comando per la shell/);
  await expect(page.locator('#dashDir')).toBeVisible();

  // Cancellazione: il bottone dice prima a parole cosa fa, il comando vero sta sotto.
  await chiedi(page, 'cancella la cartella', 'Ti chiedo conferma prima di cancellare.');
  const btn = page.locator('.dash-cmd-btn').last();
  await expect(btn.locator('.dash-cmd-btn-cosa')).toHaveText('▶ Cancello la cartella cartella-892-che-non-esiste');
  await expect(btn.locator('.dash-cmd-btn-codice')).toHaveText('rm -rf cartella-892-che-non-esiste');
  await expect(page.locator('.dash-cmd-primavolta'), 'la frase della prima volta si dice una volta sola').toHaveCount(1);

  await btn.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  const st = await confirmState(page);
  const righe = st.text.split('\n');
  expect(righe[0], 'il popup apre con cosa fa il comando, a parole').toBe('Cancello la cartella cartella-892-che-non-esiste');
  expect(righe).toContain('rm -rf cartella-892-che-non-esiste');
  expect(st.hasInput, 'una cancellazione chiede di scrivere «conferma»').toBe(true);
  expect(st.okDisabled).toBe(true);
  await clickConfirm(page, 'cancel');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect(btn.locator('.dash-cmd-btn-cosa')).toContainText('▶');

  // «Preferenze» porta dritto alla voce che lo spegne.
  await frase.locator('a', { hasText: 'Preferenze' }).click();
  let pref = null;
  await expect.poll(() => {
    pref = app.windows().find((w) => w.url().includes('preferences.html#sec-terminal')) || null;
    return Boolean(pref);
  }, { timeout: 10_000 }).toBe(true);
  await pref.waitForLoadState('domcontentloaded');
  await expect(pref.locator('#sec-terminal #terminalEnabled')).toBeChecked();
  await expect(pref.locator('#sec-terminal h2')).toBeInViewport();
});

test('la frase si dice una volta sola anche dopo un riavvio; spento di proposito resta spento; il ripristino lo riaccende', async () => {
  test.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-892-');
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const giro = async (app, risposta) => {
    await configureModel(app);
    await fakeProvider(app, [comando('c1', 'echo giro-892', 'Scrivo una parola di prova'), { text: risposta }]);
    const page = await newtabPage(app);
    await chiedi(page, 'prova il terminale', risposta);
    return page;
  };
  try {
    let app = await launch();
    try {
      const page = await giro(app, 'Prima volta fatta.');
      await expect(page.locator('.dash-cmd-primavolta')).toHaveCount(1);
    } finally { await chiudiApp(app); }

    app = await launch();
    try {
      const page = await giro(app, 'Seconda volta fatta.');
      await expect(page.locator('.dash-activity-cmd .dash-cmd-output').last()).toContainText('giro-892');
      await expect(page.locator('.dash-cmd-primavolta'), 'dopo il riavvio la frase non torna').toHaveCount(0);
      // Spento di proposito, da Preferenze.
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { terminal: { enabled: false } } }));
    } finally { await chiudiApp(app); }

    app = await launch();
    try {
      const page = await newtabPage(app);
      expect((await impostazioni(page)).terminal.enabled, 'chi l\'ha spento lo ritrova spento').toBe(false);
      const bloccato = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'ESEGUI_COMANDO', comando: 'echo no', spiegazione: 'x' }));
      expect(bloccato.output?.blocked, 'spento, nessun comando parte').toBe('disabled');
      // Il ripristino delle impostazioni riporta i valori di serie: acceso.
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'reset_settings' }));
      await expect.poll(async () => (await impostazioni(page)).terminal.enabled).toBe(true);
    } finally { await chiudiApp(app); }
  } finally {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
