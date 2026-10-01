// Verifica locale «lavori locali», giro 4, rilievo 4: quando lo strumento della sessione rifiuta una pratica, i comandi
// che suggerisce devono funzionare su quella pratica. Rete finta: nessuna lettura né scrittura su Firestore vero.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

function docFirestore(id, { clientId, status, senderProof, pipeline }) {
  const fields = { clientId: { stringValue: clientId }, status: { stringValue: status }, statusPublic: { stringValue: 'open' } };
  if (senderProof) fields.senderProof = { stringValue: senderProof };
  if (pipeline) fields.pipeline = { stringValue: JSON.stringify(pipeline) };
  return { name: `projects/x/databases/(default)/documents/feedback/${id}`, fields };
}

async function conRete(docs, fn) {
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
    const id = decodeURIComponent(String(url).split('/feedback/')[1].split('?')[0]);
    const d = docs[id];
    return d ? new Response(JSON.stringify(d), { status: 200 }) : new Response('{}', { status: 404 });
  };
  try { return await fn(); } finally { globalThis.fetch = vero; }
}

const CASI = {
  // Un feedback di un utente fermo nei Ricevuti, pulito.
  utenteNeiRicevuti: { clientId: 'utente-abc', status: 'unlabeled' },
  // Un feedback di una sessione nato senza prova e segnalato dal collegio (la forma del #832).
  sessioneSegnalata: { clientId: 'local:claude', status: 'unlabeled', pipeline: { panelSize: 3, verdicts: [{ class: 'attack' }, { class: 'attack' }, { class: 'aligned' }] } },
};

test('i comandi suggeriti dal rifiuto del segno locale non rifiutano a loro volta', async () => {
  const of = await imp('scripts/owner-feedback.mjs');
  const docs = Object.fromEntries(Object.entries(CASI).map(([k, c]) => [k, docFirestore(k, c)]));
  await conRete(docs, async () => {
    const vicoli = [];
    for (const id of Object.keys(CASI)) {
      const r = await of.segnaLocale(id, true, { bearer: 'finto' });
      expect(r.ok, id).toBe(false);
      const testo = of.rifiutoPratica(id, r);
      if (testo.includes('--serve-locale')) {
        const s = await of.serveLocale(id, 'prova', { bearer: 'finto', dryRun: true });
        if (!s.ok) vicoli.push(`${id}: suggerisce --serve-locale, che risponde «${s.motivo}»`);
      }
      if (testo.includes('--riconosci')) {
        const s = await of.riconosciMittente(id, { bearer: 'finto', dryRun: true });
        if (!s.ok) vicoli.push(`${id}: suggerisce --riconosci, che risponde «${s.motivo}»`);
      }
    }
    expect(vicoli).toEqual([]);
  });
});
