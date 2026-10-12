// #1188 giro 2, rilievo 1 — la scelta dell'autonomia in un'intervista lunga: il cursore fermo su un livello
// non fa sfarfallare la frase e il clic cambia il livello al primo colpo.
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
const livello = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => (s.autonomia || {}).livello || ''));


test('r1 intervista lunga: col cursore fermo su un livello la frase non sfarfalla e il clic sceglie al primo colpo', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await prepara(app, shell);
  const lungo = 'Piacere Anna! Ti dico due cose su di me. La privacy è già protetta: cookie rifiutati, pubblicità bloccate, siti pericolosi bloccati. Se vuoi cambiare qualcosa dimmelo. L’aspetto si cambia parlando: se preferisci il tema scuro, chiedimelo.';
  for (const [i, t] of ['sono Anna, insegnante', 'scrivimi breve', 'ok grazie'].entries()) {
    await queueChat(app, { text: `${lungo} (${i})`, actions: [] });
    await page.locator('#input').fill(t);
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: `(${i})` })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
  }
  await queueChat(app, { text: 'Ultima cosa: quanto vuoi che faccia da solo? Scegli qui sotto.', actions: [{ type: 'ONBOARDING', autonomia: true }] });
  await page.locator('#input').fill('dimmi');
  await page.locator('#sendBtn').click();
  const scelta = page.locator('.dash-autonomia-scelta');
  await expect(scelta).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  const bottone = scelta.locator('.dash-autonomia-livello', { hasText: 'Conservativo' });

  for (const fy of [0.2, 0.5]) {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    const b = await bottone.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * fy);
    const viste = [];
    for (let i = 0; i < 12; i++) { viste.push(await scelta.locator('.dash-autonomia-frase').textContent()); await page.waitForTimeout(80); }
    expect(new Set(viste.slice(2)).size, `cursore fermo a ${fy} dell'altezza: la frase deve restare quella del livello sotto il cursore`).toBe(1);
  }

  await queueChat(app, { text: 'Va bene.', actions: [{ type: 'ONBOARDING', spunta: ['autonomia'] }] });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const b = await bottone.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.3);
  await page.waitForTimeout(300);
  await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
  await expect.poll(() => livello(app), { timeout: 5_000 }).toBe('conservativo');
  await expect(page.locator('.dash-bubble-user').last()).toHaveText('Scelgo Conservativo.');
});
