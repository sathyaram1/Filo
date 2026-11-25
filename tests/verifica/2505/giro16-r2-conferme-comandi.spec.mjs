// #2505 giro 16: le regole di conferma dei comandi stanno nelle parti del classificatore; un ramo che ne tocca una
// tocca le conferme prima di un comando, e il minimo deve dire «irreparabile».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/consegna.js');
const C = globalThis.SN_CONSEGNA;

test('r2 un ramo che tocca solo una parte del classificatore dei comandi esce irreparabile, zona conferme', () => {
  for (const f of ['src/shared/cmdGit.js', 'src/shared/cmdGruppi.js', 'src/shared/cmdBase.js', 'src/shared/cmdPerimetro.js', 'src/shared/cmdSovrascritture.js']) {
    const m = C.minimoDaiPercorsi({ app: [f] });
    expect(m.classe, f).toBe('irreparabile');
    expect(m.zone.map((z) => z.chiave), f).toEqual(['conferme']);
  }
});
