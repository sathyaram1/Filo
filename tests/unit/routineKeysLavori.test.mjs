// La chiave della routine server (#1253): `rete` e `lavori` arrivano al server così come l'owner li scrive, un valore
// sbagliato non chiama il server, e l'elenco li mostra.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('routine-keys: rete e lavori si scrivono sul server, si vedono nell’elenco, e un valore sbagliato non chiama niente', async () => {
  const dir = cartellaTemporanea('filo-chiavi-lavori-');
  try {
    const finto = join(dir, 'finto.mjs');
    writeFileSync(finto, `globalThis.fetch = async (url, init) => {
  if (!String(url).includes('routineKeys')) return new Response(JSON.stringify({ id_token: 'idt', expires_in: '3600', user_id: 'u' }), { status: 200 });
  const d = JSON.parse(String(init.body)).data;
  process.stderr.write('CHIAMATA ' + JSON.stringify(d) + '\\n');
  if (d.op === 'list') return new Response(JSON.stringify({ result: { keys: [
    { slug: 'server', scope: 'routine', revoked: false, account: 'B', rete: 'limitata', lavori: 'server' },
    { slug: 'notturna', scope: 'routine', revoked: false, account: 'A', rete: 'aperta', lavori: 'normali' },
  ] } }), { status: 200 });
  return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 });
};
`);
    const corri = (args) => new Promise((ok) => {
      execFile(process.execPath, [`--import=${pathToFileURL(finto).href}`, join(ROOT, 'scripts', 'routine-keys.mjs'), ...args],
        { env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto' } }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: so, err: se }));
    });
    const chiamate = (r) => r.err.split('\n').filter((l) => l.startsWith('CHIAMATA ')).map((l) => JSON.parse(l.slice(9)));

    const l = await corri(['lavori', 'server', 'server']);
    assert.equal(l.code, 0, l.err);
    assert.deepEqual(chiamate(l), [{ op: 'lavori', slug: 'server', lavori: 'server' }]);
    assert.match(l.out, /solo lavori server/);
    const n = await corri(['lavori', 'server', 'normali']);
    assert.deepEqual(chiamate(n), [{ op: 'lavori', slug: 'server', lavori: 'normali' }]);
    const r = await corri(['rete', 'server', 'limitata']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(chiamate(r), [{ op: 'rete', slug: 'server', rete: 'limitata' }]);

    for (const args of [['lavori', 'server', 'tutti'], ['lavori', 'server'], ['rete', 'server', 'chiusa'], ['rete', 'server', 'limitata', 'x']]) {
      const x = await corri(args);
      assert.equal(x.code, 1, args.join(' '));
      assert.deepEqual(chiamate(x), [], `${args.join(' ')}: nessuna chiamata`);
      assert.match(x.err, /Uso: node scripts\/routine-keys\.mjs (lavori <nome> <server\|normali>|rete <nome> <limitata\|aperta>)/);
    }

    const e = await corri(['elenco']);
    assert.equal(e.code, 0, e.err);
    const riga = (slug) => e.out.split('\n').find((x) => x.startsWith(slug));
    assert.match(riga('server'), /rete limitata\s+lavori server\s+attiva/);
    assert.match(riga('notturna'), /rete aperta/);
    assert.doesNotMatch(riga('notturna'), /lavori server/);
  } finally { togliCartella(dir); }
});
