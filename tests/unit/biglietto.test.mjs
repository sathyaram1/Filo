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
    if (data.op === 'ramo') {
      // Come il server vero: senza l'elenco dei commit non si sa chi li ha scritti, e la sessione si sporca.
      if (!Array.isArray(data.commits) && b.fiducia === 'fidato') { b.fiducia = 'non_fidato'; return ris({ ok: true, ramoFidato: false, fiducia: 'non_fidato', sporcato: 'senza l’elenco dei commit del ramo' }); }
      return ris({ ok: true, ramoFidato: b.fiducia === 'fidato', fiducia: b.fiducia });
    }
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
  // check-ignore esce 0 solo se il percorso è ignorato.
  assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', '--no-index', '.claude/biglietti/sessione.json'], { cwd: ROOT, stdio: 'ignore' }));
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

test('ricerca: FILO_BIGLIETTO_FILE vince; altrimenti quello col nome della sessione, mai quelli delle altre; i file storti non contano', () => {
  const dir = repo();
  try {
    assert.deepEqual(B.trovaBiglietti({ env: {}, cwd: dir }), []);
    const a = scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    scriviBiglietto(dir, 'b', SEGRETO('b'), FP('2'));
    writeFileSync(join(dir, '.claude', 'biglietti', 'storto.json'), '{"ticket":"corto"}');
    assert.deepEqual(B.trovaBiglietti({ env: {}, cwd: dir }), [], 'senza il nome della sessione nessun biglietto: mai quelli delle altre');
    assert.deepEqual(B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: 'b' }, cwd: dir }).map((x) => x.ticket), [SEGRETO('b')]);
    assert.deepEqual(B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: 'c' }, cwd: dir }), [], 'una sessione senza il suo file non prende quello di un’altra');
    assert.deepEqual(B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: 'storto' }, cwd: dir }), []);
    assert.deepEqual(B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: '../a' }, cwd: dir }), [], 'il nome non esce dalla cartella');
    const solo = B.trovaBiglietti({ env: { FILO_BIGLIETTO_FILE: a, CLAUDE_CODE_SESSION_ID: 'b' }, cwd: dir });
    assert.deepEqual(solo.map((x) => x.ticket), [SEGRETO('a')]);
    // Un file indicato che non vale: si ripiega sul nome della sessione.
    assert.deepEqual(B.trovaBiglietti({ env: { FILO_BIGLIETTO_FILE: join(dir, 'manca.json'), CLAUDE_CODE_SESSION_ID: 'b' }, cwd: dir }).map((x) => x.ticket), [SEGRETO('b')]);
    assert.deepEqual(B.trovaBiglietti({ env: { FILO_BIGLIETTO_FILE: join(dir, 'manca.json') }, cwd: dir }), []);
    if (process.platform !== 'win32') assert.equal(statSync(a).mode & 0o077, 0, 'leggibile solo da chi l’ha scritto');
  } finally { togliCartella(dir); }
});

test('fiducia della sessione: nessun biglietto o un guasto = non fidato; lo sporco di un’altra sessione, anche finita, non conta', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('a')]: { fiducia: 'fidato' }, [SEGRETO('b')]: { fiducia: 'non_fidato' } });
    const sessA = { CLAUDE_CODE_SESSION_ID: 'a' };
    assert.equal(await B.fiduciaLocale({ env: sessA, cwd: dir, deps: s.deps }), 'non_fidato', 'senza biglietto');
    scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    assert.equal(await B.fiduciaLocale({ env: sessA, cwd: dir, deps: s.deps }), 'fidato');
    scriviBiglietto(dir, 'b', SEGRETO('b'), FP('2'));
    assert.equal(await B.fiduciaLocale({ env: sessA, cwd: dir, deps: s.deps }), 'fidato', 'il biglietto sporco di b, rimasto nella cartella, è di un’altra sessione');
    assert.equal((await B.trovaBiglietto({ env: sessA, cwd: dir, deps: s.deps })).ticket, SEGRETO('a'));
    assert.equal(s.chiamate.filter((c) => c.op === 'stato' && c.ticket === SEGRETO('b')).length, 0, 'al server si chiede solo il biglietto della sessione');
    assert.equal(await B.fiduciaLocale({ env: {}, cwd: dir, deps: s.deps }), 'non_fidato', 'senza il nome della sessione');
    assert.equal(await B.fiduciaLocale({ env: sessA, cwd: dir, deps: server({}, { rompi: true }).deps }), 'non_fidato', 'server giù');
  } finally { togliCartella(dir); }
});

test('sporca: il biglietto della sessione, col motivo, e nessun altro; senza biglietto lo dice; un guasto non lancia', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('a')]: { fiducia: 'fidato' }, [SEGRETO('b')]: { fiducia: 'fidato' } });
    const sessA = { CLAUDE_CODE_SESSION_ID: 'a' };
    assert.deepEqual(await B.sporca('pagina web', { env: sessA, cwd: dir, deps: s.deps }), { sporcati: 0, errori: [], senzaBiglietto: true });
    scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    scriviBiglietto(dir, 'b', SEGRETO('b'), FP('2'));
    const r = await B.sporca('pagina web', { env: sessA, cwd: dir, deps: s.deps });
    assert.equal(r.sporcati, 1);
    assert.deepEqual(s.chiamate.filter((c) => c.op === 'sporca').map((c) => [c.ticket, c.motivo]), [[SEGRETO('a'), 'pagina web']]);
    assert.equal(s.biglietti[SEGRETO('a')].fiducia, 'non_fidato');
    assert.equal(s.biglietti[SEGRETO('b')].fiducia, 'fidato', 'l’altra sessione aperta non ha letto niente: resta pulita');
    assert.deepEqual(await B.sporca('pagina web', { env: {}, cwd: dir, deps: s.deps }), { sporcati: 0, errori: [], senzaBiglietto: true }, 'senza il nome della sessione non sporca le altre');
    assert.equal(s.biglietti[SEGRETO('b')].fiducia, 'fidato');
    assert.equal((await B.sporca('  ', { env: sessA, cwd: dir, deps: s.deps })).errori.length, 1, 'il motivo è obbligatorio');
    const giu = await B.sporca('x', { env: sessA, cwd: dir, deps: server({}, { rompi: true }).deps });
    assert.equal(giu.sporcati, 0);
    assert.equal(giu.errori.length, 1);
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
    const commits = [{ sha: 'a'.repeat(40), at: 1000 }];
    const conCommit = { ...s.deps, commitDelRamo: (cartella, sha) => (cartella === dir && sha === 'a'.repeat(40) ? commits : null) };
    const r = await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'f1', env: {}, cwd: dir, deps: conCommit });
    assert.deepEqual(r, { ok: true, ramoFidato: true, fiducia: 'fidato' });
    const { ora, ...resto } = s.chiamate.at(-1);
    assert.ok(Math.abs(ora - Date.now()) < 60000, 'l’ora della macchina, per portare le date dei commit sull’orologio del server');
    assert.deepEqual(resto, { op: 'ramo', ticket: JSON.parse(readFileSync(p.path, 'utf8')).ticket, repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'f1', commits });
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
    // L'hook stampa solo la prima riga: un errore col corpo JSON della risposta resta su una riga.
    const corpo = { ...server({}).deps, idToken: async () => { throw new Error('refresh admin fallito (400): {\n  "error": {\n    "message": "INVALID_REFRESH_TOKEN"\n  }\n}'); } };
    const r2 = await B.avvio({ input: { session_id: 's2' }, env: {}, cwd: dir, deps: corpo, haCredenziale: conCredenziale });
    assert.doesNotMatch(r2.riga, /\n/);
    assert.match(r2.riga, /INVALID_REFRESH_TOKEN/);
  } finally { togliCartella(dir); }
});

test('l’hook di avvio chiama il biglietto solo fuori dalle routine, e non esce mai con un errore', () => {
  const src = readFileSync(join(ROOT, '.claude', 'hooks', 'session-start.sh'), 'utf8');
  assert.match(src, /\[ -z "\$FILO_ROUTINE" \]/);
  assert.match(src, /scripts\/biglietto\.mjs" avvio/);
  assert.match(src, /exit 0\s*$/);
  assert.doesNotMatch(src, /\r\n/, 'fine riga LF');
});

// ── Chi continua un lavoro ne eredita la sporcizia (#1148, rilievo 2 del giro 1) ──

test('commitDelRamo: i commit oltre origin/main con la data d’autore in ms; git che non risponde → null', () => {
  const dir = repo();
  try {
    const g = (args, env = {}) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    g(['add', '-A']); g(['commit', '-qm', 'base']);
    g(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    g(['checkout', '-qb', 'claude/x']);
    writeFileSync(join(dir, 'b.txt'), 'uno\n');
    g(['add', '-A']); g(['commit', '-qm', 'uno'], { GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z' });
    const punta = g(['rev-parse', 'HEAD']);
    assert.deepEqual(B.commitDelRamo(dir, punta), [{ sha: punta, at: Date.parse('2026-10-01T10:00:00Z') }]);
    assert.equal(B.commitDelRamo(join(dir, 'non-esiste'), punta), null);
  } finally { togliCartella(dir); }
});

test('registraNelRegistro: i commit si leggono nel deposito di ciascun ramo, e la sessione sporcata lo dice', async () => {
  const { registraNelRegistro } = await import('../../scripts/verify-local.mjs');
  const viste = [];
  const registra = async (a) => { viste.push([a.repo, a.cartella]); return a.repo === 'app' ? { ok: true, ramoFidato: false, fiducia: 'non_fidato', sporcato: 'ripreso il ramo claude/x: scritto da un biglietto sporco' } : { ok: true, ramoFidato: false, fiducia: 'non_fidato' }; };
  const righe = await registraNelRegistro({ ramo: 'claude/x', sha: 'a'.repeat(40), server: { ramo: 'claude/x', sha: 'b'.repeat(40), radice: '/srv' }, root: '/app' }, registra);
  assert.deepEqual(viste, [['app', '/app'], ['server', '/srv']]);
  assert.match(righe[0], /si è sporcata \(ripreso il ramo claude\/x/);
  assert.doesNotMatch(righe[1], /sporcata/);
});

test('avvio: il figlio il cui biglietto del padre non si legge (file sparito, o stato che non risponde) nasce sporco', async () => {
  const dir = repo();
  try {
    const s = server();
    const r = await B.avvio({ input: { session_id: 'figlio', source: 'startup' }, env: { FILO_BIGLIETTO_FILE: join(dir, 'sparito.json') }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(r.riga, /sporco/);
    const presa = s.chiamate.find((c) => c.op === 'prendi');
    assert.deepEqual([presa.sporco, presa.motivo], [true, 'file del biglietto del padre illeggibile']);
    // Stato del padre che non risponde (funzione fredda): sporco anche se il padre era pulito.
    const padre = scriviBiglietto(dir, 'padre', SEGRETO('p'), FP('3'));
    const t = server({ [SEGRETO('p')]: { fiducia: 'fidato' } });
    const lento = { ...t.deps, fetchImpl: async (url, init) => (JSON.parse(init.body).data.op === 'stato' ? Promise.reject(new TypeError('fetch failed')) : t.deps.fetchImpl(url, init)) };
    const r2 = await B.avvio({ input: { session_id: 'figlio2', source: 'startup' }, env: { FILO_BIGLIETTO_FILE: padre }, cwd: dir, deps: lento, haCredenziale: conCredenziale });
    assert.match(r2.riga, /sporco/);
    assert.notEqual(r2.path, padre);
    // File sparito e server giù: nessun biglietto (non fidato), mai uno pulito preso dopo.
    const giu = server({}, { rompi: true });
    const r3 = await B.avvio({ input: { session_id: 'figlio3' }, env: { FILO_BIGLIETTO_FILE: join(dir, 'sparito.json') }, cwd: dir, deps: giu.deps, haCredenziale: conCredenziale });
    assert.match(r3.riga, /non preso/);
    assert.equal(giu.chiamate.filter((c) => c.op === 'prendi' && !c.sporco).length, 0);
  } finally { togliCartella(dir); }
});

test('avvio pulito: la riga che arriva alla sessione dice come dichiararsi sporca dopo una lettura esterna, in una riga sola', async () => {
  // L'hook passa alla sessione solo la prima riga: senza l'avviso lì, una pagina web o una mail lette in locale lasciano il biglietto pulito.
  const dir = repo();
  try {
    const s = server();
    const r = await B.avvio({ input: { session_id: 'nuova', source: 'startup' }, env: { CLAUDE_ENV_FILE: join(dir, 'env.sh') }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(r.riga, /^Biglietto della sessione: pulito\./);
    assert.ok(r.riga.includes('node scripts/biglietto.mjs sporca "'), r.riga);
    for (const caso of ['pagina web', 'browser', 'posta', 'fuori dal repo', 'sotto-agente']) assert.ok(r.riga.includes(caso), `manca «${caso}»: ${r.riga}`);
    assert.equal(r.riga.split('\n').length, 1);
    const sporca = server({ [SEGRETO('z')]: { fiducia: 'non_fidato' } });
    scriviBiglietto(dir, 'ripresa-2', SEGRETO('z'), FP('9'));
    const r2 = await B.avvio({ input: { session_id: 'ripresa-2', source: 'resume' }, env: {}, cwd: dir, deps: sporca.deps, haCredenziale: conCredenziale });
    assert.match(r2.riga, /sporco/);
    assert.equal(r2.riga.includes('biglietto.mjs sporca'), false, 'da sporco non serve dichiararsi');
  } finally { togliCartella(dir); }
});

test('da un worktree, senza la variabile come in PowerShell, il biglietto della sessione si trova e si sporca; chi non ne trova uno non dice «già non fidata»', async () => {
  const dir = cartellaTemporanea('biglietto-wt-');
  try {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'x.txt'), 'x');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const wt = join(dir, '.claude', 'worktrees', 'lavoro');
    git('worktree', 'add', '-q', wt, '-b', 'claude/lavoro');
    assert.equal(B.radiceCondivisa(wt), B.radiceCondivisa(dir));
    const s = server();
    const avvio = await B.avvio({ input: { session_id: 'sess-wt', source: 'startup' }, env: {}, cwd: dir, deps: s.deps, haCredenziale: async () => true });
    assert.equal(avvio.path, join(B.cartellaBiglietti(dir), 'sess-wt.json'));
    assert.equal(await B.fiduciaLocale({ env: {}, cwd: wt, deps: s.deps }), 'fidato', 'il worktree vede il biglietto della sessione');
    assert.equal((await B.sporca('letta una pagina web', { env: {}, cwd: wt, deps: s.deps })).sporcati, 1);
    assert.equal(await B.fiduciaLocale({ env: { FILO_BIGLIETTO_FILE: avvio.path }, cwd: wt, deps: s.deps }), 'non_fidato', 'da Bash, con la variabile, la sessione è sporca');
    const ripresa = await B.avvio({ input: { session_id: 'sess-wt', source: 'resume' }, env: {}, cwd: wt, deps: s.deps, haCredenziale: async () => true });
    assert.equal(ripresa.path, avvio.path, 'una ripresa dal worktree ritrova il suo biglietto');
    assert.match(ripresa.riga, /: sporco/);
  } finally { togliCartella(dir); }
  const vuoto = repo();
  try {
    const riga = await B.rigaSporco('letto #1', ['testo non fidato'], { env: {}, cwd: vuoto, deps: server().deps });
    assert.doesNotMatch(riga, /già non fidata/);
    assert.match(riga, /niente sporcato/);
  } finally { togliCartella(vuoto); }
});
