// Verifica locale, giro 2, rilievo 1: il feedback di un utente approvato come lavoro locale si chiude con npm run finish
// (o server:fondi), e a chi l'ha mandato arriva solo la frase scritta prima: la sessione deve saperlo da qualche parte
// del suo cammino (presa della pratica, chiusura, aiuto di finish). Firestore finto, nessuna rete.

import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const SEGNO = { mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { integerValue: '1790000000000' } } } };
const DOCS = {
  utente: { clientId: { stringValue: 'utente-7' }, status: { stringValue: 'working' }, statusPublic: { stringValue: 'open' }, localOnly: SEGNO, localApproval: SEGNO },
};

test('utente approvato, senza frase: la sessione sa che chi l’ha mandato aspetta la frase', async () => {
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host !== 'firestore.googleapis.com') throw new Error(`rete non prevista: ${u.host}`);
    const id = decodeURIComponent(u.pathname.split('/').pop());
    const doc = DOCS[id];
    if (!doc) return new Response('', { status: 404 });
    if ((init.method || 'GET') !== 'GET') return new Response('{}', { status: 200 });
    const maschera = u.searchParams.getAll('mask.fieldPaths');
    const fields = maschera.length ? Object.fromEntries(Object.entries(doc).filter(([k]) => maschera.includes(k))) : doc;
    return new Response(JSON.stringify({ name: `x/feedback/${id}`, fields }), { status: 200 });
  };
  let presa;
  let chiusura;
  try {
    const OF = await import(pathToFileURL(resolve('scripts/owner-feedback.mjs')).href);
    presa = await OF.praticaPerLaSessione('utente', { bearer: 'finto' });
    chiusura = await OF.praticaPerLaSessione('utente', { bearer: 'finto', allaChiusura: true });
  } finally {
    globalThis.fetch = fetchVero;
  }
  expect(presa.ok && chiusura.ok, 'la pratica approvata si lavora e si chiude').toBe(true);
  const aiuto = execFileSync(process.execPath, ['scripts/finish-local.mjs', '--help'], { encoding: 'utf8', timeout: 60000 });
  const detto = [presa.avviso, chiusura.avviso, aiuto].join('\n');
  expect(detto, 'da qualche parte del cammino la sessione legge che serve la frase per chi ha segnalato').toMatch(/frase/i);
});
