// Verifica #256.2, giro 1: la schermata fatta col tasto destro di Filo, tolta dalla Sicurezza, non rientra al primo «Incolla».
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE = '<!doctype html><html><body style="padding:40px;background:#f4e0c0"><p id="p" style="font-size:30px">Una pagina con del testo</p>'
  + '<div id="ce" contenteditable="true" style="margin-top:20px;min-height:80px;border:1px solid #999"></div></body></html>';

async function trova(app, host, timeout = 20000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const w = app.windows().find((p) => { try { return new URL(p.url()).hostname === host; } catch (_) { return false; } });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna scheda per ' + host);
}

test('schermata di Filo: tolta dalla Sicurezza, non rientra al primo «Incolla»', async () => {
  const userData = cartellaTemporanea('ver-256-2-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: [] }), 'utf8');
  const server = createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  const disco = () => {
    try { return (JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).clipboardHistory || []).map((e) => e.text || '[img]'); } catch (_) { return null; }
  };
  try {
    const shell = await primaFinestra(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const web = await trova(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });

    await web.locator('#p').click({ button: 'right' });
    await web.locator('.sn-menu [data-sn-icon-id="screenshot"]').first().click();
    await expect.poll(disco, { timeout: 30000 }).toEqual(['[img]']);
    await expect.poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.read()).some((v) => v.types.some((t) => t.startsWith('image/'))))).toBe(true);

    await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://security/security.html');
    const sec = await trova(app, 'security');
    await sec.locator('#sec-clip-list .sn-clip-remove').first().click();
    await expect.poll(disco).toEqual([]);

    await shell.evaluate(async (u) => {
      const s = await window.filoShell.tabs.snapshot();
      const t = s.tabs.find((x) => String(x.url || '').startsWith(u));
      if (t) await window.filoShell.tabs.activate(t.id);
    }, url);
    await web.locator('#ce').click({ button: 'right' });
    await web.locator('.sn-menu-paste-main').first().click();
    await expect(web.locator('#ce img')).toHaveCount(1);
    await web.waitForTimeout(1500);
    expect(disco(), 'la schermata tolta è rientrata al primo «Incolla»').toEqual([]);
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
