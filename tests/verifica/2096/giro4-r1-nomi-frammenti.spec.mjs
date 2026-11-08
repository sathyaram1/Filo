// #2096 giro 4 — il nome che il tasto destro delle Preferenze dà all'impostazione (e che finisce nella domanda all'Aiuto)
// non è un pezzo di frase che parla d'altro: «Quando suona un timer», «A schermo intero», «O sotto».
import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  { id: 'showHomeMessage', frammento: 'Quando suona un timer', deve: /home|scrive per primo/i },
  { id: 'barraSchede', frammento: 'A schermo intero', deve: /schede/i },
  { id: 'avvisoCreditiPercento', frammento: 'O sotto', deve: /credit/i },
  { id: 'avvisoCreditiGiorni', frammento: 'Quando durano al più', deve: /credit/i },
];

test('r1 in Preferenze il nome dell’impostazione nel tasto destro dice di cosa si tratta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://preferences/preferences.html');
  await expect.poll(() => page.evaluate(() => !!(window.SN_MENU_IMPOSTAZIONI && window.SN_SIDEBAR))).toBe(true);
  const nomi = await page.evaluate((ids) => {
    const M = window.SN_MENU_IMPOSTAZIONI;
    const S = window.SN_SIDEBAR;
    const orig = S.chiediDaPagina;
    let preso = '';
    S.chiediDaPagina = (t) => { preso = t; };
    const out = {};
    try {
      for (const id of ids) {
        preso = '';
        const c = M.vociMenu(document.getElementById(id)).find((v) => v.label === 'Chiedi a Filo');
        if (c) c.onClick();
        out[id] = String(preso).replace(/^Sull'impostazione «|»:$/g, '');
      }
    } finally { S.chiediDaPagina = orig; }
    return out;
  }, CASI.map((c) => c.id));
  for (const c of CASI) {
    expect(nomi[c.id], c.id).not.toBe(c.frammento);
    expect(nomi[c.id], c.id).toMatch(c.deve);
  }
});
