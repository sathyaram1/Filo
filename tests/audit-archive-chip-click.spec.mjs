// AUDIT (routine, riproduzione): archivio tab — il click sinistro sulla chip
// non fa nulla, mentre Invio da tastiera apre il menu Riapri/Elimina.
//
// Flusso utente riprodotto:
//   1. chiudi una scheda (finisce nell'archivio);
//   2. apri "Tab archiviate" e clicca (sinistro) sulla chip della scheda:
//      non succede NULLA — né riapertura né menu. La chip però ha l'aspetto di
//      un bottone (hover evidenziato, role=button) e con Invio/Spazio da
//      tastiera il menu si apre: il mouse e la tastiera non sono alla pari.
//
// Il test asserisce lo stato ATTUALE (click sinistro inerte, Invio apre il
// menu): documenta l'incoerenza restando verde. Il fix atteso (click sinistro
// che apre il menu o riapre la scheda) lo farà fallire, e a quel punto va
// aggiornato per asserire il comportamento nuovo.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Chip Click</title></head>
<body style="margin:0"><div style="height:600px">contenuto</div></body></html>`;

test('archivio: click sinistro sulla chip inerte, Invio apre il menu', async ({ shell, openTab, testServer }) => {
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

  // Stato ATTUALE (il bug): il click sinistro non produce niente.
  await row.click();
  await archive.waitForTimeout(600);
  expect(await archive.locator('.arc-ctxmenu').isVisible().catch(() => false)).toBe(false);
  const tabsAfterClick = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.map((t) => t.url);
  });
  expect(tabsAfterClick.some((u) => /127\.0\.0\.1/.test(u || ''))).toBe(false);

  // …mentre l'attivazione da tastiera (Invio) apre il menu contestuale:
  // i due cammini equivalenti divergono.
  await row.focus();
  await archive.keyboard.press('Enter');
  await expect(archive.locator('.arc-ctxmenu')).toBeVisible();
});
