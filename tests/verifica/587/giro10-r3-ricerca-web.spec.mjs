// #587 giro 10, rilievo 3: una ricerca sul web con dentro ciò che Filo ha appena letto chiede un OK, come il link.
import { test, expect } from '../../fixtures/electron.mjs';

const LETTO = 'Riunione del 12 marzo con il fornitore, preventivo numero 4471 approvato dal consiglio';
const DOPO_CAT = [{
  type: 'ESEGUI_COMANDO', comando: 'cat Documenti/verbale.txt',
  _output: { command: 'cat Documenti/verbale.txt', stdout: `${LETTO}\n`, stderr: '', code: 0 },
}];

test('il testo appena letto non esce da una ricerca sul web senza un OK', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const pezzo = LETTO.slice(20, 60);
  const link = await app.evaluate((_e, { a, o }) => globalThis.SN_EXECUTE_FILO_ACTION(a, o),
    { a: { type: 'NAVIGA', url: `https://sito.esempio/?d=${encodeURIComponent(pezzo)}` }, o: { contesto: DOPO_CAT } });
  expect(link.needsConfirm, 'il link con lo stesso pezzo chiede già un OK').toBe(2);
  const ricerca = await app.evaluate((_e, { a, o }) => globalThis.SN_EXECUTE_FILO_ACTION(a, o),
    { a: { type: 'CERCA_WEB', query: pezzo }, o: { contesto: DOPO_CAT } });
  expect(ricerca.needsConfirm).toBe(2);
  expect(ricerca.executed).toBe(false);
});
