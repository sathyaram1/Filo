// Verifica #2316 giro 1: la risposta del server alla critica resta in un file solo, e il comando che la ristampa,
// nominato nell'ultima riga, funziona anche dove gli strumenti del ramo non lo conoscono.
import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { cartellaConsegna } from '../../../scripts/lib/consegna-file.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BIGLIETTO = 'BigliettoDiProva_0123456789';
const RILIEVO = 'il pulsante non salva col titolo vuoto';

function fintoServer() {
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(Object.assign({ ok: true }, req.url.includes('routineDeliver') ? { reply: { outcome: 'fix', phase2: {
        findings: [{ level: 2, text: RILIEVO, decision: false }], derived: [], instructions: 'FASE 2: correggi solo questo.',
      } } } : {})));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

// Il clone di un lavoro: gli strumenti che girano stanno altrove (qui il repo), il clone ha i suoi o nessuno.
function clone() {
  const casa = cartellaTemporanea('filo-v2316-');
  const git = (args) => execFileSync('git', args, { cwd: casa });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(casa, 'segnaposto.txt'), 'x', 'utf8');
  writeFileSync(join(casa, '.gitignore'), 'stato/\n.claude/\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  git(['checkout', '-q', '-b', 'worker/2316']);
  mkdirSync(join(casa, 'stato'), { recursive: true });
  writeFileSync(join(casa, 'stato', 'fid-2316.json'), JSON.stringify({ id: 'fid-2316', branch: 'worker/2316', verifierVerdict: null }), 'utf8');
  return casa;
}

const ENV = (casa, port) => ({
  ...process.env,
  FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  FILO_REPO_ROOT: casa,
  FILO_DISPATCH_STATE_DIR: join(casa, 'stato'),
  FILO_ROUTINES_ENABLED: '1',
  FILO_ROUTINE_TICKET: BIGLIETTO,
  FILO_ROUTINE_ROLE: 'verifier',
  FILO_NO_BEAT: '1',
});

function registra(casa, port) {
  return new Promise((r) => execFile(process.execPath, [join(REPO, 'scripts', 'dispatch.mjs'), '--record-verifier', 'fid-2316',
    `Provato: incolla, trascina. Funziona.\n[2i] ${RILIEVO}\n    Passi: titolo vuoto, Salva.`], { cwd: casa, env: ENV(casa, port) },
  (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') })));
}

test('r1 la risposta accettata sta in un file solo della consegna, non in due copie', async () => {
  const casa = clone();
  const consegna = cartellaConsegna(casa);
  togliCartella(consegna);
  const { srv, port } = await fintoServer();
  try {
    const r = await registra(casa, port);
    expect(r.code, r.se).toBe(0);
    const conLaRisposta = readdirSync(consegna).filter((f) => readFileSync(join(consegna, f), 'utf8').includes(RILIEVO));
    expect(conLaRisposta, `file con la stessa risposta: ${conLaRisposta.join(', ')}`).toHaveLength(1);
  } finally { srv.close(); togliCartella(consegna); togliCartella(casa); }
});

test('r2 il comando di ristampa scritto nell\'ultima riga funziona dal clone del lavoro, anche se i suoi strumenti non lo hanno', async () => {
  const casa = clone();
  const consegna = cartellaConsegna(casa);
  togliCartella(consegna);
  const { srv, port } = await fintoServer();
  try {
    const r = await registra(casa, port);
    expect(r.code, r.se).toBe(0);
    const ultima = r.so.trim().split('\n').at(-1);
    const comando = (/(node \S.*--risposta-critica\s+\S+)/.exec(ultima) || [])[1];
    expect(comando, ultima).toBeTruthy();
    console.log('COMANDO', comando);
    const ristampa = spawnSync(comando, { cwd: casa, env: ENV(casa, port), shell: true, encoding: 'utf8' });
    expect(ristampa.status, `${comando}\n${ristampa.stderr}`).toBe(0);
    expect(ristampa.stdout).toContain(RILIEVO);
  } finally { srv.close(); togliCartella(consegna); togliCartella(casa); }
});
