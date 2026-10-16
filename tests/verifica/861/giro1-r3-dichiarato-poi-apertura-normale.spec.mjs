// #861 giro 1 — chi crea un segreto dichiarando l'altro e poi lo riapre normalmente (senza dichiarare: è l'apertura
// di tutti i giorni) non deve toccare i blocchi dell'altro, se nel frattempo non ha scritto niente.
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { M, MB, contenitore, impronta, persi } from './aiuto.mjs';

test('r3 riaprire senza dichiarare un segreto creato dichiarando l’altro non cancella copie dell’altro', async () => {
  test.setTimeout(300_000);
  const dir = cartellaTemporanea('v861-r3-');
  try {
    // L'altro occupa poco più di metà del contenitore: catene lunghe per chi gli si mette intorno.
    const base = await contenitore(dir, 64 * MB);
    const c = (await M.creaSegreto({ ...base, nome: 'Casa' })).segreto;
    for (let x = 0; x < 20; x++) await c.scriviFile(`c${x}`, randomBytes(MB));
    await c.chiudi();
    const prima = await impronta(base, 'Casa');

    const d = (await M.creaSegreto({ ...base, nome: 'Diario', dichiarati: ['Casa'] })).segreto;
    for (let x = 0; x < 4; x++) await d.scriviFile(`d${x}`, randomBytes(MB));
    await d.chiudi();
    expect(persi(prima, await impronta(base, 'Casa')), 'mentre si dichiarava').toBe(0);

    const r = await M.apriSegreto({ ...base, nome: 'Diario' });
    expect(r.esito).toBe('aperto');
    await r.segreto.chiudi();
    expect(persi(prima, await impronta(base, 'Casa')), 'dopo la riapertura normale').toBe(0);
  } finally {
    togliCartella(dir);
  }
});
