// Un riallineamento si registra solo col rebase su origin (#1964): il server lo segnava fatto col ramo remoto fermo al
// commit verificato, e chi verificava dopo aveva un diff vuoto. Le due strade di consegna seguono la stessa regola.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { consegnaDiRiallineamento, spedisciRiallineamento, testoRiallineamentoNonSpedito } from '../../scripts/routine-channel.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.CLAUDE_CONFIG_DIR = cartellaTemporanea('filo-claude-utente-');

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identita = (dir) => {
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']);
};
const commit = (dir, file, testo, msg) => {
  writeFileSync(join(dir, file), testo);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
};
const fatte = [];
test.after(() => { for (const d of fatte) { try { togliCartella(d); } catch (_) {} } });

/** origin con main e il ramo verificato; main va avanti da un'altra cartella, e questa l'ha scaricato senza rifare la base. */
function scena() {
  const base = cartellaTemporanea('riallineamento-origin-');
  fatte.push(base);
  const origin = join(base, 'origin.git');
  const work = join(base, 'work');
  const altro = join(base, 'altro');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  identita(work);
  git(work, ['remote', 'add', 'origin', origin]);
  writeFileSync(join(work, '.gitignore'), 'stato/\n.claude/\n');
  commit(work, 'a.js', 'uno\n', 'inizio');
  git(work, ['push', '-q', 'origin', 'main']);
  git(work, ['remote', 'set-head', 'origin', 'main']);
  git(work, ['checkout', '-qb', 'worker/77']);
  const verificato = commit(work, 'b.js', 'lavoro\n', 'il lavoro di #77');
  git(work, ['push', '-q', 'origin', 'worker/77']);
  execFileSync('git', ['clone', '-q', origin, altro], { stdio: 'ignore' });
  identita(altro);
  commit(altro, 'c.js', 'da main\n', 'arrivato su main');
  git(altro, ['push', '-q', 'origin', 'main']);
  git(work, ['fetch', '-q', 'origin', 'main']);
  return { origin, work, verificato };
}
const suOrigin = (origin, ramo) => git(origin, ['rev-parse', `refs/heads/${ramo}`]);
const rifiutaPush = (origin) => {
  const f = join(origin, 'hooks', 'pre-receive');
  writeFileSync(f, '#!/bin/sh\nprintf "GH013: push declined due to repository rule violations\\n" >&2\nexit 1\n', 'utf8');
  chmodSync(f, 0o755);
  return f;
};

test('il rebase arriva su origin, e origin lo rilegge alla punta della cartella sopra main', () => {
  const s = scena();
  git(s.work, ['rebase', '-q', 'origin/main']);
  const r = spedisciRiallineamento(s.work, { env: {} });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.punta, git(s.work, ['rev-parse', 'HEAD']));
  assert.equal(r.main, git(s.work, ['rev-parse', 'origin/main']));
  assert.equal(suOrigin(s.origin, 'worker/77'), r.punta);
  assert.notEqual(r.punta, s.verificato);
});

test('senza rebase non parte niente: la punta non contiene main, e il rimedio è rifare la base', () => {
  const s = scena();
  const r = spedisciRiallineamento(s.work, { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.tipo, 'base');
  assert.match(r.reason, /non contiene origin\/main/);
  assert.equal(suOrigin(s.origin, 'worker/77'), s.verificato);
  assert.match(testoRiallineamentoNonSpedito(r), /git rebase origin\/main/);
});

test('il push respinto (#1589): niente consegna, il ramo su origin resta il commit verificato, il rimedio è il guasto', () => {
  const s = scena();
  git(s.work, ['rebase', '-q', 'origin/main']);
  rifiutaPush(s.origin);
  const r = spedisciRiallineamento(s.work, { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.tipo, 'spedizione');
  assert.match(r.reason, /GH013/);
  assert.equal(suOrigin(s.origin, 'worker/77'), s.verificato);
  const testo = testoRiallineamentoNonSpedito(r);
  assert.match(testo, /Il server non ha registrato niente/);
  assert.match(testo, /--guasto "guasto: github: .*" --senza-push/);
  assert.match(testo, /Non spingere a mano/);
});

test('la regola vale per il correttore che riallinea, non per chi riprende né per chi si ferma con una domanda', () => {
  const riallinea = { role: 'fixer', dal: 'a'.repeat(40) };
  assert.equal(consegnaDiRiallineamento(riallinea), true);
  assert.equal(consegnaDiRiallineamento({ role: 'fixer' }), false, 'la ripresa non ha il commit verificato');
  assert.equal(consegnaDiRiallineamento({ role: 'new-work', dal: 'a'.repeat(40) }), false);
  assert.equal(consegnaDiRiallineamento(null), false);
  assert.equal(consegnaDiRiallineamento(riallinea, { domanda: { titolo: 'x' } }), false, 'una domanda che blocca ferma il lavoro');
  assert.equal(consegnaDiRiallineamento(riallinea, { domanda: { titolo: 'x', blocca: false } }), true, 'una provvisoria va in verifica');
  assert.equal(consegnaDiRiallineamento(riallinea, { ferma: true }), false);
});

/** Server finto: si guarda cosa gli arriva, e cosa no. */
function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}
const esegui = (script, argv, env, cwd) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], { env: { ...process.env, FILO_NO_BEAT: '1', ...env }, cwd },
    (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
});

test('dispatch --record-fixed e deliver fixed non registrano un riallineamento che su origin non c\'è; spedito, sì', async (t) => {
  const { srv, ricevuti, port } = await fintoServer();
  t.after(() => srv.close());
  const s = scena();
  git(s.work, ['rebase', '-q', 'origin/main']);
  const stato = join(s.work, 'stato');
  mkdirSync(stato, { recursive: true });
  writeFileSync(join(stato, 'fid-77.json'), JSON.stringify({ id: 'fid-77', branch: 'worker/77', loopCount: 1, verifierVerdict: 'pass' }));
  mkdirSync(join(s.work, '.claude'), { recursive: true });
  writeFileSync(join(s.work, '.claude', 'routine-role.json'), JSON.stringify({ role: 'fixer', since: new Date().toISOString(), dal: s.verificato }));
  const env = {
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: s.work, FILO_DISPATCH_STATE_DIR: stato,
    FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'b'.repeat(43), FILO_ROUTINE: '',
  };
  const REPORT = 'Riallineato su main: nessun conflitto, nessuna riga del lavoro toccata in questo giro.';
  const consegne = () => ricevuti.filter((x) => x.url.includes('routineDeliver'));
  const gancio = rifiutaPush(s.origin);

  const dispatchNo = await esegui('dispatch.mjs', ['--record-fixed', 'fid-77', REPORT, '--motivo', 'conflitto: nessuno'], env, s.work);
  assert.equal(dispatchNo.code, 1, dispatchNo.se);
  assert.match(dispatchNo.se, /Riallineamento NON consegnato: il ramo 'worker\/77' non arriva su origin/);
  const canaleNo = await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'fixed', '--notes', REPORT, '--motivo', 'conflitto: nessuno'], env, s.work);
  assert.equal(canaleNo.code, 1, canaleNo.se);
  assert.match(canaleNo.se, /Riallineamento NON consegnato: il ramo 'worker\/77' non arriva su origin/);
  assert.equal(consegne().length, 0, 'il server non ha registrato niente');
  assert.equal(suOrigin(s.origin, 'worker/77'), s.verificato);

  rmSync(gancio);
  const si = await esegui('dispatch.mjs', ['--record-fixed', 'fid-77', REPORT, '--motivo', 'conflitto: nessuno'], env, s.work);
  assert.equal(si.code, 0, si.se);
  const punta = git(s.work, ['rev-parse', 'HEAD']);
  assert.equal(suOrigin(s.origin, 'worker/77'), punta, 'chi verifica dopo trova il rebase su origin');
  assert.equal(consegne().length, 1);
  assert.equal(consegne()[0].body.data.sha, punta);
  const canaleSi = await esegui('routine-channel.mjs', ['deliver', 'b'.repeat(43), 'fixed', '--notes', REPORT, '--motivo', 'conflitto: nessuno'], env, s.work);
  assert.equal(canaleSi.code, 0, canaleSi.se);
  assert.equal(consegne().length, 2);
  assert.equal(consegne()[1].body.data.sha, punta);
});

test('chi riallinea e si ferma con una domanda che blocca consegna anche senza rebase: non registra un riallineamento', async (t) => {
  const { srv, ricevuti, port } = await fintoServer();
  t.after(() => srv.close());
  const s = scena();
  const stato = join(s.work, 'stato');
  mkdirSync(stato, { recursive: true });
  writeFileSync(join(stato, 'fid-77.json'), JSON.stringify({ id: 'fid-77', branch: 'worker/77', loopCount: 1, verifierVerdict: 'pass' }));
  mkdirSync(join(s.work, '.claude'), { recursive: true });
  writeFileSync(join(s.work, '.claude', 'routine-role.json'), JSON.stringify({ role: 'fixer', since: new Date().toISOString(), dal: s.verificato }));
  const domanda = join(stato, 'domanda.json');
  writeFileSync(domanda, JSON.stringify({
    titolo: 'Quale delle due versioni del menu tenere',
    priorita: 'importante',
    contesto: 'Il lavoro e la linea principale cambiano lo stesso menu in due modi diversi.',
    problema: 'Le due versioni non stanno insieme. Scegli quale tenere.',
    opzioni: [
      { testo: 'Tenere quella del lavoro', pro: 'Resta quello che hai chiesto', contro: 'Si perde la modifica arrivata dopo', azione: { tipo: 'riprendi', feedbackId: 'fid-77' } },
      { testo: 'Tenere quella arrivata dopo', pro: 'Resta la versione più nuova', contro: 'Il lavoro va rifatto sopra', azione: { tipo: 'riprendi', feedbackId: 'fid-77' } },
    ],
    consiglio: { opzione: 0, perche: 'È quello che hai chiesto.' },
  }));
  const env = {
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: s.work, FILO_DISPATCH_STATE_DIR: stato,
    FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'b'.repeat(43), FILO_ROUTINE: '',
  };
  const r = await esegui('dispatch.mjs', ['--record-fixed', 'fid-77', 'Rebase annullato: il conflitto sul menu chiede una scelta fra le due versioni, e la domanda la porta all\'owner.', '--domanda', domanda], env, s.work);
  assert.equal(r.code, 0, r.se);
  assert.equal(ricevuti.filter((x) => x.url.includes('routineDeliver')).length, 1);
  assert.equal(suOrigin(s.origin, 'worker/77'), s.verificato);
});
