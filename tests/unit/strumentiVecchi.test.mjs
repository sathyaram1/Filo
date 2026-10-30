// #1796: una sessione con gli strumenti indietro rispetto a main non prende lavoro nuovo, e un ruolo che non conosce
// non diventa un guasto dichiarato (che fermava per un'ora le accensioni di tutte le routine). Repo git usa-e-getta,
// canale finto su HTTP locale.

import '../helpers/senzaSessione.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { pinTools, pinWorkerTools, pinnedCommit, segnaLavoroPreso, lavoroGiaPreso } from '../../scripts/lib/tools-pin.mjs';
import { strumentiIndietro, sessioneDaChiudere } from '../../scripts/lib/strumenti-vecchi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });
const nuova = (p) => { const c = cartellaTemporanea(p); cartelle.push(c); return c; };

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (dir, rel, testo) => { mkdirSync(dirname(resolve(dir, rel)), { recursive: true }); writeFileSync(resolve(dir, rel), testo, 'utf8'); };

/** Un progetto con origin, e un secondo clone da cui main si muove come farebbe una fusione. */
function progetto() {
  const base = nuova('filo-strumenti-vecchi-');
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  const altro = resolve(base, 'altro');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(casa);
  git(casa, 'init', '-q', '-b', 'main');
  for (const d of [casa]) { git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); }
  scrivi(casa, 'scripts/dispatch.mjs', 'v1\n');
  scrivi(casa, 'routines/roles/halt.md', 'v1\n');
  scrivi(casa, 'src/shared/patchNotes.js', 'v1\n');
  // Il resto di quello che il pin copia, o la copia non si fa.
  scrivi(casa, 'src/main/auth/config.js', 'v1\n');
  scrivi(casa, 'src/main/services/mergeApprovalSignal.js', 'v1\n');
  git(casa, 'add', '-A');
  git(casa, 'commit', '-qm', 'base');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  git(base, 'clone', '-q', origin, altro);
  git(altro, 'config', 'user.email', 't@t'); git(altro, 'config', 'user.name', 't');
  const fondi = (rel, testo) => { scrivi(altro, rel, testo); git(altro, 'add', '-A'); git(altro, 'commit', '-qm', `cambia ${rel}`); git(altro, 'push', '-q', 'origin', 'main'); };
  const strumenti = (commit = git(casa, 'rev-parse', 'HEAD')) => {
    const dest = resolve(base, `strumenti-${Math.random().toString(36).slice(2, 8)}`);
    const pin = pinTools(casa, { dest, commit });
    assert.ok(pin.ok, pin.why);
    return dest;
  };
  return { base, casa, altro, fondi, strumenti };
}

test('il pin ricorda il commit intero, e la copia di un worker lo eredita', () => {
  const p = progetto();
  const sha = git(p.casa, 'rev-parse', 'HEAD');
  const tools = p.strumenti(sha);
  assert.equal(pinnedCommit(tools), sha);
  const worker = pinWorkerTools(p.casa, 3, { da: tools, base: tools });
  assert.ok(worker.ok, worker.why);
  assert.equal(pinnedCommit(worker.dir), sha, 'il worker lavora con la stessa versione degli strumenti di chi l\'ha lanciato');
  // Senza un commit valido nessuna marca: «non lo so» non vale come «aggiornato».
  const senza = resolve(p.base, 'senza');
  assert.ok(pinTools(p.casa, { dest: senza, commit: 'abc' }).ok);
  assert.equal(pinnedCommit(senza), '');
});

test('la marca del biglietto preso si scrive solo su una copia fissata, mai negli strumenti del repo', () => {
  const p = progetto();
  const tools = p.strumenti();
  assert.equal(lavoroGiaPreso(tools), false);
  assert.equal(segnaLavoroPreso(tools), true);
  assert.equal(lavoroGiaPreso(tools), true);
  assert.equal(segnaLavoroPreso(p.casa), false);
  assert.equal(existsSync(resolve(p.casa, '.filo-lavoro-preso')), false);
});

test('strumenti indietro: solo quando su main cambiano scripts/ o routines/, guardando il main scaricato adesso', () => {
  const p = progetto();
  const tools = p.strumenti();
  let v = strumentiIndietro(p.casa, { toolsRoot: tools });
  assert.deepEqual([v.indietro, v.verificato], [false, true], v.motivo);

  // Una fusione che tocca solo l'app: la sessione non è vecchia.
  p.fondi('src/shared/patchNotes.js', 'v2\n');
  v = strumentiIndietro(p.casa, { toolsRoot: tools });
  assert.deepEqual([v.indietro, v.verificato], [false, true], v.motivo);

  // Una fusione che aggiunge un ruolo: main si è mosso da un altro clone, e senza scaricarlo non si vedrebbe.
  p.fondi('routines/roles/smistamento.md', 'nuovo ruolo\n');
  assert.equal(strumentiIndietro(p.casa, { toolsRoot: tools, scarica: false }).indietro, false, 'il main locale è ancora quello vecchio');
  v = strumentiIndietro(p.casa, { toolsRoot: tools });
  assert.deepEqual([v.indietro, v.verificato], [true, true]);
  assert.match(v.motivo, /scripts\/ o routines\/ sono cambiati/);
  assert.equal(v.main, git(p.altro, 'rev-parse', 'HEAD'));

  // Anche un cambio in scripts/ da solo.
  const p2 = progetto();
  const t2 = p2.strumenti();
  p2.fondi('scripts/dispatch.mjs', 'v2\n');
  assert.equal(strumentiIndietro(p2.casa, { toolsRoot: t2 }).indietro, true);
});

test('quando non si può guardare non è «indietro»: senza pin, pin fuori da main, origin che non risponde', () => {
  const p = progetto();
  const repoSenzaPin = resolve(p.base, 'nessun-pin');
  mkdirSync(repoSenzaPin);
  let v = strumentiIndietro(p.casa, { toolsRoot: repoSenzaPin });
  assert.deepEqual([v.indietro, v.verificato], [false, false]);

  git(p.casa, 'checkout', '-q', '-b', 'prova');
  scrivi(p.casa, 'scripts/dispatch.mjs', 'del ramo\n');
  git(p.casa, 'commit', '-qam', 'ramo');
  const dalRamo = p.strumenti(git(p.casa, 'rev-parse', 'HEAD'));
  v = strumentiIndietro(p.casa, { toolsRoot: dalRamo });
  assert.deepEqual([v.indietro, v.verificato], [false, false]);
  assert.match(v.motivo, /non vengono da origin\/main/);

  // origin sparito: si confronta con l'ultimo main scaricato, e lo si dice.
  git(p.casa, 'checkout', '-q', 'main');
  const tools = p.strumenti();
  p.fondi('scripts/dispatch.mjs', 'v3\n');
  git(p.casa, 'fetch', '-q', 'origin');
  git(p.casa, 'remote', 'set-url', 'origin', resolve(p.base, 'non-esiste.git'));
  v = strumentiIndietro(p.casa, { toolsRoot: tools });
  assert.deepEqual([v.indietro, v.verificato, v.scaricato], [true, true, false]);
});

test('il primo biglietto della sessione non si nega; dal secondo, strumenti indietro chiudono la sessione', () => {
  const p = progetto();
  const tools = p.strumenti();
  p.fondi('scripts/dispatch.mjs', 'v2\n');
  // Chiudere prima del primo biglietto farebbe della sessione una nata morta, che per il pacemaker è un freno.
  assert.equal(sessioneDaChiudere(p.casa, { toolsRoot: tools }).chiudi, false);
  segnaLavoroPreso(tools);
  const s = sessioneDaChiudere(p.casa, { toolsRoot: tools });
  assert.equal(s.chiudi, true);
  assert.match(s.testo, /^niente da fare \(strumenti_vecchi\)/);
  assert.match(s.testo, /chiudi il giro/);
});

/** Canale finto: conta le chiamate e dà un biglietto o la busta di lavoro decisa dal test. */
function fintoCanale(busta = null) {
  const chiamate = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      chiamate.push({ url: req.url, body: (() => { try { return JSON.parse(body || '{}'); } catch (_) { return {}; } })() });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineTicket')) res.end(JSON.stringify({ ok: true, work: true, ticket: 't'.repeat(43), role: 'smistamento' }));
      else if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(busta));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, chiamate })));
}

function lancia(script, args, env) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', script), ...args], { env: { ...process.env, ...env } });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => ok({ code, so, se }));
  });
}

test('ticket: una sessione che ha già lavorato e ha gli strumenti indietro esce con 2 senza chiamare il server', async () => {
  const p = progetto();
  const tools = p.strumenti();
  const { srv, port, chiamate } = await fintoCanale();
  const env = {
    FILO_TOOLS_ROOT: tools, FILO_REPO_ROOT: p.casa, FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    CLAUDE_CONFIG_DIR: nuova('filo-ticket-utente-'), FILO_ROUTINE_TICKET: '',
  };
  try {
    // Primo biglietto: si chiede, e la copia si segna.
    let r = await lancia('routine-channel.mjs', ['ticket', 'parola', '--json'], env);
    assert.equal(r.code, 0, r.se);
    assert.equal(chiamate.filter((c) => c.url.endsWith('/routineTicket')).length, 1);
    assert.equal(lavoroGiaPreso(tools), true);

    // Main non tocca gli strumenti: il secondo si chiede come sempre.
    p.fondi('src/shared/patchNotes.js', 'v2\n');
    r = await lancia('routine-channel.mjs', ['ticket', 'parola', '--json'], env);
    assert.equal(r.code, 0, r.se);
    assert.equal(chiamate.filter((c) => c.url.endsWith('/routineTicket')).length, 2);

    // Una fusione aggiunge un ruolo: la sessione chiude, e il server non dà il lavoro a lei.
    p.fondi('routines/roles/smistamento.md', 'nuovo\n');
    r = await lancia('routine-channel.mjs', ['ticket', 'parola', '--json'], env);
    assert.equal(r.code, 2, r.se);
    assert.match(r.se, /strumenti_vecchi/);
    assert.equal(r.so.trim(), '', 'nessun biglietto stampato');
    assert.equal(chiamate.filter((c) => c.url.endsWith('/routineTicket')).length, 2, 'il server non è stato chiamato');
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
});

/** Il giro vero del worker con strumenti fissati finti: ricette copiate, commit del pin = il primo del progetto. */
async function giroCon(p, busta) {
  const tools = p.strumenti();
  cpSync(resolve(REPO, 'routines', 'roles'), resolve(tools, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(p.casa, '.gitignore'), '.claude/\n', 'utf8');
  const { srv, port, chiamate } = await fintoCanale(busta);
  try {
    const r = await lancia('dispatch.mjs', ['--ticket', 'biglietto-di-prova'], {
      FILO_TOOLS_ROOT: tools, FILO_TOOLS_DIR: nuova('filo-pin-vuoto-'), FILO_REPO_ROOT: p.casa,
      FILO_DISPATCH_STATE_DIR: resolve(p.base, 'stato'), FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
      FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`, FILO_ROUTINES_ENABLED: '1', FILO_NO_BEAT: '1',
    });
    const i = r.so.indexOf('{');
    return { ...r, json: i >= 0 ? JSON.parse(r.so.slice(i, r.so.lastIndexOf('}') + 1)) : null, chiamate };
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
}

const BUSTA_NUOVA = { ok: true, role: 'capo', id: '', num: '', branch: '', payload: { compito: 'D-121' } };

test('dispatch: ruolo sconosciuto con strumenti indietro → halt «strumenti_vecchi», rilascio SENZA guasto', async () => {
  const p = progetto();
  p.fondi('routines/roles/capo.md', 'il ruolo nuovo\n');
  const r = await giroCon(p, BUSTA_NUOVA);
  assert.equal(r.code, 2, r.se);
  assert.equal(r.json.role, 'halt');
  assert.equal(r.json.payload.kind, 'strumenti_vecchi');
  assert.match(r.json.payload.message, /non sa eseguire \("capo"\).*sono cambiati.*torna in coda/);
  const t = r.json.instructions.replace(/\s+/g, ' ');
  assert.match(t, /release <biglietto> --role halt ```/, 'il rilascio senza niente dopo il ruolo');
  assert.doesNotMatch(t, /--role halt --guasto/, 'un guasto dichiarato fermerebbe per un\'ora tutte le routine');
  assert.ok(t.indexOf('domanda --biglietto <biglietto>') < t.indexOf('release <biglietto> --role halt'), 'la domanda di fine sessione prima del rilascio');
  assert.ok(!/<!--\s*includi:/.test(r.json.instructions));
  assert.match(r.se, /STRUMENTI VECCHI, non è un guasto/);
});

test('dispatch: ruolo sconosciuto con gli strumenti di main resta un guasto (il server chiede un ruolo che main non ha)', async () => {
  const p = progetto();
  p.fondi('src/shared/patchNotes.js', 'v2\n');
  const r = await giroCon(p, BUSTA_NUOVA);
  assert.equal(r.code, 3, r.se);
  assert.equal(r.json.role, 'halt');
  assert.equal(r.json.payload.kind, 'transient');
  assert.match(r.json.payload.message, /non sa eseguire \("capo"\)/);
  assert.match(r.json.instructions.replace(/\s+/g, ' '), /release <biglietto> --role halt --guasto/);
});

test('il testo di halt per gli strumenti vecchi esiste ed è letto dal ruolo, non dal guasto generico', async () => {
  const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');
  const vecchi = readRoleInstructions('halt', { caso: 'strumenti_vecchi' });
  const guasto = readRoleInstructions('halt', { caso: 'transient' });
  assert.ok(vecchi.length > 400 && vecchi !== guasto);
  assert.equal(readRoleInstructions('halt'), guasto);
  assert.match(readFileSync(resolve(REPO, 'routines', 'roles', 'orchestrator.md'), 'utf8').replace(/\s+/g, ' '), /exit 2\*\* → niente da fare[^;]*strumenti di questa sessione sono indietro/);
});
