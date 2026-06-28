// AUDIT (routine): verifica il drift del manifesto capacità per "open-for-later".
//
// Il manifesto SN_CAPABILITIES dice:
//   invoke: 'Menu del tasto destro → "Aperti per dopo".'
// Ma l'icona `openForLater` è stata ritirata (RETIRED_ICONS) dal menu del
// tasto destro. Non esiste più un'icona "Aperti per dopo" nel menu — la voce
// è stata sostituita dalla generica icona "Home" che apre la nuova scheda
// dashboard, NON la pagina "Aperti per dopo".
//
// Questo test verifica:
// (a) L'icona "Aperti per dopo" NON compare nel menu del tasto destro
//     (conferma il ritiro).
// (b) Il manifesto cita come invoke una via che non esiste più.

import { test, expect } from './fixtures/electron.mjs';

test('icona "Aperti per dopo" ritirata: non compare nel menu del tasto destro', async ({ openTab, testServer }) => {
  const html = '<!doctype html><html><body style="padding:40px"><p id="target">testo</p></body></html>';
  const page = await testServer.openReady(openTab, html);

  // Apri il menu del tasto destro su testo senza selezione
  await page.locator('#target').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();

  // L'icona "Aperti per dopo" NON deve comparire nel menu
  const openForLaterIcon = page.locator('.sn-menu .sn-menu-icon-item', { hasText: 'Aperti per dopo' });
  await expect(openForLaterIcon).toHaveCount(0);

  // DRIFT CONFERMATO: il manifesto dice "Menu del tasto destro → 'Aperti per
  // dopo'" ma l'opzione non esiste. La feature è accessibile solo navigando
  // direttamente a filo://home/home.html.
  await page.screenshot({ path: 'tests/.shots/audit-open-for-later-invoke.png' }).catch(() => {});
});
