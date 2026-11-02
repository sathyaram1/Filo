// La veglia di chi guida il giro: un worker fermo su un permesso che in cloud nessuno approva viene dichiarato guasto
// dopo venti minuti senza segni di vita, invece di tenere il giro appeso per ore (#1797). A chi guida arrivano solo
// righe fisse: quello che la veglia legge del worker va nel guasto e basta.

import '../helpers/senzaSessione.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { senzaSessione } from '../helpers/sessione.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const {
  giudica, strumentoInAttesa, programmaDi, testoGuasto, tracceSottoAgenti, segniDiVita, veglia, cartellaSottoAgenti,
  attivitaPerBattito, SOGLIA_FERMO_MS, USCITA_FINITO, USCITA_FERMO, USCITA_LAVORA, TESTO_FINITO,
} = await import('../../scripts/lib/veglia-worker.mjs');
const { impronta, FILE_REGISTRO } = await import('../../scripts/lib/orchestratore-cieco.mjs');

const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const SID = 'sessione-del-giro-1797';
const MIN = 60 * 1000;
const ADESSO = Date.parse('2026-10-30T10:00:00Z');
// Il caso di #1776: un push lanciato a mano per riprodurre un bug, fermo sul controllo dei permessi.
const PUSH = `cd "/tmp/filo-lavori/1" && git push --dry-run --force-with-lease=refs/heads/x:${B} origin HEAD:refs/heads/x`;

const uso = (id, nome, input, ora) => ({ type: 'assistant', timestamp: new Date(ora).toISOString(), message: { content: [{ type: 'tool_use', id, name: nome, input }] } });
const risposta = (id, ora) => ({ type: 'user', timestamp: new Date(ora).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const righe = (...o) => `${o.map((x) => JSON.stringify(x)).join('\n')}\n`;

const fatti = [];
test.after(() => { for (const d of fatti) { try { togliCartella(d); } catch (_) {} } });
const cartella = (nome) => { const d = cartellaTemporanea(nome); fatti.push(d); return d; };

describe('il giudizio', () => {
  test('finito vince; un processo o nessun segno noto non è un fermo; venti minuti di silenzio sì', () => {
    assert.equal(giudica({ finito: true, tempi: [ADESSO - 90 * MIN], adesso: ADESSO }).stato, 'finito');
    assert.equal(giudica({ processi: 1, tempi: [ADESSO - 90 * MIN], adesso: ADESSO }).stato, 'lavora');
    assert.equal(giudica({ tempi: [NaN], adesso: ADESSO }).stato, 'lavora', 'senza un momento noto non si dichiara niente');
    assert.deepEqual(giudica({ tempi: [ADESSO - 40 * MIN, ADESSO - 5 * MIN, NaN], adesso: ADESSO }), { stato: 'lavora', fermoMs: 5 * MIN });
    assert.deepEqual(giudica({ tempi: [ADESSO - 40 * MIN, ADESSO - SOGLIA_FERMO_MS], adesso: ADESSO }), { stato: 'fermo', fermoMs: SOGLIA_FERMO_MS });
    assert.equal(SOGLIA_FERMO_MS, 20 * MIN);
  });

  test('lo strumento in attesa è l\'ultimo senza risposta, e un lancio di sotto-agente aperto non conta', () => {
    const t = ADESSO - 30 * MIN;
    const l = [
      uso('a', 'Bash', { command: 'npm run test:unit' }, t), risposta('a', t + 1000),
      uso('b', 'Agent', { prompt: 'esplora' }, t + 2000),
      uso('c', 'Bash', { command: PUSH }, t + 3000),
      'riga {tagliata',
    ].map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    assert.deepEqual(strumentoInAttesa(l), { nome: 'Bash', comando: PUSH, ms: t + 3000 });
    assert.equal(strumentoInAttesa([JSON.stringify(uso('b', 'Agent', {}, t))]), null);
    assert.equal(strumentoInAttesa([]), null);
    assert.equal(strumentoInAttesa([JSON.stringify(uso('w', 'WebFetch', { url: 'https://x.test/a' }, t))]).comando, 'https://x.test/a');
  });

  test('il programma del gruppo salta cd, export, assegnazioni e timeout', () => {
    assert.equal(programmaDi(PUSH), 'git');
    assert.equal(programmaDi('export FILO_ROUTINE=1 && FOO=1 npm run finish:check'), 'npm');
    assert.equal(programmaDi('timeout 240 tail --pid=5 -f /dev/null'), 'tail');
    assert.equal(programmaDi('/usr/bin/Git status'), 'git');
    assert.equal(programmaDi('cd /x'), '');
  });

  test('il guasto ha il gruppo davanti, dice il silenzio e lo strumento, e nessun carattere che rompa la riga di comando', () => {
    const g = testoGuasto({ fermoMs: 23 * MIN, attesa: { nome: 'Bash', comando: `${PUSH} "$HOME" \`x\`` }, tracceViste: true });
    assert.match(g, /^guasto: permessi git: permesso in attesa: il worker non dà segni di vita da 23 minuti/);
    assert.match(g, /git push --dry-run/);
    assert.doesNotMatch(g, /["`$\\]/);
    assert.ok(!g.includes(B), 'un codice lungo si accorcia');
    assert.match(testoGuasto({ fermoMs: 21 * MIN, attesa: { nome: 'WebFetch', comando: 'https://x.test' } }), /^guasto: permessi webfetch: /);
    assert.match(testoGuasto({ fermoMs: 21 * MIN, attesa: null, tracceViste: false }), /^guasto: strumento worker: worker fermo da 21 minuti .*transcript non visibile/);
  });
});

describe('la veglia', () => {
  const s = (extra = {}) => ({ mio: true, finito: false, tempi: [], processi: 0, tracce: { viste: true, attesa: null }, ...extra });
  const orologio = () => { let t = ADESSO; return { adesso: () => t, dorme: async (ms) => { t += ms; } }; };

  test('un worker che lavora: torna a fine fetta con 5, senza rilasciare niente', async () => {
    const o = orologio();
    let rilasci = 0;
    let letture = 0;
    const e = await veglia({ ...o, fetta: 90_000, passo: 10_000, leggi: () => { letture += 1; return s({ tempi: [o.adesso() - 2 * MIN] }); }, rilascia: () => { rilasci += 1; } });
    assert.equal(e.uscita, USCITA_LAVORA);
    assert.match(e.testo, /Rilancia lo stesso comando/);
    assert.equal(rilasci, 0);
    assert.ok(letture >= 8, 'guarda più volte dentro la fetta');
  });

  test('un worker che rilascia mentre vegli: 0 al primo sguardo dopo', async () => {
    const o = orologio();
    let n = 0;
    const e = await veglia({ ...o, leggi: () => s({ finito: (n += 1) > 2, tempi: [o.adesso()] }), rilascia: () => assert.fail('non si rilascia') });
    assert.deepEqual(e, { uscita: USCITA_FINITO, testo: TESTO_FINITO });
  });

  test('un worker fermo: rilascio col guasto, 3, e a chi guida solo la riga fissa', async () => {
    const o = orologio();
    const visti = [];
    const attesa = { nome: 'Bash', comando: PUSH, ms: ADESSO - 25 * MIN };
    const e = await veglia({ ...o, leggi: () => s({ tempi: [ADESSO - 25 * MIN], tracce: { viste: true, attesa } }), rilascia: (g, mio) => { visti.push({ g, mio }); return { ok: true }; } });
    assert.equal(e.uscita, USCITA_FERMO);
    assert.equal(visti.length, 1);
    assert.equal(visti[0].mio, true);
    assert.match(visti[0].g, /^guasto: permessi git: permesso in attesa/);
    assert.match(e.testo, /^Worker fermo da 25 minuti senza segni di vita: biglietto rilasciato con un guasto dichiarato\. Chiudi il giro/);
    assert.doesNotMatch(e.testo, /git|push|dry-run/, 'il comando del worker non arriva a chi guida');
    const ko = await veglia({ ...o, leggi: () => s({ tempi: [ADESSO - 25 * MIN] }), rilascia: () => ({ ok: false, motivo: 'dead_ticket' }) });
    assert.match(ko.testo, /rilascio non riuscito \(dead_ticket\): battito spento, il biglietto scade da solo/);
    assert.equal(ko.uscita, USCITA_FERMO);
  });
});

/** Un clone di worker sul suo ramo, col biglietto preso `prima` minuti fa e l'ultimo commit di allora. */
function clone({ prima = 40, morto = false } = {}) {
  const base = cartella('filo-veglia-');
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(resolve(work, '.claude'), { recursive: true });
  const g = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim();
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  g(work, ['init', '-q', '--initial-branch=main']);
  g(work, ['remote', 'add', 'origin', origin]);
  writeFileSync(resolve(work, '.gitignore'), '.claude/\n');
  writeFileSync(resolve(work, 'a.txt'), 'a\n');
  g(work, ['add', '-A']);
  const allora = new Date(Date.now() - prima * MIN).toISOString();
  g(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'a'], { GIT_COMMITTER_DATE: allora, GIT_AUTHOR_DATE: allora });
  g(work, ['push', '-q', 'origin', 'main']);
  g(work, ['checkout', '-q', '-b', 'worker/x-1797']);
  const marcatore = { ticket: B, since: allora, ...(morto ? { morto: { ora: new Date().toISOString(), perche: 'rilasciato' } } : {}) };
  writeFileSync(resolve(work, '.claude', 'routine-ticket.json'), JSON.stringify(marcatore));
  return { base, work };
}

/** La cartella di Claude con i transcript dei sotto-agenti della sessione, scritti `fa` minuti fa. */
function claude({ fa = 30, comando = PUSH, registroFa = null } = {}) {
  const dir = cartella('filo-veglia-claude-');
  const sub = join(dir, 'projects', '-home-user-Filo', SID, 'subagents');
  mkdirSync(sub, { recursive: true });
  const ora = Date.now() - fa * MIN;
  const f = join(sub, 'agent-w1.jsonl');
  writeFileSync(f, righe(uso('t1', 'Bash', { command: 'npm run test:unit' }, ora - MIN), risposta('t1', ora - MIN + 500), uso('t2', 'Bash', { command: comando }, ora)));
  utimesSync(f, new Date(ora), new Date(ora));
  if (registroFa !== null) {
    writeFileSync(join(dir, FILE_REGISTRO), JSON.stringify({ voci: [{ impronta: impronta(B), ruolo: 'new-work', ora: new Date(Date.now() - registroFa * MIN).toISOString() }] }));
  }
  return dir;
}

describe('i segni di vita, letti dove stanno', () => {
  test('transcript fermo da trenta minuti e commit di quaranta: fermo, con lo strumento in attesa', () => {
    const { work } = clone();
    const configDir = claude({ fa: 30 });
    assert.equal(cartellaSottoAgenti({ sessione: SID, configDir }), join(configDir, 'projects', '-home-user-Filo', SID, 'subagents'));
    const v = segniDiVita({ root: work, ticket: B, sessione: SID, configDir });
    assert.equal(v.mio, true);
    assert.equal(v.finito, false);
    assert.equal(v.tracce.viste, true);
    assert.equal(v.tracce.attesa.comando, PUSH);
    const g = giudica({ ...v, adesso: Date.now() });
    assert.equal(g.stato, 'fermo');
    assert.ok(g.fermoMs >= 29 * MIN && g.fermoMs < 31 * MIN, `fermo da ${g.fermoMs}`);
  });

  test('un transcript che si muove tiene vivo il worker anche senza commit da un\'ora', () => {
    const { work } = clone({ prima: 60 });
    const v = segniDiVita({ root: work, ticket: B, sessione: SID, configDir: claude({ fa: 1 }) });
    assert.equal(giudica({ ...v, adesso: Date.now() }).stato, 'lavora');
  });

  test('il biglietto segnato finito nella cartella: finito', () => {
    const { work } = clone({ morto: true });
    assert.equal(segniDiVita({ root: work, ticket: B, sessione: SID, configDir: claude() }).finito, true);
  });

  test('transcript di un giro prima del biglietto non contano; un processo nella cartella tiene vivo il worker', () => {
    const { work } = clone({ prima: 30 });
    const finti = (cwd) => () => [{ pid: 999001, ppid: 1, sid: 999001, stato: 'S', cwd, cmd: 'npm run finish:check' }];
    const vecchio = claude({ fa: 120 });
    const senza = segniDiVita({ root: work, ticket: B, sessione: SID, configDir: vecchio, leggiProcessi: finti('/altrove') });
    assert.equal(senza.tracce.viste, false, 'il transcript di due ore fa è di un altro worker');
    assert.equal(giudica({ ...senza, adesso: Date.now() }).stato, 'fermo');
    // Chi aspetta una verifica lunga in sottofondo non scrive il transcript finché quella non esce: non è fermo.
    const fermo = claude({ fa: 25 });
    const con = segniDiVita({ root: work, ticket: B, sessione: SID, configDir: fermo, leggiProcessi: finti(work) });
    assert.equal(con.tracce.viste, true);
    assert.equal(con.processi, 1);
    assert.equal(giudica({ ...con, adesso: Date.now() }).stato, 'lavora');
    const battito = () => [{ pid: 999002, ppid: 1, sid: 999002, stato: 'S', cwd: work, cmd: 'node /tmp/s/scripts/routine-channel.mjs heartbeat --loop' }];
    assert.equal(segniDiVita({ root: work, ticket: B, sessione: SID, configDir: fermo, leggiProcessi: battito }).processi, 0, 'il battito non è lavoro');
  });

  test('un worker che non ha ancora preso la cartella si giudica dal registro del biglietto e dai transcript', () => {
    const vuota = cartella('filo-veglia-sessione-');
    const configDir = claude({ fa: 25, registroFa: 27 });
    const v = segniDiVita({ root: vuota, ticket: B, sessione: SID, configDir });
    assert.equal(v.mio, false);
    assert.equal(v.tracce.viste, true);
    assert.equal(giudica({ ...v, adesso: Date.now() }).stato, 'fermo');
    assert.equal(tracceSottoAgenti({ dir: '' }).viste, false);
  });
});

function fintoServer() {
  const ricevute = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let json = {}; try { json = JSON.parse(body); } catch (_) {}
      ricevute.push({ url: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, ricevute })));
}

function cli(args, env) {
  return new Promise((done) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...args], { env: { ...senzaSessione(process.env), ...env } },
      (err, so, se) => done({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

describe('veglia da riga di comando', () => {
  test('il caso di #1776: worker fermo su un push a mano → biglietto rilasciato col guasto «permesso in attesa», exit 3', async () => {
    const { srv, port, ricevute } = await fintoServer();
    const { work } = clone();
    try {
      const r = await cli(['veglia', B], {
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_NO_BEAT: '1',
        CLAUDE_CONFIG_DIR: claude({ fa: 30 }), CLAUDE_CODE_SESSION_ID: SID,
      });
      assert.equal(r.code, USCITA_FERMO, `stdout: ${r.so}\nstderr: ${r.se}`);
      assert.match(r.so, /^Worker fermo da 30 minuti senza segni di vita: biglietto rilasciato con un guasto dichiarato\./);
      assert.doesNotMatch(`${r.so}${r.se}`, /git push|dry-run/, 'la stampa per chi guida non porta il comando del worker');
      const rilascio = ricevute.find((x) => x.url.includes('routineRelease'));
      assert.ok(rilascio, 'il server ha ricevuto il rilascio');
      assert.equal(rilascio.body.ticket, B);
      assert.match(rilascio.body.fault, /^guasto: permessi git: permesso in attesa: il worker non dà segni di vita da 30 minuti/);
      assert.match(rilascio.body.fault, /git push --dry-run --force-with-lease/);
      const marcatore = JSON.parse(readFileSync(resolve(work, '.claude', 'routine-ticket.json'), 'utf8'));
      assert.ok(marcatore.morto, 'il biglietto è segnato finito nella cartella');
    } finally { srv.close(); }
  });

  test('un worker che lavora: exit 5 a fine fetta, e il server non sente niente', async () => {
    const { srv, port, ricevute } = await fintoServer();
    const { work } = clone();
    try {
      const r = await cli(['veglia', B], {
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: work, FILO_NO_BEAT: '1', FILO_VEGLIA_FETTA_MS: '0',
        CLAUDE_CONFIG_DIR: claude({ fa: 1 }), CLAUDE_CODE_SESSION_ID: SID,
      });
      assert.equal(r.code, USCITA_LAVORA, r.se);
      assert.match(r.so, /^Worker al lavoro \(ultimo segno di vita 1 minuti fa, fermo dopo 20\)\. Rilancia lo stesso comando\./);
      assert.equal(ricevute.length, 0);
    } finally { srv.close(); }
  });

  test('un worker che ha rilasciato: exit 0', async () => {
    const { work } = clone({ morto: true });
    const r = await cli(['veglia', B], { FILO_ROUTINE_API: 'http://127.0.0.1:9', FILO_REPO_ROOT: work, FILO_NO_BEAT: '1', CLAUDE_CONFIG_DIR: claude() });
    assert.equal(r.code, USCITA_FINITO, r.se);
    assert.equal(r.so.trim(), TESTO_FINITO);
  });

  test('scritta male: exit 1 e niente fatto', async () => {
    for (const args of [['veglia'], ['veglia', 'corto'], ['veglia', B, 'altro'], ['veglia', B, '--forza']]) {
      const r = await cli(args, { FILO_ROUTINE_API: 'http://127.0.0.1:9', FILO_NO_BEAT: '1' });
      assert.equal(r.code, 1, `${args.join(' ')}: ${r.so}${r.se}`);
    }
  });
});

// Il server fa da rete dopo la veglia (#1797): il battito gli porta l'ultimo segno di lavoro e lo strumento in attesa,
// così distingue un battito vivo da un lavoro vivo. Senza misura vera non manda niente, e il server protegge come prima.
describe('la misura per il battito', () => {
  test('il worker fermo sul push: ultimo segno di lavoro di trenta minuti fa e il comando in attesa', () => {
    const { work } = clone();
    const m = attivitaPerBattito(segniDiVita({ root: work, ticket: B, sessione: SID, configDir: claude({ fa: 30 }) }));
    assert.ok(Date.now() - m.attivitaMs >= 29 * MIN && Date.now() - m.attivitaMs < 31 * MIN, `ultimo segno ${m.attivitaMs}`);
    assert.match(m.inAttesa, /^Bash «.*git push --dry-run --force-with-lease/);
    assert.ok(m.inAttesa.length <= 300);
    assert.doesNotMatch(m.inAttesa, /["`$]/, 'testo di worker ripulito come nel guasto');
  });

  test('un processo nella cartella vale adesso; un biglietto altrui, finito o senza transcript non manda niente', () => {
    const viste = { viste: true, ultimoMs: ADESSO - 30 * MIN, attesa: null };
    assert.deepEqual(attivitaPerBattito({ mio: true, processi: 1, tempi: [ADESSO - 90 * MIN], tracce: viste }, ADESSO), { attivitaMs: ADESSO });
    assert.deepEqual(attivitaPerBattito({ mio: true, tempi: [ADESSO - 90 * MIN, ADESSO - 30 * MIN], tracce: viste }, ADESSO), { attivitaMs: ADESSO - 30 * MIN });
    assert.deepEqual(attivitaPerBattito({ mio: false, tempi: [ADESSO], tracce: viste }, ADESSO), {});
    assert.deepEqual(attivitaPerBattito({ mio: true, finito: true, tempi: [ADESSO], tracce: viste }, ADESSO), {});
    assert.deepEqual(attivitaPerBattito({ mio: true, tempi: [ADESSO - 90 * MIN], tracce: { viste: false } }, ADESSO), {},
      'senza transcript, un worker che aspetta in silenzio sembrerebbe fermo');
    assert.deepEqual(attivitaPerBattito(null, ADESSO), {});
  });

  test('il battito porta la misura al server, e una misura che non si legge non lo ferma', async () => {
    const canale = await import('../../scripts/routine-channel.mjs');
    const corpi = [];
    const fetchImpl = async (url, init) => {
      corpi.push(JSON.parse(init.body));
      return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true, expiresAt: new Date(ADESSO + 60 * MIN).toISOString() }) };
    };
    const base = { fetchImpl, sleep: async () => {}, misureCrediti: () => ({}) };
    const r = await canale.heartbeat(B, { ...base, attivitaDi: () => ({ attivitaMs: ADESSO - 41 * MIN, inAttesa: 'Bash «git push»' }) });
    assert.equal(r.ok, true);
    assert.equal(corpi[0].attivitaMs, ADESSO - 41 * MIN);
    assert.equal(corpi[0].inAttesa, 'Bash «git push»');
    const r2 = await canale.heartbeat(B, { ...base, attivitaDi: () => { throw new Error('transcript illeggibile'); } });
    assert.equal(r2.ok, true);
    assert.equal(corpi[1].attivitaMs, undefined);
  });
});
