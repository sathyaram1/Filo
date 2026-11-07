// Un lavoro nuovo ripartito sullo stesso biglietto resta sul ramo a cui il server l'ha legato, e se il server rifiuta
// la presa in carico per il ramo dispatch si ferma prima del lavoratore (#1632). Giro vero col biglietto contro un
// server finto che lega il biglietto al primo ramo dichiarato, come deliver.js; cartelle usa-e-getta.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aspettaChe } from '../helpers/attese.mjs';
import { newWorkBranch } from '../../scripts/lib/branch-integrity.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'fid-1632';
const BIGLIETTO = 'biglietto-di-prova';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}
const ramiWorker = (cwd) => git(cwd, 'branch', '--list', `worker/${ID}-*`, '--format=%(refname:short)').split('\n').filter(Boolean);

/** `portaIlRamo`: la busta di un lavoro nuovo porta il ramo del biglietto (il server corretto); senza, quello di oggi. */
function fintoServer({ portaIlRamo }) {
  const mondo = { legato: '', consegne: [] };
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) return res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      if (req.url.endsWith('/routineWork')) {
        return res.end(JSON.stringify({
          ok: true, role: 'new-work', id: ID, num: '#1632', branch: portaIlRamo ? mondo.legato : '',
          payload: { role: 'new-work', num: '#1632', feedback: { name: 'Il ramo', text: 'Il lavoro riparte su un ramo nuovo.', num: '#1632' } },
        }));
      }
      if (req.url.endsWith('/routineDeliver')) {
        const { intent, data = {} } = JSON.parse(corpo || '{}');
        const ramo = String(data.branch || '');
        if (ramo && !mondo.legato) mondo.legato = ramo;
        const rifiutata = !!ramo && ramo !== mondo.legato;
        mondo.consegne.push({ intent, status: data.status, branch: ramo, rifiutata });
        if (rifiutata) {
          res.statusCode = 409;
          return res.end(JSON.stringify({ ok: false, reason: 'branch_mismatch', detail: `${ramo} ≠ ${mondo.legato}` }));
        }
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, mondo, port: srv.address().port })));
}

function scena(base) {
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  mkdirSync(casa, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(casa, 'init', '-q', '-b', 'main');
  cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(casa, '.gitignore'),
    '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\n', 'utf8');
  const main = commit(casa, 'segnaposto.txt', 'x\n');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  return { origin, casa, main };
}

/** Un'altra macchina (una sessione nuova): clone fresco, senza i rami locali né lo stato della prima. */
function altraCasa(base, origin, nome) {
  const casa = resolve(base, nome);
  git(base, 'clone', '-q', origin, casa);
  return casa;
}

function eseguiIn(casa, port, script, args) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', script), ...args], {
      cwd: casa,
      env: {
        ...process.env,
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        FILO_REPO_ROOT: casa,
        FILO_TOOLS_ROOT: casa,
        FILO_DISPATCH_STATE_DIR: resolve(casa, '..', `stato-${casa.split(/[\\/]/).pop()}`),
        FILO_ROUTINES_ENABLED: '1',
        FILO_FEEDBACK_PRIVKEY: '',
        FILO_NO_BEAT: '1',
      },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(so.slice(so.indexOf('{'), so.lastIndexOf('}') + 1)); } catch (_) { /* lo dice l'assert */ }
      risolvi({ code, json, so, se });
    });
  });
}
const giro = (casa, port) => eseguiIn(casa, port, 'dispatch.mjs', ['--ticket', BIGLIETTO]);

test('server di oggi (la busta non porta il ramo): il secondo dispatch sullo stesso biglietto si ferma prima del lavoratore', async () => {
  const base = cartellaTemporanea('filo-ramo-biglietto-');
  const { srv, mondo, port } = await fintoServer({ portaIlRamo: false });
  try {
    const { casa } = scena(base);
    const primo = await giro(casa, port);
    assert.equal(primo.json && primo.json.role, 'new-work', `il primo giro lavora (uscita ${primo.code}): ${primo.se}`);
    const legato = git(casa, 'rev-parse', '--abbrev-ref', 'HEAD');
    assert.match(legato, new RegExp(`^worker/${ID}-\\d{8}T\\d{6}Z$`), 'busta senza ramo: nome nuovo per tentativo (#378)');
    assert.equal(mondo.legato, legato, 'la presa in carico ha legato il biglietto a quel ramo');

    // Il nome per tentativo ha la risoluzione del secondo: la sessione ripresa riparte quando il nome è già un altro.
    await aspettaChe(() => newWorkBranch(ID) !== legato, { cosa: 'un nome per tentativo diverso dal primo' });
    const secondo = await giro(casa, port);
    const nuovo = git(casa, 'rev-parse', '--abbrev-ref', 'HEAD');
    assert.notEqual(nuovo, legato);
    assert.equal(secondo.json && secondo.json.role, 'halt', `nessun lavoratore su un ramo che il server rifiuterà: ${secondo.so.slice(0, 300)}`);
    assert.equal(secondo.json.payload.kind, 'transient', 'guasto temporaneo: il lavoro torna in coda');
    assert.equal(secondo.code, 3);
    const msg = secondo.json.payload.message;
    assert.ok(msg.includes(nuovo) && msg.includes(legato), `il messaggio dice i due nomi: ${msg}`);
    assert.doesNotMatch(msg, /["`$\\]/, 'si ricopia dentro le virgolette di --guasto');
    assert.ok(secondo.json.instructions.includes('--role halt --guasto'), 'il testo è quello del guasto');
    const dopo = mondo.consegne.slice(mondo.consegne.findIndex((c) => c.rifiutata));
    assert.deepEqual(dopo.map((c) => c.status), ['working'], 'dopo la presa in carico rifiutata non parte nessun\'altra consegna');
  } finally {
    srv.close();
    togliCartella(base);
  }
});

test('server che porta il ramo del biglietto: chi riparte sta sul ramo legato, da dovunque, e la consegna è accettata', async () => {
  const base = cartellaTemporanea('filo-ramo-biglietto-');
  const { srv, mondo, port } = await fintoServer({ portaIlRamo: true });
  try {
    const { origin, casa, main } = scena(base);
    const primo = await giro(casa, port);
    assert.equal(primo.json && primo.json.role, 'new-work', `il primo giro lavora (uscita ${primo.code}): ${primo.se}`);
    const legato = mondo.legato;
    assert.equal(git(casa, 'rev-parse', '--abbrev-ref', 'HEAD'), legato);

    // Ripartenza su un'altra macchina, col ramo mai spinto: nasce con quel nome, dalla linea principale.
    const seconda = altraCasa(base, origin, 'seconda');
    const r2 = await giro(seconda, port);
    assert.equal(r2.json && r2.json.role, 'new-work', `il giro ripartito lavora (uscita ${r2.code}): ${r2.se}`);
    assert.equal(git(seconda, 'rev-parse', '--abbrev-ref', 'HEAD'), legato, 'stesso ramo del biglietto, nessun nome nuovo');
    assert.equal(git(seconda, 'rev-parse', 'HEAD'), main, 'nato dalla linea principale');
    assert.deepEqual(ramiWorker(seconda), [legato]);
    assert.match(r2.se, /nasce adesso con quel nome/);

    // Il lavoratore di questa sessione spinge un commit (il salvataggio automatico), poi la sessione muore.
    const lavoro = commit(seconda, 'lavoro.js', 'fatto a metà\n');
    git(seconda, 'push', '-q', 'origin', legato);

    // Ripartenza sulla prima macchina, che ha il ramo locale indietro: si riprende dalla punta su origin.
    const r3 = await giro(casa, port);
    assert.equal(r3.json && r3.json.role, 'new-work', `il giro ripartito lavora (uscita ${r3.code}): ${r3.se}`);
    assert.equal(git(casa, 'rev-parse', '--abbrev-ref', 'HEAD'), legato);
    assert.equal(git(casa, 'rev-parse', 'HEAD'), lavoro, 'il lavoro già spinto non si perde');
    assert.deepEqual(ramiWorker(casa), [legato], 'nessun ramo worker/<id>-<ora> nuovo');
    assert.match(r3.se, /si riprende dalla sua punta/);
    assert.ok(mondo.consegne.every((c) => !c.rifiutata), 'nessuna presa in carico rifiutata');

    const fine = commit(casa, 'lavoro.js', 'fatto\n');
    const consegna = await eseguiIn(casa, port, 'routine-channel.mjs',
      ['deliver', BIGLIETTO, 'status', '--status', 'revision_capability', '--notes', 'Fatto.', '--frase', 'Adesso va.']);
    assert.equal(consegna.code, 0, `la consegna parte e il server la accetta: ${consegna.se}`);
    const ultima = mondo.consegne[mondo.consegne.length - 1];
    assert.deepEqual(ultima, { intent: 'status', status: 'revision_capability', branch: legato, rifiutata: false });
    assert.notEqual(fine, lavoro);
  } finally {
    srv.close();
    togliCartella(base);
  }
});
