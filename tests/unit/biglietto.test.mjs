// Il biglietto della sessione locale (#1148, SPEC-DOMANDE.md §1.2): file, ricerca, op verso localTicket, hook di
// avvio. Server finto: nessuna chiamata vera. Le regole della fiducia le prova il server (fiducia-biglietto.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import * as B from '../../scripts/lib/biglietto-locale.mjs';
import { leggiArgomenti } from '../../scripts/biglietto.mjs';
import { envFiglio } from '../../scripts/orchestratore-locale.mjs';
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
  assert.deepEqual(leggiArgomenti(['fine']), { cmd: 'fine' });
  assert.deepEqual(leggiArgomenti(['scadenze']), { cmd: 'scadenze' });
  assert.deepEqual(leggiArgomenti(['chiusura', 'sess-1']), { cmd: 'chiusura', sessione: 'sess-1' });
  for (const a of [[], ['sporca'], ['sporca', '  '], ['prendi', '--sporco'], ['prendi', '--pulito'], ['pulisci'], ['segna-fidato', 'x'], ['stato', 'x'], ['chiusura'], ['chiusura', ' '], ['fine', 'x']]) {
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
    // Una sessione che all'avvio non ha preso il biglietto non registra col biglietto pulito di un'altra.
    assert.deepEqual(await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), env: { CLAUDE_CODE_SESSION_ID: 'senza' }, cwd: dir, deps: { ...s.deps, commitDelRamo: () => [] } }), { ok: false, senzaBiglietto: true });
    assert.equal(s.biglietti[SEGRETO('b')].fiducia, 'fidato');
    assert.equal((await B.sporca('  ', { env: sessA, cwd: dir, deps: s.deps })).errori.length, 1, 'il motivo è obbligatorio');
    const giu = await B.sporca('x', { env: sessA, cwd: dir, deps: server({}, { rompi: true }).deps });
    assert.equal(giu.sporcati, 0);
    assert.equal(giu.errori.length, 1);
  } finally { togliCartella(dir); }
});

test('prendi scrive il file; registra il ramo col biglietto della sessione; chiudi toglie il suo file e non quelli delle altre', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('y')]: { fiducia: 'non_fidato' } });
    const altra = scriviBiglietto(dir, 'finita-ieri', SEGRETO('y'), FP('8'));
    const p = await B.prendi({ sessionId: 'sess-1', cwd: dir, nowMs: 7, deps: s.deps });
    assert.equal(p.fiducia, 'fidato');
    assert.equal(p.path, join(B.cartellaBiglietti(dir), 'sess-1.json'));
    assert.deepEqual(JSON.parse(readFileSync(p.path, 'utf8')).natoIl, 7);
    assert.equal(s.chiamate[0].sessione, 'sess-1');
    const commits = [{ sha: 'a'.repeat(40), at: 1000 }];
    const conCommit = { ...s.deps, commitDelRamo: (cartella, sha) => (cartella === dir && sha === 'a'.repeat(40) ? commits : null) };
    const sess = { CLAUDE_CODE_SESSION_ID: 'sess-1' };
    const r = await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'f1', env: sess, cwd: dir, deps: conCommit });
    assert.deepEqual(r, { ok: true, ramoFidato: true, fiducia: 'fidato' });
    const { ora, ...resto } = s.chiamate.at(-1);
    assert.ok(Math.abs(ora - Date.now()) < 60000, 'l’ora della macchina, per portare le date dei commit sull’orologio del server');
    assert.deepEqual(resto, { op: 'ramo', ticket: JSON.parse(readFileSync(p.path, 'utf8')).ticket, repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), feedbackId: 'f1', commits });
    const c = await B.chiudi({ env: sess, cwd: dir, deps: s.deps });
    assert.equal(c.chiusi, 1);
    assert.equal(existsSync(p.path), false);
    assert.equal(existsSync(altra), true, 'il biglietto di un’altra sessione resta');
    assert.equal(s.chiamate.filter((x) => x.op === 'chiudi').length, 1);
    assert.deepEqual(await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), env: sess, cwd: dir, deps: s.deps }), { ok: false, senzaBiglietto: true }, 'chiuso il suo, non prende quello di un’altra sessione');
  } finally { togliCartella(dir); }
});

test('fondiApp e fineAttesa del PC (#1222): l’op giusta, e un server che non la conosce lo dice col suo motivo', async () => {
  const visti = [];
  const risposta = (result) => async (url, init) => { visti.push(JSON.parse(init.body).data); return { ok: true, status: 200, json: async () => ({ result }) }; };
  const deps = (result) => ({ fetchImpl: risposta(result), idToken: async () => 'tok', url: 'http://finto/localTicket' });
  assert.deepEqual(await B.fondiApp('f1', deps({ ok: true, result: 'merged', sha: 'e'.repeat(40) })), { ok: true, result: 'merged', sha: 'e'.repeat(40) });
  assert.deepEqual(visti.at(-1), { op: 'fondiApp', feedbackId: 'f1' });
  await assert.rejects(B.fondiApp('f1', deps({ ok: false, reason: 'op_sconosciuta', detail: 'op ammesse: prendi' })), /^Error: op_sconosciuta: op ammesse/);
  assert.ok(B.TEMPO_FONDI_APP_MS > B.TEMPO_MASSIMO_MS && B.TEMPO_FONDI_APP_MS < 120_000, 'oltre le op brevi, dentro il tetto della callable');
  await B.fineAttesa('f1', { ...deps({ ok: true }), attendiDeploy: true, sha: 'a'.repeat(40) });
  assert.deepEqual(visti.at(-1), { op: 'fineAttesa', feedbackId: 'f1' }, 'l’attesa della pubblicazione non c’è più');
  await B.fineAttesa('f1', { ...deps({ ok: true }), soloApp: true });
  assert.deepEqual(visti.at(-1), { op: 'fineAttesa', feedbackId: 'f1', soloApp: true });
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
    // Senza CLAUDE_ENV_FILE lo dice: gli strumenti cercheranno il biglietto col nome della sessione.
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
    // Il figlio ha un nome di sessione suo: i suoi comandi senza la variabile, PowerShell, trovano lo stesso biglietto.
    assert.deepEqual(B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: 'figlio' }, cwd: dir }).map((x) => x.ticket), [SEGRETO('p')]);
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

test('avvio pulito: la riga che arriva alla sessione dice cosa sporca da solo e cosa va dichiarato a mano, in una riga sola', async () => {
  // L'hook passa alla sessione solo la prima riga: senza l'avviso lì, ciò che il gancio delle letture esterne non vede (#1211) lascia il biglietto pulito.
  const dir = repo();
  try {
    const s = server();
    const r = await B.avvio({ input: { session_id: 'nuova', source: 'startup' }, env: { CLAUDE_ENV_FILE: join(dir, 'env.sh') }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(r.riga, /^Biglietto della sessione: pulito\./);
    assert.ok(r.riga.includes('node scripts/biglietto.mjs sporca "'), r.riga);
    for (const caso of ['pagine web', 'browser', 'posta', 'MCP', 'fuori dal repo', 'da sole', 'sotto-agenti', 'comando di shell']) assert.ok(r.riga.includes(caso), `manca «${caso}»: ${r.riga}`);
    assert.equal(r.riga.split('\n').length, 1);
    const sporca = server({ [SEGRETO('z')]: { fiducia: 'non_fidato' } });
    scriviBiglietto(dir, 'ripresa-2', SEGRETO('z'), FP('9'));
    const r2 = await B.avvio({ input: { session_id: 'ripresa-2', source: 'resume' }, env: {}, cwd: dir, deps: sporca.deps, haCredenziale: conCredenziale });
    assert.match(r2.riga, /sporco/);
    assert.equal(r2.riga.includes('biglietto.mjs sporca'), false, 'da sporco non serve dichiararsi');
  } finally { togliCartella(dir); }
});

test('da un worktree, senza la variabile come in PowerShell, il biglietto della sessione si trova col suo nome e si sporca, e solo quello; chi non ne trova uno non dice «già non fidata»', async () => {
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
    const altra = await B.avvio({ input: { session_id: 'sess-altra', source: 'startup' }, env: {}, cwd: wt, deps: s.deps, haCredenziale: async () => true });
    const powershell = { CLAUDE_CODE_SESSION_ID: 'sess-wt' };
    assert.equal(await B.fiduciaLocale({ env: powershell, cwd: wt, deps: s.deps }), 'fidato', 'il worktree vede il biglietto della sessione');
    assert.equal((await B.sporca('letta una pagina web', { env: powershell, cwd: wt, deps: s.deps })).sporcati, 1);
    assert.equal(await B.fiduciaLocale({ env: { FILO_BIGLIETTO_FILE: altra.path }, cwd: dir, deps: s.deps }), 'fidato', 'l’altra sessione aperta non ha letto niente');
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

test('un figlio nasce con la fiducia di chi lo lancia anche da PowerShell: orchestratore e istanza lanciata a mano', async () => {
  const dir = repo();
  try {
    const s = server();
    const powershell = (sessione) => ({ CLAUDE_CODE_SESSION_ID: sessione, CLAUDECODE: '1', PATH: '/bin' });
    const nasce = (sessione, env) => B.avvio({ input: { session_id: sessione, source: 'startup' }, env, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    const padre = await nasce('padre', {});
    assert.equal((await B.sporca('letta una pagina web', { env: powershell('padre'), cwd: dir, deps: s.deps })).sporcati, 1);
    // L'orchestratore lanciato da PowerShell non ha la variabile del percorso: ha il nome della sessione.
    const env = envFiglio(powershell('padre'), { cwd: dir });
    assert.equal(env.FILO_BIGLIETTO_FILE, padre.path);
    assert.match((await nasce('figlio', env)).riga, /: sporco/);
    assert.equal(await B.fiduciaLocale({ env: { CLAUDE_CODE_SESSION_ID: 'figlio' }, cwd: dir, deps: s.deps }), 'non_fidato');
    // Un'istanza lanciata a mano da PowerShell: il suo hook vede il nome della sessione che la lancia.
    assert.match((await nasce('a-mano', powershell('padre'))).riga, /: sporco/);
    // Chi lancia è in una sessione senza biglietto: nel dubbio il figlio nasce sporco.
    assert.match((await nasce('figlio-senza', envFiglio(powershell('mai-preso'), { cwd: dir }))).riga, /: sporco/);
    // Fuori da ogni sessione, dal terminale dell'owner, o con l'hook che vede il proprio nome: nasce pulito.
    assert.match((await nasce('dal-terminale', envFiglio({ PATH: '/bin' }, { cwd: dir }))).riga, /: pulito/);
    assert.match((await nasce('sola', { CLAUDE_CODE_SESSION_ID: 'sola' })).riga, /: pulito/);
  } finally { togliCartella(dir); }
});

// ── Lo sporco annotato in locale quando il server non risponde (#1211) ──

/** Un server dove `sporca` non arriva e il resto sì: lo stato risponde ancora «pulito». */
function senzaSporca(s) {
  return { ...s.deps, fetchImpl: async (url, init) => (JSON.parse(init.body).data.op === 'sporca' ? Promise.reject(new TypeError('fetch failed')) : s.deps.fetchImpl(url, init)) };
}

test('sporca col server giù: lo sporco resta annotato, il biglietto vale sporco anche qui e non registra rami; alla prossima occasione parte', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('a')]: { fiducia: 'fidato' } });
    const sess = { CLAUDE_CODE_SESSION_ID: 'a' };
    scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    const r = await B.sporca('pagina web', { env: sess, cwd: dir, deps: senzaSporca(s) });
    assert.deepEqual([r.sporcati, r.inAttesa, r.errori.length], [0, 1, 1]);
    assert.match(await B.rigaSporco('letto #9', ['testo non fidato'], { env: sess, cwd: dir, deps: senzaSporca(s) }), /annotato in locale/);
    assert.equal(s.biglietti[SEGRETO('a')].fiducia, 'fidato', 'il server non l’ha ricevuto');
    const [b] = B.trovaBiglietti({ env: sess, cwd: dir });
    assert.deepEqual(B.sporchiInAttesa(b).map((v) => v.motivo), ['pagina web', 'letto #9: testo non fidato']);
    // Lo stato del server dice pulito, ma qui si sa di più: sporco, e niente parte col suo nome.
    assert.equal(await B.fiduciaLocale({ env: sess, cwd: dir, deps: senzaSporca(s) }), 'non_fidato');
    assert.equal((await B.trovaBiglietto({ env: sess, cwd: dir, deps: senzaSporca(s) })).inAttesa, 2);
    const reg = await B.registraRamo({ repo: 'app', ramo: 'claude/x', sha: 'a'.repeat(40), env: sess, cwd: dir, deps: { ...senzaSporca(s), commitDelRamo: () => [] } });
    assert.equal(reg.ok, false);
    assert.match(reg.errore, /solo in locale/);
    assert.equal(s.chiamate.filter((c) => c.op === 'ramo').length, 0);
    // Il server torna: la prima chiamata che passa dal biglietto consegna tutto, una volta sola.
    assert.equal(await B.fiduciaLocale({ env: sess, cwd: dir, deps: s.deps }), 'non_fidato');
    assert.equal(s.biglietti[SEGRETO('a')].fiducia, 'non_fidato');
    const consegnate = s.chiamate.filter((c) => c.op === 'sporca').map((c) => c.motivo);
    assert.equal(consegnate.at(-1), 'pagina web; letto #9: testo non fidato');
    assert.deepEqual(B.sporchiInAttesa(b), []);
    assert.equal(B.sporcoSulServer(b), true, 'il gancio non richiama il server per un biglietto già sporco');
    const prima = s.chiamate.length;
    await B.fiduciaLocale({ env: sess, cwd: dir, deps: s.deps });
    assert.equal(s.chiamate.filter((c, i) => i >= prima && c.op === 'sporca').length, 0, 'niente da riconsegnare');
  } finally { togliCartella(dir); }
});

test('sporca: se non riesce nemmeno ad annotare, il motivo va al server lo stesso', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('a')]: { fiducia: 'fidato' } });
    scriviBiglietto(dir, 'a', SEGRETO('a'), FP('1'));
    writeFileSync(join(B.cartellaBiglietti(dir), 'sporchi'), 'non una cartella');
    const r = await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'a' }, cwd: dir, deps: s.deps });
    assert.equal(r.sporcati, 1);
    assert.deepEqual(s.chiamate.filter((c) => c.op === 'sporca').map((c) => c.motivo), ['pagina web']);
    const giu = await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'a' }, cwd: dir, deps: server({}, { rompi: true }).deps });
    assert.deepEqual([giu.sporcati, giu.inAttesa], [0, undefined], 'né annotato né consegnato: lo dice, non lo dà per fatto');
    assert.match(await B.rigaSporco('letto #9', ['x'], { env: { CLAUDE_CODE_SESSION_ID: 'a' }, cwd: dir, deps: server({}, { rompi: true }).deps }), /NON sporcato/);
  } finally { togliCartella(dir); }
});

test('motivoDaConsegnare: senza doppioni, con un tetto che dice quante ne mancano, e l’ora della lettura se arriva tardi', () => {
  assert.equal(B.motivoDaConsegnare([{ motivo: 'WebFetch (a.it)', at: 1000 }, { motivo: 'WebFetch (a.it)', at: 2000 }], 3000), 'WebFetch (a.it)');
  const molte = Array.from({ length: 8 }, (_, i) => ({ motivo: `mcp__x__${i}`, at: 1000 }));
  assert.match(B.motivoDaConsegnare(molte, 2000), /mcp__x__4; e altre 3 letture$/);
  const tardi = B.motivoDaConsegnare([{ motivo: 'WebSearch', at: Date.parse('2026-10-13T07:00:00Z') }], Date.parse('2026-10-13T09:00:00Z'));
  assert.equal(tardi, 'WebSearch (letto il 2026-10-13T07:00:00.000Z, consegnato in ritardo)');
  assert.ok(B.motivoDaConsegnare([{ motivo: 'x'.repeat(500), at: 1 }], 10 * 60 * 1000).length < 300);
  assert.equal(B.motivoDaConsegnare([{ motivo: '', at: 0 }], 5), 'lettura esterna');
});

test('avvio: chi eredita, o riprende, un biglietto con sporco solo annotato nasce sporco anche se il server dice pulito', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('p')]: { fiducia: 'fidato' } });
    const padre = scriviBiglietto(dir, 'padre', SEGRETO('p'), FP('3'));
    await B.sporca('pagina web', { env: { FILO_BIGLIETTO_FILE: padre }, cwd: dir, deps: senzaSporca(s) });
    const figlio = await B.avvio({ input: { session_id: 'figlio', source: 'startup' }, env: { FILO_BIGLIETTO_FILE: padre }, cwd: dir, deps: senzaSporca(s), haCredenziale: conCredenziale });
    assert.match(figlio.riga, /: sporco/);
    assert.equal(figlio.path, padre);
    // La copia col nome del figlio vede lo stesso sporco: sta accanto, per impronta.
    assert.equal(await B.fiduciaLocale({ env: { CLAUDE_CODE_SESSION_ID: 'figlio' }, cwd: dir, deps: senzaSporca(s) }), 'non_fidato');
    const ripresa = await B.avvio({ input: { session_id: 'padre', source: 'resume' }, env: {}, cwd: dir, deps: senzaSporca(s), haCredenziale: conCredenziale });
    assert.match(ripresa.riga, /: sporco/);
    assert.equal(s.biglietti[SEGRETO('p')].fiducia, 'fidato');
    // Col server di nuovo raggiungibile l'avvio stesso consegna.
    await B.avvio({ input: { session_id: 'figlio2', source: 'startup' }, env: { FILO_BIGLIETTO_FILE: padre }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.equal(s.biglietti[SEGRETO('p')].fiducia, 'non_fidato');
  } finally { togliCartella(dir); }
});

test('chiudi: consegna prima lo sporco annotato; chiuso sul server toglie anche quello, se la chiusura non passa lo lascia', async () => {
  const dir = repo();
  try {
    const s = server({ [SEGRETO('c')]: { fiducia: 'fidato' }, [SEGRETO('d')]: { fiducia: 'fidato' } });
    scriviBiglietto(dir, 'c', SEGRETO('c'), FP('4'));
    await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'c' }, cwd: dir, deps: senzaSporca(s) });
    const [b] = B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: 'c' }, cwd: dir });
    assert.equal((await B.chiudi({ env: { CLAUDE_CODE_SESSION_ID: 'c' }, cwd: dir, deps: s.deps })).chiusi, 1);
    assert.deepEqual(s.chiamate.filter((c) => c.op === 'sporca' || c.op === 'chiudi').map((c) => c.op).slice(-2), ['sporca', 'chiudi']);
    assert.equal(existsSync(B.cartellaSporchi(b)), false);
    scriviBiglietto(dir, 'd', SEGRETO('d'), FP('5'));
    await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'd' }, cwd: dir, deps: senzaSporca(s) });
    const [d] = B.trovaBiglietti({ env: { CLAUDE_CODE_SESSION_ID: 'd' }, cwd: dir });
    await B.chiudi({ env: { CLAUDE_CODE_SESSION_ID: 'd' }, cwd: dir, deps: server({}, { rompi: true }).deps });
    assert.equal(B.sporchiInAttesa(d).length, 1, 'aperto sul server, la copia di un figlio lo può ancora usare');
  } finally { togliCartella(dir); }
});

// ── La fine dei biglietti (#1208): a fine sessione se sporchi, per età tutti ──

const VECCHIO_MS = B.SCADENZA_MS + 24 * 60 * 60 * 1000;
function vecchio(p) {
  const t = new Date(Date.now() - VECCHIO_MS);
  utimesSync(p, t, t);
  return p;
}

test('fine della sessione: lo sporco si chiude sul server e il file sparisce; il pulito resta, e la ripresa lo ritrova pulito', async () => {
  const dir = repo();
  try {
    const s = server();
    const tr = join(dir, 'pulita.jsonl');
    writeFileSync(tr, '{}\n');
    const nasce = (sessione, extra = {}) => B.avvio({ input: { session_id: sessione, source: 'startup', ...extra }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    const fine = (sessione, { deps = s.deps, env = {}, haCredenziale = conCredenziale } = {}) => B.fineSessione({ input: { session_id: sessione }, env, cwd: dir, deps, haCredenziale });
    const pulita = await nasce('pulita', { transcript_path: tr });
    const sporca = await nasce('sporca');
    await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'sporca' }, cwd: dir, deps: s.deps });
    const ticketSporco = B.leggiFile(sporca.path).ticket;
    assert.deepEqual(await fine('sporca'), { esito: 'chiuso' });
    assert.equal(existsSync(sporca.path), false);
    assert.equal(s.biglietti[ticketSporco].chiuso, true);
    assert.deepEqual(await fine('pulita'), { esito: 'pulito' });
    assert.equal(existsSync(pulita.path), true, 'una sessione pulita si può riprendere: il suo biglietto resta');
    assert.deepEqual(s.chiamate.filter((c) => c.op === 'chiudi').map((c) => c.ticket), [ticketSporco]);
    assert.match((await B.avvio({ input: { session_id: 'pulita', source: 'resume', transcript_path: tr }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale })).riga, /: pulito/);
    assert.match((await B.avvio({ input: { session_id: 'sporca', source: 'resume' }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale })).riga, /: sporco/, 'da sporco non si torna');
    // Niente biglietto, niente credenziale, una routine, un nome storto: nessuna chiamata.
    const prima = s.chiamate.length;
    assert.equal((await fine('mai-vista')).esito, 'senza biglietto');
    assert.equal((await fine('pulita', { env: { FILO_ROUTINE: '1' } })).esito, 'routine');
    assert.equal((await fine('pulita', { haCredenziale: async () => false })).esito, 'senza credenziale');
    assert.equal((await fine('../pulita')).esito, 'senza sessione');
    assert.equal(s.chiamate.length, prima);
    // Server giù, o sporco annotato che non parte: resta tutto, e alla prossima occasione prima lo sporco poi la chiusura.
    const giu = await nasce('giu');
    const ticketGiu = B.leggiFile(giu.path).ticket;
    await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'giu' }, cwd: dir, deps: senzaSporca(s) });
    assert.equal((await fine('giu', { deps: senzaSporca(s) })).esito, 'resta');
    assert.equal((await fine('giu', { deps: server({}, { rompi: true }).deps })).esito, 'resta');
    assert.equal(existsSync(giu.path), true);
    assert.deepEqual(await fine('giu'), { esito: 'chiuso' });
    assert.deepEqual(s.chiamate.filter((c) => c.ticket === ticketGiu).map((c) => c.op).slice(-3), ['sporca', 'stato', 'chiudi']);
    assert.equal(existsSync(join(B.cartellaBiglietti(dir), 'sporchi', B.leggiFile(pulita.path).fp)), false);
  } finally { togliCartella(dir); }
});

test('fine della sessione: un biglietto che vive anche in un altro file resta aperto, e sparisce solo il file della sessione', async () => {
  const dir = repo();
  const altro = repo();
  try {
    const s = server();
    const avvia = (sessione, env, cwd = dir) => B.avvio({ input: { session_id: sessione, source: 'startup' }, env, cwd, deps: s.deps, haCredenziale: conCredenziale });
    const fine = (sessione, env, cwd = dir) => B.fineSessione({ input: { session_id: sessione }, env, cwd, deps: s.deps, haCredenziale: conCredenziale });
    const chiusure = () => s.chiamate.filter((c) => c.op === 'chiudi').length;
    const padre = await avvia('padre', {});
    await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'padre' }, cwd: dir, deps: s.deps });
    // Il figlio dell'orchestratore finisce per primo: il padre è ancora al lavoro.
    const daPadre = { FILO_BIGLIETTO_FILE: padre.path };
    await avvia('figlio', daPadre);
    const copia = join(B.cartellaBiglietti(dir), 'figlio.json');
    assert.equal(existsSync(copia), true);
    assert.deepEqual(await fine('figlio', daPadre), { esito: 'file tolto' });
    assert.deepEqual([existsSync(copia), existsSync(padre.path), chiusure()], [false, true, 0]);
    // Il padre finisce con ancora viva un'istanza lanciata a mano da PowerShell: il biglietto lo chiude l'ultima.
    await avvia('a-mano', { CLAUDE_CODE_SESSION_ID: 'padre' });
    assert.deepEqual(await fine('padre', {}), { esito: 'file tolto' });
    assert.equal(chiusure(), 0);
    assert.deepEqual(await fine('a-mano', { CLAUDE_CODE_SESSION_ID: 'padre' }), { esito: 'chiuso' });
    assert.equal(chiusure(), 1);
    // Un figlio in un altro repo: la copia sta là, il padre qui, e il figlio che finisce non lo chiude.
    const padre2 = await avvia('padre2', {});
    await B.sporca('pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'padre2' }, cwd: dir, deps: s.deps });
    await avvia('figlio2', { FILO_BIGLIETTO_FILE: padre2.path }, altro);
    assert.deepEqual(await fine('figlio2', { FILO_BIGLIETTO_FILE: padre2.path }, altro), { esito: 'file tolto' });
    assert.deepEqual([existsSync(padre2.path), chiusure()], [true, 1]);
  } finally {
    togliCartella(dir);
    togliCartella(altro);
  }
});

test('avvio: il file porta la trascrizione della sua sessione; la ripresa ne rinnova il segno di vita; la sessione biforcata nasce sporca', async () => {
  const dir = repo();
  try {
    const s = server();
    const tr = (n) => { const p = join(dir, `${n}.jsonl`); writeFileSync(p, '{}\n'); return p; };
    const padre = await B.avvio({ input: { session_id: 'padre', source: 'startup', transcript_path: tr('padre') }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.equal(B.leggiFile(padre.path).trascrizione, tr('padre'));
    await B.avvio({ input: { session_id: 'figlio', source: 'startup', transcript_path: tr('figlio') }, env: { FILO_BIGLIETTO_FILE: padre.path }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.equal(B.leggiFile(join(B.cartellaBiglietti(dir), 'figlio.json')).trascrizione, tr('figlio'), 'la copia vive quanto il figlio');
    assert.equal(B.leggiFile(padre.path).trascrizione, tr('padre'), 'il file del padre non cambia');
    // Ferma da più della scadenza e ripresa: torna viva, anche se la trascrizione è sparita.
    const ferma = await B.avvio({ input: { session_id: 'ferma', source: 'startup' }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    vecchio(ferma.path);
    assert.ok(Date.now() - B.ultimaAttivita(B.leggiFile(ferma.path)) > B.SCADENZA_MS);
    await B.avvio({ input: { session_id: 'ferma', source: 'resume', transcript_path: join(dir, 'sparita.jsonl') }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.ok(Date.now() - B.ultimaAttivita(B.leggiFile(ferma.path)) < 60000);
    vecchio(ferma.path);
    await B.avvio({ input: { session_id: 'ferma', source: 'resume', transcript_path: join(dir, 'sparita.jsonl') }, env: {}, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.ok(Date.now() - B.ultimaAttivita(B.leggiFile(ferma.path)) < 60000, 'anche con la stessa trascrizione');
    const biforcata = await B.avvio({ input: { session_id: 'biforcata', source: 'fork' }, env: { CLAUDE_CODE_SESSION_ID: 'biforcata' }, cwd: dir, deps: s.deps, haCredenziale: conCredenziale });
    assert.match(biforcata.riga, /: sporco/, 'porta la conversazione di un’altra sessione');
  } finally { togliCartella(dir); }
});

test('scadenza: i biglietti fermi da più di 30 giorni si chiudono e i file spariscono; restano i vivi, quello della sessione e di chi l’ha lanciata', async () => {
  const dir = repo();
  try {
    assert.equal(B.SCADENZA_MS, 30 * 24 * 60 * 60 * 1000);
    const s = server({
      [SEGRETO('v')]: { fiducia: 'non_fidato' }, [SEGRETO('w')]: { fiducia: 'fidato' }, [SEGRETO('t')]: { fiducia: 'fidato' },
      [SEGRETO('p')]: { fiducia: 'fidato' }, [SEGRETO('c')]: { fiducia: 'fidato' }, [SEGRETO('l')]: { fiducia: 'fidato' },
    });
    const cartella = B.cartellaBiglietti(dir);
    const sporca = vecchio(scriviBiglietto(dir, 'vecchia-sporca', SEGRETO('v'), FP('1')));
    const pulita = scriviBiglietto(dir, 'vecchia-pulita', SEGRETO('w'), FP('2'));
    const [bPulita] = B.trovaBiglietti({ env: { FILO_BIGLIETTO_FILE: pulita }, cwd: dir });
    B.annotaSporco(bPulita, 'pagina web');
    vecchio(pulita);
    const tr = join(dir, 'viva.jsonl');
    writeFileSync(tr, '{}\n');
    const viva = join(cartella, 'trascrizione-viva.json');
    B.scriviFile(viva, { ticket: SEGRETO('t'), fp: FP('3'), natoIl: 1, trascrizione: tr });
    vecchio(viva);
    const padre = scriviBiglietto(dir, 'padre', SEGRETO('p'), FP('4'));
    const copia = vecchio(scriviBiglietto(dir, 'figlio-finito', SEGRETO('p'), FP('4')));
    const corrente = vecchio(scriviBiglietto(dir, 'corrente', SEGRETO('c'), FP('5')));
    const lancia = vecchio(scriviBiglietto(dir, 'chi-lancia', SEGRETO('l'), FP('6')));
    const storto = join(cartella, 'storto.json');
    writeFileSync(storto, '{"ticket":"corto"}');
    vecchio(storto);
    const stortoNuovo = join(cartella, 'storto-nuovo.json');
    writeFileSync(stortoNuovo, '{');
    const orfano = join(cartella, 'sporchi', FP('9'));
    mkdirSync(orfano, { recursive: true });
    vecchio(orfano);
    const r = await B.chiudiScaduti({ env: { CLAUDE_CODE_SESSION_ID: 'corrente', FILO_BIGLIETTO_FILE: lancia }, cwd: dir, deps: s.deps });
    assert.deepEqual([r.chiusi, r.errori], [2, []]);
    assert.deepEqual(s.chiamate.filter((c) => c.op === 'chiudi').map((c) => c.ticket).sort(), [SEGRETO('v'), SEGRETO('w')]);
    assert.deepEqual(s.chiamate.filter((c) => c.ticket === SEGRETO('w')).map((c) => c.op), ['sporca', 'chiudi'], 'lo sporco annotato parte prima della chiusura');
    const restano = { sporca, pulita, viva, padre, copia, corrente, lancia, storto, stortoNuovo, orfano };
    assert.deepEqual(Object.fromEntries(Object.entries(restano).map(([k, p]) => [k, existsSync(p)])), {
      sporca: false, pulita: false, viva: true, padre: true, copia: false, corrente: true, lancia: true, storto: false, stortoNuovo: true, orfano: false,
    });
    assert.equal(existsSync(B.cartellaSporchi(bPulita)), false);
    assert.ok(!s.biglietti[SEGRETO('p')].chiuso, 'la copia scaduta di un figlio non chiude il biglietto del padre vivo');
    // Server giù: non toglie niente e si ferma al primo guasto; un biglietto che il server non conosce più se ne va.
    const giu1 = vecchio(scriviBiglietto(dir, 'giu-1', SEGRETO('x'), FP('7')));
    const giu2 = vecchio(scriviBiglietto(dir, 'giu-2', SEGRETO('y'), FP('8')));
    const giu = server({}, { rompi: true });
    const r2 = await B.chiudiScaduti({ env: {}, cwd: dir, deps: giu.deps });
    assert.deepEqual([r2.chiusi, r2.errori.length, giu.chiamate.filter((c) => c.op === 'chiudi').length], [0, 1, 1]);
    assert.deepEqual([existsSync(giu1), existsSync(giu2)], [true, true]);
    await B.chiudiScaduti({ env: {}, cwd: dir, deps: server({}).deps });
    assert.deepEqual([existsSync(giu1), existsSync(giu2)], [false, false]);
    assert.deepEqual(await B.chiudiScaduti({ env: {}, cwd: join(dir, 'non-esiste'), deps: s.deps }), { chiusi: 0, tolti: 0, errori: [] });
  } finally { togliCartella(dir); }
});

test('il gancio di fine: in sottofondo, solo fuori dalle routine, dal progetto anche se la cartella della sessione non c’è più', () => {
  const lanciati = [];
  const avvia = (argomenti, opz) => lanciati.push([argomenti, opz.cwd]);
  assert.equal(B.avviaFine({ input: { session_id: 'sess', cwd: '/non/esiste' }, env: { CLAUDE_PROJECT_DIR: ROOT }, avvia }), true);
  assert.equal(B.avviaFine({ input: { session_id: 'sess', cwd: ROOT }, env: { CLAUDE_PROJECT_DIR: '/non/esiste' }, avvia }), true);
  assert.equal(B.avviaFine({ input: { session_id: 'sess' }, env: { FILO_ROUTINE: '1', CLAUDE_PROJECT_DIR: ROOT }, avvia }), false);
  assert.equal(B.avviaFine({ input: { session_id: '../sess' }, env: { CLAUDE_PROJECT_DIR: ROOT }, avvia }), false);
  assert.equal(B.avviaFine({ input: {}, env: { CLAUDE_PROJECT_DIR: ROOT }, avvia }), false);
  assert.deepEqual(lanciati, [[['chiusura', 'sess'], ROOT], [['chiusura', 'sess'], ROOT]]);
});

test('il gancio di fine è cablato in SessionEnd, esce sempre 0, e i processi in sottofondo escono 0 anche col server irraggiungibile', () => {
  const impostazioni = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.local.json'), 'utf8'));
  const voci = (impostazioni.hooks.SessionEnd || []).flatMap((g) => g.hooks || []).filter((h) => /\.claude\/hooks\/session-end\.sh/.test(h.command));
  assert.equal(voci.length, 1);
  // Senza un suo tempo, Claude Code dà al gancio di fine un secondo e mezzo: bash e node su Windows ci stanno stretti.
  assert.ok(voci[0].timeout >= 5, 'il gancio di fine ha un suo tempo');
  const src = readFileSync(join(ROOT, '.claude', 'hooks', 'session-end.sh'), 'utf8');
  assert.doesNotMatch(src, /\r\n/, 'fine riga LF');
  assert.match(src, /\[ -n "\$FILO_ROUTINE" \] && exit 0/);
  assert.match(src, /node "\$SCRIPT" fine/);
  assert.match(src, /exit 0\s*$/);
  assert.doesNotMatch(src, /exit [1-9]/);
  const base = { ...process.env };
  for (const k of ['FILO_ROUTINE', 'CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE']) delete base[k];
  // La prova vieta a chiama() il server vero; l'indirizzo finto è per chi la lancia senza.
  const env = { ...base, NODE_TEST_CONTEXT: 'child', FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9' };
  const gancio = spawnSync('bash', [join(ROOT, '.claude', 'hooks', 'session-end.sh')], {
    input: JSON.stringify({ session_id: '../non-valida', cwd: ROOT, reason: 'prompt_input_exit' }), env: { ...env, CLAUDE_PROJECT_DIR: ROOT }, encoding: 'utf8', timeout: TETTO_ATTESA_MS,
  });
  assert.equal(gancio.status, 0, gancio.stderr);
  const dir = repo();
  try {
    const p = vecchio(scriviBiglietto(dir, 'sess', SEGRETO('s'), FP('1')));
    for (const argomenti of [['chiusura', 'sess'], ['scadenze']]) {
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'biglietto.mjs'), ...argomenti], { cwd: dir, env, encoding: 'utf8', timeout: TETTO_ATTESA_MS });
      assert.equal(r.status, 0, `${argomenti[0]}: ${r.stderr}`);
      assert.equal(existsSync(p), true, `${argomenti[0]}: senza server il biglietto resta`);
    }
  } finally { togliCartella(dir); }
});
