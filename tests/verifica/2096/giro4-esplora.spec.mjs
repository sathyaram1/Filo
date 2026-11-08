// Esplorazione del giro 4: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';

for (const [pagina, url] of [['preferences', 'filo://preferences/preferences.html'], ['options', 'filo://options/options.html'], ['altro', 'filo://altro/altro.html'], ['security', 'filo://security/security.html']]) {
  test(`nomi ${pagina}`, async ({ openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab(url);
    await page.waitForTimeout(4000);
    const out = await page.evaluate(async (pag) => {
      const M = globalThis.SN_MENU_IMPOSTAZIONI;
      const V = globalThis.SN_VOCI_IMPOSTAZIONI;
      if (!M || !V) return [`manca ${!!M} ${!!V}`];
      const S = globalThis.SN_SIDEBAR;
      let preso = '';
      if (S) S.chiediDaPagina = (t) => { preso = t; };
      const righe = [];
      for (const [id, perc] of Object.entries(V.campi(pag))) {
        const el = document.getElementById(id);
        if (!el) { righe.push(`${id}\t(assente)`); continue; }
        const btn = el.parentElement && el.parentElement.querySelector('.sn-select-button');
        const target = (el.tagName === 'SELECT' && btn) ? btn : el;
        const voci = M.vociMenu(target);
        preso = '';
        const c = voci.find((v) => v.label === 'Chiedi a Filo');
        if (c) c.onClick();
        righe.push(`${id}\t${perc}\t${voci.map((v) => v.label).join('|')}\t${preso}`);
      }
      return righe;
    }, pagina);
    console.log(`\n=== ${pagina}\n${out.join('\n')}`);
    expect(out.length).toBeGreaterThan(0);
  });
}
