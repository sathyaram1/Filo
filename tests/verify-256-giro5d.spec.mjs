// Verifica avversariale #256, giro 5 — quarta tornata: la cronologia si
// riempie da sola anche dopo che l'utente l'ha ripulita, e non c'è modo di
// dirle di smettere.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px">'
  + '<form><input id="user" type="text" placeholder="utente"><input id="pw" type="password" placeholder="password"></form>'
  + '</body></html>';

async function findTabPage(app, hostname, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => {
      try { return new URL(p.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function avvia(userData) {
  return electron.launch({
    args: ['.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

function suDisco(userData) {
  try {
    const j = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    return (j.clipboardHistory || []).map((e) => e.text || '[img]');
  } catch (_) { return null; }
}

// V1 — incollare in un campo PASSWORD mette la password in cronologia.
test('V1 — incollata in un campo password, la password finisce in cronologia in chiaro', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'g5d-pw-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: [] }), 'utf8');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/p`;
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20000 });

    await app.evaluate(({ clipboard }) => clipboard.writeText('Tr0ubad0ur&3-la-mia-password'));
    await web.locator('#pw').click({ button: 'right' });
    await web.waitForTimeout(300);
    await web.locator('.sn-menu-paste-main').first().click();
    await web.waitForTimeout(1200);
    console.log('[V1] cronologia dopo aver incollato nel campo password:', JSON.stringify(suDisco(userData)));
    console.log('[V1] campo password:', JSON.stringify(await web.locator('#pw').inputValue()));

    // Il file su disco è leggibile in chiaro da qualsiasi programma dell'utente.
    const grezzo = readFileSync(join(userData, 'storage.json'), 'utf8');
    console.log('[V1] la password compare in chiaro nel file di Filo:', grezzo.includes('Tr0ubad0ur&3-la-mia-password'));

    // Esiste un interruttore per non tenerla?
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const sec = await findTabPage(app, 'security');
    await sec.waitForLoadState('domcontentloaded');
    await sec.waitForTimeout(800);
    const controlli = await sec.evaluate(() => {
      const box = document.getElementById('sec-clipboard');
      return {
        interruttori: [...box.querySelectorAll('input[type=checkbox], input[type=radio], select')].length,
        bottoni: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t, i, a) => a.indexOf(t) === i),
        testo: box.querySelector('#sec-clip-desc').textContent,
      };
    });
    console.log('[V1] controlli della sezione:', JSON.stringify(controlli));
    expect(controlli.interruttori, 'nessun interruttore per smettere di tenere la cronologia').toBe(0);
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
