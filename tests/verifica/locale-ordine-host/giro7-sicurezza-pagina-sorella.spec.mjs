// Settima volta che si guarda la stessa famiglia: una pagina senza pulsante
// «Salva» fa partire il salvataggio solo quando il cursore esce dal campo, e
// non salva niente prima di sparire. Qui tocca alla pagina Sicurezza, sorella
// di «Altro» delle Opzioni, che la stessa prova la supera.

import { test, expect } from '../../fixtures/electron.mjs';

const SICUREZZA = 'filo://security/security.html';
const ALTRO = 'filo://options/altro.html';

async function chiudiScheda(shell, frammento) {
  const id = await shell.evaluate(async (f) => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    const t = lista.find((x) => (x.url || '').includes(f));
    return t ? t.id : null;
  }, frammento);
  expect(id, `la scheda ${frammento} non compare fra quelle aperte`).toBeTruthy();
  await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
}

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const listaBloccati = (app) => impostazioni(app)
  .then((s) => ((s.security || {}).siteBlock || {}).blacklist || []);

// Accende il blocco dei siti (il campo dell'elenco è spento finché non lo è) e
// aspetta che la scelta sia davvero a destinazione.
async function accendiBloccoSiti(page, app) {
  await page.waitForSelector('#sec-siteblock', { timeout: 20_000 });
  if (!(await page.isChecked('#sec-siteblock'))) await page.click('#sec-siteblock');
  await expect
    .poll(() => impostazioni(app).then((s) => !!((s.security || {}).siteBlock || {}).enabled), { timeout: 8000 })
    .toBe(true);
}

test('Sicurezza: il sito appena scritto nell\'elenco dei bloccati non si perde chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(SICUREZZA);
  await accendiBloccoSiti(page, app);

  await page.click('#sec-siteblock-blacklist');
  await page.keyboard.type('esempio-chiuso.com');

  await chiudiScheda(shell, 'security');

  await expect
    .poll(() => listaBloccati(app), {
      timeout: 8000,
      message: 'chiudendo la scheda col cursore ancora nel campo, il sito appena scritto sparisce',
    })
    .toContain('esempio-chiuso.com');
});

// Controllo: uscendo dal campo prima di chiudere la stessa strada salva. Serve
// a distinguere «si perde» da «la prova guarda nel posto sbagliato».
test('Sicurezza: uscendo dal campo prima di chiudere, il sito c\'è', async ({ app, shell, openTab }) => {
  const page = await openTab(SICUREZZA);
  await accendiBloccoSiti(page, app);

  await page.click('#sec-siteblock-blacklist');
  await page.keyboard.type('esempio-blurato.com');
  await page.keyboard.press('Tab');

  await expect.poll(() => listaBloccati(app), { timeout: 8000 }).toContain('esempio-blurato.com');
  await chiudiScheda(shell, 'security');
});

test('Sicurezza: il sito appena scritto non si perde ricaricando la pagina', async ({ app, openTab }) => {
  const page = await openTab(SICUREZZA);
  await accendiBloccoSiti(page, app);

  await page.click('#sec-siteblock-blacklist');
  await page.keyboard.type('esempio-ricaricato.com');
  await page.reload();
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 20_000 });

  await expect
    .poll(() => listaBloccati(app), {
      timeout: 8000,
      message: 'ricaricando la pagina col cursore ancora nel campo, il sito appena scritto sparisce',
    })
    .toContain('esempio-ricaricato.com');
});

// La pagina sorella, «Altro» delle Opzioni, ha lo stesso identico campo (un
// elenco di domini, nessun pulsante Salva) e la stessa prova la supera: è la
// misura di quanto le due strade divergono.
test('Altro: il dominio appena scritto non si perde chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(ALTRO);
  await page.waitForSelector('#blocklist', { timeout: 20_000 });
  await page.click('#blocklist');
  await page.keyboard.type('gemello-chiuso.com');

  await chiudiScheda(shell, 'options/altro.html');

  await expect
    .poll(() => impostazioni(app).then((s) => s.blocklist || []), { timeout: 8000 })
    .toContain('gemello-chiuso.com');
});

// La conferma deve parlare dell'ULTIMA modifica: accesa mentre quello che si
// vede non è ancora partito, dice il falso proprio a chi sta per chiudere.
test('Sicurezza: la conferma «Salvato» si spegne appena arriva una modifica nuova', async ({ app, openTab }) => {
  const page = await openTab(SICUREZZA);
  await accendiBloccoSiti(page, app);

  // Una modifica che salva subito: la conferma si accende.
  await page.click('#sec-protect-ip');
  await expect.poll(() => page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show')), { timeout: 8000 }).toBe(true);

  // Adesso una modifica NUOVA, non ancora partita.
  await page.click('#sec-siteblock-blacklist');
  await page.keyboard.type('mentre-la-conferma-e-accesa.com');

  expect(
    await page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show')),
    'la conferma resta accesa mentre la modifica nuova non è salvata',
  ).toBe(false);
});
