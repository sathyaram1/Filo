// Il verdetto non decade per le prove del giro TOLTE (#661).
//
// PERCHÉ CONTA
//   Il cancello di `npm run finish` lega il verdetto a un commit: se la punta
//   si muove, il verdetto decade. Giusto — tranne per l'unico commit che chi
//   verifica DEVE fare dopo il verdetto: quello che TOGLIE dalle prove del giro
//   (file interi o casi) i rilievi diventati un feedback loro. Due volte (10/09
//   e 18/09, #629) quel commit è costato un giro intero per un ramo in cui non
//   era cambiata una riga di prodotto. La regola è la stessa del cancello di
//   fusione del server: dopo il verdetto si toglie e basta.
//
//   Qui si inchioda il confine, e il pericolo è tutto da una parte: se questa
//   logica sbaglia in senso permissivo, una riga di codice vera entra nel ramo
//   dopo che l'ha vista l'ultima persona che doveva vederla. Quindi la prova
//   che conta di più è quella dei casi che devono FAR DECADERE il verdetto — e
//   una prova AGGIUNTA è uno di quelli: lì c'è roba da girare che nessuno ha
//   ancora provato.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const {
  checkVerdict, soloRigheTolte, soloProveTolte, dentroProveGiro,
  diffDopoLaVerifica, verdictForCurrentBranch, writeState, testoProveDaCancellare,
  vociNameStatus,
} = await import('../../scripts/verify-local.mjs');

const SHA = 'a'.repeat(40);
const ALTRO_SHA = 'b'.repeat(40);

const PROVA = `// Prova del giro 4.
import { test, expect } from '@playwright/test';

test('il riquadro dice da dove arrivano i crediti', async () => {
  const riga = await riquadro();
  expect(riga).toContain('crediti di Filo');
});
`;

/** La stessa prova, col rosso atteso segnato e il perché scritto accanto. */
const PROVA_SEGNATA = `// Prova del giro 4.
import { test, expect } from '@playwright/test';

test('il riquadro dice da dove arrivano i crediti', async () => {
  // Rilievo di livello 1 messo da parte: il riquadro non lo dice.
  test.fail(true, 'rilievo di livello 1 messo da parte: nel riquadro la riga non c’è');
  const riga = await riquadro();
  expect(riga).toContain('crediti di Filo');
});
`;

/** La stessa prova con un secondo caso: quello che dopo il verdetto si toglie. */
const PROVA_DUE_CASI = `${PROVA}
test('il secondo caso, del rilievo messo da parte', async () => {
  expect(await riquadro()).toContain('fonte');
});
`;

// ─── la sola sottrazione ────────────────────────────────────────────────────

test('soloRigheTolte: un caso tolto, o righe tolte qua e là, è solo sottrazione', () => {
  assert.equal(soloRigheTolte(PROVA_DUE_CASI, PROVA), true);
  assert.equal(soloRigheTolte(PROVA, PROVA.replace('// Prova del giro 4.\n', '')), true);
  assert.equal(soloRigheTolte(PROVA, PROVA), true);
  // Sulla macchina dell'owner i file stanno su Windows: un ritorno a capo in
  // più non è una riga cambiata.
  assert.equal(soloRigheTolte(PROVA_DUE_CASI.replace(/\n/g, '\r\n'), PROVA), true);
});

test('soloRigheTolte: un marcatore, un commento, una riga cambiata o spostata non sono sottrazione', () => {
  assert.equal(soloRigheTolte(PROVA, PROVA_SEGNATA), false, 'il rosso atteso aggiunge righe: va nel commit di una correzione');
  assert.equal(soloRigheTolte(PROVA, PROVA.replace("test('il riquadro", "test.fail('il riquadro")), false);
  assert.equal(soloRigheTolte(PROVA, PROVA.replace('  const riga', '  // un commento\n  const riga')), false);
  assert.equal(soloRigheTolte(PROVA, PROVA.replace("toContain('crediti di Filo')", "toContain('')")), false);
  assert.equal(soloRigheTolte(PROVA, PROVA.replace('  expect(riga)', '  // expect(riga)')), false, 'una riga spenta è una riga cambiata');
  const righe = PROVA.split('\n');
  const scambiate = [...righe.slice(0, 4), righe[5], righe[4], ...righe.slice(6)].join('\n');
  assert.equal(soloRigheTolte(PROVA, scambiate), false, 'riordinare non è togliere');
  // Vuoto da una parte o dall'altra: un file svuotato si cancella, uno illeggibile non passa.
  assert.equal(soloRigheTolte(PROVA, ''), false);
  assert.equal(soloRigheTolte('', PROVA), false);
  assert.equal(soloRigheTolte(undefined, undefined), false);
});

test('dentroProveGiro: solo la cartella delle prove dei giri', () => {
  assert.equal(dentroProveGiro('tests/verifica/locale-x/giro1.spec.mjs'), true);
  assert.equal(dentroProveGiro('tests/verifica/661/giro1.spec.mjs'), true);
  assert.equal(dentroProveGiro('tests\\verifica\\locale-x\\giro1.spec.mjs'), true, 'le barre di Windows sono le stesse barre');
  assert.equal(dentroProveGiro('src/main/menu.js'), false);
  assert.equal(dentroProveGiro('tests/chat.spec.mjs'), false);
  assert.equal(dentroProveGiro('tests/verifica/../../src/main/menu.js'), false);
  assert.equal(dentroProveGiro(''), false);
});

// ─── il controllo del diff, i tre casi del feedback ─────────────────────────

test('la tolleranza: un file fuori dalla cartella fa decadere il verdetto', () => {
  const r = soloProveTolte([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: PROVA_SEGNATA },
    { path: 'src/main/menu.js', stato: 'M', prima: 'a', dopo: 'a' },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /fuori dalle prove del giro/);
  assert.match(r.motivo, /src\/main\/menu\.js/, 'il file si dice per nome: senza, non si sa cosa togliere');
});

test('la tolleranza: casi tolti da prove che ne hanno altri → il verdetto vale', () => {
  const r = soloProveTolte([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA_DUE_CASI, dopo: PROVA },
    { path: 'tests/verifica/locale-x/giro3.spec.mjs', stato: 'M', prima: PROVA_DUE_CASI, dopo: PROVA },
  ]);
  assert.equal(r.ok, true, 'è la mossa che il testo del pass chiede, e che il cancello del server accetta');
  assert.deepEqual(r.files, ['tests/verifica/locale-x/giro4.spec.mjs', 'tests/verifica/locale-x/giro3.spec.mjs']);
});

test('la tolleranza: un marcatore di rosso atteso aggiunto dopo il verdetto lo fa decadere', () => {
  const r = soloProveTolte([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: PROVA_SEGNATA }]);
  assert.equal(r.ok, false, 'dopo il verdetto si può solo togliere: il server lo rifiuta, e qui vale lo stesso');
  assert.match(r.motivo, /giro4\.spec\.mjs/);
});

// La regola del 23/09/2026: la prova di un rilievo diventato un feedback suo si
// TOGLIE, e toglierla è la strada normale, non un'eccezione da spiegare.
test('la tolleranza: una prova tolta non fa decadere il verdetto', () => {
  const r = soloProveTolte([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'D', prima: PROVA, dopo: '' },
    { path: 'tests/verifica/locale-x/giro3.spec.mjs', stato: 'D', prima: PROVA_SEGNATA, dopo: '' },
  ]);
  assert.equal(r.ok, true, 'togliere la prova di un rilievo uscito in un feedback suo è la strada normale');
  assert.equal(r.files.length, 2, 'chi pubblica deve vedere cosa gli è stato lasciato passare');
  // Tolta una e tolto un caso da un'altra, nello stesso commit: la stessa mossa.
  assert.equal(soloProveTolte([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'D', prima: PROVA, dopo: '' },
    { path: 'tests/verifica/locale-x/giro3.spec.mjs', stato: 'M', prima: PROVA_DUE_CASI, dopo: PROVA },
  ]).ok, true);
});

test('la tolleranza: una prova AGGIUNTA fa decadere il verdetto', () => {
  const r = soloProveTolte([{ path: 'tests/verifica/locale-x/giro5.spec.mjs', stato: 'A', prima: '', dopo: PROVA }]);
  assert.equal(r.ok, false, 'una prova nuova è roba da girare che nessuno ha provato');
  assert.match(r.motivo, /giro5\.spec\.mjs/);
  // Uno spostamento è una prova tolta più una aggiunta: la seconda chiude.
  assert.equal(soloProveTolte([
    { path: 'tests/verifica/locale-x/giro1.spec.mjs', stato: 'D', prima: PROVA, dopo: '' },
    { path: 'tests/verifica/locale-x/giro9.spec.mjs', stato: 'A', prima: '', dopo: PROVA },
  ]).ok, false);
});

test('la tolleranza: una riga di codice in una prova del giro fa decadere il verdetto', () => {
  const alterata = PROVA.replace("toContain('crediti di Filo')", "toContain('')");
  const r = soloProveTolte([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: alterata }]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /oltre a prove e casi tolti/);
});

// Lo stato di git vale più del contenuto: `git show` muto su un file che esiste
// darebbe un file «vuoto», identico a uno cancellato, e si tollererebbe una
// modifica vera.
test('la tolleranza: un contenuto illeggibile non passa per una cancellazione', () => {
  const r = soloProveTolte([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: '' }]);
  assert.equal(r.ok, false, 'lo stato dice M: non è un file tolto');
});

test('la tolleranza: senza il diff non si tollera niente', () => {
  assert.equal(soloProveTolte(null).ok, false, 'git muto non è un via libera');
  assert.match(soloProveTolte(null).motivo, /non sono riuscito a leggere/);
  assert.equal(soloProveTolte('tutto a posto').ok, false);
});

test('vociNameStatus: lo stato e il nome, anche con uno spazio dentro', () => {
  assert.deepEqual(vociNameStatus('M\0tests/verifica/1/a.spec.mjs\0D\0tests/verifica/1/b c.spec.mjs\0'), [
    { stato: 'M', path: 'tests/verifica/1/a.spec.mjs' },
    { stato: 'D', path: 'tests/verifica/1/b c.spec.mjs' },
  ]);
  // Uno spostamento porta due nomi e diventa due voci: il vecchio tolto, il
  // nuovo aggiunto.
  assert.deepEqual(vociNameStatus('R100\0tests/verifica/1/a.spec.mjs\0tests/verifica/1/z.spec.mjs\0'), [
    { stato: 'D', path: 'tests/verifica/1/a.spec.mjs' },
    { stato: 'A', path: 'tests/verifica/1/z.spec.mjs' },
  ]);
  assert.deepEqual(vociNameStatus(''), []);
  assert.deepEqual(vociNameStatus(undefined), []);
});

// ─── il cancello ────────────────────────────────────────────────────────────

const diffFinto = (files) => () => files;

test('checkVerdict: il pass regge sul commit che toglie un caso dalle prove del giro', () => {
  const entry = { verdict: 'pass', sha: SHA };
  // Senza chi legge il diff il cancello resta quello stretto di sempre.
  assert.equal(checkVerdict(entry, ALTRO_SHA).ok, false);
  const r = checkVerdict(entry, ALTRO_SHA, false, diffFinto([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', prima: PROVA_DUE_CASI, dopo: PROVA },
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.tollerato, true);
  assert.match(r.reason, /solo tolte prove o casi/);
  assert.match(r.reason, /giro4\.spec\.mjs/, 'chi pubblica deve vedere cosa gli è stato lasciato passare');
});

test('checkVerdict: fuori dalla cartella, o con codice vero, il pass decade lo stesso', () => {
  const entry = { verdict: 'pass', sha: SHA };
  const fuori = checkVerdict(entry, ALTRO_SHA, false, diffFinto([{ path: 'src/main/menu.js', prima: 'a', dopo: 'b' }]));
  assert.equal(fuori.ok, false);
  assert.match(fuori.reason, /cambiato dopo la verifica/);
  assert.match(fuori.reason, /fuori dalle prove del giro/, 'il motivo vero sta nella stessa riga');

  const codice = checkVerdict(entry, ALTRO_SHA, false, diffFinto([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', prima: PROVA, dopo: PROVA.replace('crediti di Filo', 'altro') },
  ]));
  assert.equal(codice.ok, false);
  assert.match(codice.reason, /cambiato dopo la verifica/);
});

test('checkVerdict: la tolleranza non riapre le altre porte', () => {
  const soloMarc = diffFinto([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', prima: PROVA_DUE_CASI, dopo: PROVA }]);
  // Modifiche non salvate: non stanno in nessuno dei due commit, quindi il
  // confronto non le ha viste. Restano un no, e il motivo dice quale.
  const sporco = checkVerdict({ verdict: 'pass', sha: SHA }, ALTRO_SHA, true, soloMarc);
  assert.equal(sporco.ok, false);
  assert.match(sporco.reason, /modifiche non salvate/);
  // Un verdetto che non è un pass non diventa un pass.
  assert.equal(checkVerdict({ verdict: 'fail', critique: 'non salva', sha: SHA }, ALTRO_SHA, false, soloMarc).ok, false);
  assert.equal(checkVerdict({ verdict: 'fix-pending', sha: SHA }, ALTRO_SHA, false, soloMarc).ok, false);
  assert.equal(checkVerdict({ verdict: 'fixed', sha: SHA }, ALTRO_SHA, false, soloMarc).ok, false);
  // Senza il commit verificato non c'è niente da confrontare.
  assert.equal(checkVerdict({ verdict: 'pass', sha: '' }, ALTRO_SHA, false, soloMarc).ok, false);
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, '', false, soloMarc).ok, false);
});

test('chi verifica sa quali prove togliere, e cosa fa decadere il verdetto', () => {
  const t = testoProveDaCancellare('claude/ripiego-crediti', [
    { level: 1, sede: 'e', text: 'il riquadro non dice da dove arrivano i crediti. Passi: apri il riquadro.' },
  ]);
  assert.match(t, /tests\/verifica\/locale-ripiego-crediti/);
  // I rilievi si riconoscono dal loro testo: qui un numero di feedback non c'è.
  assert.match(t, /il riquadro non dice da dove arrivano i crediti/);
  assert.match(t, /NON fa decadere questo verdetto/);
  assert.match(t, /git commit/, 'un rm non lo salva nessun hook: il commit va chiesto');
  assert.match(t, /aggiunta/, 'una prova nuova deve continuare a far decadere il verdetto');
  // Dopo un verdetto si può solo TOGLIERE: il marcatore di rosso atteso aggiunge
  // una riga, e il cancello del server non lo tollera. Proporlo qui sarebbe una
  // trappola su una delle due strade.
  assert.doesNotMatch(t, /test\.fail\(/);
  // La chiusura le prove dei giri non le corre più: dire che una rossa la ferma è falso.
  assert.doesNotMatch(t, /ferma la chiusura/);
  // Senza rilievi in mano il testo rimanda all'elenco, non stampa una riga vuota.
  assert.match(testoProveDaCancellare('claude/x', []), /elencati qui sopra/);
});

// ─── su un deposito git vero ────────────────────────────────────────────────
//
// Le funzioni pure qui sopra dicono cosa DECIDE il cancello; questo dice che
// il cancello legge davvero da git quello che deve leggere (i nomi con le
// barre normali, il contenuto ai due commit, il file cancellato).

function depositoConProva(nome, prova = PROVA) {
  const casa = cartellaTemporanea(nome);
  const git = (...a) => execFileSync('git', a, { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(resolve(casa, '.gitignore'), '.claude/\n', 'utf8');
  mkdirSync(resolve(casa, 'tests', 'verifica', 'locale-x'), { recursive: true });
  mkdirSync(resolve(casa, 'src'), { recursive: true });
  writeFileSync(resolve(casa, 'src', 'menu.js'), 'export const a = 1;\n', 'utf8');
  writeFileSync(resolve(casa, 'tests', 'verifica', 'locale-x', 'giro4.spec.mjs'), prova, 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'lavoro');
  git('checkout', '-q', '-b', 'claude/x');
  git('commit', '-q', '--allow-empty', '-m', 'ramo');
  const verificato = git('rev-parse', 'HEAD').trim();
  writeState({ 'claude/x': { verdict: 'pass', sha: verificato, request: 'fai X' } }, casa);
  return { casa, git, verificato };
}

test('su un deposito vero: un caso tolto regge, un marcatore aggiunto no', () => {
  const { casa, git, verificato } = depositoConProva('filo-marcatori-', PROVA_DUE_CASI);
  assert.equal(verdictForCurrentBranch(casa).ok, true, 'sul commit verificato si pubblica');

  writeFileSync(resolve(casa, 'tests', 'verifica', 'locale-x', 'giro4.spec.mjs'), PROVA, 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'tolto il caso del rilievo messo da parte');
  const dopo = verdictForCurrentBranch(casa);
  assert.equal(dopo.ok, true, 'togliere un caso non costa un altro giro');
  assert.equal(dopo.tollerato, true);
  assert.deepEqual(dopo.files, ['tests/verifica/locale-x/giro4.spec.mjs']);
  const letto = diffDopoLaVerifica(verificato, git('rev-parse', 'HEAD').trim(), casa);
  assert.equal(letto.length, 1);
  assert.equal(letto[0].prima.includes('il secondo caso'), true);
  assert.equal(letto[0].dopo.includes('il secondo caso'), false);

  // Un rosso atteso segnato dopo il verdetto: una riga aggiunta, il cancello chiude.
  writeFileSync(resolve(casa, 'tests', 'verifica', 'locale-x', 'giro4.spec.mjs'), PROVA_SEGNATA, 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'rosso atteso');
  assert.equal(verdictForCurrentBranch(casa).ok, false);

  // Un file fuori dalla cartella, nello stesso ramo: il cancello torna a chiudere.
  writeFileSync(resolve(casa, 'src', 'menu.js'), 'export const a = 2;\n', 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'codice');
  const terzo = verdictForCurrentBranch(casa);
  assert.equal(terzo.ok, false);
  assert.match(terzo.reason, /src\/menu\.js/);
});

test('su un deposito vero: una prova del giro tolta dopo il verdetto non ferma la chiusura', () => {
  const { casa, git, verificato } = depositoConProva('filo-marcatori-tolta-');
  git('rm', '-q', 'tests/verifica/locale-x/giro4.spec.mjs');
  git('commit', '-qm', 'via la prova del rilievo uscito in un feedback suo');
  const r = verdictForCurrentBranch(casa);
  assert.equal(r.ok, true, 'è la strada normale dal 23/09/2026: senza questo, svuotare la cartella costa un giro');
  assert.equal(r.tollerato, true);
  assert.deepEqual(r.files, ['tests/verifica/locale-x/giro4.spec.mjs']);
  // Lo stato arriva da git, non dedotto dal contenuto.
  const letto = diffDopoLaVerifica(verificato, git('rev-parse', 'HEAD').trim(), casa);
  assert.equal(letto.length, 1);
  assert.equal(letto[0].stato, 'D');

  // Una prova AGGIUNTA nella stessa cartella richiude il cancello: quello che
  // gira è cresciuto, e nessuno l'ha provato. (Tolta l'unica prova, git si
  // porta via anche la cartella: va rifatta.)
  mkdirSync(resolve(casa, 'tests', 'verifica', 'locale-x'), { recursive: true });
  writeFileSync(resolve(casa, 'tests', 'verifica', 'locale-x', 'giro5.spec.mjs'), PROVA, 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'prova nuova');
  assert.equal(verdictForCurrentBranch(casa).ok, false);
});
