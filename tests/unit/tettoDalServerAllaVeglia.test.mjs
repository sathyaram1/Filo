// #2303: il tetto di costo che il server manda col compito arriva dove la veglia di chi guida il giro lo legge. Giro
// vero di dispatch col biglietto contro un server finto, in un deposito usa-e-getta: le parti provate a pezzi altrove
// qui si provano legate, così un passaggio rotto non lascia il tetto spento con le prove verdi.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { segniDiVita } = await import('../../scripts/lib/veglia-worker.mjs');
const BIGLIETTO = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-tetto';

const compito = (extra) => Object.assign({
  id: 'C-12', tipo: 'ricorrente', titolo: 'Audit di sicurezza', fiducia: 'fidato', ambito: 'audit', riservato: true,
  istruzioni: '# Compito ricorrente: audit\nControlla.', contratto: '## Contratto comune dei compiti\nRegole.',
  operazioni: [{ op: 'segnala', descr: 'mandare una segnalazione libera', attiva: true }],
}, extra);

function fintoServer(lavoro) {
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(lavoro));
      else if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/** Il giro di dispatch per un compito col `tettoUsd` dato; torna i segni che la veglia leggerebbe. */
async function giro(tettoUsd) {
  const c = compito(tettoUsd === undefined ? {} : { tettoUsd });
  const { srv, port } = await fintoServer({ ok: true, role: 'compito', id: 'C-12', num: 'C-12', branch: '', payload: { role: 'compito', compito: c } });
  const casa = cartellaTemporanea('filo-tetto-giro-');
  try {
    mkdirSync(resolve(casa, '.claude'), { recursive: true });
    cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
    const altrove = resolve(casa, 'altrove.git');
    const git = (args) => execFileSync('git', args, { cwd: casa, stdio: 'ignore' });
    execFileSync('git', ['init', '-q', '--bare', altrove]);
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
    writeFileSync(resolve(casa, '.gitignore'),
      '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\nstato/\naltrove.git/\n', 'utf8');
    git(['add', '-A']); git(['commit', '-qm', 'init']);
    git(['remote', 'add', 'origin', altrove]); git(['push', '-q', '-u', 'origin', 'main']);
    const esito = await new Promise((risolvi) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', BIGLIETTO], {
        cwd: casa,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
          FILO_REPO_ROOT: casa,
          FILO_TOOLS_ROOT: casa,
          FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
          FILO_ROUTINES_ENABLED: '1',
          FILO_FEEDBACK_PRIVKEY: '',
          FILO_NO_BEAT: '1',
        },
      });
      let so = ''; let se = '';
      p.stdout.on('data', (x) => { so += x; });
      p.stderr.on('data', (x) => { se += x; });
      p.on('close', (code) => risolvi({ code, so, se }));
    });
    const segni = segniDiVita({ root: casa, ticket: BIGLIETTO, sessione: '', leggiProcessi: () => [] });
    return { esito, segni };
  } finally {
    srv.close();
    togliCartella(casa);
  }
}

test('il tetto del compito mandato dal server arriva alla veglia, e un compito senza tetto non ne ha', async () => {
  const con = await giro(124);
  assert.match(con.esito.so, /"role":\s*"compito"/, `dispatch doveva consegnare il compito (stderr: ${con.esito.se})`);
  assert.equal(con.segni.mio, true, 'la veglia riconosce il biglietto della cartella');
  assert.equal(con.segni.tettoUsd, 124, 'la veglia legge il tetto che il server ha mandato');
  const senza = await giro(undefined);
  assert.equal(senza.segni.mio, true);
  assert.equal(senza.segni.tettoUsd, undefined, 'senza tetto la veglia non misura niente');
});
