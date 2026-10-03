// Verifica locale, giro 4, rilievi 1 e 3: chiudere a mano con npm run feedback il feedback di un utente approvato
// come lavoro locale. Rilievo 1: senza frase per chi l'ha mandato, la chiusura non la ricorda. Rilievo 3: con una
// frase oltre i 500 caratteri, la chiusura la taglia in silenzio. Firestore finto, caricato prima dello strumento.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SEGNO = { mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { integerValue: '1790000000000' } } } };
const DOCS = {
  uLavoro: { seq: { integerValue: '950' }, clientId: { stringValue: 'utente-7' }, status: { stringValue: 'working' }, statusPublic: { stringValue: 'open' }, localOnly: SEGNO, localApproval: SEGNO },
};

const FINTO = `
import { readFileSync, appendFileSync } from 'node:fs';
const DOCS = JSON.parse(readFileSync(process.env.FAKE_DOCS, 'utf8'));
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const metodo = (init.method || 'GET').toUpperCase();
  if (!/firestore/.test(u.hostname)) return new Response(JSON.stringify({ id_token: 'finto', expires_in: '3600', refresh_token: 'r' }), { status: 200 });
  const id = decodeURIComponent(u.pathname.split('/').pop());
  if (metodo !== 'GET') { appendFileSync(process.env.FAKE_LOG, JSON.stringify({ id, body: init.body ? JSON.parse(init.body) : null }) + '\\n'); return new Response('{}', { status: 200 }); }
  const doc = DOCS[id];
  if (!doc) return new Response('{}', { status: 404 });
  const maschera = u.searchParams.getAll('mask.fieldPaths');
  const fields = maschera.length ? Object.fromEntries(Object.entries(doc).filter(([k]) => maschera.includes(k))) : doc;
  return new Response(JSON.stringify({ name: 'p/x/feedback/' + id, fields }), { status: 200 });
};
`;

function chiudi(argomenti) {
  const dir = cartellaTemporanea('giro4-913-');
  const finto = join(dir, 'finto.mjs');
  const docs = join(dir, 'docs.json');
  const scritture = join(dir, 'scritture.log');
  writeFileSync(finto, FINTO);
  writeFileSync(docs, JSON.stringify(DOCS));
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(finto).href, resolve('scripts/owner-feedback.mjs'), ...argomenti], {
    encoding: 'utf8',
    env: { ...process.env, FAKE_DOCS: docs, FAKE_LOG: scritture, FILO_ADMIN_REFRESH_TOKEN: 'finto', FILO_SA_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '' },
  });
  const scritte = existsSync(scritture) ? readFileSync(scritture, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { codice: r.status, uscita: `${r.stdout}\n${r.stderr}`, scritte };
}

test('chiusa a mano senza frase, la chiusura ricorda la frase per chi l’ha mandato', () => {
  const r = chiudi(['uLavoro', 'done', 'lavoro finito', '--come-routine']);
  expect(r.codice).toBe(0);
  expect(r.scritte.length).toBe(1);
  expect(r.uscita).toMatch(/--frase/);
});

test('chiusa a mano con una frase di 620 caratteri: o la rifiuta col numero, o la scrive intera', () => {
  const lunga = 'a'.repeat(620);
  const r = chiudi(['uLavoro', 'done', 'lavoro finito', '--come-routine', '--frase', lunga]);
  if (r.codice === 0) {
    const frase = r.scritte[0]?.body?.fields?.userNote?.stringValue;
    expect(frase, 'la frase scritta è quella mandata').toBe(lunga);
  } else {
    expect(r.scritte.length, 'rifiutata: niente scritto').toBe(0);
    expect(r.uscita).toMatch(/620/);
  }
});
