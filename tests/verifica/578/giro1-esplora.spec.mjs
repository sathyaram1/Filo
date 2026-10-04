// Verifica #578, giro 1: prove avversariali sul filo dell'attesa (fermare, riprendere, più giri, input strani).
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
// Come il copione dello spec della feature, più `pezzi`: la risposta che arriva a pezzi, `ogniPezzo` ms l'uno.
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
      if (p.attesa) await aspetta(p.attesa);
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
async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origStream) globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream;
  });
}
async function pronta(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  return page;
}

test('due giri di strumenti: due nodi, uno aperto alla volta, titolo misto, coda nascosta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Metto il timer e controllo. '], ogni: 300, dopoStrumenti: 500,
      strumenti: [
        { id: 'm1', name: 'TIMER', arguments: '{"secondi":90,"etichetta":"Riso"}' },
        { id: 'm2', name: 'CAPACITA_DETTAGLIO', arguments: '{"ids":["save-for-later"]}' },
      ] },
    { pensa: ['Ora un secondo timer. '], ogni: 300, strumenti: [{ id: 'm3', name: 'TIMER', arguments: '{"secondi":30,"etichetta":"Sale"}' }] },
    { pensa: ['Rispondo adesso, coda finale. '], ogni: 300, testo: 'Fatto tutto.' },
  ]);
  await page.locator('#input').fill('due cose');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto tutto.' })).toBeVisible({ timeout: 15_000 });
  const blocco = page.locator('.dash-activity');
  await expect(blocco).toHaveAttribute('data-filo', 'gomitolo');
  await expect(blocco.locator('.dash-activity-nodo')).toHaveCount(2);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v578-due-giri-gomitolo.png' });
  await blocco.locator('.dash-activity-head').click();
  const teste = blocco.locator('.dash-activity-seg-head');
  await expect(teste.nth(0)).toHaveText(/^2 azioni · timer, capacità$/);
  await expect(teste.nth(1)).toHaveText('Avviato un timer · Sale');
  await teste.nth(0).click();
  await expect(blocco.locator('.dash-activity-seg').nth(0).locator('.dash-activity-seg-body')).toBeVisible();
  await teste.nth(1).click();
  await expect(blocco.locator('.dash-activity-seg').nth(0).locator('.dash-activity-seg-body')).toBeHidden();
  await expect(blocco.locator('.dash-activity-seg').nth(1).locator('.dash-activity-seg-body')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v578-due-giri-srotolato.png' });
  await ripristina(app);
});

test('fermato mentre il modello nomina un timer: niente timer, il nodo dice fermato, riprendere lo fa una volta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Metto il timer. '], ogni: 200, strumenti: [{ id: 's1', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Uno"}' }], dopoStrumenti: 4000 },
    { pensa: ['Riprendo e lo metto. '], ogni: 200, strumenti: [{ id: 's2', name: 'TIMER', arguments: '{"secondi":60,"etichetta":"Uno"}' }] },
    { pensa: ['Fatto. '], ogni: 200, testo: 'Timer messo.' },
  ]);
  await page.locator('#input').fill('timer');
  await page.locator('#sendBtn').click();
  const blocco = page.locator('.dash-activity').first();
  await expect(blocco.locator('.dash-activity-seg-head').first()).toHaveText('Avvio un timer…', { timeout: 5_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toBeVisible({ timeout: 5_000 });
  await expect(blocco.locator('.dash-activity-seg-head').first()).toHaveText('Fermato qui');
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).length).toBe(0);
  await page.screenshot({ path: 'tests/.shots/v578-fermato-su-strumento.png' });
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Timer messo.' })).toBeVisible({ timeout: 10_000 });
  expect((await app.evaluate(() => globalThis.SN_FILO_MEMORY.listTimers())).length).toBe(1);
  await ripristina(app);
});

test('fermato prima di qualsiasi ragionamento', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await copione(app, [{ attesa: 5000, testo: 'Mai.' }]);
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  await expect(page.locator('#stopBtn')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/v578-attesa-senza-ragionamento.png' });
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v578-fermato-subito.png' });
  await ripristina(app);
});

test('fermato a metà della risposta: il pezzo scritto resta e lo dice', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await copione(app, [{ pensa: ['Scrivo. '], ogni: 200, pezzi: ['Primo pezzo. ', 'Secondo pezzo. ', 'Terzo. ', 'Quarto. ', 'Quinto. ', 'Sesto. '], ogniPezzo: 700 }]);
  await page.locator('#input').fill('scrivi');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Primo pezzo.' })).toBeVisible({ timeout: 5_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato a metà della risposta.', { timeout: 5_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Primo pezzo.' })).toBeVisible();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sesto.' })).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v578-fermato-risposta.png' });
  await ripristina(app);
});

test('il ragionamento con markup e parole lunghissime resta testo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  const lunga = 'x'.repeat(400);
  await copione(app, [{ pensa: ['<img src=x onerror="window.__rotto=1"> ', `${lunga} `, '😀🧶 fine. ', 'Ancora. '], ogni: 600, testo: 'Ok.' }]);
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  const trama = page.locator('.dash-activity-trama');
  await expect(trama).toContainText('😀', { timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/v578-trama-strana.png' });
  const larga = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(larga).toBe(false);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__rotto)).toBeUndefined();
  expect(await page.locator('.dash-activity img').count()).toBe(0);
  await ripristina(app);
});

test('doppio clic sul quadrato: ferma e basta, non riprende', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Ripreso. '], ogni: 200, testo: 'Ripreso senza volerlo.' },
  ]);
  await page.locator('#input').fill('pensa');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-trama')).toContainText('lungo', { timeout: 5_000 });
  await page.locator('#stopBtn').dblclick();
  await page.waitForTimeout(2500);
  expect(await app.evaluate(() => globalThis.__chiamate)).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso senza volerlo.' })).toHaveCount(0);
  await ripristina(app);
});

test('Invio premuto due volte di fila: ferma e basta, non riprende', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const page = await pronta(app, shell);
  await copione(app, [
    { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai.' },
    { pensa: ['Ripreso. '], ogni: 200, testo: 'Ripreso senza volerlo.' },
  ]);
  await page.locator('#input').fill('pensa');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama')).toContainText('lungo', { timeout: 5_000 });
  await page.locator('#input').press('Enter');
  await page.waitForTimeout(250);
  await page.locator('#input').press('Enter');
  await page.waitForTimeout(2500);
  expect(await app.evaluate(() => globalThis.__chiamate)).toBe(1);
  await ripristina(app);
});
