// Verifica locale, giro 4, rilievo 2: il promemoria della frase che server:fondi (e npm run finish) stampa a pratica
// chiusa propone «npm run feedback -- #951 --frase …». Incollato in bash o in PowerShell, dal cancelletto in poi è un
// commento: parte npm run feedback senza argomenti. Firestore finto, server:fondi con il lancio del server finto.

import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SEGNO = { mapValue: { fields: { by: { stringValue: 'owner@esempio' }, at: { integerValue: '1790000000000' } } } };
const DOC = { seq: { integerValue: '951' }, subSeq: { integerValue: '0' }, clientId: { stringValue: 'utente-7' }, status: { stringValue: 'working' }, statusPublic: { stringValue: 'open' }, localOnly: SEGNO, localApproval: SEGNO };

test('server:fondi a pratica chiusa: il comando della frase si può incollare così com’è', async () => {
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: 'p/x/feedback/uChiusa', fields: DOC } }]), { status: 200 });
    if ((init.method || 'GET') !== 'GET') return new Response('{}', { status: 200 });
    const maschera = u.searchParams.getAll('mask.fieldPaths');
    const fields = maschera.length ? Object.fromEntries(Object.entries(DOC).filter(([k]) => maschera.includes(k))) : DOC;
    return new Response(JSON.stringify({ name: 'p/x/feedback/uChiusa', fields }), { status: 200 });
  };
  const righe = [];
  try {
    const SF = await import(pathToFileURL(resolve('scripts/server-fondi-pratica.mjs')).href);
    const codice = await SF.esegui(['claude/prova', '--feedback', '951'], {
      env: {}, log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)),
      funzioni: 'finta', bearer: 'finto', base: 'https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents',
      lancia: () => 0, punta: () => 'a'.repeat(40), ramiAperti: () => [],
    });
    expect(codice, righe.join('\n')).toBe(0);
  } finally {
    globalThis.fetch = fetchVero;
  }
  const promemoria = righe.find((r) => /--frase/.test(r));
  expect(promemoria, 'il promemoria c’è').toBeTruthy();
  const comando = /npm run feedback -- (\S+) --frase/.exec(promemoria);
  expect(comando, promemoria).toBeTruthy();
  expect(comando[1].startsWith('#'), `nel comando «${comando[0]}» il riferimento apre un commento della shell`).toBe(false);
});
