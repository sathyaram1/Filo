// Verifica #2096 giro 2: esplorazione dei nomi che il tasto destro delle impostazioni dà alle voci.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { confirmState } from '../../helpers/confirm.mjs';

for (const [pagina, url] of [['preferences', 'filo://preferences/preferences.html'], ['options', 'filo://options/options.html'], ['altro', 'filo://options/altro.html'], ['security', 'filo://security/security.html']]) {
  test(`nomi in ${pagina}`, async ({ openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab(url);
    await page.waitForTimeout(2500);
    const nomi = await page.evaluate(() => {
      const V = window.SN_VOCI_IMPOSTAZIONI;
      const M = window.SN_MENU_IMPOSTAZIONI;
      const S = window.SN_SIDEBAR;
      if (!V || !M || !S) return { manca: { V: !!V, M: !!M, S: !!S } };
      const pag = M.paginaDi();
      const out = [];
      const orig = S.chiediDaPagina;
      let preso = null;
      S.chiediDaPagina = (t) => { preso = t; };
      for (const [id] of Object.entries(V.campi(pag))) {
        const el = document.getElementById(id);
        if (!el) continue;
        preso = null;
        const voci = M.vociMenu(el);
        const c = voci.find((v) => v.label === 'Chiedi a Filo');
        if (c) c.onClick();
        out.push([id, preso]);
      }
      S.chiediDaPagina = orig;
      return out;
    });
    const strani = Array.isArray(nomi) ? nomi.filter(([id, t]) => !t || t.includes(`«${id}»`) || /«[a-z]+[A-Z.][A-Za-z.]*»/.test(t) || t.length > 120) : nomi;
    console.log(pagina, 'totale', Array.isArray(nomi) ? nomi.length : 0, 'strani', JSON.stringify(strani, null, 1));
  });
}

test('Preferenze: Rimetti di serie sul tema scelto, dal menu della tendina', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#theme')).toHaveValue('dark', { timeout: 10_000 });
  const tasto = page.locator('#theme').locator('xpath=..').locator('.sn-select-button').first();
  await tasto.click({ button: 'right' });
  const voci = await menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
  console.log('voci tema', voci);
  await menuDi(page).voce('Rimetti di serie').first().click();
  await page.waitForTimeout(800);
  const s = await confirmState(page);
  console.log('conferma sul tema:', JSON.stringify(s && { title: s.title, text: s.text }));
  await page.screenshot({ path: 'tests/.shots/2096-g2-tema-conferma.png' });
  expect(s).toBeNull();
});
