// Verifica #814.2 giro 1: una ricerca sul web fermata e ripresa, da tutte le strade di «riprendi», si fa una volta sola.
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

async function prepara(app) {
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

async function copione(app, passi) {
  await app.evaluate(async (_, passiJson) => {
    const passi = JSON.parse(passiJson);
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__messaggi = [];
    let n = 0;
    P.streamCompleteWithFallback = async ({ attempts, messages, signal, onReasoning, onDelta, onToolCall }) => {
      globalThis.__messaggi.push(messages);
      const p = passi[Math.min(n, passi.length - 1)];
      n += 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const aspetta = (ms) => new Promise((ok, ko) => {
        const t = setTimeout(ok, ms);
        if (signal) {
          const no = () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; ko(e); };
          if (signal.aborted) { no(); return; }
          signal.addEventListener('abort', no, { once: true });
        }
      });
      for (const pezzo of p.pensa || []) { try { onReasoning && onReasoning(pezzo); } catch (_) {} await aspetta(p.ogni || 120); }
      if (p.strumenti && p.strumenti.length) {
        for (const s of p.strumenti) { try { onToolCall && onToolCall({ id: s.id, name: s.name }); } catch (_) {} }
        await aspetta(p.dopoStrumenti || 200);
        return { ...base, text: '', toolCalls: p.strumenti, finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta(p.testo); } catch (_) {}
      return { ...base, text: p.testo, toolCalls: [], finishReason: 'stop' };
    };
  }, JSON.stringify(passi));
}

async function ricercaLenta(app, ms) {
  await app.evaluate((_, durata) => {
    globalThis.__ricerche = 0;
    globalThis.SN_WEB_SEARCH = { search: async () => {
      globalThis.__ricerche += 1;
      await new Promise((r) => setTimeout(r, durata));
      return { results: [{ title: 'Orari', url: 'https://example.com/orari', content: 'treni' }], provider: 'finto' };
    } };
  }, ms);
}

async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origStream) globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origStream;
  });
}

const IN_VOLO = [
  { pensa: ['Cerco gli orari. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'v1', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }] },
  { pensa: ['La ricerca c\'è già. '], ogni: 100, testo: 'Ecco gli orari.' },
];
const NON_PARTITA = [
  { pensa: ['Cerco gli orari. '], ogni: 100, dopoStrumenti: 3_000, strumenti: [{ id: 'n1', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }] },
  { pensa: ['Riprendo: cerco. '], ogni: 100, dopoStrumenti: 100, strumenti: [{ id: 'n2', name: 'CERCA_WEB', arguments: '{"query":"orari treni"}' }] },
  { pensa: ['Ho gli orari. '], ogni: 100, testo: 'Ecco gli orari.' },
];

async function fermaDurante(app, page, { copioneUsato, ritardo, inVolo }) {
  await ricercaLenta(app, ritardo);
  await copione(app, copioneUsato);
  await page.locator('#input').fill('orari treni');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity-seg-head').first()).toHaveText(/Cerco sul web/, { timeout: 5_000 });
  if (inVolo) await expect.poll(() => app.evaluate(() => globalThis.__ricerche), { timeout: 5_000 }).toBe(1);
  await page.locator('#stopBtn').click();
  await expect(page.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 1_500 });
}

async function esitoUnaRicerca(app, page) {
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco gli orari.' })).toBeVisible({ timeout: 12_000 });
  await page.waitForTimeout(600);
  expect(await app.evaluate(() => globalThis.__ricerche)).toBe(1);
  await expect(page.locator('.dash-activity-seg-head', { hasText: 'Cercato sul web' })).toHaveCount(1);
  await expect(page.locator('.dash-activity-seg-head', { hasText: /^Cerco sul web/ })).toHaveCount(0);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco gli orari.' })).toHaveCount(1);
}

test('ricerca in volo, «Riprendi» dal tasto: una ricerca, e lo schermo la dice fatta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await prepara(app);
  await fermaDurante(app, page, { copioneUsato: IN_VOLO, ritardo: 4_000, inVolo: true });
  await page.locator('#sendBtn').click();
  await esitoUnaRicerca(app, page);
  await page.screenshot({ path: 'tests/.shots/verifica-814-2-in-volo.png' });
  await ripristina(app);
});

test('ricerca in volo, «Riprendi» dal tasto destro: una ricerca', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await prepara(app);
  await fermaDurante(app, page, { copioneUsato: IN_VOLO, ritardo: 4_000, inVolo: true });
  await page.locator('.dash-activity-head').first().click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Riprendi da dove si era fermato').click();
  await esitoUnaRicerca(app, page);
  await ripristina(app);
});

test('ricerca in volo, «Riprendi» con Invio a casella vuota: una ricerca', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await prepara(app);
  await fermaDurante(app, page, { copioneUsato: IN_VOLO, ritardo: 4_000, inVolo: true });
  await page.waitForTimeout(800);
  await page.locator('#input').press('Enter');
  await esitoUnaRicerca(app, page);
  await ripristina(app);
});

test('ricerca nominata ma non partita, «Riprendi» dal tasto destro: la fa, una volta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await prepara(app);
  await fermaDurante(app, page, { copioneUsato: NON_PARTITA, ritardo: 300, inVolo: false });
  await page.waitForTimeout(500);
  expect(await app.evaluate(() => globalThis.__ricerche)).toBe(0);
  await page.locator('.dash-activity-head').first().click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Riprendi da dove si era fermato').click();
  await esitoUnaRicerca(app, page);
  await page.screenshot({ path: 'tests/.shots/verifica-814-2-non-partita.png' });
  await ripristina(app);
});
