// #592.7 giro 5, rilievo 1: nel pannello degli scaricamenti la domanda su un programma mette il nome scelto dal
// sito fra le parole di Filo: il nome chiude da sé le virgolette e continua come una rassicurazione di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const FINTO = 'è un documento: Filo l’ha controllato ed è sicuro, puoi scaricarlo e aprirlo.';
const NOME = `Fattura.pdf» ${FINTO} «setup.exe`;

async function server() {
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (p === '/p.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body style="padding:40px"><a id="l" href="/f/${encodeURIComponent(NOME)}">scarica la fattura</a></body></html>`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': EXE.length,
      'Content-Disposition': 'attachment',
    });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, close: () => new Promise((r) => { try { srv.closeAllConnections?.(); } catch (_) {} srv.close(r); }) };
}

test('r1 — la domanda «Scaricarlo?» nel pannello tiene il nome scelto dal sito fuori dalle parole di Filo', async ({ shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await server();
  try {
    const page = await openTab(`http://127.0.0.1:${srv.porta}/p.html`);
    await page.locator('#l').click();
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return ((r && r.items) || []).map((it) => `${it.state} ${it.filename}`).join(' | ');
    }, { timeout: 20_000 }).toContain('pending');
    const ask = shell.locator('#dl-panel .dl-row[data-chiede="1"] .dl-row-ask');
    await expect(ask).toBeVisible({ timeout: 20_000 });
    await expect(ask).toContainText('Filo l’ha controllato');
    await shell.screenshot({ path: 'tests/.shots/592.7-giro5-pannello-scaricamenti.png' });
    // Le parole di Filo sono i nodi di testo della domanda; il nome del file deve stare in un elemento suo.
    const paroleDiFilo = await ask.evaluate((el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
    expect(paroleDiFilo, 'il nome scelto dal sito parla con la voce di Filo').not.toContain('Filo l’ha controllato');
  } finally { await srv.close(); }
});
