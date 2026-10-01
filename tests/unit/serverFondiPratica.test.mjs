// Il lavoro locale sul server ha la sua pratica (#908): il comando del repo Filo la controlla, la prende in carico,
// lancia server:fondi di filo-security con la pratica e a fusione riuscita la chiude. Rete e server finti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import {
  cartellaDelServer, leggiArgomenti, esegui, ramiApertiDellaPratica, PRATICA_ENV,
} from '../../scripts/server-fondi-pratica.mjs';
import { FIRESTORE_BASE } from '../../scripts/lib/firestore-auth.mjs';

test('cartellaDelServer: il checkout del server accanto al repo, dal checkout principale e da una sua worktree', () => {
  const server = resolve('/x', 'filo-security', 'functions');
  const esiste = (p) => p === join(server, 'tools', 'server-fondi.js');
  assert.equal(cartellaDelServer(resolve('/x', 'Filo'), esiste), server);
  assert.equal(cartellaDelServer(resolve('/x', 'Filo', '.claude', 'worktrees', 'lavoro'), esiste), server);
  assert.equal(cartellaDelServer(resolve('/y', 'Filo'), () => false), '');
});

test('leggiArgomenti: ramo, pratica e prova a vuoto, anche quando npm si prende le opzioni', () => {
  assert.deepEqual(leggiArgomenti(['claude/x', '--feedback', '910']), { ramo: 'claude/x', pratica: '910', dryRun: false, nota: null });
  assert.equal(leggiArgomenti(['claude/x', '--feedback=#910', '--dry-run']).dryRun, true);
  const npm = leggiArgomenti(['claude/x'], { npm_config_feedback: '910', npm_config_dry_run: 'true' });
  assert.equal(npm.pratica, '910');
  assert.equal(npm.dryRun, true);
  assert.match(leggiArgomenti(['claude/x', '--forza']).errore, /non capiti/);
  assert.match(leggiArgomenti(['claude/x', 'claude/y']).errore, /un ramo solo/);
  assert.equal(leggiArgomenti(['claude/x']).pratica, null);
});

function doc(id, { clientId = 'local:claude', senderProof = 'admin', status = 'todo', locale = true } = {}) {
  const fields = {
    seq: { integerValue: '910' }, clientId: { stringValue: clientId }, status: { stringValue: status },
    statusPublic: { stringValue: 'open' }, notes: { stringValue: '' },
  };
  if (senderProof) fields.senderProof = { stringValue: senderProof };
  if (locale) fields.localOnly = { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } };
  return { name: `projects/x/databases/(default)/documents/feedback/${id}`, fields };
}

async function conRete(docs, fn) {
  const vero = globalThis.fetch;
  const scritture = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') { scritture.push(String(url)); return new Response('{}', { status: 200 }); }
    const id = decodeURIComponent(String(url).split('/feedback/')[1].split('?')[0]);
    return docs[id] ? new Response(JSON.stringify(docs[id]), { status: 200 }) : new Response('{}', { status: 404 });
  };
  try { return await fn(scritture); } finally { globalThis.fetch = vero; }
}

function giro({ docs, argv, codiceServer = 0, ramiAperti = [] }) {
  return conRete(docs, async (scritture) => {
    const lanci = [];
    const righe = [];
    const k = await esegui(argv, {
      env: {}, bearer: 'finto', base: FIRESTORE_BASE, funzioni: '/srv/functions',
      log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)),
      lancia: (cartella, args, env) => { lanci.push({ cartella, args, pratica: env[PRATICA_ENV] }); return codiceServer; },
      punta: () => 'a'.repeat(40), ramiAperti: () => ramiAperti,
    });
    return { k, lanci, scritture, testo: righe.join('\n') };
  });
}

test('senza pratica non parte niente, e si dice come aprirla', async () => {
  const r = await giro({ docs: {}, argv: ['claude/x'] });
  assert.equal(r.k, 1);
  assert.match(r.testo, /feedback:apri -- .* --locale/);
  assert.match(r.testo, /--feedback <N>/);
  assert.deepEqual(r.lanci, []);
  assert.deepEqual(r.scritture, []);
});

test('la pratica di un utente, o senza segno locale, si rifiuta prima di toccare il server', async () => {
  for (const d of [doc('p', { clientId: 'abc', senderProof: '' }), doc('p', { locale: false })]) {
    const r = await giro({ docs: { p: d }, argv: ['claude/x', '--feedback', 'p'] });
    assert.equal(r.k, 3, r.testo);
    assert.match(r.testo, /RIFIUTATO/);
    assert.deepEqual(r.lanci, []);
    assert.deepEqual(r.scritture, []);
  }
  const chiusa = await giro({ docs: { p: doc('p', { status: 'done' }) }, argv: ['claude/x', '--feedback', 'p'] });
  assert.equal(chiusa.k, 3, chiusa.testo);
  assert.match(chiusa.testo, /aprine una/);
  assert.deepEqual(chiusa.lanci, []);
});

test('a vuoto: il server parte con la pratica e --dry-run, e sulla pratica non si scrive niente', async () => {
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--dry-run'] });
  assert.equal(r.k, 0, r.testo);
  assert.deepEqual(r.lanci, [{ cartella: '/srv/functions', args: ['claude/x', '--dry-run'], pratica: '#910' }]);
  assert.deepEqual(r.scritture, []);
});

test('davvero: presa in carico, server con la pratica, e a fusione riuscita la pratica si chiude', async () => {
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p'] });
  assert.equal(r.k, 0, r.testo);
  assert.deepEqual(r.lanci, [{ cartella: '/srv/functions', args: ['claude/x'], pratica: '#910' }]);
  assert.equal(r.scritture.length, 2, r.scritture.join('\n'));
  assert.ok(!r.scritture[0].includes('resolvedInVersion'), 'la prima scrittura è la presa in carico');
  assert.ok(r.scritture[1].includes('resolvedInVersion'), 'la seconda chiude la pratica');
  assert.match(r.testo, /Pratica #910 chiusa/);
});

test('se il server si ferma la pratica resta in lavorazione, con la nota del motivo', async () => {
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p'], codiceServer: 1 });
  assert.equal(r.k, 1);
  assert.equal(r.scritture.length, 2);
  assert.ok(r.scritture.every((u) => !u.includes('resolvedInVersion')), 'non si chiude');
  assert.match(r.testo, /resta in lavorazione/);
});

test('un lavoro che tocca anche l’app: dopo il server la pratica resta aperta, la chiude la fusione dell’app', async () => {
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p'], ramiAperti: ['claude/app'] });
  assert.equal(r.k, 0, r.testo);
  assert.equal(r.scritture.length, 2);
  assert.ok(r.scritture.every((u) => !u.includes('resolvedInVersion')), 'non si chiude');
  assert.match(r.testo, /resta aperta: la chiude la fusione di claude\/app/);
});

test('ramiApertiDellaPratica: i rami dell’app legati alla pratica in ogni worktree, tranne quelli già su main', () => {
  const lista = 'worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b\nHEAD 2\nbranch refs/heads/claude/app\n';
  const stati = {
    [join('/a', '.claude', 'verify-local.json')]: { 'claude/vecchio': { feedbackId: 'p' } },
    [join('/b', '.claude', 'verify-local.json')]: { 'claude/app': { feedbackId: 'p' }, 'claude/altro': { feedbackId: 'q' } },
  };
  const git = (cwd, args) => {
    if (args[0] === 'worktree') return lista;
    return args[2] === 'claude/vecchio' ? '' : null; // il vecchio è già dentro origin/main
  };
  assert.deepEqual(ramiApertiDellaPratica('p', { radice: '/a', git, leggi: (f) => stati[f] || null }), ['claude/app']);
  assert.deepEqual(ramiApertiDellaPratica('z', { radice: '/a', git, leggi: (f) => stati[f] || null }), []);
});
