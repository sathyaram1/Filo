// #725 giro 2 — l'avviso sul link nel menu del tasto destro.
// Porta chiusa nel giro 1 (segnatempo di un video) ri-provata, più gli indirizzi
// di tutti i giorni che si prendono lo stesso avviso rosso senza meritarselo.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Pagina di prova</h1>
  <p><a id="gitlab" href="https://gitlab.com/gitlab-org/gitlab">Il progetto su GitLab</a></p>
  <p><a id="wiki" href="https://it.wikipedia.org/wiki/Delete">Cancellazione (enciclopedia)</a></p>
  <p><a id="tco" href="https://t.co/AbCdEf1234">Un link condiviso da X</a></p>
  <p><a id="video" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125">Il video dal minuto due</a></p>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al tuo conto</a></p>
</body></html>`;

async function avvisoSuLink(page, id) {
  await page.locator('#' + id).click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  // La spiegazione del link è una sezione che si riempie da sola: aspettiamo
  // che ci sia, poi guardiamo se sopra è comparso un avviso.
  await expect(menu.locator('.sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(1200);
  const warn = menu.locator('.sn-menu-link-warn');
  const testo = (await warn.count()) ? ((await warn.first().textContent()) || '').trim() : '';
  return testo;
}

// Le porte della stessa causa: indirizzi di tutti i giorni che si prendono
// l'avviso rosso. Una per prova, così si vedono tutte insieme.
const INNOCENTI = [
  ['gitlab', 'l’indirizzo di GitLab, accusato di imitare GitHub'],
  ['tco', 'il link corto di X'],
  ['wiki', 'una voce di enciclopedia che si chiama «Delete»'],
];

for (const [id, cosa] of INNOCENTI) {
  test(`nessun avviso su ${cosa}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, HTML);
    expect(await avvisoSuLink(page, id)).toBe('');
  });
}

test('il segnatempo di un video resta senza avviso (porta chiusa nel giro 1)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const testo = await avvisoSuLink(page, 'video');
  expect(testo).toBe('');
});

test('un vero sosia si fa capire a parole', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const testo = await avvisoSuLink(page, 'falso');
  expect(testo).toContain('paypal.com');
  expect(testo).not.toMatch(/typosquatting|token_in_url|side_effect/);
  await page.screenshot({ path: 'tests/.shots/725-giro2-avviso.png' });
});

test('la spiegazione arriva da sola: nel menu non c’è nessuna voce da cliccare', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const menu = page.locator('.sn-menu');

  // Su un link: sezione che si riempie da sola, e nessuna voce "Spiega link".
  await page.locator('#falso').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline[data-subject="link"]')).toBeVisible();
  await expect(menu.getByText(/^Spieg/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Sul testo selezionato: idem, e nessuna voce "Spiegazione".
  await page.locator('h1').evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.locator('h1').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline[data-subject="text"]')).toBeVisible();
  await expect(menu.getByText(/^Spiegazione$/)).toHaveCount(0);
});
