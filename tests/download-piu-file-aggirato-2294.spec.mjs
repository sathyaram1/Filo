// #2294 — il freno sui file scaricati senza un clic non si aggira: un clic vale per un file, e una pagina che salta fra i
// sottodomini dello stesso sito non riparte da capo. Il ritmo dei messaggi della home scelto in Preferenze resta dopo un
// riavvio. Le regole: tests/unit/scaricamentiSenzaGesto.test.mjs.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = ['a', 'b', 'c', 'd'].map((x) => `${x}.scarica.test`);
test.use({ hostInPiu: [...HOST, '*.salta.test'] });

const DATI = Buffer.from('dati di prova '.repeat(50));

// `/salta?n=K` scarica il file K da sola e poi passa, da sola, al sottodominio dopo; `/clic` scarica sei file dopo un clic.
async function apriServer() {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/file-')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': DATI.length, 'Content-Disposition': `attachment; filename="${u.pathname.slice(1)}"` });
      res.end(DATI);
      return;
    }
    const n = Number(u.searchParams.get('n') || 0);
    const porta = srv.address().port;
    const scarica = (nome) => `const a = document.createElement('a'); a.href = '/${nome}'; a.download = ''; document.body.appendChild(a); a.click();`;
    let corpo;
    if (u.pathname === '/lontano') {
      // Come `/salta`, ma su s0.salta.test, s1.salta.test… fino a `fino`, un salto ogni `passo` ms.
      const fino = Number(u.searchParams.get('fino') || 0);
      const passo = Number(u.searchParams.get('passo') || 1200);
      const dopo = n < fino ? `http://s${n + 1}.salta.test:${porta}/lontano?n=${n + 1}&fino=${fino}&passo=${passo}` : '';
      corpo = `<h1>Pagina ${n}</h1><script>
        setTimeout(() => { ${scarica(`file-lontano-${n}.bin`)} }, 150);
        ${dopo ? `setTimeout(() => { location.href = ${JSON.stringify(dopo)}; }, ${passo});` : ''}
      </script>`;
    } else if (u.pathname === '/salta') {
      const dopo = n + 1 < HOST.length ? `http://${HOST[n + 1]}:${porta}/salta?n=${n + 1}` : '';
      corpo = `<h1>Pagina ${n}</h1><script>
        setTimeout(() => { ${scarica(`file-salto-${n}.bin`)} }, 300);
        ${dopo ? `setTimeout(() => { location.href = ${JSON.stringify(dopo)}; }, 1500);` : ''}
      </script>`;
    } else {
      corpo = `<button id="via" style="font-size:30px">Scarica il modulo</button><script>
        document.getElementById('via').onclick = () => {
          for (let i = 0; i < 6; i++) setTimeout(() => { const a = document.createElement('a'); a.href = '/file-raffica-' + i + '.bin'; a.download = ''; document.body.appendChild(a); a.click(); }, 200 + i * 400);
        };
      </script>`;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Scarica</title></head><body>${corpo}</body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const arrivati = (dir, segno) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(segno)) : []);
const inAttesa = (shell, segno) => shell.evaluate(async (s) => {
  const r = await window.filoShell.downloads.list();
  return ((r && r.items) || []).filter((it) => String(it.filename || '').includes(s) && it.state === 'pending').length;
}, segno);

test('un clic solo sulla pagina fa arrivare un file: gli altri cinque che la pagina scarica da sé aspettano la domanda', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await openTab(`http://${HOST[0]}:${srv.porta}/clic`);
    await page.locator('#via').click();
    await expect(shell.locator('#permesso-bar')).toContainText('vuole scaricare più file', { timeout: 15_000 });
    await expect.poll(() => inAttesa(shell, 'raffica'), { timeout: 15_000 }).toBe(5);
    expect(arrivati(dir, 'raffica')).toEqual(['file-raffica-0.bin']);
  } finally {
    await srv.close();
  }
});

test('una pagina che salta da un sottodominio all\'altro dello stesso sito, senza clic: arriva il primo file, gli altri aspettano', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    await openTab(`http://${HOST[0]}:${srv.porta}/salta?n=0`);
    await expect.poll(() => inAttesa(shell, 'salto'), { timeout: 30_000 }).toBe(HOST.length - 1);
    expect(arrivati(dir, 'salto')).toEqual(['file-salto-0.bin']);
  } finally {
    await srv.close();
  }
});

test('il no alla domanda vale per tutto il sito: toglie i file in attesa di ogni sottodominio, e i salti dopo non scaricano né chiedono', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await openTab(`http://s0.salta.test:${srv.porta}/lontano?n=0&fino=5`);
    await expect.poll(() => inAttesa(shell, 'lontano'), { timeout: 30_000 }).toBe(5);
    const barra = shell.locator('#permesso-bar');
    await expect(barra).toContainText('vuole scaricare più file', { timeout: 10_000 });
    await barra.locator('.permesso-no').click();
    await expect.poll(() => inAttesa(shell, 'lontano'), { timeout: 10_000 }).toBe(0);
    await page.goto(`http://s6.salta.test:${srv.porta}/lontano?n=6&fino=8`);
    await expect(shell.locator('#tabs .segno.negato[data-parte="scaricamenti"]')).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(4_000);
    expect(await inAttesa(shell, 'lontano')).toBe(0);
    await expect(barra).toBeHidden();
    expect(arrivati(dir, 'lontano')).toEqual(['file-lontano-0.bin']);
  } finally {
    await srv.close();
  }
});

test('il tetto dei cento file in attesa è del sito: una pagina che salta fra 110 sottodomini non lo supera', async ({ shell, openTab }) => {
  test.setTimeout(180_000);
  const srv = await apriServer();
  try {
    await openTab(`http://s0.salta.test:${srv.porta}/lontano?n=0&fino=110&passo=450`);
    // Il centesimo file in attesa arriva, poi la riga più nuova conta quelli fermati.
    await expect.poll(() => inAttesa(shell, 'lontano'), { timeout: 120_000, intervals: [1_000] }).toBe(100);
    await expect.poll(() => shell.evaluate(async () => {
      const r = await window.filoShell.downloads.list();
      return ((r && r.items) || []).reduce((n, it) => n + (it.fermati || 0), 0);
    }), { timeout: 60_000, intervals: [1_000] }).toBeGreaterThan(0);
    expect(await inAttesa(shell, 'lontano')).toBe(100);
  } finally {
    await srv.close();
  }
});

test('il ritmo dei messaggi sui download scelto in Preferenze vale anche dopo aver riaperto Filo', async () => {
  test.setTimeout(60_000);
  const userData = cartellaTemporanea('filo-ritmo-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { filoParla: { downloadOgniMin: 30 } } }), 'utf8');
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  try {
    await expect.poll(() => app.evaluate(() => {
      const rq = process.mainModule.require;
      return rq(rq('node:path').join(process.cwd(), 'src/main/services/filoParla.js'))._ritmoMs();
    }), { timeout: 20_000 }).toBe(30 * 60_000);
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
