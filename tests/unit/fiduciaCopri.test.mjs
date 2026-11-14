// Le note del manutentore che l'owner ha letto, coperte dalla sua riga di comando (#2215): a secco di default, la
// richiesta che il server capisce, l'esito detto in una riga. Il server vero non si tocca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leggiArgomenti, richiesta, copri } from '../../scripts/fiducia-copri.mjs';

test('un numero solo, col # facoltativo; a secco di default; altro si rifiuta', () => {
  assert.deepEqual(leggiArgomenti(['1919']), { numero: '1919', dalVero: false });
  assert.deepEqual(leggiArgomenti(['#2192.1', '--dal-vero']), { numero: '2192.1', dalVero: true });
  assert.match(leggiArgomenti([]).errore, /serve il numero/);
  assert.match(leggiArgomenti(['1919', '851']).errore, /uno solo/);
  assert.match(leggiArgomenti(['ramo']).errore, /serve il numero/);
  assert.match(leggiArgomenti(['1919', '--server']).errore, /non vale/);
  assert.deepEqual(richiesta({ numero: '1919', dalVero: false }), { op: 'copri', numero: '1919', prova: true });
  assert.deepEqual(richiesta({ numero: '1919', dalVero: true }), { op: 'copri', numero: '1919' });
});

test('l’owner copre #1919: prima a secco, poi dal vero; quello che resta e i rifiuti si leggono', async () => {
  const chiamate = [];
  const righe = [];
  const scrivi = (r) => righe.push(r);
  const chiama = async (data) => { chiamate.push(data); return Object.assign({ ok: true, numero: '1919', coperte: 2, restano: 0 }, data.prova ? { prova: true } : {}); };
  assert.equal(await copri(['1919'], { chiama, scrivi }), 0);
  assert.equal(await copri(['1919', '--dal-vero'], { chiama, scrivi }), 0);
  assert.deepEqual(chiamate.map((c) => c.prova === true), [true, false]);
  assert.equal(righe[0], '#1919: si coprono 2 note del manutentore. Rilancia con --dal-vero se le hai lette.');
  assert.equal(righe[1], '#1919: coperte 2 note del manutentore. Il lavoro può ripartire.');
  const resta = async () => ({ ok: true, numero: '2192', coperte: 1, restano: 1, restaLocale: ['contenuto scritto da un biglietto sporco'] });
  assert.equal(await copri(['2192', '--dal-vero'], { chiama: resta, scrivi }), 0);
  assert.equal(righe[2], '#2192: coperta una nota del manutentore; restano 1 scritture di altri, che lo sporcano ancora. Resta locale: contenuto scritto da un biglietto sporco.');
  assert.equal(await copri(['851'], { chiama: async () => ({ ok: true, numero: '851', coperte: 0, restano: 0, prova: true }), scrivi }), 0);
  assert.equal(righe[3], '#851: nessuna nota del manutentore da coprire.');
  assert.equal(await copri(['7', '--dal-vero'], { chiama: async () => ({ ok: false, reason: 'feedback_inesistente', detail: 'nessun feedback #7' }), scrivi }), 1);
  assert.equal(righe[4], 'Non si copre: nessun feedback #7.');
  assert.equal(await copri(['1919'], { chiama: async () => { throw new Error('rete caduta'); }, scrivi }), 1);
  assert.match(righe[5], /rete caduta/);
  assert.equal(await copri([], { chiama, scrivi }), 2);
});

test('il comando ha il suo nome fra gli script del progetto, e passa dalla chiamata comune col token dell’owner', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['fiducia:copri'], 'node scripts/fiducia-copri.mjs');
  const visti = [];
  const fetchImpl = async (url, init) => { visti.push({ url: String(url), init }); return new Response(JSON.stringify({ result: { ok: true, numero: '1919', coperte: 1, restano: 0, prova: true } }), { status: 200 }); };
  const righe = [];
  assert.equal(await copri(['1919'], { rete: { fetchImpl, idToken: async () => 'tok-owner' }, scrivi: (r) => righe.push(r) }), 0);
  assert.match(visti[0].url, /\/ownerFiducia$/);
  assert.equal(visti[0].init.headers.Authorization, 'Bearer tok-owner');
  assert.deepEqual(JSON.parse(visti[0].init.body), { data: { op: 'copri', numero: '1919', prova: true } });
  assert.match(righe[0], /si copre/);
});
