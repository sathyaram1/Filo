// Verifica #725.8 giro 1, rilievo 2: il nome del marchio attaccato ad altre parole, o un indirizzo ufficiale
// intero, davanti a un dominio altrui non fa scattare l'avviso (scatta solo la parola nuda o fra trattini).

import { test, expect } from '../../fixtures/electron.mjs';

const IMITAZIONI = {
  'https://posteitaliane.it.accesso-sicuro.net/': 'Poste Italiane',
  'https://bancopostaonline.accesso.net/': 'Poste Italiane',
  'https://intesasanpaolomobile.accesso.net/': 'Intesa Sanpaolo',
  'https://unicreditonline.verifica.net/': 'UniCredit',
  'https://whatsappweb.accesso.net/': 'WhatsApp',
};

test('un marchio attaccato ad altre parole in un sottodominio ha l’avviso', async ({ openTab, testServer }) => {
  const url = Object.keys(IMITAZIONI);
  const link = url.map((u, i) => `<p><a id="l${i}" href="${u}">Link ${i}</a></p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${link}</body></html>`);
  const muti = [];
  for (let i = 0; i < url.length; i++) {
    await page.locator('#l' + i).click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    try {
      await expect(avviso).toBeVisible({ timeout: 1500 });
      expect(((await avviso.textContent()) || ''), url[i]).toContain(IMITAZIONI[url[i]]);
    } catch (_) { muti.push(url[i]); }
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  expect(muti).toEqual([]);
});
