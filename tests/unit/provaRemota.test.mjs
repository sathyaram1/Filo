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
  assert.match((await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: giu }, { ...orologio(), scrivi: () => {} })).errore, /non riesco a leggere le corse su GitHub \(GitHub risponde 502\)/);
  assert.match((await attendiProvaRemota({ errore: 'x', main: M })).errore, /^x$/);
});

/** Un errore come quelli di apiGitHub: col codice della risposta, o senza (rete, tempo scaduto). */
const errore = (status, testo = '') => Object.assign(new Error(`GitHub risponde ${status}${testo ? `: ${testo}` : ''}`), { status });

test('un intoppo passeggero di GitHub su una delle tre letture non ferma l\'attesa: si riprova e arriva l\'esito (#1737.1)', async () => {
  const o = orologio();
  const intoppi = { elenco: [errore(502)], jobs: [new TypeError('fetch failed')], registro: [errore(404, '{"message":"Not Found"}'), errore(503)] };
  const chiamate = { elenco: 0, jobs: 0, registro: 0 };
  const api = async (p) => {
    const quale = p.includes('/runs?') ? 'elenco' : p.endsWith('/jobs?per_page=100') ? 'jobs' : 'registro';
    chiamate[quale]++;
    if (intoppi[quale].length) throw intoppi[quale].shift();
    if (quale === 'elenco') return { workflow_runs: [{ id: 9, display_title: 'unit-fusione c1', status: 'completed', html_url: 'https://g/9' }] };
    if (quale === 'jobs') return { jobs: [{ id: 2, name: 'unit' }] };
    return `2026-11-16T07:00:00Z FILO-UNIT-FUSIONE ${JSON.stringify({ ramo: R, main: M, esito: 'verde', mainSha: M })}\n`;
  };
  const righe = [];
  const p = await attendiProvaRemota({ repo: 'o/filo', ramo: R, main: M, corsa: 'c1', api }, { ...o, scrivi: (s) => righe.push(s) });
  assert.equal(p.errore, undefined, p.errore);
  assert.deepEqual([p.esito, p.remota.url], ['verde', 'https://g/9']);
  assert.deepEqual(chiamate, { elenco: 2, jobs: 2, registro: 3 }, 'ogni lettura ripetuta finché risponde, nessuna corsa riaccesa');
  assert.equal(righe.filter((r) => /riprovo fra \d+ s/.test(r)).length, 4, righe.join('\n'));
  assert.match(righe.join('\n'), /il registro della corsa \(GitHub risponde 404[^)]*\): riprovo fra 10 s, tentativo 2 di 5/);
  assert.match(righe.join('\n'), /il registro della corsa \(GitHub risponde 503\): riprovo fra 30 s, tentativo 3 di 5/);
  assert.equal(o.adesso(), PAUSE_RIPROVA_MS[0] * 3 + PAUSE_RIPROVA_MS[1], 'le pause sono quelle dichiarate, dalla prima per ogni lettura');
});

test('GitHub giù davvero: dopo tutte le pause si arrende dicendo quante volte ha provato; una risposta definitiva ferma subito', async () => {
  const o = orologio();
  let n = 0;
  const giu = async () => { n++; throw errore(502); };
  const p = await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: giu }, { ...o, scrivi: () => {} });
  assert.match(p.errore, /non riesco a leggere le corse su GitHub \(GitHub risponde 502\), nemmeno dopo 5 tentativi/);
  assert.equal(n, PAUSE_RIPROVA_MS.length + 1);
  assert.equal(o.adesso(), PAUSE_RIPROVA_MS.reduce((a, b) => a + b, 0));

  for (const [status, testo] of [[401, 'Bad credentials'], [403, 'Resource not accessible by integration'], [422, 'x']]) {
    const t = orologio();
    let k = 0;
    const no = async () => { k++; throw errore(status, testo); };
    const q = await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: no }, { ...t, scrivi: () => {} });
    assert.match(q.errore, new RegExp(`GitHub risponde ${status}`));
    assert.doesNotMatch(q.errore, /tentativi/);
    assert.deepEqual([k, t.adesso()], [1, 0], `${status}: la stessa richiesta avrebbe la stessa risposta`);
  }
});

test('le pause dei tentativi restano dentro i tetti di tempo dell\'attesa', async () => {
  const o = orologio();
  let giri = 0;
  const api = async (p) => {
    if (p.includes('/runs?')) { giri++; return { workflow_runs: [{ id: 1, display_title: 'unit-fusione c', status: 'completed', html_url: 'https://g/1' }] }; }
    if (p.endsWith('/jobs?per_page=100')) return { jobs: [{ id: 2, name: 'unit' }] };
    throw errore(500);
  };
  const p = await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api }, { ...o, tettoCorsa: 45000, scrivi: () => {} });
  assert.match(p.errore, /non riesco a leggere il registro della corsa \(GitHub risponde 500\), nemmeno dopo 2 tentativi/);
  assert.equal(p.remota.url, 'https://g/1');
  assert.ok(o.adesso() <= 45000, `ha aspettato ${o.adesso()} ms oltre il tetto`);

  const t = orologio();
  const senzaCorsa = async () => { throw errore(502); };
  const q = await attendiProvaRemota({ repo: 'o/f', ramo: R, main: M, corsa: 'c', api: senzaCorsa }, { ...t, tettoPartenza: 20000, scrivi: () => {} });
  assert.match(q.errore, /nemmeno dopo 2 tentativi/);
  assert.ok(t.adesso() <= 20000, 'prima che la corsa compaia vale il tetto della partenza');
});

test('quali letture fallite si ripetono, e apiGitHub porta il codice della risposta', async () => {
  for (const e of [new TypeError('fetch failed'), Object.assign(new Error('timeout'), { name: 'TimeoutError' }), errore(404), errore(429), errore(500), errore(502), errore(503), errore(403, 'API rate limit exceeded for user'), errore(403, 'You have exceeded a secondary rate limit')]) {
    assert.equal(letturaRipetibile(e), true, e.message);
  }
  for (const e of [errore(400), errore(401, 'Bad credentials'), errore(403, 'Must have admin rights'), errore(410), errore(422)]) {
    assert.equal(letturaRipetibile(e), false, e.message);
  }
  const fetchImpl = async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });
  await assert.rejects(apiGitHub({ token: 't', base: 'http://x', fetchImpl })('repos/o/f/actions/jobs/1/logs'), (e) => e.status === 502 && /GitHub risponde 502 a GET/.test(e.message));
});
