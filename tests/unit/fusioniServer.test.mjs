// I lavori server passati in cloud aspettano il PC (#1159), nell'ordine del cancello (#1222): prima la parte dell'app,
// poi server:fondi che chiude la pratica, un deploy per tutti. Con un server di prima, l'ordine di prima: server, deploy,
// app. Dipendenze finte, niente rete né git veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusioniServer } from '../../scripts/lib/fusioni-server.mjs';
import { USCITA_CONFLITTO_MAIN, USCITA_SOLO_APP } from '../../scripts/server-fondi-pratica.mjs';
import { OPZIONI_DI, leggiArgomenti } from '../../scripts/orchestratore-locale.mjs';

const SCONOSCIUTA = () => { throw new Error('op_sconosciuta: op ammesse: prendi, sporca'); };

function finte({ pratiche, commitApp = {}, fondi = 0, deploy = 0, fine = () => {}, app = () => ({ result: 'merged', sha: 'e'.repeat(40) }), filo = true }) {
  const fatti = [];
  const env = {};
  const dep = {
    radice: '/r',
    attese: async () => pratiche,
    log: (r) => fatti.push(`log ${r}`),
    esegui: async (cmd, args, o = {}) => {
      const riga = `${cmd} ${args.join(' ')}`;
      fatti.push(riga);
      if (o.env) env[riga] = o.env.FILO_PUBLIC_REPO;
      if (cmd === 'git' && args[0] === 'rev-list') {
        const ramo = args[2].split('refs/remotes/origin/').pop();
        return { code: 0, out: String(commitApp[ramo] || 0) };
      }
      if (cmd === 'node') return { code: typeof fondi === 'function' ? fondi(args) : fondi, out: 'uscita dello strumento' };
      return { code: 0, out: '' };
    },
    fondiApp: async (id) => { fatti.push(`fondiApp ${id}`); return app(id); },
    filoDiMain: async () => { fatti.push('filoDiMain'); return filo ? { dir: '/tmp/filo-main', togli: async () => { fatti.push('togli filo'); } } : null; },
    pubblica: async () => { fatti.push('server:pubblica'); return { code: deploy, out: 'deploy' }; },
    fineAttesa: async (id, opz) => { fatti.push(`fineAttesa ${id}${opz && opz.soloApp ? ' soloApp' : ''}${opz && opz.riallinea ? ' riallinea' : ''}`); fine(id, opz); },
  };
  return { dep, fatti, env };
}

const SOLO = { feedbackId: 'f1', seq: 50, subSeq: 0, branch: 'worker/f1-20261012T090000Z', parti: {} };
const CON_APP = { feedbackId: 'f2', seq: 51, subSeq: 2, branch: 'worker/f2-20261012T091500Z', parti: {} };
const APP2 = { 'worker/f2-20261012T091500Z': 3 };
const FONDI_F1 = 'node scripts/server-fondi-pratica.mjs worker/f1-20261012T090000Z --feedback f1 --solo-server';
const FONDI_F2 = 'node scripts/server-fondi-pratica.mjs worker/f2-20261012T091500Z --feedback f2';
const PROVA_F2 = `${FONDI_F2} --dry-run`;

test('solo server: fonde con --solo-server, pubblica, e non riapre niente', async () => {
  const { dep, fatti } = finte({ pratiche: [SOLO] });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.equal(r.pubblicato, true);
  assert.ok(fatti.includes(FONDI_F1), fatti.join('\n'));
  assert.ok(fatti.includes('server:pubblica'));
  assert.ok(!fatti.some((f) => f.startsWith('fineAttesa') || f.startsWith('fondiApp') || f === 'filoDiMain'));
});

test('con la parte dell’app: prova a vuoto del server, poi l’app col cancello, poi server:fondi su main di Filo appena fuso, un deploy', async () => {
  const { dep, fatti, env } = finte({ pratiche: [SOLO, CON_APP], commitApp: APP2 });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.equal(r.pubblicato, true);
  const i = (f) => fatti.indexOf(f);
  assert.ok(i(PROVA_F2) >= 0 && i(PROVA_F2) < i('fondiApp f2'), 'l’app va su main solo dopo che il server a vuoto dice sì');
  assert.ok(i('fondiApp f2') < i(FONDI_F2), 'prima l’app, poi il server');
  assert.ok(i(FONDI_F2) < i('server:pubblica'), 'il deploy dopo tutte le fusioni');
  assert.equal(fatti.filter((f) => f === 'server:pubblica').length, 1, 'un deploy solo per tutte');
  // Le prove di server:fondi leggono main di Filo con la parte dell'app, non il checkout di questo PC.
  assert.equal(env[FONDI_F2], '/tmp/filo-main');
  assert.equal(env[FONDI_F1], '/tmp/filo-main');
  assert.ok(i('togli filo') > i(FONDI_F2));
  // La pratica la chiude server:fondi (l'app è l'ultima parte già su main): niente torna alle routine.
  assert.ok(!fatti.some((f) => f.startsWith('fineAttesa')), fatti.join('\n'));
  assert.deepEqual(r.fuse.map((f) => [f.id, f.appPrima]), [['f1', false], ['f2', true]]);
});

test('la parte dell’app non si fonde: il server resta fuori da main, e il seguito l’ha già dato il cancello', async () => {
  for (const [esito, testo] of [['blocked', /L5 l’ha fermata/], ['conflict', /torna alle routine per il riallineamento/], ['rifiutata', /il cancello la rifiuta/], ['guasto', /Si riprova al prossimo giro/]]) {
    const { dep, fatti } = finte({ pratiche: [CON_APP], commitApp: APP2, app: () => ({ result: esito, detail: 'perché' }) });
    const r = await fusioniServer(dep);
    assert.equal(r.ferme.length, 1, esito);
    assert.match(r.ferme[0].motivo, /la parte dell’app non si è fusa/);
    assert.match(r.ferme[0].motivo, testo);
    assert.ok(!fatti.includes(FONDI_F2), `${esito}: niente server:fondi vero`);
    assert.ok(!fatti.includes('server:pubblica'));
    assert.ok(!fatti.some((f) => f.startsWith('fineAttesa')));
  }
  // Una rete che cade: si dice, e si riprova al giro dopo.
  const giu = finte({ pratiche: [CON_APP], commitApp: APP2, app: () => { throw new Error('rete giù'); } });
  const g = await fusioniServer(giu.dep);
  assert.match(g.ferme[0].motivo, /non si è fusa \(rete giù\)/);
  assert.ok(!giu.fatti.includes(FONDI_F2));
});

test('server:fondi a vuoto che dice no: l’app non va su main (conflitto → routine, ramo assente → app al cancello, altro → fermo)', async () => {
  const conflitto = finte({ pratiche: [CON_APP], commitApp: APP2, fondi: () => USCITA_CONFLITTO_MAIN });
  const c = await fusioniServer(conflitto.dep);
  assert.deepEqual(c.riallineate.map((x) => x.id), ['f2']);
  assert.ok(!conflitto.fatti.includes('fondiApp f2'));
  assert.ok(conflitto.fatti.includes('fineAttesa f2 riallinea'));
  const assente = finte({ pratiche: [CON_APP], commitApp: APP2, fondi: () => USCITA_SOLO_APP });
  const a = await fusioniServer(assente.dep);
  assert.deepEqual(a.soloApp.map((x) => x.id), ['f2']);
  assert.ok(!assente.fatti.includes('fondiApp f2'));
  assert.ok(assente.fatti.includes('fineAttesa f2 soloApp'));
  assert.ok(!assente.fatti.includes('server:pubblica'), 'niente da pubblicare');
  const fermo = finte({ pratiche: [CON_APP], commitApp: APP2, fondi: () => 3 });
  const f = await fusioniServer(fermo.dep);
  assert.match(f.ferme[0].motivo, /a vuoto, quindi la parte dell’app resta fuori da main: server:fondi non ha fuso \(uscita 3\)/);
  assert.ok(!fermo.fatti.includes('fondiApp f2'));
});

test('app fusa e server:fondi vero che si ferma: si dice che l’app è già su main, e il giro dopo riprova solo il server', async () => {
  const { dep, fatti } = finte({ pratiche: [CON_APP], commitApp: APP2, fondi: (args) => (args.includes('--dry-run') ? 0 : 1) });
  const r = await fusioniServer(dep);
  assert.match(r.ferme[0].motivo, /la parte dell’app è già su main di Filo, il server no: server:fondi non ha fuso \(uscita 1\)/);
  assert.ok(fatti.includes('togli filo'));
  assert.ok(!fatti.includes('server:pubblica'));
  // Main del server mosso fra la prova e la fusione: il ramo torna alle routine, e si dice che l'app è su main.
  const mosso = finte({ pratiche: [CON_APP], commitApp: APP2, fondi: (args) => (args.includes('--dry-run') ? 0 : USCITA_CONFLITTO_MAIN) });
  const m = await fusioniServer(mosso.dep);
  assert.deepEqual(m.riallineate.map((x) => x.id), ['f2']);
  assert.match(m.ferme[0].motivo, /l’app su main parla col server di prima/);
});

test('main di Filo che non si legge in una cartella sua: server:fondi legge il checkout del PC, e lo si dice', async () => {
  const { dep, fatti, env } = finte({ pratiche: [CON_APP], commitApp: APP2, filo: false });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.ok(fatti.includes(FONDI_F2));
  assert.equal(env[FONDI_F2], undefined);
  assert.ok(fatti.some((f) => /le prove del server leggono il checkout di questo PC/.test(f)));
});

test('server che non conosce fondiApp: l’ordine di prima, server, deploy e poi l’app al cancello', async () => {
  const altra = { ...CON_APP, feedbackId: 'f3', seq: 52, branch: 'worker/f3-20261012T092000Z' };
  const { dep, fatti } = finte({ pratiche: [CON_APP, altra], commitApp: { ...APP2, 'worker/f3-20261012T092000Z': 1 }, app: SCONOSCIUTA });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.equal(fatti.filter((f) => f.startsWith('fondiApp')).length, 1, 'chiesto una volta sola');
  assert.ok(fatti.includes(FONDI_F2));
  assert.ok(!fatti.includes('filoDiMain'));
  const deploy = fatti.indexOf('server:pubblica');
  assert.ok(fatti.indexOf('fineAttesa f2') > deploy, 'l’app riparte solo col server in produzione');
  assert.ok(fatti.indexOf('fineAttesa f3') > deploy);
});

test('deploy fallito: si dice, e per le parti dell’app già su main si chiede di ripubblicare presto', async () => {
  const { dep, fatti } = finte({ pratiche: [CON_APP], commitApp: APP2, deploy: 1 });
  const r = await fusioniServer(dep);
  assert.equal(r.pubblicato, false);
  assert.match(r.ferme[0].motivo, /deploy del server non è andato \(la parte dell’app di #51\.2 è già su main: rilancia npm run server:pubblica presto\)/);
  assert.ok(!fatti.some((f) => f.startsWith('fineAttesa')));
  // Con l'ordine di prima la parte dell'app resta ferma.
  const vecchio = finte({ pratiche: [CON_APP], commitApp: APP2, deploy: 1, app: SCONOSCIUTA });
  const v = await fusioniServer(vecchio.dep);
  assert.match(v.ferme[0].motivo, /deploy del server non è andato:/);
  assert.ok(!vecchio.fatti.some((f) => f.startsWith('fineAttesa')));
});

test('una fusione che si ferma non blocca le altre; a vuoto niente app, niente deploy né ritorni', async () => {
  const { dep, fatti } = finte({ pratiche: [SOLO, CON_APP], commitApp: APP2, fondi: (args) => (args.includes('f1') ? 3 : 0) });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme.map((f) => f.num), ['50']);
  assert.match(r.ferme[0].motivo, /uscita 3/);
  assert.deepEqual(r.fuse.map((f) => f.id), ['f2']);
  assert.ok(fatti.includes('server:pubblica'));

  const prova = finte({ pratiche: [SOLO, CON_APP], commitApp: APP2 });
  const p = await fusioniServer(prova.dep, { prova: true });
  assert.ok(prova.fatti.includes(`${FONDI_F1} --dry-run`));
  assert.ok(prova.fatti.includes(PROVA_F2));
  assert.ok(!prova.fatti.some((f) => f.startsWith('fondiApp') || f === 'filoDiMain' || f === 'server:pubblica' || f.startsWith('fineAttesa')));
  assert.equal(p.pubblicato, false);
  assert.ok(prova.fatti.some((f) => /#51\.2 a vuoto: prima la parte dell’app \(3 commit\) col cancello, poi server:fondi/.test(f)));
});

test('il server già su main (fuso prima di #1222, deploy mancato): niente server:fondi, solo deploy e poi l’app al cancello', async () => {
  const { dep, fatti } = finte({ pratiche: [{ ...CON_APP, parti: { server: 1 } }], commitApp: { 'worker/f2-20261012T091500Z': 2 } });
  const r = await fusioniServer(dep);
  assert.equal(r.pubblicato, true);
  assert.ok(!fatti.some((f) => f.startsWith('node ') || f.startsWith('fondiApp')));
  assert.ok(fatti.indexOf('fineAttesa f2') > fatti.indexOf('server:pubblica'));
});

test('lavoro con l’app già fusa dal cancello e il server rifiutato: server:fondi da solo, che chiude la pratica', async () => {
  const { dep, fatti } = finte({ pratiche: [{ ...CON_APP, parti: { app: 1 } }] });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.ok(fatti.includes(`${FONDI_F2} --solo-server`), fatti.join('\n'));
  assert.ok(!fatti.some((f) => f.startsWith('fondiApp') || f.startsWith('fineAttesa')));
});

test('ramo storto: fermo, senza lanciare niente; nessuna pratica: niente deploy', async () => {
  const { dep, fatti } = finte({ pratiche: [{ ...SOLO, branch: 'main' }] });
  const r = await fusioniServer(dep);
  assert.match(r.ferme[0].motivo, /ramo non valido/);
  assert.ok(!fatti.includes('server:pubblica'));
  const vuoto = finte({ pratiche: [] });
  assert.equal((await fusioniServer(vuoto.dep)).pubblicato, false);
  assert.ok(!vuoto.fatti.includes('server:pubblica'));
});

test('solo server senza ramo né app: decide l’owner; il riallineamento che non torna alle routine si dice', async () => {
  const vuota = finte({ pratiche: [SOLO], fondi: () => USCITA_SOLO_APP });
  const v = await fusioniServer(vuota.dep);
  assert.match(v.ferme[0].motivo, /né su filo-security né nell’app/);
  assert.ok(!vuota.fatti.some((x) => x.startsWith('fineAttesa')));
  const vecchio = finte({ pratiche: [CON_APP], commitApp: APP2, fondi: () => USCITA_CONFLITTO_MAIN, fine: () => { throw new Error('server_non_fuso'); } });
  const r = await fusioniServer(vecchio.dep);
  assert.match(r.ferme[0].motivo, /conflitto con main.*non è tornata alle routine/);
});

test('orchestra -- fusioni-server: un comando suo, con --dry-run e nient’altro', () => {
  assert.ok(OPZIONI_DI['fusioni-server']);
  assert.equal(leggiArgomenti('fusioni-server', ['--dry-run']).opz.dryRun, true);
  assert.throws(() => leggiArgomenti('fusioni-server', ['--paralleli', '2']));
});

// ── Fase 2: il deploy lo fa GitHub ──────────────────────────────────────────

test('deploy da GitHub: niente server:pubblica dal PC, e la pratica la chiude server:fondi', async () => {
  for (const deployDaActions of [{ verdiDiFila: 2, affidabile: true }, { verdiDiFila: 0, affidabile: false, ultimoVerde: '' }]) {
    const { dep, fatti } = finte({ pratiche: [], commitApp: APP2 });
    dep.attese = async () => ({ pratiche: [SOLO, CON_APP], deployDaActions });
    const r = await fusioniServer(dep);
    assert.equal(r.daGitHub, true);
    assert.equal(r.pubblicato, false);
    assert.deepEqual(r.ferme, []);
    assert.ok(!fatti.includes('server:pubblica'), fatti.join('\n'));
    assert.ok(fatti.indexOf('fondiApp f2') < fatti.indexOf(FONDI_F2));
    assert.ok(!fatti.some((f) => f.startsWith('fineAttesa')));
    assert.ok(fatti.some((f) => /la pubblicazione la fa GitHub \(deploy\.yml\)/.test(f)));
  }
  // Il server già su main da prima: la parte dell'app riparte subito, la pubblicazione è già partita da GitHub.
  const { dep, fatti } = finte({ pratiche: [], commitApp: APP2 });
  dep.attese = async () => ({ pratiche: [{ ...CON_APP, parti: { server: 1 } }], deployDaActions: { affidabile: true } });
  await fusioniServer(dep);
  assert.ok(fatti.includes('fineAttesa f2'));
  assert.ok(!fatti.includes('server:pubblica'));
});

test('stato delle corse assente (server di prima, o deploy.yml non su main): pubblica il PC come prima', async () => {
  for (const lette of [{ pratiche: [CON_APP], deployDaActions: null }, [CON_APP]]) {
    const { dep, fatti } = finte({ pratiche: [], commitApp: APP2 });
    dep.attese = async () => lette;
    const r = await fusioniServer(dep);
    assert.equal(r.daGitHub, false);
    assert.equal(r.pubblicato, true);
    assert.ok(fatti.includes('server:pubblica'));
  }
});
