// Quale commit si pubblica (scripts/ultima-suite-verde.mjs): il più nuovo di main con la suite verde, e un
// feedback quando la pubblicazione è ferma da troppo. Un verde sbagliato pubblica un rosso; uno mancato ferma tutto.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  scegliUltimoVerde, corseVerdi, rilascioFermo, testoRilascioFermo, rigaCorsa, verdePiuNuovoDelTag, SOGLIA_ORE, CHIAVE_FERMO,
} = await import('../../scripts/ultima-suite-verde.mjs');

// main dal più nuovo: c5 è la punta, c1 il più vecchio.
const MAIN = ['c5', 'c4', 'c3', 'c2', 'c1'];
const corsa = (head_sha, conclusion = 'success', extra = {}) => ({
  head_sha, conclusion, status: 'completed', event: 'push', head_branch: 'main',
  html_url: `https://github.com/o/r/actions/runs/${head_sha}`, created_at: '2026-09-28T10:00:00Z', ...extra,
});

describe('il commit più nuovo di main con la suite verde', () => {
  test('vince il più nuovo nella storia di main, non la corsa più recente', () => {
    // La corsa su c2 è arrivata dopo (una riesecuzione), ma c4 è più nuovo su main.
    assert.equal(scegliUltimoVerde([corsa('c2'), corsa('c4'), corsa('c1')], MAIN), 'c4');
    assert.equal(scegliUltimoVerde([corsa('c5'), corsa('c4')], MAIN), 'c5');
  });

  test('un verde su un commit fuori dalla storia del primo genitore non conta', () => {
    // Un commit di un ramo fuso, o di un ramo provato a mano: non è main.
    assert.equal(scegliUltimoVerde([corsa('ramo-x'), corsa('c2')], MAIN), 'c2');
    assert.equal(scegliUltimoVerde([corsa('ramo-x')], MAIN), '');
  });

  test('nessun verde → stringa vuota', () => {
    assert.equal(scegliUltimoVerde([], MAIN), '');
    assert.equal(scegliUltimoVerde(undefined, MAIN), '');
    assert.equal(scegliUltimoVerde([corsa('c3')], []), '');
  });

  test('corse rosse, annullate, in corso o di altri eventi e rami non contano', () => {
    const corse = [
      corsa('c5', 'failure'),
      corsa('c4', 'cancelled'),
      corsa('c3', null, { status: 'in_progress' }),
      corsa('c3', 'success', { status: 'in_progress' }),
      corsa('c2', 'success', { event: 'pull_request' }),
      corsa('c2', 'success', { head_branch: 'claude/prova' }),
      corsa('c1', 'success', { event: 'workflow_dispatch' }),
    ];
    assert.equal(scegliUltimoVerde(corse, MAIN), 'c1', 'un avvio a mano su main riuscito è un verde valido');
    assert.deepEqual([...corseVerdi(corse).keys()], ['c1']);
  });

  test('di più corse verdi sullo stesso commit si tiene la prima (la più nuova)', () => {
    const v = corseVerdi([corsa('c4', 'success', { html_url: 'nuova' }), corsa('c4', 'success', { html_url: 'vecchia' })]);
    assert.equal(v.get('c4').html_url, 'nuova');
  });
});

describe('la pubblicazione ferma', () => {
  test(`ferma: più di ${SOGLIA_ORE} ore, codice nuovo dopo l'ultima versione, niente di verde dopo di lei`, () => {
    assert.equal(rilascioFermo({ oreDallUltima: 49, commitDopoTag: 3, verdeDopoTag: false }), true);
  });

  test('non ferma: entro la soglia, senza codice nuovo, o con un verde da pubblicare', () => {
    assert.equal(rilascioFermo({ oreDallUltima: 47, commitDopoTag: 3, verdeDopoTag: false }), false);
    assert.equal(rilascioFermo({ oreDallUltima: 400, commitDopoTag: 0, verdeDopoTag: false }), false, 'niente da pubblicare non è un guasto');
    assert.equal(rilascioFermo({ oreDallUltima: 400, commitDopoTag: 3, verdeDopoTag: true }), false, 'c\'è un verde: la pubblicazione parte');
    assert.equal(rilascioFermo({ oreDallUltima: NaN, commitDopoTag: 3, verdeDopoTag: false }), false, 'età sconosciuta: non si inventa');
    assert.equal(rilascioFermo(), false);
  });

  test('il feedback dice da quanto, l\'ultimo verde e le ultime corse coi loro link; la chiave è una sola', () => {
    assert.equal(CHIAVE_FERMO, 'rilascio:fermo');
    const { titolo, testo } = testoRilascioFermo({
      tag: 'v0.2.228', oreDallUltima: 18 * 24 + 3, commitDopoTag: 412, verde: 'abc1234',
      corsaVerde: corsa('abc1234'), esecuzione: 'https://github.com/o/r/actions/runs/7',
      corse: [corsa('dddddddddd', 'failure'), corsa('eeeeeeeeee', null, { status: 'in_progress' })],
    });
    assert.match(titolo, /18 giorni/);
    assert.match(testo, /v0\.2\.228/);
    assert.match(testo, /412 commit/);
    assert.match(testo, /abc1234 \(https:\/\/github\.com\/o\/r\/actions\/runs\/abc1234\)/);
    assert.match(testo, /failure · ddddddddd · .* · https:\/\/github\.com\/o\/r\/actions\/runs\/dddddddddd/);
    assert.match(testo, /in_progress · eeeeeeeee/);
    assert.match(testo, /actions\/runs\/7/);
  });

  test('senza un verde, e senza corse lette, lo dice invece di tacere', () => {
    const { testo } = testoRilascioFermo({ tag: 'v1.0.0', oreDallUltima: 72, commitDopoTag: 2, verde: '', corse: [], erroreApi: 'HTTP 403' });
    assert.match(testo, /nessun commit verde/);
    assert.match(testo, /\(nessuna letta\)/);
    assert.match(testo, /HTTP 403/);
  });

  test('una corsa senza dati si scrive lo stesso, senza «undefined»', () => {
    assert.doesNotMatch(rigaCorsa({}), /undefined/);
  });
});
