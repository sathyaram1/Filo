// Verifica #1555, giro 2: chi registra la critica sa già se il lavoro si ferma (domanda che non blocca, segnalazione
// allegata). La prova di un rilievo col `?` deve restare se il rilievo resta al lavoro, ed essere chiesta se esce.

import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function ramoConProva(prova) {
  const casa = cartellaTemporanea('filo-1555-giro2-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(casa, f)), { recursive: true }); writeFileSync(resolve(casa, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', 'stato/\n.claude/\nfuori/\n');
  scrivi('README.md', 'x\n');
  g('add', '-A'); g('commit', '-qm', 'init');
  g('checkout', '-q', '-b', 'worker/901');
  const avvio = g('rev-parse', 'HEAD');
  scrivi(prova, '// rossa\n');
  g('add', '-A'); g('commit', '-qm', 'verifica #901 giro 2: prove');
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-901.json'), JSON.stringify({
    id: 'fid-901', branch: 'worker/901', verifierVerdict: null, checkpoints: [{ sha: avvio, by: 'checkout' }],
  }), 'utf8');
  mkdirSync(resolve(casa, 'fuori'), { recursive: true });
  return { casa };
}

function fintoServer(reply) {
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...(req.url.includes('routineDeliver') ? { reply } : {}) }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const esegui = (argv, casa, port) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], {
    env: {
      ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
      FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'biglietto-di-prova', FILO_ROUTINE_ROLE: 'verifier', FILO_NO_BEAT: '1',
    },
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, out: String(so || '') + String(se || '') }));
});

const domanda = (titolo) => ({
  titolo, priorita: 'quando_puoi', blocca: false,
  contesto: 'Una scelta di gusto sul riquadro.', problema: 'Va scelto il colore. Scegli tu quale tenere.',
  opzioni: [
    { testo: 'Più caldo', pro: 'Come il resto', contro: 'Un giro in più', azione: { tipo: 'riprendi', feedbackId: 'fid-901' } },
    { testo: 'Com\'è', pro: 'Niente lavoro', contro: 'Resta freddo', azione: { tipo: 'riprendi', feedbackId: 'fid-901' } },
  ],
  consiglio: { opzione: 0, perche: 'Coerente col resto.' },
});

test('r1 con la domanda del 2 col ? che non blocca, il lavoro va avanti: la prova del 1 col ? deve uscire', async () => {
  const prova = 'tests/verifica/901/giro2-r2-bordo.spec.mjs';
  const { casa } = ramoConProva(prova);
  try {
    const critica = 'Provato il riquadro in tema chiaro e scuro.\n[2i?] Il riquadro è freddo: caldo come il resto?\n[1i?] Il bordo è grigio: più caldo?';
    const file = resolve(casa, 'fuori', 'domanda.json');
    writeFileSync(file, JSON.stringify([domanda('Colore del riquadro'), domanda('Colore del bordo')]), 'utf8');
    const { srv, port } = await fintoServer({
      outcome: 'fix', domandaProvvisoria: 'D-8',
      phase2: {
        findings: [{ level: 2, sede: 'i', decision: true, text: 'Il riquadro è freddo: caldo come il resto?' }],
        derived: [{ level: 1, sede: 'i', decision: true, text: 'Il bordo è grigio: più caldo?', num: '#901.1' }],
      },
    });
    try {
      const r = await esegui(['--record-verifier', 'fid-901', critica, '--domanda', file], casa, port);
      const chiestaPrima = r.code !== 0 && r.out.includes('giro2-r2-bordo');
      const chiestaDopo = r.code === 0 && /le prove con r2 nel nome/.test(r.out);
      expect(chiestaPrima || chiestaDopo, r.out).toBe(true);
    } finally { srv.close(); }
  } finally { togliCartella(casa); }
});

test('r1 con la segnalazione allegata il lavoro si ferma: la prova del 1 col ? resta a chi riprende', async () => {
  const { casa } = ramoConProva('tests/verifica/901/giro2-r1-bordo.spec.mjs');
  try {
    const critica = 'Provato il riquadro in tema chiaro e scuro, col mouse e da tastiera.\n[1i?] Il bordo è grigio: più caldo?';
    const file = resolve(casa, 'fuori', 'segnala.md');
    writeFileSync(file, 'Il riquadro tocca una scelta che spetta all\'owner: va deciso prima di continuare.\n', 'utf8');
    const { srv, port } = await fintoServer({
      outcome: 'stop', motivo: 'segnalazione',
      sospesi: [{ level: 1, sede: 'i', decision: true, text: 'Il bordo è grigio: più caldo?' }],
    });
    try {
      const r = await esegui(['--record-verifier', 'fid-901', critica, '--segnala', file], casa, port);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/si ferma/);
    } finally { srv.close(); }
  } finally { togliCartella(casa); }
});
