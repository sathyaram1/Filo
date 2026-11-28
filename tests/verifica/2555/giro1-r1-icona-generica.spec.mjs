// Verifica #2555 giro 1, rilievo 1: una voce scritta da una pagina di Filo che nessun verbo riconosce diventa l'icona
// generica dell'elenco, al posto della sua. Le voci sono quelle vere del quaderno («Non tenerlo più aperto», su un sito
// tenuto aperto) e della citazione in chat («Non rispondere»), date al tasto destro dalla stessa porta delle pagine.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

for (const etichetta of ['Non tenerlo più aperto', 'Non rispondere']) {
  test(`r1 «${etichetta}» ha un'icona che dice cosa fa, non quella generica`, async ({ openTab }) => {
    const pagina = await openTab('filo://quaderno/quaderno.html');
    await pagina.waitForLoadState('domcontentloaded');
    await pagina.evaluate((et) => {
      const riga = document.createElement('div');
      riga.id = 'riga-prova';
      riga.textContent = 'esempio.it';
      riga.style.cssText = 'position:fixed;left:200px;top:200px;width:200px;height:40px;background:#eee;z-index:99999';
      document.body.appendChild(riga);
      window.__tolto = false;
      window.SN_VOCI_PAGINA.push((t) => (t && t.closest && t.closest('#riga-prova')
        ? [{ type: 'item', icon: window.SN_ICONS.close(16), label: et, onClick: () => { window.__tolto = true; } },
          { type: 'item', icon: window.SN_ICONS.copy(16), label: 'Copia il testo', onClick: () => {} }]
        : []));
    }, etichetta);
    await pagina.locator('#riga-prova').click({ button: 'right' });
    const menu = menuDi(pagina);
    await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
    const voce = menu.locator(`.sn-menu-griglia .sn-menu-row-btn[aria-label="${etichetta}"]`);
    await expect(voce).toHaveCount(1);
    const generica = await menu.valuta((et) => {
      const b = [...document.querySelectorAll('.sn-menu-griglia .sn-menu-row-btn')].find((x) => x.getAttribute('aria-label') === et);
      const tmp = document.createElement('div');
      tmp.innerHTML = window.SN_ICONS.list(20);
      const lista = tmp.querySelector('svg').innerHTML;
      return b.querySelector('svg').innerHTML === lista;
    }, etichetta);
    expect(generica, 'l\'icona è quella generica dell\'elenco').toBe(false);
  });
}
