// #567.6 — la festa sabato dalle 22 alle 2 entra intera nel calendario anche quando il modello scrive il sabato
// come ultimo giorno: nelle due forme (ora di fine, durata) il bottone c'è, il diario dice le 2 di domenica e il
// file consegnato al calendario finisce alle 2.

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

async function preparaModello(app, giri) {
  await app.evaluate(async ({ shell: sh }, g) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
    globalThis.__festaAperti = [];
    require('electron').shell.openPath = async (p) => { globalThis.__festaAperti.push(p); return ''; };
  }, giri);
}

const FORME = [
  ['ora di fine', '{"titolo":"Festa da Bruno","data":"2026-11-28","ora":"22:00","ora_fine":"02:00","data_fine":"2026-11-28"}'],
  ['durata', '{"titolo":"Festa da Bruno","data":"2026-11-28","ora":"22:00","durata_min":240,"data_fine":"2026-11-28"}'],
];

for (const [forma, args] of FORME) {
  test(`la festa dalle 22 alle 2 col sabato come ultimo giorno (${forma}) finisce alle 2 di domenica`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await preparaModello(app, [
      { text: 'Ecco la festa.', toolCalls: [{ id: 'f1', name: 'EVENTO_CALENDARIO', arguments: args }] },
      { text: 'Fatto.' },
    ]);

    await page.locator('#input').fill('segnami la festa da Bruno sabato dalle 22 alle 2');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la festa.' })).toBeVisible({ timeout: 10_000 });

    const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
    await expect(btn).toHaveCount(1);
    const activity = page.locator('.dash-activity');
    await activity.locator('.dash-activity-head').click();
    const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Evento proposto' });
    await expect(riga).toContainText('dal 28/11/2026 alle 22:00 al 29/11/2026 alle 02:00');
    await expect(riga).not.toContainText('00:00');

    await btn.click();
    await expect.poll(() => app.evaluate(() => globalThis.__festaAperti.length), { timeout: 10_000 }).toBe(1);
    const ics = await app.evaluate(() => require('node:fs').readFileSync(globalThis.__festaAperti[0], 'utf8'));
    expect(ics).toContain('DTSTART:20261128T220000');
    expect(ics).toContain('DTEND:20261129T020000');
  });
}
