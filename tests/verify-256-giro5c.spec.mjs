// Verifica avversariale #256, giro 5 — terza tornata: quanto dura una voce
// tolta, e cosa succede quando in cronologia finiscono due voci che per Filo
// sono la stessa cosa (è lo stato che lascia «Importa dati»).

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea><p id="p">password-segretissima</p></body></html>';

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

function conStorage(prefix, obj) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify(obj), 'utf8');
  return userData;
}

function suDisco(userData) {
  try {
    const j = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    return (j.clipboardHistory || []).map((e) => e.text || '[img]');
  } catch (_) { return null; }
}

// U1 — la voce tolta torna al primo «Incolla»?
test('U1 — tolta la password dalla pagina della Sicurezza, incollarla la rimette in cronologia', async () => {
  const userData = conStorage('g5c-ritorno-', { clipboardHistory: [] });
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

    // La password è negli appunti veri di sistema, come dopo un «copia».
    await app.evaluate(({ clipboard }) => clipboard.writeText('password-segretissima'));

    // Primo «Incolla» dal menu del tasto destro: la password entra in cronologia.
    await web.locator('#ta').click({ button: 'right' });
    await web.waitForTimeout(300);
    await web.locator('.sn-menu-paste-main').first().click();
    await web.waitForTimeout(1200);
    console.log('[U1] dopo il primo incolla:', JSON.stringify(suDisco(userData)));
    expect(suDisco(userData), 'la password è finita in cronologia').toContain('password-segretissima');

    // L'utente se ne accorge e la toglie da Impostazioni → Sicurezza.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const sec = await findTabPage(app, 'security');
    await sec.waitForLoadState('domcontentloaded');
    await sec.locator('#sec-clip-list .sn-clip-item').first().waitFor({ timeout: 10000 });
    await sec.locator('#sec-clip-list .sn-clip-remove').first().click();
    await sec.waitForTimeout(700);
    console.log('[U1] dopo la rimozione:', JSON.stringify(suDisco(userData)));
    expect(suDisco(userData), 'la voce se n\'è andata').toEqual([]);

    // Poi incolla la password nel modulo di accesso, che è perché l'aveva copiata.
    await web.locator('#ta').click({ button: 'right' });
    await web.waitForTimeout(300);
    await web.locator('.sn-menu-paste-main').first().click();
    await web.waitForTimeout(1200);
    console.log('[U1] dopo il secondo incolla:', JSON.stringify(suDisco(userData)));
    console.log('[U1] testo nel campo:', JSON.stringify(await web.locator('#ta').inputValue()));
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// U2 — due voci che per Filo sono la stessa (differiscono solo per spazi): è lo
// stato che «Importa dati» può lasciare, perché l'unione confronta le voci per
// intero (testo + istante) mentre la rimozione le riconosce a spazi compattati.
test('U2 — due voci gemelle: toglierne una nel menu «Incolla» lascia a schermo la gemella già sparita', async () => {
  const userData = conStorage('g5c-gemelle-', {
    clipboardHistory: [
      { type: 'text', text: 'password-segreta', ts: 200 },
      { type: 'text', text: 'nota qualunque', ts: 150 },
      { type: 'text', text: 'password-segreta ', ts: 100 },
    ],
  });
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

    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    await expect(web.locator('.sn-menu-history-sub')).toBeVisible();
    const prima = await web.evaluate(() => [...document.querySelectorAll('.sn-menu-history-item')].map((r) => ({
      t: r.querySelector('.sn-menu-label').textContent,
      tolta: r.classList.contains('sn-menu-history-gone'),
    })));
    console.log('[U2] menu prima:', JSON.stringify(prima));

    await web.locator('.sn-menu-history-item').first().locator('.sn-menu-history-remove').click();
    await web.waitForTimeout(600);
    const dopo = await web.evaluate(() => [...document.querySelectorAll('.sn-menu-history-item')].map((r) => ({
      t: r.querySelector('.sn-menu-label').textContent,
      tolta: r.classList.contains('sn-menu-history-gone'),
      pasteDisabled: r.querySelector('.sn-menu-history-paste').disabled,
    })));
    console.log('[U2] menu dopo aver tolto la prima:', JSON.stringify(dopo));
    console.log('[U2] su disco:', JSON.stringify(suDisco(userData)));

    // La gemella è ancora a schermo, viva: cliccarla la rimette in cronologia.
    const viva = web.locator('.sn-menu-history-item:not(.sn-menu-history-gone)').filter({ hasText: 'password' });
    const quante = await viva.count();
    console.log('[U2] gemelle ancora vive a schermo:', quante);
    if (quante > 0) {
      await viva.first().locator('.sn-menu-history-paste').click();
      await web.waitForTimeout(1000);
      console.log('[U2] su disco dopo averla cliccata:', JSON.stringify(suDisco(userData)));
      console.log('[U2] testo incollato:', JSON.stringify(await web.locator('#ta').inputValue()));
    }
  } finally {
    server.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// U3 — le stesse gemelle nella pagina della Sicurezza.
test('U3 — due voci gemelle nella pagina della Sicurezza: cosa porta via un «Rimuovi»', async () => {
  const userData = conStorage('g5c-gemelle-sec-', {
    clipboardHistory: [
      { type: 'text', text: 'password-segreta', ts: 200 },
      { type: 'text', text: 'nota qualunque', ts: 150 },
      { type: 'text', text: 'password-segreta ', ts: 100 },
    ],
  });
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const sec = await findTabPage(app, 'security');
    await sec.waitForLoadState('domcontentloaded');
    await sec.locator('#sec-clip-list .sn-clip-item').first().waitFor({ timeout: 10000 });
    const prima = await sec.evaluate(() => [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].map((r) => r.querySelector('.sn-clip-text').textContent));
    console.log('[U3] pagina prima:', JSON.stringify(prima));
    await sec.locator('#sec-clip-list .sn-clip-remove').first().click();
    await sec.waitForTimeout(700);
    const dopo = await sec.evaluate(() => ({
      righe: [...document.querySelectorAll('#sec-clip-list .sn-clip-item')].map((r) => ({
        t: r.querySelector('.sn-clip-text').textContent,
        tolta: r.classList.contains('sn-clip-gone'),
      })),
      avviso: document.getElementById('sec-clip-hint').textContent,
    }));
    console.log('[U3] pagina dopo:', JSON.stringify(dopo));
    console.log('[U3] su disco:', JSON.stringify(suDisco(userData)));
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
