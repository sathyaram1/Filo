// Feedback #256, giro 4. La cronologia degli appunti si può ripulire da due
// parti (la freccia "Incolla" del tasto destro e Impostazioni → Sicurezza), e
// da tutte e due si cancella per sempre. Quindi la lista non deve MAI muoversi
// sotto la mano di chi sta cliccando: togliere una riga e ricompattare subito
// faceva salire di una posizione tutte quelle sotto, e il secondo clic di un
// doppio clic portava via anche la voce vicina.
//
// Questi spec asseriscono il SUCCESSO dal punto di vista di chi usa Filo:
//  - un doppio clic toglie UNA voce, quella che hai preso di mira;
//  - una copia fatta in un'altra scheda non sposta le righe mentre stai mirando;
//  - due immagini copiate diverse si distinguono anche nel menu;
//  - la conferma dello svuotamento dice quante voci spariscono, ricerca inclusa.
// Senza le correzioni sono rossi (ne spariscono due, si cancella il vicino, il
// menu mostra due volte "Immagine", la conferma non dice nessun numero).

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { CONFIRM_HOST, confirmText, clickConfirm } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEC_URL = 'filo://security/security.html';
const PAGE = '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="40"></textarea></body></html>';
// Due PNG 32x32 diversi (uno rosso, uno blu): servono a vedere che nel menu due
// immagini copiate NON si leggono uguali.
const ROSSO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJ0lEQVR42u3NMQEAAAgDoC251a3gLwSgcqfTaDQajUaj0Wg0Go3mYQGvxAV/1jRlpQAAAABJRU5ErkJggg==';
const BLU = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR42u3NMQEAAAgDoJvc6BpjDwSgcqfTaDQajUaj0Wg0Go1G8/ABsdwFf6Vd7ncAAAAASUVORK5CYII=';

async function findTabPage(app, hostname, timeout = 15000) {
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

function conCronologia(prefix, items, extra) {
  const userData = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: items, ...extra }), 'utf8');
  return userData;
}

const otto = () => Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 100 - i }));

async function serviPagina() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/p`, close: () => server.close() };
}

// ── pagina Sicurezza ────────────────────────────────────────────────────────

test('Sicurezza: un doppio clic su "Rimuovi" toglie UNA voce, non due', async () => {
  const userData = conCronologia('clip-dbl-sec-', otto());
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(8);

    // Due clic nello stesso punto, con la cadenza di una mano umana.
    await rows.nth(2).locator('.sn-clip-remove').hover();
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(200);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(1000);

    // Sul disco è sparita solo "voce-2": la vicina è ancora lì.
    const testi = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    expect(testi).toEqual(['voce-0', 'voce-1', 'voce-3', 'voce-4', 'voce-5', 'voce-6', 'voce-7']);

    // A schermo la voce tolta resta al suo posto, barrata: è quello che tiene
    // ferme le righe sotto. Appena il puntatore esce, la lista si ricompone.
    await expect(rows.nth(2)).toHaveClass(/sn-clip-gone/);
    await page.mouse.move(5, 5);
    await expect(rows).toHaveCount(7);
    await expect(page.locator('#sec-clip-list')).not.toContainText('voce-2');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: una copia in un\'altra scheda non sposta la riga che stai mirando', async () => {
  const userData = conCronologia('clip-shift-sec-', otto());
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    const rows = page.locator('#sec-clip-list .sn-clip-item');
    await expect(rows).toHaveCount(8);

    // L'utente ha la mira sul "Rimuovi" di voce-3.
    await rows.nth(3).locator('.sn-clip-remove').hover();
    // Nel frattempo copia qualcosa altrove: la voce nuova entra in cima.
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'text', text: 'appena-copiata-XYZ' },
    }));
    await page.waitForTimeout(600);
    // Le righe NON si sono spostate: sono ancora otto, e la nuova aspetta fuori.
    await expect(rows).toHaveCount(8);
    await expect(page.locator('#sec-clip-pending')).toBeVisible();
    // Preme senza spostare il mouse: sparisce la voce che aveva puntato.
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(1000);
    const testi = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
      return (r.items || []).map((x) => x.text);
    });
    expect(testi).not.toContain('voce-3');
    expect(testi).toContain('voce-2');

    // Uscita dal riquadro: la voce copiata nel frattempo compare, l'avviso va via.
    await page.mouse.move(5, 5);
    await expect(page.locator('#sec-clip-list')).toContainText('appena-copiata-XYZ');
    await expect(page.locator('#sec-clip-pending')).toBeHidden();
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: la conferma dello svuotamento dice quante voci spariscono, ricerca compresa', async () => {
  const items = [
    { type: 'text', text: 'password-Hunter2', ts: 100 },
    ...Array.from({ length: 30 }, (_, i) => ({ type: 'text', text: `nota di lavoro ${i}`, ts: 50 - i })),
  ];
  const userData = conCronologia('clip-conf-sec-', items);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(31);

    await page.fill('#sec-clip-search', 'password');
    await expect(page.locator('#sec-clip-list .sn-clip-item').locator('visible=true')).toHaveCount(1);
    await page.click('#sec-clip-clear');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();
    const testo = await confirmText(page);
    expect(testo).toContain('31');
    expect(testo).toMatch(/ricerca/i);
    await clickConfirm(page, 'cancel');
    await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(31);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Sicurezza: cliccare una voce la rimette negli appunti', async () => {
  const userData = conCronologia('clip-copy-sec-', [{ type: 'text', text: 'testo-da-riprendere', ts: 1 }]);
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), SEC_URL);
    const page = await findTabPage(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#sec-clip-list .sn-clip-copy').first().click();
    await expect(page.locator('#sec-clip-hint')).toBeVisible();
    const negliAppunti = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(negliAppunti).toBe('testo-da-riprendere');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// ── menu "Incolla" del tasto destro ─────────────────────────────────────────

test('menu Incolla: un doppio clic sulla × toglie UNA voce, e due immagini si distinguono', async () => {
  const items = [
    { type: 'image', dataUrl: ROSSO, ts: 5 },
    { type: 'image', dataUrl: BLU, ts: 4 },
    ...Array.from({ length: 6 }, (_, i) => ({ type: 'text', text: `voce-${i}`, ts: 3 - i })),
  ];
  const userData = conCronologia('clip-dbl-menu-', items);
  const srv = await serviPagina();
  const app = await avvia(userData);
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url);
    const web = await findTabPage(app, '127.0.0.1');
    await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10000 });
    await web.locator('#ta').click({ button: 'right' });
    await expect(web.locator('.sn-menu')).toBeVisible();
    await web.locator('.sn-menu-paste-arrow').click();
    const sub = web.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    const righe = sub.locator('.sn-menu-history-item');
    await expect(righe).toHaveCount(8);

    // Le due immagini si vedono: una miniatura per ciascuna, con dati diversi.
    const sorgenti = await sub.locator('.sn-menu-history-thumb').evaluateAll((n) => n.map((x) => x.getAttribute('src')));
    expect(sorgenti).toHaveLength(2);
    expect(sorgenti[0]).not.toBe(sorgenti[1]);

    // Doppio clic sulla "×" della terza riga (voce-0): ne sparisce una sola.
    await righe.nth(2).locator('.sn-menu-history-remove').hover();
    await web.mouse.down(); await web.mouse.up();
    await web.waitForTimeout(200);
    await web.mouse.down(); await web.mouse.up();
    await web.waitForTimeout(1000);
    await expect(righe.nth(2)).toHaveClass(/sn-menu-history-gone/);
    await expect(righe).toHaveCount(8); // niente si è spostato
    await expect(sub.locator('.sn-menu-history-item:not(.sn-menu-history-gone)')).toHaveCount(7);

    // Riaperto il menu, sul disco è sparita solo "voce-0".
    await web.keyboard.press('Escape');
    await web.locator('#ta').click({ button: 'right' });
    await web.locator('.sn-menu-paste-arrow').click();
    const sub2 = web.locator('.sn-menu-history-sub');
    await expect(sub2).toBeVisible();
    await expect(sub2.locator('.sn-menu-history-item')).toHaveCount(7);
    await expect(sub2).not.toContainText('voce-0');
    await expect(sub2).toContainText('voce-1');
  } finally {
    srv.close();
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
