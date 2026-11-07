// La sanatoria di un registro bucato dalla riga di comando dell'owner (#2021): a secco di default, la richiesta che il
// server capisce, l'esito detto in una riga. Il server vero non si tocca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leggiArgomenti, richiesta, sana } from '../../scripts/fiducia-sana.mjs';

const RAMO = 'worker/Dff9ZSEFsHXwIZMJ8OfeGQAM-20261101T091523Z';

test('un ramo solo; --server sceglie il registro del server; a secco di default; altro si rifiuta', () => {
  assert.deepEqual(leggiArgomenti([RAMO]), { ramo: RAMO, repo: 'app', dalVero: false });
  assert.deepEqual(leggiArgomenti([RAMO, '--server', '--dal-vero']), { ramo: RAMO, repo: 'server', dalVero: true });
  assert.match(leggiArgomenti([]).errore, /serve un ramo/);
  assert.match(leggiArgomenti([RAMO, 'altro']).errore, /uno solo/);
  assert.match(leggiArgomenti([RAMO, '--force']).errore, /non vale/);
});

test('a secco chiede solo se si può; --dal-vero chiede di togliere il buco', () => {
  assert.deepEqual(richiesta({ ramo: RAMO, repo: 'app', dalVero: false }), { op: 'sana', repo: 'app', ramo: RAMO, prova: true });
  assert.deepEqual(richiesta({ ramo: RAMO, repo: 'app', dalVero: true }), { op: 'sana', repo: 'app', ramo: RAMO });
});

test('l\'owner sana #1959: prima a secco, poi dal vero, e un rifiuto del server si legge col suo motivo', async () => {
  const chiamate = [];
  const righe = [];
  const chiama = async (data) => { chiamate.push(data); return data.prova ? { ok: true, prova: true, punta: '806d3cb949af'.padEnd(40, '0'), commits: 12 } : { ok: true, punta: '806d3cb949af'.padEnd(40, '0'), commits: 12 }; };
  assert.equal(await sana([RAMO], { chiama, scrivi: (r) => righe.push(r) }), 0);
  assert.equal(await sana([RAMO, '--dal-vero'], { chiama, scrivi: (r) => righe.push(r) }), 0);
  assert.deepEqual(chiamate.map((c) => c.prova === true), [true, false]);
  assert.match(righe[0], /Si può sanare \(12 commit/);
  assert.match(righe[1], /^Sanato: .*806d3cb949af/);
  const no = async () => ({ ok: false, reason: 'non_sanabile', detail: 'il commit 0525bdf4 è nato quando nessuna sessione pulita registrata sul ramo era viva' });
  assert.equal(await sana([RAMO, '--dal-vero'], { chiama: no, scrivi: (r) => righe.push(r) }), 1);
  assert.match(righe[2], /^Non si sana: il commit 0525bdf4/);
  assert.equal(await sana([RAMO], { chiama: async () => { throw new Error('rete caduta'); }, scrivi: (r) => righe.push(r) }), 1);
  assert.match(righe[3], /rete caduta/);
});

test('il comando ha il suo nome fra gli script del progetto', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['fiducia:sana'], 'node scripts/fiducia-sana.mjs');
});

// #2021.1: la stessa chiamata di chi toglie la fiducia, quindi la rete che cade si ritenta e i rifiuti si dicono a parole.
function reteFinta(risposte) {
  const visti = [];
  const fetchImpl = async (url, init) => {
    visti.push({ url: String(url), init });
    const r = risposte[Math.min(visti.length - 1, risposte.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo), { status: r.status });
  };
  return { visti, fetchImpl };
}
const cadutaDiSocket = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });

test('la rete che cade a metà si ritenta: la sanatoria arriva, col token dell’owner e la sola richiesta «sana»', async () => {
  const righe = [];
  const rete = reteFinta([cadutaDiSocket(), { status: 200, corpo: { result: { ok: true, prova: true, punta: 'a'.repeat(40), commits: 3 } } }]);
  const codice = await sana([RAMO], { rete: { fetchImpl: rete.fetchImpl, idToken: async () => 'tok-owner' }, scrivi: (r) => righe.push(r) });
  assert.equal(codice, 0, righe.join('\n'));
  assert.match(righe[0], /^Si può sanare \(3 commit/);
  assert.equal(rete.visti.length, 2, 'un secondo tentativo dopo la connessione caduta');
  assert.equal(rete.visti[1].init.headers.Authorization, 'Bearer tok-owner');
  assert.deepEqual(JSON.parse(rete.visti[1].init.body), { data: { op: 'sana', repo: 'app', ramo: RAMO, prova: true } });
});

test('credenziale non dell’owner, funzione assente, rete assente, nessuna credenziale: ognuno detto a parole', async () => {
  const prova = async (risposte, idToken = async () => 'tok') => {
    const righe = [];
    const codice = await sana([RAMO, '--dal-vero'], { rete: { fetchImpl: reteFinta(risposte).fetchImpl, idToken }, scrivi: (r) => righe.push(r) });
    assert.equal(codice, 1);
    return righe[0];
  };
  assert.equal(await prova([{ status: 403, corpo: { error: { status: 'PERMISSION_DENIED', message: 'not owner' } } }]),
    'Non si sana: il server non riconosce questa credenziale come proprietario.');
  assert.match(await prova([{ status: 404, corpo: {} }]), /^Non si sana: la funzione della fiducia non è pubblicata sul server\.$/);
  const assente = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
  assert.match(await prova([assente]), /^Non si sana: fetch failed: getaddrinfo ENOTFOUND/);
  assert.match(await prova([{ status: 200, corpo: {} }], async () => ''), /nessuna credenziale dell’owner/);
});
