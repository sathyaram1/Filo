// #861 giro 1 — chiudere un segreto mentre un salvataggio è in corso: il resto del salvataggio non deve finire sul
// disco cifrato con una chiave azzerata (leggibile da chiunque), e il file chiesto non deve andare perso.
import { test, expect } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { M, F, MB, contenitore } from './aiuto.mjs';

const TESTO = Buffer.from('TESTO-IN-CHIARO-DEL-SEGRETO '.repeat(750_000));

async function chiudiAMetaSalvataggio(base) {
  const s = (await M.creaSegreto({ ...base, nome: 'Alfa' })).segreto;
  await s.scriviFile('prima', 'contenuto di prima');
  const mtime = statSync(base.contenitore).mtimeMs;
  const salva = s.scriviFile('grande', TESTO);
  // Si chiude appena il salvataggio ha cominciato a scrivere sul disco.
  const fine = Date.now() + 10_000;
  while (statSync(base.contenitore).mtimeMs === mtime && Date.now() < fine) await new Promise((ok) => setTimeout(ok, 2));
  await s.chiudi();
  return Promise.allSettled([salva]);
}

test('r1 chiudere a metà salvataggio non lascia nel contenitore niente che si apra senza il nome', async () => {
  test.setTimeout(180_000);
  const dir = cartellaTemporanea('v861-r1-');
  try {
    const base = await contenitore(dir, 64 * MB);
    await chiudiAMetaSalvataggio(base);
    const buf = readFileSync(base.contenitore);
    const zero = Buffer.alloc(32);
    let aperti = 0;
    let conTesto = 0;
    for (let p = 0; p < buf.length / F.BLOCCO; p++) {
      const chiaro = F.apriBlocco(zero, p, buf.subarray(p * F.BLOCCO, (p + 1) * F.BLOCCO));
      if (!chiaro) continue;
      aperti++;
      if (chiaro.includes('TESTO-IN-CHIARO')) conTesto++;
    }
    expect({ aperti, conTesto }).toEqual({ aperti: 0, conTesto: 0 });
  } finally {
    togliCartella(dir);
  }
});

test('r1 chiudere a metà salvataggio non perde il file: riaperto il segreto, c’è intero', async () => {
  test.setTimeout(180_000);
  const dir = cartellaTemporanea('v861-r1-');
  try {
    const base = await contenitore(dir, 64 * MB);
    const [esito] = await chiudiAMetaSalvataggio(base);
    expect(esito.status, esito.reason && String(esito.reason.message)).toBe('fulfilled');
    const r = await M.apriSegreto({ ...base, nome: 'Alfa' });
    expect(r.esito).toBe('aperto');
    expect(r.segreto.elencaFile().map((f) => f.nome).sort()).toEqual(['grande', 'prima']);
    expect((await r.segreto.leggiFile('grande')).equals(TESTO)).toBe(true);
    await r.segreto.chiudi();
  } finally {
    togliCartella(dir);
  }
});
