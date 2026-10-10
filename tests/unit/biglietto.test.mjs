// Il biglietto della sessione locale (#1148, SPEC-DOMANDE.md §1.2): file, ricerca, op verso localTicket, hook di
// avvio. Server finto: nessuna chiamata vera. Le regole della fiducia le prova il server (fiducia-biglietto.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import * as B from '../../scripts/lib/biglietto-locale.mjs';
import { leggiArgomenti } from '../../scripts/biglietto.mjs';
import { SESSION_MARKERS } from '../../scripts/lib/branch-integrity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FP = (c) => c.repeat(64);
const SEGRETO = (c) => c.repeat(43);

function repo() {
  const dir = cartellaTemporanea('biglietto-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/** Il server finto di localTicket: biglietti per segreto, ogni chiamata registrata. */
function server(biglietti = {}, { rompi = false, status = 200 } = {}) {
  const chiamate = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    const { data } = JSON.parse(init.body);
    chiamate.push(data);
    if (rompi) throw new TypeError('fetch failed');
    if (status !== 200) return { ok: false, status, json: async () => ({ error: { message: 'no', status: 'NOT_FOUND' } }) };
    const ris = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });
    if (data.op === 'prendi') {
      n += 1;
      const ticket = SEGRETO(String.fromCharCode(96 + n));
      const fp = FP(String(n % 10));
      biglietti[ticket] = { fiducia: data.sporco ? 'non_fidato' : 'fidato', chiuso: false };
      return ris({ ok: true, ticket, fp, fiducia: biglietti[ticket].fiducia });
    }
    const b = biglietti[data.ticket];
    if (!b) return ris({ ok: false, reason: 'biglietto_sconosciuto' });
    if (data.op === 'stato') return ris({ ok: true, fiducia: b.chiuso ? 'non_fidato' : b.fiducia, sporcatoDa: b.sporcatoDa || [], chiuso: !!b.chiuso });
    if (data.op === 'sporca') { b.fiducia = 'non_fidato'; return ris({ ok: true, fiducia: 'non_fidato' }); }
    if (data.op === 'chiudi') { b.chiuso = true; return ris({ ok: true }); }
    if (data.op === 'ramo') return ris({ ok: true, ramoFidato: b.fiducia === 'fidato' });
    return ris({ ok: false, reason: 'op_sconosciuta' });
  };
  return { chiamate, biglietti, deps: { fetchImpl, idToken: async () => 'token-finto' } };
}

function scriviBiglietto(dir, nome, ticket, fp) {
  const p = join(dir, '.claude', 'biglietti', `${nome}.json`);
  B.scriviFile(p, { ticket, fp, natoIl: 1 });
  return p;
}

test('il biglietto è un segreto: .gitignore e i marcatori di sessione lo tengono fuori da ogni commit', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(gi.includes('.claude/biglietti/'), '.gitignore deve escludere la cartella dei biglietti');
  assert.ok(SESSION_MARKERS.includes('.claude/biglietti/'), 'SESSION_MARKERS deve elencarla (info/exclude su ogni ramo)');
  const ignorato = execFileSync('git', ['check-ignore', '-q', '--no-index', '.claude/biglietti/sessione.json'], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(ignorato.length, 0);
});

test('la riga di comando: prendi, sporca col motivo, stato, chiudi; niente per tornare puliti', () => {
  assert.deepEqual(leggiArgomenti(['prendi']), { cmd: 'prendi', sporco: false });
  assert.deepEqual(leggiArgomenti(['prendi', '--sporco', 'ripresa', 'senza']), { cmd: 'prendi', sporco: true, motivo: 'ripresa senza' });
  assert.deepEqual(leggiArgomenti(['sporca', 'letto', 'una', 'pagina']), { cmd: 'sporca', motivo: 'letto una pagina' });
  assert.deepEqual(leggiArgomenti(['stato']), { cmd: 'stato' });
  assert.deepEqual(leggiArgomenti(['chiudi']), { cmd: 'chiudi' });
  for (const a of [[], ['sporca'], ['sporca', '  '], ['prendi', '--sporco'], ['prendi', '--pulito'], ['pulisci'], ['segna-fidato', 'x'], ['stato', 'x']]) {
    assert.ok(leggiArgomenti(a).errore, JSON.stringify(a));
  }
});

test('il nome del file: il session_id quando c’è, altrimenti manuale-<ms>', () => {
  assert.equal(B.idDelFile('3f2a-bc', 5), '3f2a-bc');
  assert.equal(B.idDelFile('', 5), 'manuale-5');
  assert.equal(B.idDelFile('../fuori', 5), 'manuale-5');
});

test('ricerca: FILO_BIGLIETTO_FILE vince; altrimenti tutti quelli della cartella; i file storti non contano', () => {
  const dir = repo();
  try {
    assert.deepEqual(B.trovaBiglietti({ env: {}, cwd: dir }), []);
    const a = scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    scriviBiglietto(dir, 'b', SEGRETO('b'), FP('2'));
    writeFileSync(join(dir, '.claude', 'biglietti', 'storto.json'), '{"ticket":"corto"}');
    assert.equal(B.trovaBiglietti({ env: {}, cwd: dir }).length, 2);
    const solo = B.trovaBiglietti({ env: { FILO_BIGLIETTO_FILE: a }, cwd: dir });
    assert.deepEqual(solo.map((x) => x.ticket), [SEGRETO('a')]);
    // Un file indicato che non vale: si ripiega sulla cartella.
    assert.equal(B.trovaBiglietti({ env: { FILO_BIGLIETTO_FILE: join(dir, 'manca.json') }, cwd: dir }).length, 2);
    if (process.platform !== 'win32') assert.equal(statSync(a).mode & 0o077, 0, 'leggibile solo da chi l’ha scritto');
  } finally { togliCartella(dir); }
});

test('fiducia della sessione: nessun biglietto o un guasto = non fidato; con più biglietti vale il più sporco', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('a')]: { fiducia: 'fidato' }, [SEGRETO('b')]: { fiducia: 'non_fidato' } });
    assert.equal(await B.fiduciaLocale({ env: {}, cwd: dir, deps: s.deps }), 'non_fidato', 'senza biglietto');
    scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    assert.equal(await B.fiduciaLocale({ env: {}, cwd: dir, deps: s.deps }), 'fidato');
    scriviBiglietto(dir, 'b', SEGRETO('b'), FP('2'));
    assert.equal(await B.fiduciaLocale({ env: {}, cwd: dir, deps: s.deps }), 'non_fidato', 'vale il più sporco');
    assert.equal((await B.trovaBiglietto({ env: {}, cwd: dir, deps: s.deps })).ticket, SEGRETO('b'));
    assert.equal(await B.fiduciaLocale({ env: {}, cwd: dir, deps: server({}, { rompi: true }).deps }), 'non_fidato', 'server giù');
  } finally { togliCartella(dir); }
});

test('sporca: tutti i biglietti della sessione, col motivo; senza biglietto lo dice; un guasto non lancia', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('a')]: { fiducia: 'fidato' }, [SEGRETO('b')]: { fiducia: 'fidato' } });
    assert.deepEqual(await B.sporca('pagina web', { env: {}, cwd: dir, deps: s.deps }), { sporcati: 0, errori: [], senzaBiglietto: true });
    scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    scriviBiglietto(dir, 'b', SEGRETO('b'), FP('2'));
    const r = await B.sporca('pagina web', { env: {}, cwd: dir, deps: s.deps });
    assert.equal(r.sporcati, 2);
    assert.deepEqual(s.chiamate.filter((c) => c.op === 'sporca').map((c) => c.motivo), ['pagina web', 'pagina web']);
    assert.equal(s.biglietti[SEGRETO('a')].fiducia, 'non_fidato');
    assert.equal((await B.sporca('  ', { env: {}, cwd: dir, deps: s.deps })).errori.length, 1, 'il motivo è obbligatorio');
    const giu = await B.sporca('x', { env: {}, cwd: dir, deps: server({}, { rompi: true }).deps });
    assert.equal(giu.sporcati, 0);
    assert.equal(giu.errori.length, 2);
  } finally { togliCartella(dir); }
});

test('prendi scrive il file; registra il ramo col biglietto più sporco; chiudi toglie i file', async () => {
  const dir = repo();
  try {
    const s = server();
    const p = await B.prendi({ sessionId: 'sess-1', cwd: dir, nowMs: 7, deps: s.deps });
    assert.equal(p.fiducia, 'fidato');
    assert.equal(p.path, join(B.cartellaBiglietti(dir), 'sess-1.json'));
    assert.deepEqual(JSON.parse(readFileSync(p.path, 'utf8')).natoIl, 7);
    assert.equal(s.chiamate[0].sessione, 'sess-1');
    const r = await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'f1', env: {}, cwd: dir, deps: s.deps });
    assert.deepEqual(r, { ok: true, ramoFidato: true, fiducia: 'fidato' });
    assert.deepEqual(s.chiamate.at(-1), { op: 'ramo', ticket: s.chiamate.length && JSON.parse(readFileSync(p.path, 'utf8')).ticket, repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'f1' });
    const c = await B.chiudi({ env: {}, cwd: dir, deps: s.deps });
    assert.equal(c.chiusi, 1);
    assert.equal(existsSync(p.path), false);
    assert.deepEqual(await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), env: {}, cwd: dir, deps: s.deps }), { ok: false, senzaBiglietto: true });
  } finally { togliCartella(dir); }
});

test('una callable non ancora pubblicata lo dice, non tace', async () => {
  await assert.rejects(B.chiama('stato', { ticket: 'x' }, server({}, { status: 404 }).deps), /non è ancora pubblicata/);
  assert.match(B.messaggioErrore(404, {}), /non è ancora pubblicata/);
});

// ── L'hook di avvio ─────────────────────────────────────────────────────────

const conCredenziale = async () => true;

test('avvio: niente nelle routine e senza credenziale dell’owner', async () => {
  const s = server();
  assert.deepEqual(await B.avvio({ input: { session_id: 's1' }, env: { FILO_ROUTINE: '1' }, deps: s.deps, haCredenziale: conCredenziale }), { riga: '' });
  assert.deepEqual(await B.avvio({ input: { session_id: 's1' }, env: {}, deps: s.deps, haCredenziale: async () => false }), { riga: '' });
  assert.equal(s.chiamate.length, 0);
});

test('avvio: sessione nuova → biglietto pulito, e FILO_BIGLIETTO_FILE in CLAUDE_ENV_FILE', async () => {
  const dir = repo();
  try {
    const s = server();
    const envFile = join(dir, 'env.sh');
    const r = await B.avvio({ input: { session_id: 'nuova', source: 'startup' }, env: { CLAUDE_ENV_FILE: envFile }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(r.riga, /pulito/);
    assert.equal(r.path, join(B.cartellaBiglietti(dir), 'nuova.json'));
    assert.equal(readFileSync(envFile, 'utf8'), `export FILO_BIGLIETTO_FILE='${r.path}'\n`);
    // Senza CLAUDE_ENV_FILE lo dice: gli strumenti cercheranno nella cartella.
    const r2 = await B.avvio({ input: { session_id: 'altra' }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(r2.riga, /CLAUDE_ENV_FILE assente/);
  } finally { togliCartella(dir); }
});

test('avvio: ripresa col suo biglietto lo riusa; ripresa senza biglietto ne prende uno nato sporco', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('z')]: { fiducia: 'non_fidato' } });
    const suo = scriviBiglietto(dir, 'ripresa-1', SEGRETO('z'), FP('9'));
    const r = await B.avvio({ input: { session_id: 'ripresa-1', source: 'resume' }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.equal(r.path, suo);
    assert.match(r.riga, /sporco/);
    assert.equal(s.chiamate.some((c) => c.op === 'prendi'), false, 'nessun biglietto nuovo: da sporco non si torna');
    const r2 = await B.avvio({ input: { session_id: 'compattata', source: 'compact' }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(r2.riga, /sporco/);
    const presa = s.chiamate.find((c) => c.op === 'prendi');
    assert.deepEqual([presa.sporco, presa.motivo], [true, 'ripresa senza biglietto']);
  } finally { togliCartella(dir); }
});

test('avvio: un figlio con FILO_BIGLIETTO_FILE vivo lo eredita; chiuso, ne prende uno suo', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('p')]: { fiducia: 'non_fidato' }, [SEGRETO('q')]: { fiducia: 'fidato', chiuso: true } });
    const padre = scriviBiglietto(dir, 'padre', SEGRETO('p'), FP('3'));
    const envFile = join(dir, 'env.sh');
    const r = await B.avvio({ input: { session_id: 'figlio', source: 'startup' }, env: { FILO_BIGLIETTO_FILE: padre, CLAUDE_ENV_FILE: envFile }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.equal(r.path, padre);
    assert.match(r.riga, /sporco/, 'il figlio eredita la fiducia del padre adesso');
    assert.equal(s.chiamate.some((c) => c.op === 'prendi'), false);
    const chiuso = scriviBiglietto(dir, 'chiuso', SEGRETO('q'), FP('4'));
    const r2 = await B.avvio({ input: { session_id: 'figlio2' }, env: { FILO_BIGLIETTO_FILE: chiuso }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.notEqual(r2.path, chiuso);
  } finally { togliCartella(dir); }
});

test('avvio: server giù → una riga, nessuna eccezione', async () => {
  const dir = repo();
  try {
    const r = await B.avvio({ input: { session_id: 's' }, env: {}, cwd: dir, deps: server({}, { rompi: true }).deps, haCredenziale: conCredenziale });
    assert.match(r.riga, /non preso/);
  } finally { togliCartella(dir); }
});

test('l’hook di avvio chiama il biglietto solo fuori dalle routine, e non esce mai con un errore', () => {
  const src = readFileSync(join(ROOT, '.claude', 'hooks', 'session-start.sh'), 'utf8');
  assert.match(src, /\[ -z "\$FILO_ROUTINE" \]/);
  assert.match(src, /scripts\/biglietto\.mjs" avvio/);
  assert.match(src, /exit 0\s*$/);
  assert.doesNotMatch(src, /\r\n/, 'fine riga LF');
});
