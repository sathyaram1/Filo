// Verifica #870 giro 4: esplorazione (si cancella prima della critica).
import { test, expect } from '../../fixtures/electron.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');

async function home(app, escludi = null) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x !== escludi && x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}
const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);
const ordineDestra = (page) => page.locator('#tieni > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));

test('incognito eredita la disposizione di destra?', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  await normale.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await normale.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(normale.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  console.log('normale destra', await ordineDestra(normale));
  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await home(app, normale);
  await inc.waitForTimeout(1500);
  console.log('incognito destra', await ordineDestra(inc));
  await inc.screenshot({ path: join(SHOTS, 'v870g4-incognito.png') });
});

test('avviso con HTML e testo lunghissimo, molti timer', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addNotification({ kind: 'alert', text: '<b>grassetto</b><img src=x onerror="document.title=\'pwned\'"> ' + 'parola '.repeat(600) });
    await M.addNotification({ kind: 'info', text: '🎉🎉 emoji 👩‍👩‍👧 fine' });
    for (let i = 0; i < 9; i++) await M.addTimer({ label: `Timer numero ${i} con un nome molto molto lungo che non finisce mai davvero mai`, seconds: 60 + i * 30 });
  });
  await page.waitForTimeout(1500);
  console.log('title', await page.title());
  console.log('img in accade', await page.locator('#accade img').count());
  const box = await page.locator('#accade .dash-carta[data-tipo="avviso"]').first().boundingBox();
  console.log('avviso box', JSON.stringify(box));
  const acc = await page.locator('#accade').evaluate((n) => ({ sh: n.scrollHeight, ch: n.clientHeight, ov: getComputedStyle(n).overflowY, sw: n.scrollWidth, cw: n.clientWidth }));
  console.log('accade', JSON.stringify(acc));
  const docw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  console.log('doc', JSON.stringify(docw));
  await page.screenshot({ path: join(SHOTS, 'v870g4-stress.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await manda(page, { type: (await page.evaluate(() => window.SN_MSG.MSG)).UPDATE_SETTINGS, settings: { theme: 'dark' } });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, 'v870g4-stress-scuro.png') });
});

test('rimetti a parole, carta dei suggerimenti tolta e rimessa', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    globalThis.__giro = 0;
    const risp = [
      { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"filo ti suggerisce"}' }] },
      { testo: 'Tolta.' },
      { strumenti: [{ id: 'c2', name: 'CARTA_HOME', arguments: '{"operazione":"rimetti","carta":"suggerimenti"}' }] },
      { testo: 'Rimessa.' },
      { strumenti: [{ id: 'c3', name: 'CARTA_HOME', arguments: '{"operazione":"sposta","carta":"rapide","verso":"cima"}' }] },
      { testo: 'Spostata.' },
    ];
    globalThis.__esiti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, messages }) => {
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      try { globalThis.__esiti.push(JSON.stringify(messages.slice(-1))); } catch (_) {}
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  });
  await page.reload();
  await home(app);
  await page.locator('#input').fill('togli i suggerimenti');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Tolta' })).toBeVisible({ timeout: 10_000 });
  console.log('dopo togli', await ordineDestra(page));
  await page.locator('#input').fill('rimetti i suggerimenti');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rimessa' })).toBeVisible({ timeout: 10_000 });
  console.log('dopo rimetti', await ordineDestra(page));
  await page.locator('#input').fill('metti le impostazioni rapide in cima');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Spostata' })).toBeVisible({ timeout: 10_000 });
  console.log('dopo sposta', await ordineDestra(page));
  const es = await app.evaluate(() => globalThis.__esiti);
  console.log('esiti', es.map((x) => x.slice(0, 400)).join('\n---\n'));
  await page.screenshot({ path: join(SHOTS, 'v870g4-chat.png') });
});
