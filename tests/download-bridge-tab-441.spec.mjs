// #441 — Pagina-ponte dello scaricamento ("Grazie, il download partirà a
// breve…"): certi siti non avviano il file dal link, ma aprono in una nuova
// scheda una pagina intermedia che dopo un attimo lo avvia da sola. Quella
// pagina ha contenuto vero, quindi la regola del #412 (chiudi solo le schede
// rimaste bianche) la lasciava aperta: il file arrivava e all'utente restava
// comunque una scheda da chiudere a mano.
//
// SUCCESSO del fix (asserito qui, non l'assenza di un errore):
//   1) il file arriva davvero (il download va a "completato");
//   2) la scheda-ponte NON resta aperta e il fuoco torna alla scheda di partenza;
//   3) la chiusura è reversibile: compare un avviso con "Riapri" che rimette la
//      pagina-ponte in una scheda (chiudere da soli qualcosa di visibile senza
//      via di ritorno sarebbe peggio dell'attrito tolto).
// Casi di CONTROLLO (la firma dev'essere stretta, non chiude schede legittime):
//   A) stessa pagina raggiunta dall'utente nella PROPRIA scheda (non aperta da
//      un link): il download parte e la scheda RESTA;
//   B) pagina aperta da un link ma su cui l'utente ha CLICCATO per avviare il
//      file: la scheda RESTA.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const FILE = Buffer.from('%PDF-1.4\n% finto pdf #441\n' + 'x'.repeat(2048));

// Server del file, servito come allegato (Content-Disposition:attachment).
async function startFileServer(name) {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    res.end(FILE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/${name}`,
    async stop() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// Pagina intermedia con contenuto vero che avvia il file da sola dopo un attimo.
const bridgeHtml = (fileUrl) => `<!doctype html><html><head>
  <title>Grazie! Il download partirà a breve</title></head>
  <body style="padding:40px">
    <h1 id="grazie">Grazie, il download partirà a breve…</h1>
    <p>Se non parte da solo, usa il collegamento diretto.</p>
    <script>setTimeout(function(){ location.href = ${JSON.stringify(fileUrl)}; }, 400);</script>
  </body></html>`;

const stato = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

async function attendiCompletato(shell, filename) {
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    const e = ((r && r.items) || []).find((it) => it.filename === filename);
    return e ? e.state : null;
  }, { timeout: 20000 }).toBe('completed');
}

test('la pagina "il download partirà a breve" aperta in nuova scheda si chiude da sola quando il file parte', async ({ app, shell, openTab, testServer }) => {
  const file = await startFileServer('ponte441.pdf');
  try {
    const bridgeUrl = testServer.html(bridgeHtml(file.url));
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Scarica il manuale</h1>
      <a id="dl" href="${bridgeUrl}" target="_blank" rel="noopener">Scarica (nuova scheda)</a>
    </body></html>`);

    const before = await stato(shell);
    const startTabId = before.activeId;
    const baselineCount = before.tabs.length;
    expect(startTabId).toBeTruthy();

    // Flusso utente reale: un clic sul link, poi non tocca più niente.
    await page.locator('#dl').click();

    // 1) Il file arriva davvero (chiudere la scheda non deve troncare il download).
    await attendiCompletato(shell, 'ponte441.pdf');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(existsSync(dir) ? readdirSync(dir) : []).toContain('ponte441.pdf');

    // 2) La scheda-ponte non è più lì e il fuoco è tornato alla scheda di partenza.
    await expect.poll(async () => (await stato(shell)).tabs.length, { timeout: 10000 }).toBe(baselineCount);
    const after = await stato(shell);
    expect(after.activeId).toBe(startTabId);
    expect(
      after.tabs.find((t) => (t.url || '').startsWith(bridgeUrl)),
      'la pagina-ponte è rimasta aperta dopo lo scaricamento',
    ).toBeFalsy();

    // 3) L'avviso dice cosa è successo e permette di riaprirla.
    const card = shell.locator('.shell-notif', { hasText: 'Chiusa' });
    await expect(card).toBeVisible({ timeout: 8000 });
    await card.locator('.shell-notif-action', { hasText: 'Riapri' }).click();
    await expect.poll(async () => {
      const s = await stato(shell);
      return s.tabs.some((t) => (t.url || '').startsWith(bridgeUrl));
    }, { timeout: 10000 }).toBe(true);
  } finally {
    await file.stop();
  }
});

test('controllo: la stessa pagina raggiunta dall’utente nella sua scheda NON viene chiusa', async ({ shell, openTab, testServer }) => {
  const file = await startFileServer('mia441.pdf');
  try {
    // Nessun link, nessuna nuova scheda: è la scheda dell'utente che va lì.
    const bridgeUrl = testServer.html(bridgeHtml(file.url));
    const page = await openTab(bridgeUrl);
    await page.waitForSelector('#grazie');
    const tabId = (await stato(shell)).activeId;

    await attendiCompletato(shell, 'mia441.pdf');

    // Il download è arrivato, ma la scheda dell'utente resta esattamente dov'era.
    await shell.waitForTimeout(1500);
    const after = await stato(shell);
    const mine = after.tabs.find((t) => t.id === tabId);
    expect(mine, 'la scheda dell’utente è stata chiusa per sbaglio').toBeTruthy();
    expect((mine.url || '').startsWith(bridgeUrl)).toBe(true);
  } finally {
    await file.stop();
  }
});

test('controllo: se l’utente clicca sulla pagina per avviare il file, la scheda resta', async ({ app, shell, openTab, testServer }) => {
  const file = await startFileServer('cliccato441.pdf');
  try {
    // Pagina-ponte "manuale": il file parte solo se l'utente clicca il pulsante.
    const bridgeUrl = testServer.html(`<!doctype html><html><head>
      <title>Scarica il manuale</title></head><body style="padding:40px">
        <h1 id="grazie">Il download non è partito?</h1>
        <button id="vai" style="font-size:28px;padding:20px 40px">Scarica ora</button>
        <script>document.getElementById('vai').addEventListener('click', function(){
          location.href = ${JSON.stringify(file.url)};
        });</script>
      </body></html>`);

    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <a id="dl" href="${bridgeUrl}" target="_blank" rel="noopener">Scarica (nuova scheda)</a>
    </body></html>`);
    await page.locator('#dl').click();

    // La scheda-ponte si è aperta: prendiamo la sua Page e ci clicchiamo dentro.
    let bridge = null;
    await expect.poll(async () => {
      bridge = app.windows().find((w) => (w.url() || '').startsWith(bridgeUrl)) || null;
      return !!bridge;
    }, { timeout: 10000 }).toBe(true);
    await bridge.waitForSelector('#vai');
    const bridgeTabId = (await stato(shell)).tabs.find((t) => (t.url || '').startsWith(bridgeUrl))?.id;
    expect(bridgeTabId).toBeTruthy();

    await bridge.locator('#vai').click();

    await attendiCompletato(shell, 'cliccato441.pdf');

    // L'utente l'ha toccata: gliela lasciamo.
    await shell.waitForTimeout(1500);
    const after = await stato(shell);
    expect(
      after.tabs.some((t) => t.id === bridgeTabId),
      'una scheda con cui l’utente ha interagito è stata chiusa',
    ).toBe(true);
  } finally {
    await file.stop();
  }
});
