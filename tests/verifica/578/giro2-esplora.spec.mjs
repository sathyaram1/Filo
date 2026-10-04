// Verifica #578, giro 2: esplorazione (titoli, aspetto, stop durante un'azione, stop e poi messaggio nuovo).
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
async function senzaAccoglienza(app, page) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
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
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__chiamate = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      globalThis.__chiamate += 1;
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal) {
          if (signal.aborted) { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
        }
      });
      for (const pezzo of p.pensa || []) {
        try { onReasoning && onReasoning(pezzo); } catch (_) {}
        await aspetta(p.ogni || 120);
      }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.dopoStrumenti || 200);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      if (p.pezzi) {
        for (const x of p.pezzi) { try { onDelta && onDelta(x); } catch (_) {} await aspetta(p.ogniPezzo || 300); }
        return { ...base, text: p.pezzi.join(''), toolCalls: [], finishReason: 'stop' };
      }
      const testo = p.testo || 'Fatto.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}
async function pronta(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  return page;
}
const teste = (page) => page.locator('.dash-activity-seg-head').allInnerTexts();

test('titoli misti, quattro timer, html ed emoji nel ragionamento, aspetto chiaro', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Penso <img src=x onerror="window.__xss=1"> a tre cose 🍝 ', 'e '.repeat(400)], ogni: 500, dopoStrumenti: 800, strumenti: [
      { id: 'm1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' },
      { id: 'm2', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare uova","contesto":"spesa"}' },
      { id: 'm3', name: 'SVEGLIA', arguments: '{"time":"07:00","label":"palestra"}' },
    ] },
    { pensa: ['Ora quattro timer. '], ogni: 400, dopoStrumenti: 600, strumenti: [
      { id: 't1', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Uno"}' },
      { id: 't2', name: 'TIMER', arguments: '{"secondi":61,"etichetta":"Due"}' },
      { id: 't3', name: 'TIMER', arguments: '{"secondi":62,"etichetta":"Tre"}' },
      { id: 't4', name: 'TIMER', arguments: '{"secondi":63,"etichetta":"Quattro"}' },
    ] },
    { pensa: ['Rispondo. '], ogni: 300, testo: 'Fatto tutto.' },
  ]);
  await page.locator('#input').fill('fai tante cose');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/v578g2-pensa.png' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'tests/.shots/v578g2-agisce.png' });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto tutto.' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v578g2-gomitolo.png' });
  const blocco = page.locator('.dash-activity');
  console.log('LABEL', await blocco.locator('.dash-activity-label').innerText());
  await blocco.locator('.dash-activity-head').click();
  await page.waitForTimeout(1200);
  console.log('TESTE', JSON.stringify(await teste(page)));
  console.log('XSS', await page.evaluate(() => window.__xss || 0), await blocco.locator('img').count());
  await page.screenshot({ path: 'tests/.shots/v578g2-srotolato.png' });
  const nodo = blocco.locator('.dash-activity-nodo').first();
  const nb = await nodo.boundingBox();
  if (nb) {
    await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'tests/.shots/v578g2-hover-nodo.png' });
  }
  await blocco.locator('.dash-activity-seg-head').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v578g2-sezione.png' });
});

test('stop mentre gli strumenti lavorano, poi un messaggio nuovo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Avvio un timer. '], ogni: 300, dopoStrumenti: 4000, strumenti: [{ id: 's1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' }] },
    { pensa: ['Ok. '], ogni: 300, testo: 'Risposta al messaggio nuovo.' },
  ]);
  await page.locator('#input').fill('timer pasta');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-seg-head').first()).toContainText('…', { timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/v578g2-stop-prima.png' });
  await page.locator('#stopBtn').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/v578g2-stop-agisce.png' });
  console.log('TESTE-STOP', JSON.stringify(await teste(page)), await page.locator('.dash-activity-label').innerText());
  console.log('NOTE', JSON.stringify(await page.locator('.dash-bubble-note').allInnerTexts()));
  console.log('TIMERS', (await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).length);
  await page.locator('#input').fill('altra domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta al messaggio nuovo.' })).toBeVisible({ timeout: 10_000 });
  const ultimi = await app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1]);
  const testo = ultimi.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  console.log('SA-FERMATO', testo.includes('ti ha fermato'));
  console.log('ARIA', await page.locator('#sendBtn').getAttribute('aria-label'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v578g2-dopo-stop.png' });
});

test('aspetto scuro e finestra stretta, lavoro lungo con molti nodi', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await pronta(app, shell);
  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { url: 'filo://preferences/preferences.html' },
  ));
  const passi = [];
  for (let i = 0; i < 10; i++) passi.push({ pensa: [`Passo ${i} del lavoro lungo. `], ogni: 150, dopoStrumenti: 150, strumenti: [{ id: `l${i}`, name: 'TIMER', arguments: `{"secondi":${100 + i},"etichetta":"T${i}"}` }] });
  passi.push({ pensa: ['Fine. '], ogni: 200, testo: 'Dieci timer.' });
  await copione(app, passi);
  await page.setViewportSize({ width: 420, height: 800 }).catch(() => {});
  await page.locator('#input').fill('dieci timer');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/.shots/v578g2-scuro-lavora.png' });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Dieci timer.' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v578g2-scuro-gomitolo.png' });
  await page.locator('.dash-activity-head').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/v578g2-scuro-srotolato.png', fullPage: true });
});
