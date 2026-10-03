// Verifica #866 giro 2, rilievo 2 — «cancella le pagine di ieri» toglie quelle di ieri e lascia quelle di oggi.
import { test, expect } from '../../fixtures/electron.mjs';

test('«cancella le pagine di ieri» chiede l’OK per quelle di ieri e lascia quelle di oggi', async ({ app }) => {
  await app.evaluate(async () => {
    const ieri = new Date(); ieri.setDate(ieri.getDate() - 1); ieri.setHours(12, 0, 0, 0);
    await globalThis.SN_IL_FILO.registraVisita({ url: 'https://ieri.test/', titolo: 'Pagina di ieri', ts: ieri.toISOString() });
    await globalThis.SN_IL_FILO.registraVisita({ url: 'https://oggi.test/', titolo: 'Pagina di oggi' });
  });
  const chiesta = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', periodo: 'ieri' }));
  expect(chiesta.needsConfirm, JSON.stringify(chiesta)).toBe(2);
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CANCELLA_PAGINE', periodo: 'ieri' }, { confirmed: true }));
  const titoli = await app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).map((p) => p.titolo));
  expect(titoli).toEqual(['Pagina di oggi']);
});
