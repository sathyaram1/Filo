// #410.4 — Il file scaricato non c'è più (spostato, rinominato, cestinato) e
// l'utente preme "Apri file". Prima non succedeva NIENTE: il main si accorgeva
// del fallimento e la schermata buttava via la risposta. Qui si pretende che:
//
//   1. il comando risponda "il file non c'è più" invece di fingere successo
//      (su Linux shell.openPath dice "riuscito" anche su un percorso vuoto:
//      per questo il main guarda il disco PRIMA di tentare);
//   2. l'avviso di fine scaricamento, se il file nel frattempo è sparito, lo
//      DICA a schermo quando si preme "Apri file";
//   3. la pagina elenco marchi la voce (attenuata, senza "Apri file") così si
//      vede prima ancora di cliccare.
//
// Senza il fix: (1) risponde ok, (2) nessun avviso compare, (3) la voce resta
// identica a una scaricata un attimo fa → tutti e tre rossi.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, unlinkSync } from 'node:fs';

const FILE = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'y'.repeat(2048));

async function scarica(nome, { shell, openTab, testServer }) {
  const srv = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(FILE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/${nome}`;
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
  await page.locator('#dl').click();

  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    const e = ((r && r.items) || []).find((it) => it.filename === nome);
    return e ? e.state : null;
  }, { timeout: 20000 }).toBe('completed');

  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  const rec = ((r && r.items) || []).find((it) => it.filename === nome);
  expect(existsSync(rec.savePath)).toBe(true);
  return { rec, close: async () => {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r2) => srv.close(r2));
  } };
}

test('"Apri file" su un file cancellato risponde che non c\'è più (e l\'avviso lo mostra)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { rec, close } = await scarica('sparito.pdf', { shell, openTab, testServer });
  try {
    unlinkSync(rec.savePath);   // l'utente lo sposta / svuota il cestino

    // 1. Il comando dice cosa è successo, con una frase per l'utente.
    const res = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(res.ok).toBe(false);
    expect(res.missing).toBe(true);
    expect(res.error).toMatch(/non c[’']è più/i);

    // 2. La voce, ri-letta, si dichiara vuota: le superfici possono attenuarla.
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.id === rec.id);
      return e ? e.missing : null;
    }, { timeout: 5000 }).toBe(true);

    // 3. L'avviso di fine scaricamento ha l'azione "Apri file": premendola con
    //    il file ormai sparito, l'utente deve VEDERE il perché. Rigiochiamo lo
    //    stesso avviso che manda il main a fine scaricamento.
    await app.evaluate(({ BrowserWindow }, payload) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs) || BrowserWindow.getAllWindows()[0];
      win.webContents.send('shell:toast', payload);
    }, {
      text: 'Scaricato: sparito.pdf',
      opts: { durationSec: 60, sound: false, actions: [{ label: 'Apri file', openDownloadId: rec.id }] },
    });

    // (l'avviso vero di fine scaricamento può essere ancora a schermo: prendiamo
    // il più recente, quello appena rigiocato)
    const azione = shell.locator('.shell-notif-action', { hasText: 'Apri file' }).last();
    await expect(azione).toBeVisible({ timeout: 10000 });
    await azione.click();
    await expect(shell.locator('.shell-notif-msg', { hasText: /non c[’']è più/ }))
      .toBeVisible({ timeout: 10000 });
  } finally { await close(); }
});

test('nell\'elenco, la voce di un file sparito è attenuata e non offre "Apri file"', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { rec, close } = await scarica('svanito.pdf', { shell, openTab, testServer });
  try {
    const dl = await openTab('filo://downloads/downloads.html');
    const voce = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'svanito.pdf' }) });
    await expect(voce).toBeVisible({ timeout: 10000 });
    // Finché il file c'è, la voce si apre normalmente.
    await expect(voce.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible();

    unlinkSync(rec.savePath);
    // Tornare sulla scheda ri-legge la lista (nessun evento annuncia una
    // cartella svuotata da fuori Filo).
    await dl.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(voce).toHaveAttribute('data-missing', '1', { timeout: 10000 });
    await expect(voce.locator('.dl-meta')).toContainText('Non più sul disco');
    await expect(voce.locator('.dl-btn', { hasText: 'Apri file' })).toHaveCount(0);
    // Resta il modo di riaverlo, e di togliere la voce.
    await expect(voce.locator('.dl-btn', { hasText: 'Ri-scarica' })).toBeVisible();
    await expect(voce.locator('.dl-btn', { hasText: 'Rimuovi' })).toBeVisible();

    // Tasto destro: niente "Apri file" nemmeno lì (parità fra i due cammini).
    await voce.click({ button: 'right' });
    const menu = dl.locator('.dl-ctxmenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.sn-select-option', { hasText: 'Apri file' })).toHaveCount(0);
    await expect(menu.locator('.sn-select-option', { hasText: 'Ri-scarica' })).toBeVisible();
  } finally { await close(); }
});
