// Verifica locale «lavori server» (#1159), giro 2, rilievo 2: un lavoro server che le routine hanno fatto solo
// nell'app (su filo-security il ramo non c'è) e che ha passato la verifica non resta per sempre ad aspettare il PC.
// Non apre Filo e non va in rete: il giro del PC con passi finti, la decisione sul ramo del server è quella vera.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('r2 un lavoro server fatto solo nell’app, passato, al giro del PC torna alle routine', async () => {
  const { fusioniServer } = await imp('scripts/lib/fusioni-server.mjs');
  const { controllaRamoServer } = await imp('scripts/server-fondi-pratica.mjs');
  const ramo = 'worker/solo-app-20261013T100000Z';
  const tornate = [];
  const righe = [];
  const esito = await fusioniServer({
    radice: ROOT,
    log: (r) => righe.push(r),
    attese: async () => [{ feedbackId: 'FBSOLOAPP', seq: 77, subSeq: 0, branch: ramo, parti: {} }],
    esegui: async (cmd, args) => {
      // La parte dell'app: tre commit oltre main.
      if (cmd === 'git' && args[0] === 'rev-list') return { code: 0, out: '3\n' };
      if (cmd === 'git') return { code: 0, out: '' };
      // server:fondi della pratica: su filo-security il ramo non c'è e il registro del server non ha voci.
      const r = await controllaRamoServer({ ramo, feedbackId: 'FBSOLOAPP', verdetto: null, cartella: '' }, {
        puntaRamo: () => '',
        lavoroDelRamo: async () => ({ ok: true, lavoroFidato: false, registro: false, attesa: 'fusione_server' }),
      });
      return r.ok ? { code: 0, out: '' } : { code: r.codice, out: r.motivo };
    },
    pubblica: async () => ({ code: 0, out: '' }),
    fineAttesa: async (id) => { tornate.push(id); },
  });
  expect(esito.ferme, righe.concat(esito.ferme.map((f) => f.motivo)).join('\n')).toEqual([]);
  expect(tornate).toEqual(['FBSOLOAPP']);
});
