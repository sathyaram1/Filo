// Archivio tab — parità mouse/tastiera sulla chip di una scheda archiviata.
//
// La chip ha role=button e ne ha l'aspetto (hover evidenziato). Deve rispondere
// come un bottone:
//   - click sinistro / Invio / Spazio  → azione primaria "Riapri" (la scheda
//     torna aperta), come le card di "Aperti per dopo";
//   - tasto destro / Shift+F10         → menu contestuale Riapri/Elimina.
//
// Prima del fix il click sinistro era inerte (nessuna riapertura, nessun menu):
// questi assert diventerebbero rossi. Asseriscono il SUCCESSO (la scheda si
// riapre davvero), non l'assenza di un errore.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Chip Click</title></head>
<body style="margin:0"><div style="height:600px">contenuto</div></body></html>`;

async function archiveOneTab({ shell, openTab, testServer }) {
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Chip Click' });
  await expect(row).toBeVisible({ timeout: 8_000 });
  return { archive, row };
}

async function reopenedHost(shell) {
  const snap = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => t.url);
  });
  return snap.some((u) => /127\.0\.0\.1/.test(u || ''));
}

test('archivio: click sinistro sulla chip riapre la scheda', async ({ shell, openTab, testServer }) => {
  const { archive, row } = await archiveOneTab({ shell, openTab, testServer });

  await row.click();
  await expect.poll(() => reopenedHost(shell), { timeout: 8_000 }).toBe(true);
  // Il click primario riapre e basta: non deve comparire il menu contestuale.
  expect(await archive.locator('.arc-ctxmenu').isVisible().catch(() => false)).toBe(false);
});

test('archivio: Invio da tastiera riapre la scheda (parità col click)', async ({ shell, openTab, testServer }) => {
  const { row } = await archiveOneTab({ shell, openTab, testServer });

  await row.focus();
  await row.press('Enter');
  await expect.poll(() => reopenedHost(shell), { timeout: 8_000 }).toBe(true);
});

test('archivio: Shift+F10 apre il menu contestuale Riapri/Elimina', async ({ shell, openTab, testServer }) => {
  const { archive, row } = await archiveOneTab({ shell, openTab, testServer });

  await row.focus();
  await row.press('Shift+F10');
  const menu = archive.locator('.arc-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Riapri', { exact: true })).toBeVisible();
  await expect(menu.getByText('Elimina', { exact: true })).toBeVisible();
});
