// #410.2 — "Salva file" nel menu del tasto destro su un link a un file.
//
// Il gemello di "Salva immagine come…": oggi il clic destro su un link offriva
// solo apri/copia/salva-per-dopo/condividi, mancava lo scaricamento del file
// puntato. La voce "Salva file" deve:
//  1) comparire SOLO sui link a un file (PDF, ZIP, allegato…), non sui link a
//     un'altra pagina (scaricare l'HTML non ha senso);
//  2) scaricare il file passando per l'intercettazione dei download di #410.1,
//     così menu e clic sul link producono lo STESSO risultato visibile
//     (parità dei cammini): file su disco + voce di cronologia "completato".
//
// Asserisce il SUCCESSO (il file arriva e viene registrato), non l'assenza di un
// errore. Senza il fix la voce non esiste → il primo assert (voce visibile) è
// rosso. In test FILO_DOWNLOAD_DIR salva direttamente nella cartella isolata,
// senza il dialogo nativo (impossibile da automatizzare headless).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Un finto "PDF": basta che sia un file con byte noti servito come allegato.
const FILE = Buffer.from('%PDF-1.4\n% finto pdf #410.2\n' + 'y'.repeat(1024));

test('clic destro su un link a un file → "Salva file" scarica e registra il file (parità col clic)', async ({ app, shell, openTab, testServer }) => {
  // Server del file: risponde con Content-Disposition:attachment. Porta diversa
  // dal testServer ⇒ altra origine, come nel caso reale.
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="manuale.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/manuale.pdf`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Pagina con un allegato</h1>
      <a id="file" href="${fileUrl}">Il manuale (PDF)</a>
      <p><a id="pagina" href="https://esempio.invalid/altra-pagina">Un'altra pagina</a></p>
    </body></html>`);
    const pageUrl = page.url();

    // 1) Sul link a un FILE la voce compare.
    await page.locator('#file').click({ button: 'right' });
    const save = page.locator('.sn-menu button', { hasText: 'Salva file' });
    await expect(save).toBeVisible();

    // 2) Sceglierla scarica il file: byte giusti su disco…
    await save.click();
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(dir).toBeTruthy();
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
      .toContain('manuale.pdf');
    expect(readFileSync(join(dir, 'manuale.pdf')).equals(FILE)).toBe(true);

    // …e una voce di cronologia "completato" (lo stesso stato del clic sul link).
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.filename === 'manuale.pdf');
      return e ? e.state : null;
    }, { timeout: 15000 }).toBe('completed');
    const list = (await shell.evaluate(() => window.filoShell.downloads.list())).items;
    const entry = list.find((it) => it.filename === 'manuale.pdf');
    expect(entry.totalBytes).toBe(FILE.length);
    expect(entry.savePath).toContain('manuale.pdf');

    // La scheda NON è navigata sul PDF: resta sulla pagina di partenza.
    expect(page.url()).toBe(pageUrl);

    // 3) Sul link a una PAGINA la voce NON compare (scaricherebbe l'HTML).
    await page.locator('#pagina').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    await expect(page.locator('.sn-menu button', { hasText: 'Salva file' })).toHaveCount(0);
    // …ma le altre azioni sul link ci sono ancora (il menu non si è impoverito).
    await expect(page.locator('.sn-menu button', { hasText: 'Copia URL' })).toBeVisible();
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});
