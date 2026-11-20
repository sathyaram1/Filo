// La riga informativa del menu tasto destro (il commento/spiegazione non cliccabile, es. la spiegazione di un errore
// "blu") si distingue a colpo d'occhio dalle voci cliccabili: col grigio, non col corsivo, che in Filo vuol dire
// «qui c'è una spiegazione al passaggio» (#2388).

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const HTML = `<!doctype html><html><body style="padding:40px"><h1 id="h">pagina</h1></body></html>`;

test('la riga commento/spiegazione del menu è dritta e nel grigio, diversa dalle voci', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Apri un menu reale: garantisce che la CSS del menu sia attiva nella pagina.
  await page.locator('#h').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();

  // Una riga 'info' identica a quella prodotta dal menu per le spiegazioni, accanto a una voce.
  const stili = await menuDi(page).valuta(() => {
    const host = document.fullscreenElement || document.documentElement;
    const sub = document.createElement('div');
    sub.className = 'sn-menu sn-menu-sub';
    const info = document.createElement('div');
    info.className = 'sn-menu-info';
    info.textContent = 'Modulo con errore di inserimento';
    const voce = document.createElement('div');
    voce.className = 'sn-menu-item';
    voce.textContent = 'Copia';
    sub.append(info, voce);
    host.appendChild(sub);
    const out = { stile: getComputedStyle(info).fontStyle, info: getComputedStyle(info).color, voce: getComputedStyle(voce).color };
    sub.remove();
    return out;
  });

  expect(stili.stile).toBe('normal');
  expect(stili.info).not.toBe(stili.voce);
});
