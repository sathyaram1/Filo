// #410.3 — Pagina elenco scaricamenti (filo://downloads). Dopo aver scaricato un
// file, la pagina interna deve ELENCARLO (dal più recente) con nome, stato e
// percorso, e offrire per ogni voce le azioni puntuali (apri file, apri
// cartella, copia percorso, ri-scarica, rimuovi) sia come bottoni inline sia nel
// menu del tasto destro. "Svuota elenco" toglie i conclusi.
//
// I test asseriscono il SUCCESSO (la voce compare con le sue azioni, e Rimuovi
// la fa sparire davvero), non l'assenza di un errore. Senza la pagina (il fix):
// l'URL non esisterebbe → rosso.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const FILE = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));

// Fa partire (e completare) un download reale cliccando un link a un allegato,
// come in downloads-nav.spec. Ritorna quando la cronologia lo segna "completato".
async function downloadReportPdf({ app, shell, openTab, testServer }) {
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="report.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/report.pdf`;

  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <a id="dl" href="${fileUrl}">Scarica il report</a></body></html>`);
  await page.locator('#dl').click();

  // Aspetta il completamento su disco + in cronologia (ciò che la pagina legge).
  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
  await expect
    .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
    .toContain('report.pdf');
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    const e = ((r && r.items) || []).find((it) => it.filename === 'report.pdf');
    return e ? e.state : null;
  }, { timeout: 15000 }).toBe('completed');

  return { fileServer };
}

test('la pagina Scaricamenti elenca un download recente con le sue azioni', async ({ app, shell, openTab, testServer }) => {
  const { fileServer } = await downloadReportPdf({ app, shell, openTab, testServer });
  try {
    const dl = await openTab('filo://downloads/downloads.html');

    // 1) La voce compare, dal più recente, con nome e stato "Completato".
    const item = dl.locator('.dl-item[data-state="completed"]', { has: dl.locator('.dl-name', { hasText: 'report.pdf' }) });
    await expect(item).toBeVisible({ timeout: 10000 });
    await expect(item.locator('.dl-meta')).toContainText('Completato');
    // Il percorso su disco è mostrato (dove il file è finito).
    await expect(item.locator('.dl-path')).toContainText('report.pdf');

    // 2) Azioni per voce (bottoni inline): apri file, apri cartella, rimuovi.
    await expect(item.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible();
    await expect(item.locator('.dl-btn', { hasText: 'Apri cartella' })).toBeVisible();
    await expect(item.locator('.dl-btn', { hasText: 'Rimuovi' })).toBeVisible();

    // 3) Tasto destro → menu contestuale con TUTTE le azioni (copia percorso,
    //    ri-scarica), coerente con la centralità del tasto destro in Filo.
    await item.click({ button: 'right' });
    const menu = dl.locator('.dl-ctxmenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.sn-select-option', { hasText: 'Copia percorso' })).toBeVisible();
    await expect(menu.locator('.sn-select-option', { hasText: 'Ri-scarica' })).toBeVisible();
    await expect(menu.locator('.sn-select-option', { hasText: 'Rimuovi dalla lista' })).toBeVisible();
    // Chiudi il menu (clic fuori) per non interferire col passo dopo.
    await dl.locator('h1').click();
    await expect(menu).toHaveCount(0);

    // 4) "Rimuovi" fa sparire la voce DAVVERO (invariante UX: ciò che è in lista
    //    si può togliere), e comparire lo stato vuoto.
    await item.locator('.dl-btn', { hasText: 'Rimuovi' }).click();
    await expect(dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'report.pdf' }) }))
      .toHaveCount(0, { timeout: 10000 });
    await expect(dl.locator('#empty')).toBeVisible();
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});

test('una pagina web esterna non può leggere gli scaricamenti dalla pagina interna', async ({ app, shell, openTab, testServer }) => {
  // La pagina filo://downloads legge la lista dal canale interno DOWNLOADS_LIST,
  // che resta negato alle origini web (i percorsi su disco non trapelano).
  const { fileServer } = await downloadReportPdf({ app, shell, openTab, testServer });
  try {
    const fromWeb = await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: 'downloads_list' }, {
      tab: { id: 99, url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/',
    }));
    expect(fromWeb.ok).toBe(false);
    expect(fromWeb.error).toBe('forbidden');
    expect(JSON.stringify(fromWeb)).not.toContain('report.pdf');
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});
