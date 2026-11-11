// La risposta del server alla critica non vive solo sull'uscita del comando (#2316): resta in un file della consegna,
// la nomina l'ultima riga stampata e `--risposta-critica` la ristampa, solo sul ramo che l'ha registrata.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { cartellaConsegna } from '../../scripts/lib/consegna-file.mjs';
import { FILE_RISPOSTA_CRITICA, leggiRispostaCritica, scriviRispostaCritica } from '../../scripts/lib/risposta-critica.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIGLIETTO = 'BigliettoDiProva_0123456789';

function fintoServer(reply) {
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(Object.assign({ ok: true }, req.url.includes('routineDeliver') ? { reply } : {})));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

function esegui(argv, env) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

function casaSulRamo() {
  const casa = cartellaTemporanea('filo-risposta-critica-');
  const git = (args) => execFileSync('git', args, { cwd: casa });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(resolve(casa, 'segnaposto.txt'), 'x', 'utf8');
  writeFileSync(resolve(casa, '.gitignore'), 'stato/\n.claude/\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  git(['checkout', '-q', '-b', 'worker/2316']);
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-2316.json'), JSON.stringify({ id: 'fid-2316', branch: 'worker/2316', verifierVerdict: null }), 'utf8');
  return { casa, git };
}

const ENV = (casa, port) => ({
  FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  FILO_REPO_ROOT: casa,
  FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
  FILO_ROUTINES_ENABLED: '1',
  FILO_ROUTINE_TICKET: BIGLIETTO,
  FILO_ROUTINE_ROLE: 'verifier',
  FILO_NO_BEAT: '1',
});

test('c\'è da correggere: la risposta resta su file, l\'ultima riga la nomina e --risposta-critica la ristampa intera', async () => {
  const { casa, git } = casaSulRamo();
  const consegna = cartellaConsegna(casa);
  const { srv, port } = await fintoServer({ outcome: 'fix', phase2: {
    findings: [{ level: 2, text: 'il pulsante non salva', decision: false }],
    derived: [{ level: 0, text: 'caso raro', decision: false, num: '#9001' }],
    budgets: { cap2: { cap: 5, used: 1, left: 4 } },
    instructions: 'FASE 2: correggi solo questo.',
  } });
  try {
    const r = await esegui(['--record-verifier', 'fid-2316',
      'Provato: incolla, trascina. Funziona.\n[2i] il pulsante non salva\n    Passi: titolo vuoto, Salva.\n[0i] caso raro'], ENV(casa, port));
    assert.equal(r.code, 0, `la critica doveva essere accettata (stderr: ${r.se})`);
    const file = join(consegna, FILE_RISPOSTA_CRITICA);
    const ultima = r.so.trim().split('\n').at(-1);
    assert.ok(ultima.includes(file), `l'ultima riga, quella che regge un «| tail», nomina il file: ${ultima}`);
    assert.match(ultima, /--risposta-critica fid-2316/);

    // Il caso della segnalazione: la stampa è persa, e il file da solo porta rilievi, derivati e istruzioni.
    const salvato = readFileSync(file, 'utf8');
    for (const atteso of [/esito=fix/, /\[2i\] il pulsante non salva/, /#9001/, /FASE 2: correggi solo questo\./, /cap2: 4 giri residui su 5/]) {
      assert.match(salvato, atteso);
    }

    // La ristampa, col biglietto a mano come la chiedeva la segnalazione: uguale a quello che il comando aveva stampato.
    const di = await esegui(['--risposta-critica', 'fid-2316', '--ticket', BIGLIETTO], ENV(casa, port));
    assert.equal(di.code, 0, di.se);
    const stampata = r.so.trim().split('\n').slice(0, -2).join('\n');
    assert.equal(di.so.trim(), stampata.trim(), 'la ristampa è la risposta intera, nient\'altro');
    const senzaId = await esegui(['--risposta-critica'], ENV(casa, port));
    assert.equal(senzaId.code, 0, senzaId.se);
    assert.equal(senzaId.so, di.so);

    // Un altro lavoro sullo stesso clone sta su un altro ramo: la risposta di questo non è sua.
    git(['checkout', '-q', '-b', 'worker/altro']);
    const altro = await esegui(['--risposta-critica'], ENV(casa, port));
    assert.equal(altro.code, 2);
    assert.equal(altro.so, '', 'niente della risposta esce su un altro ramo');
    assert.match(altro.se, /sul ramo worker\/2316, non su questo/);
  } finally { srv.close(); togliCartella(consegna); togliCartella(casa); }
});

test('senza una critica registrata --risposta-critica lo dice, ed esce senza toccare il server', async () => {
  const { casa } = casaSulRamo();
  const consegna = cartellaConsegna(casa);
  rmSync(consegna, { recursive: true, force: true });
  try {
    const r = await esegui(['--risposta-critica', 'fid-2316'], ENV(casa, 9));
    assert.equal(r.code, 2);
    assert.match(r.se, /Nessuna risposta a una critica da ristampare/);
    const storto = await esegui(['--risposta-critica', 'fid-2316', 'avanzo'], ENV(casa, 9));
    assert.equal(storto.code, 1);
    assert.match(storto.se, /Uso: --risposta-critica/);
  } finally { togliCartella(casa); }
});

test('la lettura riconosce solo un file scritto da lei, e rifiuta un altro identificativo o un altro ramo', () => {
  const dir = cartellaTemporanea('filo-risposta-file-');
  try {
    const f = scriviRispostaCritica('', { id: 'fid-1', ramo: 'worker/1', sha: 'abc', testo: 'stato fid-1: esito=fix\nriga due' }, { dir });
    assert.equal(f, join(dir, FILE_RISPOSTA_CRITICA));
    const ok = leggiRispostaCritica('', { id: 'fid-1', ramo: 'worker/1', dir });
    assert.equal(ok.testo, 'stato fid-1: esito=fix\nriga due');
    assert.equal(ok.sha, 'abc');
    assert.match(leggiRispostaCritica('', { id: 'fid-2', dir }).errore, /di fid-1, non di fid-2/);
    assert.match(leggiRispostaCritica('', { ramo: 'worker/2', dir }).errore, /ramo worker\/1/);
    writeFileSync(f, 'un testo qualunque\n', 'utf8');
    assert.match(leggiRispostaCritica('', { dir }).errore, /non è una risposta salvata/);
    rmSync(f);
    assert.ok(!existsSync(f));
    assert.match(leggiRispostaCritica('', { dir }).errore, /Nessuna risposta/);
  } finally { togliCartella(dir); }
});
