// Il manutentore dal terminale (SPEC-MANUTENTORE.md): contesto intero e piccolo, i rami coi loro file e gli incroci, i
// corpi verso il suo endpoint, il redattore delle novità. Niente modello; la rete è finta (fetch sostituito).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const M = await import('../../scripts/manutentore.mjs');
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
  assert.match(M.rigaOrdine(['700'], indice), /Nessuno è fra gli aperti: il server fa come senza ordine/);
  assert.match(M.rigaOrdine(['700'], []), /Senza l'indice delle schede non so quali sono ancora aperti/);
  assert.match(M.rigaOrdine([], indice), /Nessun ordine/);
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
  assert.equal(await M.main(['incroci', '12', '--cartella', dir, '--senza-fetch'], { root: repo }), 0);
  assert.match(out.join('\n'), /^claude\/lavoro \(#44\): src\/a\.js$/m);
  assert.equal(await M.main(['incroci', '#13', '--cartella', dir, '--senza-fetch'], { root: repo }), 0);
  assert.match(out.join('\n'), /Nessun ramo in corso tocca i file probabili di #13 \(non\/esiste\.js\)/);
  assert.equal(await M.main(['incroci', '99', '--cartella', dir, '--senza-fetch'], { root: repo }), 1);
  assert.match(err.join('\n'), /Nessuna scheda per #99/);
  assert.equal(await M.main(['boh']), 1);
});

test('l\'ordine da accendere: numeri nell\'ordine dato, senza doppioni, col rifiuto detto', () => {
  assert.deepEqual(M.leggiOrdine('812, #815,815.2 812'), { ok: true, numeri: ['812', '815', '815.2'] });
  assert.match(M.leggiOrdine('812,menu').motivo, /non sono numeri di feedback: menu/);
  assert.equal(M.leggiOrdine('').ok, false);
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

// ── SPEC-MANUTENTORE: il canale della chiave, il contesto piccolo e intero, le indicazioni, il redattore ──

import { readFileSync } from 'node:fs';
import { dirname, resolve as risolvi } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = risolvi(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
const STATO = { ordine: ['4'], parallelismo: 3, parallelismoEffettivo: 3, freno: 20, segnali: [{ id: 's1', tipo: 'guasto', atMs: 0, dettaglio: { numero: '29' } }], account: { primo: 'B', spenti: {}, esclusiDallOwner: {} } };

// #2269: decide l'ordine, non la priorità 2. Le 25 a 2 qui sotto stanno fuori dall'ordine e non entrano.
test('contesto piccolo: con 800 schede porta le 3, i lavori dell\'ordine nella sua sequenza e le ferme, sotto il tetto', () => {
  const stato = { ...STATO, ordine: ['700', '41', '4', '29'] };
  const p = M.testoPiccolo({ ruolo: RUOLO, stato, taccuino: { testo: 'criterio: grafica prima', versione: 4 }, schede: ottocento(),
    rami: [{ ramo: 'worker/x', feedback: ['700'], avanti: 2, data: '2026-10-31', file: ['a.js'] }, { ramo: 'worker/y', feedback: ['5'], avanti: 1, data: '2026-10-31', file: ['b.js'] }] });
  assert.equal(p.ok, true);
  assert.ok(p.token < M.PICCOLO_TETTO_TOKEN, `${p.token} token`);
  assert.match(p.testo, /Schede: le priorità 3, l'ordine nella sua sequenza, le ferme \(8 di 800\)/);
  assert.match(p.testo, /Ordine da accendere \(4\): #700 \(todo\), #41 \(todo\), #4 \(todo\), #29 \(todo\)/);
  const righe = p.testo.split('\n').filter((r) => /^#\d+ · p/.test(r)).map((r) => r.split(' ')[0]);
  assert.deepEqual(righe, ['#1', '#2', '#3', '#700', '#41', '#4', '#29', '#30'], 'le 3, poi l\'ordine com\'è scritto, poi le ferme rimaste');
  assert.match(p.testo, /^#700 · p0 · todo/m, 'una 0 nell\'ordine entra');
  assert.match(p.testo, /^#29 · p1 · todo · FERMO \(guasto: guasto: npm\)/m);
  assert.match(p.testo, /criterio: grafica prima/);
  assert.match(p.testo, /Versione 4/);
  assert.match(p.testo, /s1 guasto/);
  assert.match(p.testo, /^worker\/x/m);
  assert.doesNotMatch(p.testo, /worker\/y/, 'una 2 fuori dall\'ordine non porta il suo ramo');
});

test('contesto piccolo oltre il tetto: rifiutato col numero, non tagliato', () => {
  const lunghe = ottocento().map((s) => ({ ...s, titolo: s.titolo.repeat(3) }));
  const stato = { ...STATO, ordine: lunghe.map((s) => s.num) };
  const p = M.testoPiccolo({ ruolo: RUOLO, stato, taccuino: { testo: '', versione: 0 }, schede: lunghe });
  assert.equal(p.ok, false);
  assert.match(p.motivo, new RegExp(`stima ${p.token} token, il tetto è ${M.PICCOLO_TETTO_TOKEN}: pesa di più le 800 schede delle 3, dell'ordine e delle ferme \\(\\d+ token\\)\\. Togli dall'ordine i lavori che non partiranno presto \\(bastano 2×N pronti\\)`));
  // Un taccuino lungo con una scheda sola: il rimedio è il taccuino, non accorciare l'ordine.
  const lungo = M.testoPiccolo({ ruolo: RUOLO, stato: STATO, taccuino: { testo: 'appunto '.repeat(16000), versione: 3 }, schede: [lunghe[0]] });
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

test('senza chiave né biglietto del manutentore non si chiama il server, e si dice come averla', async (t) => {
  const s = serverFinto(t, {});
  assert.equal(await M.main(['stato'], { env: {}, root: cartellaTemporanea('manutentore-senza') }), 1);
  assert.match(s.err.join('\n'), /routine-keys\.mjs crea <nome> manutentore/);
  assert.equal(s.corpi.length, 0);
});

test('l\'indicazione dell\'owner va in coda al taccuino con la data, senza perdere il resto', () => {
  const r = M.conIndicazione('stato: N 4\n\nproblemi: nessuno\n\n', '  priorità a ciò che\ncambia la grafica ', '2026-10-31');
  assert.equal(r.testo, 'stato: N 4\n\nproblemi: nessuno\n\nIndicazione dell\'owner (2026-10-31): priorità a ciò che cambia la grafica\n');
  assert.equal(M.conIndicazione('', 'prima', '2026-10-31').testo, 'Indicazione dell\'owner (2026-10-31): prima\n');
  assert.equal(M.conIndicazione('x', '   ').ok, false);
  assert.match(M.giornoDi(Date.parse('2026-10-31T23:30:00Z')), /^2026-11-01$/, 'il giorno è quello italiano');
});

test('indicazione con la chiave: se il taccuino cambia in mezzo lo rilegge e riscrive, con la versione letta', async (t) => {
  let versione = 3;
  const s = serverFinto(t, {
    taccuino: () => [200, { ok: true, testo: `voce ${versione}`, versione }],
    'taccuino.scrivi': (b) => {
      if (b.dati.versione === 3) { versione = 4; return [409, { ok: false, reason: 'taccuino_cambiato', detail: 'alla 4' }]; }
      return [200, { ok: true, versione: 5 }];
    },
  });
  assert.equal(await M.main(['indicazione', 'meno', 'riallineamenti'], CHIAVE), 0);
  const scritture = s.corpi.filter((c) => c.op === 'taccuino.scrivi');
  assert.equal(scritture.length, 2);
  assert.equal(scritture[1].dati.versione, 4);
  assert.match(scritture[1].dati.testo, /^voce 4\n\nIndicazione dell'owner \(\d{4}-\d{2}-\d{2}\): meno riallineamenti\n$/);
});

test('il redattore: una promessa su un lavoro che non è nell\'ordine né a 3 si rifiuta, come un link nuovo (#2269)', () => {
  const blocco = { version: '0.2.255', features: ['Le schede si trascinano. Guida su https://filo.app/guida'], fixes: ['Il menu si apre.'] };
  // #900 è a 2 ma fuori dall'ordine: non parte, e su di lei non si promette.
  const schede = [schedaServer(812, 1), schedaServer(813, 0), schedaServer(900, 2), schedaServer(950, 3)];
  const ordine = ['813', '812'];
  const base = { versione: '0.2.255', features: [{ testo: 'Le schede si trascinano (guida su https://filo.app/guida).', da: [1] }], fixes: ['Il menu si apre.'] };
  assert.equal(M.controllaNovita(base, { blocco, schede, ordine }).ok, true);
  const fuoriOrdine = M.controllaNovita({ ...base, features: [...base.features, 'Altri formati in arrivo.'], promesse: [{ numero: '900', riga: 'Altri formati in arrivo.' }] }, { blocco, schede, ordine });
  assert.equal(fuoriOrdine.ok, false);
  assert.match(fuoriOrdine.errori.join('\n'), /promessa su #900, che non è nell'ordine né a priorità 3/);
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
  assert.doesNotMatch(ctx, /#900/);
  assert.doesNotMatch(ctx, /rosa/i);
  assert.match(M.contestoRedattore({ blocco, schede }), /## I lavori nell'ordine\n\n\(nessuno\)/);
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
  assert.match(M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A e B.', da: [1, 2] }] }, { blocco: due, schede: [] }).errori.join('\n'), /segnalazioni diverse \(1956, 1960\)/);
  assert.equal(M.controllaNovita({ versione: '0.2.255', features: [{ testo: 'A e B.', da: [1, 2], segnalazione: 1960 }] }, { blocco: due, schede: [] }).ok, true);
});

test('il ruolo nomina solo sottocomandi che lo script accetta, e lo script li elenca tutti nel ruolo', () => {
  const nominati = [...RUOLO.matchAll(/npm run manutentore -- ([a-z-]+)/g)].map((m) => m[1]);
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

// Va tolta insieme alla frase del ruolo, dal feedback che il manutentore apre dopo il censimento da zero.
test('il censimento da zero deciso dall\'owner si lancia una volta sola, al FERMO, e poi si toglie (#2181)', () => {
  const mattino = RUOLO.slice(RUOLO.indexOf('- **`mattino`**'), RUOLO.indexOf('- **gli altri motivi**')).replace(/\s+/g, ' ');
  const frase = mattino.slice(mattino.indexOf('**Una volta sola, deciso dall\'owner**'), mattino.indexOf('npm run manutentore -- contesto'));
  assert.ok(frase.startsWith('**Una volta sola'), 'la frase una tantum sta nel mattino, prima del contesto');
  assert.match(frase, /col FERMO, o col censimento «in corso» nel taccuino/);
  assert.ok(frase.indexOf('`scrivi --da-zero`') < frase.indexOf('`rileggi`'), 'prima la scrittura da zero, poi la rilettura');
  // Dura ore e il sottofondo si ferma a due: segnarlo fatto al lancio lascerebbe il censimento a metà per sempre.
  assert.match(frase, /lo rilanci uguale/, 'un giro interrotto si rilancia');
  assert.match(frase, /lascia nel taccuino il censimento «in corso», che il mattino dopo riprende anche senza FERMO/);
  assert.match(frase, /Solo a censimento finito scrivi il giorno nel taccuino e apri un feedback che toglie dal ruolo questa frase/);
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
