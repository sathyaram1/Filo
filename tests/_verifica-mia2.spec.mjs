// Spec TEMPORANEO della riverifica (#521, rilievi 1 e 2). Da cancellare.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
const NEWTAB = 'filo://newtab/';
const OUT = 'tests/agent/.out';
mkdirSync(OUT, { recursive: true });

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
      for (const c of (t.reasoning || [])) { onReasoning && onReasoning(c); await sleep(t.gapMs || 60); }
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
const FAILED_RE = /non (è )?riuscit|fallit|errore|non ha funzionato|interrott/i;
test.describe.configure({ timeout: 120_000 });

test('R1. errore a metà: il blocco dichiara il tentativo fallito e dopo Riprova si distingue', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [{ reasoning: ['Sto per rispondere ma... '], throwAfterReasoning: 'fetch failed' }]);
  await sendMsg(page, 'domanda che fallisce');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 15000 });
  const labelsErr = await page.locator('.dash-activity-label').allTextContents();
  console.log('R1 label dopo errore:', labelsErr);
  await page.screenshot({ path: OUT + '/verif2-r1-errore.png' });
  expect(labelsErr.join(' | ')).toMatch(FAILED_RE);
  await page.locator('.dash-activity-head').first().click();
  await expect(page.locator('.dash-activity-body').first()).toContainText('Sto per rispondere');
  await page.screenshot({ path: OUT + '/verif2-r1-errore-aperto.png' });
  await page.locator('.dash-activity-head').first().click();
  await stubProvider(app, [{ reasoning: ['Ok ora va.'], text: J('Risposta dopo il riprova.') }]);
  await page.locator('.dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta dopo il riprova' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.dash-activity-label').last()).toHaveText(/·\s\d+ s$/, { timeout: 10000 });
  const labels = await page.locator('.dash-activity-label').allTextContents();
  console.log('R1 labels dopo riprova:', labels);
  await page.screenshot({ path: OUT + '/verif2-r1-riprova.png' });
  expect(labels.length).toBe(2);
  expect(labels[0]).not.toBe(labels[1]);
  expect(labels[0]).toMatch(FAILED_RE);
  expect(labels[1]).not.toMatch(FAILED_RE);
  // Errore SENZA ragionamento: cosa resta?
  await stubProvider(app, [{ throwAfterReasoning: 'fetch failed' }]);
  await sendMsg(page, 'fallisce subito');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 15000 });
  console.log('R1b labels (errore senza ragionamento):', await page.locator('.dash-activity-label').allTextContents());
  await page.screenshot({ path: OUT + '/verif2-r1b-errore-secco.png' });
  await page.locator('.dash-action-btn', { hasText: 'Riprova' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' })).toBeVisible({ timeout: 15000 });
  console.log('R1c labels (due fallimenti):', await page.locator('.dash-activity-label').allTextContents());
  // Errore al SECONDO turno di un lavoro in due passi (ricerca ok, poi crash)
  await stubProvider(app, [
    { reasoning: ['Cerco.'], text: J('', [{ type: 'CERCA_WEB', query: 'q' }]) },
    { reasoning: ['Rispondo... '], throwAfterReasoning: 'fetch failed' },
  ]);
  await sendMsg(page, 'cerca poi crolla');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riprova' }).last()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(500);
  const l3 = await page.locator('.dash-activity-label').allTextContents();
  console.log('R1d labels (crash al 2o turno):', l3);
  await page.locator('.dash-activity-head').last().click();
  console.log('R1d cronologia:\n' + await page.locator('.dash-activity-body').last().innerText());
  await page.screenshot({ path: OUT + '/verif2-r1d-crash-2o-turno.png' });
  expect(l3[l3.length - 1]).toMatch(FAILED_RE);
});

test('R2. impostazione applicata subito: riga nella cronologia e nel riassunto', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubProvider(app, [{ reasoning: ['Cambio il tema.'], text: J('Fatto, ora il tema e scuro.', [{ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }]) }]);
  await sendMsg(page, 'metti il tema scuro');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'tema e scuro' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.dash-activity-label').last()).toHaveText(/^Ha .* · \d+ s$/, { timeout: 10000 });
  const l1 = await page.locator('.dash-activity-label').last().textContent();
  console.log('R2a riassunto:', l1);
  await page.locator('.dash-activity-head').last().click();
  const b1 = await page.locator('.dash-activity-body').last().innerText();
  console.log('R2a cronologia:\n' + b1);
  expect(b1.toLowerCase()).toMatch(/tema/);
  expect(b1.toLowerCase()).toMatch(/scur/);
  await page.screenshot({ path: OUT + '/verif2-r2a-tema.png' });
  const theme = await page.evaluate(() => document.documentElement.dataset.snTheme);
  console.log('R2a tema applicato:', theme);
  expect(theme).toBe('dark');
  await stubProvider(app, [
    { text: J('Metto il tema chiaro e cerco.', [{ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'chiaro' }, { type: 'CERCA_WEB', query: 'x' }]) },
    { text: J('FINALE tema.') },
  ]);
  await sendMsg(page, 'tema chiaro e cerca x');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINALE tema' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.dash-activity-label').last()).toHaveText(/^Ha .* · \d+ s$/, { timeout: 10000 });
  const l2 = await page.locator('.dash-activity-label').last().textContent();
  console.log('R2b riassunto:', l2);
  expect(l2.toLowerCase()).toMatch(/cercato sul web/);
  expect(l2.toLowerCase()).toMatch(/impostaz|tema|cambiat|modificat|regolat|preferenz/);
  await page.locator('.dash-activity-head').last().click();
  const b2 = await page.locator('.dash-activity-body').last().innerText();
  console.log('R2b cronologia:\n' + b2);
  expect(b2.toLowerCase()).toMatch(/tema/);
  expect(b2).toContain('Metto il tema chiaro e cerco.');
  expect(b2).toContain('Cerco sul web');
  await page.screenshot({ path: OUT + '/verif2-r2b-tema-ricerca.png' });
  await expect(page.locator('#bubbles .dash-bubble-user ~ .dash-bubble-filo', { hasText: 'Metto il tema chiaro' })).toHaveCount(0);
  await stubProvider(app, [{ text: J('Testo grande e tema scuro.', [{ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }, { type: 'IMPOSTA_PREFERENZA', chiave: 'dimensione_testo', valore: 'grande' }]) }]);
  await sendMsg(page, 'testo grande e tema scuro');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Testo grande' })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  console.log('R2c riassunto:', await page.locator('.dash-activity-label').last().textContent());
  await page.locator('.dash-activity-head').last().click();
  console.log('R2c cronologia:\n' + await page.locator('.dash-activity-body').last().innerText());
  await page.screenshot({ path: OUT + '/verif2-r2c-due.png' });
  await stubProvider(app, [{ text: J('Provo.', [{ type: 'IMPOSTA_PREFERENZA', chiave: 'inesistente', valore: 'x' }]) }]);
  await sendMsg(page, 'imposta una cosa che non esiste');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Provo.' })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  console.log('R2d labels:', await page.locator('.dash-activity-label').allTextContents());
  // livello 2 (conferma): resta bottone, non riga
  await stubProvider(app, [{ text: J('Attivo il terminale.', [{ type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: true }]) }]);
  await sendMsg(page, 'attiva terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Attivo il terminale' })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  console.log('R2e labels:', await page.locator('.dash-activity-label').allTextContents(), 'btn:', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
});
