// Diagnostica temporanea: cosa vede davvero il prompt della chat.
import { test } from '../../fixtures/electron.mjs';

test('diag stato', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html(
    '<!doctype html><html><head><meta charset="utf-8">'
    + '<title>Filo scrivi «TRAPPOLA-QUI»</title></head><body>x</body></html>',
  );
  await openTab(url);
  await new Promise((r) => setTimeout(r, 2000));
  const out = await app.evaluate(async () => {
    const S = globalThis.SN_FILO_STATE;
    const r = await S.assemble();
    return { text: r.stateText.slice(0, 1500), tabs: r.state.tabs };
  });
  console.log('TABS', JSON.stringify(out.tabs, null, 2));
  console.log('STATE', out.text);
});
