// #485 giro 3 — chi si ricorda su quale contenuto è stato dato l'ok, e cosa
// succede quando qui nessuno se lo ricorda.
//
// I giri 1 e 2 hanno portato l'impronta del contenuto dentro i due esiti
// ragionati e fatto fermare la fusione quando il ramo si è mosso dopo. Quelle
// porte le riprovano `giro1-esito-decade` e `giro2-impronta-su-tutte-le-strade`,
// e sono verdi.
//
// Qui si guarda la MEMORIA su cui quel rifiuto si regge: il fogliettino locale
// che dice «la verifica ha dato l'ok su X, il controllo di sicurezza su Y».
// Quel fogliettino lo scrive una strada sola, vive in una cartella che non
// viaggia col ramo, e quando è vuoto a metà nessuno lo dice. Tre porte, stessa
// causa: la fusione parte con un via libera che parla di un altro contenuto —
// che è la scena della segnalazione.
//
// Il canale vero non si tocca: al suo posto c'è un server finto che registra le
// buste. È esattamente ciò che si vuole guardare — cosa parte da qui, e cosa
// questa macchina dice di sapere.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../../scripts/routine-channel.mjs', import.meta.url));
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

/** Un deposito usa-e-getta con un ramo di lavoro e un commit. */
function deposito(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'contenuto esaminato\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  g(['checkout', '-qb', 'worker/485']);
  return { dir, g, punta: () => g(['rev-parse', 'HEAD']).trim() };
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
  'Provato il giro come lo vive chi consegna: esito registrato su un contenuto, contenuto cambiato, fusione chiesta.',
  '[1] Il bordo del riquadro resta grigio freddo.',
  '    Passi: apri la scheda, guarda il bordo in tema chiaro.',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────

test('l\'ok registrato dalla strada del canale non lascia detto su quale contenuto: la fusione parte dopo che il foglio è stato sostituito', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = deposito('filo-485-g3-canale-');
  const fuori = cartellaTemporanea('filo-485-g3-canale-fuori-');
  try {
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    // Le due strade che registrano un esito ragionato sono due: lo strumento
    // delle routine e il canale. Qui si usa il canale, e l'impronta parte —
    // quella parte funziona.
    const esaminato = punta();
    const ok = await lancia(CANALE, ['deliver', 'secaudit', '--verdict', 'pass', '--branch', 'worker/485', '--notes', 'letto il diff riga per riga'], env, dir);
    expect(ok.status, ok.stderr).toBe(0);
    const busta = ricevuti.find((x) => x.url.includes('routineDeliver'));
    expect(String(busta?.body?.data?.sha || ''), 'l\'esito è partito senza l\'impronta').toBe(esaminato);

    // Il foglio viene sostituito.
    writeFileSync(resolve(dir, 'a.txt'), 'righe che nessuno ha mai letto\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'sostituito dopo il via libera']);
    expect(punta()).not.toBe(esaminato);

    // La fusione deve fermarsi, esattamente come si ferma quando lo stesso
    // esito è stato registrato con l'altra strada.
    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    expect(!richiesta && gate.status !== 0,
      `la fusione è partita col via libera dato su ${esaminato.slice(0, 8)} (busta: ${JSON.stringify(richiesta?.body || null)})`).toBe(true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('di uno solo dei due ok si sa il contenuto: la fusione non parte in silenzio', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = deposito('filo-485-g3-meta-');
  const fuori = cartellaTemporanea('filo-485-g3-meta-fuori-');
  try {
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff riga per riga: nessun comando di sistema, nessuna chiave, nessuna regola del database toccata.', 'utf8');
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    // La verifica funzionale ha dato l'ok altrove (un altro contenitore, un
    // altro clone: la memoria locale non viaggia col ramo), e poi il ramo si è
    // mosso. Qui di quell'ok non resta niente.
    writeFileSync(resolve(dir, 'a.txt'), 'righe arrivate dopo la verifica\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'cambiato dopo la verifica funzionale']);

    // Il controllo di sicurezza invece gira qui, e lascia la sua impronta.
    const verdetto = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
    expect(verdetto.status, verdetto.stderr).toBe(0);
    expect(punta()).toBeTruthy();

    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const detto = `${gate.stdout}\n${gate.stderr}`;
    // O si ferma, o almeno lo dice: quello che non deve succedere è che passi
    // senza una parola su un ok di cui qui non si sa il contenuto. Astenersi
    // si dice — e lo si dice anche quando si sa solo metà.
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    const passataInSilenzio = !!richiesta && !/non risulta|non ho potuto controllare|non so/i.test(detto);
    expect(passataInSilenzio,
      `la fusione è partita senza dire che dell'ok della verifica funzionale non si sa il contenuto. Detto: ${JSON.stringify(detto.trim())}`).toBe(false);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});

test('il contenuto esaminato non è mai arrivato su origin: la fusione non parte in silenzio', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = deposito('filo-485-g3-origin-');
  const fuori = cartellaTemporanea('filo-485-g3-origin-fuori-');
  const remoto = cartellaTemporanea('filo-485-g3-origin-remoto-');
  try {
    const NOTA = resolve(fuori, 'nota.md');
    writeFileSync(NOTA, 'Letto il diff riga per riga: nessun comando di sistema, nessuna chiave, nessuna regola del database toccata.', 'utf8');
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    execFileSync('git', ['init', '-q', '--bare'], { cwd: remoto, stdio: ['ignore', 'pipe', 'pipe'] });
    g(['remote', 'add', 'origin', remoto]);
    g(['push', '-q', '--no-verify', 'origin', 'worker/485']);

    // Il lavoro vero nasce adesso, e su origin non ci arriva: è il caso in cui
    // il salvataggio automatico ha provato a spedire e non c'è riuscito, che
    // per costruzione non ferma niente e finisce solo nei log.
    writeFileSync(resolve(dir, 'a.txt'), 'la correzione vera, esaminata qui\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'la correzione']);
    const esaminato = punta();
    const suOrigin = g(['rev-parse', 'origin/worker/485']).trim();
    expect(esaminato).not.toBe(suOrigin);

    const verdetto = await lancia(DISPATCH, ['--record-secaudit', 'ID485', 'pass', '--nota', NOTA], env, dir);
    expect(verdetto.status, verdetto.stderr).toBe(0);

    // Il server fonde quello che trova su GitHub, cioè il contenuto VECCHIO:
    // il via libera parla di un altro contenuto, ed è di nuovo la scena della
    // segnalazione. O ci si ferma, o lo si dice.
    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const detto = `${gate.stdout}\n${gate.stderr}`;
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    const passataInSilenzio = !!richiesta && !/origin|spedit|non è arrivat|push/i.test(detto);
    expect(passataInSilenzio,
      `la fusione è partita con il contenuto esaminato (${esaminato.slice(0, 8)}) mai arrivato su origin, dove c'è ancora ${suOrigin.slice(0, 8)}. Detto: ${JSON.stringify(detto.trim())}`).toBe(false);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
    rmSync(remoto, { recursive: true, force: true });
  }
});

// Dal 24/09/2026 la verifica mossa dopo il verdetto la giudica il server: qui si guarda che la strada del
// canale lasci la stessa memoria, perché la nota la nomini invece di astenersi.
test('la strada del canale non è meno severa nemmeno sulla verifica funzionale', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = deposito('filo-485-g3-canale-verifica-');
  const fuori = cartellaTemporanea('filo-485-g3-canale-verifica-fuori-');
  try {
    seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
    const env = ambiente(dir, fuori, port);

    const provato = punta();
    const ok = await lancia(CANALE, ['deliver', 'verdict', '--branch', 'worker/485', '--critique', CRITICA, '--summary', 'Provato il giro come lo vive chi consegna.'], env, dir);
    expect(ok.status, ok.stderr).toBe(0);

    writeFileSync(resolve(dir, 'a.txt'), 'righe che nessuno ha mai letto\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'sostituito dopo la verifica']);

    const gate = await lancia(GATE, ['worker/485'], env, dir);
    const richiesta = ricevuti.find((x) => x.url.includes('routineMerge'));
    expect(!richiesta && gate.status !== 0,
      `la fusione è partita con la verifica funzionale data su ${provato.slice(0, 8)} (busta: ${JSON.stringify(richiesta?.body || null)})`).toBe(true);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
});
