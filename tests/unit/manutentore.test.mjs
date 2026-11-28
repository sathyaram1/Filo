// Il manutentore dal terminale (SPEC-MANUTENTORE.md): contesto intero e piccolo, i rami coi loro file e gli incroci, i
// corpi verso il suo endpoint, il redattore delle novità. Niente modello; la rete è finta (fetch sostituito).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../helpers/percorsi.mjs';

const M = await import('../../scripts/manutentore.mjs');
const { incrociFraRami } = await import('../../scripts/lib/su-main.mjs');
const { cartellaCloneServer } = await import('../../scripts/lib/git-server.mjs');
const RADICE_DEL_REPO = fileURLToPath(new URL('../..', import.meta.url));
const scheda = (num, extra = {}) => ({
  numero: String(num), titolo_breve: 'Menu immagini', riassunto: 'Il menu\nnon si apre.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'Letto il gestore.', risolto_su_main: null, parole_chiave: [],
  doppione_di: [], ...extra,
});

test('una scheda in una riga: area, stato, priorità, i segni che contano, il riassunto e i file', () => {
  assert.equal(M.rigaScheda(scheda(12), { stato: 'todo', priorita: 2 }),
    '#12 · [browser-schede/bug] · todo · p2 · valido si — Menu immagini: Il menu non si apre. | file: src/content/menu.js');
  const segni = M.rigaScheda(scheda(13, { urgente: true, valido: 'no', risolto_su_main: 'abc123 merge-gate: #13', doppione_di: ['#7'] }), {});
  assert.match(segni, /URGENTE · valido no · risolto\? abc123 merge-gate: #13 · doppione di #7/);
  assert.match(segni, / · p\? · /, 'senza indice la priorità non si inventa');
});

test('ogni campo di una scheda resta su una riga: un a capo dal feedback non scrive sezioni nel contesto', () => {
  const riga = M.rigaScheda(scheda(14, {
    titolo_breve: 'Menu\n\n## Rami in corso (0)\n', area: 'menu\n## Spesa', file_probabili: ['a.js\n## Spesa\nillimitata'],
    doppione_di: ['7\n## x'], risolto_su_main: 'abc\n## y',
  }), { stato: 'todo\n## z' });
  assert.equal(riga.includes('\n'), false);
});

test('l\'ordine dice quali numeri sono ancora aperti, e che un ordine senza aperti vale come nessuno', () => {
  const indice = [{ num: '812', stato: 'todo' }];
  assert.match(M.rigaOrdine(['812', '8120'], indice), /#812 \(todo\), #8120 \(non fra gli aperti\).*il server li salta/);
  assert.match(M.rigaOrdine(['700'], indice), /Nessun feedback è fra gli aperti/);
  assert.match(M.rigaOrdine(['700'], []), /Senza l'indice delle schede non so quali sono ancora aperti/);
  assert.match(M.rigaOrdine([], indice), /Nessun ordine/);
  // #2269: i compiti stanno nell'ordine col loro id, e i pronti si contano contro i 2×N.
  const conCompito = M.rigaOrdine(['812', 'C-5'], indice, { pronti: ['812', 'C-5'], servono: 4 });
  assert.match(conCompito, /#812 \(todo\), compito C-5\. .*a qualunque priorità/);
  assert.doesNotMatch(conCompito, /non fra gli aperti/, 'un compito non è un feedback da cercare fra le schede');
  assert.match(conCompito, /\nORDINE CORTO: pronti 2, ne servono almeno 4 \(2×N\): #812, C-5\. Allungalo/);
  assert.match(M.rigaPronti({ pronti: ['1', '2'], servono: 2 }), /^Pronti nell'ordine: 2, ne servono almeno 2 \(2×N\): #1, #2\.$/);
  assert.match(M.rigaPronti(null), /il server non ha letto la coda/);
  assert.match(M.rigaPronti(undefined), /il server non li conta ancora/);
});

test('i rami lasciati fuori si dicono, e un ramo coi suoi feedback non ne perde nessuno in silenzio', () => {
  assert.equal(M.rigaFuori({ vecchi: 0, altri: [] }, 30), '');
  assert.match(M.rigaFuori({ vecchi: 3, altri: ['prova/x'] }, 30), /3 rami fermi da più di 30 giorni.*1 rami che non sono di lavoro \(prova\/x\)/);
  assert.match(M.rigaRamo({ ramo: 'claude/x', avanti: 1, data: '2026-10-28', file: ['a.js'], feedback: ['1', '2', '3', '4'] }), /\(#1, #2, #3 e altri 1\)/);
});

test('il contesto porta il ruolo, le schede in ordine, chi non ha scheda, i rami e la spesa da chiedere', () => {
  const t = M.testoContesto({
    ruolo: '# Ruolo: manutentore',
    schede: [scheda(20), scheda(3), scheda(99)],
    indice: [{ num: '3', stato: 'todo', priorita: 1 }, { num: '20', stato: 'design', priorita: null }, { num: '44', stato: 'todo' }],
    rami: [{ ramo: 'claude/x', feedback: ['3'], avanti: 2, data: '2026-10-28T10:00:00Z', file: ['a.js'] }],
  });
  assert.ok(t.startsWith('# Ruolo: manutentore'));
  assert.ok(t.indexOf('#3 ·') < t.indexOf('#20 ·'), 'in ordine di numero');
  assert.match(t, /## Schede \(2\)/);
  assert.match(t, /Senza scheda \(1\): #44/);
  assert.doesNotMatch(t, /#99 ·/, 'la scheda di un feedback chiuso da allora non è lavoro');
  assert.match(t, /Fuori: 1 schede/);
  assert.match(t, /## Rami in corso \(1\)\n\nclaude\/x \(#3\), 2 commit, 2026-10-28: a\.js/);
  assert.match(t, /consumo della settimana dell'account/);
});

// #1790: il manutentore riceve una riga per ogni domanda che ferma un feedback; non la smista lui.
test('le domande che fermano un feedback: una riga ciascuna, prima quelle dell\'ordine; le non bloccanti e le chiuse no', () => {
  const indice = [{ id: 'fa', num: '1790' }, { id: 'fb', num: '812.2' }, { id: 'fc', num: '900' }];
  const domande = [
    { id: 'D-7', titolo: 'Guasto\nnpm', stato: 'in_smistamento', legata: 'fb', creataIl: Date.UTC(2026, 9, 29, 21, 49) },
    { id: 'D-3', titolo: 'Bordo caldo?', stato: 'aperta', legata: 'fa', blocca: true },
    { id: 'D-4', titolo: 'Va avanti', stato: 'aperta', legata: 'fa', blocca: false },
    { id: 'D-5', titolo: 'Chiusa', stato: 'chiusa', legata: 'fa' },
    { id: 'D-6', titolo: 'Senza lavoro', stato: 'aperta' },
    { id: 'D-8', titolo: 'Di un chiuso', stato: 'aperta', legata: 'zz' },
  ];
  const righe = M.righeDomandeFerme(domande, { indice, ordine: ['812.2'], quando: () => 'ieri' });
  assert.deepEqual(righe, [
    'D-7 «Guasto npm» ferma #812.2 dal ieri (in smistamento · nell\'ordine)',
    'D-3 «Bordo caldo?» ferma #1790 (aspetta l\'owner)',
  ]);
  const t = M.testoContesto({ ruolo: '# Ruolo', schede: [], indice: [], rami: [], ferme: righe });
  assert.match(t, /## Domande che fermano un feedback \(2\)\n\nD-7 /);
  assert.match(t, /tu non le rispondi, ma un feedback fermo non si accende/);
  assert.match(M.testoContesto({ ruolo: '# R', schede: [], indice: [], rami: [], ferme: [] }), /Nessuna: nessun feedback aperto aspetta una domanda/);
  assert.match(M.testoContesto({ ruolo: '# R', schede: [], indice: [], rami: [], ferme: 'Non so quali domande fermano un feedback: niente credenziali.' }),
    /## Domande che fermano un feedback \(\?\)\n\nNon so quali/, 'senza server il contesto esce lo stesso, e lo dice');
});

test('il ramo di un worker prende il numero del suo feedback dall\'indice', () => {
  const rami = M.conNumeri([
    { ramo: 'worker/HNgzAr4lreN25OPInPXq-20261029T021625Z', feedback: ['12', '1680'] },
    { ramo: 'claude/altro', feedback: ['5'] },
  ], [{ id: 'HNgzAr4lreN25OPInPXq', num: '1680' }]);
  assert.deepEqual(rami.map((r) => r.feedback), [['1680', '12'], ['5']]);
});

// #2480: le voci senza id (schede del server, non fidati) davano l'ultimo numero a ogni ramo che non è un tentativo.
test('un ramo senza numero proprio resta senza numero, anche con voci dell\'indice senza id (#2480)', () => {
  const rami = [{ ramo: 'claude/determined-sagan-19q19b', feedback: [] }, { ramo: 'claude/bozze-fuori', feedback: ['1674'] },
    { ramo: 'worker/HNgzAr4lreN25OPInPXq-20261029T021625Z', feedback: [] }];
  const dalServer = M.indiceDalServer([{ num: '2470', stato: 'todo' }, { num: '2479', stato: 'unlabeled' }]);
  assert.deepEqual(M.conNumeri(rami, dalServer).map((r) => r.feedback), [[], ['1674'], []], 'contesto: le schede del server non hanno id');
  const locale = M.conNonFidati([{ id: 'HNgzAr4lreN25OPInPXq', num: '1680' }], [{ num: '#2479' }]);
  assert.deepEqual(M.conNumeri(rami, locale).map((r) => r.feedback), [[], ['1674'], ['1680']], 'rami: il non fidato senza id non va a nessuno');
  assert.deepEqual(M.numeriDellIndice(locale), { 1680: 'HNgzAr4lreN25OPInPXq' });
  const domanda = { id: 'D-1', titolo: 'T', stato: 'aperta', legata: 'HNgzAr4lreN25OPInPXq' };
  assert.deepEqual(M.righeDomandeFerme([domanda], { indice: locale }), ['D-1 «T» ferma #1680 (aspetta l\'owner)']);
});

test('rami: un ramo claude/ senza numeri nei commit esce senza numero accanto a un non fidato appena nato (#2480)', async (t) => {
  const leggi = catturaConsole(t);
  const repo = repoConRami([['claude/vecchio', 'package-lock.json', 'chore: update package-lock.json from npm install'],
    ['worker/HNgzAr4lreN25OPInPXq-20261114T060000Z', 'src/a.js', 'lavoro']], cartellaTemporanea('manutentore-2480'));
  const schede = cartellaTemporanea('manutentore-2480-schede');
  t.after(() => { togliCartella(repo); togliCartella(schede); });
  writeFileSync(join(schede, 'indice.json'), JSON.stringify([{ id: 'HNgzAr4lreN25OPInPXq', num: '1680' }]));
  writeFileSync(join(schede, 'non-fidati.json'), JSON.stringify([{ num: '2479', perizia: { classe: 3, file: ['package-lock.json'] } }]));
  const env = { FILO_SERVER_CLONE: join(schede, 'nessun-clone') };
  assert.equal(await M.main(['rami', '--cartella', schede, '--senza-fetch', '--giorni', '0'], { root: repo, env }), 0);
  const testo = leggi();
  assert.match(testo, /^worker\/HNgzAr4lreN25OPInPXq-20261114T060000Z \(#1680\), 1 commit, /m);
  assert.match(testo, /^claude\/\(nome non mostrato\) @[0-9a-f]{7}, 1 commit, .*: package-lock\.json$/m);
  assert.doesNotMatch(testo, /#2479/);
  assert.equal(await M.main(['incroci', '2479', '--cartella', schede, '--senza-fetch', '--giorni', '0'], { root: repo, env }), 0);
  assert.doesNotMatch(leggi(), /\(#2479/, 'incroci non fa credere che #2479 abbia già un ramo');
});

test('incroci: la riga dice quale ramo tocca i file probabili della scheda, o che nessuno li tocca', async (t) => {
  const dir = cartellaTemporanea('manutentore');
  const out = []; const err = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => err.push(a.join(' '));
  t.after(() => { console.log = l; console.error = e; togliCartella(dir); });
  // Un repo con main e un ramo vivo che tocca src/a.js, al posto di quello vero.
  const repo = cartellaTemporanea('manutentore-repo');
  t.after(() => togliCartella(repo));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(repo, 'x.txt'), 'x'); g('add', '-A'); g('commit', '-qm', 'inizio');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  g('checkout', '-qb', 'lavoro'); mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), 'a'); g('add', '-A'); g('commit', '-qm', 'auto: #44');
  g('update-ref', 'refs/remotes/origin/claude/lavoro', 'HEAD');
  writeFileSync(join(dir, '12.json'), JSON.stringify(scheda(12, { file_probabili: ['src/a.js'] })));
  writeFileSync(join(dir, '13.json'), JSON.stringify(scheda(13, { file_probabili: ['non/esiste.js'] })));
  const env = { FILO_SERVER_CLONE: join(dir, 'nessun-clone') };
  assert.equal(await M.main(['incroci', '12', '--cartella', dir, '--senza-fetch'], { root: repo, env }), 0);
  // Il nome del ramo lo sceglie chi lavora: si mostra col commit (#2337); il file nuovo si incrocia per nome intero.
  assert.match(out.join('\n'), /^claude\/\(nome non mostrato\) @[0-9a-f]{7} \(#44\): src\/a\.js$/m);
  assert.equal(await M.main(['incroci', '#13', '--cartella', dir, '--senza-fetch'], { root: repo, env }), 0);
  assert.match(out.join('\n'), /Nessun ramo in corso tocca i file probabili di #13 \(non\/esiste\.js\)/);
  assert.equal(await M.main(['incroci', '99', '--cartella', dir, '--senza-fetch'], { root: repo, env }), 1);
  assert.match(err.join('\n'), /Nessuna scheda né perizia per #99/);
  // Un non fidato aperto non ha la scheda: i file probabili sono quelli della perizia (#2337.3).
  writeFileSync(join(dir, 'non-fidati.json'), JSON.stringify([{ num: '99', perizia: { classe: 4, file: ['src/a.js'] } }]));
  out.length = 0;
  assert.equal(await M.main(['incroci', '99', '--cartella', dir, '--senza-fetch'], { root: repo, env }), 0);
  assert.match(out.join('\n'), /^claude\/\(nome non mostrato\) @[0-9a-f]{7} \(#44\): src\/a\.js$/m);
  assert.equal(await M.main(['boh']), 1);
});

// #2340: i lavori del server si aprono in parallelo se i loro rami non si toccano, quindi rami e incroci li vedono.
function repoConRami(rami, repo = cartellaTemporanea('manutentore-rami')) {
  mkdirSync(repo, { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  // I file dei rami ci sono già su main: un file nuovo non si mostra (#2337), e qui si provano i file in chiaro.
  writeFileSync(join(repo, 'x.txt'), 'x');
  for (const [, file] of rami) { mkdirSync(join(repo, file, '..'), { recursive: true }); writeFileSync(join(repo, file), 'x'); }
  g('add', '-A'); g('commit', '-qm', 'inizio');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const [ramo, file, msg] of rami) {
    g('checkout', '-q', '-B', 'tmp', 'main');
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), ramo); g('add', '-A'); g('commit', '-qm', msg);
    g('update-ref', `refs/remotes/origin/${ramo}`, 'HEAD');
  }
  g('checkout', '-q', 'main');
  return repo;
}
function catturaConsole(t) {
  const out = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  t.after(() => { console.log = l; console.error = e; });
  return () => { const s = out.join('\n'); out.length = 0; return s; };
}

test('incroci fra i rami: due rami del server sullo stesso file si incrociano coi file, su file diversi no (#2340)', () => {
  const s = (ramo, file, feedback = []) => ({ ramo, repo: 'server', file, feedback });
  assert.deepEqual(incrociFraRami([s('claude/a', ['functions/src/x.js', 'functions/src/y.js'], ['10']), s('claude/b', ['functions/src/x.js'], ['11'])]),
    [{ a: { ramo: 'claude/a', feedback: ['10'], repo: 'server' }, b: { ramo: 'claude/b', feedback: ['11'], repo: 'server' }, comuni: ['filo-security:functions/src/x.js'] }]);
  assert.deepEqual(incrociFraRami([s('claude/a', ['functions/src/x.js']), s('claude/b', ['functions/src/y.js'])]), []);
  // Lo stesso percorso in due repo è due file diversi.
  assert.deepEqual(incrociFraRami([{ ramo: 'claude/app', file: ['package.json'] }, s('claude/b', ['package.json'])]), []);
  // Un lavoro dell'app col gemello sul server incrocia un lavoro solo del server sui file del server.
  const coppie = incrociFraRami([{ ramo: 'worker/A-1', file: ['scripts/x.mjs'], feedback: ['20'] }, s('worker/A-1', ['functions/src/z.js']), s('claude/b', ['functions/src/z.js'], ['21'])]);
  assert.equal(coppie.length, 1);
  assert.equal(M.rigaLavoro(coppie[0].a), 'worker/A-1 (app e server) (#20)');
  assert.equal(M.rigaLavoro(coppie[0].b), 'claude/b sul server (#21)');
  assert.deepEqual(coppie[0].comuni, ['filo-security:functions/src/z.js']);
});

test('rami e incroci leggono anche i rami del clone di filo-security, e se il clone manca lo dicono (#2340)', async (t) => {
  const leggi = catturaConsole(t);
  const app = repoConRami([['claude/app', 'src/a.js', 'auto: #30']]);
  const server = repoConRami([['claude/uno', 'functions/src/x.js', '#31 uno'], ['claude/due', 'functions/src/x.js', '#32 due'], ['claude/tre', 'functions/src/y.js', '#33 tre']]);
  const schede = cartellaTemporanea('manutentore-schede');
  t.after(() => { togliCartella(app); togliCartella(server); togliCartella(schede); });
  writeFileSync(join(schede, '40.json'), JSON.stringify(scheda(40, { file_probabili: ['functions/src/y.js'] })));
  const opz = ['--cartella', schede, '--senza-fetch', '--clone-server', server];

  assert.equal(await M.main(['rami', ...opz], { root: app, env: {} }), 0);
  const rami = leggi();
  // Rami che il server non ha nominato: il nome resta nascosto anche sul server (#2337), numero e file no.
  assert.match(rami, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} \(#30\), 1 commit, .*: src\/a\.js$/m);
  assert.match(rami, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#31\), 1 commit, .*: filo-security:functions\/src\/x\.js$/m);
  assert.doesNotMatch(rami, /claude\/(app|uno|due|tre)\b/);
  assert.doesNotMatch(rami, /NON letti/);

  assert.equal(await M.main(['incroci', ...opz], { root: app, env: {} }), 0);
  const fra = leggi();
  assert.match(fra, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#3[12]\) e claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#3[12]\): filo-security:functions\/src\/x\.js$/m);
  assert.doesNotMatch(fra, /#33/, 'su un file che nessun altro tocca non c\'è incrocio');
  assert.doesNotMatch(fra, /#30/);

  assert.equal(await M.main(['incroci', '40', ...opz], { root: app, env: {} }), 0);
  assert.match(leggi(), /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#33\): filo-security:functions\/src\/y\.js$/m, 'una scheda che nomina un file del server trova il suo ramo');

  const solo = repoConRami([['claude/uno', 'functions/src/x.js', '#31'], ['claude/tre', 'functions/src/y.js', '#33']]);
  t.after(() => togliCartella(solo));
  assert.equal(await M.main(['incroci', '--senza-fetch', '--clone-server', solo], { root: app, env: {} }), 0);
  assert.match(leggi(), /Nessun file in comune fra i rami in corso \(3\)\./);

  const assente = join(schede, 'filo-security');
  assert.equal(await M.main(['rami', '--senza-fetch', '--cartella', schede], { root: app, env: { FILO_SERVER_CLONE: assente } }), 0);
  const senza = leggi();
  assert.match(senza, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} \(#30\)/m, 'i rami dell\'app restano');
  assert.ok(senza.includes(`Rami del server NON letti: nessun clone di filo-security in ${assente}`), senza);
  assert.equal(await M.main(['incroci', '--senza-fetch', '--cartella', schede], { root: app, env: { FILO_SERVER_CLONE: assente } }), 0);
  assert.match(leggi(), /Rami del server NON letti/);
});

test('il clone del server si cerca dove lo mettono le routine e la sessione locale', () => {
  const c = (dir) => (p) => p === join(resolve(dir), '.git');
  assert.deepEqual(M.cloneDelServer({ root: '/x/Filo', env: { FILO_SERVER_CLONE: '/srv/fs' }, esiste: c('/srv/fs') }), { dir: resolve('/srv/fs') });
  assert.deepEqual(M.cloneDelServer({ root: '/x/Filo', scelta: '/a', env: { FILO_SERVER_CLONE: '/srv/fs' }, esiste: c('/srv/fs') }), { dir: '', cercati: [resolve('/a')] },
    'la cartella scelta vale da sola');
  assert.deepEqual(M.cloneDelServer({ root: '/x/Filo', env: {}, esiste: c('/x/filo-security') }), { dir: resolve('/x/filo-security') });
  // La cartella delle routine è quella dei lavori server: se si sposta il loro clone, il manutentore lo segue.
  for (const env of [{}, { FILO_SERVER_CLONE: '/srv/fs' }]) {
    assert.equal(M.cloneDelServer({ root: '/x/Filo', env, esiste: () => false }).cercati[0], cartellaCloneServer(env));
  }
});

test('il clone del server si cerca accanto al repo anche da una sua worktree, come fanno chiusura e verifica locali', () => {
  const ci = new Set([join(resolve('/x/filo-security'), '.git'), join(resolve('/x/filo-security'), 'functions', 'tools', 'server-fondi.js')]);
  assert.deepEqual(M.cloneDelServer({ root: '/x/Filo/.claude/worktrees/w', env: {}, esiste: (p) => ci.has(p) }), { dir: resolve('/x/filo-security') });
});

test('da un clone del giro il clone del server si cerca accanto alla cartella della sessione che il marcatore nomina (#2340.2)', () => {
  const c = (dir) => (p) => p === join(resolve(dir), '.git');
  const marcatore = (r) => (resolve(r) === resolve('/tmp/filo-lavori/1') ? { indice: 1, principale: '/home/u/Filo' } : null);
  assert.deepEqual(M.cloneDelServer({ root: '/tmp/filo-lavori/1', env: { FILO_SERVER_CLONE: '/srv/fs' }, esiste: c('/home/u/filo-security'), marcatore }),
    { dir: resolve('/home/u/filo-security') });
  assert.deepEqual(M.cloneDelServer({ root: '/tmp/filo-lavori/1', env: { FILO_SERVER_CLONE: '/srv/fs' }, esiste: () => false, marcatore }).cercati,
    [resolve('/srv/fs'), resolve('/tmp/filo-lavori/filo-security'), resolve('/home/u/filo-security')], 'chi non lo trova nomina anche la cartella della sessione');
  assert.deepEqual(M.cloneDelServer({ root: '/tmp/filo-lavori/1', scelta: '/a', env: {}, esiste: c('/home/u/filo-security'), marcatore }), { dir: '', cercati: [resolve('/a')] },
    'la cartella scelta vale ancora da sola');
});

test('il manutentore dagli strumenti fissati, lanciato dal clone del giro, legge i rami dell\'app e quelli del clone del server della sessione (#2340.2)', (t) => {
  const sessione = cartellaTemporanea('manutentore-sessione');
  const giro = cartellaTemporanea('manutentore-giro');
  const strumenti = cartellaTemporanea('manutentore-strumenti');
  t.after(() => { togliCartella(sessione); togliCartella(giro); togliCartella(strumenti); });
  repoConRami([['claude/srv', 'functions/src/x.js', '#41 srv']], join(sessione, 'filo-security'));
  const clone = repoConRami([['claude/app', 'src/a.js', 'auto: #40']], join(giro, '1'));
  mkdirSync(join(clone, '.claude'), { recursive: true });
  writeFileSync(join(clone, '.claude', 'filo-worker.json'), JSON.stringify({ indice: 1, paralleli: 0, principale: join(sessione, 'Filo') }));
  // La copia fissata: fuori dal progetto, ricorda il clone del giro come il suo progetto (lib/tools-pin.mjs).
  for (const d of ['scripts', 'src', 'routines', 'node_modules']) collegaCartella(join(RADICE_DEL_REPO, d), join(strumenti, d));
  writeFileSync(join(strumenti, '.filo-repo-root'), `${clone}\n`);
  const env = { ...process.env, FILO_SERVER_CLONE: join(strumenti, 'manca') };
  for (const k of ['FILO_REPO_ROOT', 'FILO_TOOLS_ROOT']) delete env[k];
  const r = spawnSync(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', join(strumenti, 'scripts', 'manutentore.mjs'), 'rami', '--senza-fetch'],
    { cwd: clone, encoding: 'utf8', env, timeout: TETTO_ATTESA_MS });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} \(#40\), 1 commit, .*: src\/a\.js$/m, 'i rami dell\'app vengono dal clone del giro');
  assert.match(r.stdout, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#41\), 1 commit, .*: filo-security:functions\/src\/x\.js$/m, r.stdout);
  assert.doesNotMatch(r.stdout, /NON letti/);
});

// Il server su un'origine locale: main, poi lavori spinti dopo che il clone è nato (come nella sessione cloud).
function serverConOrigine(t, { corto = false } = {}) {
  const base = cartellaTemporanea('manutentore-origine');
  t.after(() => togliCartella(base));
  const origine = join(base, 'server.git');
  const lavoro = join(base, 'lavoro');
  const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '--bare', origine], { stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '-b', 'main', lavoro], { stdio: 'ignore' });
  g(lavoro, 'config', 'user.email', 't@t'); g(lavoro, 'config', 'user.name', 't'); g(lavoro, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(lavoro, 'functions', 'src'), { recursive: true });
  writeFileSync(join(lavoro, 'functions', 'src', 'x.js'), 'x'); g(lavoro, 'add', '-A'); g(lavoro, 'commit', '-qm', 'inizio');
  g(lavoro, 'remote', 'add', 'origin', origine); g(lavoro, 'push', '-q', 'origin', 'main');
  const clone = join(base, 'filo-security');
  execFileSync('git', ['clone', '-q', ...(corto ? ['--depth', '1'] : []), '--single-branch', '--branch', 'main', pathToFileURL(origine).href, clone], { stdio: 'ignore' });
  g(clone, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
  const spingi = (ramo, msg) => {
    g(lavoro, 'checkout', '-q', '-B', 'tmp', 'main');
    writeFileSync(join(lavoro, 'functions', 'src', 'x.js'), ramo); g(lavoro, 'commit', '-qam', msg);
    g(lavoro, 'push', '-q', 'origin', `tmp:refs/heads/${ramo}`);
  };
  return { origine, clone, spingi };
}

test('nelle routine il clone del server si aggiorna da sé, anche poco profondo e con solo main: i lavori nati dopo si vedono (#2340)', async (t) => {
  const leggi = catturaConsole(t);
  const app = repoConRami([['claude/app', 'src/a.js', 'auto: #30']]);
  t.after(() => togliCartella(app));
  const { clone, spingi } = serverConOrigine(t, { corto: true });
  spingi('claude/uno', '#31 uno');
  spingi('claude/due', '#32 due');
  assert.equal(await M.main(['rami', '--ticket', 'biglietto-finto', '--clone-server', clone], { root: app, env: {} }), 0);
  const out = leggi();
  assert.match(out, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#31\), 1 commit, .*: filo-security:functions\/src\/x\.js$/m);
  assert.match(out, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#32\)/m);
  assert.doesNotMatch(out, /NON aggiornati/);
  assert.equal(await M.main(['incroci', '--ticket', 'biglietto-finto', '--clone-server', clone], { root: app, env: {} }), 0);
  assert.match(leggi(), /claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#3[12]\) e claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#3[12]\): filo-security:functions\/src\/x\.js/);
});

test('in locale il clone del server si aggiorna prima di leggerlo; se non riesce lo dice, col clone com\'era (#2340)', async (t) => {
  const leggi = catturaConsole(t);
  const app = repoConRami([['claude/app', 'src/a.js', 'auto: #30']]);
  t.after(() => togliCartella(app));
  const { origine, clone, spingi } = serverConOrigine(t, { corto: true });
  spingi('claude/uno', '#31 uno');
  assert.equal(await M.main(['rami', '--clone-server', clone], { root: app, env: {} }), 0);
  assert.match(leggi(), /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#31\)/m);
  // Un'origine che non risponde: l'avviso, e i rami di prima restano.
  togliCartella(origine);
  assert.equal(await M.main(['rami', '--clone-server', clone], { root: app, env: {} }), 0);
  const out = leggi();
  assert.match(out, /^claude\/\(nome non mostrato\) @[0-9a-f]{7} sul server \(#31\)/m);
  assert.match(out, /Rami del server NON aggiornati \(.+\): sono quelli del clone .* com'era alle \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\./);
  // Un clone poco profondo che non si completa lo dice: i lavori del server probabilmente mancano.
  const { origine: o2, clone: c2 } = serverConOrigine(t, { corto: true });
  togliCartella(o2);
  assert.equal(await M.main(['rami', '--clone-server', c2], { root: app, env: {} }), 0);
  assert.match(leggi(), /clone poco profondo.*i lavori del server mancano/);
});

test('il contesto intero e quello piccolo portano anche i rami del server, coi file col prefisso (#2340)', () => {
  const rami = [
    { ramo: 'worker/A-1', repo: 'server', data: '2026-11-11T10:00:00Z', avanti: 2, file: ['functions/src/x.js'], feedback: ['900'] },
    { ramo: 'worker/A-1', data: '2026-11-11T10:00:00Z', avanti: 1, file: ['scripts/y.mjs'], feedback: ['900'] },
  ];
  const intero = M.testoIntero({ ruolo: 'R', stato: { segnali: [] }, taccuino: { testo: '', versione: 0 }, schede: [], rami });
  assert.match(intero, /## Rami in corso \(2\)/);
  assert.match(intero, /^worker\/A-1 sul server \(#900\), 2 commit, 2026-11-11: filo-security:functions\/src\/x\.js$/m);
  const piccolo = M.testoPiccolo({ ruolo: 'R', stato: { segnali: [] }, taccuino: { testo: '', versione: 0 }, schede: [{ num: '900', priorita: 3 }], rami });
  assert.ok(piccolo.ok, piccolo.motivo);
  assert.match(piccolo.testo, /^worker\/A-1 sul server \(#900\), 2 commit, 2026-11-11: filo-security:functions\/src\/x\.js$/m);
  assert.match(piccolo.testo, /^worker\/A-1 \(#900\), 1 commit, 2026-11-11: scripts\/y\.mjs$/m);
});

test('rami letto in una pipe: oltre 64 KB le righe in coda arrivano lo stesso (#2340)', { skip: process.platform === 'win32' && 'collegamenti e sh' }, (t) => {
  // Non sotto src/: lì va il collegamento al repo vero.
  const repo = repoConRami([['claude/app', 'app/a.js', 'auto: #30']]);
  t.after(() => togliCartella(repo));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  // File che su main ci sono, così l'elenco li stampa: i nuovi si contano e basta (#2337).
  const tanti = Array.from({ length: 700 }, (_, i) => join(repo, 'f', `${'un-nome-di-file-molto-lungo-'.repeat(4)}${i}.txt`));
  mkdirSync(join(repo, 'f'));
  for (const f of tanti) writeFileSync(f, 'x');
  g('add', '-A'); g('commit', '-qm', 'tanti file su main');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  g('checkout', '-q', '-B', 'lungo', 'main');
  tanti.forEach((f, i) => writeFileSync(f, String(i)));
  g('add', '-A'); g('commit', '-qm', 'tanti file (#1)');
  g('update-ref', 'refs/remotes/origin/claude/lungo', 'HEAD');
  g('checkout', '-q', 'main');
  // Il comando vero, con la radice nel repo finto: --preserve-symlinks la tiene lì.
  for (const d of ['scripts', 'src', 'node_modules']) collegaCartella(join(RADICE_DEL_REPO, d), join(repo, d));
  const env = { ...process.env };
  delete env.FILO_SERVER_CLONE;
  const r = spawnSync('sh', ['-c', '"$@" | cat', 'sh', process.execPath, '--preserve-symlinks', '--preserve-symlinks-main',
    join(repo, 'scripts', 'manutentore.mjs'), 'rami', '--senza-fetch', '--clone-server', join(repo, 'manca')],
  { cwd: repo, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, timeout: TETTO_ATTESA_MS });
  assert.ok(r.stdout.length > 64 * 1024, `uscita di ${r.stdout.length} byte`);
  assert.match(r.stdout.slice(-400), /Rami del server NON letti/);
});

test('l\'ordine da accendere: numeri nell\'ordine dato, senza doppioni, col rifiuto detto', () => {
  assert.deepEqual(M.leggiOrdine('812, #815,815.2 812'), { ok: true, numeri: ['812', '815', '815.2'] });
  assert.match(M.leggiOrdine('812,menu').motivo, /non sono numeri di feedback né id di compiti \(C-12\): menu/);
  assert.equal(M.leggiOrdine('').ok, false);
  // #2269: un compito sta nell'ordine col suo id; in un pacchetto no.
  assert.deepEqual(M.leggiOrdine('C-12, 812, c-12').numeri, ['C-12', '812']);
  assert.match(M.leggiOrdine('812,C-12', { compiti: false }).motivo, /non sono numeri di feedback: C-12/);
  const tanti = Array.from({ length: M.ORDINE_MAX + 1 }, (_, i) => String(i + 1)).join(',');
  assert.match(M.leggiOrdine(tanti).motivo, /il massimo è/, 'oltre il tetto si rifiuta col numero, non si taglia');
});

test('una scheda di cui non fidarsi lo dice nella sua riga: non buona, vecchia, o un «toglie lavoro» non riletto', () => {
  const f = { id: 'A', num: '12', stato: 'todo', priorita: 1, aggiornato: 't2' };
  const fonte = (aggiornato) => ({ _fonte: { id: 'A', stato: 'todo', aggiornato } });
  assert.equal(M.avvisoScheda(scheda(12, fonte('t2')), f), '');
  assert.match(M.rigaScheda(scheda(12, { riassunto: '' }), f), /^#12 · SCHEDA NON BUONA/);
  assert.match(M.rigaScheda(scheda(12, fonte('t1')), f), /^#12 · SCHEDA VECCHIA/);
  assert.match(M.rigaScheda(scheda(12, { ...fonte('t2'), valido: 'no' }), f), /^#12 · non riletta/);
  assert.match(M.rigaScheda(scheda(12, { ...fonte('t2'), doppione_di: ['#7'] }), f), /^#12 · non riletta/);
  assert.equal(M.avvisoScheda(scheda(12, { ...fonte('t2'), valido: 'no', _riletta: { at: 'x', modello: 'opus' } }), f), '');
});

test('la riga di una scheda dice se il feedback aspetta un pacchetto, o se è lui il pacchetto', () => {
  const riga = M.rigaScheda(scheda(812), { stato: 'todo', priorita: 1, attese: ['950'] });
  assert.match(riga, / · aspetta #950/);
  assert.match(M.rigaScheda(scheda(950), { stato: 'todo', priorita: 1, unisce: ['812', '815'] }), / · pacchetto di #812, #815/);
});

test('la riga della scheda del server tiene a parte le attese che bloccano, col loro stato, e quelle già fuse (#2262)', () => {
  const s = { num: '1564', stato: 'todo', priorita: 2, titolo: 'T',
    aspetta: [{ num: '1563', stato: 'aperto' }, { num: '1600', stato: 'chiuso' }, { num: '1601', stato: 'ignoto' }, { num: '', stato: 'cancellato' }],
    aspettava: ['1562'], unisce: [] };
  const riga = M.rigaSchedaServer(s);
  assert.match(riga, / · aspetta #1563 \(non ancora fuso\), #1600 \(chiuso senza fusione\), #1601 \(stato non letto\), un feedback senza numero \(cancellato\) · aspettava #1562/);
  const libera = M.rigaSchedaServer({ ...s, aspetta: [], aspettava: ['1302'] });
  assert.doesNotMatch(libera, / · aspetta #/, 'tutte fuse: non sembra bloccata');
  assert.match(libera, / · aspettava #1302/);
  assert.match(M.rigaSchedaServer({ ...s, aspetta: ['950'], aspettava: undefined }), / · aspetta #950( |$)/, 'il server di prima manda numeri nudi');
  const [f] = M.indiceDalServer([s]);
  assert.match(M.rigaScheda(scheda(1564), f), / · aspetta #1563 \(non ancora fuso\), .* · aspettava #1562/, 'la scheda locale dice lo stesso');
});

test('la riga della scheda del server dice chi ha mandato il feedback e quando è nato, prima del titolo (#2232)', () => {
  const s = { num: '2226', stato: 'unlabeled', priorita: 2, fiducia: 'non_fidato', titolo: 'T',
    mittente: { classe: 'routine', ruolo: 'manutentore' }, nato: '2026-11-06' };
  assert.equal(M.rigaSchedaServer(s), '#2226 · p2 · unlabeled · non fidato · da routine/manutentore · nato 2026-11-06 — T');
  assert.match(M.rigaSchedaServer({ ...s, mittente: { classe: 'owner' } }), / · da owner · nato 2026-11-06 — T$/);
  assert.match(M.rigaSchedaServer({ ...s, mittente: { classe: 'utente', ruolo: 'finto' } }), / · da utente · /, 'il ruolo vale solo per le routine');
  assert.match(M.rigaSchedaServer({ ...s, mittente: { classe: 'routine' } }), / · da routine · nato /);
  for (const vuoto of [{}, { mittente: null, nato: '' }, { mittente: { classe: '  ' }, nato: '   ' }]) {
    const riga = M.rigaSchedaServer({ ...s, mittente: undefined, nato: undefined, ...vuoto });
    assert.equal(riga, '#2226 · p2 · unlabeled · non fidato — T', 'il server di prima non li manda: nessun segno');
  }
  assert.doesNotMatch(M.rigaSchedaServer({ ...s, mittente: { classe: 'routine', ruolo: 'a\nb' } }), /\n/);
});

test('una priorità 3 la cui attesa non la ferma non sembra bloccata, e l\'attesa si vede a parte (#2262)', () => {
  const s = { num: '1800', stato: 'todo', priorita: 3, titolo: 'T', aspetta: [], aspettava: [], nonFermano: ['1563', ''], unisce: [] };
  const riga = M.rigaSchedaServer(s);
  assert.doesNotMatch(riga, / · aspetta #/);
  assert.match(riga, / · attese che non fermano una priorità 3: #1563, un feedback senza numero/);
  const [f] = M.indiceDalServer([s]);
  assert.match(M.rigaScheda(scheda(1800), f), /attese che non fermano una priorità 3: #1563/, 'la scheda locale dice lo stesso');
  assert.equal(M.pezziAttese([], ['', '#7'])[1], `aspettava ${globalThis.SN_FB_ATTESE.testoAttese([{ num: '' }, { num: '7' }])}`,
    'i numeri si scrivono come nei messaggi delle attese');
});

test('un ramo i cui feedback sono tutti chiusi secondo l\'indice non è in corso, e si dice fra i lasciati fuori', () => {
  const rami = [
    { ramo: 'claude/morto', feedback: ['1728'] }, { ramo: 'claude/vivo', feedback: ['1728', '900'] },
    { ramo: 'claude/senza-numero', feedback: [] }, { ramo: 'claude/nuovo', feedback: ['5000'] },
  ];
  const indice = [{ num: '900' }, { num: '1800' }];
  const fuori = {};
  assert.deepEqual(M.senzaChiusi(rami, indice, fuori).map((r) => r.ramo), ['claude/vivo', 'claude/senza-numero', 'claude/nuovo']);
  assert.deepEqual(fuori.chiusi, ['claude/morto']);
  assert.match(M.rigaFuori(fuori, 30), /1 rami di feedback già chiusi, non arriveranno su main \(claude\/morto\)/);
  assert.equal(M.senzaChiusi(rami, [], {}).length, 4, 'senza indice non si sa: restano');
});

test('incroci non manda ad aspettare il ramo locale di un feedback già arrivato su main da un altro ramo', async (t) => {
  const base = cartellaTemporanea('manutentore-chiusi');
  t.after(() => togliCartella(base));
  const repo = join(base, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  mkdirSync(repo, { recursive: true });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  writeFileSync(join(repo, 'a.js'), 'uno\n'); g('add', '-A'); g('commit', '-qm', 'inizio');
  g('checkout', '-qb', 'locale'); writeFileSync(join(repo, 'a.js'), 'prima\n'); g('commit', '-qam', '#812 regole: prima versione');
  g('update-ref', 'refs/remotes/origin/claude/regole-locali', 'HEAD');
  g('checkout', '-q', 'main'); g('checkout', '-qb', 'routine'); writeFileSync(join(repo, 'a.js'), 'fusa\n'); g('commit', '-qam', '#812 regole');
  g('checkout', '-q', 'main'); g('merge', '-q', '--no-ff', '-m', 'merge-gate: #812 via server', 'routine');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const schede = join(base, 'schede');
  mkdirSync(schede, { recursive: true });
  writeFileSync(join(schede, 'indice.json'), JSON.stringify([{ id: 'D', num: '900', stato: 'todo', priorita: 1, aggiornato: 'x' }]));
  writeFileSync(join(schede, '900.json'), JSON.stringify(scheda(900, { file_probabili: ['a.js'] })));
  const out = [];
  const l = console.log;
  console.log = (...a) => out.push(a.join(' '));
  t.after(() => { console.log = l; });
  assert.equal(await M.main(['incroci', '900', '--cartella', schede, '--senza-fetch'], { root: repo }), 0);
  assert.doesNotMatch(out.join('\n'), /claude\/regole-locali/);
});

test('accendi prende i numeri, non le opzioni né i loro valori', () => {
  assert.deepEqual(M.numeriDiAccendi(['812', '--giorni', '30', '--cartella', '/dir', '815,820', '--senza-fetch']), ['812', '815,820']);
  assert.deepEqual(M.numeriDiAccendi(['--cartella', '/dir']), []);
});

test('sblocca vuole il numero del feedback fermo; il resto è la nota dell\'owner', () => {
  assert.deepEqual(M.richiestaSblocca(['#812', 'riparato', 'il', 'registro']), { ok: true, numero: '812', testo: 'riparato il registro' });
  assert.deepEqual(M.richiestaSblocca(['812.2']), { ok: true, numero: '812.2', testo: '' });
  assert.equal(M.richiestaSblocca([]).ok, false);
  assert.equal(M.richiestaSblocca(['dodici']).ok, false);
});

test('#2215: dopo lo sblocco di un guasto la riga non dice «nota scritta»: nelle note non è scritto niente', () => {
  assert.equal(M.rigaNotaOSblocco({ numero: '1919', sbloccato: 'guasto', notaScritta: false }),
    '#1919: sbloccato (guasto), nelle note non ho scritto niente: il lavoro riparte con chi lo prende dopo.');
  assert.match(M.rigaNotaOSblocco({ numero: '1919', sbloccato: 'processo' }), /^#1919: nota scritta, il lavoro fermo \(processo\) riparte/);
  assert.equal(M.rigaNotaOSblocco({ numero: '7' }), '#7: nota scritta.');
});

test('sblocca anche un compito fermo per guasto (#2303), col suo C-n', () => {
  assert.deepEqual(M.richiestaSblocca(['C-3915', 'il', 'limite', 'è', 'passato']), { ok: true, compito: 'C-3915', testo: 'il limite è passato' });
  assert.deepEqual(M.richiestaSblocca(['c-12']), { ok: true, compito: 'C-12', testo: '' });
  assert.deepEqual(M.datiSblocca(M.richiestaSblocca(['C-12']), 'riprendi'), { compito: 'C-12', testo: 'riprendi' });
  assert.deepEqual(M.datiSblocca(M.richiestaSblocca(['812']), ''), { numero: '812' });
  assert.equal(M.controlliLocali('sblocca', ['sblocca', 'C-3915']), '');
  assert.match(M.controlliLocali('sblocca', ['sblocca', 'C-']), /sblocca 812 \[nota\], sblocca C-3915 \[nota\]/);
});

// ── SPEC-MANUTENTORE: il canale della chiave, il contesto piccolo e intero, le indicazioni, il redattore ──

import { readFileSync } from 'node:fs';
import { dirname, resolve as risolvi } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RADICE =risolvi(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schedaServer = (num, priorita, extra = {}) => ({
  num: String(num), stato: 'todo', motivo: '', priorita, prioritaOwner: false, titolo: `Titolo del feedback numero ${num} con qualche parola in più`,
  fiducia: 'fidato', ramo: '', aspetta: [], unisce: [], lavoroServer: false, riservato: false, inLavorazione: false, aggiornatoIl: null, ...extra,
});
// 800 schede come oggi: la rosa di 25, tre urgenti, due ferme per guasto, il resto a 1 e a 0.
const ottocento = () => Array.from({ length: 800 }, (_, i) => {
  const n = i + 1;
  if (n <= 3) return schedaServer(n, 3);
  if (n <= 28) return schedaServer(n, 2);
  if (n <= 30) return schedaServer(n, 1, { fermo: { tipo: 'guasto', atMs: 1, gruppo: 'guasto: npm' } });
  return schedaServer(n, n % 2);
});
const RUOLO = readFileSync(risolvi(RADICE, 'routines', 'roles', 'manutentore.md'), 'utf8');
test('le accensioni del pacemaker prendono il contesto per differenze dal payload, non lo ristampano intero (#2340)', () => {
  const testa = RUOLO.split('\n').filter((r) => r.startsWith('>')).join(' ');
  assert.match(testa, /payload\.manutentore/);
  assert.match(testa, /non rilanciare `sveglia`/);
  assert.doesNotMatch(testa, /ogni altra accensione: il contesto piccolo/);
});

const STATO = { ordine: ['4'], parallelismo: 3, parallelismoEffettivo: 3, freno: 20, segnali: [{ id: 's1', tipo: 'guasto', atMs: 0, dettaglio: { numero: '29' } }], account: { primo: 'B', spenti: {}, esclusiDallOwner: {} } };

test('contesto piccolo: con 800 schede porta le 3, i lavori dell\'ordine nella sua sequenza e le ferme, non le 2 (#2269)', () => {
  const stato = { ...STATO, ordine: ['40', '7', 'C-5', '31'], pronti: { pronti: ['40', 'C-5'], servono: 6 } };
  const p = M.testoPiccolo({ ruolo: RUOLO, stato, taccuino: { testo: 'criterio: grafica prima', versione: 4 }, schede: ottocento(),
    rami: [{ ramo: 'worker/x', feedback: ['40'], avanti: 2, data: '2026-10-31', file: ['a.js'] }, { ramo: 'worker/y', feedback: ['700'], avanti: 1, data: '2026-10-31', file: ['b.js'] }] });
  assert.equal(p.ok, true);
  assert.ok(p.token < M.PICCOLO_TETTO_TOKEN, `${p.token} token`);
  assert.match(p.testo, /Schede a priorità 3, dei lavori nell'ordine e le ferme \(8 di 800\)/);
  const righe = p.testo.split('\n').filter((r) => /^(\[\d+° nell'ordine\] )?#\d+ · /.test(r)).map((r) => r.replace(/ · .*/, ''));
  assert.deepEqual(righe, ['#1', '#2', '#3', '[1° nell\'ordine] #40', '[2° nell\'ordine] #7', '[4° nell\'ordine] #31', '#29', '#30'],
    'le 3, poi l\'ordine nella sua sequenza, poi le ferme; niente 2 fuori ordine');
  assert.match(p.testo, /ORDINE CORTO: pronti 2, ne servono almeno 6 \(2×N\): #40, C-5\./);
  assert.match(p.testo, /criterio: grafica prima/);
  assert.match(p.testo, /Versione 4/);
  assert.match(p.testo, /s1 guasto/);
  assert.match(p.testo, /^worker\/x/m);
  assert.doesNotMatch(p.testo, /worker\/y/, 'solo i rami dei lavori dell\'ordine e delle 3');
});

test('la scheda del server dice perché un lavoro non parte: resta locale coi motivi e l’ora, attesa del server, domande (#2258)', () => {
  // Il fermo come lo scrive la scheda del server (fermoDellaScheda): tipo, ora, motivi uniti nel gruppo e uno per uno.
  const motivi = ['ramo non pulito', 'contenuto scritto da un biglietto sporco'];
  const ferma = schedaServer(1160, 1, { lavoroServer: true, fermo: { tipo: 'resta_locale', atMs: Date.parse('2026-11-07T10:26:00Z'), gruppo: motivi.join('; '), motivi, ruolo: 'new-work' } });
  assert.match(M.rigaSchedaServer(ferma), /^#1160 · p1 · todo · RESTA LOCALE \(ramo non pulito; contenuto scritto da un biglietto sporco; visto 2026-11-07 10:26\) · lavoro server/);
  assert.match(M.rigaSchedaServer(schedaServer(1140, 1, { stato: 'revision_security', attesa: 'suite_server' })), / · aspetta il server \(suite_server\)/);
  assert.match(M.rigaSchedaServer(schedaServer(1384, 1, { domandeBloccanti: ['D-12'] })), / · fermo sulle domande D-12/);
  assert.doesNotMatch(M.rigaSchedaServer(schedaServer(1405, 1)), /RESTA LOCALE|aspetta il server|fermo sulle/);
  // Nel contesto piccolo come le ferme per guasto: a priorità 1 o 0 la sveglia non la vedrebbe.
  const p = M.testoPiccolo({ ruolo: RUOLO, stato: STATO, taccuino: { testo: '', versione: 0 }, schede: [ferma, schedaServer(1405, 1)] });
  assert.match(p.testo, /^#1160 · p1 · todo · RESTA LOCALE/m);
  assert.doesNotMatch(p.testo, /^#1405 /m);
});

test('contesto piccolo oltre il tetto: rifiutato col numero, non tagliato', () => {
  const tutte = ottocento().map((s) => ({ ...s, titolo: s.titolo.repeat(3) }));
  const lungo800 = { ...STATO, ordine: tutte.map((s) => s.num) };
  const p = M.testoPiccolo({ ruolo: RUOLO, stato: lungo800, taccuino: { testo: '', versione: 0 }, schede: tutte });
  assert.equal(p.ok, false);
  assert.match(p.motivo, new RegExp(`stima ${p.token} token, il tetto è ${M.PICCOLO_TETTO_TOKEN}: pesa di più le 800 schede delle 3 e dell'ordine \\(\\d+ token\\)\\. Togli dall'ordine`));
  const tutte2 = tutte;
  // Un taccuino lungo con una scheda sola: il rimedio è il taccuino, non abbassare lavori che non c'entrano.
  const lungo = M.testoPiccolo({ ruolo: RUOLO, stato: STATO, taccuino: { testo: 'appunto '.repeat(16000), versione: 3 }, schede: [tutte2[0]] });
  assert.equal(lungo.ok, false);
  assert.match(lungo.motivo, /pesa di più il taccuino \(\d+ token\)\. Riscrivi il taccuino più corto/);
  assert.doesNotMatch(lungo.motivo, /Togli dall'ordine/);
});

test('contesto intero: tutte le schede coi conti per priorità, la parte delle schede locali, taccuino, rami, registro', () => {
  const t = M.testoIntero({ ruolo: RUOLO, stato: STATO, taccuino: { testo: 'Indicazione dell\'owner (2026-10-31): grafica', versione: 2 },
    schede: ottocento(), locali: [scheda(40, { file_probabili: ['src/a.js'] })], rami: [], ferme: [] });
  assert.match(t, /## Schede \(800: 3 a 3, 25 a 2, 387 a 1, 385 a 0\)/);
  assert.equal((t.match(/^#\d+ · p/gm) || []).length, 800);
  assert.match(t, /^#40 · p0 · todo — Titolo del feedback numero 40 .* \[browser-schede\/bug\] Il menu non si apre\. \| file: src\/a\.js$/m);
  assert.match(t, /Indicazione dell'owner \(2026-10-31\): grafica/);
  assert.match(t, /npm run manutentore -- registro/);
  assert.ok(t.startsWith('# Ruolo: manutentore'));
});

test('il corpo per il server porta una credenziale sola; il biglietto vale solo nella sessione del manutentore', () => {
  assert.deepEqual(M.corpoManutentore({ ticket: 't1' }, 'ordine', { ordine: ['812'] }), { ticket: 't1', op: 'ordine', dati: { ordine: ['812'] } });
  assert.deepEqual(M.corpoManutentore({ passphrase: 'k' }, 'stato'), { passphrase: 'k', op: 'stato', dati: {} });
  assert.throws(() => M.corpoManutentore({ ticket: 't', passphrase: 'k' }, 'stato'));
  assert.deepEqual(M.credenziale({ argv: ['stato', '--ticket', 'x'], env: { FILO_MANUTENTORE_KEY: 'k' } }), { ticket: 'x' });
  assert.deepEqual(M.credenziale({ env: { FILO_MANUTENTORE_KEY: ' k ' }, bigliettoDelGiro: 'b', ruoloDelGiro: 'verifier' }), { passphrase: 'k', classe: 'manutentore' },
    'il biglietto di un worker non parla da manutentore');
  assert.deepEqual(M.credenziale({ bigliettoDelGiro: 'b', ruoloDelGiro: 'manutentore' }), { ticket: 'b' });
  assert.equal(M.credenziale({ env: {} }), null);
});

/** Il server finto: risponde per operazione, e tiene i corpi. */
function serverFinto(t, risposte) {
  const corpi = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    corpi.push({ url: String(url), ...b });
    const r = typeof risposte[b.op] === 'function' ? risposte[b.op](b, corpi) : risposte[b.op];
    const [status, body] = r || [400, { ok: false, reason: 'malformed', detail: `op ${b.op}` }];
    return { status, ok: status < 300, text: async () => JSON.stringify(body) };
  };
  const out = []; const err = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => err.push(a.join(' '));
  t.after(() => { globalThis.fetch = prima; console.log = l; console.error = e; });
  return { corpi, out, err };
}
const CHIAVE = { env: { FILO_MANUTENTORE_KEY: 'chiave-di-prova' }, root: RADICE };

test('una priorità 3 non si abbassa: il rifiuto arriva prima del server, che non riceve la scrittura', async (t) => {
  assert.equal(M.controlloPriorita(3, 1).ok, false);
  assert.equal(M.controlloPriorita(3, 3).ok, true);
  assert.deepEqual(M.controlloPriorita(1, '2'), { ok: true, valore: 2 });
  assert.equal(M.controlloPriorita(1, 4).ok, false);
  const s = serverFinto(t, { schede: [200, { ok: true, schede: [schedaServer(812, 3)] }], priorita: [200, { ok: true, numero: '812', da: 3, a: 1 }] });
  assert.equal(await M.main(['priorita', '812', '1'], CHIAVE), 1);
  assert.match(s.err.join('\n'), /#812: una priorità 3 non si abbassa/);
  assert.deepEqual(s.corpi.map((c) => c.op), ['schede']);
  assert.match(s.corpi[0].url, /\/routineManutentore$/);
  assert.equal(s.corpi[0].passphrase, 'chiave-di-prova');
});

// #2291: con la priorità di adesso ignota (schede illeggibili, o il feedback non fra le schede) il controllo lasciava
// passare l'abbassamento, e una 3 scendeva a 1 senza l'owner.
test('priorità di adesso ignota: niente scrittura sotto la 3; alzare a 3 resta possibile', async (t) => {
  const s = serverFinto(t, { schede: [200, { ok: true, schede: [schedaServer(812, 2)] }], priorita: (b) => [200, { ok: true, numero: b.dati.numero, da: null, a: b.dati.priorita }] });
  assert.equal(await M.main(['priorita', '1994', '1'], CHIAVE), 1);
  assert.match(s.err.join('\n'), /#1994: non so la priorità di adesso/);
  assert.deepEqual(s.corpi.map((c) => c.op), ['schede']);
  assert.equal(await M.main(['priorita', '1994', '3'], CHIAVE), 0);
  assert.equal(await M.main(['priorita', '812', '1'], CHIAVE), 0);
  assert.deepEqual(s.corpi.filter((c) => c.op === 'priorita').map((c) => c.dati), [{ numero: '1994', priorita: 3 }, { numero: '812', priorita: 1 }]);
});

test('schede illeggibili: la priorità non scende alla cieca', async (t) => {
  const s = serverFinto(t, { schede: [500, { ok: false, errore: 'interno' }], priorita: [200, { ok: true, numero: '812', da: 3, a: 1 }] });
  assert.equal(await M.main(['priorita', '812', '1'], CHIAVE), 1);
  assert.ok(!s.corpi.some((c) => c.op === 'priorita'));
});

test('un feedback a priorità 3 non si archivia come doppione, se non di un\'altra 3; uno a 1 sì', async (t) => {
  const s = serverFinto(t, {
    schede: [200, { ok: true, schede: [schedaServer(812, 3), schedaServer(815, 1), schedaServer(700, 1), schedaServer(701, 3)] }],
    archivia: (b) => [200, { ok: true, numero: b.dati.numero, doppioneDi: b.dati.doppioneDi }],
  });
  assert.equal(await M.main(['archivia', '812', '700'], CHIAVE), 1);
  assert.match(s.err.join('\n'), /#812: un feedback a priorità 3 non si archivia/);
  assert.equal(await M.main(['archivia', '815', '700'], CHIAVE), 0);
  assert.equal(await M.main(['archivia', '812', '701'], CHIAVE), 0, 'la 3 resta aperta nell\'originale');
  assert.deepEqual(s.corpi.filter((c) => c.op === 'archivia').map((c) => c.dati), [{ numero: '815', doppioneDi: '700' }, { numero: '812', doppioneDi: '701' }]);
});

test('#2338: l5, l4, bilanci e passa chiamano le operazioni del server coi campi loro, e gli storti non partono', async (t) => {
  const s = serverFinto(t, {
    'l5.elenco': [200, { ok: true, richieste: [{ id: 'r1', numero: '#900', repo: 'server', ramo: 'worker/x', sha: 'a'.repeat(40), controlli: ['guard_the_guards'], file: ['functions/src/routine/deliver.js'], allOwner: ['.github/workflows/deploy.yml (le automazioni di filo-security)'] }], nonFidate: 2 }],
    'l5.approva': [200, { ok: true, numero: '#900', repo: 'app', result: 'merged' }],
    'l4.elenco': [200, { ok: true, bocciature: [{ num: '#901', sha: 'b'.repeat(40), titolo: 'Un titolo', motivo: 'Riga uno.\nRiga due.' }], soloFatti: [{ num: '#903', branch: 'worker/y', nonFidato: true }] }],
    'l4.salta': [200, { ok: true, numero: '901', esito: 'attesa_unit' }],
    bilanci: (b) => [200, { ok: true, bilanci: Object.assign({ cap3: 3, cap2: 1, cap1: 0, tettoVerifiche: 6 }, b.dati), ...(Object.keys(b.dati || {}).length ? { cambi: Object.keys(b.dati) } : {}) }],
    passa: [200, { ok: true, numero: '902', figli: ['#902.1'] }],
  });
  assert.equal(await M.main(['l5'], CHIAVE), 0);
  assert.equal(await M.main(['l5', 'approva', 'r1'], CHIAVE), 0);
  assert.equal(await M.main(['l4'], CHIAVE), 0);
  assert.equal(await M.main(['l4', 'salta', '901', 'b'.repeat(40)], CHIAVE), 0);
  assert.equal(await M.main(['bilanci'], CHIAVE), 0);
  assert.equal(await M.main(['bilanci', '--cap3', '4', '--tetto', '8'], CHIAVE), 0);
  assert.equal(await M.main(['passa', '902', 'resta', 'un', 'caso', 'raro'], CHIAVE), 0);
  assert.deepEqual(s.corpi.map((c) => [c.op, c.dati]), [
    ['l5.elenco', {}], ['l5.approva', { id: 'r1' }], ['l4.elenco', {}], ['l4.salta', { numero: '901', sha: 'b'.repeat(40) }],
    ['bilanci', {}], ['bilanci', { cap3: 4, tettoVerifiche: 8 }], ['passa', { numero: '902', testo: 'resta un caso raro' }],
  ]);
  const out = s.out.join('\n');
  assert.match(out, /r1 {2}#900 \(server\) aaaaaaaaaaaa worker\/x: guard_the_guards\n {4}functions\/src\/routine\/deliver\.js\n {4}resta all'owner: \.github/);
  assert.match(out, /\(2 su lavori non fidati o a catena sporca: restano all'owner\)/);
  assert.match(out, /#901 b{40} «Un titolo»\n {4}Riga uno\.\n {4}Riga due\./);
  // Una bocciatura con la nota di un controllo non fidato: il fatto soltanto, e decide l'owner.
  assert.match(out, /#903 worker\/y: bocciato, nota scritta da un controllo non fidato, decide l'owner/);
  assert.match(out, /Bilanci: 3 → 4, 2 → 1, 1 → 0; tetto totale delle verifiche 8\. Cambiati: cap3, tettoVerifiche \(scritto nel recap\)\./);
  assert.match(out, /#902 passa al controllo di sicurezza; quello che resta va in #902\.1\./);
  const n = s.corpi.length;
  assert.equal(await M.main(['l5', 'approva'], CHIAVE), 1);
  assert.equal(await M.main(['l4', 'salta', '901'], CHIAVE), 1);
  assert.equal(await M.main(['bilanci', '--tetto', 'tanti'], CHIAVE), 1);
  assert.equal(await M.main(['passa'], CHIAVE), 1);
  assert.equal(s.corpi.length, n);
});

test('i comandi scrivono le operazioni del server coi campi suoi', async (t) => {
  const s = serverFinto(t, {
    ordine: (b) => [200, { ok: true, ...b.dati, parallelismoEffettivo: 4 }],
    attesa: [200, { ok: true, numero: '815', aspetta: '812' }],
    sveglia: [200, { ok: true, sveglia: { alle: '2026-11-01T07:00:00.000Z' } }],
    account: [200, { ok: true, primo: 'B', spenti: { A: true, B: false } }],
    routine: [200, { ok: true, accese: false }],
  });
  assert.equal(await M.main(['accendi', '812,815'], CHIAVE), 0);
  assert.equal(await M.main(['parallelo', '4'], CHIAVE), 0);
  assert.equal(await M.main(['attesa', '815', '812'], CHIAVE), 0);
  assert.equal(await M.main(['sveglia-tra', '15', '--perche', 'il deploy'], CHIAVE), 0);
  assert.equal(await M.main(['account', 'A', 'spento'], CHIAVE), 0);
  assert.equal(await M.main(['account', 'primo', 'B'], CHIAVE), 0);
  assert.equal(await M.main(['routine', 'spente'], CHIAVE), 0);
  assert.deepEqual(s.corpi.map((c) => [c.op, c.dati]), [
    ['ordine', { ordine: ['812', '815'] }], ['ordine', { parallelismo: 4 }], ['attesa', { numero: '815', aspetta: '812' }],
    ['sveglia', { traMinuti: 15, perche: 'il deploy' }], ['account', { spegni: 'A' }], ['account', { primo: 'B' }], ['routine', { accese: false }],
  ]);
  // Gli storti non partono: niente chiamata.
  const n = s.corpi.length;
  assert.equal(await M.main(['sveglia-tra', '2'], CHIAVE), 1);
  assert.equal(await M.main(['parallelo', 'tanti'], CHIAVE), 1);
  assert.equal(await M.main(['taccuino', 'scrivi', '-'], CHIAVE), 1);
  assert.match(s.err.join('\n'), /--versione <V>/);
  assert.equal(s.corpi.length, n);
});

test('#2269: l\'ordine e le attese portano gli id dei compiti, e compito ne apre uno con le istruzioni da stdin', async (t) => {
  const s = serverFinto(t, {
    ordine: (b) => [200, { ok: true, ...b.dati, parallelismoEffettivo: 2, pronti: { pronti: ['812'], servono: 4 } }],
    attesa: [200, { ok: true, numero: '815', aspetta: 'C-12' }],
    compito: [200, { ok: true, compito: 'C-13', fiducia: 'non_fidato' }],
  });
  assert.equal(await M.main(['accendi', '812,c-12,815'], CHIAVE), 0);
  assert.match(s.out.join('\n'), /compito C-12.*\nORDINE CORTO: pronti 1, ne servono almeno 4/);
  assert.equal(await M.main(['attesa', '815', 'C-12'], CHIAVE), 0);
  assert.match(s.out.join('\n'), /#815 aspetta il compito C-12: parte quando il compito chiude\./);
  const { Readable } = await import('node:stream');
  const stdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { configurable: true, value: Object.assign(Readable.from([Buffer.from('Rivedi tutti gli hover.\n')]), { isTTY: false }) });
  t.after(() => Object.defineProperty(process, 'stdin', stdin));
  assert.equal(await M.main(['compito', 'Revisione', 'degli', 'hover', '-', '--urgenza', '30'], CHIAVE), 0);
  assert.deepEqual(s.corpi.map((c) => [c.op, c.dati]), [
    ['ordine', { ordine: ['812', 'C-12', '815'] }], ['attesa', { numero: '815', aspetta: 'C-12' }],
    ['compito', { titolo: 'Revisione degli hover', istruzioni: 'Rivedi tutti gli hover.', urgenza: 30 }],
  ]);
  assert.match(s.out.join('\n'), /Aperto il compito C-13 \(non_fidato\): mettilo nell'ordine/);
  // Gli storti non partono.
  const n = s.corpi.length;
  assert.equal(await M.main(['compito', 'x', '-', '--urgenza', 'alta'], CHIAVE), 1);
  assert.equal(await M.main(['compito', '-'], CHIAVE), 1);
  assert.equal(await M.main(['attesa', '815', 'C-0'], CHIAVE), 1);
  assert.equal(await M.main(['pacchetto', '812,C-12'], CHIAVE), 1, 'un compito non sta in un pacchetto');
  assert.equal(s.corpi.length, n);
});

test('senza chiave né biglietto del manutentore non si chiama il server, e si dice come averla', async (t) => {
  const s = serverFinto(t, {});
  assert.equal(await M.main(['stato'], { env: {}, root: cartellaTemporanea('manutentore-senza') }), 1);
  assert.match(s.err.join('\n'), /routine-keys\.mjs crea <nome> manutentore/);
  assert.equal(s.corpi.length, 0);
});

test('il giorno del contesto è quello italiano', () => {
  assert.match(M.giornoDi(Date.parse('2026-10-31T23:30:00Z')), /^2026-11-01$/);
});

test('indicazione con la chiave: la manda al server, che la accoda come quella dell\'owner, senza riscrivere il taccuino (#2340.3)', async (t) => {
  const s = serverFinto(t, { 'taccuino.indicazione': () => [200, { ok: true, versione: 5 }] });
  assert.equal(await M.main(['indicazione', 'meno', 'riallineamenti'], CHIAVE), 0);
  assert.deepEqual(s.corpi.map((c) => [c.op, c.dati]), [['taccuino.indicazione', { testo: 'meno riallineamenti' }]]);
  assert.match(s.out.join('\n'), /versione 5/);
  assert.equal('conIndicazione' in M, false, 'il formato dell\'indicazione non ha una copia nello strumento');
});

test('il redattore: una promessa su un lavoro che non è nell\'ordine né a 3 si rifiuta, come un link nuovo (#2269)', () => {
  const blocco = { version: '0.2.255', features: ['Le schede si trascinano. Guida su https://filo.app/guida'], fixes: ['Il menu si apre.'] };
  const schede = [schedaServer(812, 1), schedaServer(813, 0), schedaServer(900, 2), schedaServer(950, 3)];
  const ordine = ['813', 'C-4', '812'];
  const base = { versione: '0.2.255', features: [{ testo: 'Le schede si trascinano (guida su https://filo.app/guida).', da: [1] }], fixes: ['Il menu si apre.'] };
  assert.equal(M.controllaNovita(base, { blocco, schede, ordine }).ok, true);
  const fuori = M.controllaNovita({ ...base, features: [...base.features, 'Altri formati in arrivo.'], promesse: [{ numero: '900', riga: 'Altri formati in arrivo.' }] }, { blocco, schede, ordine });
  assert.equal(fuori.ok, false);
  assert.match(fuori.errori.join('\n'), /promessa su #900, che non è nell'ordine né a priorità 3/, 'una 2 fuori ordine non è più la rosa');
  const taciuta = M.controllaNovita({ ...base, features: [...base.features, 'Il supporto per i PDF è in arrivo.'] }, { blocco, schede, ordine });
  assert.match(taciuta.errori.join('\n'), /non dice da quali righe dei worker nasce/);
  for (const n of ['812', '813', '950']) {
    assert.equal(M.controllaNovita({ ...base, features: [...base.features, 'Altri formati in arrivo.'], promesse: [{ numero: n, riga: 'Altri formati in arrivo.' }] }, { blocco, schede, ordine }).ok, true, `#${n}`);
  }
  const link = M.controllaNovita({ ...base, fixes: ['Il menu si apre: vedi www.altro.example/x'] }, { blocco, schede, ordine });
  assert.match(link.errori.join('\n'), /link che le righe dei worker non avevano: www\.altro\.example\/x/);
  assert.match(M.controllaNovita({ ...base, versione: '0.2.254' }, { blocco, schede, ordine }).errori[0], /il blocco in cima è 0\.2\.255/);
  const ctx = M.contestoRedattore({ blocco, capacita: '• Trascinare', schede, ordine });
  assert.match(ctx, /## I lavori nell'ordine\n\n#813 .*\n#812 /, 'nella sequenza dell\'ordine');
  assert.match(ctx, /## Priorità 3 in corso\n\n#950 /);
  assert.doesNotMatch(ctx, /#900|rosa/);
});

test('il redattore: una riga tiene la segnalazione delle righe lette, e la consegna porta le impronte di quelle righe', async () => {
  const { impronta } = await import('../../scripts/release-novita.mjs');
  const blocco = { version: '0.2.255', features: [{ testo: 'Le novità in una pagina.', segnalazione: 1956 }, 'Il menu si apre.'], fixes: ['Download più veloci.'] };
  const base = { versione: '0.2.255', features: [{ testo: 'Tutte le novità in una pagina, e il menu si apre.', segnalazione: 1956, da: [1, 2] }], fixes: ['Download più veloci.'] };
  const buona = M.controllaNovita(base, { blocco, schede: [] });
  assert.equal(buona.ok, true, (buona.errori || []).join('\n'));
  assert.deepEqual(buona.novita.features, [{ testo: 'Tutte le novità in una pagina, e il menu si apre.', segnalazione: 1956 }]);
  assert.deepEqual(buona.novita.originali, ['Le novità in una pagina.', 'Il menu si apre.', 'Download più veloci.'].map(impronta));
  const estranea = M.controllaNovita({ ...base, features: [{ testo: 'Altro.', segnalazione: 42 }] }, { blocco, schede: [] });
  assert.match(estranea.errori.join('\n'), /la segnalazione 42 non sta fra le righe dei worker/);
  const senzaNumero = M.controllaNovita({ ...base, features: [{ testo: 'Altro.', segnalazione: 'tanti' }] }, { blocco, schede: [] });
  assert.match(senzaNumero.errori.join('\n'), /segnalazione è il numero intero/);
  assert.equal(M.controllaNovita({ ...base, features: [{ testo: '   ', segnalazione: 1956 }] }, { blocco, schede: [] }).ok, false);
  assert.match(M.contestoRedattore({ blocco, schede: [] }), /1\. \[segnalazione 1956\] Le novità in una pagina\./);
  // Dimenticata dal redattore, la segnalazione viene dalle righe d'origine (citate in da, o copiate uguali).
  const dimenticata = M.controllaNovita({ ...base, features: [{ testo: 'Novità e menu.', da: [1, 2] }, 'Le novità in una pagina.'] }, { blocco, schede: [] });
  assert.deepEqual(dimenticata.novita.features, [{ testo: 'Novità e menu.', segnalazione: 1956 }, { testo: 'Le novità in una pagina.', segnalazione: 1956 }]);
  const due = { version: '0.2.255', features: [{ testo: 'A.', segnalazione: 1956 }, { testo: 'B.', segnalazione: 1960 }], fixes: [] };
  // #2270: da righe con segnalazioni diverse la riga le tiene tutte, come la riga di un pacchetto.
  assert.deepEqual(M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A e B.', da: [1, 2] }] }, { blocco: due, schede: [] }).novita.features, [{ testo: 'A e B.', segnalazione: [1956, 1960] }]);
  assert.equal(M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A e B.', da: [1, 2], segnalazione: 1960 }] }, { blocco: due, schede: [] }).ok, true);
  const elenco = M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A e B.', da: [1, 2], segnalazione: [1956, 1960] }] }, { blocco: due, schede: [] });
  assert.deepEqual(elenco.novita.features, [{ testo: 'A e B.', segnalazione: [1956, 1960] }]);
  assert.match(M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A.', segnalazione: [1956, 42] }] }, { blocco: due, schede: [] }).errori.join('\n'), /la segnalazione 42 non sta/);
  assert.match(M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A.', segnalazione: [1956, 1956] }] }, { blocco: due, schede: [] }).errori.join('\n'), /l'elenco dei numeri/);
  assert.match(M.contestoRedattore({ blocco: { version: '0.2.255', features: [{ testo: 'A e B.', segnalazione: [1956, 1960] }], fixes: [] }, schede: [] }), /1\. \[segnalazioni 1956, 1960\] A e B\./);
});

test('il ruolo nomina solo sottocomandi che lo script accetta, e lo script li elenca tutti nel ruolo', () => {
  const nominati = [...RUOLO.matchAll(/npm run manutentore -- ([a-z0-9-]+)/g)].map((m) => m[1]);
  const fuori = nominati.filter((c) => !M.SOTTOCOMANDI.includes(c));
  assert.deepEqual([...new Set(fuori)], [], 'sottocomandi nel ruolo che lo script non conosce');
  const strumenti = RUOLO.slice(RUOLO.indexOf('## Gli strumenti'));
  const mancanti = M.SOTTOCOMANDI.filter((c) => !new RegExp(`(?:-- |\\| |\\b)${c}\\b`).test(strumenti));
  assert.deepEqual(mancanti, [], 'sottocomandi che il ruolo non dice');
});

test('la chat parte col file del contesto intero e dice dove vanno le indicazioni', () => {
  const m = M.primoMessaggioChat('/tmp/x/contesto.md');
  assert.match(m, /\/tmp\/x\/contesto\.md: leggilo tutto/);
  assert.match(m, /npm run manutentore -- indicazione/);
  assert.doesNotMatch(m, /"/, 'niente virgolette: su Windows passa da una shell');
});

// #1787: la spesa del manutentore dice anche quanto resta, le ultime 24 ore, le accensioni e se i freni sono spenti.
test('la spesa per account porta quanto resta, le ultime 24 ore e le accensioni; un numero mancante non compare', () => {
  const settimana = Date.parse('2026-10-27T17:00:00Z');
  const rinnovo = Date.parse('2026-11-03T17:00:00Z');
  const righe = M.righeSpesa({
    ok: true, freni: 'attivi',
    accounts: {
      B: { usdSettimana: 1620, pct: 81, limite: 80, settimanaDaMs: settimana, rinnovoAtMs: rinnovo, fermo: 'riserva', accensioni24h: 0 },
      A: { usdSettimana: 800, pct: 40, limite: 90, usd24h: 95, accensioniSettimana: 12, accensioni24h: 4, settimanaDaMs: settimana, rinnovoAtMs: rinnovo },
    },
  });
  assert.deepEqual(righe, [
    '- A: 800.00 $ dal 2026-10-27 17:00, 40% della quota, resta 50%, ultime 24 ore 95.00 $, accensioni: 12 in settimana, 4 nelle ultime 24 ore, rinnovo 2026-11-03 17:00.',
    '- B: 1620.00 $ dal 2026-10-27 17:00, 81% della quota, resta 0%, accensioni: 0 nelle ultime 24 ore, rinnovo 2026-11-03 17:00, fermo: riserva.',
  ]);
  const senzaFreni = M.righeSpesa({ ok: true, freni: 'numeri_assenti', accounts: { A: { usdSettimana: 5, pct: 1, usd24h: null, accensioniSettimana: null } } });
  assert.doesNotMatch(senzaFreni[0], /ultime 24 ore|accensioni|resta/);
  assert.match(senzaFreni[1], /non frenano: dosa tu sulla settimana/);
});

test('la decisione del mattino parte dal censimento delle schede e sa fare la prova a secco (#1786)', () => {
  const mattino = RUOLO.slice(RUOLO.indexOf('- **`mattino`**'), RUOLO.indexOf('- **gli altri motivi**'));
  const posti = ['npm run feedback:schede -- elenca', '`scrivi` (Haiku', '`rileggi` (Opus', 'npm run manutentore -- contesto']
    .map((p) => mattino.indexOf(p));
  assert.ok(posti.every((p) => p >= 0), `passi mancanti: ${posti}`);
  assert.deepEqual([...posti].sort((a, b) => a - b), posti, 'elenca, scrivi, rileggi, poi il contesto');
  assert.match(mattino, /tolgono lavoro/);
  assert.match(mattino.replace(/\s+/g, ' '), /a secco .*nel recap come proposta, senza applicarne nessuno/);
});

// Il censimento da zero dell'owner è chiuso (11/11): rilanciarlo riscriverebbe ore di schede già buone (#2403).
test('a un FERMO delle schede il mattino decide sui titoli e il --da-zero resta dell\'owner (#2181, #2403)', () => {
  const mattino = RUOLO.slice(RUOLO.indexOf('- **`mattino`**'), RUOLO.indexOf('- **gli altri motivi**')).replace(/\s+/g, ' ');
  assert.match(mattino, /Un FERMO di `stato` o `scrivi` .* si decide sui titoli/);
  assert.match(mattino, /riscriverle tutte \(`--da-zero`\) è una scelta dell'owner, non tua/);
  assert.doesNotMatch(mattino, /Una volta sola, deciso dall'owner|scrivi --da-zero`|censimento «in corso»/);
});

// La prova a secco è dell'intera giornata: un battito che riscrivesse ordine e N la renderebbe bagnata un'ora dopo.
test('l\'indicazione a secco vale per ogni accensione e la decisione a secco non la toglie (#1786)', () => {
  const inizio = RUOLO.indexOf('- **`mattino`**');
  const fine = RUOLO.indexOf('- **gli altri motivi**');
  const fuori = (RUOLO.slice(0, inizio) + RUOLO.slice(fine)).replace(/\s+/g, ' ');
  const regola = fuori.slice(fuori.indexOf('**A secco.**'));
  assert.ok(fuori.includes('**A secco.**'), 'la regola a secco fuori dalla voce del mattino');
  assert.match(regola, /ogni accensione finché sta nel taccuino, battiti e sveglie compresi/);
  for (const v of ['ordine', 'N', 'priorità', 'pacchetti', 'attese', 'accensioni', 'sblocchi']) assert.ok(regola.includes(v), v);
  assert.match(regola, /lascia l'indicazione al suo posto/);
  assert.doesNotMatch(RUOLO.replace(/\s+/g, ' '), /togli l'indicazione dal taccuino/);
  const spec = readFileSync(risolvi(RADICE, 'SPEC-MANUTENTORE.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(spec, /censimento delle schede parte da lui/);
  assert.match(spec, /\*\*A secco\.\*\*.*nessuna accensione \(mattino, battito, sveglia\) cambia il lavoro/);
});

// Il 06/11 la rosa scritta solo al mattino si è svuotata a metà giornata: quattordici ore di quota ferma (#2261). Dal
// #2269 non c'è più la rosa: l'ordine è l'unica condizione, e a ogni accensione ha almeno 2×N lavori pronti.
test('a ogni battito e sveglia l\'ordine ha almeno 2×N lavori pronti, la classe è un criterio, niente rosa (#2269)', () => {
  const piatto = (t) => t.replace(/\s+/g, ' ');
  const ruolo = piatto(RUOLO);
  const ritmo = piatto(RUOLO.slice(RUOLO.indexOf('## Il ritmo'), RUOLO.indexOf('## La sessione accesa dal pacemaker')));
  const regola = ritmo.slice(ritmo.indexOf('**L\'ordine non resta mai corto.**'));
  assert.ok(ritmo.includes('**L\'ordine non resta mai corto.**'), 'la regola sta nel ritmo, fuori dalla voce del mattino');
  assert.match(regola, /A ogni battito e sveglia l'ordine contiene almeno \*\*2×N\*\* lavori che possono partire subito: quelli in attesa, fermi, che restano locali o in mano all'owner non contano/);
  assert.match(regola, /La spesa si regola con N, non svuotando l'ordine/);
  for (const r of ['decisione incrementale', 'scala delle classi', 'classe ereditata da chi blocca', 'incroci coi rami vivi', 'riscrivi l\'ordine', 'taccuino', 'recap del giorno dopo']) {
    assert.ok(regola.includes(r), r);
  }
  assert.match(regola, /In una giornata a secco no\./);
  // L'ordine è l'unica condizione per cominciare, e nessuna 2 da scegliere ogni mattina.
  assert.match(ruolo, /\*\*L'ordine è l'unica condizione per cominciare\.\*\* Un primo lavoro nell'ordine parte a qualunque priorità da 0 a 2; fuori dall'ordine parte solo una 3/);
  assert.doesNotMatch(ruolo.replace(/\*\*Una volta sola\*\* \(#2269[^]*?contano come importanti\./, ''), /\b(la|una|nella|della|alla) rosa\b/i,
    'la rosa resta nominata solo per dire che non c\'è più e per toglierla dal taccuino');
  assert.doesNotMatch(ruolo, /la 2 è solo tua|Scrivi la rosa|priorità 3 e 2/);
  // La classe è il primo criterio, non un filtro.
  const ordine = piatto(RUOLO.slice(RUOLO.indexOf('## Le regole dell\'ordine'), RUOLO.indexOf('## Guasti')));
  assert.match(ordine, /\*\*La classe è il primo criterio, non un filtro\.\*\*.*tocca i file probabili di un ramo vivo \(`incroci <N>`\) aspetta.*entra uno di classe più bassa in un'area libera/);
  assert.match(ordine, /Un compito può stare davanti a un feedback/);
  assert.match(ordine, /\*\*Un lavoro già iniziato non si mette in attesa di un lavoro non iniziato\*\*: lo tieni nell'ordine, sopra i primi lavori che deve precedere/);
  // Con un ordine decide il posto, iniziati o nuovi (#2411): il ruolo dice la sequenza del server.
  assert.match(ordine, /prima le 3 e le risposte dell'owner, poi l'ordine, poi i lavori già iniziati fuori dall'ordine, poi il resto per urgenza/);
  assert.match(ordine, /primi lavori o già iniziati \(verifica, correzione, controllo\), vanno nella sua sequenza, a qualunque priorità; i lavori già iniziati fuori dall'ordine vengono dopo l'ordine/);
  assert.match(ordine, /\*\*Compiti nell'ordine\.\*\*.*`compito "<titolo>" -`.*\(`C-12`\).*`attesa <N> C-12`.*si scioglie quando il compito chiude/);
  // Il primo mattino toglie dal taccuino le regole sulla rosa.
  assert.match(ruolo, /\*\*Una volta sola\*\* \(#2269, la rosa non c'è più\): al primo mattino il cui taccuino parla ancora della rosa, togli dal taccuino le sue regole/);
  // I rilievi messi da parte nascono a 1.
  assert.match(ruolo, /Un interno messo da parte nasce a 1, a ogni livello: se serve, lo metti tu nell'ordine/);
  const spec = piatto(readFileSync(risolvi(RADICE, 'SPEC-MANUTENTORE.md'), 'utf8'));
  const quattro = spec.slice(spec.indexOf('## 4. Ritmo'), spec.indexOf('## 5.'));
  assert.match(quattro, /\*\*L'ordine non resta mai corto\.\*\* A ogni battito e sveglia l'ordine contiene almeno 2×N lavori che possono partire subito/);
  assert.match(quattro, /La classe è il primo criterio, non un filtro/);
  assert.match(spec, /\*\*L'ordine è l'unica condizione per cominciare\*\* \(#2269\)/);
  assert.doesNotMatch(spec, /la rosa \(priorità 2\)|promuove la rosa|aspettano una prossima rosa/);
});

// Il segno «lavoro server» non aspetta l'owner (#2269 punto 6): neanche lo strumento lo deve far chiedere a lui.
test('un segno «lavoro server» non confermato non si chiede all\'owner: un fidato entra nell\'ordine lo stesso (#2269)', () => {
  const riga = M.rigaSegnoServer(true, { ok: true, numero: '900' });
  assert.match(riga, /^SEGNO NON MESSO/);
  assert.match(riga, /non chiedere il segno all'owner/);
  assert.match(riga, /mettilo nell'ordine lo stesso: il primo giro consegna «design --reason locale» e il server lo segna da sé/);
  assert.doesNotMatch(riga, /chiedi all'owner/);
});

// Il segno lo mette il server alla consegna design + locale: aspettarlo dall'owner tiene fuori un fidato per giorni (#2261).
test('un fidato che tocca il server entra nell\'ordine senza il segno, e il segno non è una cosa dell\'owner (#2261)', () => {
  const ordine = RUOLO.slice(RUOLO.indexOf('## Le regole dell\'ordine'), RUOLO.indexOf('## Guasti')).replace(/\s+/g, ' ');
  const regola = ordine.slice(ordine.indexOf('**Il segno «lavoro server» non serve per entrare.**'));
  assert.ok(ordine.includes('**Il segno «lavoro server» non serve per entrare.**'), 'la regola sta fra quelle dell\'ordine');
  assert.match(regola, /Un feedback fidato che secondo te tocca il server entra nell'ordine anche senza il segno/);
  assert.match(regola, /consegna `design --reason locale`, e il server gli mette il segno da sé e lo passa ai lavori server/);
  assert.match(regola, /non va fra le sue cose da fare, né nel recap né nelle domande/);
  assert.match(regola, /«Segna fidato» per i non fidati/);
  assert.match(regola, /sbagliato lo scrivi nel recap come informazione/);
  const piatto = RUOLO.replace(/\s+/g, ' ');
  assert.doesNotMatch(piatto, /(chiedi|chiedere|domanda)[^.]*all'owner[^.]*segno «lavoro server»/);
  assert.doesNotMatch(piatto, /segno «lavoro server»[^.]*(lo mette|lo chiedi a|aspetta) l'owner/);
});

test('lo stato elenca le corse in coda senza lavori: repository, workflow, sha, da quanto e chi le aspetta (#2417)', () => {
  const corseFerme = {
    sogliaMin: 20,
    corse: [
      { repo: 'server', workflow: 'suite.yml', sha: 'd2e2bd6'.padEnd(40, '0'), id: 43097094859, minuti: 37, feedback: '2258', url: 'https://github.com/x/actions/runs/43097094859' },
      { repo: 'app', workflow: 'verifica-linux.yml', sha: 'f'.repeat(40), id: 43097090341, minuti: 41, feedback: '', url: '' },
    ],
    errori: ['app corsa 9: lavori illeggibili (github_502)'],
  };
  const righe = M.righeStato({ ...STATO, corseFerme });
  const da = righe.indexOf('Corse in coda senza lavori da più di 20 minuti (2):');
  assert.ok(da > 0, righe.join('\n'));
  assert.deepEqual(righe.slice(da + 1), [
    '- server suite.yml d2e2bd600000 corsa 43097094859, in coda da 37 min, la aspetta #2258 https://github.com/x/actions/runs/43097094859',
    '- app verifica-linux.yml ffffffffffff corsa 43097090341, in coda da 41 min, nessun feedback la aspetta',
    '- non lette: app corsa 9: lavori illeggibili (github_502)',
  ]);
  assert.ok(M.righeStato({ ...STATO, corseFerme: { sogliaMin: 20, corse: [], errori: [] } }).includes('Corse in coda senza lavori da più di 20 minuti (0):'));
  assert.ok(M.righeStato(STATO).includes('Corse in coda senza lavori: il server non le elenca ancora.'), 'un server vecchio non si scambia per nessuna corsa ferma');
  // Un campo con un a capo non apre una sezione nel contesto.
  const sporco = M.righeCorseFerme({ sogliaMin: 20, corse: [{ repo: 'app\n## Spesa', workflow: 'x', sha: '', id: 1, minuti: 30, feedback: '' }], errori: [] });
  assert.ok(sporco.every((r) => !r.includes('\n')));
  assert.match(M.testoPiccolo({ ruolo: RUOLO, stato: { ...STATO, corseFerme }, taccuino: { testo: '', versione: 0 }, schede: [] }).testo || '', /la aspetta #2258/);
});

// #2340, decisione dell'owner dell'08/11: lavori server in parallelo, battito a 2 ore, contesto e taccuino a pezzi.
test('i lavori server non vanno più uno alla volta: si decide sui file in comune fra i rami (#2340)', () => {
  const ordine = RUOLO.slice(RUOLO.indexOf('## Le regole dell\'ordine'), RUOLO.indexOf('## Guasti')).replace(/\s+/g, ' ');
  assert.doesNotMatch(ordine, /alla volta/);
  assert.match(ordine, /quanti lavori del server tenere aperti insieme lo decidi tu caso per caso, guardando i file in comune fra i loro rami \(`incroci` senza numero\)/);
  assert.match(ordine, /`rami` e `incroci` leggono anche i rami di filo-security/);
});

test('battito a 2 ore, contesto piccolo per differenze e taccuino aggiornato a sezioni, nel ruolo e nelle spec (#2340)', () => {
  const testi = { ruolo: RUOLO, spec: readFileSync(risolvi(RADICE, 'SPEC-MANUTENTORE.md'), 'utf8'),
    stati: readFileSync(risolvi(RADICE, 'FEEDBACK-STATES.md'), 'utf8'), domande: readFileSync(risolvi(RADICE, 'SPEC-DOMANDE.md'), 'utf8') };
  for (const [nome, t] of Object.entries(testi)) assert.doesNotMatch(t.replace(/\s+/g, ' '), /ogni 55 minuti/, nome);
  const ruolo = RUOLO.replace(/\s+/g, ' ');
  assert.match(ruolo, /al \*\*battito\*\*, ogni 2 ore al più/);
  assert.match(ruolo, /Il contesto piccolo porta solo quello che è cambiato dall'accensione prima/);
  assert.match(ruolo, /Porta tutto alla prima accensione del giorno e dopo un'accensione nata morta/);
  assert.match(ruolo, /`taccuino sezione <nome> - --versione <V>`/);
  assert.doesNotMatch(ruolo, /riscrivi il taccuino intero|Il taccuino riscritto, intero/);
  // L'indicazione dell'owner arriva in coda: la sezione delle indicazioni è l'ultima, o finirebbe nelle misure.
  const sezioni = [...RUOLO.matchAll(/^- `## ([a-z]+)`/gm)].map((m) => m[1]);
  assert.deepEqual(sezioni, ['stato', 'problemi', 'esperimenti', 'misure', 'indicazioni']);
  const spec = testi.spec.replace(/\s+/g, ' ');
  assert.match(spec, /L'operazione `taccuino\.sezione` \(`sezione`, `testo`, `versione`\) riscrive il corpo di una sola sezione e lascia il resto del taccuino identico byte per byte/);
  assert.match(spec, /battito\*\* ogni due ore al massimo/);
});

test('stato mostra le pause di ogni voce e il perché dell’ultimo giro, e un server vecchio non sembra «nessuna pausa» (#2488)', () => {
  const fino = Date.parse('2026-11-14T15:24:00Z');
  const pause = { serverB: { finoMs: fino, perche: 'dead_round', dettaglio: '', strikes: 1, account: 'B', oggi: 3 } };
  const voci = {
    normale: { perche: 'accounts_paused', percheMs: Date.parse('2026-11-14T14:04:00Z') },
    server: { perche: 'server_paused', percheMs: Date.parse('2026-11-14T12:35:00Z') },
    reteAperta: { perche: '', percheMs: 0 },
    riservati: { perche: 'no_riservati_work', percheMs: Date.parse('2026-11-14T10:00:00Z') },
  };
  const righe = M.righeStato({ ...STATO, pause, voci });
  const da = righe.indexOf('Pause in corso (1):');
  assert.ok(da > 0, righe.join('\n'));
  assert.equal(righe[da + 1], '- serverB fino a 2026-11-14T15:24:00.000Z, perché dead_round, fallimenti di fila 1');
  assert.equal(righe[da + 2], 'Ultimo giro per voce: normale accounts_paused dal 2026-11-14T14:04:00.000Z; '
    + 'server server_paused dal 2026-11-14T12:35:00.000Z; riservati no_riservati_work dal 2026-11-14T10:00:00.000Z.');
  assert.ok(M.righeStato({ ...STATO, pause: {}, voci: {} }).includes('Pause in corso (0):'));
  assert.ok(M.righeStato({ ...STATO, pause: null, voci: null }).includes('Pause in corso (stato del pacemaker non letto):'));
  assert.ok(M.righeStato(STATO).includes('Pause delle voci: il server non le elenca ancora.'));
  // Il messaggio di claude.ai di un rifiuto arriva in una riga sola: un a capo non apre una sezione nel contesto.
  const sporco = M.righePause({ A: { finoMs: fino, perche: 'rejected_429', dettaglio: 'limite\n## Spesa', strikes: 2 } }, {});
  assert.ok(sporco.every((r) => !r.includes('\n')));
  assert.match(sporco[1], /^- A fino a .*perché rejected_429, fallimenti di fila 2: limite ## Spesa$/);
  assert.match(M.testoPiccolo({ ruolo: RUOLO, stato: { ...STATO, pause, voci }, taccuino: { testo: '', versione: 0 }, schede: [] }).testo || '', /serverB fino a/);
  assert.match(RUOLO.replace(/\s+/g, ' '), /accensione nata morta di qualunque voce/);
});

test('#2768: ordine e stato dicono perché ogni voce dell’ordine non parte, come lo scrive il pacemaker', () => {
  const atMs = Date.parse('2026-11-28T11:36:00Z');
  const attese = { atMs, oltre: 0, generale: '', voci: [
    { numero: '2555', motivo: 'è pronto, ma il parallelismo del manutentore è pieno' },
    { numero: '2756', motivo: 'è pronto, ma il pacemaker lascia i posti liberi a 1 lavoro normale che viene prima nella sequenza dell’ordine (#2555)' },
  ] };
  assert.deepEqual(M.righeAttese(attese), [
    'Perché non partono (dal giro delle 2026-11-28T11:36:00.000Z):',
    '- #2555 è pronto, ma il parallelismo del manutentore è pieno',
    '- #2756 è pronto, ma il pacemaker lascia i posti liberi a 1 lavoro normale che viene prima nella sequenza dell’ordine (#2555)',
  ]);
  assert.match(M.righeAttese(Object.assign({}, attese, { oltre: 4 })).at(-1), /^- e altre 4 voci, oltre le prime 2$/);
  assert.deepEqual(M.righeAttese({ atMs, voci: [], oltre: 0, generale: 'nessuna voce ha letto la coda in questo giro: la normale perché le sessioni sono al tetto dell’owner' }),
    ['Perché non partono (dal giro delle 2026-11-28T11:36:00.000Z): nessuna voce ha letto la coda in questo giro: la normale perché le sessioni sono al tetto dell’owner.']);
  assert.match(M.righeAttese({ atMs, voci: [], oltre: 0, generale: '' })[0], /niente, ogni voce aperta dell'ordine è al lavoro o accesa/);
  assert.match(M.righeAttese(null)[0], /il pacemaker non l'ha ancora scritto/);
  assert.match(M.righeAttese(undefined)[0], /il server non lo dice ancora/, 'un server vecchio non si scambia per nessun fermo');
  // Un motivo su più righe resta una riga: un a capo non apre una sezione nel contesto.
  assert.equal(M.righeAttese({ atMs, voci: [{ numero: '1', motivo: 'a\n## b' }] })[1], '- #1 a ## b');
  const righe = M.righeStato({ ...STATO, attese });
  assert.ok(righe.includes('- #2555 è pronto, ma il parallelismo del manutentore è pieno'), righe.join('\n'));
  assert.ok(!M.righeStato({ ...STATO, ordine: [], attese }).some((r) => r.startsWith('Perché non partono')), 'senza ordine non c’è niente da dire');
});
