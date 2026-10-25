// #892.1 giro 5 — esplorazione: dove finisce una / seguita da frasi e segni comuni.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';

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

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiesto = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...(messages || [])].reverse().find((m) => m && m.role === 'user');
      globalThis.__chiesto.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content || ''));
      const text = `Risposta ${globalThis.__chiesto.length} di Filo.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
}

const FRASI = [
  "/cos'è un terminale?", '/ciao, come stai?', '/perché?', "/c'è qualcuno?", "/dov'è finito il file?", "/l'altro giorno",
  '/ciao!', '/ok.', '/grazie :)', '/«ciao» a tutti', '/(nota) compra il latte', '/ciao; ci sei?', '/$5 bastano?',
  '/[bozza] lettera', '/!importante', '/a=b è vero?', '/1+1?', '/home/user/Documenti/foto mare.jpg', '/C:\\Users\\Mario\\doc.txt',
  '/test della nuova funzione', '/time is money', "/«cos'è»", '/"ciao" disse lui',
];

test('dove finiscono le frasi', async ({ app }) => {
  test.setTimeout(600_000);
  const page = await newtabPage(app);
  await modelloFinto(app);
  const input = page.locator('#input');
  const esiti = [];
  for (const frase of FRASI) {
    const prima = await app.evaluate(() => globalThis.__chiesto.length);
    const cmdPrima = await page.locator('.dash-term-cmd').count();
    await input.fill(frase);
    await page.waitForTimeout(600);
    const classe = await input.getAttribute('class');
    await input.press('Enter');
    let esito = '?';
    const t0 = Date.now();
    while (Date.now() - t0 < 12_000) {
      if (await page.locator(CONFIRM_HOST).count()) {
        const st = await confirmState(page);
        esito = `CONFERMA(${st.hasInput ? 'parola' : 'ok'})`;
        await clickConfirm(page, 'cancel');
        await input.fill('');
        break;
      }
      if ((await page.locator('.dash-term-cmd').count()) > cmdPrima) { esito = 'SHELL'; break; }
      if ((await app.evaluate(() => globalThis.__chiesto.length)) > prima) { esito = 'FILO'; break; }
      await page.waitForTimeout(150);
    }
    esiti.push(`${esito.padEnd(16)} ${(classe || '').replace(/\s+/g, ' ')}  ${frase}`);
    await page.waitForTimeout(800);
    const stop = page.locator('.dash-term-stop');
    if (await stop.count()) await stop.last().click().catch(() => {});
  }
  console.log(`\nESITI\n${esiti.join('\n')}`);
});

test('echo con un apostrofo e un comando dopo', async ({ app }) => {
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await input.fill("/echo l'altro giorno");
  await input.press('Enter');
  await page.waitForTimeout(4000);
  const conf = await page.locator(CONFIRM_HOST).count();
  console.log('conferma?', conf);
  if (conf) await clickConfirm(page, 'ok');
  await page.waitForTimeout(4000);
  console.log('controlli aperti dopo 4s:', await page.locator('.dash-term-controls').count());
  console.log('uscita 1:', await page.locator('.dash-term').last().innerText());
  await input.fill('/echo ok-dopo');
  await input.press('Enter');
  await page.waitForTimeout(5000);
  console.log('controlli aperti:', await page.locator('.dash-term-controls').count());
  console.log('uscita 2:', await page.locator('.dash-term').last().innerText());
  await page.screenshot({ path: 'tests/.shots/892-1-g5-echo.png' }).catch(() => {});
});
