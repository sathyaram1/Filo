// Le spinte dichiarate col biglietto di chi spinge (#1362, #1181, #1194): il pre-push vero accoda i commit che la copia
// ha creato, mai quelli visti su origin; l'invio li dichiara al server, una coda per copia; il salvataggio e la consegna
// li portano col biglietto giusto. Server finto: le regole sul registro le prova il server.

import '../helpers/senzaSessione.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { aspettaChe, TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { scene, togliScene, runHookRaw, stdinEdit } from '../helpers/scenaHook.mjs';
import * as S from '../../scripts/lib/spinte.mjs';
import { installaControlloSpedizione, installaSpinteServer, SEGNO_PRE_PUSH } from '../../scripts/lib/copie-di-dati.mjs';
import { conSpinteDichiarate, consegnaCheSpinge, dichiaraSpintaServer } from '../../scripts/routine-channel.mjs';

after(() => togliScene());

const BIGLIETTO = `biglietto-di-prova-${'x'.repeat(40)}`;
const g = (cwd, args, env) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) }).trim();

/** L'ambiente di chi spinge: solo quello che il test dice, mai la sessione o il biglietto di chi lancia le prove. */
function ambiente(origine, extra = {}) {
  const e = { ...process.env };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'FILO_ROUTINE_TICKET', 'FILO_ROUTINE', 'NODE_TEST_CONTEXT']) delete e[k];
  return { ...e, FILO_SPINTE_ORIGINE: origine, FILO_SPINTE_SENZA_INVIO: '1', ...extra };
}

/** Un origin nudo e due copie (la pulita col pre-push di Filo, l'altra senza), sul ramo `claude/x`. */
function deposito() {
  const base = cartellaTemporanea('filo-spinte-');
  const origin = join(base, 'origin.git');
  mkdirSync(origin);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  const copia = (nome) => {
    const dir = join(base, nome);
    mkdirSync(dir);
    g(dir, ['init', '-q', '--initial-branch=main']);
    g(dir, ['remote', 'add', 'origin', origin]);
    g(dir, ['config', 'user.email', 't@t']); g(dir, ['config', 'user.name', 't']);
    return dir;
  };
  const pulita = copia('pulita');
  writeFileSync(join(pulita, 'README.md'), 'base\n');
  g(pulita, ['add', '-A']); g(pulita, ['commit', '-qm', 'base']);
  g(pulita, ['push', '-q', 'origin', 'main']);
  g(pulita, ['checkout', '-qb', 'claude/x']);
  const altra = copia('altra');
  g(altra, ['fetch', '-q', 'origin']);
  g(altra, ['checkout', '-qb', 'claude/x', 'origin/main']);
  assert.equal(installaControlloSpedizione(pulita), 'installato');
  return { base, origin, pulita, altra };
}

function commit(dir, file, env) {
  writeFileSync(join(dir, file), `${file}\n`);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-qm', file], env);
  return g(dir, ['rev-parse', 'HEAD']);
}

const spingi = (dir, env, ...piu) => spawnSync('git', ['push', '-q', ...piu, 'origin', 'claude/x'], { cwd: dir, encoding: 'utf8', env });
const coda = (dir) => S.vociInCoda(S.cartellaCoda(dir));

test('il pre-push vero accoda i commit creati qui col biglietto della routine; senza biglietto, o verso un altro remoto, niente', () => {
  const d = deposito();
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  const a = commit(d.pulita, 'a.txt');
  assert.equal(spingi(d.pulita, env).status, 0);
  const [v] = coda(d.pulita);
  assert.deepEqual([v.tipo, v.ticket, v.repo, v.ramo, v.punta, v.commits], ['routine', BIGLIETTO, 'app', 'claude/x', a, [a]]);
  // La spinta dopo porta solo il nuovo: a è già su origin.
  const b = commit(d.pulita, 'b.txt');
  spingi(d.pulita, env);
  assert.deepEqual(coda(d.pulita).map((x) => x.commits), [[a], [b]]);
  // Senza un biglietto da cui dichiarare, o verso un remoto che il registro non conosce, la coda non cresce.
  commit(d.pulita, 'c.txt');
  spingi(d.pulita, ambiente(d.origin));
  commit(d.pulita, 'd.txt');
  spingi(d.pulita, ambiente('/da/nessuna/parte', { FILO_ROUTINE_TICKET: BIGLIETTO }));
  assert.equal(coda(d.pulita).length, 2);
});

test('#1194: il commit che un altro spinge sul ramo e la pulita incorpora non entra fra i suoi, nemmeno se poi lo tolgono da origin', () => {
  const d = deposito();
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  const a = commit(d.pulita, 'a.txt');
  spingi(d.pulita, env);
  // L'altra copia (sporca, o che non dichiara: --no-verify) spinge Z sul ramo della pulita.
  g(d.altra, ['fetch', '-q', 'origin']);
  g(d.altra, ['reset', '-q', '--hard', 'origin/claude/x']);
  const z = commit(d.altra, 'z.txt');
  assert.equal(spingi(d.altra, ambiente(d.origin), '--no-verify').status, 0);
  // La pulita scrive B, la spinta è respinta, si riallinea su origin e rispinge.
  const b = commit(d.pulita, 'b.txt');
  assert.notEqual(spingi(d.pulita, env).status, 0);
  g(d.pulita, ['fetch', '-q', 'origin']);
  g(d.pulita, ['merge', '-q', '--no-edit', 'origin/claude/x']);
  const m = g(d.pulita, ['rev-parse', 'HEAD']);
  assert.equal(spingi(d.pulita, env).status, 0);
  const tutte = coda(d.pulita).flatMap((x) => x.commits);
  assert.ok(tutte.includes(b) && tutte.includes(m) && tutte.includes(a));
  assert.ok(!tutte.includes(z), 'Z l’ha spinto un altro');
  // Variante: Z2 arriva, la pulita lo incorpora, chi l'ha spinto riporta origin indietro prima che la pulita spinga.
  g(d.altra, ['fetch', '-q', 'origin']);
  g(d.altra, ['reset', '-q', '--hard', 'origin/claude/x']);
  const z2 = commit(d.altra, 'z2.txt');
  spingi(d.altra, ambiente(d.origin), '--no-verify');
  commit(d.pulita, 'c.txt');
  g(d.pulita, ['fetch', '-q', 'origin']);
  g(d.pulita, ['merge', '-q', '--no-edit', 'origin/claude/x']);
  g(d.altra, ['push', '-q', '--force', '--no-verify', 'origin', `${m}:refs/heads/claude/x`]);
  g(d.pulita, ['fetch', '-q', 'origin']);
  assert.equal(g(d.pulita, ['rev-parse', 'origin/claude/x']), m, 'il ref remoto non ha più Z2');
  assert.equal(spingi(d.pulita, env).status, 0, 'per git è un avanzamento');
  assert.ok(!coda(d.pulita).flatMap((x) => x.commits).includes(z2), 'Z2 visto su origin resta di chi l’ha spinto');
});

/** Main va avanti e l'altra copia spinge Z sul ramo senza dichiararlo. → z */
function mainAvantiEZ(d, file = 'z.txt') {
  g(d.altra, ['fetch', '-q', 'origin']);
  g(d.altra, ['checkout', '-q', '-B', 'main', 'origin/main']);
  commit(d.altra, `main-${file}`);
  g(d.altra, ['push', '-q', '--no-verify', 'origin', 'main']);
  g(d.altra, ['checkout', '-q', '-B', 'claude/x', 'origin/claude/x']);
  const z = commit(d.altra, file);
  g(d.altra, ['push', '-q', '--no-verify', 'origin', 'claude/x']);
  return z;
}

const idDi = (dir, sha) => S.patchIds(dir, [sha]).get(sha);

test('#1362 giro 2 r1: il rebase della pulita sul ramo con dentro Z di un altro: la copia di Z va fra i riscritti con l’originale, Z fra i sostituiti', () => {
  const d = deposito();
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  const a = commit(d.pulita, 'a.txt');
  spingi(d.pulita, env);
  const z = mainAvantiEZ(d);
  // Il riallineamento (git fetch, il ramo com'è su origin, git rebase origin/main) e la spinta della storia riscritta.
  g(d.pulita, ['fetch', '-q', 'origin']);
  g(d.pulita, ['reset', '-q', '--hard', 'origin/claude/x']);
  g(d.pulita, ['rebase', '-q', 'origin/main']);
  assert.equal(spingi(d.pulita, env, '--force-with-lease').status, 0);
  const ultima = coda(d.pulita).at(-1);
  const [a2, z2] = g(d.pulita, ['rev-list', '--reverse', 'origin/main..HEAD']).split('\n');
  assert.deepEqual(ultima.commits, [], 'nessuna copia passa per un commit creato qui');
  assert.deepEqual(new Set(ultima.riscritti.map((r) => `${r.sha}>${r.di}`)), new Set([`${a2}>${a}`, `${z2}>${z}`]));
  assert.deepEqual(new Set(ultima.sostituiti), new Set([a, z]));
  assert.equal(idDi(d.pulita, z2), idDi(d.pulita, z));
});

test('#1362 giro 2 r1: Z cambiato nel rebase resta fra i sostituiti; Z tolto da origin prima della spinta anche (lo storico del ref remoto)', () => {
  const d = deposito();
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  const a = commit(d.pulita, 'a.txt');
  spingi(d.pulita, env);
  const z = mainAvantiEZ(d);
  g(d.pulita, ['fetch', '-q', 'origin']);
  g(d.pulita, ['reset', '-q', '--hard', 'origin/claude/x']);
  // Un rebase interattivo che ritocca Z: la copia ha un'altra modifica, nessun originale da indicare.
  g(d.pulita, ['rebase', '-q', 'origin/main']);
  writeFileSync(join(d.pulita, 'z.txt'), 'z ritoccato\n');
  g(d.pulita, ['commit', '-q', '-a', '--amend', '--no-edit']);
  // Chi ha spinto Z riporta origin a com'era: per git la spinta della pulita non toglie niente di nuovo.
  g(d.altra, ['push', '-q', '--force', '--no-verify', 'origin', `${a}:refs/heads/claude/x`]);
  g(d.pulita, ['fetch', '-q', 'origin']);
  assert.equal(spingi(d.pulita, env, '--force').status, 0);
  const ultima = coda(d.pulita).at(-1);
  assert.ok(ultima.sostituiti.includes(z), 'Z visto su origin e non più nel ramo: chi spinge lo riscrive');
  assert.ok(ultima.sostituiti.includes(a));
});

test('#1362 giro 2 r1: un rebase dei soli commit propri porta le copie con gli originali, e una spinta che avanza non sostituisce niente', () => {
  const d = deposito();
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  const a = commit(d.pulita, 'a.txt');
  spingi(d.pulita, env);
  const b = commit(d.pulita, 'b.txt');
  spingi(d.pulita, env);
  assert.equal(coda(d.pulita).at(-1).sostituiti, undefined);
  assert.deepEqual(coda(d.pulita).at(-1).commits, [b]);
  g(d.altra, ['fetch', '-q', 'origin']);
  g(d.altra, ['checkout', '-q', '-B', 'main', 'origin/main']);
  commit(d.altra, 'main.txt');
  g(d.altra, ['push', '-q', '--no-verify', 'origin', 'main']);
  g(d.pulita, ['fetch', '-q', 'origin']);
  g(d.pulita, ['rebase', '-q', 'origin/main']);
  const c = commit(d.pulita, 'c.txt');
  assert.equal(spingi(d.pulita, env, '--force-with-lease').status, 0);
  const ultima = coda(d.pulita).at(-1);
  assert.deepEqual(ultima.commits, [c]);
  assert.deepEqual(new Set(ultima.riscritti.map((r) => r.di)), new Set([a, b]));
  assert.deepEqual(new Set(ultima.sostituiti), new Set([a, b]));
});

test('#1362 r1: alla spinta gira lo script di chi ha installato il pre-push, mai quello del ramo, che un commit spinto da altri può aver riscritto', () => {
  const d = deposito();
  const env = ambiente(d.origin, { FILO_ROUTINE_TICKET: BIGLIETTO });
  commit(d.pulita, 'a.txt');
  spingi(d.pulita, env);
  // L'altra copia spinge Z, con dentro uno script delle spinte che dichiara tutto col biglietto di chi spinge.
  g(d.altra, ['fetch', '-q', 'origin']);
  g(d.altra, ['reset', '-q', '--hard', 'origin/claude/x']);
  mkdirSync(join(d.altra, 'scripts'), { recursive: true });
  writeFileSync(join(d.altra, 'scripts', 'dichiara-spinte.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(d.base, 'girato.txt'))}, String(process.env.FILO_ROUTINE_TICKET));
`);
  const z = commit(d.altra, 'z.txt');
  assert.equal(spingi(d.altra, ambiente(d.origin), '--no-verify').status, 0);
  g(d.pulita, ['fetch', '-q', 'origin']);
  g(d.pulita, ['merge', '-q', '--no-edit', 'origin/claude/x']);
  const b = commit(d.pulita, 'b.txt');
  assert.equal(spingi(d.pulita, env).status, 0);
  assert.equal(existsSync(join(d.base, 'girato.txt')), false, 'lo script del ramo non deve girare col biglietto di chi spinge');
  const tutte = coda(d.pulita).flatMap((x) => x.commits);
  assert.ok(tutte.includes(b), 'le spinte le accoda lo script di chi ha installato');
  assert.ok(!tutte.includes(z));
});

test('#1362 r3: due sessioni nella stessa cartella, ogni commit si dichiara col biglietto della sessione che l’ha fatto', () => {
  const d = deposito();
  const biglietto = (nome, lettera) => {
    const file = join(d.base, `${nome}.json`);
    writeFileSync(file, JSON.stringify({ ticket: `${nome}-${lettera.repeat(40)}`, fp: lettera.repeat(64), natoIl: 1 }));
    return { file, ticket: `${nome}-${lettera.repeat(40)}`, fp: lettera.repeat(64) };
  };
  const pulito = biglietto('pulito', 'a');
  const sporco = biglietto('sporco', 'b');
  const envPulita = ambiente(d.origin, { FILO_BIGLIETTO_FILE: pulito.file });
  // La sporca committa dalla shell e non spinge; la pulita committa e spinge tutto.
  const s = commit(d.pulita, 's.txt', ambiente(d.origin, { FILO_BIGLIETTO_FILE: sporco.file }));
  const p = commit(d.pulita, 'p.txt', envPulita);
  assert.equal(spingi(d.pulita, envPulita).status, 0);
  const di = (t) => coda(d.pulita).filter((v) => v.ticket === t).flatMap((v) => v.commits);
  assert.deepEqual(di(pulito.ticket), [p]);
  assert.deepEqual(di(sporco.ticket), [s], 'il commit della sporca parte col suo biglietto');
  const [v] = coda(d.pulita).filter((x) => x.ticket === sporco.ticket);
  assert.deepEqual([v.tipo, v.fp, v.file, v.ramo], ['locale', sporco.fp, sporco.file, 'claude/x']);
  // Un commit fatto senza sessione (l'owner dal terminale) resta di chi lo spinge, come prima.
  const o = commit(d.pulita, 'o.txt', ambiente(d.origin));
  spingi(d.pulita, envPulita);
  assert.deepEqual(di(pulito.ticket), [p, o]);
});

test('il salvataggio automatico dichiara col biglietto della sessione che ha modificato (session_id dallo stdin)', () => {
  const s = scene();
  const sessione = 'sess-dello-stdin';
  const fp = 'f'.repeat(64);
  mkdirSync(join(s.work, '.claude', 'biglietti'), { recursive: true });
  writeFileSync(join(s.work, '.claude', 'biglietti', `${sessione}.json`), JSON.stringify({ ticket: BIGLIETTO, fp, natoIl: 1 }));
  writeFileSync(join(s.work, '.gitignore'), '.claude/biglietti/\n');
  g(s.work, ['checkout', '-qb', 'claude/salva']);
  assert.equal(installaControlloSpedizione(s.work), 'installato');
  writeFileSync(join(s.work, 'nuovo.txt'), 'x\n');
  const r = runHookRaw(s.work, stdinEdit(join(s.work, 'nuovo.txt'), { session_id: sessione }), ambiente(s.origin));
  assert.equal(r.status, 0, r.stderr);
  const [v] = coda(s.work);
  assert.ok(v, `niente in coda: ${r.stderr}`);
  assert.deepEqual([v.tipo, v.ticket, v.fp, v.ramo], ['locale', BIGLIETTO, fp, 'claude/salva']);
  assert.deepEqual(v.commits, [g(s.work, ['rev-parse', 'HEAD'])]);
});

/** Un server finto per l'invio: risponde come gli si dice e annota le chiamate. */
function finto(risposte) {
  const chiamate = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const corpo = JSON.parse(init.body);
    chiamate.push({ url, corpo });
    const [status, body] = risposte[Math.min(i, risposte.length - 1)];
    i += 1;
    return { status, ok: status === 200, json: async () => body };
  };
  return { chiamate, deps: { fetchImpl, idToken: async () => 'tok', url: 'http://finto/localTicket', base: 'http://finto' } };
}

function codaFinta(voci) {
  const dir = cartellaTemporanea('filo-spinte-invio-');
  g(dir, ['init', '-q']);
  const chi = { tipo: 'routine', ticket: BIGLIETTO };
  voci.forEach((c, n) => S.accoda(dir, chi, 'app', [{ ramo: 'claude/x', punta: c, commits: [c] }], 1000 + n));
  return dir;
}

test('l’invio: le spinte di un biglietto partono insieme e in ordine; un guasto le tiene, un no del server le toglie', async () => {
  const A = 'a'.repeat(40); const B = 'b'.repeat(40);
  const ok = finto([[200, { ok: true, fiducia: 'fidato', registrate: 2 }]]);
  const dir = codaFinta([A, B]);
  assert.deepEqual(await S.inviaSpinte({ root: dir, deps: ok.deps }), { inviate: 2, rifiutate: 0, restano: 0, errori: [] });
  assert.equal(ok.chiamate.length, 1);
  assert.equal(ok.chiamate[0].url, 'http://finto/routineSpinte');
  assert.deepEqual(ok.chiamate[0].corpo, { ticket: BIGLIETTO, spinte: [{ repo: 'app', ramo: 'claude/x', commits: [A], punta: A }, { repo: 'app', ramo: 'claude/x', commits: [B], punta: B }] });
  const giu = codaFinta([A]);
  const r = await S.inviaSpinte({ root: giu, deps: finto([[503, { ok: false, reason: 'server_error' }]]).deps });
  assert.equal(r.restano, 1);
  assert.equal(r.guasto, true);
  assert.match(S.rigaSpinte(r), /non ancora dichiarate.*non risulta fidato/);
  const no = codaFinta([A]);
  const r2 = await S.inviaSpinte({ root: no, deps: finto([[401, { ok: false, reason: 'branch_mismatch', detail: 'claude/x ≠ worker/y' }]]).deps });
  assert.deepEqual([r2.rifiutate, r2.restano], [1, 0]);
  assert.match(S.rigaSpinte(r2), /rifiutate dal server \(1: branch_mismatch: claude\/x ≠ worker\/y\)/);
  // Un server di prima, senza l'indirizzo: niente a cui dichiarare, e niente che controlli.
  const vecchio = codaFinta([A]);
  assert.equal((await S.inviaSpinte({ root: vecchio, deps: finto([[404, {}]]).deps })).rifiutate, 1);
});

test('l’invio tiene l’ordine: dopo un guasto le voci seguenti, anche di altri biglietti, aspettano (la copia di un rebase dopo il suo originale)', async () => {
  const A = 'a'.repeat(40); const B = 'b'.repeat(40);
  const dir = cartellaTemporanea('filo-spinte-ordine-');
  g(dir, ['init', '-q']);
  S.accoda(dir, { tipo: 'routine', ticket: BIGLIETTO }, 'app', [{ ramo: 'claude/x', punta: A, commits: [A] }], 1000);
  S.accoda(dir, { tipo: 'routine', ticket: `${BIGLIETTO}-2` }, 'app', [{ ramo: 'claude/x', punta: B, commits: [], riscritti: [{ sha: B, di: A }], sostituiti: [A] }], 1001);
  const giu = finto([[503, {}], [200, { ok: true }]]);
  const r = await S.inviaSpinte({ root: dir, deps: giu.deps });
  assert.equal(giu.chiamate.length, 1);
  assert.deepEqual([r.inviate, r.restano], [0, 2]);
  const su = finto([[200, { ok: true }]]);
  assert.equal((await S.inviaSpinte({ root: dir, deps: su.deps })).inviate, 2);
  assert.deepEqual(su.chiamate.map((c) => c.corpo.ticket), [BIGLIETTO, `${BIGLIETTO}-2`]);
  assert.deepEqual(su.chiamate[1].corpo.spinte[0], { repo: 'app', ramo: 'claude/x', commits: [], punta: B, sostituiti: [A], riscritti: [{ sha: B, di: A }] });
});

test('l’invio di una copia è uno alla volta: chi arriva mentre un altro manda aspetta, poi trova la coda vuota', async () => {
  const A = 'a'.repeat(40);
  let sblocca;
  const lento = { fetchImpl: async () => { await new Promise((r) => { sblocca = r; }); return { status: 200, ok: true, json: async () => ({ ok: true }) }; } };
  const dir = codaFinta([A]);
  const primo = S.inviaSpinte({ root: dir, deps: lento });
  await aspettaChe(() => typeof sblocca === 'function', { cosa: 'il primo invio in volo' });
  // Se il secondo non aspettasse il turno manderebbe la stessa voce a un server giù, e la terrebbe in coda.
  const secondo = S.inviaSpinte({ root: dir, deps: finto([[500, {}]]).deps, attesaMs: TETTO_ATTESA_MS });
  sblocca();
  assert.equal((await primo).inviate, 1);
  assert.deepEqual(await secondo, { inviate: 0, rifiutate: 0, restano: 0, errori: [] });
});

test('le spinte di una sessione locale con uno sporco annotato solo qui aspettano: entrerebbero pulite', async () => {
  const dir = cartellaTemporanea('filo-spinte-locale-');
  g(dir, ['init', '-q']);
  const file = join(dir, '.claude', 'biglietti', 's1.json');
  const fp = 'e'.repeat(64);
  mkdirSync(join(dir, '.claude', 'biglietti', 'sporchi', fp), { recursive: true });
  writeFileSync(join(dir, '.claude', 'biglietti', 'sporchi', fp, '00000000000001-1-aa.json'), JSON.stringify({ motivo: 'pagina web', at: 1 }));
  S.accoda(dir, { tipo: 'locale', ticket: BIGLIETTO, fp, file }, 'app', [{ ramo: 'claude/x', commits: ['a'.repeat(40)] }]);
  const giu = finto([[503, {}]]);
  const r = await S.inviaSpinte({ root: dir, deps: giu.deps });
  assert.equal(r.restano, 1);
  assert.deepEqual(giu.chiamate.map((c) => c.corpo.data.op), ['sporca'], 'prima lo sporco, e le spinte non partono');
  const su = finto([[200, { result: { ok: true, fiducia: 'non_fidato' } }]]);
  const r2 = await S.inviaSpinte({ root: dir, deps: su.deps });
  assert.equal(r2.inviate, 1);
  assert.deepEqual(su.chiamate.map((c) => c.corpo.data.op), ['sporca', 'spinte']);
});

test('la consegna che spinge porta i commit del ramo e svuota la coda prima; le altre no', async () => {
  const sha = 'a'.repeat(40);
  const viste = [];
  const opts = { root: '/r', inviaSpinte: async ({ root }) => { viste.push(root); return { inviate: 1, rifiutate: 0, restano: 0, errori: [] }; }, commitDelRamo: () => [{ sha, parents: [] }] };
  for (const [intent, data] of [['fixed', { sha }], ['verdict', { sha }], ['status', { status: 'revision_capability', sha }]]) {
    assert.equal(consegnaCheSpinge(intent, data), true);
    assert.deepEqual((await conSpinteDichiarate(intent, data, opts)).commits, [{ sha, parents: [] }]);
  }
  for (const [intent, data] of [['status', { status: 'working', sha }], ['secaudit', { sha }], ['fixed', { sha: 'corto' }]]) {
    assert.equal((await conSpinteDichiarate(intent, data, opts)).commits, undefined);
  }
  assert.deepEqual(viste, ['/r', '/r', '/r']);
});

test('git-server push: i commit del worker si leggono prima della spinta e si accodano per filo-security', async () => {
  const d = deposito();
  const a = commit(d.pulita, 'a.txt');
  const propri = dichiaraSpintaServer.prima(d.pulita, 'claude/x');
  assert.deepEqual(propri, { ramo: 'claude/x', punta: a, commits: [a] });
  assert.equal(dichiaraSpintaServer.prima(d.pulita, 'non-esiste'), null);
  const riga = await dichiaraSpintaServer.dopo(d.pulita, BIGLIETTO, propri);
  assert.match(riga, /non ancora dichiarate/, 'dentro una prova il server vero non si tocca: resta in coda, e lo dice');
  const [v] = coda(d.pulita);
  assert.deepEqual([v.tipo, v.repo, v.commits], ['routine', 'server', [a]]);
});

test('il pre-push nuovo sostituisce quello di prima, non porta il suo segno (un ramo vecchio non lo riscrive) e uno altrui non si tocca', () => {
  const d = deposito();
  const dove = join(d.pulita, '.git', 'hooks', 'pre-push');
  const nuovo = readFileSync(dove, 'utf8');
  assert.ok(nuovo.includes(SEGNO_PRE_PUSH));
  assert.ok(!nuovo.includes('filo-copie-di-dati'), 'gli strumenti di un ramo vecchio lo leggono come altrui');
  writeFileSync(dove, '#!/bin/sh\n# filo-copie-di-dati: quello di prima\nexit 0\n');
  assert.equal(installaControlloSpedizione(d.pulita), 'installato');
  assert.equal(readFileSync(dove, 'utf8'), nuovo);
  const server = join(d.base, 'server');
  mkdirSync(server);
  g(server, ['init', '-q']);
  assert.equal(installaSpinteServer(server), 'installato');
  assert.match(readFileSync(join(server, '.git', 'hooks', 'pre-push'), 'utf8'), /--pre-push server/);
  writeFileSync(join(server, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n');
  assert.equal(installaSpinteServer(server), 'altrui');
});

test('origineDelRegistro: Filo e filo-security su qualunque forma dell’URL; un altro repo no', () => {
  for (const u of ['https://github.com/sathyaram1/Filo', 'https://github.com/sathyaram1/Filo.git', 'git@github.com:sathyaram1/Filo.git', 'https://x-access-token:t@github.com/sathyaram1/filo/']) {
    assert.equal(S.origineDelRegistro(u, 'app', ''), true, u);
  }
  assert.equal(S.origineDelRegistro('https://github.com/sathyaram1/filo-security.git', 'server', ''), true);
  assert.equal(S.origineDelRegistro('https://github.com/sathyaram1/filo-security.git', 'app', ''), false);
  assert.equal(S.origineDelRegistro('https://github.com/altri/Filo', 'app', ''), false, 'un altro proprietario no');
});
