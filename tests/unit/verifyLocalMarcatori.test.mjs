// Il verdetto non decade per quello che il giro fa alle sue prove (#661).
//
// PERCHÉ CONTA
//   Il cancello di `npm run finish` lega il verdetto a un commit: se la punta
//   si muove, il verdetto decade. Giusto — tranne per l'unico commit che chi
//   verifica DEVE fare dopo il verdetto: quello che TOGLIE dalle prove del giro
//   i rilievi diventati un feedback loro (o, come ripiego, li segna rossi
//   attesi). Due volte (10/09 e 18/09, #629) quel commit è costato un giro
//   intero, mezz'ora e un'istanza, per un ramo in cui non era cambiata una riga
//   di prodotto.
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
  checkVerdict, corpoSenzaMarcatori, soloMarcatoriOCancellazioni, dentroProveGiro,
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

// ─── la riduzione a «quello che gira» ───────────────────────────────────────

test('corpoSenzaMarcatori: marcatori, commenti e righe vuote non contano', () => {
  assert.equal(corpoSenzaMarcatori(PROVA), corpoSenzaMarcatori(PROVA_SEGNATA));
  // Il marcatore sulla DICHIARAZIONE è lo stesso marcatore, in un altro posto.
  const dichiarato = PROVA.replace("test('il riquadro", "test.fail('il riquadro");
  assert.equal(corpoSenzaMarcatori(dichiarato), corpoSenzaMarcatori(PROVA));
  // `test.fixme` è l'altro modo di dire «questo è rosso e lo so».
  assert.equal(corpoSenzaMarcatori(PROVA.replace("test('il riquadro", "test.fixme('il riquadro")), corpoSenzaMarcatori(PROVA));
  // Un motivo lungo va a capo e resta un marcatore solo.
  const aCapo = PROVA.replace('  const riga', "  test.fail(true,\n    'un motivo che non sta su una riga sola perché il rilievo è lungo da spiegare');\n  const riga");
  assert.equal(corpoSenzaMarcatori(aCapo), corpoSenzaMarcatori(PROVA));
  // Sulla macchina dell'owner i file stanno su Windows: un ritorno a capo in
  // più non è una riga cambiata.
  assert.equal(corpoSenzaMarcatori(PROVA_SEGNATA.replace(/\n/g, '\r\n')), corpoSenzaMarcatori(PROVA));
  // Un file vuoto, o niente: nessuna eccezione, nessun contenuto.
  assert.equal(corpoSenzaMarcatori(''), '');
  assert.equal(corpoSenzaMarcatori(undefined), '');
  assert.equal(corpoSenzaMarcatori('\n\n   \n'), '');
});

test('corpoSenzaMarcatori: quello che gira resta, e si vede', () => {
  const cambiata = PROVA.replace("toContain('crediti di Filo')", "toContain('')");
  assert.notEqual(corpoSenzaMarcatori(cambiata), corpoSenzaMarcatori(PROVA));
  // Una riga commentata non è una riga in meno «che non conta»: sparisce
  // davvero, ed è proprio il modo più facile di spegnere una prova.
  const spenta = PROVA.replace("  expect(riga)", "  // expect(riga)");
  assert.notEqual(corpoSenzaMarcatori(spenta), corpoSenzaMarcatori(PROVA));
  // `test.skip` toglie la prova dal giro: non è un rosso atteso.
  const saltata = PROVA.replace("test('il riquadro", "test.skip('il riquadro");
  assert.notEqual(corpoSenzaMarcatori(saltata), corpoSenzaMarcatori(PROVA));
  // Un marcatore con le tonde che non si chiudono non inghiotte il resto del
  // file: resta una riga come le altre, e quello che viene dopo si confronta.
  const storto = PROVA.replace('  const riga', "  test.fail(true, 'motivo;\n  const riga");
  const storto2 = storto.replace("toContain('crediti di Filo')", "toContain('altro')");
  assert.notEqual(corpoSenzaMarcatori(storto), corpoSenzaMarcatori(storto2));
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
  const r = soloMarcatoriOCancellazioni([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: PROVA_SEGNATA },
    { path: 'src/main/menu.js', stato: 'M', prima: 'a', dopo: 'a' },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /fuori dalle prove del giro/);
  assert.match(r.motivo, /src\/main\/menu\.js/, 'il file si dice per nome: senza, non si sa cosa togliere');
});

test('la tolleranza: solo marcatori nelle prove del giro → il verdetto vale', () => {
  const r = soloMarcatoriOCancellazioni([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: PROVA_SEGNATA },
    { path: 'tests/verifica/locale-x/giro3.spec.mjs', stato: 'M', prima: PROVA, dopo: PROVA_SEGNATA },
  ]);
  assert.equal(r.ok, true, 'è il caso che senza il fix costava un giro intero');
  assert.deepEqual(r.files, ['tests/verifica/locale-x/giro4.spec.mjs', 'tests/verifica/locale-x/giro3.spec.mjs']);
});

// La regola del 23/09/2026: la prova di un rilievo diventato un feedback suo si
// TOGLIE, e toglierla è la strada normale, non un'eccezione da spiegare.
test('la tolleranza: una prova tolta non fa decadere il verdetto', () => {
  const r = soloMarcatoriOCancellazioni([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'D', prima: PROVA, dopo: '' },
    { path: 'tests/verifica/locale-x/giro3.spec.mjs', stato: 'D', prima: PROVA_SEGNATA, dopo: '' },
  ]);
  assert.equal(r.ok, true, 'togliere la prova di un rilievo uscito in un feedback suo è la strada normale');
  assert.equal(r.files.length, 2, 'chi pubblica deve vedere cosa gli è stato lasciato passare');
  // Tolta una e segnata un'altra, nello stesso commit: due mosse della stessa
  // regola, non due regole.
  assert.equal(soloMarcatoriOCancellazioni([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'D', prima: PROVA, dopo: '' },
    { path: 'tests/verifica/locale-x/giro3.spec.mjs', stato: 'M', prima: PROVA, dopo: PROVA_SEGNATA },
  ]).ok, true);
});

test('la tolleranza: una prova AGGIUNTA fa decadere il verdetto', () => {
  const r = soloMarcatoriOCancellazioni([{ path: 'tests/verifica/locale-x/giro5.spec.mjs', stato: 'A', prima: '', dopo: PROVA }]);
  assert.equal(r.ok, false, 'una prova nuova è roba da girare che nessuno ha provato');
  assert.match(r.motivo, /giro5\.spec\.mjs/);
  // Uno spostamento è una prova tolta più una aggiunta: la seconda chiude.
  assert.equal(soloMarcatoriOCancellazioni([
    { path: 'tests/verifica/locale-x/giro1.spec.mjs', stato: 'D', prima: PROVA, dopo: '' },
    { path: 'tests/verifica/locale-x/giro9.spec.mjs', stato: 'A', prima: '', dopo: PROVA },
  ]).ok, false);
});

test('la tolleranza: una riga di codice in una prova del giro fa decadere il verdetto', () => {
  const alterata = PROVA_SEGNATA.replace("toContain('crediti di Filo')", "toContain('')");
  const r = soloMarcatoriOCancellazioni([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: alterata }]);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /oltre alle prove tolte e ai marcatori/);
});

// Lo stato di git vale più del contenuto: `git show` muto su un file che esiste
// darebbe un file «vuoto», identico a uno cancellato, e si tollererebbe una
// modifica vera.
test('la tolleranza: un contenuto illeggibile non passa per una cancellazione', () => {
  const r = soloMarcatoriOCancellazioni([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', stato: 'M', prima: PROVA, dopo: '' }]);
  assert.equal(r.ok, false, 'lo stato dice M: non è un file tolto');
});

test('la tolleranza: senza il diff non si tollera niente', () => {
  assert.equal(soloMarcatoriOCancellazioni(null).ok, false, 'git muto non è un via libera');
  assert.match(soloMarcatoriOCancellazioni(null).motivo, /non sono riuscito a leggere/);
  assert.equal(soloMarcatoriOCancellazioni('tutto a posto').ok, false);
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

test('checkVerdict: il pass regge sul commit dei soli marcatori', () => {
  const entry = { verdict: 'pass', sha: SHA };
  // Senza chi legge il diff il cancello resta quello stretto di sempre.
  assert.equal(checkVerdict(entry, ALTRO_SHA).ok, false);
  const r = checkVerdict(entry, ALTRO_SHA, false, diffFinto([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', prima: PROVA, dopo: PROVA_SEGNATA },
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.tollerato, true);
  assert.match(r.reason, /marcatori di rosso atteso/);
  assert.match(r.reason, /giro4\.spec\.mjs/, 'chi pubblica deve vedere cosa gli è stato lasciato passare');
});

test('checkVerdict: fuori dalla cartella, o con codice vero, il pass decade lo stesso', () => {
  const entry = { verdict: 'pass', sha: SHA };
  const fuori = checkVerdict(entry, ALTRO_SHA, false, diffFinto([{ path: 'src/main/menu.js', prima: 'a', dopo: 'b' }]));
  assert.equal(fuori.ok, false);
  assert.match(fuori.reason, /cambiato dopo la verifica/);
  assert.match(fuori.reason, /fuori dalle prove del giro/, 'il motivo vero sta nella stessa riga');

  const codice = checkVerdict(entry, ALTRO_SHA, false, diffFinto([
    { path: 'tests/verifica/locale-x/giro4.spec.mjs', prima: PROVA, dopo: PROVA_SEGNATA.replace('crediti di Filo', 'altro') },
  ]));
  assert.equal(codice.ok, false);
  assert.match(codice.reason, /cambiato dopo la verifica/);
});

test('checkVerdict: la tolleranza non riapre le altre porte', () => {
  const soloMarc = diffFinto([{ path: 'tests/verifica/locale-x/giro4.spec.mjs', prima: PROVA, dopo: PROVA_SEGNATA }]);
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

test('chi verifica sa come si segna un rosso atteso, e cosa fa decadere il verdetto', () => {
  const t = testoRossiAttesi('claude/ripiego-crediti');
  assert.match(t, /tests\/verifica\/locale-ripiego-crediti/);
  assert.match(t, /test\.fail\(/);
  assert.match(t, /NON fa decadere questo verdetto/);
  assert.match(t, /senza marcatore/, 'un rosso non segnato deve continuare a fermare la chiusura');
});

// ─── su un deposito git vero ────────────────────────────────────────────────
//
// Le funzioni pure qui sopra dicono cosa DECIDE il cancello; questo dice che
// il cancello legge davvero da git quello che deve leggere (i nomi con le
// barre normali, il contenuto ai due commit, il file cancellato).

function depositoConProva(nome) {
  const casa = cartellaTemporanea(nome);
  const git = (...a) => execFileSync('git', a, { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(resolve(casa, '.gitignore'), '.claude/\n', 'utf8');
  mkdirSync(resolve(casa, 'tests', 'verifica', 'locale-x'), { recursive: true });
  mkdirSync(resolve(casa, 'src'), { recursive: true });
  writeFileSync(resolve(casa, 'src', 'menu.js'), 'export const a = 1;\n', 'utf8');
  writeFileSync(resolve(casa, 'tests', 'verifica', 'locale-x', 'giro4.spec.mjs'), PROVA, 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'lavoro');
  git('checkout', '-q', '-b', 'claude/x');
  git('commit', '-q', '--allow-empty', '-m', 'ramo');
  const verificato = git('rev-parse', 'HEAD').trim();
  writeState({ 'claude/x': { verdict: 'pass', sha: verificato, request: 'fai X' } }, casa);
  return { casa, git, verificato };
}

test('su un deposito vero: il commit dei marcatori non fa decadere il verdetto', () => {
  const { casa, git, verificato } = depositoConProva('filo-marcatori-');
  assert.equal(verdictForCurrentBranch(casa).ok, true, 'sul commit verificato si pubblica');

  writeFileSync(resolve(casa, 'tests', 'verifica', 'locale-x', 'giro4.spec.mjs'), PROVA_SEGNATA, 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'rosso atteso');
  const dopo = verdictForCurrentBranch(casa);
  assert.equal(dopo.ok, true, 'il commit dei soli marcatori non costa un altro giro');
  assert.equal(dopo.tollerato, true);
  assert.deepEqual(dopo.files, ['tests/verifica/locale-x/giro4.spec.mjs']);
  const letto = diffDopoLaVerifica(verificato, git('rev-parse', 'HEAD').trim(), casa);
  assert.equal(letto.length, 1);
  assert.equal(letto[0].prima.includes('test.fail'), false);
  assert.equal(letto[0].dopo.includes('test.fail'), true);

  // Un file fuori dalla cartella, nello stesso ramo: il cancello torna a chiudere.
  writeFileSync(resolve(casa, 'src', 'menu.js'), 'export const a = 2;\n', 'utf8');
  git('add', '-A');
  git('commit', '-qm', 'codice');
  const terzo = verdictForCurrentBranch(casa);
  assert.equal(terzo.ok, false);
  assert.match(terzo.reason, /src\/menu\.js/);
});

test('su un deposito vero: una prova del giro cancellata dopo il verdetto ferma la chiusura', () => {
  const { casa, git } = depositoConProva('filo-marcatori-tolta-');
  git('rm', '-q', 'tests/verifica/locale-x/giro4.spec.mjs');
  git('commit', '-qm', 'via la prova');
  const r = verdictForCurrentBranch(casa);
  assert.equal(r.ok, false, 'togliere la prova che riproduce il rilievo non è segnarla');
});
