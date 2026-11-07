// Esplorazione del giro 3: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';

for (const url of ['filo://preferences/preferences.html', 'filo://options/options.html', 'filo://options/altro.html', 'filo://security/security.html']) {
  test(`nomi ${url.split('/').pop()}`, async ({ openTab }) => {
    test.setTimeout(60_000);
    const page = await openTab(url);
    await expect.poll(() => page.evaluate(() => !!(window.SN_MENU_IMPOSTAZIONI && window.SN_SIDEBAR))).toBe(true);
    await page.waitForTimeout(1500);
    const nomi = await page.evaluate(() => {
      const V = window.SN_VOCI_IMPOSTAZIONI;
      const M = window.SN_MENU_IMPOSTAZIONI;
      const S = window.SN_SIDEBAR;
      const orig = S.chiediDaPagina;
      let preso = null;
      S.chiediDaPagina = (t) => { preso = t; };
      const out = [];
      try {
        for (const [id, percorso] of Object.entries(V.campi(M.paginaDi()))) {
          const el = document.getElementById(id);
          if (!el) { out.push(`${id} | ${percorso} | (manca in pagina)`); continue; }
          preso = null;
          const voci = M.vociMenu(el);
          const c = voci.find((v) => v.label === 'Chiedi a Filo');
          if (c) c.onClick();
          out.push(`${id} | ${percorso} | ${voci.map((v) => v.label).join('/')} | ${String(preso || '').replace(/^Sull'impostazione «|»:$/g, '')}`);
        }
      } finally { S.chiediDaPagina = orig; }
      return out;
    });
    console.log(`\n=== ${url}\n${nomi.join('\n')}`);
  });
}
