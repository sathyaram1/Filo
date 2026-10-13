// I lavori server passati in cloud aspettano il PC (#1159): server:fondi per ognuno, un deploy per tutti, e la parte
// dell'app torna alle routine solo dopo il deploy. Dipendenze finte, niente rete né git veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusioniServer } from '../../scripts/lib/fusioni-server.mjs';
import { USCITA_SOLO_APP } from '../../scripts/server-fondi-pratica.mjs';
import { OPZIONI_DI, leggiArgomenti } from '../../scripts/orchestratore-locale.mjs';

function finte({ pratiche, commitApp = {}, fondi = 0, deploy = 0, fine = () => {} }) {
  const fatti = [];
  const dep = {
    radice: '/r',
    attese: async () => pratiche,
    log: (r) => fatti.push(`log ${r}`),
    esegui: async (cmd, args) => {
      const riga = `${cmd} ${args.join(' ')}`;
      fatti.push(riga);
      if (cmd === 'git' && args[0] === 'rev-list') {
        const ramo = args[2].split('refs/remotes/origin/').pop();
        return { code: 0, out: String(commitApp[ramo] || 0) };
      }
      if (cmd === 'node') return { code: typeof fondi === 'function' ? fondi(args) : fondi, out: 'uscita dello strumento' };
      return { code: 0, out: '' };
    },
    pubblica: async () => { fatti.push('server:pubblica'); return { code: deploy, out: 'deploy' }; },
    fineAttesa: async (id, opz) => { fatti.push(`fineAttesa ${id}${opz && opz.soloApp ? ' soloApp' : ''}`); fine(id, opz); },
  };
  return { dep, fatti };
}

const SOLO = { feedbackId: 'f1', seq: 50, subSeq: 0, branch: 'worker/f1-20261012T090000Z', parti: {} };
const CON_APP = { feedbackId: 'f2', seq: 51, subSeq: 2, branch: 'worker/f2-20261012T091500Z', parti: {} };

test('solo server: fonde con --solo-server, pubblica, e non riapre niente', async () => {
  const { dep, fatti } = finte({ pratiche: [SOLO] });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.equal(r.pubblicato, true);
  assert.ok(fatti.includes('node scripts/server-fondi-pratica.mjs worker/f1-20261012T090000Z --feedback f1 --solo-server'), fatti.join('\n'));
  assert.ok(fatti.includes('server:pubblica'));
  assert.ok(!fatti.some((f) => f.startsWith('fineAttesa')));
});

test('con la parte dell’app: fonde senza --solo-server, e la parte dell’app torna alle routine solo dopo il deploy', async () => {
  const { dep, fatti } = finte({ pratiche: [SOLO, CON_APP], commitApp: { 'worker/f2-20261012T091500Z': 3 } });
  const r = await fusioniServer(dep);
  assert.equal(r.pubblicato, true);
  assert.ok(fatti.includes('node scripts/server-fondi-pratica.mjs worker/f2-20261012T091500Z --feedback f2'), fatti.join('\n'));
  const deploy = fatti.indexOf('server:pubblica');
  assert.equal(fatti.filter((f) => f === 'server:pubblica').length, 1, 'un deploy solo per tutte');
  assert.ok(deploy > fatti.findLastIndex((f) => f.startsWith('node ')), 'il deploy dopo tutte le fusioni');
  assert.ok(fatti.indexOf('fineAttesa f2') > deploy, 'l’app riparte solo col server in produzione');
  assert.ok(!fatti.includes('fineAttesa f1'));
});

test('deploy fallito: niente torna alle routine, e si dice', async () => {
  const { dep, fatti } = finte({ pratiche: [CON_APP], commitApp: { 'worker/f2-20261012T091500Z': 1 }, deploy: 1 });
  const r = await fusioniServer(dep);
  assert.equal(r.pubblicato, false);
  assert.ok(!fatti.some((f) => f.startsWith('fineAttesa')));
  assert.match(r.ferme[0].motivo, /deploy del server non è andato/);
});

test('una fusione che si ferma non blocca le altre; a vuoto niente deploy né ritorni', async () => {
  const { dep, fatti } = finte({ pratiche: [SOLO, CON_APP], commitApp: { 'worker/f2-20261012T091500Z': 1 }, fondi: (args) => (args.includes('f1') ? 3 : 0) });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme.map((f) => f.num), ['50']);
  assert.match(r.ferme[0].motivo, /uscita 3/);
  assert.deepEqual(r.fuse.map((f) => f.id), ['f2']);
  assert.ok(fatti.includes('fineAttesa f2'));

  const prova = finte({ pratiche: [SOLO] });
  const p = await fusioniServer(prova.dep, { prova: true });
  assert.ok(prova.fatti.includes('node scripts/server-fondi-pratica.mjs worker/f1-20261012T090000Z --feedback f1 --solo-server --dry-run'));
  assert.equal(p.pubblicato, false);
  assert.ok(!prova.fatti.includes('server:pubblica'));
});

test('il server già su main (deploy mancato al giro prima): niente server:fondi, solo deploy e ritorno', async () => {
  const { dep, fatti } = finte({ pratiche: [{ ...CON_APP, parti: { server: 1 } }], commitApp: { 'worker/f2-20261012T091500Z': 2 } });
  const r = await fusioniServer(dep);
  assert.equal(r.pubblicato, true);
  assert.ok(!fatti.some((f) => f.startsWith('node ')));
  assert.ok(fatti.includes('fineAttesa f2'));
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

test('il ramo non c’è su filo-security: la parte dell’app torna alle routine senza deploy; senza app si ferma (#1159)', async () => {
  const soloApp = () => USCITA_SOLO_APP;
  const { dep, fatti } = finte({ pratiche: [CON_APP], commitApp: { 'worker/f2-20261012T091500Z': 3 }, fondi: soloApp });
  const r = await fusioniServer(dep);
  assert.deepEqual(r.ferme, []);
  assert.deepEqual(r.soloApp.map((x) => x.id), ['f2']);
  assert.ok(fatti.includes('fineAttesa f2 soloApp'), fatti.join('\n'));
  assert.ok(!fatti.includes('server:pubblica'), 'niente da pubblicare');

  const insieme = finte({ pratiche: [SOLO, CON_APP], commitApp: { 'worker/f2-20261012T091500Z': 3 }, fondi: (args) => (args.includes('f2') ? USCITA_SOLO_APP : 0) });
  const i = await fusioniServer(insieme.dep);
  assert.equal(i.pubblicato, true);
  assert.ok(insieme.fatti.includes('fineAttesa f2 soloApp'));
  assert.ok(!insieme.fatti.some((x) => x.startsWith('fineAttesa f1')));

  const vuota = finte({ pratiche: [SOLO], fondi: soloApp });
  const v = await fusioniServer(vuota.dep);
  assert.match(v.ferme[0].motivo, /né su filo-security né nell’app/);
  assert.ok(!vuota.fatti.some((x) => x.startsWith('fineAttesa')));

  const prova = finte({ pratiche: [CON_APP], commitApp: { 'worker/f2-20261012T091500Z': 3 }, fondi: soloApp });
  await fusioniServer(prova.dep, { prova: true });
  assert.ok(!prova.fatti.some((x) => x.startsWith('fineAttesa')), 'a vuoto non si rimanda niente');
});

test('orchestra -- fusioni-server: un comando suo, con --dry-run e nient’altro', () => {
  assert.ok(OPZIONI_DI['fusioni-server']);
  assert.equal(leggiArgomenti('fusioni-server', ['--dry-run']).opz.dryRun, true);
  assert.throws(() => leggiArgomenti('fusioni-server', ['--paralleli', '2']));
});
