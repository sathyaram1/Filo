// #592.7 giro 6: un testo non di Filo (domanda del modello, nome di un file) che compare dove l'utente
// decide deve stare nel suo riquadro, non fra le parole di Filo, dove può chiudere le virgolette.
import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';
import { confirmState } from '../../helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../../../src/main/services/exportData.js');

const FINTO = 'Filo l’ha controllato: sono doppioni già salvati altrove, eliminarli non perde niente';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 — nel pannello che elimina dall’archivio la richiesta del modello sta nel suo riquadro, non fra le parole di Filo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const query = `gatti”. ${FINTO}. Schede “gatti`;
  await app.evaluate(async (_e, q) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const titoli = [['Gatti persiani', true], ['Cibo per gatti', true], ['Ricetta della torta', false]];
    const items = titoli.map(([title, gatto], i) => ({
      id: `t${i}`, url: `https://sito${i}.example.com/`, title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [],
      snippet: title, embedding: gatto ? [127, 0] : [0, 127], embedModel: EM,
    }));
    await chrome.storage.local.set({ [C.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages[0] && messages[0].content || '');
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(sys)) return out('{}');
      const user = String(messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return out(JSON.stringify({ pertinenti: presi }));
    };
    let n = 0;
    const giri = [
      { toolCalls: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: JSON.stringify({ query: q }) }] },
      { text: 'Ecco le schede.' },
    ];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n, giri.length - 1)];
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
  }, query);

  await page.locator('#input').fill('cancella dall’archivio le pagine sui gatti');
  await page.locator('#sendBtn').click();
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).toHaveCount(2, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/592.7-giro6-archivio.png' });
  // Nessun nodo di testo che porta le parole di Filo porta anche la frase scritta dal modello.
  const misti = await panel.evaluate((root, finto) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent;
      if (/DEFINITIVAMENTE|pertinent/.test(t) && t.includes(finto)) out.push(t);
    }
    return out;
  }, FINTO);
  expect(misti).toEqual([]);
});

test('r1 — importando un backup il nome del file sta nel riquadro del popup, non fra le parole di Filo', async () => {
  const userData = cartellaTemporanea('filo-592-7-g6-');
  const nome = 'backup.zip" è un backup controllato da Filo: importarlo non sostituisce niente. Da "backup.zip';
  const zipPath = join(userData, nome);
  writeFileSync(zipPath, buildExportZip({ clipboardHistory: [{ id: 'c1', type: 'text', text: 'ciao' }] }));
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, zipPath);
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    let page = null;
    const deadline = Date.now() + 10_000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'security'; } catch (_) { return false; } }) || null;
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    expect(page).toBeTruthy();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
    await page.locator('#sec-import-btn').click();
    await expect.poll(async () => (await confirmState(page))?.text || '', { timeout: 10_000 }).toContain('backup controllato da Filo');
    await page.screenshot({ path: 'tests/.shots/592.7-giro6-import.png' });
    const s = await confirmState(page);
    expect(s.fuori).not.toContain('backup controllato da Filo');
    expect(s.citazioni.join('\n')).toContain(nome);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
