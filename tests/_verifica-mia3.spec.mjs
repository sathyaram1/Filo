// Spec TEMPORANEO: controllo rapido dopo il rebase (#521). Da cancellare.
import { test, expect } from './fixtures/electron.mjs';
const NEWTAB = 'filo://newtab/';

async function stubProvider(app, turns) {
  await app.evaluate(async (_e, { turns }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' }, modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__vTurn = 0; globalThis.__vTurns = turns;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onReasoning, onDelta }) => {
      const n = globalThis.__vTurn++;
      const t = globalThis.__vTurns[Math.min(n, globalThis.__vTurns.length - 1)];
      for (const c of (t.reasoning || [])) { onReasoning && onReasoning(c); await sleep(80); }
      if (t.throwAfterReasoning) throw new Error(t.throwAfterReasoning);
      const text = JSON.stringify(t.text);
      for (let i = 0; i < text.length; i += 12) { onDelta && onDelta(text.slice(i, i + 12)); await sleep(10); }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    if (globalThis.SN_WEB_SEARCH) globalThis.SN_WEB_SEARCH.search = async () => ({ ok: true, provider: 'stub', results: [{ title: 'R', url: 'https://example.com/1', snippet: 's' }] });
  }, { turns });
}
const J = (text, actions = []) => ({ text, actions });
const sendMsg = async (page, t) => { await page.locator('#input').fill(t); await page.locator('#sendBtn').click(); };
test.describe.configure({ timeout: 120_000 });

test('dopo il rebase: blocco, due turni, impostazione, errore + Riprova', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [
    { reasoning: ['Serve un timer. ', 'Cambio anche il tema. '], text: J('Metto timer e tema, poi cerco.', [
      { type: 'TIMER', seconds: 300, label: 'Pasta' },
      { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' },
      { type: 'CERCA_WEB', query: 'ricetta' },
    ]) },
    { reasoning: ['Rispondo.'], text: J('FINALE: ecco tutto.') },
  ]);
  await sendMsg(page, 'timer pasta, tema scuro e cerca una ricetta');
  const label = page.locator('.dash-activity-label');
  await expect(label).toContainText('Sta ragionando', { timeout: 10000 });
  await expect(page.locator('.dash-activity-body')).toBeHidden();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINALE' })).toBeVisible({ timeout: 20000 });
  await expect(label).toHaveText(/^Ha avviato un timer, cambiato un'impostazione e cercato sul web · \d+ s$/, { timeout: 10000 });
  await expect(page.locator('.dash-activity')).toHaveCount(1);
  await expect(page.locator('#bubbles .dash-bubble-user ~ .dash-bubble-filo')).toHaveCount(1);
  await page.locator('.dash-activity-head').click();
  const body = await page.locator('.dash-activity-body').innerText();
  console.log('CRONOLOGIA:\n' + body);
  for (const s of ['Serve un timer', 'Metto timer e tema', 'Timer avviato', 'Impostato · tema = scuro', 'Cerco sul web', 'Rispondo.']) expect(body).toContain(s);
  expect(await page.evaluate(() => document.documentElement.dataset.snTheme)).toBe('dark');
  // errore + Riprova
  await stubProvider(app, [{ reasoning: ['Provo… '], throwAfterReasoning: 'fetch failed' }]);
  await sendMsg(page, 'domanda che fallisce');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.dash-activity-label').last()).toContainText('Tentativo non riuscito');
  await stubProvider(app, [{ reasoning: ['Ok.'], text: J('Risposta dopo il riprova.') }]);
  await page.locator('.dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta dopo il riprova' })).toBeVisible({ timeout: 15000 });
  const labels = await page.locator('.dash-activity-label').allTextContents();
  console.log('LABELS:', labels);
  expect(labels.length).toBe(3);
  expect(labels[1]).toContain('Tentativo non riuscito');
  expect(labels[2]).toMatch(/^Ragionamento · \d+ s$/);
  await page.screenshot({ path: 'tests/agent/.out/verif3-rebase.png' });
});
