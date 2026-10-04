// Verifica locale cancello-storia, giro 1, rilievo 1: su un clone di profondità 1 del solo ramo, il primo download
// di main porta con sé tutta la storia di main e ha il tetto di tempo corto, non quello della storia. Qui il git
// col tetto corto «scade» su ogni download intero da un clone poco profondo, come succede sul repo vero con una
// rete lenta (124 s misurati contro i 120 del tetto): la prova deve riuscire lo stesso.
import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { cloneFinto, unitFinti } from './storia-finta.mjs';

const ROOT = resolve(process.cwd());

test('il download della storia di main da un clone poco profondo ha il tetto lungo, non quello corto', async () => {
  test.setTimeout(300000);
  const m = await import(pathToFileURL(resolve(ROOT, 'scripts/lib/unit-sulla-fusione.mjs')).href);
  const { clone, punta } = cloneFinto(cartellaTemporanea('cancello-storia-r1-'));
  const vero = m.gitIn(clone);
  const corto = (args) => {
    const shallow = vero(['rev-parse', '--is-shallow-repository']).out === 'true';
    const limitato = args.some((a) => /^--(depth|deepen|shallow-since|shallow-exclude)/.test(a));
    if (args[0] === 'fetch' && shallow && !limitato) return { ok: false, out: 'spawnSync git ETIMEDOUT' };
    return vero(args);
  };
  const r = m.provaUnitSullaFusione({ root: clone, punta, git: corto, gitStoria: m.gitIn(clone, m.TETTO_STORIA_MS), lancia: unitFinti, scrivi: () => {} });
  expect(r.errore, 'la prova non deve fallire per il tetto corto sul download della storia').toBeUndefined();
  expect(r.esito).toBe('verde');
  expect(r.storia && r.storia.superficiale).toBe(true);
});
