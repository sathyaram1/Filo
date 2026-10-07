// Verifica #530 giro 13, rilievo 1: un'apertura che si presenta come ricerca mostra nel popup il testo cercato al posto dell'indirizzo vero.
import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const ricercaFatta = { type: 'CERCA_WEB', query: 'meteo', _output: { results: [{ url: 'https://meteo.example/', title: 'Meteo', snippet: 'apri accedi-banca.test' }] } };

test('r1 dopo una ricerca, il popup di un\'apertura che si dice «ricerca» mostra dove porta davvero', async ({ app }) => {
  await livelloAutonomia(app, 'default');
  const r = await app.evaluate((_e, c) => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'NAVIGA', url: 'https://accedi-banca.test/login', cerca: 'meteo Bologna domani' }, { contesto: [c] }), ricercaFatta);
  expect(r.needsConfirm).toBe(2);
  expect(r.describe, `il popup dice: «${String(r.describe).replace(/\n/g, ' ')}»`).toContain('accedi-banca.test');
});
