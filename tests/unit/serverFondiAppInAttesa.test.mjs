// #2199.5: con la parte dell'app in attesa del server, server:fondi dal PC dà alle prove del server main di Filo con
// l'app fusa (i generati del ramo del server vengono da lì), e se il server arriva su main senza il cancello gli chiede
// di portare l'app rimasta in attesa. Git vero in una cartella temporanea, rete e server finti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { esegui, filoConLApp } from '../../scripts/server-fondi-pratica.mjs';
import { FIRESTORE_BASE } from '../../scripts/lib/firestore-auth.mjs';
import { sessione } from '../../scripts/owner-feedback.mjs';
import { PULITO } from '../helpers/bigliettoFinto.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

sessione.biglietto = async () => PULITO;

const RAMO = 'claude/fonte-42';
const FONTE = join('src', 'shared', 'feedbackAttese.js');
const SHA_SERVER = 'c'.repeat(40);
const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@filo.invalid', ...args], { cwd, encoding: 'utf8' });

/** Il checkout di Filo su main, come quello dell'owner accanto al server; il ramo dell'app cambia una fonte del bake. */
function filoDiProva(casa, { conflitto = false } = {}) {
  const filo = join(casa, 'Filo');
  mkdirSync(join(filo, 'src', 'shared'), { recursive: true });
  git(filo, ['init', '-q', '-b', 'main']);
  writeFileSync(join(filo, FONTE), 'const RILETTURE = 8;\n');
  git(filo, ['add', '-A']);
  git(filo, ['commit', '-q', '-m', 'main']);
  git(filo, ['checkout', '-q', '-b', RAMO]);
  writeFileSync(join(filo, FONTE), 'const RILETTURE = 9;\n');
  git(filo, ['commit', '-q', '-am', 'app: cambia una fonte del bake']);
  git(filo, ['checkout', '-q', 'main']);
  if (conflitto) {
    writeFileSync(join(filo, FONTE), 'const RILETTURE = 7;\n');
    git(filo, ['commit', '-q', '-am', 'main va altrove']);
  }
  return filo;
}

function pratica() {
  const fields = {
    seq: { integerValue: '42' }, clientId: { stringValue: 'local:claude' }, status: { stringValue: 'working' },
    statusPublic: { stringValue: 'open' }, notes: { stringValue: '' }, senderProof: { stringValue: 'admin' },
    fiducia: { stringValue: 'fidato' },
    localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
  };
  return { name: 'projects/x/databases/(default)/documents/feedback/p', fields };
}

async function giro({ filo, casa, ramiApp = [RAMO], codiceServer = 0, cancello = () => ({ outcome: 'merged', sha: SHA_SERVER }) }) {
  const vero = globalThis.fetch;
  const doc = pratica();
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
    return String(url).includes('/feedback/p') ? new Response(JSON.stringify(doc), { status: 200 }) : new Response('{}', { status: 404 });
  };
  const lette = [];
  const alCancello = [];
  const righe = [];
  try {
    const k = await esegui([RAMO, '--feedback', 'p'], {
      env: {}, bearer: 'finto', base: FIRESTORE_BASE, radice: filo, funzioni: join(casa, 'filo-security', 'functions'),
      log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)),
      verdetto: () => ({ ok: true, reason: 'verificato', server: { sha: SHA_SERVER } }),
      fissa: (_c, ramo, sha) => ({ ok: true, ramo: `${ramo}-verificato-${sha.slice(0, 12)}`, togli: () => ({ ok: true }) }),
      lavoroDelRamo: async () => ({ ok: true, registro: false, lavoroFidato: false, attesa: '', motivo: 'il ramo non ha un registro' }),
      puntaRamo: () => SHA_SERVER, ramiAperti: () => ramiApp, ora: () => Date.now(), punta: () => SHA_SERVER,
      // Lo strumento del server prova la punta leggendo le fonti da FILO_PUBLIC_REPO o, senza, dal checkout ../Filo.
      lancia: (_cartella, _args, env) => {
        const pub = env.FILO_PUBLIC_REPO || filo;
        lette.push({ testo: readFileSync(join(pub, FONTE), 'utf8').trim(), pub });
        return codiceServer;
      },
      chiediAlCancello: async (x) => { alCancello.push(x); return cancello(x); },
      allinea: () => {}, deployDaGitHub: () => false, registraMain: async () => ({ outcome: 'registrato' }), mainPrima: () => 'b'.repeat(40),
    });
    return { k, lette, alCancello, testo: righe.join('\n') };
  } finally {
    globalThis.fetch = vero;
  }
}

test('le prove del server leggono main di Filo con l’app in attesa, e la cartella si toglie dopo', async () => {
  const casa = cartellaTemporanea('filo-2199-5-');
  try {
    const filo = filoDiProva(casa);
    const r = await giro({ filo, casa, codiceServer: 1 });
    assert.equal(r.lette.length, 1, r.testo);
    assert.equal(r.lette[0].testo, 'const RILETTURE = 9;', 'con le fonti di main i generati del ramo del server non tornano');
    assert.notEqual(r.lette[0].pub, filo);
    assert.equal(existsSync(r.lette[0].pub), false, 'la cartella di main con l’app non resta indietro');
    assert.doesNotMatch(git(filo, ['worktree', 'list']), /filo-per-server-/);
  } finally { togliCartella(casa); }
});

test('senza parti dell’app fuori da main le prove leggono il checkout accanto al server, come prima', async () => {
  const casa = cartellaTemporanea('filo-2199-5-');
  try {
    const filo = filoDiProva(casa);
    const r = await giro({ filo, casa, ramiApp: [], codiceServer: 1 });
    assert.equal(r.lette[0].pub, filo);
    assert.equal(filoConLApp(filo, ['claude/non-esiste']), null, 'un ramo che qui non c’è non conta');
  } finally { togliCartella(casa); }
});

test('l’app in conflitto con main ferma prima di toccare pratica e server', async () => {
  const casa = cartellaTemporanea('filo-2199-5-');
  try {
    const filo = filoDiProva(casa, { conflitto: true });
    const r = await giro({ filo, casa });
    assert.equal(r.k, 1);
    assert.equal(r.lette.length, 0);
    assert.match(r.testo, /non si fonde con main di Filo senza conflitti/);
  } finally { togliCartella(casa); }
});

test('server portato su main senza il cancello (spinta dal PC o già dentro): si chiede al cancello l’app in attesa', async () => {
  const casa = cartellaTemporanea('filo-2199-5-');
  try {
    const filo = filoDiProva(casa);
    const r = await giro({ filo, casa, codiceServer: 0, cancello: () => ({ outcome: 'merged', sha: SHA_SERVER, app: 'd'.repeat(40) }) });
    assert.equal(r.alCancello.length, 1, r.testo);
    assert.deepEqual([r.alCancello[0].branch, r.alCancello[0].sha, r.alCancello[0].feedbackId], [RAMO, SHA_SERVER, 'p']);
    assert.match(r.testo, /Parte dell'app in attesa del server portata su main di Filo/);
    const senzaApp = await giro({ filo, casa, ramiApp: [], codiceServer: 0 });
    assert.equal(senzaApp.alCancello.length, 0, 'senza parti dell’app non c’è niente da chiedere');
  } finally { togliCartella(casa); }
});
