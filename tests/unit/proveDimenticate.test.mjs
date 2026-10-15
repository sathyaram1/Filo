// #747: la prova di un rilievo messo da parte che la pulizia ha lasciato indietro, tolta ancora rossa da chi corregge.
// La consegna si ferma, ma manda alla pulizia (che vale anche dopo le correzioni), non a correggere. Playwright qui è finto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  esitoProveTolte, soloDiMessiDaParte, controllaProveTolte, controllaPulizia, testoPuliziaFuoriNumero, effettiPulizieDopo,
} from '../../scripts/lib/prove-tolte.mjs';

const C = 'tests/verifica/747';
const SHA = 'abcdef1234567890';
const CMD = 'node scripts/dispatch.mjs --record-pulizia fid-747';
const preparaFinto = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });

// ─── Le parti pure ───

test('una rossa che porta solo numeri di rilievi messi da parte manda alla pulizia, non a correggere', () => {
  const f = `${C}/giro2-r3-dimenticata.spec.mjs`;
  const e = esitoProveTolte({ rosse: [f], shaPrima: SHA, numeri: [3], comando: CMD });
  assert.equal(e.ferma, true, 'la consegna si ferma lo stesso');
  assert.match(e.testo, /^Consegna respinta: queste prove/);
  assert.match(e.testo, /giro2-r3-dimenticata\.spec\.mjs \(r3\)/);
  assert.match(e.testo, /non si correggono qui/);
  assert.match(e.testo, /git checkout abcdef123456 -- <file>/);
  assert.match(e.testo.replace(/\s+/g, ' '), /Registra la pulizia finché il suo è l'ultimo commit \(node scripts\/dispatch\.mjs --record-pulizia fid-747\)/);
  assert.match(e.testo, /si registra anche dopo le correzioni/);
  assert.doesNotMatch(e.testo, /correggi finché|riproduce un rilievo da chiudere/i);
});

test('una rossa da correggere e una dimenticata insieme: ognuna col suo rimedio', () => {
  const daCorreggere = `${C}/giro2-r1-salva.spec.mjs`;
  const dimenticata = `${C}/giro2-r3-bordo.spec.mjs`;
  const e = esitoProveTolte({ rosse: [daCorreggere, dimenticata], shaPrima: SHA, numeri: [3], comando: CMD });
  assert.equal(e.ferma, true);
  const [sopra, sotto] = e.testo.split('Queste invece');
  assert.ok(sotto, e.testo);
  assert.match(sopra, /giro2-r1-salva\.spec\.mjs/);
  assert.match(sopra, /correggi finché è verde/);
  assert.doesNotMatch(sopra, /giro2-r3-bordo/);
  assert.match(sotto, /giro2-r3-bordo\.spec\.mjs \(r3\)/);
  assert.match(sotto, /--record-pulizia fid-747/);
  assert.doesNotMatch(sotto, /giro2-r1-salva/);
});

test('di chi è il rosso lo dice il caso rosso, poi il nome; una prova di una critica passata non è del giro', () => {
  const f = `${C}/giro2-r1-r3-porte.spec.mjs`;
  assert.deepEqual(soloDiMessiDaParte(f, [3], ['porte › r3 il bordo']), [3], 'rosso solo il caso del messo da parte');
  assert.deepEqual(soloDiMessiDaParte(f, [3], ['r1 il salvataggio']), []);
  assert.deepEqual(soloDiMessiDaParte(f, [3], ['r3 il bordo', 'r1 il salvataggio']), []);
  assert.deepEqual(soloDiMessiDaParte(f, [3], ['un caso senza numero']), [], 'senza numero nel titolo vale il nome, che porta anche r1');
  assert.deepEqual(soloDiMessiDaParte(f, [3]), [], 'senza esito per caso decide il nome');
  assert.deepEqual(soloDiMessiDaParte(`${C}/giro2-r3-bordo.spec.mjs`, [3], ['un caso senza numero']), [3]);
  assert.deepEqual(soloDiMessiDaParte(`${C}/giro2-r3-bordo.spec.mjs`, [3], null, [`${C}/giro2-r3-bordo.spec.mjs`]), [],
    'scritta prima di questa verifica: il suo r3 è di una critica passata');
  assert.deepEqual(soloDiMessiDaParte(`${C}/giro2-bordo.spec.mjs`, [3]), [], 'senza numero non è di nessuno');
  assert.deepEqual(soloDiMessiDaParte(`${C}/giro2-r3-bordo.spec.mjs`, []), []);
  assert.deepEqual(soloDiMessiDaParte(`${C}/giro2-r3-bordo.spec.mjs`, [null, 3]), [3]);
});

test('anche il caso rimasto in una prova accorciata dalla pulizia, se è di un messo da parte, manda alla pulizia', () => {
  const f = `${C}/giro2-r1-r2-r3-tre.spec.mjs`;
  const e = esitoProveTolte({ dallaPulizia: [f], shaPrima: SHA, numeri: [2, 3], casi: { [f]: ['r3 il terzo'] }, comando: CMD });
  assert.equal(e.ferma, true);
  assert.match(e.testo, /giro2-r1-r2-r3-tre\.spec\.mjs \(r3\)/);
  assert.doesNotMatch(e.testo, /il caso che resta riproduce un rilievo da correggere/);
  const daCorreggere = esitoProveTolte({ dallaPulizia: [f], shaPrima: SHA, numeri: [2, 3], casi: { [f]: ['r1 il primo'] }, comando: CMD });
  assert.match(daCorreggere.testo, /il caso che resta riproduce un rilievo da correggere/);
});

test('coi numeri in mano, senza pulizia registrata, una rossa da correggere non si sente dire «lasciala lì»', () => {
  const f = `${C}/giro2-r1-salva.spec.mjs`;
  const e = esitoProveTolte({ rosse: [f], shaPrima: SHA, conPulizia: false, messi: 1, numeri: [3] });
  assert.equal(e.ferma, true);
  assert.doesNotMatch(e.testo, /lasciala lì/);
  assert.match(e.testo, /riproduce un rilievo da chiudere/);
  assert.match(esitoProveTolte({ rosse: [f], shaPrima: SHA, conPulizia: false, messi: 1 }).testo, /lasciala lì/,
    'senza i numeri resta il dubbio, e lo si dice');
});

// ─── In un repo vero ───

function repo() {
  const dir = cartellaTemporanea('prove-dimenticate-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', 'lavoro');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', 'tests/verifica/_tolte-*/\n');
  scrivi('src/x.js', '0\n');
  g('add', '-A'); g('commit', '-qm', 'avvio della verifica');
  const avvio = g('rev-parse', 'HEAD');
  scrivi(`${C}/giro2-r1-salva.spec.mjs`, 'ROSSA\n');
  scrivi(`${C}/giro2-r3-bordo.spec.mjs`, 'ROSSA\n');
  scrivi(`${C}/giro2-r3-bordo-bis.spec.mjs`, 'ROSSA\n');
  scrivi(`${C}/helpers/banco.mjs`, 'AIUTO\nRIGA DEL BORDO\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  const commit = (m) => { g('add', '-A'); g('commit', '-qm', m); return g('rev-parse', 'HEAD'); };
  return { dir, g, scrivi, avvio, critica, commit };
}

// Il finto Playwright legge la copia rimessa: rosso se dice ROSSA.
function finto(dir, visti) {
  return (cmd, args) => {
    const file = args.find((a) => a.endsWith('.spec.mjs'));
    visti.push(file);
    return { status: readFileSync(resolve(dir, file), 'utf8').startsWith('ROSSA') ? 1 : 0 };
  };
}

test('la prova dimenticata e tolta con la correzione: la consegna manda alla pulizia, che dopo le correzioni la lascia uscire', () => {
  const { dir, g, scrivi, avvio, critica, commit } = repo();
  const bis = `${C}/giro2-r3-bordo-bis.spec.mjs`;
  try {
    g('rm', '-q', `${C}/giro2-r3-bordo.spec.mjs`);
    const pulizia = commit('pulizia che dimentica il bis');
    scrivi('src/x.js', 'corretto\n'); g('rm', '-q', bis);
    commit('correzione, e via anche il bis');
    const visti = [];
    const consegna = (pulizieDopo = []) => controllaProveTolte({
      shaPrima: pulizia, root: dir, shaCritica: critica, numeri: [3], avvio, comando: CMD, pulizieDopo,
      lancia: finto(dir, visti), prepara: preparaFinto, log: () => {},
    });
    const no = consegna();
    assert.equal(no.ferma, true);
    assert.match(no.testo, /giro2-r3-bordo-bis\.spec\.mjs \(r3\)/);
    assert.match(no.testo, /--record-pulizia fid-747/);
    assert.doesNotMatch(no.testo, /correggi finché/i);

    const mista = controllaPulizia({ shaCritica: critica, root: dir, avvio, base: pulizia });
    assert.equal(mista.ok, false, 'la correzione sta nello stesso commit: non è una pulizia');
    assert.match(mista.motivo, /nell'ultimo commit fuori dalle prove del giro: src\/x\.js/);
    assert.match(mista.motivo, /un commit a parte, l'ultimo/);

    g('checkout', pulizia, '--', bis); commit('rimessa com\'era');
    const rimessa = g('rev-parse', 'HEAD');
    g('rm', '-q', bis);
    const dopo = commit('pulizia dopo le correzioni');
    const c = controllaPulizia({ shaCritica: critica, root: dir, avvio, base: pulizia });
    assert.equal(c.ok, true, c.motivo);
    assert.equal(c.dopo, true);
    assert.equal(c.prima, rimessa);
    assert.equal(c.sha, dopo);
    assert.deepEqual(c.cancellate, [bis]);
    assert.equal(testoPuliziaFuoriNumero(c, [3]), '', 'porta solo r3, scritta in questa verifica: esce');

    visti.length = 0;
    assert.deepEqual(consegna([dopo]), { ferma: false, testo: '' });
    assert.equal(visti.length, 0, 'uscita con la pulizia: non si rilancia');

    g('rm', '-q', `${C}/giro2-r1-salva.spec.mjs`); commit('via anche la rossa da correggere');
    const ancora = consegna([dopo]);
    assert.equal(ancora.ferma, true, 'una pulizia dopo le correzioni non apre la porta alle altre');
    assert.match(ancora.testo, /giro2-r1-salva\.spec\.mjs\n[\s\S]*correggi finché è verde/);
    assert.doesNotMatch(ancora.testo, /giro2-r1-salva\.spec\.mjs \(r1\)/);
  } finally {
    togliCartella(dir);
  }
});

test('senza nessuna pulizia prima, quella dopo le correzioni parte dalla critica', () => {
  const { dir, g, scrivi, avvio, critica, commit } = repo();
  try {
    scrivi('src/x.js', 'corretto\n'); commit('correzione');
    g('rm', '-q', `${C}/giro2-r3-bordo.spec.mjs`, `${C}/giro2-r3-bordo-bis.spec.mjs`);
    const dopo = commit('pulizia');
    const c = controllaPulizia({ shaCritica: critica, root: dir, avvio });
    assert.equal(c.ok, true, c.motivo);
    assert.equal(c.dopo, true);
    const visti = [];
    const e = controllaProveTolte({
      shaPrima: critica, root: dir, conPulizia: false, shaCritica: critica, numeri: [3], avvio, pulizieDopo: [dopo],
      lancia: finto(dir, visti), prepara: preparaFinto, log: () => {},
    });
    assert.deepEqual(e, { ferma: false, testo: '' });
    assert.equal(visti.length, 0);
  } finally {
    togliCartella(dir);
  }
});

test('la pulizia dopo le correzioni toglie solo prove com\'erano: una già cambiata dalla correzione va rimessa prima', () => {
  const { dir, g, scrivi, avvio, critica, commit } = repo();
  const bis = `${C}/giro2-r3-bordo-bis.spec.mjs`;
  try {
    scrivi('src/x.js', 'corretto\n'); scrivi(bis, 'ROSSA\nuna riga della correzione\n'); commit('correzione che tocca il bis');
    g('rm', '-q', bis); const dopo = commit('pulizia');
    const c = controllaPulizia({ shaCritica: critica, root: dir, avvio });
    assert.equal(c.ok, false);
    assert.match(c.motivo, /hanno già cambiato o tolto queste prove[\s\S]*giro2-r3-bordo-bis\.spec\.mjs/);
    assert.match(c.motivo, /git revert --no-edit HEAD/);
    const e = effettiPulizieDopo(critica, [dopo], dir);
    assert.equal(e.esenti.has(bis), false, 'anche registrata a mano, alla consegna non conterebbe');
  } finally {
    togliCartella(dir);
  }
});

test('dopo le correzioni la pulizia non toglie righe di un file di supporto, né prove di altri rilievi', () => {
  const { dir, g, scrivi, avvio, critica, commit } = repo();
  try {
    scrivi('src/x.js', 'corretto\n'); commit('correzione');
    scrivi(`${C}/helpers/banco.mjs`, 'AIUTO\n'); commit('pulizia di un aiuto');
    const supporto = controllaPulizia({ shaCritica: critica, root: dir, avvio });
    assert.equal(supporto.ok, false);
    assert.match(supporto.motivo, /non righe di un file di supporto: tests\/verifica\/747\/helpers\/banco\.mjs/);
    g('revert', '--no-edit', 'HEAD');
    g('rm', '-q', `${C}/giro2-r1-salva.spec.mjs`); commit('pulizia larga');
    const larga = controllaPulizia({ shaCritica: critica, root: dir, avvio });
    assert.equal(larga.ok, true, 'come commit regge: il numero lo guarda chi registra');
    const fuori = testoPuliziaFuoriNumero(larga, [3]);
    assert.match(fuori, /giro2-r1-salva\.spec\.mjs: r1 non è fra i rilievi messi da parte/);
    assert.match(fuori, /git revert --no-edit HEAD/, 'dopo le correzioni si rifà il commit, non si rimette a mano');
  } finally {
    togliCartella(dir);
  }
});

test('una pulizia registrata dopo le correzioni conta solo se discende dalla base e sta nel ramo', () => {
  const { dir, g, scrivi, critica, commit } = repo();
  const bis = `${C}/giro2-r3-bordo-bis.spec.mjs`;
  try {
    scrivi('src/x.js', 'corretto\n'); commit('correzione');
    g('rm', '-q', bis); const dopo = commit('pulizia');
    assert.equal(effettiPulizieDopo(critica, [dopo], dir).esenti.has(bis), true);
    assert.equal(effettiPulizieDopo(dopo, [dopo], dir).esenti.size, 0, 'la base stessa non è una pulizia dopo');
    assert.equal(effettiPulizieDopo(critica, ['f'.repeat(40), 'non uno sha'], dir).esenti.size, 0);
    g('checkout', '-q', '-b', 'altro', critica);
    assert.equal(effettiPulizieDopo(critica, [dopo], dir).esenti.size, 0, 'fuori dal ramo non vale');
  } finally {
    togliCartella(dir);
  }
});
