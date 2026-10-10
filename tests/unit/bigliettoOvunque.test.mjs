// Sentinella: il biglietto a mano (`--ticket <codice>` o `--ticket=<codice>`) vale in qualunque posizione e in
// ogni comando che usa un biglietto, con la stessa regola: sostituisce, conferma o si rifiuta, mai ignorato.
// Il contratto dei worker dice «ripeti aggiungendo --ticket» (#724.1, #545, #587).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { bigliettoAMano, parolaInPiu } from '../../scripts/routine-channel.mjs';
import { leggiBigliettoAMano } from '../../scripts/lib/routine-ticket.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIGLIETTO = 'bigliettodiprova0123';
// I biglietti veri sono 43 caratteri base64url: uno su 64 comincia con un trattino, uno su 4096 con due.
// Solo questa forma, davanti, è un secondo biglietto.
const VERO = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const VERO_TRATTINO = `-${VERO.slice(1)}`;
const VERO_DUE_TRATTINI = `--${VERO.slice(2)}`;
const ALTRO_VERO = `ZZZZ${VERO.slice(4)}`;

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

function esegui(script, argv, env) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

/** Deposito git usa-e-getta, pulito, sul ramo del lavoro, con lo stato del giro fuori da git. */
function depositoSulRamo() {
  const casa = cartellaTemporanea('filo-biglietto-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: casa });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: casa });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: casa });
  writeFileSync(resolve(casa, 'segnaposto.txt'), 'x', 'utf8');
  writeFileSync(resolve(casa, '.gitignore'), 'stato/\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: casa });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: casa });
  execFileSync('git', ['checkout', '-q', '-b', 'worker/900'], { cwd: casa });
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-900.json'), JSON.stringify({
    id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail',
  }), 'utf8');
  return casa;
}

const ambiente = (port, casa) => ({
  FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  FILO_REPO_ROOT: casa,
  FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
  FILO_ROUTINES_ENABLED: '1',
  FILO_ROUTINE_TICKET: '',
  FILO_NO_BEAT: '1',
});

const REPORT = 'Report per l’owner: la causa era altrove, il pulsante non veniva mai agganciato alla lista dei modelli.';

test('dispatch: --ticket davanti a un --record-* fa quello che fa messo in coda', async () => {
  const esiti = [];
  for (const argv of [
    ['--ticket', BIGLIETTO, '--record-fixed', 'fid-900', REPORT],
    ['--record-fixed', 'fid-900', REPORT, '--ticket', BIGLIETTO],
  ]) {
    const { srv, ricevuti, port } = await fintoServer();
    const casa = depositoSulRamo();
    try {
      const r = await esegui('dispatch.mjs', argv, ambiente(port, casa));
      assert.doesNotMatch(r.se, /argomento non riconosciuto/, `ordine ${argv[0]}: ${r.se}`);
      const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
      assert.ok(consegna, `ordine ${argv[0]}: la consegna deve arrivare al server (uscita ${r.code}, stderr: ${r.se})`);
      esiti.push({ code: r.code, ticket: consegna.body.ticket });
    } finally { srv.close(); togliCartella(casa); }
  }
  assert.deepEqual(esiti[0], esiti[1], 'i due ordini devono dare lo stesso esito');
  assert.equal(esiti[0].ticket, BIGLIETTO);
});

test('deliver: --ticket al posto del biglietto davanti consegna con quel biglietto', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', 'status', '--status', 'revision_capability', '--notes', 'Report.', '--ticket', BIGLIETTO,
    ], ambiente(port, casa));
    assert.equal(r.code, 0, `la consegna doveva partire (stderr: ${r.se})`);
    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.ok(consegna, 'la consegna deve arrivare al server');
    assert.equal(consegna.body.ticket, BIGLIETTO);
    const d = consegna.body.data || {};
    assert.equal(d.ticket, undefined, 'il biglietto non è un dato della consegna');
    assert.equal(d.biglietto, undefined, 'il biglietto non è un dato della consegna');
  } finally { srv.close(); togliCartella(casa); }
});

test('deliver senza biglietto: uscita 1 col rimedio, non 3 («canale giù»), e nessuna chiamata', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', 'status', '--status', 'revision_capability', '--notes', 'Report.',
    ], ambiente(port, casa));
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /NESSUN BIGLIETTO/);
    assert.match(r.se, /--ticket/);
    assert.equal(ricevuti.length, 0, 'il server non va chiamato');
  } finally { srv.close(); togliCartella(casa); }
});

test('deliver: due biglietti diversi si rifiutano, non se ne sceglie uno in silenzio', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', ALTRO_VERO, 'status', '--status', 'revision_capability', '--notes', 'Report.',
      '--ticket', VERO,
    ], ambiente(port, casa));
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /Due biglietti diversi/);
    assert.equal(ricevuti.length, 0);
  } finally { srv.close(); togliCartella(casa); }
});

test('una regola sola: il biglietto a mano sostituisce, conferma o si rifiuta in ogni comando', () => {
  assert.deepEqual(bigliettoAMano('release', [], BIGLIETTO), { args: [BIGLIETTO] });
  assert.deepEqual(bigliettoAMano('heartbeat', [], BIGLIETTO), { args: [BIGLIETTO] });
  assert.deepEqual(bigliettoAMano('work', [], BIGLIETTO), { args: [BIGLIETTO] });
  assert.deepEqual(bigliettoAMano('compare', ['verifier', '12'], BIGLIETTO), { args: [BIGLIETTO, 'verifier', '12'] });
  assert.deepEqual(bigliettoAMano('deliver', ['status'], BIGLIETTO), { args: [BIGLIETTO, 'status'] });
  assert.deepEqual(bigliettoAMano('release', [BIGLIETTO], BIGLIETTO), { args: [BIGLIETTO] }, 'lo stesso due volte va bene');
  for (const cmd of ['release', 'heartbeat', 'work']) {
    assert.match(bigliettoAMano(cmd, [ALTRO_VERO], VERO).errore || '', /Due biglietti diversi/, cmd);
  }
  assert.match(bigliettoAMano('deliver', [ALTRO_VERO, 'status'], VERO).errore || '', /Due biglietti diversi/);
  assert.match(bigliettoAMano('probe', ['parola'], BIGLIETTO).errore || '', /parola d'ordine/, 'probe non lo ignora');
  assert.match(bigliettoAMano('ticket', ['parola'], BIGLIETTO).errore || '', /parola d'ordine/);
  assert.deepEqual(bigliettoAMano('release', ['x'], ''), { args: ['x'] }, 'senza biglietto a mano non cambia niente');
});

test('col biglietto a mano, una parola davanti che non ha la forma di un biglietto resta ai controlli del comando', () => {
  // Chiamarla «secondo biglietto» faceva togliere il biglietto giusto, e senza promemoria la risposta
  // dopo era «aggiungi il biglietto»: si girava in tondo senza mai sentir nominare l'errore vero.
  for (const [cmd, lista] of [
    ['deliver', ['fixd']],
    ['deliver', ['revision_capability']],
    ['deliver', ['fixed', 'Report senza il nome del campo davanti.']],
    ['deliver', ['status', 'revision_capability']],
    ['deliver', ['feedback', 'titolo']],
    ['release', ['verifier']],
    ['release', ['canale giù da un’ora']],
    ['heartbeat', ['loop']],
    ['work', ['altrobigliettodiprova99']],
  ]) {
    assert.deepEqual(bigliettoAMano(cmd, lista, VERO), { args: [VERO, ...lista] }, `${cmd} ${lista.join(' ')}`);
  }
  assert.deepEqual(bigliettoAMano('release', [`${VERO}\n`], VERO), { args: [VERO] }, 'lo stesso biglietto con un a capo lo conferma');
  assert.deepEqual(bigliettoAMano('deliver', [` ${VERO} `, 'note'], VERO), { args: [VERO, 'note'] });
  assert.match(bigliettoAMano('release', [`${ALTRO_VERO} `], VERO).errore || '', /Due biglietti diversi/, 'uno diverso con lo spazio resta diverso');
});

test('battito, lettura del lavoro e confronto nominano la parola in più invece di ignorarla', () => {
  assert.equal(parolaInPiu('heartbeat', [VERO, 'loop']), 'loop');
  assert.equal(parolaInPiu('work', [VERO, 'x']), 'x');
  assert.equal(parolaInPiu('compare', [VERO, 'verifier', '12', 'x']), 'x');
  assert.equal(parolaInPiu('compare', [VERO, 'verifier', '12']), '');
  assert.equal(parolaInPiu('heartbeat', []), '');
  assert.equal(parolaInPiu('heartbeat', [VERO]), '');
  assert.equal(parolaInPiu('release', [VERO, 'x']), '', 'il rilascio ha il suo testo');
  assert.equal(parolaInPiu('deliver', [VERO, 'fixed', 'x']), '', 'la consegna ha il suo testo');
});

test('promemoria perso e una parola in più: la risposta la nomina, col biglietto a mano come col biglietto davanti', async () => {
  const RIL = ['--senza-push', '--senza-rapporto'];
  for (const [argv, parola] of [
    [['deliver', 'fixed', REPORT, '--ticket', VERO], 'Report per l’owner'],
    [['deliver', 'status', 'revision_capability', '--notes', REPORT, '--ticket', VERO], 'revision_capability'],
    [['release', 'verifier', ...RIL, '--ticket', VERO], 'verifier'],
    [['release', '--role', 'verifier', 'canale giù da un’ora', ...RIL, '--ticket', VERO], 'canale giù'],
    [['heartbeat', 'loop', '--ticket', VERO], 'loop'],
    [['heartbeat', VERO, 'loop'], 'loop'],
  ]) {
    await conServer(async ({ ricevuti, env }) => {
      const r = await esegui('routine-channel.mjs', argv, env);
      assert.equal(r.code, 1, `${argv.join(' ')}: ${r.se}`);
      assert.match(r.se, /Argomento non capito/, argv.join(' '));
      assert.ok(r.se.includes(parola), `${argv.join(' ')}: ${r.se}`);
      assert.doesNotMatch(r.se, /biglietti/, argv.join(' '));
      assert.equal(ricevuti.length, 0, argv.join(' '));
    });
  }
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['release', `${VERO}\n`, '--role', 'verifier', ...RIL, '--ticket', VERO], env);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket, VERO);
  });
});

async function conServer(fn) {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try { await fn({ ricevuti, env: ambiente(port, casa) }); } finally { srv.close(); togliCartella(casa); }
}

test('rilascio e battito: il biglietto a mano arriva al server, due diversi si rifiutano', async () => {
  const RIL = ['--role', 'verifier', '--senza-push', '--senza-rapporto'];
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['release', '--ticket', BIGLIETTO, ...RIL], env);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket, BIGLIETTO);
  });
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['release', ALTRO_VERO, '--ticket', VERO, ...RIL], env);
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /Due biglietti diversi/);
    assert.equal(ricevuti.length, 0, 'nessun rilascio in silenzio del biglietto sbagliato');
  });
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['heartbeat', '--ticket', BIGLIETTO], env);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(ricevuti.find((x) => x.url.includes('routineHeartbeat'))?.body.ticket, BIGLIETTO);
  });
});

test('battito senza biglietto: uscita 1, non 3 («canale giù»), e nessuna chiamata', async () => {
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['heartbeat'], env);
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /NESSUN BIGLIETTO/);
    assert.match(r.se, /--ticket/);
    assert.equal(ricevuti.length, 0);
  });
});

test('dispatch: --ticket=<codice> vale come --ticket <codice>, davanti e dopo', async () => {
  for (const argv of [
    [`--ticket=${BIGLIETTO}`, '--record-fixed', 'fid-900', REPORT],
    ['--record-fixed', 'fid-900', REPORT, `--ticket=${BIGLIETTO}`],
  ]) {
    await conServer(async ({ ricevuti, env }) => {
      const r = await esegui('dispatch.mjs', argv, env);
      assert.equal(r.code, 0, `ordine ${argv[0].slice(0, 10)}: ${r.se}`);
      assert.equal(ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket, BIGLIETTO);
    });
  }
});

test('deliver con l\'intento storto: si ferma qui e nomina la parola, col biglietto a mano e senza', async () => {
  for (const argv of [
    ['deliver', 'fixd', '--ticket', BIGLIETTO, '--notes', 'Report.'],
    ['deliver', 'fixd', '--notes', 'Report.'],
  ]) {
    await conServer(async ({ ricevuti, env }) => {
      const r = await esegui('routine-channel.mjs', argv, env);
      assert.equal(r.code, 1, `stderr: ${r.se}`);
      assert.match(r.se, /Intento non capito: «fixd»/);
      assert.equal(ricevuti.length, 0, 'la parola storta non parte verso il server come biglietto');
    });
  }
});

test('una regola sola per il biglietto a mano: forme, ripetizioni e valori storti', () => {
  assert.deepEqual(leggiBigliettoAMano(['deliver', '--ticket', VERO]), { args: ['deliver'], ticket: VERO });
  assert.deepEqual(leggiBigliettoAMano([`--ticket=${VERO}`, 'x']), { args: ['x'], ticket: VERO });
  assert.deepEqual(leggiBigliettoAMano(['--biglietto', VERO, 'x']), { args: ['x'], ticket: VERO });
  assert.deepEqual(leggiBigliettoAMano(['--ticket', VERO, '--biglietto', VERO]), { args: [], ticket: VERO }, 'lo stesso due volte va bene');
  assert.deepEqual(leggiBigliettoAMano(['--ticket', VERO_TRATTINO]).ticket, VERO_TRATTINO);
  assert.deepEqual(leggiBigliettoAMano(['--ticket', VERO_DUE_TRATTINI]).ticket, VERO_DUE_TRATTINI);
  assert.deepEqual(leggiBigliettoAMano([`--ticket=${VERO_DUE_TRATTINI}`]).ticket, VERO_DUE_TRATTINI);
  assert.match(leggiBigliettoAMano(['--ticket', VERO, '--ticket', ALTRO_VERO]).errore || '', /Due biglietti diversi/);
  assert.match(leggiBigliettoAMano(['--ticket', VERO, '--biglietto', ALTRO_VERO]).errore || '', /Due biglietti diversi/);
  for (const storto of [['--ticket'], ['--ticket='], ['--ticket', '  '], ['--ticket', '--notes', 'x'], ['--ticket', 'abc'], ['--ticket', '-h']]) {
    assert.ok(leggiBigliettoAMano(storto).errore, JSON.stringify(storto));
  }
  assert.deepEqual(leggiBigliettoAMano(['release', 'x']), { args: ['release', 'x'], ticket: '' });
});

test('consegna: una parola che non è un intento è un intento storto, se non ha la forma lunga di un biglietto', async () => {
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['deliver', 'revision_capability', '--notes', 'Report.', '--ticket', VERO], env);
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /Intento non capito: «revision_capability»/);
    assert.doesNotMatch(r.se, /biglietti/);
    assert.equal(ricevuti.length, 0);
  });
  assert.match(bigliettoAMano('deliver', [ALTRO_VERO], VERO).errore || '', /Due biglietti diversi.*manca l'intento/);
});

test('canale: un biglietto vero col trattino davanti è un biglietto, non un\'opzione storta', async () => {
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['release', VERO_TRATTINO, '--role', 'verifier', '--senza-push', '--senza-rapporto'], env);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket, VERO_TRATTINO);
  });
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['deliver', VERO_DUE_TRATTINI, 'note', '--text', 'Una nota.'], env);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket, VERO_DUE_TRATTINI);
  });
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['release', '-guast', 'x', '--role', 'verifier', '--senza-push', '--senza-rapporto'], env);
    assert.equal(r.code, 1, 'un\'opzione storta corta resta un errore');
    assert.match(r.se, /Le opzioni si scrivono con due trattini/);
    assert.equal(ricevuti.length, 0);
  });
});

test('registrazioni: un biglietto vero con due trattini passa col segno uguale', async () => {
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('dispatch.mjs', ['--record-fixed', 'fid-900', REPORT, `--ticket=${VERO_DUE_TRATTINI}`], env);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket, VERO_DUE_TRATTINI);
  });
});

test('canale e registrazioni danno lo stesso esito sui casi fuori dal comune del biglietto a mano', async () => {
  const casi = [
    { nome: 'due diversi', canale: ['--ticket', VERO, '--ticket', ALTRO_VERO], ok: false },
    { nome: 'nome italiano diverso', canale: ['--ticket', VERO, '--biglietto', ALTRO_VERO], ok: false },
    { nome: 'lo stesso due volte', canale: ['--ticket', VERO, '--ticket', VERO], ok: true },
    { nome: 'valore storto', canale: ['--ticket', 'abc'], ok: false },
    { nome: 'valore vuoto', canale: ['--ticket='], ok: false },
  ];
  for (const c of casi) {
    for (const [script, argv] of [
      ['routine-channel.mjs', ['deliver', 'note', '--text', 'Una nota.', ...c.canale]],
      ['dispatch.mjs', ['--record-fixed', 'fid-900', REPORT, ...c.canale]],
    ]) {
      await conServer(async ({ ricevuti, env }) => {
        const r = await esegui(script, argv, env);
        const partita = ricevuti.find((x) => x.url.includes('routineDeliver'));
        if (c.ok) {
          assert.equal(r.code, 0, `${c.nome} (${script}): ${r.se}`);
          assert.equal(partita?.body.ticket, VERO, `${c.nome} (${script})`);
        } else {
          assert.equal(r.code, 1, `${c.nome} (${script}): ${r.se}`);
          assert.equal(partita, undefined, `${c.nome} (${script}): niente al server`);
        }
      });
    }
  }
});

test('battito: un --ticket= vuoto non ripiega in silenzio sul promemoria', async () => {
  await conServer(async ({ ricevuti, env }) => {
    mkdirSync(resolve(env.FILO_REPO_ROOT, '.claude'), { recursive: true });
    writeFileSync(resolve(env.FILO_REPO_ROOT, '.claude', 'routine-ticket.json'), JSON.stringify({ ticket: VERO, since: new Date().toISOString() }));
    const r = await esegui('routine-channel.mjs', ['heartbeat', '--ticket='], env);
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.equal(ricevuti.length, 0);
  });
});

test('consegna con biglietto davanti e intento storto: si ferma qui, non parte verso il server', async () => {
  await conServer(async ({ ricevuti, env }) => {
    const r = await esegui('routine-channel.mjs', ['deliver', VERO, 'fixd', '--notes', 'Report.'], env);
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /Intento non capito: «fixd»/);
    assert.equal(ricevuti.length, 0);
  });
});
