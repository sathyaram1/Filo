// L'elenco del lavoro settimanale (#2501): i registri delle corse della suite diventano «quale prova è rossa, da quale
// fusione» e le instabili a parte. Un elenco sbagliato manda il lavoro settimanale a correggere la fusione sbagliata.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { leggiRegistro, rossiDaCorse, testoElenco } from '../../scripts/lib/rossiSuite.mjs';
import { righeRegistro, verdetto } from '../../scripts/suite-verdict.mjs';
import { leggiArgomenti, ordinaCorse, repoDaRemoto } from '../../scripts/rossi-della-suite.mjs';

const P = (n) => `tests/p${n}.spec.mjs › caso ${n}`;
const reg = (completo, rossi = [], instabili = []) => ({ completo, rossi: new Set(rossi), instabili: new Set(instabili) });
const corsa = (sha, registro) => ({ sha, url: `https://x/${sha}`, quando: sha, registro });

describe('il registro di una corsa', () => {
  test('dal verdetto al log e ritorno: esito, rossi nuovi e instabili, coi timestamp di GitHub davanti', () => {
    const json = { suites: [{ title: 'a.spec.mjs', file: 'a.spec.mjs', specs: [
      { title: 'rotto', line: 3, tests: [{ results: [{ status: 'failed' }], status: 'unexpected' }] },
      { title: 'ballerino', line: 9, tests: [{ results: [{ status: 'failed' }, { status: 'passed' }], status: 'flaky' }] },
      { title: 'buono', line: 12, tests: [{ results: [{ status: 'passed' }], status: 'expected' }] },
    ] }] };
    const v = verdetto(json, { contenitore: { specs: [] } });
    const log = righeRegistro(v).map((r) => `2026-11-14T12:03:36.2401834Z ${r}`).join('\n');
    const r = leggiRegistro(log);
    assert.equal(r.completo, true);
    assert.deepEqual([...r.rossi], ['tests/a.spec.mjs › rotto']);
    assert.deepEqual([...r.instabili], ['tests/a.spec.mjs › ballerino']);
  });

  test('una parte senza esito o il tetto fanno la corsa incompleta', () => {
    const r = leggiRegistro(righeRegistro({ nuovi: [{ titolo: 'parte 2 di 4', parteMancante: 2 }] }).join('\n'));
    assert.equal(r.completo, false);
    assert.equal(leggiRegistro(righeRegistro({ nuovi: [] }, { completo: false }).join('\n')).completo, false);
  });

  test('una corsa di prima del registro si legge dal riassunto a schermo', () => {
    const log = [
      '2026-11-14T12:03:36Z Casi: 10 · verdi: 9 · flaky (verdi dopo un tentativo): 0 · saltati: 0',
      '2026-11-14T12:03:36Z Rossi NUOVI: 1',
      `2026-11-14T12:03:36Z   ✗ ${P(1)}`,
      '2026-11-14T12:03:36Z AVVISI (teardown scaduti dopo un rosso noto, non fermano): 0',
    ].join('\n');
    const r = leggiRegistro(log);
    assert.deepEqual([...r.rossi], [P(1)]);
    assert.equal(r.completo, true);
  });

  test('un log senza verdetto non è una corsa verde', () => {
    assert.equal(leggiRegistro('Install dipendenze\nfallito'), null);
  });
});

describe('dalle corse all\'elenco', () => {
  test('la prova rossa adesso porta la prima corsa rossa della serie e l\'ultima verde prima', () => {
    const r = rossiDaCorse([
      corsa('a', reg(true, [])),
      corsa('b', reg(true, [P(1)])),
      corsa('c', reg(true, [P(1), P(2)])),
    ]);
    assert.deepEqual(r.rossi.map((x) => [x.prova, x.rottaDa.sha, x.ultimaVerde?.sha]), [[P(1), 'b', 'a'], [P(2), 'c', 'b']]);
  });

  test('una corsa incompleta non fa verde la prova che non ha girato', () => {
    const r = rossiDaCorse([corsa('a', reg(true, [])), corsa('b', reg(true, [P(1)])), corsa('c', reg(false, [])), corsa('d', reg(true, [P(1)]))]);
    assert.equal(r.rossi[0].rottaDa.sha, 'b');
    assert.equal(r.rossi[0].ultimaVerde.sha, 'a');
  });

  test('una prova tornata verde non è nell\'elenco', () => {
    const r = rossiDaCorse([corsa('a', reg(true, [P(1)])), corsa('b', reg(true, []))]);
    assert.deepEqual(r.rossi, []);
  });

  test('rossa e verde sullo stesso commit: instabile, non rossa', () => {
    const r = rossiDaCorse([corsa('a', reg(true, [])), corsa('b', reg(true, [])), corsa('b', reg(true, [P(3)]))]);
    assert.deepEqual(r.rossi, []);
    assert.deepEqual(r.instabili.map((x) => x.prova), [P(3)]);
  });

  test('le instabili di Playwright (verdi dopo un tentativo) vanno nel loro elenco, con le corse contate', () => {
    const r = rossiDaCorse([corsa('a', reg(true, [], [P(4)])), corsa('b', reg(true, [], [P(4)]))]);
    assert.deepEqual(r.instabili, [{ prova: P(4), corse: [{ sha: 'a', url: 'https://x/a' }, { sha: 'b', url: 'https://x/b' }] }]);
  });

  test('le corse senza registro si contano e non spezzano la serie', () => {
    const r = rossiDaCorse([corsa('a', reg(true, [])), corsa('b', reg(true, [P(1)])), corsa('c', null), corsa('d', reg(true, [P(1)]))]);
    assert.equal(r.senzaRegistro, 1);
    assert.equal(r.rossi[0].rottaDa.sha, 'b');
  });

  test('il testo nomina la prova, la corsa che l\'ha rotta e le fusioni in mezzo', () => {
    const r = rossiDaCorse([corsa('aaaa', reg(true, [])), corsa('bbbb', reg(true, [P(1)]))]);
    const t = testoElenco(r, { fusioni: (da, a) => (da === 'aaaa' && a === 'bbbb' ? ['bbbb finish: worker/x'] : []) });
    assert.match(t, /Prove rosse adesso: 1/);
    assert.match(t, new RegExp(`- ${P(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(t, /rossa dalla corsa su bbbb/);
    assert.match(t, /bbbb finish: worker\/x/);
  });
});

describe('la riga di comando', () => {
  test('opzioni, repo dal remoto e ordine di main', () => {
    assert.deepEqual(leggiArgomenti(['--giorni', '3', '--json']), { giorni: 3, json: true });
    assert.ok(leggiArgomenti(['--giorni', '0']).errore);
    assert.equal(repoDaRemoto('https://github.com/o/Filo.git'), 'o/Filo');
    assert.equal(repoDaRemoto('git@github.com:o/Filo'), 'o/Filo');
    const ord = ordinaCorse([{ sha: 'nuovo', quando: '1' }, { sha: 'vecchio', quando: '2' }], ['nuovo', 'vecchio']);
    assert.deepEqual(ord.map((c) => c.sha), ['vecchio', 'nuovo']);
  });
});
