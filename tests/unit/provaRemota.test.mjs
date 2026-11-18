// La prova degli unit che il finish sul PC dell'owner chiede a GitHub (#1497.3, D-185): scripts/lib/prova-remota.mjs, con
// un GitHub e un git finti. Il finish vero contro un GitHub finto sta in finishUnitLontane.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  repoDaOrigin, modoWindows, nomeCorsa, richiestaDispatch, corsaDallElenco, campoDalRegistro, provaDalCampo,
  avviaProvaRemota, attendiProvaRemota, tokenGitHub, apiGitHub, letturaRipetibile, PAUSE_RIPROVA_MS,
} from '../../scripts/lib/prova-remota.mjs';
import { giudizioRemoto } from '../../scripts/finish-local.mjs';
import { campoPerIlServer } from '../../scripts/lib/unit-sulla-fusione.mjs';

const R = 'a'.repeat(40);
const M = 'b'.repeat(40);

test('il repo si legge da origin, in tutte le forme di GitHub; il resto non è GitHub', () => {
  for (const u of ['https://github.com/o/filo.git', 'https://github.com/o/filo', 'git@github.com:o/filo.git', 'ssh://git@github.com/o/filo.git', 'https://x@github.com/o/filo.git/']) {
    assert.equal(repoDaOrigin(u), 'o/filo', u);
  }
  for (const u of ['', '/tmp/origin.git', 'https://gitlab.com/o/filo.git']) assert.equal(repoDaOrigin(u), '', u);
});

test('la richiesta porta la coppia, un nome di corsa nuovo e la parte Windows intera di default', () => {
  assert.equal(modoWindows(undefined), 'tutti');
  assert.equal(modoWindows('TOCCATI'), 'toccati');
  assert.equal(modoWindows('spento'), 'tutti', 'senza la parte Windows un ramo che contiene main non lo prova nessuno');
  const a = nomeCorsa({ ramo: R, main: M, ora: 1 });
  assert.notEqual(a, nomeCorsa({ ramo: R, main: M, ora: 2 }));
  assert.match(a, /^pc-a{12}-b{12}-/);
  assert.deepEqual(richiestaDispatch({ ramo: R, main: M, corsa: a }), { event_type: 'unit-fusione', client_payload: { ramo: R, main: M, corsa: a, windows: 'tutti' } });
});

test('la corsa si riconosce dal titolo, la più nuova se sono due', () => {
  const runs = [{ id: 1, display_title: 'unit-fusione x' }, { id: 3, display_title: 'unit-fusione x' }, { id: 4, display_title: 'unit-fusione xy' }];
  assert.equal(corsaDallElenco(runs, 'x').id, 3);
  assert.equal(corsaDallElenco(runs, 'z'), null);
  assert.equal(corsaDallElenco(undefined, 'x'), null);
});

test('l\'esito si legge dall\'ultima riga con la marca, tolto l\'orario; un\'altra coppia o niente riga non sono un esito', () => {
  const riga = (c) => `2026-11-16T07:00:00.1234567Z FILO-UNIT-FUSIONE ${JSON.stringify(c)}`;
  const reg = ['2026-11-16T07:00:00Z   FILO-UNIT-FUSIONE rientrata', riga({ ramo: R, main: M, esito: 'rosso_sulla_fusione' }), riga({ ramo: R, main: M, esito: 'verde', mainSha: M })].join('\n');
  assert.equal(campoDalRegistro(reg, { ramo: R, main: M }).esito, 'verde');
  assert.match(campoDalRegistro('niente', { ramo: R, main: M }).errore, /non c'è la riga/);
  assert.match(campoDalRegistro(riga({ ramo: R, main: R, esito: 'verde' }), { ramo: R, main: M }).errore, /un'altra coppia/);
  assert.match(campoDalRegistro(riga({ ramo: R, main: M, esito: 'boh' }), { ramo: R, main: M }).errore, /esito sconosciuto/);
  assert.match(campoDalRegistro('FILO-UNIT-FUSIONE {rotto', { ramo: R, main: M }).errore, /non si legge/);
});

test('la prova presa da GitHub va al server com\'è; una corsa che non ha provato è un errore', () => {
  const rossi = provaDalCampo({ ramo: R, main: M, esito: 'rosso_sulla_fusione', mainSha: M, rossi: ['t › x'], storia: { superficiale: false } }, { url: 'u' });
  assert.deepEqual(campoPerIlServer(rossi), { esito: 'rosso_sulla_fusione', mainSha: M, rossi: ['t › x'], storia: { superficiale: false } });
  const np = provaDalCampo({ ramo: R, main: M, esito: 'non_provata', motivo: 'windows: corsa failure' });
  assert.match(np.errore, /non ha provato la coppia \(windows: corsa failure\)/);
  assert.equal(campoPerIlServer(np).esito, 'non_provata');
});

test('il giudizio del finish: fondono solo verde e rosso uguale su main; il resto ferma, anche con --check', () => {
  const link = { remota: { url: 'https://github.com/o/r/actions/runs/1' } };
  assert.equal(giudizioRemoto({ prova: { esito: 'verde', mainSha: M, ...link } }).ferma, false);
  assert.match(giudizioRemoto({ prova: { esito: 'verde', mainSha: M }, rossiQui: true }).messaggio, /Quelli rossi qui sul tuo PC lassù passano/);
  assert.equal(giudizioRemoto({ prova: { esito: 'rosso_anche_su_main', mainSha: M } }).ferma, false);
  for (const prova of [{ errore: 'x' }, { esito: 'rosso_sulla_fusione', rossi: ['a'] }, { esito: 'conflitto', file: ['f'] }, { esito: 'main_contenuto' }, {}]) {
    const g = giudizioRemoto({ prova: { ...prova, ...link } });
    assert.equal(g.ferma, true, JSON.stringify(prova));
    assert.match(g.messaggio, /actions\/runs\/1/);
  }
  assert.match(giudizioRemoto({ prova: { errore: 'rete' } }).messaggio, /Sul tuo PC non li eseguo al posto suo/);
});

/** Un git finto per avviaProvaRemota: origin su GitHub, main a M. */
const gitFinto = (url = 'https://github.com/o/filo.git') => (args) => {
  if (args[0] === 'config') return url ? { ok: true, out: url } : { ok: false, out: '' };
  if (args[0] === 'fetch') return { ok: true, out: '' };
  if (args[0] === 'rev-parse') return { ok: true, out: M };
  return { ok: false, out: 'inatteso' };
};

test('avviaProvaRemota accende la corsa per la coppia giusta, e dice perché quando non può', async () => {
  const chiamate = [];
  const api = async (p, o = {}) => { chiamate.push([p, o]); return {}; };
  const a = await avviaProvaRemota({ root: '.', punta: R, git: gitFinto(), api, env: { FILO_FINISH_UNIT_WINDOWS: 'toccati' }, ora: 5 });
  assert.equal(a.errore, undefined);
  assert.deepEqual([a.repo, a.ramo, a.main], ['o/filo', R, M]);
  assert.equal(chiamate[0][0], 'repos/o/filo/dispatches');
  assert.deepEqual(chiamate[0][1].corpo.client_payload, { ramo: R, main: M, corsa: a.corsa, windows: 'toccati' });

  assert.match((await avviaProvaRemota({ root: '.', punta: R, git: gitFinto('/tmp/o.git'), api })).errore, /origin non è un repo di GitHub/);
  assert.match((await avviaProvaRemota({ root: '.', punta: 'corta', git: gitFinto(), api })).errore, /punta del ramo non valida/);
  const rifiuta = async () => { throw new Error('GitHub risponde 403'); };
  assert.match((await avviaProvaRemota({ root: '.', punta: R, git: gitFinto(), api: rifiuta })).errore, /GitHub non ha acceso la corsa \(GitHub risponde 403\)/);
  assert.equal(tokenGitHub({ GH_TOKEN: ' t1 ', GITHUB_TOKEN: 't2' }), 't1');
  assert.equal(tokenGitHub({ GITHUB_TOKEN: 't2' }), 't2');
});

/** Un orologio finto: ogni attesa lo sposta in avanti, senza dormire davvero. */
function orologio() {
  let t = 0;
  return { adesso: () => t, aspetta: async (ms) => { t += ms; } };
}

test('attendiProvaRemota aspetta la corsa finché finisce, poi legge l\'esito del lavoro che unisce', async () => {
  const o = orologio();
  let giri = 0;
  const api = async (p) => {
    if (p.includes('/runs?')) {
      giri++;
      if (giri < 3) return { workflow_runs: [] };
      return { workflow_runs: [{ id: 9, display_title: 'unit-fusione c1', status: giri < 6 ? 'in_progress' : 'completed', html_url: 'https://g/9' }] };
    }
    if (p.endsWith('/runs/9/jobs?per_page=100')) return { jobs: [{ id: 1, name: 'linux' }, { id: 2, name: 'unit' }] };
    if (p.endsWith('/jobs/2/logs')) return `2026-11-16T07:00:00Z FILO-UNIT-FUSIONE ${JSON.stringify({ ramo: R, main: M, esito: 'verde', mainSha: M })}\n`;
    throw new Error(`inatteso ${p}`);
  };
  const righe = [];
  const p = await attendiProvaRemota({ repo: 'o/filo', ramo: R, main: M, corsa: 'c1', api }, { ...o, scrivi: (s) => righe.push(s) });
  assert.deepEqual([p.esito, p.mainSha, p.remota.url], ['verde', M, 'https://g/9']);
  assert.equal(giri, 6);
});

test('attendiProvaRemota senza corsa, oltre il tetto o senza il lavoro dell\'esito: un errore, mai un esito', async () => {
  const vuoto = async () => ({ workflow_runs: [] });
  assert.match((await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: vuoto }, { ...orologio(), tettoPartenza: 60000, ogni: 30000 })).errore, /la corsa non compare/);
  const ferma = async () => ({ workflow_runs: [{ id: 1, display_title: 'unit-fusione c', status: 'queued' }] });
  assert.match((await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: ferma }, { ...orologio(), tettoCorsa: 90000, ogni: 30000, scrivi: () => {} })).errore, /non è finita/);
  const senzaUnit = async (p) => (p.includes('/runs?') ? { workflow_runs: [{ id: 1, display_title: 'unit-fusione c', status: 'completed', conclusion: 'cancelled' }] } : { jobs: [{ id: 3, name: 'linux' }] });
  assert.match((await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: senzaUnit }, orologio())).errore, /finita \(cancelled\) senza il lavoro che scrive l'esito/);
  const giu = async () => { throw new Error('GitHub risponde 502'); };
  assert.match((await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: giu }, orologio())).errore, /non riesco a leggere le corse su GitHub \(GitHub risponde 502\)/);
  assert.match((await attendiProvaRemota({ errore: 'x', main: M })).errore, /^x$/);
});
