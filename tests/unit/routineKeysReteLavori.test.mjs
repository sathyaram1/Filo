// Rete e lavori di una parola d'ordine si scrivono da qui (#1244): solo la chiave «server» a rete limitata prende i
// lavori server. Un valore sbagliato si rifiuta prima di chiamare il server; l'elenco mostra cosa ha ogni chiave.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fintoServer(dir) {
  const finto = join(dir, 'finto.mjs');
  const registro = join(dir, 'chiamate.jsonl');
  writeFileSync(finto, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('routineKeys')) return new Response(JSON.stringify({ id_token: 'idt', expires_in: '3600', user_id: 'u' }), { status: 200 });
  const d = JSON.parse(String(init.body)).data;
  appendFileSync(${JSON.stringify(registro)}, JSON.stringify(d) + '\\n');
  if (d.op === 'list') return new Response(JSON.stringify({ result: { keys: [
    { slug: 'server-1', scope: 'routine', account: 'B', rete: 'limitata', lavori: 'server', revoked: false },
    { slug: 'notturna', scope: 'routine', account: 'A', rete: 'aperta', lavori: 'normali', revoked: false },
  ] } }), { status: 200 });
  return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 });
};
`);
  const chiamate = () => {
    try { return readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  };
  const lancia = (...args) => new Promise((ok) => {
    execFile(process.execPath, [`--import=${pathToFileURL(finto).href}`, join(ROOT, 'scripts', 'routine-keys.mjs'), ...args],
      { env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto' } }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: so, err: se }));
  });
  return { lancia, chiamate };
}

test('rete e lavori: chiamano la callable coi valori giusti; un valore sbagliato non chiama niente', async () => {
  const dir = cartellaTemporanea('filo-chiavi-lavori-');
  try {
    const { lancia, chiamate } = fintoServer(dir);
    let r = await lancia('lavori', 'server-1', 'server');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /node scripts\/routine-keys\.mjs rete server-1 limitata/, 'la chiave nasce a rete aperta: il passo che manca si ricorda');
    r = await lancia('rete', 'server-1', 'limitata');
    assert.equal(r.code, 0, r.err);
    r = await lancia('lavori', 'notturna', 'normali');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(chiamate(), [
      { op: 'lavori', slug: 'server-1', lavori: 'server' },
      { op: 'rete', slug: 'server-1', rete: 'limitata' },
      { op: 'lavori', slug: 'notturna', lavori: 'normali' },
    ]);
    for (const args of [['lavori', 'x', 'Server'], ['lavori', 'x'], ['rete', 'x', 'chiusa'], ['rete', 'x', 'limitata', 'in più']]) {
      r = await lancia(...args);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.err, /Uso: node scripts\/routine-keys\.mjs (lavori|rete) <nome>/, args.join(' '));
    }
    assert.equal(chiamate().length, 3, 'nessuna chiamata coi valori sbagliati');
  } finally { togliCartella(dir); }
});

test('l’elenco dice rete e lavori di ogni chiave di routine', async () => {
  const dir = cartellaTemporanea('filo-chiavi-elenco-');
  try {
    const { lancia } = fintoServer(dir);
    const r = await lancia('elenco');
    assert.equal(r.code, 0, r.err);
    const riga = (slug) => r.out.split('\n').find((l) => l.startsWith(slug));
    assert.match(riga('server-1'), /rete limitata\s+lavori server/);
    assert.match(riga('notturna'), /rete aperta\s+lavori normali/);
  } finally { togliCartella(dir); }
});
