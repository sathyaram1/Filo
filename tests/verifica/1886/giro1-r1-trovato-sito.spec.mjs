// Verifica #1886 giro 1, rilievo 1: l'avviso «Trovato in …» col nome del file se ne va con le pagine del sito da cui
// viene lo scaricamento, come gli altri avvisi del nome.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const FILE = Buffer.from('%PDF-1.4\n% referto di prova\n' + 'r'.repeat(2500));

const avvisiCol = async (app, parola) => (await app.evaluate(async () => {
  await globalThis.SN_IL_FILO.quandoFermo();
  return globalThis.SN_IL_FILO.accaduti({ tipi: ['notifica'] });
})).filter((e) => String(e.testo || '').includes(parola));

test('r1 file spostato e ritrovato: cancellate le pagine del sito, nel filo non resta «Trovato in …» col nome del file', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const nome = `referto-clinica-${String(Date.now()).slice(-5)}.pdf`;
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': FILE.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(FILE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const doc = join(cartellaTemporanea('documenti-finti-'), 'Documenti');
    mkdirSync(join(doc, 'Referti'), { recursive: true });
    await app.evaluate(({ app: a }, d) => a.setPath('documents', d), doc);
    const url = `http://sito-pubblico.test:${srv.address().port}/${nome}`;
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body>`, { pubblico: true });
    await page.locator('#dl').click();
    let rec = null;
    await expect.poll(async () => {
      rec = (((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || []).find((it) => it.url === url) || null;
      return rec && rec.state;
    }, { timeout: 20000 }).toBe('completed');
    renameSync(rec.savePath, join(doc, 'Referti', nome));
    await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    await expect.poll(async () => (await avvisiCol(app, 'Trovato in')).length, { timeout: 15000 }).toBeGreaterThan(0);

    await app.evaluate(() => globalThis.SN_IL_FILO.cancellaPagine({ da: null, a: null, sito: 'sito-pubblico.test' }));
    await expect.poll(async () => (await avvisiCol(app, nome.replace(/\.pdf$/, ''))).map((e) => e.testo), { timeout: 10000 }).toEqual([]);
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
