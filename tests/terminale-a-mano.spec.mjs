// #892.1 — un comando scritto a mano nella home passa dagli stessi livelli di autonomia di quelli di Filo: una lettura
// parte, una cancellazione chiede prima (e col no torna nella barra), e la shell non parte senza quel sì nemmeno
// chiamata direttamente. Una / seguita da una parola che non è un programma resta un messaggio per Filo.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm, fillConfirmInput } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

function cartellaDaCancellare() {
  const dir = cartellaTemporanea('filo-892-1-');
  const bersaglio = path.join(dir, 'da-cancellare-892');
  mkdirSync(bersaglio);
  writeFileSync(path.join(bersaglio, 'dentro.txt'), 'x');
  return bersaglio;
}

const rmDi = (cartella) => (process.platform === 'win32'
  ? `Remove-Item -Recurse -Force "${cartella}"`
  : `rm -rf "${cartella}"`);

test('profilo nuovo: una cancellazione scritta a mano chiede prima, col no torna nella barra, col sì parte', async ({ app }) => {
  const bersaglio = cartellaDaCancellare();
  const page = await newtabPage(app);
  const input = page.locator('#input');
  const comando = `/${rmDi(bersaglio)}`;

  await input.fill(comando);
  await input.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  const st = await confirmState(page);
  expect(st.text, 'il popup mostra il comando che partirà').toContain(rmDi(bersaglio));
  expect(st.hasInput, 'su un profilo nuovo (Normale) una cancellazione chiede un OK').toBe(false);
  expect(st.fuori, 'fuori dal comando citato la domanda dice a parole cosa rischia chi preme OK').toMatch(/cancellare/);
  await page.screenshot({ path: 'tests/.shots/892-1-conferma.png' }).catch(() => {});
  expect(existsSync(bersaglio), 'mentre chiede non è partito niente').toBe(true);

  await clickConfirm(page, 'cancel');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect(input, 'col no il comando torna nella barra com\'era').toHaveValue(comando);
  await expect(page.locator('.dash-term-cmd')).toHaveCount(0);
  expect(existsSync(bersaglio)).toBe(true);

  await input.press('Enter');
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(page.locator('.dash-term-cmd').last()).toContainText(rmDi(bersaglio), { timeout: 12_000 });
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });
  expect(existsSync(bersaglio), 'col sì la cartella è stata cancellata').toBe(false);
  await expect(input).toHaveValue('');
});

test('una cancellazione incollata conta come scritta da altri: chiede la parola «conferma», anche dopo un Annulla', async ({ app }) => {
  const bersaglio = cartellaDaCancellare();
  const page = await newtabPage(app);
  const input = page.locator('#input');
  const comando = `/${rmDi(bersaglio)}`;

  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), comando);
  await input.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await expect(input).toHaveValue(comando);
  await input.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  expect((await confirmState(page)).hasInput, 'una riga incollata che cancella vuole la parola, non basta un OK').toBe(true);
  await clickConfirm(page, 'cancel');
  await expect(input).toHaveValue(comando);

  await input.press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  expect((await confirmState(page)).hasInput, 'rimessa nella barra resta incollata').toBe(true);
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
  await expect.poll(() => existsSync(bersaglio), { timeout: 12_000 }).toBe(false);
});

test('una lettura scritta a mano parte subito; la shell chiamata senza il sì non cancella', async ({ app }) => {
  const bersaglio = cartellaDaCancellare();
  const page = await newtabPage(app);

  await page.locator('#input').fill('/echo letto-892-1');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-term-out').last()).toContainText('letto-892-1', { timeout: 12_000 });
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  const esito = await page.evaluate((command) => new Promise((resolve) => {
    window.filo.shellExec({
      command,
      cwd: '',
      shell: window.SN_DASH_TERMINALE.getShell(),
      onData: () => {},
      onExit: (e) => resolve({ partito: true, e }),
      onError: (e) => resolve({ partito: false, messaggio: e && e.message }),
    });
  }), rmDi(bersaglio));
  expect(esito.partito, 'senza il sì della persona la shell non lo lancia').toBe(false);
  expect(esito.messaggio).toMatch(/conferma/);
  expect(existsSync(bersaglio)).toBe(true);
});

test('con il livello Conservativo anche una modifica scritta a mano chiede: le regole sono quelle di Filo', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-1-');
  const nuova = path.join(dir, 'nuova-892');
  await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ autonomia: { ...(s.autonomia || {}), livello: 'conservativo' } });
  });
  const page = await newtabPage(app);
  await page.locator('#input').fill(`/mkdir "${nuova}"`);
  await page.locator('#input').press('Enter');
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect.poll(() => existsSync(nuova), { timeout: 12_000 }).toBe(true);
});

test('una / seguita da una parola che non è un programma, o da un percorso incollato, va a Filo', async ({ app }) => {
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiesto892 = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...(messages || [])].reverse().find((m) => m && m.role === 'user');
      globalThis.__chiesto892.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content || ''));
      const text = `Risposta ${globalThis.__chiesto892.length} di Filo.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('/parolainventata892 come stai');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta 1 di Filo.' })).toBeVisible({ timeout: 15_000 });
  const percorso = path.join(cartellaTemporanea('filo-892-1-'), 'nota-892.txt');
  await page.locator('#input').fill(`/${percorso.replace(/^\//, '')}`);
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta 2 di Filo.' })).toBeVisible({ timeout: 15_000 });

  const chiesto = await app.evaluate(() => globalThis.__chiesto892);
  expect(chiesto[0]).toContain('/parolainventata892 come stai');
  expect(chiesto[1]).toContain('nota-892.txt');
  await expect(page.locator('.dash-term-cmd'), 'niente è andato alla shell').toHaveCount(0);
});
