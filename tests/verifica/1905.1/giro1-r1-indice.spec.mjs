// Verifica #1905.1 giro 1: chiusa la scheda di un file del computer, il suo titolo non va al modello dell'indice.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const tm = (BrowserWindow) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;

test('r1 il titolo di un file del computer chiuso non parte verso il modello che indicizza l\'archivio', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('referti-'), 'Documenti');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'referto.html');
  writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>Referto esami del sangue di Mario Rossi</title><p>valori</p>');
  const page = await home(app);
  await app.evaluate(async () => {
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      globalThis.__richieste.push({ url: u, corpo: String((init && init.body) || '') });
      const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/embeddings')) {
        let quanti = 1;
        try { quanti = JSON.parse(init.body).input.length || 1; } catch (_) {}
        return json({ data: Array.from({ length: quanti }, (_, i) => ({ index: i, embedding: new Array(8).fill(0.1) })), usage: { prompt_tokens: 1 } });
      }
      if (u.includes('/chat/completions')) return json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      return json({ data: [] });
    };
    const A = globalThis.SN_CONST.ACTIONS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-indice' },
      modelRegistry: { 'prova-indice': { provider: 'openrouter', model: 'finto/indice' } },
      models: { [A.ARCHIVE_EMBED]: 'prova-indice' },
    });
  });

  const r = await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url }, { parole: `aprimi ${url}` }), file);
  expect(r.executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => /^file:/.test(x.url || '') && /referto\.html$/.test(x.url));
    return t && t.title && /Referto/.test(t.title) ? t.id : null;
  })), { timeout: 15_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => tm(BrowserWindow).closeTab(i), id);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.listMeta()).some((x) => /referto\.html$/.test(x.url || ''))),
    { message: 'la scheda chiusa è nell\'archivio' }).toBe(true);
  // Una pagina web chiusa nello stesso momento: lei sì va all'indice, e dice che l'indice gira.
  await app.evaluate(() => globalThis.SN_ARCHIVED_TABS.archive({ url: 'https://esempio.it/ricetta', title: 'Ricetta di controllo dell indice' }));
  await page.evaluate(() => window.filo.message({ type: 'search_archived_tabs', query: 'ricetta' }));

  const corpi = () => app.evaluate(() => globalThis.__richieste.filter((x) => x.url.includes('/embeddings')).map((x) => x.corpo).join('\n'));
  await expect.poll(corpi, { timeout: 20_000, message: 'l\'indice dell\'archivio gira per le pagine web' }).toContain('Ricetta di controllo');
  const tutti = await app.evaluate(() => globalThis.__richieste.map((x) => x.corpo).join('\n'));
  expect(tutti, 'il titolo del file del computer non è partito verso nessun modello').not.toContain('Referto esami');
});
