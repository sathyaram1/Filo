// Verifica #825 giro 3, rilievo 2 (esterno): «cancella dall'archivio le pagine sui gatti» chiesto in chat deve proporre
// solo le schede sui gatti, e tutte. Qui 3 schede sui gatti fra 30: il pannello deve elencare quelle 3 e basta.

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

test('la cancellazione chiesta in chat propone solo le schede pertinenti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const A = globalThis.SN_ARCHIVED_TABS;
    for (let i = 0; i < 30; i++) {
      const gatto = i % 10 === 0;
      const t = await A.archive({ url: `https://pagina-${i}.test/`, title: gatto ? `Foto di gatti ${i}` : `Ricetta della nonna ${i}` });
      await A.update(t.id, { embedding: gatto ? [127, 0] : [20, 120], embedModel: EM, summary: gatto ? 'gatti' : 'cucina' });
    }
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    // Il riordino del modello tiene solo le pagine sui gatti.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const u = messages.map((m) => String(m.content)).join('\n');
      const order = [...u.matchAll(/#(\d+) Foto di gatti/g)].map((m) => Number(m[1]));
      return { text: JSON.stringify({ order }), provider: 'openrouter', model: 'stub', usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Ecco le schede da eliminare.', actions: [{ type: 'CANCELLA_ARCHIVIO', query: 'pagine sui gatti' }] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('cancella dall\'archivio le pagine sui gatti');
  await page.locator('#sendBtn').click();
  const pannello = page.locator('.dash-delete-panel');
  await expect(pannello.locator('.dash-delete-list li').first()).toBeVisible({ timeout: 15_000 });
  const voci = await pannello.locator('.dash-delete-list li').allTextContents();
  const nota = await pannello.locator('.dash-delete-note').textContent();
  const bottone = await pannello.locator('.dash-action-btn-danger').textContent();
  console.log(`[verifica #825 giro 3] ${nota} | ${bottone} | ${JSON.stringify(voci)}`);
  await page.screenshot({ path: 'tests/.shots/v825-g3-cancella-da-chat.png' });
  expect(voci.sort()).toEqual(['Foto di gatti 0', 'Foto di gatti 10', 'Foto di gatti 20']);
});
