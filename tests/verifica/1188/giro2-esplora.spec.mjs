// #1188 giro 2 — esplorazione: la scelta dell'autonomia nell'intervista, coi clic in momenti scomodi.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function prepara(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    globalThis.__chatCalls = [];
    const reply = async (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBreve.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      const next = globalThis.__chatReplies.shift();
      globalThis.__chatCalls.push({ t: Date.now(), next: !!next });
      if (globalThis.__ritardo) await new Promise((r) => setTimeout(r, globalThis.__ritardo));
      return next || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = await reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      const text = await reply(messages);
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.tick(await M.getOnboarding(), O.ITEM_IDS.filter((id) => id !== 'autonomia')).state);
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return page;
}

const queueChat = (app, ...replies) => app.evaluate((_e, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));
const onb = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
const livello = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => (s.autonomia || {}).livello || ''));

test('esplora: clic sul livello appena compare la scelta', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await prepara(app, shell);
  await queueChat(app, {
    text: 'Ultima cosa: quanto vuoi che faccia da solo? Scegli qui sotto.',
    actions: [{ type: 'ONBOARDING', autonomia: true }],
  });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').click();
  const scelta = page.locator('.dash-bubble-filo .dash-autonomia-scelta');
  await expect(scelta).toBeVisible({ timeout: 30_000 });
  await queueChat(app, { text: 'Va bene così.', actions: [{ type: 'ONBOARDING', spunta: ['autonomia'] }] });
  await scelta.locator('.dash-autonomia-livello', { hasText: 'Conservativo' }).click();
  await page.waitForTimeout(8000);
  const info = {
    livello: await livello(app),
    utente: await page.locator('.dash-bubble-user').allTextContents(),
    stato: await page.locator('body').getAttribute('data-state'),
    onb: await onb(app),
    chiamate: await app.evaluate(() => globalThis.__chatCalls),
  };
  console.log('ESPLORA1', JSON.stringify(info, null, 1));
});

test('esplora: Filo mostra la scelta due volte; clic su quella vecchia e su quella nuova', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await prepara(app, shell);
  await queueChat(app, { text: 'Quanto vuoi che faccia da solo?', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-autonomia-scelta')).toHaveCount(1, { timeout: 30_000 });
  await queueChat(app, { text: 'Allora direi Conservativo: sceglilo qui sotto.', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await page.locator('#input').fill('chiedimi sempre prima');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-autonomia-scelta')).toHaveCount(2, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.locator('.dash-autonomia-scelta').first().locator('.dash-autonomia-livello', { hasText: 'Conservativo' }).click();
  await page.waitForTimeout(2000);
  const dopoVecchia = { livello: await livello(app), utente: await page.locator('.dash-bubble-user').allTextContents(),
    scelti: await page.locator('.dash-autonomia-livello.scelto').allTextContents() };
  const btn = page.locator('.dash-autonomia-scelta').last().locator('.dash-autonomia-livello', { hasText: 'Conservativo' });
  const campiona = async () => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const b = await btn.boundingBox();
      const frasi = await page.locator('.dash-autonomia-frase').allTextContents();
      const sc = await page.evaluate(() => { const e = document.getElementById('bubbles') || document.querySelector('.dash-bubbles'); return e ? [e.scrollTop, e.scrollHeight] : null; });
      out.push([b && Math.round(b.y), frasi.map((f) => f.slice(0, 20)), sc]);
      await page.waitForTimeout(150);
    }
    return out;
  };
  console.log('CAMPIONI-MOUSE-SOPRA', JSON.stringify(await campiona()));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  console.log('CAMPIONI-MOUSE-VIA', JSON.stringify(await campiona()));
  await queueChat(app, { text: 'Fatto.', actions: [{ type: 'ONBOARDING', spunta: ['autonomia'] }] });
  await page.locator('.dash-autonomia-scelta').last().locator('.dash-autonomia-livello', { hasText: 'Conservativo' }).click();
  await page.waitForTimeout(6000);
  const info = { dopoVecchia, utente: await page.locator('.dash-bubble-user').allTextContents(),
    stato: await page.locator('body').getAttribute('data-state'), onb: await onb(app) };
  console.log('ESPLORA2', JSON.stringify(info, null, 1));
});

test('esplora: dopo la scelta Filo la rimostra e chiude nello stesso turno', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await prepara(app, shell);
  await queueChat(app, { text: 'Quanto vuoi che faccia da solo?', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').click();
  const scelta = page.locator('.dash-autonomia-scelta');
  await expect(scelta).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await queueChat(app, { text: 'Perfetto, Normale. Buon lavoro!', actions: [{ type: 'ONBOARDING', autonomia: true, spunta: ['autonomia'], fine: true }] });
  await scelta.locator('.dash-autonomia-livello', { hasText: 'Normale' }).click();
  await page.waitForTimeout(8000);
  const info = { utente: await page.locator('.dash-bubble-user').allTextContents(),
    stato: await page.locator('body').getAttribute('data-state'), onb: await onb(app),
    scelte: await page.locator('.dash-autonomia-scelta').count() };
  console.log('ESPLORA3', JSON.stringify(info, null, 1));
});
