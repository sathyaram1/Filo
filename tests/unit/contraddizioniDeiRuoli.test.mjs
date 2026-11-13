// #2236: i punti in cui prompt, ruolo e payload dicevano cose diverse ai worker, o tacevano, e il worker perdeva il giro
// a capire chi vince: strumenti e sottofondo, critica che chiede di correggere, lavoro server, ramo che non porta niente.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { espandiInclusioni } from '../../scripts/lib/role-text.mjs';
import { preparaIntestazione } from '../../scripts/lib/worker-nel-clone.mjs';
import { MARCATORE_WORKER } from '../../scripts/lib/dati-worker.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUOLI = resolve(REPO, 'routines', 'roles');
const ruolo = (f) => espandiInclusioni(readFileSync(resolve(RUOLI, f), 'utf8'), RUOLI).replace(/\s+/g, ' ');

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identita = (dir) => {
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']); git(dir, ['config', 'commit.gpgsign', 'false']);
};
const commit = (dir, file, testo, msg) => {
  writeFileSync(join(dir, file), testo);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
};

// Il lavoro su un ramo, e main che va avanti su origin senza che questa copia l'abbia ancora scaricato.
const BASE = cartellaTemporanea('contraddizioni-ruoli-');
const origin = join(BASE, 'origin.git');
const work = join(BASE, 'work');
const altro = join(BASE, 'altro');
mkdirSync(origin); mkdirSync(work);
git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
git(work, ['init', '-q', '--initial-branch=main']);
identita(work);
git(work, ['remote', 'add', 'origin', `file://${origin}`]);
writeFileSync(join(work, '.gitignore'), '.claude/\n');
commit(work, 'a.js', 'uno\n', 'inizio');
git(work, ['push', '-q', 'origin', 'main']);
git(work, ['fetch', '-q', 'origin', 'main']);
git(work, ['checkout', '-qb', 'worker/x']);
commit(work, 'b.js', 'lavoro\n', 'il lavoro di #9');
execFileSync('git', ['clone', '-q', `file://${origin}`, altro], { stdio: 'ignore' });
identita(altro);
const MAIN_NUOVO = commit(altro, 'c.js', 'da main\n', 'arrivato su main');
git(altro, ['push', '-q', 'origin', 'main']);

const TEMP = cartellaTemporanea('contraddizioni-ruoli-tmp-');
Object.assign(process.env, {
  FILO_DISPATCH_STATE_DIR: cartellaTemporanea('contraddizioni-ruoli-stato-'),
  FILO_REPO_ROOT: work,
  FILO_TOOLS_ROOT: REPO,
  CLAUDE_CONFIG_DIR: cartellaTemporanea('filo-claude-utente-'),
  TMPDIR: TEMP, TEMP, TMP: TEMP,
});
const { emit, serverCtx, mainAllaPresa, ramoSenzaModifiche, segnaRamoVuoto, TESTO_RAMO_VUOTO } = await import('../../scripts/dispatch.mjs');
const { readMarker } = await import('../../scripts/lib/routine-role.mjs');

test.after(() => { for (const d of [BASE, TEMP]) { try { togliCartella(d); } catch (_) {} } });

function consegna(bucket, ctx) {
  let out = '';
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = () => true;
  try { emit(bucket, ctx); } finally { process.stdout.write = o; process.stderr.write = e; }
  return JSON.parse(out);
}

test('punto 1: l\'intestazione del worker dice che vale il ruolo, e quale copia degli strumenti usare', () => {
  const base = cartellaTemporanea('contraddizioni-intestazione-');
  try {
    const clone = resolve(base, 'c');
    mkdirSync(resolve(clone, '.claude'), { recursive: true });
    writeFileSync(resolve(clone, MARCATORE_WORKER), JSON.stringify({ indice: 1, principale: resolve(base, 's') }), 'utf8');
    const strumenti = resolve(base, 'filo-strumenti-1');
    const delGiro = resolve(base, 'filo-strumenti');
    const testa = preparaIntestazione(clone, { allinea: () => ({ ok: true }), strumenti, delGiro }).replace(/\s+/g, ' ');
    assert.match(testa, /Dove il prompt con cui sei partito e queste istruzioni dicono cose diverse, valgono queste/);
    assert.ok(testa.includes(`usano gli strumenti in \`${strumenti}\`, la tua copia`), testa);
    assert.ok(testa.includes(`quella in \`${delGiro}\` che il prompt ti ha fatto lanciare è di chi guida il giro`), testa);
    assert.match(testa, /vale per il tuo lancio, non per i tuoi comandi: quelli lunghi vanno in sottofondo/);
    const stessa = preparaIntestazione(clone, { allinea: () => ({ ok: true }), strumenti: delGiro, delGiro });
    assert.doesNotMatch(stessa, /che il prompt ti ha fatto lanciare/, 'con una copia sola non c\'è niente da distinguere');
  } finally {
    togliCartella(base);
  }
});

test('punto 1: il prompt minimo del worker scritto dall\'orchestratore dice che, dove differiscono, vale il ruolo', () => {
  const prompt = ruolo('orchestrator.md').split('Prompt del worker (minimo):')[1].split('Il worker si lancia')[0];
  assert.match(prompt, /Dove il ruolo dice altro da questo prompt \(percorsi degli strumenti compresi\), vale il ruolo/);
});

test('punto 2: chi riallinea sa cosa fare quando la critica chiede di correggere, e di un file generato in conflitto', () => {
  const t = ruolo('resolver-rebase.md');
  assert.match(t, /un «correggi» lì nomina il difetto, non ti dà il compito/);
  assert.match(t, /Tu correggi solo in tre casi/);
  assert.match(t, /Ogni altra correzione chiesta la consegni com'è: `--motivo "prove rosse: …"`/);
  assert.match(t, /la fa il correttore del giro che segue/);
  assert.match(t, /`functions\/tools\/l5-rigioco\.json`\) non si fonde a righe: tieni la versione di `main` e rilancia lo strumento che lo genera/);
});

test('punti 2 e 4: un ramo che non porta niente ha la sua regola per chi riallinea e per chi verifica', () => {
  for (const f of ['resolver-rebase.md', 'verifier.md', 'verifier-riallineamento.md']) {
    const t = ruolo(f);
    assert.match(t, /## Un ramo che non porta niente/, f);
    assert.match(t, /--motivo "altro: il lavoro è già tutto su main \(<sha della fusione>\)"/, f);
    assert.match(t, /Chi verifica non cerca un diff: verifica la richiesta sul codice com'è, che è main/, f);
  }
  assert.ok(TESTO_RAMO_VUOTO.includes('«Un ramo che non porta niente»'), 'il payload rimanda alla sezione che esiste');
});

test('punti 2 e 3: il riallineamento di un lavoro server dice quale ramo col rebase e quale col merge, e come si rilancia la suite', () => {
  const t = ruolo('_lavoro-server.md');
  assert.match(t, /Il ramo di Filo si riallinea col rebase del tuo ruolo, anche quando la critica parla solo del server/);
  assert.match(t, /il divieto di `git merge` del ruolo vale per il ramo di Filo, non per questo/);
  assert.match(t, /commit --allow-empty -m "rilancio della suite"`, poi spinta e riga `ramo-server`/);
});

test('punto 4: chi riallinea parte col main scaricato alla presa in carico, non con la copia vecchia della cartella', () => {
  assert.notEqual(git(work, ['rev-parse', 'origin/main']), MAIN_NUOVO, 'la scena parte con la copia vecchia');
  const bucket = { role: 'fixer', id: 'x', num: '#9', branch: 'worker/x' };
  consegna(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' }, critique: 'conflitto: a.js' } }));
  assert.equal(readMarker(work).mainAllaPresa, MAIN_NUOVO);
  assert.equal(mainAllaPresa(join(BASE, 'non-un-repo')), '', 'senza git la consegna torna a chiedere l\'ultimo main');
});

test('punto 4: chi verifica o riallinea un ramo che non porta niente lo sa dal payload; un lavoro server no', () => {
  assert.equal(ramoSenzaModifiche(work), false, 'il ramo col lavoro porta qualcosa');
  git(work, ['checkout', '-qb', 'worker/vuoto', 'origin/main']);
  try {
    assert.equal(ramoSenzaModifiche(work), true);
    for (const role of ['verifier', 'fixer']) {
      const bucket = { role, id: 'x', num: '#9', branch: 'worker/vuoto' };
      const ctx = segnaRamoVuoto(bucket, serverCtx(bucket, { payload: { feedback: { text: 't' } } }));
      assert.equal(consegna(bucket, ctx).payload.ramoVuoto, TESTO_RAMO_VUOTO, role);
    }
    const server = segnaRamoVuoto({ role: 'verifier' }, { lavoroServer: { ramo: 'worker/vuoto' } });
    assert.equal(server.ramoVuoto, undefined, 'le modifiche di un lavoro server stanno nel diff del server');
    assert.equal(segnaRamoVuoto({ role: 'new-work' }, {}).ramoVuoto, undefined);
  } finally {
    git(work, ['checkout', '-q', 'worker/x']);
  }
});
