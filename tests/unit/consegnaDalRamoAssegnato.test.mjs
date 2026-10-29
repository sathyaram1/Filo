// Le consegne mandate direttamente dal canale partono solo dal ramo assegnato (#772, ROUTINE-BRANCH-INTEGRITY.md § C).
// Rosso senza la modifica: dalla cartella sul ramo sbagliato la consegna arriva al server, col ramo dichiarato.
// La guardia vive in lib/branch-integrity (guardiaConsegna); qui la strada intera della riga di comando.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const {
  writeBranchState, withCheckpoint, writeExpectation, readBranchState, ensureSessionExcludes,
  IDENTITY_REJECT_LIMIT, escalationNote, guardiaConsegna, checkDelivery,
} = await import('../../scripts/lib/branch-integrity.mjs');
const { testoConsegnaFuoriRamo } = await import('../../scripts/routine-channel.mjs');

const CANALE = fileURLToPath(new URL('../../scripts/routine-channel.mjs', import.meta.url));
const ASSEGNATO = 'worker/772-20261015T035107Z';
const ID = 'fid-772';
const REPORT = 'Corretto il salvataggio col titolo vuoto: ora salva anche senza titolo.';

// Le quattro consegne che valgono per un commit; le altre non guardano il ramo.
const CONSEGNE = {
  revisione: ['status', '--status', 'revision_capability', '--notes', REPORT, '--frase', 'ora va'],
  correzione: ['fixed', '--report', REPORT],
  critica: ['verdict', '--critique', REPORT],
  sicurezza: ['secaudit', '--verdict', 'pass'],
};

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo dicono gli assert */ }
      ricevuti.push({ url: String(req.url || ''), body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, id: ID, num: '#772' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/** Un origin finto, un clone posizionato come fa dispatch: ramo assegnato, stato col punto fermo, identità attesa. */
function deposito({ attesa = true } = {}) {
  const base = cartellaTemporanea('filo-772-');
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  const g = (args, cwd = work) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(['init', '--bare', '-q', '--initial-branch=main'], origin);
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['remote', 'add', 'origin', origin]);
  writeFileSync(resolve(work, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']); g(['commit', '-qm', 'base']);
  g(['push', '-q', 'origin', 'main']);
  g(['checkout', '-q', '-b', ASSEGNATO]);
  ensureSessionExcludes(work);
  if (attesa) {
    writeBranchState(work, withCheckpoint({ id: ID, branch: ASSEGNATO }, g(['rev-parse', 'HEAD']), 'new-work:checkout'));
    writeExpectation(work, { branch: ASSEGNATO, id: ID });
  }
  const committa = (nome, testo) => { writeFileSync(resolve(work, nome), testo, 'utf8'); g(['add', '-A']); g(['commit', '-qm', nome]); };
  return { base, work, g, committa };
}

function lanciatore(work, port, cwd = work) {
  const env = {
    ...process.env, FILO_REPO_ROOT: work, FILO_TOOLS_ROOT: work, FILO_NO_BEAT: '1',
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  };
  delete env.FILO_DISPATCH_STATE_DIR;
  return (args) => new Promise((r) => execFile(process.execPath, [CANALE, 'deliver', 'biglietto-finto', ...args], { env, cwd },
    (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') })));
}

const consegne = (ricevuti) => ricevuti.filter((x) => x.url.includes('routineDeliver'));
const rifiuti = (work) => readBranchState(work, ID)?.identityRejects;
const azzera = (work) => { const s = readBranchState(work, ID); delete s.identityRejects; writeBranchState(work, s); };

test('dalla cartella su un altro ramo nessuna delle quattro consegne parte, e il rifiuto dice dove è e dove tornare', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g, committa } = deposito();
  try {
    // Il caso dell'incidente: il lavoro committato su un ramo nato da sé, non su quello assegnato.
    g(['checkout', '-q', '-b', 'claude/altro']);
    committa('lavoro.txt', 'fatto\n');
    const lancia = lanciatore(work, port);
    for (const [nome, args] of Object.entries(CONSEGNE)) {
      azzera(work);
      const r = await lancia(args);
      assert.notEqual(r.code, 0, `${nome}: doveva fermarsi (stdout: ${r.so})`);
      assert.match(r.se, /sul ramo "claude\/altro"/, `${nome}: dice dov'è la cartella`);
      assert.match(r.se, new RegExp(`il ramo assegnato a questo lavoro è "${ASSEGNATO}"`), `${nome}: e qual è il ramo assegnato`);
      assert.match(r.se, new RegExp(`git checkout ${ASSEGNATO}`), `${nome}: e come tornarci`);
      assert.match(r.se, /Niente è stato consegnato/);
    }
    assert.equal(ricevuti.length, 0, 'al server non parte niente');

    // Lo stesso con un --branch che conferma il ramo assegnato: conta la cartella, non la parola.
    azzera(work);
    const dichiarato = await lancia([...CONSEGNE.revisione, '--branch', ASSEGNATO]);
    assert.notEqual(dichiarato.code, 0);
    assert.equal(ricevuti.length, 0);
  } finally { srv.close(); togliCartella(base); }
});

test('sul ramo giusto la consegna parte e porta il ramo della cartella; un --branch diverso si ferma prima del server', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, committa } = deposito();
  try {
    committa('lavoro.txt', 'fatto\n');
    const lancia = lanciatore(work, port);
    const altro = await lancia([...CONSEGNE.correzione, '--branch', 'worker/un-altro']);
    assert.equal(altro.code, 1, altro.se);
    assert.match(altro.se, /hai dichiarato il ramo "worker\/un-altro", ma la cartella è sul ramo/);
    assert.match(altro.se, /togli --branch/);
    assert.equal(ricevuti.length, 0, 'un ramo dichiarato diverso non arriva al server');
    assert.equal(rifiuti(work), undefined, 'una parola sbagliata non è una deriva della cartella');

    for (const [nome, args] of Object.entries(CONSEGNE)) {
      const r = await lancia(args);
      assert.equal(r.code, 0, `${nome}: ${r.se}`);
      assert.equal(consegne(ricevuti).at(-1).body.data.branch, ASSEGNATO, `${nome}: al server va il ramo vero della cartella`);
    }
    // Confermare con la forma piena di git è lo stesso ramo.
    const pieno = await lancia([...CONSEGNE.critica, '--branch', `refs/heads/${ASSEGNATO}`]);
    assert.equal(pieno.code, 0, pieno.se);
    assert.equal(consegne(ricevuti).at(-1).body.data.branch, ASSEGNATO);
  } finally { srv.close(); togliCartella(base); }
});

test('dalla linea principale o da una cartella staccata si rifiuta, anche senza identità attesa', async () => {
  for (const attesa of [true, false]) {
    const { srv, ricevuti, port } = await fintoServer();
    const { base, work, g, committa } = deposito({ attesa });
    try {
      committa('lavoro.txt', 'fatto\n');
      const lancia = lanciatore(work, port);
      g(['checkout', '-q', 'main']);
      const principale = await lancia(CONSEGNE.revisione);
      assert.equal(principale.code, 1, `attesa=${attesa}: ${principale.se}`);
      assert.match(principale.se, /sul ramo "main", la linea principale/);
      g(['checkout', '-q', '--detach', ASSEGNATO]);
      const staccata = await lancia(CONSEGNE.sicurezza);
      assert.equal(staccata.code, 1, `attesa=${attesa}: ${staccata.se}`);
      assert.match(staccata.se, /staccata, su nessun ramo/);
      assert.equal(ricevuti.length, 0, `attesa=${attesa}: al server non parte niente`);

      // Le consegne che non dipendono dal codice restano fuori: la chiusura parte anche da qui.
      const chiusura = await lancia(['status', '--status', 'done', '--notes', REPORT]);
      assert.equal(chiusura.code, 0, chiusura.se);
      assert.equal(consegne(ricevuti).length, 1);
    } finally { srv.close(); togliCartella(base); }
  }
});

test('da un worktree dello stesso deposito non si consegna: ramo e commit lì non sono quelli della cartella posizionata', async () => {
  for (const attesa of [true, false]) {
    const { srv, ricevuti, port } = await fintoServer();
    const { base, work, g } = deposito({ attesa });
    try {
      // La cartella posizionata resta pulita sul ramo assegnato; il lavoro nasce in un worktree su un ramo suo.
      writeFileSync(resolve(work, '.git', 'info', 'exclude'), '.claude/worktrees/\n', { flag: 'a' });
      const wt = resolve(work, '.claude', 'worktrees', 'altro');
      g(['worktree', 'add', '-q', wt, '-b', 'claude/altro']);
      writeFileSync(resolve(wt, 'lavoro.txt'), 'fatto\n', 'utf8');
      g(['add', '-A'], wt); g(['commit', '-qm', 'lavoro'], wt);
      const lancia = lanciatore(work, port, wt);
      for (const [nome, args] of Object.entries(CONSEGNE)) {
        if (attesa) azzera(work);
        const r = await lancia(args);
        assert.equal(r.code, 1, `attesa=${attesa} ${nome}: ${r.se}`);
        assert.match(r.se, /la consegna parte dalla cartella ".*altro" \(ramo "claude\/altro"\)/, `${nome}: dice da dove parte`);
        assert.match(r.se, /si consegna dalla cartella in cui è stato posizionato/, `${nome}: e qual è la cartella del lavoro`);
        assert.match(r.se, /cherry-pick/, `${nome}: e come portarci il lavoro`);
      }
      assert.equal(ricevuti.length, 0, `attesa=${attesa}: al server non parte niente`);
      // Lo stesso controllo vale per le registrazioni di dispatch, che passano da checkDelivery.
      assert.equal(checkDelivery(work, ASSEGNATO, { da: wt }).ok, false);
      // Dalla cartella posizionata il rifiuto è l'altro: il lavoro sta nel worktree (#772.1), se si sa quando è iniziato.
      assert.equal(Boolean(checkDelivery(work, ASSEGNATO, { da: work }).altrove), attesa);
      // Da una sottocartella della cartella posizionata si consegna.
      g(['worktree', 'remove', '--force', wt]);
      const sotto = resolve(work, 'sotto'); mkdirSync(sotto);
      const r = await lanciatore(work, port, sotto)(CONSEGNE.critica);
      assert.equal(r.code, 0, r.se);
    } finally { srv.close(); togliCartella(base); }
  }
});

// #772.1: la shell dei sotto-agenti torna da sola alla cartella principale, quindi chi ha lavorato in un worktree
// consegna proprio da lì (o da fuori del deposito). Il controllo guarda dove sta il lavoro, non da dove parte il comando.
test('lavoro committato in un worktree, consegna dalla cartella posizionata o da fuori: si ferma e dice come portarlo qui', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g } = deposito();
  try {
    writeFileSync(resolve(work, '.git', 'info', 'exclude'), '.claude/worktrees/\n', { flag: 'a' });
    // Un worktree di prima dell'inizio del lavoro, coi suoi commit vecchi: non è questo lavoro e non ferma niente.
    const vecchio = resolve(work, '.claude', 'worktrees', 'vecchio');
    g(['worktree', 'add', '-q', vecchio, '-b', 'claude/vecchio']);
    writeFileSync(resolve(vecchio, 'vecchio.txt'), 'prima\n', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: vecchio });
    execFileSync('git', ['commit', '-qm', 'vecchio'], { cwd: vecchio, env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' } });
    // Il lavoro di adesso, in un worktree su un ramo suo; la cartella posizionata resta pulita sul ramo assegnato.
    const wt = resolve(work, '.claude', 'worktrees', 'altro');
    g(['worktree', 'add', '-q', wt, '-b', 'claude/altro']);
    writeFileSync(resolve(wt, 'lavoro.txt'), 'fatto\n', 'utf8');
    g(['add', '-A'], wt); g(['commit', '-qm', 'lavoro'], wt);
    writeFileSync(resolve(wt, 'altro.txt'), 'ancora\n', 'utf8');
    g(['add', '-A'], wt); g(['commit', '-qm', 'lavoro 2'], wt);
    const [primo, secondo] = g(['rev-list', '--reverse', 'HEAD~2..HEAD'], wt).split('\n');
    for (const da of [work, base]) {
      azzera(work);
      const r = await lanciatore(work, port, da)(CONSEGNE.revisione);
      assert.equal(r.code, 1, `da ${da}: doveva fermarsi (${r.so})`);
      assert.match(r.se, /la cartella ".*altro" \(ramo "claude\/altro"\) ha 2 commit fatti dopo l'inizio di questo lavoro/);
      assert.match(r.se, new RegExp(`che il ramo assegnato "${ASSEGNATO}" non contiene`));
      assert.ok(r.se.includes(`cherry-pick ${primo.slice(0, 12)} ${secondo.slice(0, 12)}`), `il comando coi commit in ordine: ${r.se}`);
      assert.match(r.se, /git worktree remove ".*altro"/, 'e la strada se quei commit non sono di questo lavoro');
      assert.doesNotMatch(r.se, /vecchio/, 'il worktree di prima non conta');
    }
    assert.equal(ricevuti.length, 0, 'al server non parte niente');
    // Le registrazioni di dispatch passano dalla stessa regola, col loro contatore.
    azzera(work);
    assert.match(checkDelivery(work, ASSEGNATO).reason, /non contiene 2 commit fatti dopo l'inizio di questo lavoro/);
    // Uno solo portato qui non basta; tutti e due sì, e la consegna parte col ramo assegnato.
    g(['cherry-pick', primo]);
    azzera(work);
    const mezzo = await lanciatore(work, port)(CONSEGNE.correzione);
    assert.equal(mezzo.code, 1, mezzo.so);
    assert.match(mezzo.se, /ha un commit fatto dopo l'inizio/);
    g(['cherry-pick', secondo]);
    azzera(work);
    const ok = await lanciatore(work, port)(CONSEGNE.correzione);
    assert.equal(ok.code, 0, ok.se);
    assert.equal(consegne(ricevuti).at(-1).body.data.branch, ASSEGNATO);
  } finally { srv.close(); togliCartella(base); }
});

test('la correzione registrata da dispatch col lavoro in un worktree: non registrata, col rimedio e senza «fermati»', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g } = deposito();
  try {
    writeFileSync(resolve(work, '.git', 'info', 'exclude'), '.claude/worktrees/\n', { flag: 'a' });
    const wt = resolve(work, '.claude', 'worktrees', 'altro');
    g(['worktree', 'add', '-q', wt, '-b', 'claude/altro']);
    writeFileSync(resolve(wt, 'lavoro.txt'), 'fatto\n', 'utf8');
    g(['add', '-A'], wt); g(['commit', '-qm', 'lavoro'], wt);
    const env = {
      ...process.env, FILO_REPO_ROOT: work, FILO_TOOLS_ROOT: work, FILO_NO_BEAT: '1',
      FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_ROUTINE_TICKET: 'biglietto-finto',
    };
    delete env.FILO_DISPATCH_STATE_DIR;
    const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
    const r = await new Promise((ok) => execFile(process.execPath, [DISPATCH, '--record-fixed', ID, `${REPORT} Il resto del ramo resta com'era, senza altre modifiche.`, '--motivo', 'ripresa'], { env, cwd: work },
      (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, se: String(se || '') })));
    assert.equal(r.code, 1, r.se);
    assert.match(r.se, /NON REGISTRATO: .*non contiene un commit fatto dopo l'inizio di questo lavoro/);
    assert.match(r.se, /cherry-pick/);
    assert.doesNotMatch(r.se, /fermati/);
    assert.equal(consegne(ricevuti).length, 0);
  } finally { srv.close(); togliCartella(base); }
});

test('commit in un worktree che non sono di questo lavoro: tolta quella cartella, la consegna parte', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g, committa } = deposito();
  try {
    writeFileSync(resolve(work, '.git', 'info', 'exclude'), '.claude/worktrees/\n', { flag: 'a' });
    committa('lavoro.txt', 'fatto\n');
    const wt = resolve(work, '.claude', 'worktrees', 'prova');
    g(['worktree', 'add', '-q', wt, '-b', 'claude/prova', 'main']);
    writeFileSync(resolve(wt, 'prova.txt'), 'una prova\n', 'utf8');
    g(['add', '-A'], wt); g(['commit', '-qm', 'prova'], wt);
    const ferma = await lanciatore(work, port)(CONSEGNE.critica);
    assert.equal(ferma.code, 1, ferma.so);
    g(['worktree', 'remove', '--force', wt]);
    azzera(work);
    const r = await lanciatore(work, port)(CONSEGNE.critica);
    assert.equal(r.code, 0, r.se);
    assert.equal(consegne(ricevuti).length, 1);
  } finally { srv.close(); togliCartella(base); }
});

test('senza identità attesa, da un ramo di lavoro la consegna parte col ramo vero: il confronto col biglietto lo fa il server', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, committa } = deposito({ attesa: false });
  try {
    committa('lavoro.txt', 'fatto\n');
    const r = await lanciatore(work, port)([...CONSEGNE.revisione, '--branch', ASSEGNATO]);
    assert.equal(r.code, 0, r.se);
    assert.equal(consegne(ricevuti)[0].body.data.branch, ASSEGNATO);
  } finally { srv.close(); togliCartella(base); }
});

test('durante il rebase del ramo assegnato: «finiscilo e rilancia», senza contare verso la sospensione', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g, committa } = deposito();
  try {
    committa('c.txt', 'dal ramo\n');
    g(['checkout', '-q', 'main']);
    committa('c.txt', 'da main\n');
    g(['checkout', '-q', ASSEGNATO]);
    try {
      execFileSync('git', ['rebase', 'main'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_EDITOR: 'true' } });
      assert.fail('premessa: il rebase doveva fermarsi sul conflitto');
    } catch (e) { if (e.code === 'ERR_ASSERTION') throw e; }
    const lancia = lanciatore(work, port);
    for (let i = 0; i < IDENTITY_REJECT_LIMIT + 1; i++) {
      const r = await lancia(CONSEGNE.correzione);
      assert.equal(r.code, 1, r.se);
      assert.match(r.se, new RegExp(`rebase in corso del ramo "${ASSEGNATO}"`));
      assert.match(r.se, /git rebase --continue/);
      assert.match(r.se, /rilancia lo stesso comando/);
      assert.doesNotMatch(r.se, /Rifiuto|sospesa/);
    }
    assert.equal(ricevuti.length, 0, 'né la consegna né una sospensione');
    assert.equal(rifiuti(work), undefined);
  } finally { srv.close(); togliCartella(base); }
});

test('il contatore è quello delle registrazioni: alla soglia parte solo la sospensione, e una consegna accettata lo azzera', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g, committa } = deposito();
  try {
    committa('lavoro.txt', 'fatto\n');
    const lancia = lanciatore(work, port);
    g(['checkout', '-q', '-b', 'claude/altro']);
    for (let i = 1; i < IDENTITY_REJECT_LIMIT; i++) {
      const r = await lancia(CONSEGNE.revisione);
      assert.match(r.se, new RegExp(`Rifiuto ${i} di ${IDENTITY_REJECT_LIMIT}`));
      assert.equal(rifiuti(work), i);
    }
    // Tornati sul ramo, la consegna accettata consuma i rifiuti: non erano di fila.
    g(['checkout', '-q', ASSEGNATO]);
    assert.equal((await lancia(CONSEGNE.critica)).code, 0);
    assert.equal(rifiuti(work), undefined);

    g(['checkout', '-q', 'claude/altro']);
    for (let i = 1; i < IDENTITY_REJECT_LIMIT; i++) await lancia(CONSEGNE.revisione);
    const prima = consegne(ricevuti).length;
    const soglia = await lancia(CONSEGNE.revisione);
    assert.equal(soglia.code, 1, soglia.se);
    assert.match(soglia.se, /sospesa e passa all'owner/);
    assert.match(soglia.se, /rilascia il biglietto/);
    const nuove = consegne(ricevuti).slice(prima);
    assert.equal(nuove.length, 1, 'alla soglia parte la sospensione, non la consegna');
    assert.equal(nuove[0].body.intent, 'status');
    assert.deepEqual(nuove[0].body.data, { status: 'design', reason: 'loop', notes: escalationNote() });
    assert.equal(readBranchState(work, ID), null, 'come per dispatch, lo stato del lavoro sospeso si azzera');
  } finally { srv.close(); togliCartella(base); }
});

test('il testo del rifiuto: con l\'assegnato dice il comando giusto, senza non ne inventa uno', () => {
  const con = testoConsegnaFuoriRamo('consegna non registrata', { motivo: 'deriva', current: 'claude/x', assigned: 'worker/y', count: 1 });
  assert.match(con, /la cartella è sul ramo "claude\/x", ma il ramo assegnato a questo lavoro è "worker\/y"/);
  assert.match(con, /`git checkout worker\/y`/);
  assert.match(con, /portalo lì/);
  const senza = testoConsegnaFuoriRamo('consegna non registrata', { motivo: 'principale', current: 'main', assigned: '' });
  assert.match(senza, /<il ramo del tuo lavoro>/);
  assert.doesNotMatch(senza, /Rifiuto/);
  // Il rebase di un ALTRO ramo è una deriva: prima si chiude quello, poi si torna.
  const altro = testoConsegnaFuoriRamo('consegna non registrata', { motivo: 'staccata', current: '', assigned: 'worker/y', rebaseDi: 'worker/altro', count: 2 });
  assert.match(altro, /a metà del rebase di "worker\/altro", ma il ramo assegnato/);
  assert.match(altro, /Chiudi quel rebase .* `git checkout worker\/y`/);
  assert.match(altro, /Rifiuto 2 di 3/);
});

test('guardiaConsegna non tocca il contatore quando non conosce il lavoro', () => {
  const { base, work } = deposito({ attesa: false });
  try {
    assert.deepEqual(guardiaConsegna(work), { ok: true, branch: ASSEGNATO, id: '', assigned: '' });
  } finally { togliCartella(base); }
});
