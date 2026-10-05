// #578, verifica giro 6, rilievo 1: durante l'accoglienza un turno fermato col quadrato riparte da solo appena si apre
// una scheda nuova o si ricarica la pagina, e la scheda dove si era fermato resta con «Riprendi» su una risposta già data.
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

// Un modello finto a copione. Ogni passo: { pensa: [pezzi], ogni: ms, strumenti: [{id,name,arguments}],
// dopoStrumenti: ms, testo, sordo }. Rispetta lo stop (signal) salvo `sordo`; registra i messaggi ricevuti e gli stop.
async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    globalThis.__interrotte = 0;
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal && !p.sordo) {
          if (signal.aborted) { clearTimeout(t); globalThis.__interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); return; }
          signal.addEventListener('abort', () => { clearTimeout(t); globalThis.__interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); }, { once: true });
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

const PENSIERO_1 = ['L\'utente vuole due timer, ', 'uno per la pasta e uno per l\'uovo. ', 'Li avvio insieme, ', 'sono indipendenti. '];
const PENSIERO_2 = ['Sono partiti tutti e due. ', 'Rispondo in breve. '];

const LUNGO = { pensa: ['Penso a lungo a come presentarmi. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. ', 'Ancora. '], ogni: 900, testo: 'Piacere Luca!' };

async function fermaNellAccoglienza(app, page) {
  await configureModel(app);
  await copione(app, [LUNGO, { pensa: ['Ripreso da solo. '], ogni: 200, testo: 'Piacere Luca, ripreso da solo!' }]);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('mi chiamo Luca');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').last()).toContainText('lungo', { timeout: 6_000 });
  await page.locator('#stopBtn').click();
  await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 3_000 });
}

test('accoglienza fermata: una scheda nuova non fa ripartire il lavoro fermato', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await fermaNellAccoglienza(app, page);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 10_000 }).toBe(2);
  await page.waitForTimeout(5_000);
  // Il modello è stato chiamato una volta sola: quella fermata.
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
  for (const p of app.windows().filter((w) => w.url().startsWith('filo://newtab'))) {
    await expect(p.locator('.dash-bubble-filo', { hasText: 'ripreso da solo' })).toHaveCount(0);
  }
  // Nella scheda dove si era fermato, riprendere resta una scelta dell'utente.
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi');
  await ripristina(app);
});

test('accoglienza fermata: ricaricare la pagina non fa ripartire il lavoro fermato', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await fermaNellAccoglienza(app, page);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await page.waitForTimeout(5_000);
  expect(await app.evaluate(() => globalThis.__messaggi.length)).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ripreso da solo' })).toHaveCount(0);
  await ripristina(app);
});
