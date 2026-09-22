// #485 giro 5 — quando le due copie non sono una avanti all'altra, ma DIVERSE.
//
// Il giro 4 ha portato il confronto con origin dentro il citofono, e le due
// direzioni hanno rimedi opposti: se là c'è MENO si spedisce il ramo, se là
// c'è DI PIÙ non si spedisce niente (si butterebbe via lavoro che qui non c'è)
// e il giro si rifà.
//
// Restano tre stati possibili, non due: le due copie possono anche essere
// DIVERSE — nessuna delle due contiene l'altra. Ci si arriva per la stessa
// strada di sempre: il salvataggio automatico spedisce, la sessione muore, il
// posizionamento successivo riporta il ramo all'ultimo punto fermo (i commit
// scartati vengono messi di lato, non distrutti), e il lavoro riparte da lì.
// Da quel momento qui e su origin ci sono due storie diverse.
//
// Qui si guarda cosa dice il citofono in quel terzo stato, e se il comando che
// detta può funzionare.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo scoprono gli assert */ }
      const url = String(req.url || '');
      ricevuti.push({ url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(url.includes('routineMerge')
        ? { ok: true, result: 'merged', sha: 'x'.repeat(40) }
        : { ok: true, id: 'ID485', num: '#485', reply: { outcome: 'pass' } }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function lancia(script, args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

function ambiente(dir, fuori, port) {
  return {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_TOOLS_ROOT: dir,
    FILO_DISPATCH_STATE_DIR: resolve(fuori, 'stato'),
    FILO_NO_BEAT: '1',
    FILO_ROUTINE_TICKET: 'biglietto-finto',
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  };
}

const CRITICA = [
  'Provato il giro intero come lo vive chi consegna, e sul cammino principale non ho trovato niente da correggere.',
  '[0] Nota cosmetica minima sul bordo del riquadro.',
  '    Passi: apri la scheda e guarda il bordo in tema chiaro.',
].join('\n');

test('le due copie sono diverse, non una avanti all\'altra: il citofono si ferma, ma il comando che detta non può riuscire', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const dir = cartellaTemporanea('filo-485-g5-diverse-');
  const remoto = cartellaTemporanea('filo-485-g5-diverse-remoto-');
  const fuori = cartellaTemporanea('filo-485-g5-diverse-fuori-');
  const g = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const env = ambiente(dir, fuori, port);
  try {
    execFileSync('git', ['init', '-q', '--bare'], { cwd: remoto, stdio: ['ignore', 'pipe', 'pipe'] });
    g(['init', '-q', '--initial-branch=main']);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);
    writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'base']);
    g(['checkout', '-qb', 'worker/485']);
    const puntoFermo = g(['rev-parse', 'HEAD']).trim();
    g(['remote', 'add', 'origin', remoto]);

    // Il lavoro della sessione morta: committato, spedito, e poi messo di lato
    // dal posizionamento successivo, che riporta il ramo al punto fermo.
    writeFileSync(resolve(dir, 'a.txt'), 'il tentativo interrotto\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'tentativo interrotto']);
    g(['push', '-q', '--no-verify', 'origin', 'worker/485']);
    const suOrigin = g(['rev-parse', 'HEAD']).trim();
    g(['reset', '-q', '--hard', puntoFermo]);

    // Il lavoro vero, fatto dopo, in questa copia.
    writeFileSync(resolve(dir, 'a.txt'), 'il contenuto esaminato\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'il lavoro']);
    const esaminato = g(['rev-parse', 'HEAD']).trim();
    expect(esaminato).not.toBe(suOrigin);

    mkdirSync(resolve(fuori, 'stato'), { recursive: true });
    writeFileSync(resolve(fuori, 'stato', 'ID485.json'),
      JSON.stringify({ id: 'ID485', branch: 'worker/485' }, null, 2) + '\n', 'utf8');
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff riga per riga: niente di pericoloso.', 'utf8');
    expect((await lancia(DISPATCH, ['--record-verifier', 'ID485', CRITICA], env, dir)).status).toBe(0);
    expect((await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir)).status).toBe(0);

    const r = await lancia(GATE, ['worker/485'], env, dir);
    // Fermarsi è giusto e succede: quello che atterrerebbe non l'ha letto nessuno.
    expect(r.status, 'con due storie diverse la fusione non deve partire').toBe(1);
    expect(ricevuti.some((x) => x.url.includes('routineMerge'))).toBe(false);

    // Ma il rimedio che detta è quello del caso «là c'è di meno»: spedire. Con
    // due storie diverse quella spedizione viene respinta, e il consiglio che
    // git dà subito dopo è di tirarsi in casa il contenuto che sta là — cioè
    // proprio quello che il citofono sta cercando di tenere fuori.
    const push = await new Promise((res) => execFile('git', ['push', 'origin', 'worker/485:worker/485'],
      { cwd: dir }, (err, so, se) => res({ ok: !err, testo: `${so || ''}${se || ''}` })));
    expect(push.ok, 'la spedizione dettata dal rifiuto non può riuscire').toBe(false);

    // Il rilievo di questo giro: il rifiuto racconta il caso sbagliato. Dice
    // che su origin il ramo è «fermo» a un contenuto vecchio e manda a
    // spedire, mentre là c'è una storia diversa, che spedire non sostituisce.
    expect(r.stderr, 'il rifiuto non deve dettare una spedizione che non può riuscire')
      .not.toMatch(/Spedisci il ramo e rilancia/);
  } finally {
    srv.close();
  }
});
