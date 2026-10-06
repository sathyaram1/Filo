// Verifica #724.1, giro 1 — «Quanto fanno 3000 rupie in euro» scritto nella
// chat della home: il modello deve ricevere il cambio della rupia e il conto
// lo deve fare Filo, non il modello a memoria.

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

// Finto modello che fa quello che un buon modello farebbe: legge il tasso
// della rupia dal prompt e scrive il marker del conto, a pezzi come in rete.
async function modelloCheLeggeIlCambio(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__prompt = '';
    globalThis.__tasso = null;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__prompt = prompt;
      const m = /1 EUR = [^\n]*?([\d.]+) INR/.exec(prompt);
      const tasso = m ? m[1] : null;
      globalThis.__tasso = tasso;
      const full = tasso
        ? `3000 rupie sono circa [[calc: 3000/${tasso} | eur]] €.`
        : 'Circa 33 euro (a memoria).';
      const cut = Math.floor(full.length / 2);
      for (const c of [full.slice(0, cut), full.slice(cut)]) {
        try { onDelta && onDelta(c); } catch (_) {}
        await new Promise((r) => setTimeout(r, 300));
      }
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

test('la chat della home converte 3000 rupie col cambio del giorno e il conto di Filo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await modelloCheLeggeIlCambio(app);

  await page.locator('#input').fill('Quanto fanno 3000 rupie in euro');
  await page.locator('#sendBtn').click();

  // Mentre scorre, il marker grezzo non si vede mai.
  const visti = [];
  const fine = Date.now() + 5_000;
  while (Date.now() < fine) {
    const t = await page.evaluate(() => [...document.querySelectorAll('.dash-bubble-filo')].map((b) => b.textContent).join('|'));
    visti.push(t);
    if (/€/.test(t) && !(await page.locator('.dash-bubble-streaming').count())) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  expect(visti.join('\n')).not.toContain('[[');

  const tasso = await app.evaluate(() => globalThis.__tasso);
  expect(tasso, 'il prompt della chat contiene il cambio della rupia').toBeTruthy();
  const atteso = (3000 / Number(tasso)).toFixed(2).replace('.', ',');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText(`${atteso} €`, { timeout: 5_000 });

  await page.screenshot({ path: 'tests/.shots/verifica-724.1-giro1-rupie.png' });
});
