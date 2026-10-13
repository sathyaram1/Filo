// Verifica #482 giro 1, rilievo 2: «localhost:3000» senza http:// è preso per uno schema e fermato «per sicurezza».
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 aperto da Filo, un indirizzo locale con la porta e senza http si apre', async ({ app, shell, testServer }) => {
  const porta = new URL(testServer.html('<title>Locale</title>x')).port;
  const id = await app.evaluate(({ BrowserWindow }, p) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.openTab(`localhost:${p}/1`);
  }, porta);
  expect(id, 'nessuna scheda per localhost con la porta').toBeTruthy();
});

test('r2 chiesto all\'assistente, un indirizzo locale con la porta e senza http si apre', async ({ app, testServer }) => {
  const porta = new URL(testServer.html('<title>Locale</title>x')).port;
  const r = await app.evaluate((_e, p) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: `localhost:${p}/1` }), porta);
  expect(r && r.output && r.output.blocked, 'fermato come schema').toBeFalsy();
  expect(r && r.executed).toBe(true);
});
