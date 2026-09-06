import { test, expect, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIRM_HOST } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

// Feedback #256: nella cronologia degli appunti (freccia accanto a "Incolla")
// l'utente poteva solo incollare le voci, non rimuoverne una singola né svuotare
// la cronologia — un problema di privacy (una password copiata resta lì e non c'è
// modo di toglierla se non perdendo tutto, e nemmeno quello era accessibile).
//
// Questo spec ASSERISCE IL SUCCESSO della feature:
//  - ogni voce ha un "×" per rimuoverla;
//  - cliccando "×" la voce sparisce dalla lista E resta rimossa (ri-aprendo il
//    sotto-menu, che rilegge la cronologia salvata, non ricompare);
//  - in fondo c'è "Svuota cronologia" che, essendo distruttivo, chiede conferma
//    prima di agire.
// Pre-fix il sotto-menu non aveva alcun "×" né "Svuota cronologia": rossi.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findTabPage(app, hostname, timeout = 10000) {
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

async function openHistorySubmenu(page) {
  await page.locator('#ta').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const arrow = page.locator('.sn-menu-paste-arrow');
  await expect(arrow).toBeVisible();
  await arrow.click();
  const sub = page.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  return sub;
}

const PAGE_HTML = `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`;

async function launchWithHistory(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

test('paste history: rimuovi una singola voce e svuota tutta la cronologia', async ({ testServer }) => {
  const SENSITIVE = 'password-super-segreta-9F3';
  const history = [
    { type: 'text', text: SENSITIVE, ts: Date.now() - 3000 },
    { type: 'text', text: 'secondo testo generico', ts: Date.now() - 2000 },
    { type: 'text', text: 'terzo testo normale', ts: Date.now() - 1000 },
  ];
  const userData = cartellaTemporanea('filo-clip-rm-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(
    `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`,
  );
  const host = new URL(url).hostname;

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page, 'la pagina di test deve aprirsi').toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    // (1) Apri il sotto-menu: 3 voci, ciascuna con il proprio "×".
    let sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);
    await expect(sub.locator('.sn-menu-history-remove')).toHaveCount(3);

    // (2) Rimuovi la voce sensibile cliccando il suo "×".
    const sensitiveRow = sub.locator('.sn-menu-history-item', { hasText: SENSITIVE });
    await expect(sensitiveRow).toHaveCount(1);
    await sensitiveRow.locator('.sn-menu-history-remove').click();

    // Sparisce subito dalla lista, le altre restano.
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);
    await expect(sub).not.toContainText(SENSITIVE);

    // (3) Persistenza: chiudi il menu e riaprilo — la cronologia riletta dallo
    // storage NON contiene più la voce sensibile (la rimozione è stata salvata).
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
    sub = await openHistorySubmenu(page);
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);
    await expect(sub).not.toContainText(SENSITIVE);

    // (4) "Svuota cronologia" è presente e, essendo distruttivo, chiede conferma.
    const clearBtn = sub.locator('.sn-menu-history-clear-btn');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    // Compare il dialogo di conferma di Filo (host visibile nel DOM del documento).
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();

    await page.screenshot({ path: 'tests/.shots/clipboard-history-remove.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// Seconda metà del #256, scoperta rileggendo il flusso reale: la cronologia
// viene letta UNA volta sola, quando si apre il menu del tasto destro, e il
// sotto-menu si riapre da quella stessa lista ogni volta che ci passi sopra col
// mouse. Rimuovendo una voce spariva solo la riga a schermo: bastava uscire col
// mouse (il sotto-menu si richiude da solo) e rientrare sulla freccetta perché
// la voce appena rimossa ricomparisse — cancellata davvero sul disco, ma
// ancora lì sotto gli occhi. Su una password è la bugia peggiore possibile.
//
// Questo spec ASSERISCE IL SUCCESSO: dopo la rimozione, riaprendo il sotto-menu
// SENZA chiudere il menu del tasto destro, la voce non c'è più.
// Pre-fix: rosso (la voce ricompare e le righe tornano 3).
test('paste history: la voce rimossa non ricompare riaprendo la cronologia nello stesso menu', async ({ testServer }) => {
  const SENSITIVE = 'password-super-segreta-9F3';
  const history = [
    { type: 'text', text: SENSITIVE, ts: Date.now() - 3000 },
    { type: 'text', text: 'secondo testo generico', ts: Date.now() - 2000 },
    { type: 'text', text: 'terzo testo normale', ts: Date.now() - 1000 },
  ];
  const userData = cartellaTemporanea('filo-clip-rm2-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: history }), 'utf8');

  const url = testServer.html(PAGE_HTML);
  const host = new URL(url).hostname;
  const app = await launchWithHistory(userData);

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const page = await findTabPage(app, host);
    expect(page, 'la pagina di test deve aprirsi').toBeTruthy();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

    // Apri il menu e la cronologia passando col mouse sulla freccetta (senza
    // click: è così che il sotto-menu resta libero di richiudersi da solo).
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    const arrow = page.locator('.sn-menu-paste-arrow');
    await arrow.hover();
    const sub = page.locator('.sn-menu-history-sub');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(3);

    // Rimuovi la voce sensibile.
    await sub.locator('.sn-menu-history-item', { hasText: SENSITIVE })
      .locator('.sn-menu-history-remove').click();
    await expect(sub.locator('.sn-menu-history-item')).toHaveCount(2);

    // Porta il mouse lontano: il sotto-menu si richiude da solo, il menu del
    // tasto destro resta aperto (si chiude solo con un click o Esc).
    await page.mouse.move(4, 4);
    await expect(page.locator('.sn-menu-history-sub')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.sn-menu')).toBeVisible();

    // Riapri la cronologia dalla stessa freccetta: la voce rimossa NON torna.
    await arrow.hover();
    const sub2 = page.locator('.sn-menu-history-sub');
    await expect(sub2).toBeVisible();
    await expect(sub2).not.toContainText(SENSITIVE);
    await expect(sub2.locator('.sn-menu-history-item')).toHaveCount(2);

    await page.screenshot({ path: 'tests/.shots/clipboard-history-remove-reopen.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
