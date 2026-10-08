// r3 — «cerca in tutta la mia cartella»: la ricerca entra nelle cartelle di profilo appena sotto la cartella personale
// (Libreria su Mac), che per leggere un solo file Filo tratta come private e per cui chiede un OK.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { pdf } from '../../helpers/documentiFinti.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('r3 la ricerca nella cartella personale non legge dentro Libreria', async ({ app }) => {
  test.setTimeout(90_000);
  const casa = cartellaTemporanea('filo-casa-');
  const dentroLibreria = join(casa, 'Library', 'Containers', 'com.esempio.posta', 'Data', 'Documents');
  mkdirSync(dentroLibreria, { recursive: true });
  mkdirSync(join(casa, 'Lavoro'), { recursive: true });
  const bolletta = pdf([['Bolletta per la fornitura di energia elettrica', 'Periodo di fatturazione: 01/03/2026 - 31/03/2026']]);
  writeFileSync(join(dentroLibreria, 'allegato_0001.pdf'), bolletta);
  writeFileSync(join(casa, 'Lavoro', 'scan_00231.pdf'), bolletta);
  try {
    const nomi = await app.evaluate(async (_e, c) => {
      const prima = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
      process.env.HOME = c;
      process.env.USERPROFILE = c;
      try {
        const r = await globalThis.SN_DOCUMENTI_INDICE.cerca('bolletta luce energia elettrica marzo', { cartella: '~' });
        return r.risultati.map((x) => x.percorso);
      } finally {
        for (const [k, v] of Object.entries(prima)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
      }
    }, casa);
    expect(nomi.some((p) => p.endsWith('scan_00231.pdf')), 'il documento della cartella personale si trova').toBe(true);
    expect(nomi.filter((p) => p.includes('Library')), 'niente da dentro Libreria').toEqual([]);
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
});
