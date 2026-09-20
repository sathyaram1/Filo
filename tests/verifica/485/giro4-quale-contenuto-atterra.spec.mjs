// #485 giro 4 — quale contenuto atterra davvero su main.
//
// I giri 1-3 hanno portato l'impronta del contenuto dentro i due esiti
// ragionati, tolto la possibilità di dettarla, fatto fermare la fusione quando
// il ramo si muove dopo i via libera, fatto scrivere lo specchio locale a
// TUTTE e due le strade che registrano un esito, e fatto dire l'astensione uno
// per uno. Quelle porte le riprovano gli altri tre file di questa cartella, e
// sono verdi.
//
// Qui si guarda l'ULTIMO anello, quello che il pattern nato con questo lavoro
// descrive così: «l'impronta deve descrivere quello che chi legge andrà
// DAVVERO a prendere». Chi fonde non prende questa directory: scarica il ramo
// da GitHub e fonde la sua PUNTA. Il controllo aggiunto chiede se il contenuto
// esaminato sia ARRIVATO là — non se sia quello che c'è in cima — e non guarda
// nemmeno se la domanda a GitHub sia andata a buon fine.
//
// Il canale vero non si tocca: al suo posto c'è un server finto che registra
// le buste, ed è proprio quello che si vuole guardare — cosa parte da qui.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));

/** Un server finto che registra le buste e risponde «fatto». */
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

/** Un deposito usa-e-getta con un ramo di lavoro, un origin e un commit spedito. */
function depositoConOrigin(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const remoto = cartellaTemporanea(`${prefisso}remoto-`);
  const g = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare'], { cwd: remoto, stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', 'worker/485']);
  writeFileSync(resolve(dir, 'a.txt'), 'il contenuto esaminato\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'il lavoro']);
  g(['remote', 'add', 'origin', remoto]);
  g(['push', '-q', '--no-verify', 'origin', 'worker/485']);
  return { dir, remoto, g, punta: () => g(['rev-parse', 'HEAD']).trim() };
}

/** Lo stato locale del lavoro, come lo lascia il dispatcher quando assegna. */
function seminaStato(statoDir, id, branch) {
  mkdirSync(statoDir, { recursive: true });
  writeFileSync(resolve(statoDir, `${id}.json`), JSON.stringify({ id, branch }, null, 2) + '\n', 'utf8');
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

/** I due via libera, registrati qui sul contenuto che c'è adesso. */
async function viaLibera(env, dir, fuori) {
  const NOTA = resolve(fuori, 'nota.md');
  writeFileSync(NOTA, 'Letto il diff riga per riga: nessun comando di sistema, nessuna chiave, nessuna regola del database toccata.', 'utf8');
  const v = await lancia(DISPATCH, ['--record-verifier', 'ID485', CRITICA], env, dir);
  expect(v.status, v.stderr).toBe(0);
  const s = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
  expect(s.status, s.stderr).toBe(0);
}

// ─────────────────────────────────────────────────────────────────────────────

test('su origin il ramo è più avanti del contenuto esaminato: quello che atterra non l\'ha letto nessuno', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, remoto, g, punta } = depositoConOrigin('filo-485-g4-avanti-');
  const fuori = cartellaTemporanea('filo-485-g4-avanti-fuori-');
  const altra = cartellaTemporanea('filo-485-g4-avanti-altra-copia-');
  try {
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    const esaminato = punta();
    await viaLibera(env, dir, fuori);

    // Il ramo su origin va avanti senza che questa directory si muova. Non è un
    // caso di laboratorio: il ripristino a un punto fermo riporta indietro la
    // copia locale e riallinea origin SOLO se è riuscito a metterci al sicuro i
    // commit scartati; se quella spedizione non riesce, origin resta avanti e
    // qui nessuno se ne accorge.
    execFileSync('git', ['clone', '-q', remoto, altra], { stdio: ['ignore', 'pipe', 'pipe'] });
    const h = (args) => execFileSync('git', args, { cwd: altra, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    h(['config', 'user.email', 't@t']);
    h(['config', 'user.name', 't']);
    h(['checkout', '-q', 'worker/485']);
    writeFileSync(resolve(altra, 'a.txt'), 'righe che nessuno ha mai letto\n', 'utf8');
    h(['add', '-A']);
    h(['commit', '-qm', 'in cima a origin, mai esaminato']);
    h(['push', '-q', '--no-verify', 'origin', 'worker/485']);
    const inCima = h(['rev-parse', 'HEAD']).trim();

    expect(punta()).toBe(esaminato);
    expect(inCima).not.toBe(esaminato);

    // Chi fonde scarica il ramo e fonde la sua PUNTA: quella di origin, non
    // questa. O ci si ferma, o almeno lo si dice.
    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const detto = `${gate.stdout}\n${gate.stderr}`;
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    const passataInSilenzio = !!richiesta && !/avanti|in cima|più nuovo|non è la punta|origin è su/i.test(detto);
    expect(passataInSilenzio,
      `la fusione è partita dichiarando ${esaminato.slice(0, 8)}, mentre su origin il ramo è in cima a ${inCima.slice(0, 8)}, che è quello che il server fonderà e che nessuno ha esaminato. Detto: ${JSON.stringify(detto.trim())}`).toBe(false);
  } finally {
    srv.close();
    for (const d of [dir, remoto, fuori, altra]) rmSync(d, { recursive: true, force: true });
  }
});

test('origin irraggiungibile: il controllo sulla pubblicazione non si regge su un riferimento vecchio senza dirlo', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, remoto, punta } = depositoConOrigin('filo-485-g4-muto-');
  const fuori = cartellaTemporanea('filo-485-g4-muto-fuori-');
  try {
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    const esaminato = punta();
    await viaLibera(env, dir, fuori);

    // Da qui in poi a GitHub non si parla più. Il riferimento locale a origin
    // resta quello di prima: dice dov'era il ramo, non dov'è.
    rmSync(remoto, { recursive: true, force: true });

    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const detto = `${gate.stdout}\n${gate.stderr}`;
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    const passataInSilenzio = !!richiesta && !/non ho potuto controllare|non risponde|irraggiungibile|non sono riuscito/i.test(detto);
    expect(passataInSilenzio,
      `la fusione è partita dichiarando ${esaminato.slice(0, 8)} dopo aver concluso sulla pubblicazione senza aver potuto parlare con origin. Detto: ${JSON.stringify(detto.trim())}`).toBe(false);
  } finally {
    srv.close();
    for (const d of [dir, fuori]) rmSync(d, { recursive: true, force: true });
    rmSync(remoto, { recursive: true, force: true });
  }
});
