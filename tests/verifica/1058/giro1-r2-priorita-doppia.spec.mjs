// #1058 giro 1 — r2: due valori diversi per la stessa opzione nello stesso comando non devono vincere in silenzio
// (oggi passa il primo e il secondo sparisce): con --priorita si scrive una priorità che chi lancia non ha deciso.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SCRIPT = fileURLToPath(new URL('../../../scripts/owner-feedback.mjs', import.meta.url));

function reteFinta(dir) {
  const registro = join(dir, 'scritture.jsonl');
  const finto = join(dir, 'rete.mjs');
  writeFileSync(finto, `
import { appendFileSync } from 'node:fs';
const doc = { name: 'projects/p/databases/(default)/documents/feedback/fid', fields: { status: { stringValue: 'todo' }, statusPublic: { stringValue: 'open' }, priority: { integerValue: '1' } } };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (!/firestore/.test(u.hostname)) return new Response(JSON.stringify({ id_token: 'finto', expires_in: '3600' }), { status: 200 });
  if (u.pathname.endsWith(':runQuery')) return new Response(JSON.stringify([{ document: { name: doc.name, fields: { subSeq: { integerValue: '0' } } } }]), { status: 200 });
  if ((opts.method || 'GET') !== 'GET') { appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ url: String(url), body: JSON.parse(opts.body) }) + '\\n'); return new Response('{}', { status: 200 }); }
  const m = u.searchParams.getAll('mask.fieldPaths');
  const fields = m.length ? Object.fromEntries(Object.entries(doc.fields).filter(([k]) => m.includes(k))) : doc.fields;
  return new Response(JSON.stringify({ name: doc.name, fields }), { status: 200 });
};`);
  const lancia = (args) => spawnSync(process.execPath, ['--import', pathToFileURL(finto).href, SCRIPT, ...args], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto', FILO_SA_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '' },
  });
  const scritte = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { lancia, scritte };
}

test('r2 `--priorita 3 --priorita 1` si rifiuta col motivo e non scrive niente', () => {
  const { lancia, scritte } = reteFinta(cartellaTemporanea('verifica-1058-'));
  const r = lancia(['1058', '--priorita', '3', '--priorita', '1']);
  expect(r.status, r.stdout).not.toBe(0);
  expect(r.stderr).toMatch(/--priorita/);
  expect(scritte()).toEqual([]);
});
