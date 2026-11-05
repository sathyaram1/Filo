// Un lavoro nuovo ripartito con un biglietto nuovo dopo un tentativo morto prima di consegnare nasce dalla punta di
// quel tentativo, non da main, e il ramo superato diventa antenato del nuovo, così la fusione lo chiude (#2152).
// Repo usa-e-getta con un origin nudo; il giro vero di dispatch parla con un server finto.
import '../helpers/senzaSessione.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { aspettaChe } from '../helpers/attese.mjs';
import { newWorkBranch, prepareBranch, tentativiPrecedenti, stampoDelTentativo, chiudiTentativi, chiudiSuperatiOvunque } from '../../scripts/lib/branch-integrity.mjs';
import { leggiTentativo, tentativiSuperati } from '../../scripts/lib/tentativi.mjs';
import { ramiInCorso } from '../../scripts/lib/su-main.mjs';
import { conNumeri } from '../../scripts/manutentore.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'fid-2152';
const BIGLIETTO = 'biglietto-di-prova';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}
const ramo = (stampo, id = ID) => `worker/${id}-${stampo}`;

function scena(base, { ruoli = false } = {}) {
  const origin = resolve(base, 'origin.git');
  const casa = resolve(base, 'casa');
  mkdirSync(casa, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(casa, 'init', '-q', '-b', 'main');
  if (ruoli) cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
  writeFileSync(resolve(casa, '.gitignore'),
    '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\n', 'utf8');
  const main = commit(casa, 'segnaposto.txt', 'x\n');
  git(casa, 'remote', 'add', 'origin', origin);
  git(casa, 'push', '-q', '-u', 'origin', 'main');
  return { origin, casa, main };
}

/** Un tentativo spinto su origin: nasce da `da`, con `n` commit propri. */
function tentativo(casa, nome, da, n) {
  git(casa, 'checkout', '-q', '-B', nome, da);
  let head = git(casa, 'rev-parse', 'HEAD');
  for (let i = 0; i < n; i += 1) head = commit(casa, `${nome.replace(/\W/g, '_')}-${head.slice(0, 7)}.txt`, `${i}\n`);
  git(casa, 'push', '-q', '-f', 'origin', `${nome}:refs/heads/${nome}`);
  git(casa, 'checkout', '-q', 'main');
  return head;
}

describe('una regola sola sui tentativi, per dispatch e per i rami in corso', () => {
  test('il nome di un tentativo si legge in un posto solo, anche con un id che ha un trattino', () => {
    assert.deepEqual(leggiTentativo('worker/abc-20261101T000000Z'), { id: 'abc', stampo: '20261101T000000Z' });
    assert.deepEqual(leggiTentativo('origin/worker/fid-2152-20261101T000000Z'), { id: 'fid-2152', stampo: '20261101T000000Z' });
    assert.equal(leggiTentativo('worker/abc'), null);
    assert.equal(leggiTentativo('discarded/worker/abc-20261101T000000Z-20261102T000000Z'), null);
    assert.deepEqual(conNumeri([{ ramo: 'worker/fid-2152-20261101T000000Z', feedback: [] }], [{ id: 'fid-2152', num: '2152' }])[0].feedback, ['2152']);
  });

  test('superato è il tentativo non fuso più vecchio dell\'ultimo fuso dello stesso feedback', () => {
    const s = tentativiSuperati([
      { ramo: 'worker/a-20261101T000000Z', fuso: false },
      { ramo: 'worker/a-20261102T000000Z', fuso: true },
      { ramo: 'worker/a-20261103T000000Z', fuso: false },
      { ramo: 'worker/b-20261101T000000Z', fuso: false },
      { ramo: 'worker/c-20261101T000000Z', fuso: false },
      { ramo: 'worker/c-20261102T000000Z', fuso: false },
    ]);
    assert.deepEqual([...s], ['worker/a-20261101T000000Z']);
  });

  test('i rami in corso del manutentore usano la stessa regola: il superato non c\'è, il vivo dopo la fusione sì', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      tentativo(casa, ramo('20261101T000000Z'), main, 1);
      const fuso = tentativo(casa, ramo('20261102T000000Z'), main, 1);
      git(casa, 'merge', '-q', '--no-ff', '--no-edit', fuso);
      git(casa, 'push', '-q', 'origin', 'main');
      git(casa, 'fetch', '-q', 'origin');
      assert.deepEqual(ramiInCorso(casa, { giorni: 0 }).map((r) => r.ramo), []);
      tentativo(casa, ramo('20261103T000000Z'), 'main', 1);
      git(casa, 'fetch', '-q', 'origin');
      assert.deepEqual(ramiInCorso(casa, { giorni: 0 }).map((r) => r.ramo), [ramo('20261103T000000Z')]);
    } finally { togliCartella(base); }
  });
});

describe('quale tentativo precedente si riprende', () => {
  test('lo stampo riconosce solo i tentativi di quel feedback', () => {
    assert.equal(stampoDelTentativo(ramo('20261101T000000Z'), ID), '20261101T000000Z');
    assert.equal(stampoDelTentativo(ramo('20261101T000000Z', `${ID}-x`), ID), '', 'un id che comincia uguale è un altro feedback');
    assert.equal(stampoDelTentativo(`discarded/${ramo('20261101T000000Z')}-20261102T000000Z`, ID), '');
    assert.equal(stampoDelTentativo('worker/fid-2152', ID), '');
    assert.equal(stampoDelTentativo(ramo('20261101T000000Z'), ''), '');
  });

  test('niente da riprendere: nessun ramo, un tentativo già fuso, uno senza commit propri, un altro feedback', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      assert.deepEqual(tentativiPrecedenti({ root: casa, id: ID }), { ok: true, scelto: null, altri: [], superati: [] });
      const fuso = tentativo(casa, ramo('20261101T000000Z'), main, 2);
      git(casa, 'merge', '-q', '--ff-only', fuso);
      git(casa, 'push', '-q', 'origin', 'main');
      tentativo(casa, ramo('20261102T000000Z'), 'main', 0);
      tentativo(casa, ramo('20261103T000000Z', `${ID}-x`), 'main', 3);
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(r.ok, true, r.errore);
      assert.equal(r.scelto, null, 'il lavoro fuso è già su main, e quello di un altro feedback non è nostro');
    } finally { togliCartella(base); }
  });

  test('tentativi a catena: si riprende l\'ultimo, che contiene gli altri', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      const t1 = tentativo(casa, ramo('20261101T000000Z'), main, 3);
      const t2 = tentativo(casa, ramo('20261102T000000Z'), t1, 2);
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(r.scelto.ramo, ramo('20261102T000000Z'));
      assert.equal(r.scelto.head, t2);
      assert.equal(r.scelto.propri, 5, 'i commit propri si contano dalla linea principale');
      assert.deepEqual(r.altri, []);
    } finally { togliCartella(base); }
  });

  test('tentativi nati tutti da main (i rami di prima): si riprende il più recente e si nominano gli altri', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      tentativo(casa, ramo('20261101T000000Z'), main, 15);
      tentativo(casa, ramo('20261103T000000Z'), main, 2);
      tentativo(casa, ramo('20261102T000000Z'), main, 12);
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(r.scelto.ramo, ramo('20261103T000000Z'));
      assert.deepEqual(r.altri.map((t) => [t.ramo, t.propri]),
        [[ramo('20261102T000000Z'), 12], [ramo('20261101T000000Z'), 15]], 'dal più recente, coi loro commit');
    } finally { togliCartella(base); }
  });

  test('un tentativo più nuovo fermo dentro uno più vecchio che è andato avanti: vince quello che contiene l\'altro', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      const t1 = tentativo(casa, ramo('20261101T000000Z'), main, 2);
      tentativo(casa, ramo('20261102T000000Z'), t1, 0);
      const avanti = tentativo(casa, ramo('20261101T000000Z'), t1, 1);
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(r.scelto.ramo, ramo('20261101T000000Z'));
      assert.equal(r.scelto.head, avanti);
      assert.deepEqual(r.altri, []);
    } finally { togliCartella(base); }
  });

  test('ramo del biglietto mai spinto: nasce col suo nome dalla punta del tentativo precedente', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      const t1 = tentativo(casa, ramo('20261101T000000Z'), main, 2);
      const legato = ramo('20261102T000000Z');
      const { scelto } = tentativiPrecedenti({ root: casa, id: ID, escludi: legato });
      const r = prepareBranch({ root: casa, branch: legato, createIfMissing: true, base: scelto.ramo });
      assert.equal(r.ok, true, r.message);
      assert.equal(r.head, t1);
      assert.equal(r.base, `origin/${scelto.ramo}`);
    } finally { togliCartella(base); }
  });

  test('feedback riaperto: un tentativo morto prima di quello fuso è superato, uno morto dopo si riprende', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      tentativo(casa, ramo('20261101T000000Z'), main, 3);
      const fuso = tentativo(casa, ramo('20261102T000000Z'), main, 1);
      git(casa, 'merge', '-q', '--no-ff', '--no-edit', fuso);
      git(casa, 'push', '-q', 'origin', 'main');
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(r.scelto, null, 'il lavoro del primo è stato superato da quello fuso');
      assert.deepEqual(r.superati, [ramo('20261101T000000Z')]);

      tentativo(casa, ramo('20261103T000000Z'), 'main', 2);
      const dopo = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(dopo.scelto.ramo, ramo('20261103T000000Z'), 'morto dopo la riapertura: è il lavoro da riprendere');
      assert.deepEqual(dopo.altri, []);
      assert.deepEqual(dopo.superati, [ramo('20261101T000000Z')]);

      const c = chiudiTentativi({ root: casa, rami: dopo.superati });
      assert.equal(c.ok, true, c.errore);
      assert.equal(git(casa, 'ls-remote', 'origin', `refs/heads/${ramo('20261101T000000Z')}`), '', 'il ramo superato non resta su origin');
      assert.notEqual(git(casa, 'ls-remote', 'origin', `refs/heads/${ramo('20261103T000000Z')}`), '');
    } finally { togliCartella(base); }
  });

  test('un tentativo nato da main e mai scritto non è lavoro arrivato su main: quello più vecchio coi suoi commit si riprende', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      const morto = tentativo(casa, ramo('20261101T000000Z'), main, 15);
      commit(casa, 'altro.txt', 'fusione di un altro feedback\n');
      git(casa, 'push', '-q', 'origin', 'main');
      tentativo(casa, ramo('20261102T000000Z'), 'main', 0);
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.deepEqual(r.superati, [], 'il lavoro mai fuso non si toglie da origin');
      assert.equal(r.scelto && r.scelto.head, morto, 'si riparte dai 15 commit');
      git(casa, 'fetch', '-q', 'origin');
      assert.deepEqual(ramiInCorso(casa, { giorni: 0 }).map((x) => x.ramo), [ramo('20261101T000000Z')], 'il manutentore lo vede in corso');
    } finally { togliCartella(base); }
  });

  test('feedback riaperto dopo la potatura del ramo fuso: la fusione letta su main basta a dire superato il tentativo di prima', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      tentativo(casa, ramo('20261101T000000Z'), main, 3);
      const fuso = tentativo(casa, ramo('20261102T000000Z'), main, 1);
      git(casa, 'merge', '-q', '--no-ff', '-m', 'merge-gate: #2152 via server', fuso);
      git(casa, 'push', '-q', 'origin', 'main');
      git(casa, 'push', '-q', 'origin', `:refs/heads/${ramo('20261102T000000Z')}`);
      const r = tentativiPrecedenti({ root: casa, id: ID, num: '#2152' });
      assert.equal(r.scelto, null, 'il lavoro superato dalla fusione non torna come base');
      assert.deepEqual(r.superati, [ramo('20261101T000000Z')]);
      const figlio = tentativiPrecedenti({ root: casa, id: ID, num: '#21520' });
      assert.equal(figlio.scelto && figlio.scelto.ramo, ramo('20261101T000000Z'), 'la fusione di un altro numero non conta');
    } finally { togliCartella(base); }
  });

  test('i tentativi superati di ogni feedback si chiudono, anche di quelli che non ripartono più', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      const altro = 'fid-1170';
      tentativo(casa, ramo('20261012T000000Z', altro), main, 17);
      tentativo(casa, ramo('20261014T000000Z', altro), main, 15);
      const terzo = tentativo(casa, ramo('20261015T000000Z', altro), main, 21);
      const quarto = tentativo(casa, ramo('20261018T000000Z', altro), terzo, 2);
      git(casa, 'merge', '-q', '--no-ff', '--no-edit', quarto);
      git(casa, 'push', '-q', 'origin', 'main');
      const vivo = tentativo(casa, ramo('20261101T000000Z'), main, 1);
      tentativo(casa, ramo('20261102T000000Z'), 'main', 0);
      const c = chiudiSuperatiOvunque({ root: casa });
      assert.equal(c.ok, true, c.errore);
      assert.deepEqual(c.chiusi.sort(), [ramo('20261012T000000Z', altro), ramo('20261014T000000Z', altro)]);
      const restano = git(casa, 'ls-remote', 'origin', 'refs/heads/worker/*').split('\n').map((r) => r.split('\t')[1].replace('refs/heads/', '')).sort();
      assert.deepEqual(restano, [ramo('20261015T000000Z', altro), ramo('20261018T000000Z', altro), ramo('20261101T000000Z'), ramo('20261102T000000Z')].sort(),
        'i fusi li toglie la potatura; il lavoro mai fuso di un feedback senza fusioni resta');
      assert.equal(git(casa, 'rev-parse', `origin/${ramo('20261101T000000Z')}`), vivo);
    } finally { togliCartella(base); }
  });

  test('il manutentore vede in corso lo stesso tentativo che la ripresa sceglierebbe', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa, main } = scena(base);
      const t1 = tentativo(casa, ramo('20261101T000000Z'), main, 2);
      tentativo(casa, ramo('20261102T000000Z'), t1, 0);
      tentativo(casa, ramo('20261101T000000Z'), t1, 1);
      const { scelto } = tentativiPrecedenti({ root: casa, id: ID });
      git(casa, 'fetch', '-q', 'origin');
      assert.deepEqual(ramiInCorso(casa, { giorni: 0 }).map((x) => x.ramo), [scelto.ramo]);
    } finally { togliCartella(base); }
  });

  test('origin che non risponde è un «non so», non un «non ce ne sono»', () => {
    const base = cartellaTemporanea('filo-ripartenza-');
    try {
      const { casa } = scena(base);
      git(casa, 'remote', 'set-url', 'origin', resolve(base, 'non-esiste.git'));
      const r = tentativiPrecedenti({ root: casa, id: ID });
      assert.equal(r.ok, false);
      assert.ok(r.errore);
    } finally { togliCartella(base); }
  });
});

// ─── il giro vero di dispatch ────────────────────────────────────────────────

/** Il server di oggi: un biglietto nuovo non porta ramo, e la presa in carico lega il biglietto al ramo dichiarato. */
function fintoServer({ legato = '' } = {}) {
  const mondo = { legato, consegne: [] };
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('config')) return res.end(JSON.stringify({ fields: { enabled: { booleanValue: true } } }));
      if (req.url.endsWith('/routineWork')) {
        return res.end(JSON.stringify({
          ok: true, role: 'new-work', id: ID, num: '#2152', branch: mondo.legato,
          payload: { role: 'new-work', num: '#2152', feedback: { name: 'Il ramo', text: 'Il lavoro riparte da capo.', num: '#2152' } },
        }));
      }
      if (req.url.endsWith('/routineDeliver')) {
        const { intent, data = {} } = JSON.parse(corpo || '{}');
        const r = String(data.branch || '');
        if (r && !mondo.legato) mondo.legato = r;
        const rifiutata = !!r && r !== mondo.legato;
        mondo.consegne.push({ intent, status: data.status, branch: r, rifiutata });
        if (rifiutata) {
          res.statusCode = 409;
          return res.end(JSON.stringify({ ok: false, reason: 'branch_mismatch', detail: `${r} ≠ ${mondo.legato}` }));
        }
      }
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, mondo, port: srv.address().port })));
}

function giro(casa, port) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', BIGLIETTO], {
      cwd: casa,
      env: {
        ...process.env,
        FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
        FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${port}/config`,
        FILO_REPO_ROOT: casa,
        FILO_TOOLS_ROOT: casa,
        FILO_DISPATCH_STATE_DIR: resolve(casa, '..', `stato-${casa.split(/[\\/]/).pop()}`),
        FILO_ROUTINES_ENABLED: '1',
        FILO_FEEDBACK_PRIVKEY: '',
        FILO_NO_BEAT: '1',
      },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(so.slice(so.indexOf('{'), so.lastIndexOf('}') + 1)); } catch (_) { /* lo dice l'assert */ }
      risolvi({ code, json, so, se });
    });
  });
}

test('biglietto nuovo dopo un tentativo morto: si riparte dalla sua punta, e alla fusione il ramo vecchio è chiuso', async () => {
  const base = cartellaTemporanea('filo-ripartenza-');
  const { srv, mondo, port } = await fintoServer();
  try {
    const { origin, casa } = scena(base, { ruoli: true });
    const primo = await giro(casa, port);
    assert.equal(primo.json && primo.json.role, 'new-work', `il primo giro lavora (uscita ${primo.code}): ${primo.se}`);
    assert.equal(primo.json.payload.ripartenza, undefined, 'niente prima di lui: nasce da main');
    const morto = git(casa, 'rev-parse', '--abbrev-ref', 'HEAD');
    // Il salvataggio automatico spinge il lavoro, poi la sessione muore prima di consegnare.
    commit(casa, 'lavoro.js', 'metà\n');
    const fatto = commit(casa, 'rapporto.md', 'giro 1\n');
    git(casa, 'push', '-q', 'origin', `${morto}:refs/heads/${morto}`);

    // Intanto main va avanti, e il biglietto scaduto lascia il posto a uno nuovo, senza ramo nella busta.
    const altrove = resolve(base, 'altrove');
    git(base, 'clone', '-q', origin, altrove);
    commit(altrove, 'altro.txt', 'un altro lavoro fuso\n');
    git(altrove, 'push', '-q', 'origin', 'main');
    mondo.legato = '';
    await aspettaChe(() => newWorkBranch(ID) !== morto, { cosa: 'un nome per tentativo diverso dal primo' });

    const seconda = resolve(base, 'seconda');
    git(base, 'clone', '-q', origin, seconda);
    const r2 = await giro(seconda, port);
    assert.equal(r2.json && r2.json.role, 'new-work', `il giro ripartito lavora (uscita ${r2.code}): ${r2.se}`);
    const nuovo = git(seconda, 'rev-parse', '--abbrev-ref', 'HEAD');
    assert.notEqual(nuovo, morto, 'il tentativo nuovo ha il suo nome');
    assert.equal(git(seconda, 'rev-parse', 'HEAD'), fatto, 'il lavoro del tentativo morto non si rifà: si riparte da lì');
    assert.deepEqual(r2.json.payload.ripartenza, { ramo: morto, commit: 2 }, 'chi lavora sa da dove riparte');
    assert.match(r2.se, /nasce dalla punta .* del tentativo precedente/);
    assert.equal(mondo.legato, nuovo, 'la presa in carico è sul ramo nuovo');
    assert.ok(mondo.consegne.every((c) => !c.rifiutata));

    // Il nuovo consegna e il cancello lo fonde: il ramo morto è antenato di main, e la potatura dei fusi lo toglie.
    const consegnato = commit(seconda, 'lavoro.js', 'fatto\n');
    git(seconda, 'push', '-q', 'origin', `${nuovo}:refs/heads/${nuovo}`);
    git(altrove, 'pull', '-q', '--no-rebase', 'origin', 'main');
    git(altrove, 'fetch', '-q', 'origin');
    git(altrove, 'merge', '-q', '--no-edit', `origin/${nuovo}`);
    git(altrove, 'push', '-q', 'origin', 'main');
    git(altrove, 'fetch', '-q', 'origin');
    const fusi = git(altrove, 'branch', '-r', '--merged', 'origin/main', '--format=%(refname:short)').split('\n');
    assert.ok(fusi.includes(`origin/${morto}`), `il ramo superato risulta fuso: ${fusi.join(', ')}`);
    assert.ok(fusi.includes(`origin/${nuovo}`));
    assert.ok(consegnato);

    // Riaperto dopo la fusione: niente da riprendere, si riparte da main.
    mondo.legato = '';
    await aspettaChe(() => newWorkBranch(ID) !== nuovo, { cosa: 'un nome per tentativo diverso dal secondo' });
    const r3 = await giro(seconda, port);
    assert.equal(r3.json && r3.json.role, 'new-work', `il giro dopo la fusione lavora (uscita ${r3.code}): ${r3.se}`);
    assert.equal(r3.json.payload.ripartenza, undefined);
    assert.equal(git(seconda, 'rev-parse', 'HEAD'), git(seconda, 'rev-parse', 'origin/main'));
  } finally {
    srv.close();
    togliCartella(base);
  }
});

test('giro vero, tentativi nati tutti da main: la busta nomina quelli che il ramo nuovo non contiene', async () => {
  const base = cartellaTemporanea('filo-ripartenza-');
  const { srv, port } = await fintoServer();
  try {
    const { casa, main } = scena(base, { ruoli: true });
    tentativo(casa, ramo('20261101T000000Z'), main, 2);
    const ultimo = tentativo(casa, ramo('20261102T000000Z'), main, 1);
    const r = await giro(casa, port);
    assert.equal(r.json && r.json.role, 'new-work', `il giro lavora (uscita ${r.code}): ${r.se}`);
    assert.equal(git(casa, 'rev-parse', 'HEAD'), ultimo);
    assert.deepEqual(r.json.payload.ripartenza,
      { ramo: ramo('20261102T000000Z'), commit: 1, altri: [{ ramo: ramo('20261101T000000Z'), commit: 2 }] });
  } finally {
    srv.close();
    togliCartella(base);
  }
});

test('giro vero, feedback riaperto: il tentativo superato dalla fusione non è la base e se ne va da origin', async () => {
  const base = cartellaTemporanea('filo-ripartenza-');
  const { srv, port } = await fintoServer();
  try {
    const { casa, main } = scena(base, { ruoli: true });
    tentativo(casa, ramo('20261101T000000Z'), main, 3);
    const fuso = tentativo(casa, ramo('20261102T000000Z'), main, 1);
    git(casa, 'merge', '-q', '--no-ff', '--no-edit', fuso);
    git(casa, 'push', '-q', 'origin', 'main');
    const r = await giro(casa, port);
    assert.equal(r.json && r.json.role, 'new-work', `il giro lavora (uscita ${r.code}): ${r.se}`);
    assert.equal(r.json.payload.ripartenza, undefined, 'niente da riprendere: il lavoro vivo è già su main');
    assert.equal(git(casa, 'rev-parse', 'HEAD'), git(casa, 'rev-parse', 'origin/main'));
    assert.equal(git(casa, 'ls-remote', 'origin', `refs/heads/${ramo('20261101T000000Z')}`), '', 'il superato è chiuso');
  } finally {
    srv.close();
    togliCartella(base);
  }
});

test('giro vero, origin che non risponde: il lavoro non parte da main, si ferma', async () => {
  const base = cartellaTemporanea('filo-ripartenza-');
  const { srv, mondo, port } = await fintoServer();
  try {
    const { casa, main } = scena(base, { ruoli: true });
    tentativo(casa, ramo('20261101T000000Z'), main, 2);
    git(casa, 'remote', 'set-url', 'origin', resolve(base, 'non-esiste.git'));
    const r = await giro(casa, port);
    assert.equal(r.json && r.json.role, 'halt', `il giro si ferma (uscita ${r.code}): ${r.se}`);
    assert.match(r.se, /GUASTO \(transient\): non riesco a chiedere a origin i tentativi precedenti/);
    assert.equal(git(casa, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'nessun ramo nuovo nato da main');
    assert.equal(mondo.legato, '', 'nessuna presa in carico');
  } finally {
    srv.close();
    togliCartella(base);
  }
});
