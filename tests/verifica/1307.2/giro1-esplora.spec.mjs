// Esplorazione #1307.2: dopo l'OK a una lezione in chat, il messaggio dopo riceve risposta?
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, CONFIRM_HOST, aspettaConfermaPronta, mouseClickConfirm } from '../../helpers/confirm.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

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
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await livelloAutonomia(app, 'conservativo');
}
// Un giro per chiamata della chat; le altre chiamate rispondono NULLA DA IMPARARE.
async function fakeProvider(app, giri, { ritardo = 0 } = {}) {
  await app.evaluate(async (_electron, { g, ritardo }) => {
    globalThis.__mem_calls = [];
    globalThis.__mem_altre = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const sys = (messages.find((m) => m.role === 'system') || {}).content || '';
      if (!String(sys).includes('═══ CONTENUTO ESTERNO ═══')) {
        globalThis.__mem_altre.push(String(sys).slice(0, 80));
        return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'NULLA DA IMPARARE', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      }
      globalThis.__mem_calls.push(messages.length);
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, { g: giri, ritardo });
}
const lezioni = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer().then((b) => b.map((l) => l.text)));
const salva = (testo, text) => ({ text, toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo }) }] });

async function prepara(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  return page;
}

for (const variante of ['hook', 'mouse', 'invio', 'conTesto', 'lento', 'tastiera']) {
  test(`variante ${variante}`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    const page = await prepara(app, shell);
    const primo = variante === 'conTesto' ? salva('L’utente sviluppa Filo.', 'Me lo segno.') : salva('L’utente sviluppa Filo.');
    await fakeProvider(app, [primo, { text: 'Segnato.' }, { text: 'Seconda risposta arrivata.' }], { ritardo: variante === 'lento' ? 1500 : 0 });
    if (variante === 'tastiera') {
      await page.locator('#input').click();
      await page.keyboard.type('ricordati che sviluppo Filo');
      await page.keyboard.press('Enter');
    } else {
      await page.locator('#input').fill('ricordati che sviluppo Filo');
      await page.locator('#sendBtn').click();
    }
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    if (variante === 'mouse' || variante === 'tastiera') { await aspettaConfermaPronta(page); await mouseClickConfirm(page, 'ok'); }
    else if (variante === 'invio') { await aspettaConfermaPronta(page); await page.keyboard.press('Enter'); }
    else await clickConfirm(page, 'ok');
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Segnato.' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => lezioni(app), { timeout: 5_000 }).toEqual(['L’utente sviluppa Filo.']);
    await page.screenshot({ path: `tests/.shots/1307.2-${variante}-dopo-ok.png` });
    if (variante === 'tastiera') {
      await page.locator('#input').click();
      await page.keyboard.type('e adesso dimmi una cosa');
      await page.keyboard.press('Enter');
    } else {
      await page.locator('#input').fill('e adesso dimmi una cosa');
      await page.locator('#sendBtn').click();
    }
    const ok = await page.locator('.dash-bubble-filo', { hasText: 'Seconda risposta arrivata.' }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
    const diag = await app.evaluate(() => ({ chat: globalThis.__mem_calls, altre: globalThis.__mem_altre }));
    console.log(variante, JSON.stringify(diag));
    await page.screenshot({ path: `tests/.shots/1307.2-${variante}-fine.png` });
    expect(ok, 'la seconda risposta non è arrivata').toBe(true);
  });
}
