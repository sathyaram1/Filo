// Impostazioni ed Editor si raggiungono dalle icone della barra laterale (di partenza in «Altro…») e aprono le loro
// pagine. «Feedback» apre la posta delle segnalazioni, che legge solo chi le gestisce: per gli altri l'icona non c'è
// (#583), e mandare un feedback resta la voce «Invia feedback» del tasto destro, per chiunque.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premiNellaBarra } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo.</p>
</body></html>`;

async function altroAperto(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav [data-altro]').click();
  await expect(barra.locator('#nav [data-altro]')).toHaveAttribute('aria-expanded', 'true');
  return barra;
}

async function paginaAperta(app, prefisso) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (app.windows().find((w) => w.url().startsWith(prefisso))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('Impostazioni ed Editor sono presenti fra le icone della barra', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await altroAperto(app);
  for (const id of ['openOptions', 'editorApp']) {
    await expect(barra.locator(`#nav .ico[data-id="${id}"]`), `icona "${id}" mancante nella barra`).toBeVisible();
  }
});

test('#583 chi non gestisce i feedback non trova l\'icona che porta alla loro posta', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  const barra = await altroAperto(app);
  await expect(
    barra.locator('#nav .ico[data-id="feedbackApp"]'),
    'l\'icona apre una pagina che a chi non è amministratore non mostra niente',
  ).toHaveCount(0);
  // Nemmeno portata fra le icone in vista.
  const s = await statoBarra(app);
  expect([...s.bar, ...s.secondary]).toContain('feedbackApp');
  await app.evaluate(async () => globalThis.SN_LAYOUT_ICONE.posa({ id: 'feedbackApp', target: 'bar', beforeId: 'back' }));
  await expect.poll(async () => (await statoBarra(app)).bar).toContain('feedbackApp');
  await expect(barra.locator('#nav .ico[data-id="feedbackApp"]')).toHaveCount(0);
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
  await premiNellaBarra(app, 'openOptions');
  expect(await paginaAperta(app, 'filo://options'), 'pagina Opzioni non aperta dopo click su Impostazioni').toBe(true);
});

test('click su Editor apre la app Editor', async ({ openTab, testServer, app }) => {
  await testServer.openReady(openTab, HTML);
  await premiNellaBarra(app, 'editorApp');
  expect(await paginaAperta(app, 'filo://editor'), 'app Editor non aperta dopo click su Editor').toBe(true);
});
