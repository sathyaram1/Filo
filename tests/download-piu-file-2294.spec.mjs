// #2294 — una pagina che fa partire più file senza un clic: il primo arriva, dal secondo Filo chiede nella cornice della
// scheda e i file aspettano fuori dalla cartella Download; la risposta vale per il sito. Le regole: tests/unit/
// scaricamentiSenzaGesto.test.mjs (la domanda) e tests/unit/filoParlaRitmo.test.mjs (il ritmo dei messaggi della home).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

// La pagina scarica da sola, senza input: `n` file, numerati da `da`, uno ogni 300 ms dopo il caricamento.
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Scarica da sola</title>
<body style="padding:40px;background:#f6efe6"><h1>Una pagina che scarica</h1><script>
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('n') || 0);
  let i = Number(q.get('da') || 1);
  const prefisso = q.get('p') || 'pezzo';
  let fatti = 0;
  const ogni = Number(q.get('ogni') || 300);
  const t = setInterval(() => {
    if (fatti++ >= n) { clearInterval(t); return; }
    const a = document.createElement('a');
    a.href = '/' + prefisso + '-' + (i++) + '.txt';
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, 300);
</script></body>`;

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = String(req.url || '').split('?')[0].split('/').pop();
    if (!nome) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA); return; }
    const corpo = Buffer.from(`file ${nome}\n`);
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': corpo.length, 'Content-Disposition': `attachment; filename="${nome}"` });
    res.end(corpo);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); },
  };
}

const voci = (shell, prefisso) => shell.evaluate(async (p) => {
  const r = await window.filoShell.downloads.list();
  return ((r && r.items) || []).filter((it) => String(it.filename || '').startsWith(p + '-'))
    .map((it) => ({ nome: it.filename, stato: it.state, chiede: it.chiede || '' }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { numeric: true }));
}, prefisso);
const nellaCartella = (dir, prefisso) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(prefisso + '-')).sort((a, b) => a.localeCompare(b, 'it', { numeric: true })) : []);
const barra = (shell) => shell.locator('#permesso-bar');

test('cinque file senza un clic: il primo arriva, gli altri aspettano la domanda; Consenti li fa arrivare e il sito non chiede più', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const page = await openTab(`${srv.base}/?n=5`);
    await expect.poll(() => voci(shell, 'pezzo').then((v) => v.length), { timeout: 20_000 }).toBe(5);
    await expect.poll(() => voci(shell, 'pezzo').then((v) => v.map((x) => x.stato)), { timeout: 10_000 })
      .toEqual(['completed', 'pending', 'pending', 'pending', 'pending']);
    expect((await voci(shell, 'pezzo')).slice(1).every((x) => x.chiede === 'piuFile')).toBe(true);
    expect(nellaCartella(dir, 'pezzo'), 'finché l\'utente non risponde gli altri non sono in Download').toEqual(['pezzo-1.txt']);

    await expect(barra(shell)).toBeVisible();
    await expect(barra(shell)).toContainText('vuole scaricare più file senza un tuo clic');
    await expect(barra(shell)).toContainText('127.0.0.1');
    await shell.screenshot({ path: `${SHOTS}/2294-domanda-piu-file.png` });

    const si = barra(shell).locator('.permesso-si');
    await expect(si).toBeEnabled({ timeout: 5_000 });
    await si.click();
    await expect.poll(() => voci(shell, 'pezzo').then((v) => v.map((x) => x.stato)), { timeout: 15_000 })
      .toEqual(['completed', 'completed', 'completed', 'completed', 'completed']);
    expect(nellaCartella(dir, 'pezzo')).toEqual(['pezzo-1.txt', 'pezzo-2.txt', 'pezzo-3.txt', 'pezzo-4.txt', 'pezzo-5.txt']);
    await expect(barra(shell)).toBeHidden();

    // Il sì resta per il sito: la stessa pagina riaperta scarica altri tre file senza domanda.
    await page.goto(`${srv.base}/?n=3&da=6`);
    await expect.poll(() => nellaCartella(dir, 'pezzo').length, { timeout: 15_000 }).toBe(8);
    await expect(barra(shell)).toBeHidden();
    const ricordate = await app.evaluate(() => {
      const rq = process.mainModule.require;
      return rq(rq('node:path').join(process.cwd(), 'src/main/services/permessiPagine.js')).righeRicordate();
    });
    expect(ricordate.some((r) => /più file senza un tuo clic: consentito/.test(r)), JSON.stringify(ricordate)).toBe(true);
  } finally {
    await srv.close();
  }
});

test('Non consentire: i file in attesa se ne vanno, la scheda ne porta il segno e il sito non scarica più da solo', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const page = await openTab(`${srv.base}/?n=4&p=spam`);
    await expect.poll(() => voci(shell, 'spam').then((v) => v.map((x) => x.stato)), { timeout: 20_000 })
      .toEqual(['completed', 'pending', 'pending', 'pending']);
    await expect(barra(shell)).toBeVisible();
    await barra(shell).locator('.permesso-no').click();
    await expect.poll(() => voci(shell, 'spam').then((v) => v.map((x) => x.nome)), { timeout: 10_000 }).toEqual(['spam-1.txt']);
    expect(nellaCartella(dir, 'spam')).toEqual(['spam-1.txt']);
    await expect(shell.locator('#tabs .segno.negato[data-parte="scaricamenti"]')).toHaveCount(1, { timeout: 5_000 });

    await page.goto(`${srv.base}/?n=3&da=5&p=spam`);
    await expect(shell.locator('#tabs .segno.negato[data-parte="scaricamenti"]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(2_000);
    expect(nellaCartella(dir, 'spam')).toEqual(['spam-1.txt']);
    expect((await voci(shell, 'spam')).map((x) => x.nome)).toEqual(['spam-1.txt']);
    await expect(barra(shell)).toBeHidden();
    await shell.screenshot({ path: `${SHOTS}/2294-segno-negato.png` });
  } finally {
    await srv.close();
  }
});

test('il ritmo dei messaggi sui download si sceglie in Preferenze, con la sua stima, e Filo lo usa subito', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const prefs = await openTab('filo://preferences/preferences.html#sec-filo-parla');
  const scelta = prefs.locator('#filoParlaDownload');
  await expect(scelta).toHaveValue('10');
  await expect(scelta.locator('option[value="10"]')).toContainText('$ all\'ora');
  await scelta.selectOption('30');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).filoParla), { timeout: 5_000 })
    .toEqual({ downloadOgniMin: 30 });
  await expect.poll(() => app.evaluate(() => {
    const rq = process.mainModule.require;
    return rq(rq('node:path').join(process.cwd(), 'src/main/services/filoParla.js'))._ritmoMs();
  }), { timeout: 5_000 }).toBe(30 * 60_000);
  await prefs.locator('#sec-filo-parla').screenshot({ path: `${SHOTS}/2294-preferenze-ritmo.png` });
});
