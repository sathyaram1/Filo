// Il biglietto della sessione nelle prove degli strumenti che scrivono note (#1428): in memoria per chi chiama le
// funzioni, su disco con una rete finta per chi lancia lo script. Il server vero non si tocca mai.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FP = 'f'.repeat(64);
export const PULITO = Object.freeze({ ticket: 't'.repeat(40), fp: FP, fiducia: 'fidato' });
export const SPORCO = Object.freeze({ ticket: 't'.repeat(40), fp: FP, fiducia: 'non_fidato' });

/**
 * Per lo script lanciato: il file del biglietto e una rete finta (`--import`) che risponde come Firestore con `doc`, come
 * il server dei biglietti con `fiducia` e come quello della fiducia con `togli` ('ok' | 'no'). Ogni chiamata va nel registro.
 * → { importa: ['--import', url], env, chiamate() }
 */
export function reteFinta(dir, { doc, fiducia = 'fidato', togli = 'ok' }) {
  const biglietto = join(dir, 'biglietto.json');
  writeFileSync(biglietto, `${JSON.stringify({ ticket: PULITO.ticket, fp: FP, natoIl: 1 })}\n`);
  const registro = join(dir, 'chiamate.jsonl');
  writeFileSync(registro, '');
  const finto = join(dir, 'rete-finta.mjs');
  writeFileSync(finto, `
import { appendFileSync } from 'node:fs';
const doc = ${JSON.stringify(doc)};
const annota = (x) => appendFileSync(${JSON.stringify(registro)}, JSON.stringify(x) + '\\n');
const risposta = (o) => new Response(JSON.stringify(o), { status: 200 });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/localTicket')) {
    annota({ chi: 'biglietto', op: JSON.parse(opts.body).data.op });
    return risposta({ result: { fiducia: ${JSON.stringify(fiducia)} } });
  }
  if (u.pathname.endsWith('/ownerFiducia')) {
    annota({ chi: 'fiducia', data: JSON.parse(opts.body).data });
    return risposta({ result: ${togli === 'ok' ? '{ ok: true }' : "{ ok: false, reason: 'rifiutato', detail: 'prova' }"} });
  }
  if (!/firestore/.test(u.hostname)) return risposta({ id_token: 'finto', expires_in: '3600' });
  if ((opts.method || 'GET') !== 'GET') {
    annota({ chi: 'scrittura', campi: u.searchParams.getAll('updateMask.fieldPaths') });
    return risposta({});
  }
  const m = u.searchParams.getAll('mask.fieldPaths');
  const fields = m.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => m.includes(k))) : doc.fields;
  return risposta({ name: doc.name, fields });
};
`);
  // Senza NODE_TEST_CONTEXT: le guardie che tengono lontano il server vero lascerebbero fuori anche la rete finta.
  const env = { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto', FILO_SA_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '', FILO_BIGLIETTO_FILE: biglietto };
  delete env.NODE_TEST_CONTEXT;
  return {
    importa: ['--import', pathToFileURL(finto).href],
    env,
    chiamate: () => readFileSync(registro, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)),
  };
}
