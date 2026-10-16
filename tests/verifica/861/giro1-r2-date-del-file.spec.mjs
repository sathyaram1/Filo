// #861 giro 1 — da fuori un contenitore usato e uno mai usato non si distinguono: nemmeno dalle date del file, che
// creare, aprire o scrivere un segreto non devono spostare.
import { test, expect } from '@playwright/test';
import { statSync, utimesSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { M, MB, contenitore } from './aiuto.mjs';

const INSTALLAZIONE = new Date('2025-03-01T10:00:00Z');

test('r2 creare, scrivere, riaprire e cercare un nome che non c’è lasciano le date del contenitore com’erano', async () => {
  test.setTimeout(120_000);
  const dir = cartellaTemporanea('v861-r2-');
  try {
    const base = await contenitore(dir, 16 * MB);
    utimesSync(base.contenitore, INSTALLAZIONE, INSTALLAZIONE);
    const date = () => {
      const st = statSync(base.contenitore);
      return { modificato: new Date(st.mtimeMs).toISOString(), letto: new Date(st.atimeMs).toISOString() };
    };
    const attese = { modificato: INSTALLAZIONE.toISOString(), letto: INSTALLAZIONE.toISOString() };

    const s = (await M.creaSegreto({ ...base, nome: 'Alfa' })).segreto;
    await s.scriviFile('diario.txt', 'cose mie');
    await s.chiudi();
    expect(date(), 'dopo aver creato e scritto').toEqual(attese);

    const r = await M.apriSegreto({ ...base, nome: 'Alfa' });
    expect(r.esito).toBe('aperto');
    await r.segreto.chiudi();
    expect(date(), 'dopo una riapertura').toEqual(attese);

    expect((await M.apriSegreto({ ...base, nome: 'nome che non c’è' })).esito).toBe('nessuno');
    expect(date(), 'dopo un nome che non c’è').toEqual(attese);
  } finally {
    togliCartella(dir);
  }
});
