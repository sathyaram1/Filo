// Verifica #578, giro 7: esplorazione.
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
// passi: { pensa, ogni, strumenti, dopoStrumenti, testo, pezziTesto, ogniTesto }
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__timer = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
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
        if (p.ogni) await aspetta(p.ogni);
      }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.dopoStrumenti || 200);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      if (p.pezziTesto) {
        let tutto = '';
        for (const x of p.pezziTesto) { tutto += x; try { onDelta && onDelta(x); } catch (_) {} await aspetta(p.ogniTesto || 300); }
        return { ...base, text: tutto, toolCalls: [], finishReason: 'stop' };
      }
      const testo = p.testo || 'Fatto.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { ...base, text: testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}
const testoDi = (msgs) => msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

test('E1 — ferma, riprendi, ferma ancora, riprendi: un timer solo, risposta finale, niente righe di fermo rimaste', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['Avvio il timer. '], ogni: 200, strumenti: [{ id: 'e1', name: 'TIMER', arguments: '{"secondi":120,"etichetta":"Tè"}' }] },
    { pensa: ['Penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai 1.' },
    { pensa: ['Riprendo e penso. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Mai 2.' },
    { pensa: ['Ok, finisco. '], ogni: 200, testo: 'Il timer del tè è partito.' },
  ]);
  await page.locator('#input').fill('timer tè');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-trama').last()).toContainText('lungo', { timeout: 8_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-trama').last()).toContainText('Riprendo', { timeout: 8_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
  await page.screenshot({ path: 'tests/.shots/g7-e1-doppio-fermo.png' });
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Il timer del tè è partito.' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/g7-e1-fine.png' });
  const timers = await app.evaluate(async () => {
    const T = globalThis.SN_TIMERS || globalThis.SN_FILO_TIMERS;
    try { const l = T && (await (T.list ? T.list() : [])); return Array.isArray(l) ? l.length : -1; } catch (_) { return -2; }
  });
  console.log('TIMERS', timers, 'chiamate', await app.evaluate(() => globalThis.__messaggi.length));
  console.log('NOTE FERMO', await page.locator('.dash-bubble-fermato').count());
  console.log('ULTIMI', testoDi(await app.evaluate(() => globalThis.__messaggi[globalThis.__messaggi.length - 1])).slice(-1500));
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Invia');
});

test('E2 — fermato a metà della risposta, poi riprendi', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['Scrivo. '], ogni: 200, pezziTesto: ['Prima riga del poema, ', 'seconda riga, ', 'terza riga, ', 'quarta, ', 'quinta, ', 'sesta.'], ogniTesto: 800 },
    { pensa: ['Continuo da dove ero. '], ogni: 200, testo: 'Settima riga, fine.' },
  ]);
  await page.locator('#input').fill('scrivimi un poema');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'seconda riga' })).toBeVisible({ timeout: 8_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/g7-e2-meta-risposta.png' });
  console.log('NOTA', await page.locator('.dash-bubble-fermato').allTextContents());
  console.log('BOLLE', await page.locator('.dash-bubble-filo').allTextContents());
  console.log('BLOCCO', await page.locator('.dash-activity').first().getAttribute('data-filo'), await page.locator('.dash-activity-label').first().textContent());
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Settima riga' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/g7-e2-ripreso.png' });
  console.log('ULTIMI', testoDi(await app.evaluate(() => globalThis.__messaggi[1])).slice(-800));
});

test('E3 — ragionamento lungo a pezzetti: la pagina resta reattiva', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  const pezzi = [];
  for (let i = 0; i < 6000; i++) pezzi.push(i % 40 === 39 ? 'fine. ' : 'paro ');
  await copione(app, [{ pensa: pezzi, ogni: 4, testo: 'Fatto dopo tanto pensare.' }]);
  await page.evaluate(() => {
    window.__lag = 0; let last = performance.now();
    window.__lagH = setInterval(() => { const now = performance.now(); window.__lag = Math.max(window.__lag, now - last - 50); last = now; }, 50);
  });
  const t0 = Date.now();
  await page.locator('#input').fill('pensa tanto');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto dopo tanto' })).toBeVisible({ timeout: 100_000 });
  console.log('DURATA', Date.now() - t0, 'LAG MAX', await page.evaluate(() => window.__lag));
  await page.waitForTimeout(1500);
  await page.locator('.dash-activity-head').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/g7-e3-lungo.png' });
});

test('E4 — HTML e testo lunghissimo nel ragionamento e nel titolo del nodo restano testo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await copione(app, [
    { pensa: ['<img src=x onerror="window.__x=1"> <b>grassetto</b> ', 'parolalunghissimasenzaspazi'.repeat(30) + ' '], ogni: 300,
      strumenti: [{ id: 'h1', name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: '<img src=y onerror="window.__y=1">' + ' 🍝'.repeat(40) }) }] },
    { pensa: ['Fine. '], ogni: 100, testo: 'Ok.' },
  ]);
  await page.locator('#input').fill('timer');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1200);
  await page.locator('.dash-activity-head').first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/g7-e4-html.png' });
  expect(await page.evaluate(() => [window.__x, window.__y])).toEqual([undefined, undefined]);
  const larghezze = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  console.log('LARGHEZZE', JSON.stringify(larghezze));
});

test('E5 — fermato con azione lenta, poi chat nuova: il primo messaggio della chat nuova non aspetta l\'azione vecchia', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await senzaAccoglienza(app, page);
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH = { search: async () => { await new Promise((r) => setTimeout(r, 8000)); return { results: [{ title: 'O', url: 'https://example.com/o', content: 't' }], provider: 'finto' }; } };
  });
  await copione(app, [
    { pensa: ['Cerco. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 's1', name: 'CERCA_WEB', arguments: '{"query":"orari"}' }] },
    { pensa: ['Rispondo. '], ogni: 100, testo: 'Risposta nuova.' },
  ]);
  await page.locator('#input').fill('orari');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-seg-head').first()).toHaveText(/Cerco sul web/, { timeout: 5_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 2_000 });
  // Torna alla home (Esc o pulsante), poi una domanda nuova.
  const casa = page.locator('#homeBtn, .dash-home-btn, [data-azione="home"]').first();
  if (await casa.count()) await casa.click(); else await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('STATO', await page.locator('body').getAttribute('data-state'));
  const t0 = Date.now();
  await page.locator('#input').fill('domanda nuova');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta nuova.' })).toBeVisible({ timeout: 15_000 });
  console.log('ATTESA SECONDA', Date.now() - t0);
  await page.screenshot({ path: 'tests/.shots/g7-e5-chat-nuova.png' });
});
