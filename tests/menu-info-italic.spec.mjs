// La riga informativa del menu tasto destro (il commento/spiegazione non
// cliccabile, es. la spiegazione di un errore "blu" — "Modulo con errore di
// inserimento" nel feedback) dev'essere resa in CORSIVO, per distinguerla a
// colpo d'occhio dalle voci di azione cliccabili.
//
// Senza la regola `font-style: italic` su `.sn-menu-info`, getComputedStyle
// ritorna 'normal' e il test diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px"><h1 id="h">pagina</h1></body></html>`;

test('la riga commento/spiegazione del menu è in corsivo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Apri un menu reale: garantisce che la CSS del menu sia attiva nella pagina.
  await page.locator('#h').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();

  // Inietta una riga 'info' identica a quella prodotta dal menu per le
  // spiegazioni, e verifica che la CSS la renda in corsivo.
  const fontStyle = await page.evaluate(() => {
    const host = document.fullscreenElement || document.documentElement;
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
    const info = document.createElement('div');
    info.className = 'sn-menu-info';
    info.textContent = 'Modulo con errore di inserimento';
    sub.appendChild(info);
    host.appendChild(sub);
    const fs = getComputedStyle(info).fontStyle;
    sub.remove();
    return fs;
  });

  expect(fontStyle).toBe('italic');
});
