// #473 — aprendo uno scaricamento il cui file è stato spostato, Filo lo cerca (stesso nome e dimensione, Download,
// Scrivania, Documenti più un livello): trovato, lo apre, dice dove, e la voce punta al posto nuovo.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync, renameSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const FILE = Buffer.from('%PDF-1.4\n% bolletta di prova\n' + 'b'.repeat(3000));

async function scarica(nome, { shell, openTab, testServer }) {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': FILE.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(FILE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/${nome}`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body></html>`);
  await page.locator('#dl').click();
  let rec = null;
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    rec = ((r && r.items) || []).find((it) => it.filename === nome) || null;
    return rec && rec.state;
  }, { timeout: 20000 }).toBe('completed');
  return { rec, close: async () => { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

// Documenti finto: il main lo chiede al sistema (app.getPath), e qui il sistema risponde con una cartella del test.
async function documentiFinti(app) {
  const doc = join(cartellaTemporanea('documenti-finti-'), 'Documenti');
  mkdirSync(join(doc, 'Bollette'), { recursive: true });
  await app.evaluate(({ app: a }, d) => a.setPath('documents', d), doc);
  return doc;
}

test('un file spostato in Documenti/Bollette si ritrova al clic sulla voce: si apre, l’avviso dice dove, la voce non è più barrata', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  const doc = await documentiFinti(app);
  const { rec, close } = await scarica('bolletta-luce.pdf', { shell, openTab, testServer });
  try {
    const nuovo = join(doc, 'Bollette', 'bolletta-luce.pdf');
    renameSync(rec.savePath, nuovo);
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'bolletta-luce.pdf' }) });
    await expect(riga).toHaveAttribute('data-missing', '1', { timeout: 10000 });
    await riga.click();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Trovato in Documenti/Bollette' })).toBeVisible({ timeout: 15000 });
    await expect(riga).not.toHaveAttribute('data-missing', '1', { timeout: 10000 });
    await expect(riga.locator('.dl-path')).toHaveText(nuovo);
    await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible();
    await riga.screenshot({ path: join(SHOTS, 'download-473-ritrovato.png') });
    // Il posto nuovo è salvato: la pagina riaperta lo mostra, e la voce si apre senza cercare di nuovo.
    await dl.reload();
    await expect(dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'bolletta-luce.pdf' }) }).locator('.dl-path')).toHaveText(nuovo);
    const res = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(res && res.ok).toBe(true);
    expect(existsSync(nuovo)).toBe(true);
  } finally { await close(); }
});

test('«Apri cartella» su un file spostato lo ritrova e mostra quello, non la cartella vuota', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(60_000);
  const doc = await documentiFinti(app);
  const { rec, close } = await scarica('referto.pdf', { shell, openTab, testServer });
  try {
    const nuovo = join(doc, 'referto.pdf');
    renameSync(rec.savePath, nuovo);
    const res = await shell.evaluate((id) => window.filoShell.downloads.openFolder(id), rec.id);
    expect(res).toMatchObject({ ok: true });
    expect(res.missing).toBeFalsy();
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif-msg', { hasText: 'Trovato in Documenti' })).toBeVisible({ timeout: 15000 });
    const dopo = ((await shell.evaluate(() => window.filoShell.downloads.list())).items || []).find((x) => x.id === rec.id);
    expect(dopo.savePath).toBe(nuovo);
    expect(dopo.missing).toBe(false);
  } finally { await close(); }
});

test('stesso nome ma un altro file (dimensione diversa): non lo prende, e la voce resta «non c’è più»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const doc = await documentiFinti(app);
  const { rec, close } = await scarica('contratto.pdf', { shell, openTab, testServer });
  try {
    renameSync(rec.savePath, join(doc, 'altro.bin'));
    writeFileSync(join(doc, 'Bollette', 'contratto.pdf'), 'un altro contratto');
    const res = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(res).toMatchObject({ ok: false, missing: true });
    expect(res.error).toMatch(/non c[’']è più/);
  } finally { await close(); }
});
