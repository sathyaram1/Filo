// #588 — un file che il sistema ESEGUE non entra nella cartella Download senza
// una risposta, e "Apri file" su un programma non lo esegue senza una seconda.
//
// Si asserisce il SUCCESSO dal punto di vista di chi usa Filo:
//   1. un PDF scende come sempre, senza domande (l'attrito va solo dove serve);
//   2. un .exe si ferma: compare l'avviso che dice che è un programma e da
//      quale sito arriva, e nella cartella Download il file NON c'è;
//   3. "Non scaricare" lo chiude e il file non compare mai;
//   4. "Scarica" lo fa arrivare davvero nella cartella;
//   5. "Apri file" su un programma NON chiama shell.openPath prima della
//      seconda conferma, e la chiama dopo.
//
// Senza il fix: (2) e (3) trovano l'exe in cartella subito, (5) apre al primo
// clic → rossi.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));
const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));

// Mini server che serve /report.pdf e /setup.exe come allegati.
async function apriServer() {
  const srv = createServer((req, res) => {
    const exe = String(req.url || '').includes('.exe');
    res.writeHead(200, {
      'Content-Type': exe ? 'application/octet-stream' : 'application/pdf',
      'Content-Length': exe ? EXE.length : PDF.length,
      'Content-Disposition': `attachment; filename="${exe ? 'setup.exe' : 'report.pdf'}"`,
    });
    res.end(exe ? EXE : PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    base,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

// Clicca un link al file e ritorna la Page della scheda (serve a ri-cliccare).
async function scarica(url, { openTab, testServer }) {
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
  await page.locator('#dl').click();
  return page;
}

const elenco = (shell) => shell.evaluate(() => window.filoShell.downloads.list());
const voce = async (shell, nome) => {
  const r = await elenco(shell);
  return ((r && r.items) || []).find((it) => it.filename === nome) || null;
};
const statoDi = async (shell, nome) => (await voce(shell, nome))?.state ?? null;

async function cartellaDownload(app) {
  return app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
}
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

test('un PDF scende senza domande, un programma si ferma e chiede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);

    // 1) Il file di tutti i giorni non cambia di una virgola.
    await scarica(`${srv.base}/report.pdf`, { openTab, testServer });
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20000 }).toBe('completed');
    expect(contenuto(dir)).toContain('report.pdf');

    // 2) Il programma si ferma PRIMA della cartella.
    await scarica(`${srv.base}/setup.exe`, { openTab, testServer });
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    const rec = await voce(shell, 'setup.exe');
    expect(rec.exe).toBe(true);
    expect(rec.site).toBe('127.0.0.1');
    // Il percorso della quarantena non esce verso le superfici.
    expect(rec.savePath).toBe('');

    // L'avviso dice che è un programma e da dove arriva, e offre le due risposte.
    const avviso = shell.locator('.shell-notif', { hasText: 'setup.exe' });
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText('programma');
    await expect(avviso).toContainText('127.0.0.1');
    await expect(avviso.locator('.shell-notif-action', { hasText: 'Scarica' })).toBeVisible();
    await expect(avviso.locator('.shell-notif-action', { hasText: 'Non scaricare' })).toBeVisible();

    // 3) Senza conferma il file NON è nella cartella Download. È il cuore del
    //    feedback: l'attesa non deve essere solo un avviso sopra un file già lì.
    expect(contenuto(dir)).not.toContain('setup.exe');

    // 4) "Non scaricare": la voce si chiude e il file non compare mai.
    await avviso.locator('.shell-notif-action', { hasText: 'Non scaricare' }).click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('cancelled');
    expect(contenuto(dir)).not.toContain('setup.exe');
  } finally {
    await srv.close();
  }
});

test('«Scarica» fa arrivare davvero il programma, e aprirlo chiede una seconda volta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);

    // Spia su shell.openPath: è la chiamata che su Windows ESEGUE il file.
    // Deve restare a zero finché non c'è la seconda conferma.
    await app.evaluate(() => {
      const { shell } = require('electron');
      globalThis.__aperti = [];
      shell.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
    });
    const aperti = () => app.evaluate(() => globalThis.__aperti.slice());

    await scarica(`${srv.base}/setup.exe`, { openTab, testServer });
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    const avviso = shell.locator('.shell-notif', { hasText: 'setup.exe' });
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await avviso.locator('.shell-notif-action', { hasText: 'Scarica' }).click();

    // Il sì fa arrivare il file dove l'utente lo cercherà.
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect.poll(() => contenuto(dir), { timeout: 10000 }).toContain('setup.exe');
    const rec = await voce(shell, 'setup.exe');
    expect(rec.savePath).toBe(join(dir, 'setup.exe'));

    // "Apri file" senza conferma: NON esegue, e dice perché.
    const primo = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(primo.ok).toBe(false);
    expect(primo.needsConfirm).toBe(true);
    expect(primo.text).toContain('setup.exe');
    expect(await aperti()).toEqual([]);

    // La shell mostra la seconda conferma con le due vie d'uscita.
    const conferma = shell.locator('.shell-notif', { hasText: 'Aprirlo vuol dire eseguirlo' });
    await expect(conferma).toBeVisible({ timeout: 10000 });
    await expect(conferma.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toBeVisible();
    await expect(conferma.locator('.shell-notif-action', { hasText: 'Apri cartella' })).toBeVisible();

    // Solo dopo il sì il file viene aperto davvero.
    await conferma.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
    await expect.poll(aperti, { timeout: 10000 }).toEqual([rec.savePath]);
  } finally {
    await srv.close();
  }
});

test('la pagina Scaricamenti marca i programmi e sa rispondere all’attesa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartellaDownload(app);
    await scarica(`${srv.base}/setup.exe`, { openTab, testServer });
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');

    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item[data-state="pending"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(riga).toBeVisible({ timeout: 15000 });
    // Si distingue a vista, e dice da dove arriva.
    await expect(riga.locator('.dl-tag')).toHaveText('Programma');
    await expect(riga.locator('.dl-meta')).toContainText('In attesa di conferma');
    await expect(riga.locator('.dl-meta')).toContainText('127.0.0.1');
    // Il percorso su disco non si mostra: il file non è ancora da nessuna parte
    // che riguardi l'utente.
    await expect(riga.locator('.dl-path')).toHaveCount(0);

    // Le stesse due risposte dell'avviso, per chi l'avviso l'ha già chiuso.
    await expect(riga.locator('.dl-btn', { hasText: 'Non scaricare' })).toBeVisible();
    await riga.locator('.dl-btn', { hasText: 'Scarica' }).first().click();

    const finita = dl.locator('.dl-item[data-state="completed"]', { has: dl.locator('.dl-name', { hasText: 'setup.exe' }) });
    await expect(finita).toBeVisible({ timeout: 20000 });
    await expect(finita.locator('.dl-tag')).toHaveText('Programma');
    expect(contenuto(dir)).toContain('setup.exe');
  } finally {
    await srv.close();
  }
});
