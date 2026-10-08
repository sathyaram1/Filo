// #947 giro 1, rilievo 2: un documento messo in Documenti da un altro programma subito dopo una ricerca deve trovarsi
// chiedendo di nuovo, non mezzo minuto dopo.

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { writeFileSync, rmSync, renameSync } from 'node:fs';
import { pdf } from '../../helpers/documentiFinti.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('r2 un file salvato in Documenti subito dopo una ricerca vuota si trova chiedendo di nuovo', async ({ app }) => {
  test.setTimeout(90_000);
  const doc = cartellaTemporanea('filo-947-doc-');
  const fuori = cartellaTemporanea('filo-947-fuori-');
  await app.evaluate((_e, d) => {
    process.env.FILO_DOCUMENTI_DIR = d;
    globalThis.SN_DOCUMENTI_INDICE._azzera();
  }, doc);
  writeFileSync(join(fuori, 'scan_00777.pdf'), pdf([[
    'ENERGIA SERVIZIO ELETTRICO S.p.A.', 'Bolletta per la fornitura di energia elettrica',
    'Periodo di fatturazione: 01/03/2026 - 31/03/2026', 'Consumo del periodo: 212 kWh',
  ]]));
  try {
    const cerca = (q) => app.evaluate((_e, x) => globalThis.SN_DOCUMENTI_INDICE.cerca(x), q);
    expect((await cerca('bolletta luce marzo')).risultati.length).toBe(0);
    // L'utente la salva in Documenti dalla posta, dallo scanner o trascinandola, e richiede.
    renameSync(join(fuori, 'scan_00777.pdf'), join(doc, 'scan_00777.pdf'));
    const dopo = await cerca('bolletta luce marzo');
    expect(dopo.risultati.map((r) => r.nome)).toContain('scan_00777.pdf');
  } finally {
    rmSync(doc, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});
