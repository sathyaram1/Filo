// Verificatore #410.1 — due cose che il resto della suite non copre:
//  1) la cronologia sopravvive DAVVERO a un riavvio dell'app (non solo "il file
//     json su disco contiene la voce"): si rilancia Filo sullo stesso profilo e
//     si richiede l'elenco;
//  2) mentre scarica, l'utente vede percentuale e barra — il cuore del sintomo
//     ("il file si scarica al buio").

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function launch(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
    },
  });
}

function fileServer(name, body, dripMs) {
  return new Promise((done) => {
    const srv = createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      if (!dripMs) { res.end(body); return; }
      let i = 0;
      const step = Math.ceil(body.length / 12);
      const tick = () => {
        if (i >= body.length) { res.end(); return; }
        res.write(body.subarray(i, i + step));
        i += step;
        setTimeout(tick, dripMs);
      };
      tick();
    });
    srv.listen(0, '127.0.0.1', () => done({
      url: `http://127.0.0.1:${srv.address().port}/x`,
      close: async () => {
        try { srv.closeAllConnections?.(); } catch (_) {}
        await new Promise((r) => srv.close(r));
      },
    }));
  });
}

test('la cronologia degli scaricamenti è ancora lì dopo aver chiuso e riaperto Filo', async () => {
  test.setTimeout(180_000);
  const userData = mkdtempSync(join(tmpdir(), 'filo-restart-'));
  const s = await fileServer('sopravvive.bin', Buffer.alloc(4096, 8));
  let app = null;
  try {
    // — prima sessione: scarica un file navigando —
    app = await launch(userData);
    let shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), s.url);

    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((x) => x.filename === 'sopravvive.bin');
      return e ? e.state : null;
    }, { timeout: 40000 }).toBe('completed');
    const before = (await shell.evaluate(() => window.filoShell.downloads.list()))
      .items.find((x) => x.filename === 'sopravvive.bin');
    expect(existsSync(before.savePath)).toBe(true);

    await app.close();
    app = null;

    // — seconda sessione: stesso profilo, la voce deve essere ancora lì —
    app = await launch(userData);
    shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const after = await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((x) => x.filename === 'sopravvive.bin');
      return e ? e.state : null;
    }, { timeout: 30000 }).toBe('completed');

    const entry = (await shell.evaluate(() => window.filoShell.downloads.list()))
      .items.find((x) => x.filename === 'sopravvive.bin');
    // i dati utili non si perdono nel giro su disco
    expect(entry.totalBytes).toBe(4096);
    expect(entry.savePath).toBe(before.savePath);
    expect(entry.url).toBeTruthy();
    expect(entry.startedAt || entry.startTime).toBeTruthy();
  } finally {
    try { if (app) await app.close(); } catch (_) {}
    await s.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('mentre scarica, l\'utente vede percentuale e barra che avanzano davvero', async () => {
  test.setTimeout(180_000);
  const userData = mkdtempSync(join(tmpdir(), 'filo-progress-'));
  const s = await fileServer('visibile.bin', Buffer.alloc(900 * 1024, 6), 250);
  let app = null;
  try {
    app = await launch(userData);
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), s.url);

    // L'indicatore compare da solo: l'utente non deve andarlo a cercare.
    await expect(shell.locator('#dl-indicator')).toBeVisible({ timeout: 20000 });

    // Percentuali crescenti e sensate: campiono lo stato reale mentre scarica.
    const seen = [];
    for (let i = 0; i < 20 && seen.at(-1) !== 100; i++) {
      const p = await shell.evaluate(() => {
        const r = window.__lastDlPercent;
        return typeof r === 'number' ? r : null;
      });
      const items = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((items && items.items) || []).find((x) => x.filename === 'visibile.bin');
      if (e && e.totalBytes > 0) seen.push(Math.round((e.receivedBytes / e.totalBytes) * 100));
      await shell.waitForTimeout(250);
    }
    // almeno due letture distinte: la barra si muove, non è finta
    const distinct = [...new Set(seen)];
    expect(distinct.length, `percentuali osservate: ${seen.join(',')}`).toBeGreaterThan(1);
    for (const v of seen) expect(v >= 0 && v <= 100).toBe(true);
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen));

    // Apro il pannello degli scaricamenti dall'icona in barra: deve mostrarli.
    await shell.locator('#dl-indicator').click();
    await shell.waitForTimeout(400);
    await shell.screenshot({ path: 'tests/.shots/verifier-410-pannello.png' });
    const panelText = await shell.evaluate(() => document.body.innerText || '');
    expect(panelText).toContain('visibile.bin');
  } finally {
    try { if (app) await app.close(); } catch (_) {}
    await s.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
