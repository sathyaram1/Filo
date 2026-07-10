// PROBE prober: esplorazione edge — click sinistro su chip archivio + chat senza chiave.
// Non è (ancora) un test di regressione: osserva e cattura lo stato reale.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Probe</title>
  <meta name="theme-color" content="rgb(40, 120, 200)">
</head><body style="margin:0"><div style="height:1200px;background:#fff">probe</div></body></html>`;

test('PROBE: click sinistro su una chip archiviata — cosa succede?', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Probe' });
  await expect(row).toBeVisible({ timeout: 8_000 });

  // 1) click sinistro sulla chip
  await row.click();
  await archive.waitForTimeout(800);
  const menuVisibleAfterClick = await archive.locator('.arc-ctxmenu').isVisible().catch(() => false);
  const tabsAfterClick = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.map((t) => t.url);
  });
  console.log('[probe] menu visibile dopo click sinistro:', menuVisibleAfterClick);
  console.log('[probe] tab aperte dopo click sinistro:', JSON.stringify(tabsAfterClick));

  // 2) doppio click
  await row.dblclick();
  await archive.waitForTimeout(800);
  const tabsAfterDbl = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.map((t) => t.url);
  });
  console.log('[probe] tab aperte dopo doppio click:', JSON.stringify(tabsAfterDbl));

  // 3) Invio da tastiera (parità dichiarata col mouse)
  await row.focus();
  await archive.keyboard.press('Enter');
  await archive.waitForTimeout(400);
  const menuVisibleAfterEnter = await archive.locator('.arc-ctxmenu').isVisible().catch(() => false);
  console.log('[probe] menu visibile dopo Invio:', menuVisibleAfterEnter);

  await archive.screenshot({ path: 'tests/.shots/audit-archive-click.png' });
});

test('PROBE: chat della nuova scheda senza chiave API — che feedback riceve l\'utente?', async ({ app, shell }) => {
  // La newtab è la prima tab già aperta al boot.
  const deadline = Date.now() + 10_000;
  let dash = null;
  while (Date.now() < deadline && !dash) {
    dash = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (!dash) await new Promise((r) => setTimeout(r, 150));
  }
  expect(dash).toBeTruthy();
  await dash.waitForLoadState('domcontentloaded');

  await dash.locator('#input').fill('ciao, cosa puoi fare?');
  await dash.locator('#sendBtn').click();

  // Aspetta la risposta (bolla di Filo) o comunque un cambiamento.
  await dash.waitForTimeout(6000);
  const bubbles = await dash.evaluate(() =>
    [...document.querySelectorAll('.dash-bubble, [class*=bubble]')].map((b) => ({
      cls: b.className, text: (b.textContent || '').trim().slice(0, 300),
    })));
  console.log('[probe] bolle dopo invio senza chiave:', JSON.stringify(bubbles, null, 2));
  await dash.screenshot({ path: 'tests/.shots/audit-nokey-chat.png' });
});
