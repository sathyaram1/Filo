// Verifica #588, giro 2 — la risposta data in un posto vale ovunque.
//
// La domanda «è un programma: scaricarlo?» compare in tre posti (l'avviso in
// alto, il pannello della barra, la pagina Scaricamenti). Chi risponde in uno
// non deve ritrovare nell'avviso una domanda che non aspetta più niente.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const CORPO = Buffer.from('MZ finto contenuto di prova\n' + 'z'.repeat(1024));

async function apriServer() {
  const srv = createServer((req, res) => {
    let nome = 'file.bin';
    try { nome = new URL(req.url, 'http://x').searchParams.get('n') || nome; } catch (_) {}
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': CORPO.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(CORPO);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  return {
    base: `http://127.0.0.1:${porta}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const elenco = async (shell) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (r && r.items) || [];
};
const statoDi = async (shell, nome) => (await elenco(shell)).find((r) => r.filename === nome)?.state ?? null;

async function apriPagina(base, { openTab, testServer }, nomi) {
  const link = nomi
    .map((n, i) => `<a id="l${i}" href="${base}/scarica?n=${encodeURIComponent(n)}">${i}</a>`)
    .join('\n');
  return testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">${link}</body></html>`);
}

test('risposto dalla pagina Scaricamenti, l’avviso in alto non chiede più', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    const page = await apriPagina(srv.base, { openTab, testServer }, ['setup.exe']);
    await page.locator('#l0').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 30000 }).toBe('pending');

    const avviso = shell.locator('.shell-notif', { hasText: 'setup.exe' });
    await expect(avviso).toBeVisible({ timeout: 15000 });

    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item[data-state="pending"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(riga).toBeVisible({ timeout: 20000 });
    await riga.locator('.dl-btn', { hasText: 'Non scaricare' }).click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('cancelled');

    // La domanda ha già avuto la sua risposta: l'avviso che la pone ancora,
    // senza scadenza, è una domanda falsa con due pulsanti che non fanno niente.
    await expect(avviso.filter({ hasText: 'Scaricarlo?' })).toBeHidden({ timeout: 10000 });
  } finally {
    await srv.close();
  }
});
