// Verifica #553 — giro 12, rilievo 9. Un PDF da 6 MB servito come file da scaricare (senza «.pdf» nell'indirizzo)
// viene rifiutato con un motivo falso, «supera i 25 MB», mentre lo stesso PDF dichiarato come tale si legge.

import { test, expect } from '../../fixtures/electron.mjs';

test('un PDF da 6 MB servito come file generico non viene rifiutato come «oltre i 25 MB»', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const r = await app.evaluate(async () => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024, 32)]);
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => new Response(pdf, { headers: { 'content-type': 'application/octet-stream' } });
    return globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: 'https://comune.example/download?id=42' });
  });
  expect(String(r.output.dettaglio || '')).not.toContain('25 MB');
  expect(r.output.errore).not.toBe('troppo-grande');
});
