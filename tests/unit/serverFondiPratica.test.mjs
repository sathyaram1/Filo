// Il lavoro locale sul server ha la sua pratica (#908): il comando del repo Filo la controlla, la prende in carico,
// lancia server:fondi di filo-security con la pratica e a fusione riuscita la chiude, se la parte dell'app non manca
// (#915). Rete e server finti.

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
  assert.deepEqual(leggiArgomenti(['claude/x', '--feedback', '910']), { ramo: 'claude/x', pratica: '910', dryRun: false, soloServer: false, nota: null });
  assert.equal(leggiArgomenti(['claude/x', '--feedback', '910', '--solo-server']).soloServer, true);
  assert.equal(leggiArgomenti(['claude/x', '--feedback', '910'], { npm_config_solo_server: 'true' }).soloServer, true);
  assert.equal(leggiArgomenti(['claude/x', '--feedback=#910', '--dry-run']).dryRun, true);
  const npm = leggiArgomenti(['claude/x'], { npm_config_feedback: '910', npm_config_dry_run: 'true' });
  assert.equal(npm.pratica, '910');
  assert.equal(npm.dryRun, true);
  assert.match(leggiArgomenti(['claude/x', '--forza']).errore, /non capiti/);
  assert.match(leggiArgomenti(['claude/x', 'claude/y']).errore, /un ramo solo/);
  // Il nome come lo legge lo strumento del server: il verdetto si cerca su quello che si fonde (#1062).
  for (const forma of ['origin/claude/x', 'refs/heads/claude/x', 'refs/remotes/origin/claude/x', ' claude/x ']) assert.equal(leggiArgomenti([forma]).ramo, 'claude/x', forma);
  for (const no of ['feature/x', 'claude/../main', 'claude/x.lock']) assert.match(leggiArgomenti([no]).errore, /solo rami claude/, no);
  assert.equal(leggiArgomenti(['claude/x']).pratica, null);
});

function doc(id, { clientId = 'local:claude', senderProof = 'admin', status = 'todo', locale = true, parti = null } = {}) {
  const fields = {
    seq: { integerValue: '910' }, clientId: { stringValue: clientId }, status: { stringValue: status },
    statusPublic: { stringValue: 'open' }, notes: { stringValue: '' },
  };
  if (senderProof) fields.senderProof = { stringValue: senderProof };
  if (locale) fields.localOnly = { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } };
  if (parti) {
    const valore = (v) => (typeof v === 'string' ? { stringValue: v } : { integerValue: String(v) });
    fields.localMerges = { mapValue: { fields: Object.fromEntries(Object.entries(parti).map(([k, v]) => [k, valore(v)])) } };
  }
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

const ORA = Date.parse('2026-10-03T10:00:00Z');
const ORE = 3600 * 1000;

const fissaFinta = (_c, ramo, sha) => ({ ok: true, ramo: `${ramo}-verificato-${sha.slice(0, 12)}`, togli: () => ({ ok: true }) });

function giro({ docs, argv, codiceServer = 0, ramiAperti = [], verdetto = null, fissa = fissaFinta }) {
  return conRete(docs, async (scritture) => {
    const lanci = [];
    const righe = [];
    const k = await esegui(argv, {
      env: {}, bearer: 'finto', base: FIRESTORE_BASE, funzioni: '/srv/functions',
      log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)),
      lancia: (cartella, args, env) => { lanci.push({ cartella, args, pratica: env[PRATICA_ENV] }); return codiceServer; },
      punta: () => 'a'.repeat(40), ramiAperti: () => ramiAperti, ora: () => ORA, verdetto: () => verdetto, fissa,
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

test('davvero, con --solo-server: presa in carico, server con la pratica, a fusione riuscita si chiude e lo dice', async () => {
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--solo-server'] });
  assert.equal(r.k, 0, r.testo);
  assert.deepEqual(r.lanci, [{ cartella: '/srv/functions', args: ['claude/x'], pratica: '#910' }]);
  assert.equal(r.scritture.length, 3, r.scritture.join('\n'));
  assert.ok(!r.scritture[0].includes('resolvedInVersion'), 'la prima scrittura è la presa in carico');
  assert.match(r.scritture[1], /fieldPaths=localMerges\.server&updateMask\.fieldPaths=localMerges\.solo&updateMask\.fieldPaths=localMerges\.ramo&updateMask\.fieldPaths=updatedAt$/, 'poi la parte del server, sola, col suo ramo');
  assert.ok(r.scritture[2].includes('resolvedInVersion'), 'l’ultima chiude la pratica');
  assert.match(r.testo, /Pratica #910 chiusa/);
});

test('senza --solo-server e senza un ramo dell’app in vista la pratica resta aperta, e si dice come chiuderla', async () => {
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p'] });
  assert.equal(r.k, 0, r.testo);
  assert.equal(r.scritture.length, 3);
  assert.match(r.scritture[1], /updateMask\.fieldPaths=localMerges\.server&updateMask\.fieldPaths=localMerges\.ramo&updateMask\.fieldPaths=updatedAt$/, 'la parte del server col suo ramo, senza «solo»');
  assert.ok(r.scritture.every((u) => !u.includes('resolvedInVersion')), 'non si chiude');
  assert.match(r.testo, /resta aperta: manca la parte dell’app, la chiude la fusione di quella parte \(npm run finish -- --feedback 910\)/);
  assert.match(r.testo, /npm run server:fondi -- claude\/x --feedback 910 --solo-server/);
  const prova = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--dry-run'] });
  assert.match(prova.testo, /resterebbe aperta/);
});

test('--solo-server con un ramo dell’app legato alla pratica: si ferma prima di fondere, e il rilancio consigliato funziona', async () => {
  const docs = { p: doc('p') };
  const r = await giro({ docs, argv: ['claude/x', '--feedback', 'p', '--solo-server'], ramiAperti: ['claude/app'] });
  assert.equal(r.k, 1, r.testo);
  assert.match(r.testo, /claude\/app dell'app è legato a questa pratica/);
  assert.match(r.testo, /rilancia senza --solo-server: npm run server:fondi -- claude\/x --feedback 910\n/);
  assert.match(r.testo, /Non ho toccato niente/);
  assert.deepEqual(r.lanci, [], 'dopo la fusione il rilancio senza --solo-server sarebbe rifiutato');
  assert.deepEqual(r.scritture, []);
  const prova = await giro({ docs, argv: ['claude/x', '--feedback', 'p', '--solo-server', '--dry-run'], ramiAperti: ['claude/app'] });
  assert.equal(prova.k, 1, 'anche la prova a vuoto dice che si fermerebbe');
  const rilancio = await giro({ docs, argv: ['claude/x', '--feedback', 'p'], ramiAperti: ['claude/app'] });
  assert.equal(rilancio.k, 0, rilancio.testo);
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
  assert.equal(r.scritture.length, 3);
  assert.ok(r.scritture.some((u) => u.includes('localMerges.server')), 'la parte del server è registrata');
  assert.ok(r.scritture.every((u) => !u.includes('resolvedInVersion')), 'non si chiude');
  assert.match(r.testo, /resta aperta: manca la parte dell’app, la chiude la fusione di claude\/app \(npm run finish -- --feedback 910\)/);
  assert.doesNotMatch(r.testo, /--solo-server/, 'col ramo dell’app legato --solo-server si rifiuta: non si consiglia');
});

test('la parte dell’app già su main secondo la pratica, e nessun suo ramo fuori da main: si chiude', async () => {
  const d = doc('p', { status: 'working', parti: { app: ORA - ORE } });
  const r = await giro({ docs: { p: d }, argv: ['claude/x', '--feedback', 'p'] });
  assert.equal(r.k, 0, r.testo);
  assert.ok(r.scritture.at(-1).includes('resolvedInVersion'), 'si chiude');
  assert.match(r.testo, /Pratica #910 chiusa/);
});

test('la parte dell’app già fusa una volta ma con un ramo legato ancora fuori da main (un seguito, o la pratica riaperta): resta aperta', async () => {
  for (const status of ['working', 'todo']) {
    const d = doc('p', { status, parti: { app: ORA - ORE, ramo: 'claude/app' } });
    const r = await giro({ docs: { p: d }, argv: ['claude/x', '--feedback', 'p'], ramiAperti: ['claude/app'] });
    assert.equal(r.k, 0, r.testo);
    assert.ok(r.scritture.every((u) => !u.includes('resolvedInVersion')), `${status}: non si chiude`);
    assert.match(r.testo, /resta aperta: manca la parte dell’app, la chiude la fusione di claude\/app/);
    assert.doesNotMatch(r.testo, /--solo-server/, 'non si consiglia un comando che col ramo legato verrebbe rifiutato');
    const prova = await giro({ docs: { p: d }, argv: ['claude/x', '--feedback', 'p', '--dry-run'], ramiAperti: ['claude/app'] });
    assert.match(prova.testo, /resterebbe aperta/);
    assert.doesNotMatch(prova.testo, /--solo-server/);
  }
});

test('pratica chiusa da poco dalla fusione dell’app dello stesso lavoro: il server la usa, non la riapre, la annota', async () => {
  const d = doc('p', { status: 'done', parti: { app: ORA - 3 * ORE, ramo: 'claude/x' } });
  const prova = await giro({ docs: { p: d }, argv: ['claude/x', '--feedback', 'p', '--dry-run'] });
  assert.equal(prova.k, 0, prova.testo);
  assert.deepEqual(prova.scritture, []);
  assert.match(prova.testo, /non si riapre e, a fusione riuscita, resterebbe chiusa/);
  assert.doesNotMatch(prova.testo, /andrebbe in lavorazione/);

  const r = await giro({ docs: { p: d }, argv: ['claude/x', '--feedback', 'p'], ramiAperti: ['claude/app'] });
  assert.equal(r.k, 0, r.testo);
  assert.deepEqual(r.lanci, [{ cartella: '/srv/functions', args: ['claude/x'], pratica: '#910' }]);
  assert.equal(r.scritture.length, 2, 'nessuna presa in carico: la parte e la nota');
  assert.match(r.scritture[0], /localMerges\.server&updateMask\.fieldPaths=localMerges\.ramo&updateMask\.fieldPaths=updatedAt$/);
  assert.match(r.testo, /meno di 48 ore fa/);
  assert.match(r.testo, /resta chiusa/);
});

test('pratica chiusa che non viene da poco dall’app dello stesso lavoro: si rifiuta prima di toccare il server, col perché', async () => {
  const casi = [
    [{ status: 'done', parti: { app: ORA - 49 * ORE, ramo: 'claude/x' } }, /più di 48 ore/],
    [{ status: 'done', parti: { app: ORA - ORE, server: ORA - ORE, ramo: 'claude/x' } }, /parte del server di questo lavoro è già su main/],
    [{ status: 'done' }, /non l’ha chiusa la fusione della parte dell’app/],
    [{ status: 'done', parti: { app: ORA - ORE, ramo: 'claude/x' }, locale: false }, /segno «solo in locale»/],
    // Un altro lavoro che cita la pratica di un lavoro tutto nell'app: altro ramo, ramo ignoto, o detto «solo server».
    [{ status: 'done', parti: { app: ORA - ORE, ramo: 'claude/lavoro-app' } }, /l’ha chiusa la fusione di claude\/lavoro-app/],
    [{ status: 'done', parti: { app: ORA - ORE } }, /non dice quale ramo/],
    [{ status: 'done', parti: { app: ORA - ORE, ramo: 'claude/x' } }, /non è di questo lavoro/, ['--solo-server']],
  ];
  for (const [opz, motivo, extra = []] of casi) {
    const r = await giro({ docs: { p: doc('p', opz) }, argv: ['claude/x', '--feedback', 'p', ...extra] });
    assert.equal(r.k, 3, r.testo);
    assert.match(r.testo, motivo);
    assert.match(r.testo, /aprine una/);
    assert.deepEqual(r.lanci, []);
    assert.deepEqual(r.scritture, []);
  }
});

test('ramiApertiDellaPratica: i rami dell’app legati alla pratica in ogni worktree, tranne quelli già su main', () => {
  const lista = 'worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b\nHEAD 2\nbranch refs/heads/claude/app\n';
  const stati = {
    [join('/a', '.claude', 'verify-local.json')]: { 'claude/vecchio': { feedbackId: 'p' } },
    [join('/b', '.claude', 'verify-local.json')]: { 'claude/app': { feedbackId: 'p' }, 'claude/altro': { feedbackId: 'q' } },
  };
  const git = (cwd, args) => {
    if (args[0] === 'worktree') return lista;
    if (args[0] === 'rev-parse') return 'x';
    return args[2] === 'claude/vecchio' ? '' : null; // il vecchio è già dentro origin/main
  };
  assert.deepEqual(ramiApertiDellaPratica('p', { radice: '/a', git, leggi: (f) => stati[f] || null }), ['claude/app']);
  assert.deepEqual(ramiApertiDellaPratica('z', { radice: '/a', git, leggi: (f) => stati[f] || null }), []);
});

test('ramiApertiDellaPratica: un ramo legato e poi cancellato non conta: non è una parte che può ancora arrivare', () => {
  const lista = 'worktree /a\nHEAD 1\nbranch refs/heads/claude/altro\n';
  const stati = { [join('/a', '.claude', 'verify-local.json')]: { 'claude/vecchio': { feedbackId: 'p' }, 'claude/vivo': { feedbackId: 'p' } } };
  const esistono = new Set(['refs/heads/claude/vivo', 'refs/heads/claude/altro']);
  const git = (cwd, args) => {
    if (args[0] === 'worktree') return lista;
    if (args[0] === 'rev-parse') return esistono.has(args[3]) ? 'x' : null;
    return null; // né il vecchio (che non c'è più) né il vivo sono dentro origin/main
  };
  assert.deepEqual(ramiApertiDellaPratica('p', { radice: '/a', git, leggi: (f) => stati[f] || null }), ['claude/vivo']);
  esistono.delete('refs/heads/claude/vivo');
  assert.deepEqual(ramiApertiDellaPratica('p', { radice: '/a', git, leggi: (f) => stati[f] || null }), []);
});

test('ramiApertiDellaPratica: rilegge origin/main prima di guardare, così un ramo appena fuso da npm run finish non tiene aperto', () => {
  const lista = 'worktree /a\nHEAD 1\nbranch refs/heads/claude/app\n';
  const stati = { [join('/a', '.claude', 'verify-local.json')]: { 'claude/app': { feedbackId: 'p' } } };
  let riletto = false;
  const git = (cwd, args) => {
    if (args[0] === 'worktree') return lista;
    if (args[0] === 'fetch') { riletto = true; return ''; }
    return riletto ? '' : null; // prima del fetch origin/main locale è indietro
  };
  assert.deepEqual(ramiApertiDellaPratica('p', { radice: '/a', git, leggi: (f) => stati[f] || null }), []);
});

test('ramiApertiDellaPratica: il ramo dell’app con lo stesso nome di quello del server conta anche senza start', () => {
  const lista = 'worktree /a\nHEAD 1\nbranch refs/heads/main\n';
  const stati = { [join('/a', '.claude', 'verify-local.json')]: { 'claude/di-altri': { feedbackId: 'q' } } };
  const esistono = new Set(['refs/heads/claude/gemello', 'refs/heads/claude/di-altri', 'refs/heads/claude/fuso']);
  const git = (cwd, args) => {
    if (args[0] === 'worktree') return lista;
    if (args[0] === 'rev-parse') return esistono.has(args[3]) ? 'x' : null;
    return args[2] === 'claude/fuso' ? '' : null;
  };
  const leggi = (f) => stati[f] || null;
  const con = (ramoGemello) => ramiApertiDellaPratica('p', { radice: '/a', git, leggi, ramoGemello });
  assert.deepEqual(con('claude/gemello'), ['claude/gemello']);
  assert.deepEqual(con('claude/di-altri'), [], 'legato a un’altra pratica');
  assert.deepEqual(con('claude/fuso'), [], 'già su main');
  assert.deepEqual(con('claude/assente'), []);
  assert.deepEqual(con('main'), []);
});

// #1062: il ramo del server con un ramo dell'app omonimo in verifica si fonde solo allo sha verificato.
test('un lavoro con l’app la cui verifica non regge non si fonde, e non si tocca niente', async () => {
  const no = { ok: false, reason: 'il ramo del server claude/x si è mosso dopo la verifica (11111111 → 22222222)' };
  for (const argv of [['claude/x', '--feedback', 'p'], ['claude/x', '--feedback', 'p', '--dry-run']]) {
    const r = await giro({ docs: { p: doc('p') }, argv, verdetto: no });
    assert.equal(r.k, 1, r.testo);
    assert.match(r.testo, /claude\/x è un lavoro con l'app, e la sua verifica non regge: il ramo del server claude\/x si è mosso/);
    assert.match(r.testo, /Non ho toccato niente/);
    assert.deepEqual(r.lanci, []);
    assert.deepEqual(r.scritture, []);
  }
});

test('con la verifica che regge si fonde, e se main finisce su un altro sha lo si dice', async () => {
  const si = { ok: true, reason: 'verifica superata su questo contenuto, insieme al ramo del server claude/x su aaaaaaaa', server: { ramo: 'claude/x', sha: 'a'.repeat(40) } };
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--solo-server'], verdetto: si });
  assert.equal(r.k, 0, r.testo);
  assert.match(r.testo, /Verifica del lavoro: verifica superata/);
  assert.doesNotMatch(r.testo, /Attenzione/);
  const altro = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--solo-server'], verdetto: { ...si, server: { ramo: 'claude/x', sha: 'b'.repeat(40) } } });
  assert.match(altro.testo, /Attenzione: main del server è su aaaaaaaaa, non sullo sha verificato bbbbbbbbb/);
  // Allo strumento del server va il ramo fermo sullo sha verificato, non quello che può ancora muoversi (#1062).
  assert.deepEqual(r.lanci.map((l) => l.args), [[`claude/x-verificato-${'a'.repeat(12)}`]]);
  const senzaFermo = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--solo-server'], verdetto: si, fissa: () => ({ ok: false, motivo: 'push rifiutato' }) });
  assert.equal(senzaFermo.k, 1);
  assert.equal(senzaFermo.lanci.length, 0, 'senza il ramo fermo lo strumento del server non parte');
  assert.match(senzaFermo.testo, /non riesco a fermare lo sha verificato aaaaaaaaa[\s\S]*push rifiutato/);
});

test('la prova a vuoto con un verdetto guarda lo sha verificato, come la fusione vera', async () => {
  const si = { ok: true, reason: 'verifica superata su questo contenuto, insieme al ramo del server claude/x su aaaaaaaa', server: { ramo: 'claude/x', sha: 'a'.repeat(40) } };
  const r = await giro({ docs: { p: doc('p') }, argv: ['claude/x', '--feedback', 'p', '--dry-run'], verdetto: si });
  assert.equal(r.k, 0, r.testo);
  assert.deepEqual(r.lanci.map((l) => l.args), [[`claude/x-verificato-${'a'.repeat(12)}`, '--dry-run']]);
  assert.deepEqual(r.scritture, []);
});
