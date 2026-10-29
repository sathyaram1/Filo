// Sentinella: le opzioni delle registrazioni (--frase, --segnala, --nota, --ferma) valgono in ogni
// posizione, come il biglietto. Scritte prima dell'identificativo, la frase finiva nel report e il suo
// nome faceva da identificativo, con la consegna accettata (#879).
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { leggiOpzioniRegistrazione } = await import('../../scripts/dispatch.mjs');

const ID = 'fid-900';
const REPORT = 'Report per l’owner: la causa era altrove, il pulsante non veniva mai agganciato alla lista dei modelli.';
const FRASE = 'Ora puoi rimuovere un modello dalle impostazioni.';
const MOTIVO = 'conflitto: src/a.js';
const CRITICA = 'Provato ad aprire la pagina e a salvare con il titolo vuoto: funziona tutto, non ho trovato niente da segnalare.';
const SEGNALAZIONE = '## Problema\nDue strade.\n\n## Scelte\n- A: costa.\n- B: lenta.';
const NOTA_TESTO = 'Letto il diff riga per riga: solo lettura degli argomenti e un test. Niente di sospetto.';

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

function esegui(argv, env) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

/** Deposito pulito sul ramo del lavoro, stato del giro fuori da git; segnalazione e nota fuori dal deposito. */
function preparaGiro() {
  const casa = cartellaTemporanea('filo-opzioni-');
  const fuori = cartellaTemporanea('filo-opzioni-fuori-');
  const g = (...a) => execFileSync('git', a, { cwd: casa, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(resolve(casa, 'segnaposto.txt'), 'x', 'utf8');
  writeFileSync(resolve(casa, '.gitignore'), 'stato/\n', 'utf8');
  g('add', '-A');
  g('commit', '-qm', 'init');
  g('checkout', '-q', '-b', 'worker/900');
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', `${ID}.json`), JSON.stringify({
    id: ID, branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail',
  }), 'utf8');
  const seg = resolve(fuori, 'segnala.md');
  const nota = resolve(fuori, 'nota.md');
  writeFileSync(seg, SEGNALAZIONE, 'utf8');
  writeFileSync(nota, NOTA_TESTO, 'utf8');
  return { casa, fuori, seg, nota };
}

async function lancia(costruisci) {
  const { srv, ricevuti, port } = await fintoServer();
  const giro = preparaGiro();
  try {
    const r = await esegui(costruisci(giro), {
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
      FILO_REPO_ROOT: giro.casa,
      FILO_DISPATCH_STATE_DIR: resolve(giro.casa, 'stato'),
      FILO_ROUTINES_ENABLED: '1',
      FILO_ROUTINE_TICKET: 'biglietto-di-prova',
      FILO_NO_BEAT: '1',
    });
    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    return { ...r, dati: consegna ? (consegna.body.data || {}) : null, stati: readdirSync(resolve(giro.casa, 'stato')).sort() };
  } finally { srv.close(); togliCartella(giro.casa); togliCartella(giro.fuori); }
}

test('--record-fixed: frase e segnalazione arrivano uguali in ogni posizione, col ramo e l\'identificativo giusti', async () => {
  const righe = {
    'in fondo': ({ seg }) => ['--record-fixed', ID, REPORT, '--frase', FRASE, '--segnala', seg, '--motivo', MOTIVO],
    'davanti al comando': ({ seg }) => ['--motivo', MOTIVO, '--frase', FRASE, '--segnala', seg, '--record-fixed', ID, REPORT],
    'fra comando e identificativo': ({ seg }) => ['--record-fixed', '--frase', FRASE, '--motivo', MOTIVO, '--segnala', seg, ID, REPORT],
    'fra identificativo e report': ({ seg }) => ['--record-fixed', ID, '--frase', FRASE, '--motivo', MOTIVO, REPORT, '--segnala', seg],
    'con l\'uguale': ({ seg }) => ['--record-fixed', `--frase=${FRASE}`, `--segnala=${seg}`, `--motivo=${MOTIVO}`, ID, REPORT],
  };
  for (const [dove, riga] of Object.entries(righe)) {
    const r = await lancia(riga);
    assert.equal(r.code, 0, `${dove}: la consegna doveva partire (stderr: ${r.se})`);
    assert.ok(r.dati, `${dove}: la consegna deve arrivare al server`);
    assert.equal(r.dati.report, REPORT, `${dove}: il report arriva da solo, senza frase né identificativo incollati`);
    assert.equal(r.dati.userNote, FRASE, `${dove}: a chi ha segnalato arriva la frase`);
    assert.equal(r.dati.branch, 'worker/900', `${dove}: la consegna porta il ramo del lavoro`);
    assert.equal(r.dati.segnalazione, SEGNALAZIONE, `${dove}: la segnalazione arriva intera`);
    assert.ok(r.dati.motivo && r.dati.motivo.tipo, `${dove}: il motivo del correttore arriva al server`);
    assert.deepEqual(r.stati, [`${ID}.json`], `${dove}: lo stato locale resta sotto l'identificativo vero`);
  }
});

test('--record-fixed: --ferma davanti al comando vale come in fondo', async () => {
  const r = await lancia(({ seg }) => ['--ferma', '--record-fixed', ID, REPORT, '--segnala', seg, '--motivo', MOTIVO]);
  assert.equal(r.code, 0, `stderr: ${r.se}`);
  assert.equal(r.dati?.stop, true, 'la consegna porta la richiesta di fermarsi');
  assert.equal(r.dati?.report, REPORT);
});

test('--record-secaudit: la nota davanti al comando o all\'identificativo arriva intera', async () => {
  for (const riga of [
    ({ nota }) => ['--nota', nota, '--record-secaudit', ID, 'pass'],
    ({ nota }) => ['--record-secaudit', '--nota', nota, ID, 'pass'],
    ({ nota }) => [`--nota=${nota}`, '--record-secaudit', ID, 'pass'],
  ]) {
    const r = await lancia(riga);
    assert.equal(r.code, 0, `stderr: ${r.se}`);
    assert.equal(r.dati?.verdict, 'pass');
    assert.equal(r.dati?.testo, NOTA_TESTO);
    assert.equal(r.dati?.branch, 'worker/900');
    assert.deepEqual(r.stati, [`${ID}.json`]);
  }
});

test('--record-verifier: la segnalazione davanti al comando arriva con la critica', async () => {
  const r = await lancia(({ seg }) => ['--segnala', seg, '--record-verifier', ID, CRITICA]);
  assert.equal(r.code, 0, `stderr: ${r.se}`);
  assert.equal(r.dati?.critique, CRITICA);
  assert.equal(r.dati?.segnalazione, SEGNALAZIONE);
  assert.equal(r.dati?.branch, 'worker/900');
});

test('righe sbagliate: si fermano col motivo, senza chiamare il server né scrivere stato', async () => {
  const casi = [
    [({ seg }) => ['--record-fixed', '--frasi', FRASE, ID, REPORT, '--segnala', seg], /al posto dell'identificativo: --frasi/],
    [() => ['--frase', FRASE, '--record-verifier', ID, CRITICA], /--frase non vale con --record-verifier: qui ci sono solo --segnala <file\.md>/],
    [({ nota, seg }) => ['--record-secaudit', ID, 'pass', '--nota', nota, '--segnala', seg], /--segnala non vale con --record-secaudit/],
    [({ seg }) => ['--segnala', seg, '--record-pulizia', ID], /qui non ci sono opzioni/],
    [() => ['--frase', '--record-fixed', ID, REPORT], /--frase vuole la riga/],
    [() => ['--record-fixed', ID, REPORT, '--frase', FRASE, '--frase', 'Un\'altra frase.'], /--frase va passato una volta sola/],
    [() => ['--ferma=si', '--record-fixed', ID, REPORT], /--ferma non vuole un valore/],
    [({ nota }) => ['--nota', nota, '--clear-state', ID], /--nota vale solo con --record-secaudit/],
  ];
  for (const [riga, motivo] of casi) {
    const r = await lancia(riga);
    assert.equal(r.code, 1, `doveva fermarsi (stderr: ${r.se})`);
    assert.match(r.se, motivo);
    assert.equal(r.dati, null, `${r.se}: il server non va chiamato`);
    assert.deepEqual(r.stati, [`${ID}.json`], `${r.se}: nessuno stato nuovo o tolto`);
  }
});

test('--help risponde anche con un\'opzione monca dopo', async () => {
  const r = await lancia(() => ['--help', '--frase']);
  assert.equal(r.code, 0, r.se);
  assert.match(r.so, /--record-fixed/);
});

test('leggiOpzioniRegistrazione: stesso risultato in ogni posizione; il resto resta in ordine', () => {
  const attesi = { args: ['--record-fixed', ID, REPORT], valori: { '--frase': FRASE, '--segnala': 's.md' }, error: '' };
  for (const riga of [
    ['--record-fixed', ID, REPORT, '--frase', FRASE, '--segnala', 's.md'],
    ['--frase', FRASE, '--record-fixed', '--segnala', 's.md', ID, REPORT],
    ['--record-fixed', `--frase=${FRASE}`, ID, '--segnala=s.md', REPORT],
  ]) {
    assert.deepEqual(leggiOpzioniRegistrazione(riga), attesi, riga.join(' '));
  }
  // Una frase a elenco puntato non è un'opzione; quella vuota resta una scelta di chi scrive.
  assert.equal(leggiOpzioniRegistrazione(['--record-fixed', ID, REPORT, '--frase', '- ora va']).valori['--frase'], '- ora va');
  assert.equal(leggiOpzioniRegistrazione(['--record-fixed', ID, REPORT, '--frase', '']).error, '');
  // Senza opzioni non cambia niente, nemmeno per i comandi che non le leggono.
  assert.deepEqual(leggiOpzioniRegistrazione(['--clear-state', ID]), { args: ['--clear-state', ID], valori: {}, error: '' });
});
