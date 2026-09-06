// Verifica indipendente (giro 5) — parte D: pagina web e stress.
import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
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

async function scriptProvider(app, script) {
  await app.evaluate(async (electron, s) => {
    globalThis.__rounds = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onToolCall, onDelta }) => {
      globalThis.__rounds.push(JSON.parse(JSON.stringify(messages)));
      const step = s[Math.min(i, s.length - 1)];
      i += 1;
      const calls = (step.toolCalls || []).map((c) => ({ ...c }));
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      for (const c of calls) { try { onToolCall && onToolCall(c); } catch (_) {} }
      return { text: step.text || '', toolCalls: calls, reasoningDetails: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, script);
}

const ask = async (page, msg) => { await page.locator('#input').fill(msg); await page.locator('#sendBtn').click(); };
const rows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.dash-activity-row')).map((e) => e.textContent.trim()));

// ── 1. Stile della pagina applicato davvero, poi ripristinato; proxy tolto ──
test('stile della pagina applicato e ripristinato, proxy tolto: righe, esiti e effetto vero', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const web = await testServer.openReady(openTab, '<h1 id="t">Titolo</h1><p>testo</p>');
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);

  await scriptProvider(app, [
    { text: '', toolCalls: [{ id: 's1', name: 'STILE_PAGINA', arguments: JSON.stringify({ regole: [{ selettore: 'h1', css: 'color: rgb(255, 0, 0)' }], descrizione: 'titoli rossi' }) }] },
    { text: 'Titoli in rosso.' },
  ]);
  await ask(page, 'metti i titoli in rosso');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Titoli in rosso', { timeout: 25_000 });
  let r = (await rows(page)).join(' | ');
  expect(r, r).toMatch(/Aspetto della pagina · titoli rossi/);
  await expect.poll(async () => web.evaluate(() => getComputedStyle(document.getElementById('t')).color), { timeout: 8_000 }).toBe('rgb(255, 0, 0)');

  // Ripristino + togli proxy, con una scheda web aperta.
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { id: 's2', name: 'RIPRISTINA_STILE_PAGINA', arguments: '{}' },
      { id: 's3', name: 'RIMUOVI_PROXY', arguments: '{}' },
    ] },
    { text: 'Rimesso com’era.' },
  ]);
  await ask(page, 'rimetti com’era e togli il proxy');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Rimesso', { timeout: 25_000 });
  r = (await rows(page)).join(' | ');
  expect(r, r).toMatch(/Aspetto della pagina ripristinato/);
  expect(r, r).toMatch(/Scheda riportata in Italia|Italia/);
  await expect.poll(async () => web.evaluate(() => getComputedStyle(document.getElementById('t')).color), { timeout: 8_000 }).not.toBe('rgb(255, 0, 0)');

  const second = await app.evaluate(() => globalThis.__rounds[1]);
  const tools = second.filter((m) => m.role === 'tool').map((m) => m.content).join(' | ');
  expect(tools, tools).not.toMatch(/NON eseguita/i);
});

// ── 2. Stress: strumento sconosciuto, argomenti non JSON, non oggetto, HTML ──
test('stress: strumento sconosciuto, argomenti rotti e HTML nella query non rompono il turno', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: '', toolCalls: [
      { id: 'e1', name: 'STRUMENTO_INVENTATO', arguments: '{"a":1}' },
      { id: 'e2', name: 'TIMER', arguments: 'questo non è json' },
      { id: 'e3', name: 'TIMER', arguments: '[1,2,3]' },
      { id: 'e4', name: 'CERCA_WEB', arguments: JSON.stringify({ query: '<img src=x onerror="window.__pwn=1">' }) },
    ] },
    { text: 'Ho avuto qualche problema ma sono qui.' },
  ]);
  await ask(page, 'fai cose strane');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('sono qui', { timeout: 30_000 });
  // Niente script eseguito: l'HTML resta testo.
  const pwn = await page.evaluate(() => window.__pwn || null);
  expect(pwn).toBe(null);
  // Nessun elemento vero: l'HTML è rimasto testo.
  const injected = await page.evaluate(() => document.querySelectorAll('img[onerror], [onerror]').length);
  expect(injected).toBe(0);
  const shown = (await rows(page)).join(' | ');
  expect(shown, shown).toContain('<img src=x');
  // Gli esiti d'errore sono tornati al modello.
  const second = await app.evaluate(() => globalThis.__rounds[1]);
  const tool = second.filter((m) => m.role === 'tool').map((m) => m.content).join(' || ');
  expect(tool.length, tool).toBeGreaterThan(0);
});

// ── 3. Stress: messaggio da 10.000 caratteri e doppio invio ──
test('stress: 10.000 caratteri e doppio invio rapido restano un turno solo', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [{ text: 'Ricevuto tutto.' }]);
  const big = 'a'.repeat(10_000);
  await page.locator('#input').fill(big);
  await page.locator('#sendBtn').click();
  await page.locator('#sendBtn').click({ force: true }).catch(() => {});
  await page.locator('#sendBtn').click({ force: true }).catch(() => {});
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ricevuto tutto', { timeout: 30_000 });
  const n = await app.evaluate(() => globalThis.__rounds.length);
  expect(n, `giri: ${n}`).toBe(1);
  const bubbles = await page.evaluate(() => document.querySelectorAll('.dash-bubble-filo').length);
  expect(bubbles).toBe(1);
});

// ── 4. Formato vecchio (JSON nel testo) ancora tollerato ──
test('formato vecchio col JSON nel testo: l’azione passa dal registro, niente JSON in chat', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await configureModel(app);
  await scriptProvider(app, [
    { text: JSON.stringify({ text: 'Timer messo.', actions: [{ type: 'TIMER', secondi: 300, etichetta: 'pasta' }] }) },
  ]);
  await ask(page, 'timer pasta 5 minuti');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Timer messo', { timeout: 25_000 });
  const bubbles = await page.evaluate(() => Array.from(document.querySelectorAll('.dash-bubble-filo')).map((e) => e.textContent).join(' '));
  expect(bubbles).not.toContain('"actions"');
  const timers = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listTimers());
  expect(timers.some((t) => /pasta/.test(t.label || ''))).toBe(true);
});
