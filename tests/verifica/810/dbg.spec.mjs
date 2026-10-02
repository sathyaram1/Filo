import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, NAVIGA_COL_CODICE, esitoUscita } from './aiuti.mjs';
test('dbg3', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head>
    <body><p>Il tuo codice monouso è ${CODICE}.</p></body></html>`);
  await preparaModelli(app);
  await modelloFinto(app, { aiuto: [['l’hai aperta', JSON.stringify({ text: 'Rispondo.', status: 'done' })], ['', NAVIGA_COL_CODICE]] });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a finire l’accesso');
  console.log('ESITO', await esitoUscita(app, page));
  await page.waitForTimeout(2000);
  await scriviAllAiuto(page, 'l’hai aperta?');
  await page.waitForTimeout(4000);
  const visti = await app.evaluate(() => globalThis.__visti);
  for (const v of visti) console.log('CHIAMATA', JSON.stringify(v.filter((m) => m.role !== 'system').map((m) => m.role + ':' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 140))).slice(0, 900));
  console.log('LOG', JSON.stringify(await page.locator('.sn-sidebar-log').allInnerTexts()));
});
