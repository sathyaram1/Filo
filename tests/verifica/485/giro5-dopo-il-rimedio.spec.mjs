// #485 giro 5 — cosa succede DOPO che il rimedio è stato registrato.
//
// I giri 1-4 hanno portato l'impronta del contenuto dentro i due esiti
// ragionati, tolto la possibilità di dettarla, fatto fermare la fusione quando
// il ramo si muove dopo i via libera, fatto scrivere lo specchio locale a tutte
// e due le strade, fatto dire l'astensione uno per uno, e preteso che quello
// che chi fonde troverà in cima sia ESATTAMENTE il contenuto esaminato. Quelle
// porte le riprovano gli altri quattro file di questa cartella, e sono verdi.
//
// Qui si guarda l'anello che nasce col giro 4: il rifiuto adesso DETTA un
// comando («rimetti il lavoro in verifica»). Un rimedio dettato va provato
// fino in fondo — cioè guardando cosa succede a chi lo esegue e poi riprova.
//
// Il canale vero non si tocca: al suo posto c'è un server finto che registra
// le buste e dice sempre di sì, così si vede cosa parte da questa macchina e
// cosa questa macchina si ricorda.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));
const GATE = fileURLToPath(new URL('../../../scripts/merge-gate.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../../scripts/routine-channel.mjs', import.meta.url));

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

function seminaStato(statoDir, id, branch) {
  mkdirSync(statoDir, { recursive: true });
  writeFileSync(resolve(statoDir, `${id}.json`), JSON.stringify({ id, branch }, null, 2) + '\n', 'utf8');
}

function lancia(script, args, env, cwd) {
  return new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
}

// Gli attrezzi del giro stanno FUORI dal ramo, com'è nelle routine: così il
// comando che il rifiuto detta esce col percorso intero e si può eseguire
// davvero, che è il punto di questo file.
const ATTREZZI = fileURLToPath(new URL('../../..', import.meta.url));

function ambiente(dir, fuori, port) {
  return {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_TOOLS_ROOT: ATTREZZI,
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

/** Il comando che il rifiuto detta, estratto dal testo così com'è scritto. */
function comandoDettato(testo) {
  const riga = String(testo || '').split(/\r?\n/).map((r) => r.trim())
    .find((r) => r.includes('routine-channel.mjs') && r.includes('revision_capability'));
  expect(riga, 'il rifiuto deve dettare il comando del rientro in verifica').toBeTruthy();
  // `node "<percorso>" deliver status --status … --branch … --notes "…"`
  const m = riga.match(/^node\s+"?([^"]+?)"?\s+(.*)$/);
  expect(m, `riga non capita: ${riga}`).toBeTruthy();
  const argomenti = m[2].match(/"[^"]*"|\S+/g).map((a) => a.replace(/^"|"$/g, ''));
  return { script: m[1], argomenti };
}

// ─────────────────────────────────────────────────────────────────────────────

test('il rimedio dettato dal rifiuto viene accettato, e il giro si chiude solo quando il contenuto è stato riesaminato davvero', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = depositoConOrigin('filo-485-g5-rimedio-');
  const fuori = cartellaTemporanea('filo-485-g5-rimedio-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
  try {
    await viaLibera(env, dir, fuori);
    const esaminato = punta();

    // Il foglio viene sostituito, e la sostituzione arriva anche dove chi fonde
    // va a prendere: è quello che fa il salvataggio automatico a ogni modifica.
    writeFileSync(resolve(dir, 'a.txt'), 'contenuto che nessuno ha letto\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'il foglio sostituito']);
    g(['push', '-q', '--no-verify', 'origin', 'worker/485']);
    const nuovo = punta();
    expect(nuovo).not.toBe(esaminato);

    const primo = await lancia(GATE, ['worker/485'], env, dir);
    expect(primo.status, 'la fusione deve fermarsi').toBe(1);
    expect(ricevuti.some((r) => r.url.includes('routineMerge'))).toBe(false);

    // Il rimedio che il rifiuto detta si esegue così com'è scritto.
    const { script, argomenti } = comandoDettato(primo.stderr);
    const rimedio = await lancia(script, argomenti, env, dir);
    expect(rimedio.status, rimedio.stderr).toBe(0);
    const busta = ricevuti.filter((r) => r.body && r.body.status === 'revision_capability');
    expect(busta.length, 'il rientro in verifica deve arrivare al canale').toBe(1);

    // Eseguito il rimedio, il lavoro è tornato in verifica: la fusione deve
    // continuare a fermarsi finché il contenuto nuovo non è stato esaminato.
    const secondo = await lancia(GATE, ['worker/485'], env, dir);
    expect(secondo.status, 'finché nessuno ha riesaminato, la fusione resta ferma').toBe(1);
    expect(ricevuti.some((r) => r.url.includes('routineMerge'))).toBe(false);

    // Il giro nuovo: verifica e controllo di sicurezza sul contenuto nuovo.
    await viaLibera(env, dir, fuori);
    const stato = JSON.parse(readFileSync(resolve(fuori, 'stato', 'ID485.json'), 'utf8'));
    expect(stato.verifierSha, 'l\'ok della verifica deve parlare del contenuto nuovo').toBe(nuovo);
    expect(stato.secauditSha, 'l\'ok del controllo di sicurezza deve parlare del contenuto nuovo').toBe(nuovo);

    const terzo = await lancia(GATE, ['worker/485'], env, dir);
    expect(terzo.status, terzo.stderr).toBe(0);
    const merge = ricevuti.filter((r) => r.url.includes('routineMerge'));
    expect(merge.length).toBe(1);
    expect(merge[0].body.sha, 'la fusione dichiara il contenuto riesaminato').toBe(nuovo);
  } finally {
    srv.close();
  }
});

test('finché il contenuto non è stato riesaminato, il rifiuto ripete parola per parola il comando appena eseguito', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { dir, g, punta } = depositoConOrigin('filo-485-g5-ripete-');
  const fuori = cartellaTemporanea('filo-485-g5-ripete-fuori-');
  const env = ambiente(dir, fuori, port);
  seminaStato(resolve(fuori, 'stato'), 'ID485', 'worker/485');
  try {
    await viaLibera(env, dir, fuori);
    const esaminato = punta();
    writeFileSync(resolve(dir, 'a.txt'), 'contenuto che nessuno ha letto\n', 'utf8');
    g(['add', '-A']);
    g(['commit', '-qm', 'il foglio sostituito']);
    g(['push', '-q', '--no-verify', 'origin', 'worker/485']);

    const primo = await lancia(GATE, ['worker/485'], env, dir);
    expect(primo.status).toBe(1);
    const { script, argomenti } = comandoDettato(primo.stderr);
    expect((await lancia(script, argomenti, env, dir)).status).toBe(0);

    const secondo = await lancia(GATE, ['worker/485'], env, dir);
    expect(secondo.status).toBe(1);

    // Questo è il rilievo di questo giro, ed è quello che si vuole veder
    // cambiare: dopo aver registrato il rientro in verifica, il rifiuto è
    // identico al primo — stesse righe, stesso comando dettato, nessuna parola
    // che distingua «devi ancora farlo» da «l'hai fatto, adesso serve un giro
    // nuovo». Chi legge non ha modo di capire che il passo è già a registro.
    expect(secondo.stderr.trim(), 'il rifiuto dopo il rimedio non distingue chi il rimedio l\'ha già registrato').not.toBe(primo.stderr.trim());

    // In ogni caso lo specchio locale non deve dire il contrario di quello che
    // è appena stato registrato: il lavoro è tornato in verifica, quindi qui
    // non può restare scritto che la verifica l'aveva approvato.
    const stato = JSON.parse(readFileSync(resolve(fuori, 'stato', 'ID485.json'), 'utf8'));
    expect(stato.verifierSha || '', 'il rientro in verifica deve portarsi via l\'ok della verifica').toBe('');
    expect(stato.secauditSha || '', 'il rientro in verifica deve portarsi via l\'ok del controllo di sicurezza').toBe('');
    expect(ricevuti.some((r) => r.url.includes('routineMerge'))).toBe(false);
  } finally {
    srv.close();
  }
});
