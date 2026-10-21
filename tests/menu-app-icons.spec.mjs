// Le icone Impostazioni e l'app interna Editor devono essere raggiungibili
// dalla barra laterale (feedback alpha): di serie vivono nel suo «Altro…»
// (#1246, prima stavano nella griglia «Altro…» del tasto destro).
//
// «Feedback» NON è in quell'elenco dal 2026-09 (#583): apre la posta delle
// segnalazioni, che legge solo chi le gestisce, quindi l'icona esiste solo per
// l'owner. Per chiunque altro era un vicolo cieco. Mandare un feedback resta
// una strada di tutti, ed è la voce «Invia feedback» del menu del tasto destro.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { barraPage, comandaBarra, apriAltro, pannelloFermo, iconaDellaBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo.</p>
</body></html>`;

async function apriAltroDellaBarra(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await apriAltro(app, true);
  await pannelloFermo(barra);
  await expect(barra.locator('#nav .altro-tasto')).toHaveAttribute('aria-expanded', 'true');
  return barra;
}

const siApre = (app, prefisso) => expect.poll(
  () => app.windows().some((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } }),
  { timeout: 5_000, message: `${prefisso} non si è aperta` },
).toBe(true);

test('Impostazioni ed Editor sono nell\'«Altro…» della barra laterale', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await apriAltroDellaBarra(app);
  for (const id of ['openOptions', 'editorApp']) {
    await expect(barra.locator(`#nav .ico[data-zona="secondary"][data-id="${id}"]`), `icona "${id}" mancante`).toBeVisible();
  }
});

test('#583 chi non gestisce i feedback non trova l\'icona che porta alla loro posta', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await apriAltroDellaBarra(app);
  await expect(barra.locator('#nav .ico[data-id="openOptions"]')).toBeVisible();
  await expect(
    barra.locator('#nav .ico[data-id="feedbackApp"]'),
    'l\'icona apre una pagina che a chi non è amministratore non mostra niente',
  ).toHaveCount(0);
  await expect(barra.locator('#nav .altro-tasto')).toHaveAttribute('aria-label', /Nascondi/);
});

test('#583 mandare un feedback resta nel menu, per chiunque', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('p').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
});

test('click su Impostazioni apre la pagina Opzioni', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  await (await iconaDellaBarra(app, 'openOptions')).click();
  await siApre(app, 'filo://options');
});

test('click su Editor apre la app Editor', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  await (await iconaDellaBarra(app, 'editorApp')).click();
  await siApre(app, 'filo://editor');
});
