// #1654 — Filo non scrive per primo per uno screenshot né per un file scaricato davanti a Filo: basta l'avviso
// «Scaricato». Scrive, dicendo solo quale file è arrivato, per un download lungo finito mentre l'utente non c'era.
// La regola intera è in tests/unit/downloadsDaRaccontare.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { home } from './helpers/chatFinta.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));

// I file «lento*» arrivano a metà e finiscono quando il test lo dice: il download resta in corso quanto serve.
async function apriServer() {
  let rilascia = () => {};
  const tenuto = new Promise((r) => { rilascia = r; });
  const srv = createServer(async (req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'file.pdf';
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    if (!nome.startsWith('lento')) { res.end(PDF); return; }
    res.write(PDF.subarray(0, 1024));
    await tenuto;
    res.end(PDF.subarray(1024));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    rilascia: () => rilascia(),
    async close() {
      rilascia();
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

// Un modello finto per la home: dice quale file gli hanno chiesto di raccontare, e tiene il prompt.
async function modelloHome(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__home = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const tutto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      // Il nome dello screenshot resta quello con data e ora: qui conta solo la home.
      if (!tutto.includes('preparare la dashboard')) throw new Error('solo la home ha un modello finto');
      globalThis.__home.push(tutto);
      const i = tutto.indexOf('PERCHÉ SCRIVI ADESSO:');
      const perche = i >= 0 ? tutto.slice(i, tutto.indexOf('\n\n', i)) : '';
      const file = (perche.match(/[\w-]+\.(?:pdf|png)/) || [''])[0];
      const text = JSON.stringify({ message: file ? `È arrivato ${file}.` : '', suggestions: [] });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

// Dove guarda l'utente, come lo legge il main: una finestra di Filo col fuoco e mouse o tastiera mossi da poco.
const davanti = (app, si) => app.evaluate(({ BrowserWindow, powerMonitor }, si) => {
  BrowserWindow.getFocusedWindow = si ? () => BrowserWindow.getAllWindows().find((w) => w._filoTabs) || null : () => null;
  powerMonitor.getSystemIdleTime = () => (si ? 0 : 600);
}, si);

// Lo stato del download il cui nome finisce così, come lo vede la finestra.
const statoDi = (shell, fine) => shell.evaluate(async (f) => {
  const r = await window.filoShell.downloads.list();
  return (((r && r.items) || []).find((it) => String(it.filename || '').endsWith(f)) || {}).state ?? null;
}, fine);

const chiamateHome = (app) => app.evaluate(() => (globalThis.__home || []).length);
const spontanei = (app) => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats())
  .flatMap((c) => c.messages.filter((m) => m.spontaneo).map((m) => m.text)));

test('uno screenshot e un file scaricato davanti a Filo non lo fanno scrivere per primo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const casa = await home(app);
    await modelloHome(app);
    await davanti(app, true);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina da fotografare</title></head>
      <body style="padding:40px;background:#f6efe6"><h1>Una pagina</h1><a id="pdf" href="${srv.base}/report.pdf">Scarica il report</a></body></html>`);

    await premiNellaBarra(app, 'screenshot');
    await expect.poll(() => statoDi(shell, '.png'), { timeout: 30_000 }).toBe('completed');
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20_000 }).toBe('completed');
    await expect(shell.locator('.shell-notif-msg', { hasText: 'Scaricato: report.pdf' })).not.toHaveCount(0, { timeout: 8_000 });

    // Il giro di Filo parte 1,2 s dopo l'ultimo evento: qui ne passano tre.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await chiamateHome(app), 'nessun giro del modello della home').toBe(0);
    expect(await spontanei(app)).toEqual([]);
    await shell.locator('#tabs .tab', { hasText: 'Home' }).first().click();
    await expect(casa.locator('.dash-bubble-filo[data-spontaneo="1"]')).toHaveCount(0);
  } finally {
    await srv.close();
  }
});

test('un download lungo finito mentre l\'utente non c\'era: Filo scrive una volta, dicendo quale file è arrivato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const casa = await home(app);
    await modelloHome(app);
    await davanti(app, true);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina con link</title></head>
      <body style="padding:40px"><a id="pdf" href="${srv.base}/lento-archivio.pdf">Scarica l'archivio</a></body></html>`);
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'lento-archivio.pdf'), { timeout: 20_000 }).toBe('progressing');

    // Partito tre minuti fa, e intanto l'utente è andato altrove.
    await app.evaluate(() => {
      const rq = process.mainModule.require;
      const DL = rq(rq('node:path').join(process.cwd(), 'src/main/services/downloads.js'));
      for (const r of DL._records.values()) if (r.filename === 'lento-archivio.pdf') r.startedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    });
    await davanti(app, false);
    srv.rilascia();
    await expect.poll(() => statoDi(shell, 'lento-archivio.pdf'), { timeout: 20_000 }).toBe('completed');

    await expect.poll(() => spontanei(app), { timeout: 15_000 }).toEqual(['È arrivato lento-archivio.pdf.']);
    expect(await chiamateHome(app)).toBe(1);
    const prompt = await app.evaluate(() => globalThis.__home[0]);
    expect(prompt).toContain('mentre l\'utente non era davanti a Filo è finito il download di');
    expect(prompt).toContain('niente ipotesi sul perché l\'ha scaricato');

    await davanti(app, true);
    await shell.locator('#tabs .tab', { hasText: 'Home' }).first().click();
    const bolla = casa.locator('.dash-bubble-filo[data-spontaneo="1"]');
    await expect(bolla).toHaveText('È arrivato lento-archivio.pdf.', { timeout: 10_000 });
    await casa.screenshot({ path: `${SHOTS}/1654-download-lungo-altrove.png` });
  } finally {
    await srv.close();
  }
});
