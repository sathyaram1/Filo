// Verifica #796 giro 1, rilievo 1: due siti sotto un suffisso nazionale a due livelli (.com.co, .com.pe, .com.gr)
// devono ricevere impronte diverse e vasi di cookie diversi; le pagine di uno stesso sito restano insieme.
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const require = createRequire(import.meta.url);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COPPIE = [['tienda.com.co', 'otra.com.co'], ['uno.com.pe', 'due.com.pe'], ['ena.com.gr', 'dio.com.gr']];
const STESSO = ['www.tienda.com.co', 'tienda.com.co'];

const PAGINA = `<!doctype html><html><body><canvas id="c" width="220" height="60"></canvas><script>
const x = document.getElementById('c').getContext('2d');
x.fillStyle = '#f60'; x.fillRect(10, 5, 120, 40); x.fillStyle = '#069'; x.font = '18px Arial';
x.fillText('Filo impronta 796', 4, 30); x.strokeStyle = 'rgba(102,204,0,0.7)'; x.arc(160, 30, 22, 0, 6.28); x.stroke();
</script></body></html>`;

test('r1 impronte: due siti sotto lo stesso suffisso nazionale a due livelli vedono rumori diversi', async () => {
  test.setTimeout(120_000);
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGINA); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const userData = cartellaTemporanea('filo-ver796-');
  const host = [...new Set([...COPPIE.flat(), ...STESSO])];
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${host.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`, '.'],
    cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const impronta = async (h) => {
      const url = `http://${h}:${port}/`;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      const fine = Date.now() + 15_000; let page = null;
      while (Date.now() < fine && !page) {
        page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
        if (!page) await new Promise((r) => setTimeout(r, 100));
      }
      if (!page) throw new Error('nessuna scheda per ' + url);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
      return page.evaluate(() => document.getElementById('c').toDataURL());
    };
    const viste = {};
    for (const h of host) viste[h] = await impronta(h);
    expect(viste[STESSO[0]], 'le pagine di uno stesso sito hanno la stessa impronta').toBe(viste[STESSO[1]]);
    const uguali = COPPIE.filter(([a, b]) => viste[a] === viste[b]).map((c) => c.join(' e '));
    expect(uguali, 'siti diversi con la stessa impronta').toEqual([]);
  } finally {
    await app.close().catch(() => {});
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('r1 cookie: in modalità Privacy due negozi sotto lo stesso suffisso nazionale non condividono il vaso', () => {
  const Cookies = require('../../../src/main/services/cookies.js');
  const uguali = COPPIE.filter(([a, b]) => Cookies.partitionForUrl(`https://${a}/`, new Set()) === Cookies.partitionForUrl(`https://${b}/`, new Set()));
  expect(uguali.map((c) => c.join(' e ')), 'siti diversi nello stesso vaso di cookie').toEqual([]);
});
