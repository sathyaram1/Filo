// Verifica #1521 giro 1, rilievo 2: server:fondi che esce 0 senza spingere (ramo già dentro main) non deve far
// registrare dal server lo sha su cui main sta, come se l'avesse portato il PC.
import { test, expect } from '@playwright/test';
import { esegui } from '../../../scripts/server-fondi-pratica.mjs';
import { FIRESTORE_BASE } from '../../../scripts/lib/firestore-auth.mjs';
import { sessione } from '../../../scripts/owner-feedback.mjs';
import { PULITO } from '../../helpers/bigliettoFinto.mjs';

sessione.biglietto = async () => PULITO;

function doc(id) {
  return {
    name: `projects/x/databases/(default)/documents/feedback/${id}`,
    fields: {
      seq: { integerValue: '910' }, clientId: { stringValue: 'local:claude' }, status: { stringValue: 'todo' },
      statusPublic: { stringValue: 'open' }, notes: { stringValue: '' }, senderProof: { stringValue: 'admin' },
      fiducia: { stringValue: 'fidato' },
      localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
    },
  };
}

test('r2 un server:fondi che non ha spinto niente non registra main come portato dal PC', async () => {
  const docs = { p: doc('p') };
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
    const id = decodeURIComponent(String(url).split('/feedback/')[1].split('?')[0]);
    return docs[id] ? new Response(JSON.stringify(docs[id]), { status: 200 }) : new Response('{}', { status: 404 });
  };
  const registrati = [];
  const MAIN = 'e'.repeat(40);
  try {
    await esegui(['claude/x', '--feedback', 'p', '--solo-server'], {
      env: {}, bearer: 'finto', base: FIRESTORE_BASE, funzioni: '/srv/functions',
      log: () => {}, err: () => {},
      // server:fondi esce 0 con «già dentro origin/main»: main non si muove, prima e dopo sta sullo stesso sha.
      lancia: () => 0,
      punta: () => MAIN, ramiAperti: () => [], ora: () => Date.parse('2026-10-03T10:00:00Z'), verdetto: () => null,
      fissa: (_c, ramo, sha) => ({ ok: true, ramo: `${ramo}-verificato-${sha.slice(0, 12)}`, togli: () => ({ ok: true }) }),
      lavoroDelRamo: async () => ({ ok: true, registro: true, lavoroFidato: true, attesa: '', motivo: '' }),
      puntaRamo: () => 'c'.repeat(40),
      chiediAlCancello: async () => ({ outcome: 'fault', reason: 'nessun cancello nella prova' }),
      allinea: () => {}, deployDaGitHub: () => false,
      registraMain: async (x) => { registrati.push(x); return { outcome: 'registrato' }; },
    });
  } finally { globalThis.fetch = vero; }
  expect(registrati, 'main non si è mosso: lo sha su cui sta non l’ha portato questo server:fondi').toEqual([]);
});
