// La riga di comando del manutentore col server finto (SPEC-MANUTENTORE § 3, § 5): gli strumenti della sessione in
// cloud, un taccuino vuoto che non cancella niente, il biglietto fuori dai testi scritti, la riga d'errore e gli elenchi
// del rilascio, le promesse del redattore. Niente rete: fetch è finto nel processo figlio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import '../helpers/senzaSessione.mjs';
import { writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as M from '../../scripts/manutentore.mjs';
import { rigaErrore, dentroBudget } from '../../scripts/session-report.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULO = pathToFileURL(join(REPO, 'scripts', 'manutentore.mjs')).href;

function lancia(argv, risposte = {}, input = '', envExtra = {}) {
  const root = cartellaTemporanea('filo-manutentore-');
  const codice = `
    const M = await import(${JSON.stringify(MODULO)});
    const R = ${JSON.stringify(risposte)};
    globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); console.log('INVIATO ' + JSON.stringify({ op: b.op, dati: b.dati, cred: b.passphrase ? 'chiave' : 'biglietto' })); return { status: 200, ok: true, text: async () => JSON.stringify(R[b.op] || { ok: true, versione: 4 }) }; };
    process.exitCode = await M.main(${JSON.stringify(argv)}, { env: ${JSON.stringify({ FILO_MANUTENTORE_KEY: 'k', ...envExtra })}, root: ${JSON.stringify(root)} });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codice], { input, encoding: 'utf8', cwd: root });
  const inviati = r.stdout.split('\n').filter((l) => l.startsWith('INVIATO ')).map((l) => JSON.parse(l.slice(8)));
  return { status: r.status, out: r.stdout + r.stderr, inviati, root };
}

test('con la sola chiave il manutentore apre feedback e domande e scrive la domanda di fine turno', () => {
  const f = lancia(['feedback', 'Il registro dei guasti non si legge', '-', '--priorita', '1'], { feedback: { ok: true, numero: '2001' } }, 'Passi: …');
  assert.deepEqual(f.inviati, [{ op: 'feedback', dati: { titolo: 'Il registro dei guasti non si legge', testo: 'Passi: …', priorita: 1 }, cred: 'chiave' }]);
  assert.match(f.out, /Aperto #2001/);
  const vuoto = lancia(['feedback', 'Titolo', '-']);
  assert.notEqual(vuoto.status, 0);
  assert.deepEqual(vuoto.inviati, []);
  // Una priorità che non è un intero da 0 a 3 non parte: arriverebbe come null, e il feedback nascerebbe a 0.
  for (const p of ['alta', '', '7', '2.5']) {
    const storta = lancia(['feedback', 'Titolo', '-', '--priorita', p], {}, 'Testo.');
    assert.notEqual(storta.status, 0, `--priorita «${p}»`);
    assert.deepEqual(storta.inviati, [], `--priorita «${p}»`);
  }

  const file = join(cartellaTemporanea('filo-domanda-'), 'd.json');
  writeFileSync(file, JSON.stringify({ titolo: 'Quale account prima', priorita: 'quando_puoi' }));
  const d = lancia(['domanda', file], { domanda: { ok: true, domanda: 'D-9' } });
  assert.deepEqual(d.inviati.map((x) => x.op), ['domanda']);
  assert.equal(d.inviati[0].dati.domanda.titolo, 'Quale account prima');

  const fine = lancia(['domanda-fine', 'verifier', '-'], { 'domanda.fine': { ok: true, slot: 'verifier' } }, 'Quale strumento ti ha fatto aspettare?');
  assert.deepEqual(fine.inviati, [{ op: 'domanda.fine', dati: { slot: 'verifier', testo: 'Quale strumento ti ha fatto aspettare?' }, cred: 'chiave' }]);
  const togli = lancia(['domanda-fine', 'verifier', '--togli'], { 'domanda.fine': { ok: true, slot: 'verifier' } });
  assert.equal(togli.inviati[0].dati.testo, null);
});

// #2217: il segno «lavoro server» lo manda chi apre, e un server che non lo conferma non lo perde in silenzio.
test('feedback e pacchetto con --server mandano il segno lavoro server, e dicono se il server non l\'ha messo', () => {
  const f = lancia(['feedback', 'Il pacemaker sbaglia', '-', '--server', '--priorita', '3'], { feedback: { ok: true, numero: '2215', fiducia: 'non fidato', lavoroServer: true } }, 'Tutto in functions/src.');
  assert.equal(f.status, 0);
  assert.deepEqual(f.inviati, [{ op: 'feedback', dati: { titolo: 'Il pacemaker sbaglia', testo: 'Tutto in functions/src.', priorita: 3, lavoroServer: true }, cred: 'chiave' }]);
  assert.match(f.out, /Aperto #2215 \(non fidato\)\.\nSegnato lavoro server/);
  const alias = lancia(['feedback', 'Titolo', '-', '--lavoro-server'], { feedback: { ok: true, numero: '2216' } }, 'Testo.');
  assert.equal(alias.inviati[0].dati.lavoroServer, true);
  assert.equal(alias.inviati[0].dati.titolo, 'Titolo', 'l\'opzione non finisce nel titolo');
  assert.match(alias.out, /SEGNO NON MESSO[\s\S]*non riaprirlo/);
  const senza = lancia(['feedback', 'Titolo', '-'], { feedback: { ok: true, numero: '2218' } }, 'Testo.');
  assert.equal('lavoroServer' in senza.inviati[0].dati, false);
  assert.doesNotMatch(senza.out, /lavoro server|SEGNO/);
  // Un'opzione storpiata sparirebbe dal titolo e il feedback nascerebbe senza segno: non parte.
  const storta = lancia(['feedback', 'Titolo', '-', '--sever'], {}, 'Testo.');
  assert.notEqual(storta.status, 0);
  assert.deepEqual(storta.inviati, []);
  assert.match(storta.out, /non conosce --sever/);

  const p = lancia(['pacchetto', '2220', '2215,2216', '--server'], { pacchetto: { ok: true, pacchetto: '2220', unisce: ['2215', '2216'], lavoroServer: true } });
  assert.deepEqual(p.inviati, [{ op: 'pacchetto', dati: { numero: '2220', unisce: ['2215', '2216'], lavoroServer: true }, cred: 'chiave' }]);
  assert.match(p.out, /Segnato lavoro server/);
  const pSenza = lancia(['pacchetto', '2220', '2215,2216'], { pacchetto: { ok: true, pacchetto: '2220', unisce: ['2215', '2216'] } });
  assert.deepEqual(pSenza.inviati[0].dati, { numero: '2220', unisce: ['2215', '2216'] });
});

// #2217 giro 1: il segno con l'uguale non lo accende `vuoleServer`, quindi si rifiuta invece di perderlo in silenzio.
test('--server=valore non parte: il segno non prende valori', () => {
  for (const argv of [['feedback', 'Titolo', '-', '--server=true'], ['pacchetto', '2220', '2215', '--lavoro-server=si']]) {
    const r = lancia(argv, {}, 'Testo.');
    assert.notEqual(r.status, 0, argv.join(' '));
    assert.deepEqual(r.inviati, []);
    assert.match(r.out, /--server non prende valori/);
  }
});

// #2217 giro 2: `npm run manutentore feedback … --server` senza il doppio trattino: npm si prende l'opzione.
test('le opzioni che npm si è preso si riprendono dall\'ambiente e si dice; un valore scivolato non parte', () => {
  const f = lancia(['feedback', 'Titolo', '-'], { feedback: { ok: true, numero: '2230', lavoroServer: true } }, 'Testo.', { npm_config_server: 'true', npm_config_priorita: '2' });
  assert.equal(f.status, 0, f.out);
  assert.deepEqual(f.inviati[0].dati, { titolo: 'Titolo', testo: 'Testo.', priorita: 2, lavoroServer: true });
  assert.match(f.out, /finite a npm invece che a me/);
  const p = lancia(['pacchetto', '2220', '2215'], { pacchetto: { ok: true, pacchetto: '2220', unisce: ['2215'], lavoroServer: true } }, '', { npm_config_lavoro_server: 'true' });
  assert.equal(p.inviati[0].dati.lavoroServer, true, p.out);
  // `--priorita 2` spezzato da npm: il 2 finirebbe nel titolo.
  const s = lancia(['feedback', 'Titolo', '2', '-'], {}, 'Testo.', { npm_config_priorita: 'true' });
  assert.notEqual(s.status, 0);
  assert.deepEqual(s.inviati, []);
  assert.match(s.out, /--priorita=<valore>/);
});

test('la riga sul segno dice se aspetta il timbro dell\'owner', () => {
  assert.match(M.rigaSegnoServer(true, { lavoroServer: true, fiducia: 'fidato' }), /è fidato, lo prendono i lavori server/);
  assert.match(M.rigaSegnoServer(true, { lavoroServer: true, fiducia: 'non_fidato' }), /non fidato: va nei Ricevuti/);
  assert.match(M.rigaSegnoServer(true, { lavoroServer: true }), /non fidato: va nei Ricevuti/);
  assert.equal(M.rigaSegnoServer(false, { lavoroServer: true }), '');
});

test('registro, spesa e domande ferme vengono dalla chiave del manutentore, non dalle credenziali dell\'owner', () => {
  const r = lancia(['registro', 'account', 'quote'], { registro: { ok: true, voci: [{ id: 'D-3', titolo: 'Prima B', principio: 'Si usa B prima di A.' }] } });
  assert.deepEqual(r.inviati, [{ op: 'registro', dati: { parole: 'account quote' }, cred: 'chiave' }]);
  assert.match(r.out, /D-3 «Prima B»: Si usa B prima di A\./);
  const s = lancia(['spesa'], { spesa: { ok: true, accounts: { B: { usdSettimana: 41.5, pct: 38, settimanaDaMs: Date.parse('2026-10-28T09:00:00Z'), rinnovoAtMs: Date.parse('2026-11-04T09:00:00Z') } } } });
  assert.match(s.out, /- B: 41\.50 \$ dal 2026-10-28 09:00, 38% della quota, rinnovo 2026-11-04 09:00\./);
  assert.match(M.righeSpesa({ ok: false, reason: 'server_error' })[0], /^Non letta: server_error: decidi senza/);
});

test('un taccuino vuoto da stdin non parte: lo cancellerebbe', () => {
  const r = lancia(['taccuino', 'scrivi', '-', '--versione', '3'], {}, '  \n');
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.inviati, []);
  assert.match(r.out, /RIFIUTATO: il taccuino da stdin è vuoto/);
  const pieno = lancia(['taccuino', 'scrivi', '-', '--versione', '3'], { 'taccuino.scrivi': { ok: true, versione: 4 } }, 'stato: N 4');
  assert.deepEqual(pieno.inviati, [{ op: 'taccuino.scrivi', dati: { testo: 'stato: N 4', versione: 3 }, cred: 'chiave' }]);
});

test('il biglietto passato con --ticket non entra nei testi scritti', () => {
  const i = lancia(['indicazione', 'priorità', 'alla', 'grafica', '--ticket', 'SEGRETO123'], { taccuino: { ok: true, testo: '', versione: 0 } });
  const scritto = i.inviati.find((x) => x.op === 'taccuino.scrivi');
  assert.ok(scritto, i.out);
  assert.match(scritto.dati.testo, /priorità alla grafica/);
  assert.doesNotMatch(JSON.stringify(i.inviati), /SEGRETO123/);
  assert.equal(i.inviati[0].cred, 'biglietto', 'il biglietto vale come credenziale, non come testo');
  assert.deepEqual(M.richiestaSblocca(['812', '--ticket', 'SEGRETO456']), { ok: true, numero: '812', testo: '' });
  assert.deepEqual(M.richiestaSblocca(['812', 'registro', 'riparato', '--ticket', 'X']), { ok: true, numero: '812', testo: 'registro riparato' });
});

test('un\'attesa già messa dice i suoi numeri', () => {
  const r = lancia(['attesa', '812', '815'], { attesa: { ok: true, gia: true } });
  assert.match(r.out, /#812 aspettava già #815\./);
});

test('la riga d\'errore dice perché, non cosa si lanciava', () => {
  assert.equal(rigaErrore('Exit code 1\n\n> filo@0.2.254 test:unit\n> node --test\n\nnot ok 3 - il taccuino\nError: atteso 2'), 'exit 1: not ok 3 - il taccuino');
  assert.equal(rigaErrore('Exit code 128\nTo github.com:x/y.git\n ! [rejected] ramo -> ramo (non-fast-forward)\nerror: failed to push'), 'exit 128: ! [rejected] ramo -> ramo (non-fast-forward)');
  assert.equal(rigaErrore('Exit code 1\nnpm warn config production\nnpm ERR! missing script: x'), 'exit 1: npm ERR! missing script: x');
  assert.equal(rigaErrore('Exit code 127\nnode: not found'), 'exit 127: node: not found');
  assert.equal(rigaErrore('Exit code 1\nqualcosa di strano'), 'exit 1: qualcosa di strano');
});

test('gli elenchi del rilascio tengono quanto il server accetta', () => {
  const voci = Array.from({ length: 250 }, (_, i) => ({ strumento: 'Bash', errore: `exit 1: Error: expect(locator).toBeVisible() failed ${i}`, dopo: 'riprovato diverso: npx playwright test tests/x.spec.mjs' }));
  assert.equal(dentroBudget(voci.slice(0, 40)).length, 40);
  assert.equal(dentroBudget(voci).length, 200);
});

test('una promessa scritta con parole comuni senza il suo lavoro nella rosa si rifiuta', () => {
  const blocco = { version: '0.2.255', features: [{ testo: 'Le schede si trascinano.' }], fixes: [] };
  const schede = [{ num: '812', priorita: 2 }, { num: '900', priorita: 1 }];
  const prova = (riga, promesse) => M.controllaNovita({ versione: '0.2.255', features: [riga], fixes: [], ...(promesse ? { promesse } : {}) }, { blocco, schede });
  for (const riga of ['I formati audio arriveranno con il prossimo aggiornamento.', 'Nella prossima versione: i formati audio.',
    'Stiamo preparando i formati audio.', 'In futuro anche i formati audio.', 'Coming soon: audio.', 'Sarà disponibile anche l\'audio.']) {
    assert.equal(prova(riga).ok, false, riga);
    assert.equal(prova(riga, [{ numero: '900', riga }]).ok, false, `${riga} (#900 non è nella rosa)`);
    assert.equal(prova(riga, [{ numero: '812', riga }]).ok, true, `${riga} (#812 è nella rosa)`);
  }
  assert.equal(prova({ testo: 'Ora il prossimo video parte da solo.', da: [1] }).ok, true);
});

test('una domanda di processo da un ruolo senza feedback si rifiuta prima di rilasciare, invece di perdersi', () => {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'routine-channel.mjs'), 'release', 'BIGLIETTO', '--role', 'compito', '--processo', 'quale strumento?'],
    { encoding: 'utf8', cwd: cartellaTemporanea('filo-processo-') });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--processo vale per chi lavora un feedback: il ruolo compito non ne ha uno/);
});

test('le domande che fermano arrivano dal server col numero del feedback: le schede non portano l\'id', () => {
  const indice = M.indiceDalServer([{ num: '812', stato: 'todo', priorita: 2 }, { num: '815', stato: 'todo', priorita: 1 }]);
  const domande = [
    { id: 'D-7', titolo: 'Quale modello?', stato: 'aperta', blocca: true, legata: 'abc', num: '812', creataIl: 0 },
    { id: 'D-8', titolo: 'Chiuso nel frattempo', stato: 'aperta', blocca: true, legata: 'def', num: '999', creataIl: 0 },
  ];
  assert.deepEqual(M.righeDomandeFerme(domande, { indice, ordine: ['812'] }), ['D-7 «Quale modello?» ferma #812 (aspetta l\'owner · nell\'ordine)']);
});

test('una promessa al futuro non dichiarata si riconosce anche fuori dall\'elenco di parole', () => {
  const blocco = { version: '0.2.256', features: ['Le schede si trascinano fra le finestre.'], fixes: [] };
  for (const riga of ['Verrà aggiunto il supporto ai PDF.', 'Lavoriamo per portare le schede sul telefono.', 'Domani arriva la chat condivisa.']) {
    assert.equal(M.controllaNovita({ versione: '0.2.256', features: [riga] }, { blocco, schede: [] }).ok, false, riga);
  }
  assert.equal(M.controllaNovita({ versione: '0.2.256', features: [{ testo: 'Le schede ora si trascinano fra le finestre.', da: [1] }] }, { blocco, schede: [] }).ok, true);
});

test('una promessa si riconosce dal non avere fonte, non dalle parole: ogni riga dice da quali righe dei worker nasce', () => {
  const blocco = { version: '0.2.256', features: ['Le schede si trascinano fra le finestre.', 'Il menu si apre più in fretta.'], fixes: ['Il download non si blocca.'] };
  const schede = [{ num: '812', priorita: 2 }, { num: '900', priorita: 1 }];
  const prova = (righe, promesse) => M.controllaNovita({ versione: '0.2.256', features: righe, ...(promesse ? { promesse } : {}) }, { blocco, schede });
  for (const riga of ['Tra poco potrai allegare i PDF.', 'Stiamo per portare la chat sul telefono.', 'Il supporto ai PDF è quasi pronto.',
    'I PDF sono il prossimo passo.', 'Tra qualche giorno anche i PDF.', 'Potremo leggere i PDF nel prossimo giro.']) {
    const r = prova([riga]);
    assert.equal(r.ok, false, riga);
    assert.match(r.errori.join('\n'), /non dice da quali righe dei worker nasce/, riga);
    assert.equal(prova([riga], [{ numero: '900', riga }]).ok, false, `${riga} (#900 non è nella rosa)`);
    assert.equal(prova([riga], [{ numero: '812', riga }]).ok, true, `${riga} (#812 è nella rosa)`);
  }
  // Una riga copiata uguale ha già la sua fonte; una riscritta la cita, features e fixes contati di seguito.
  assert.equal(prova(['Il menu si apre più in fretta.']).ok, true);
  const buona = prova([{ testo: 'Schede trascinabili fra le finestre, e un download che non si blocca.', da: [1, 3] }]);
  assert.equal(buona.ok, true, (buona.errori || []).join('\n'));
  assert.deepEqual(buona.novita.features, ['Schede trascinabili fra le finestre, e un download che non si blocca.']);
  for (const da of [[], [0], [4], ['1'], 1.5]) {
    assert.match(prova([{ testo: 'Schede trascinabili.', da }]).errori.join('\n'), /da sono i numeri delle righe dei worker da cui nasce, da 1 a 3/, JSON.stringify(da));
  }
  // La rete delle parole resta sulle righe con la fonte.
  assert.equal(prova([{ testo: 'Le schede si trascinano, e presto anche fra i dispositivi.', da: [1] }]).ok, false);
  const ctx = M.contestoRedattore({ blocco, schede: [] });
  assert.match(ctx, /Novità:\n1\. Le schede si trascinano fra le finestre\.\n2\. Il menu si apre più in fretta\.\n\nCorrezioni:\n3\. Il download non si blocca\./);
});

test('il redattore legge le righe del commit che la pubblicazione costruirà, non quelle di un main più avanti', async () => {
  const dir = cartellaTemporanea('filo-redattore-verde-');
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).stdout.trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'src', 'shared'), { recursive: true });
  const notes = (righe) => `(function (g) { const NOTES = [\n  { version: '0.2.256', date: '', features: ${JSON.stringify(righe)}, fixes: [] },\n]; g.SN_PATCH_NOTES = { NOTES }; })(globalThis);\n`;
  writeFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), notes(['Riga uno.']));
  g('add', '-A'); g('commit', '-qm', 'verde');
  const verde = g('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'src', 'shared', 'patchNotes.js'), notes(['Riga uno.', 'Riga fusa dopo, ancora in prova.']));
  g('add', '-A'); g('commit', '-qm', 'in prova');
  const testa = g('rev-parse', 'HEAD');

  const git = (...a) => (a[0] === 'fetch' ? '' : a[0] === 'remote' ? 'https://github.com/esempio/Filo' : a[0] === 'rev-list' ? `${testa}\n${verde}` : '');
  const gh = async (percorso) => (/\/jobs/.test(percorso)
    ? { jobs: [{ name: 'unit-windows', conclusion: 'success' }] }
    : { workflow_runs: [{ id: 7, head_sha: verde, conclusion: 'success', status: 'completed', event: 'push', head_branch: 'main' }] });
  assert.deepEqual(await M.ultimoVerde({ root: dir, git, gh }), { sha: verde });
  assert.deepEqual(M.bloccoAlCommit(dir, verde).features, ['Riga uno.']);
  const ctx = M.contestoRedattore({ blocco: M.bloccoAlCommit(dir, verde), schede: [], commit: verde });
  assert.match(ctx, new RegExp(`"commit": "${verde}"`));
  assert.doesNotMatch(ctx, /ancora in prova/);
  // Senza GitHub lo dice, invece di far credere che le righe siano quelle che usciranno.
  const senza = await M.ultimoVerde({ root: dir, git, gh: async () => { throw new Error('GitHub 403'); } });
  assert.match(senza.motivo, /GitHub 403/);
  assert.match(M.contestoRedattore({ blocco: { version: '0.2.256', features: [], fixes: [] }, schede: [], motivo: senza.motivo }), /Non so quale commit costruirà la pubblicazione/);
});
