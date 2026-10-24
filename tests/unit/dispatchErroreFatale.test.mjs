// #1205.1: quando dispatch muore per un errore che non aveva previsto, la sessione riceve lo stesso testo del guasto
// dichiarato (domanda di fine sessione e rilascio col guasto), non la sola riga «errore fatale». Giro vero col
// biglietto, contro un server finto, in un deposito usa-e-getta con i testi dei ruoli copiati e un pezzo tolto.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { motivoFatale, istruzioniGuastoDiRiserva } = await import('../../scripts/dispatch.mjs');

const LAVORO = {
  ok: true, role: 'new-work', id: 'fid-1205', num: '#1205', branch: '',
  payload: { role: 'new-work', num: '#1205', feedback: { name: 'Titolo', text: 'Testo della segnalazione.', num: '#1205' } },
};

function fintoServer() {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(LAVORO));
      else if (req.url.includes('config')) res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/** Il giro col biglietto, coi testi dei ruoli presi da una copia a cui mancano i pezzi `tolti`. */
async function giroSenza(tolti) {
  const { srv, port } = await fintoServer();
  const casa = cartellaTemporanea('filo-fatale-');
  try {
    mkdirSync(resolve(casa, '.claude'), { recursive: true });
    cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
    for (const nome of tolti) rmSync(resolve(casa, 'routines', 'roles', nome));
    const altrove = resolve(casa, 'altrove.git');
    const git = (args) => execFileSync('git', args, { cwd: casa, stdio: 'ignore' });
    execFileSync('git', ['init', '-q', '--bare', altrove]);
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
    writeFileSync(resolve(casa, '.gitignore'),
      '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\nstato/\n', 'utf8');
    git(['add', '-A']); git(['commit', '-qm', 'init']);
    git(['remote', 'add', 'origin', altrove]); git(['push', '-q', '-u', 'origin', 'main']);
    return await new Promise((risolvi) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', 'biglietto-di-prova'], {
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
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', (code) => {
        const i = so.indexOf('{');
        let json = null;
        try { json = i >= 0 ? JSON.parse(so.slice(i, so.lastIndexOf('}') + 1)) : null; } catch (_) { /* lo dice l'assert */ }
        risolvi({ code, json, se });
      });
    });
  } finally {
    srv.close();
    togliCartella(casa);
  }
}

const piatto = (s) => String(s || '').replace(/\s+/g, ' ');

test('un pezzo condiviso mancante: la sessione riceve il guasto con la domanda di fine sessione e il rilascio', async () => {
  const r = await giroSenza(['_criteri-verifica.md']);
  assert.ok(r.json, `doveva arrivare un compito, non la sola riga d'errore (stderr: ${r.se})`);
  assert.equal(r.json.role, 'halt');
  assert.equal(r.code, 3, 'esce come un guasto dichiarato');
  assert.match(r.json.payload.message, /errore imprevisto di dispatch: .*_criteri-verifica\.md/);
  const t = piatto(r.json.instructions);
  assert.match(t, /domanda --biglietto <biglietto>/, 'la domanda di fine sessione');
  assert.match(t, /release <biglietto> --role halt --guasto/, 'e il rilascio col guasto');
});

test('se manca anche un pezzo del testo del guasto, arriva quello di riserva con gli stessi due passi', async () => {
  const r = await giroSenza(['_criteri-verifica.md', '_domanda-fine-sessione.md']);
  assert.ok(r.json, `doveva arrivare un compito (stderr: ${r.se})`);
  assert.equal(r.json.role, 'halt');
  assert.equal(r.code, 3);
  const t = piatto(r.json.instructions);
  assert.match(t, /routine-channel\.mjs" domanda --biglietto <biglietto>/);
  assert.ok(t.includes(`release <biglietto> --role halt --guasto "${r.json.payload.message}"`), t);
});

test('il motivo si ricopia dentro le virgolette del rilascio senza romperle, e un percorso di Windows resta leggibile', () => {
  const m = motivoFatale(new Error('a "b" `c` $HOME \\ e\nriga due'));
  assert.doesNotMatch(m, /["`$\\\n]/);
  assert.match(m, /^errore imprevisto di dispatch: a 'b' 'c' 'HOME \/ e riga due$/);
  assert.match(istruzioniGuastoDiRiserva(m, 'C:\\strumenti\\scripts\\routine-channel.mjs'), /node "C:\/strumenti\/scripts\/routine-channel\.mjs" release/);
});
