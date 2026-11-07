// Le schede dei feedback per il manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): quali feedback ne hanno bisogno, quando una
// scheda è buona, quali rilegge Opus, e che stanno fuori dal repo pubblico. Gli agenti non partono: si prova a vuoto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const S = await import('../../scripts/schede.mjs');

const buona = (num, extra = {}) => ({
  numero: String(num), stato: 'todo', mittente: 'utente', titolo_breve: 'Menu che non si apre',
  riassunto: 'Il menu del tasto destro non si apre sulle immagini.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'Letto il gestore: il caso manca.',
  risolto_su_main: null, doppione_di: [], parole_chiave: ['menu'], note: '', ...extra,
});

test('l\'indice tiene solo gli aperti, dal numero più basso, con stato e priorità', () => {
  const righe = [
    { _id: 'a', seq: 12, subSeq: 0, status: 'todo', priority: 2, updatedAt: 't1' },
    { _id: 'b', seq: 3, subSeq: 1, status: 'design', updatedAt: 't2' },
    { _id: 'c', seq: 4, status: 'done' },
    { _id: 'd', seq: 5, status: 'archived' },
    { _id: 'e', status: 'todo' },
  ];
  assert.deepEqual(S.apertiDaRighe(righe), [
    { id: 'b', num: '3.1', stato: 'design', priorita: null, aggiornato: 't2', attese: [], unisce: [] },
    { id: 'a', num: '12', stato: 'todo', priorita: 2, aggiornato: 't1', attese: [], unisce: [] },
  ]);
});

test('l\'indice porta le attese e le unite di ogni aperto, e riconosce uno stato non decifrato', () => {
  const [f] = S.apertiDaRighe([{ _id: 'a', seq: 812, status: 'todo', waitsFor: [{ id: 'p', num: '950' }], unisce: [{ id: 'u', num: '#7' }] }]);
  assert.deepEqual([f.attese, f.unisce], [['950'], ['7']]);
  // Nell'indice restano le attese che fermano ancora (SN_FB_ATTESE.statoAttesa): un aspettato fuso non ferma più.
  const righe = [
    { _id: 'a', seq: 812, status: 'todo', waitsFor: [{ id: 'f', num: '1' }, { id: 'v', num: '2' }, { id: 's', num: '3' }, { id: 'o', num: '4' }, { id: 'x', num: '5' }] },
    { _id: 'f', seq: 1, status: 'done' }, { _id: 'v', seq: 2, status: 'archived', resolvedInVersion: '1.2.3' },
    { _id: 's', seq: 3, status: 'spam_confirmed' }, { _id: 'o', seq: 4, status: 'todo' },
  ];
  assert.deepEqual(S.apertiDaRighe(righe).find((r) => r.num === '812').attese, ['3', '4', '5'], 'chiuso senza fusione, aperto, cancellato');
  assert.ok(S.CAMPI_LETTI.includes('resolvedInVersion'), 'senza la versione un archiviato fuso sembrerebbe chiuso');
  assert.equal(S.statoIllegibile({ status: 'todo' }), false);
  assert.equal(S.statoIllegibile({ status: '' }), false, 'senza stato la riga esce già dall\'indice');
  assert.equal(S.statoIllegibile({ status: '[cifrato — chiave privata non configurata]' }), true);
  assert.equal(S.statoIllegibile({ status: 'FENC1:abc' }), true);
});

test('una scheda è buona solo coi campi del ruolo; ogni difetto è detto', () => {
  assert.deepEqual(S.validaScheda(buona(12), '12'), []);
  assert.deepEqual(S.validaScheda(buona(12, { valido: 'non letto', tipo: '', area: '' }), '12'), [], 'un feedback non letto non ha tipo né area');
  const male = S.validaScheda(buona(12, { numero: '13', valido: 'forse', area: 'cucina', urgente: 'no', file_probabili: ['a', 'b', 'c', 'd', 'e', 'f'], riassunto: '' }), '12');
  for (const atteso of [/«numero»/, /«valido»/, /«area»/, /«urgente»/, /«file_probabili» ha 6 voci/, /manca «riassunto»/]) {
    assert.ok(male.some((m) => atteso.test(m)), `${atteso}: ${male.join(' | ')}`);
  }
  assert.deepEqual(S.validaScheda(null, '1'), ['non è un oggetto JSON']);
});

test('il riassunto sta nei 200 token della spec, e i file probabili si scrivono come li stampa git', () => {
  assert.deepEqual(S.validaScheda(buona(12, { riassunto: 'x'.repeat(S.RIASSUNTO_MAX) }), '12'), []);
  assert.ok(S.validaScheda(buona(12, { riassunto: 'x'.repeat(S.RIASSUNTO_MAX + 1) }), '12').some((m) => /«riassunto» è lungo/.test(m)));
  assert.equal(S.RIASSUNTO_MAX, Math.floor(200 * globalThis.SN_FILO_CONTESTO.CARATTERI_PER_TOKEN), '200 token col fattore di tutto Filo');
  assert.ok(globalThis.SN_FILO_CONTESTO.stimaToken('x'.repeat(S.RIASSUNTO_MAX)) <= 200);
  assert.match(readFileSync(join(ROOT, 'routines', 'roles', 'scheda.md'), 'utf8'), new RegExp(`al più ${S.RIASSUNTO_MAX} caratteri`), 'il ruolo dice lo stesso tetto');
  assert.deepEqual(S.validaScheda(buona(12, { file_probabili: ['src/pages/manage/', 'filo-security/functions/src/x.js', 'src/a.js'] }), '12'), []);
  assert.deepEqual(S.validaScheda(buona(12, { file_probabili: [] }), '12'), [], 'senza file la scheda è buona: il manutentore saprà che non si sa');
  // La regola è quella degli incroci (vociDiFile): quello che lì si confronta qui è buono, il resto si rifiuta.
  for (const storto of ['C:\\Users\\agenti AI\\Filo\\src\\a.js', '/home/x/Filo/src/a.js', '../fuori.js', '~/a.js',
    'src/**/*.js', 'src/pages/*', 'src/pages/manage/{a,b}.js', 'src/a?.js', 'src/[ab].js', 'src/pages/manage/a.js:12', 'src/a.js:12:3']) {
    assert.ok(S.validaScheda(buona(12, { file_probabili: [storto] }), '12').some((m) => /un percorso per voce come lo stampa git/.test(m)), storto);
  }
  for (const buono of ['src\\a.js', ' src/a.js', './src/a.js']) assert.deepEqual(S.validaScheda(buona(12, { file_probabili: [buono] }), '12'), [], buono);
});

test('cosa rende buona una scheda è una regola sola: il controllo condiviso col server dice lo stesso dello script e degli incroci', async () => {
  const SN = globalThis.SN_SCHEDE;
  const casi = [buona(12), buona(12, { riassunto: 'x'.repeat(S.RIASSUNTO_MAX + 1) }), buona(12, { file_probabili: ['src/**/*.js'] }),
    buona(12, { file_probabili: ['/home/x/a.js'] }), buona(12, { file_probabili: ['src/a.js:12'] })];
  for (const c of casi) assert.deepEqual(SN.validaScheda(c, '12'), S.validaScheda(c, '12'));
  assert.equal(SN.RIASSUNTO_MAX, S.RIASSUNTO_MAX);
  const { vociDiFile } = await import('../../scripts/lib/su-main.mjs');
  for (const f of ['src/a.js', 'src/**/*.js', '../x.js', 'C:\\x\\a.js', 'src/a.js:3']) {
    assert.equal(vociDiFile([f]).storte.length === 1, S.validaScheda(buona(12, { file_probabili: [f] }), '12').length > 0, f);
  }
  const src = readFileSync(join(ROOT, 'scripts', 'lib', 'su-main.mjs'), 'utf8') + readFileSync(join(ROOT, 'scripts', 'schede.mjs'), 'utf8');
  assert.doesNotMatch(src, /\[\*\?\[\\\]\{\}\]/, 'la forma dei file non si riscrive negli script');
});

test('si riscrive la scheda che manca, che non è buona o il cui feedback è cambiato', () => {
  const f = { id: 'a', num: '12', stato: 'todo', aggiornato: 't1' };
  assert.equal(S.daScrivere(f, null), true);
  assert.equal(S.daScrivere(f, buona(12)), true, 'senza la fonte timbrata non si sa di quando è');
  const timbrata = { ...buona(12), _fonte: { id: 'a', stato: 'todo', aggiornato: 't1' } };
  assert.equal(S.daScrivere(f, timbrata), false);
  assert.equal(S.daScrivere({ ...f, stato: 'design' }, timbrata), true);
  assert.equal(S.daScrivere({ ...f, aggiornato: 't2' }, timbrata), true);
});

test('Opus rilegge tutte quelle che tolgono lavoro e un campione stabile delle altre, mai due volte', () => {
  const schede = Array.from({ length: 400 }, (_, i) => buona(i + 1));
  schede[0] = buona(1, { valido: 'no' });
  schede[1] = buona(2, { doppione_di: ['77'] });
  schede[2] = buona(3, { valido: 'no', _riletta: { at: 'x' } });
  const scelte = S.daRileggere(schede, { quota: 0.1 }).map((s) => s.numero);
  assert.ok(scelte.includes('1') && scelte.includes('2'));
  assert.ok(!scelte.includes('3'), 'già riletta');
  const campione = scelte.length - 2;
  assert.ok(campione > 20 && campione < 70, `campione del 10% circa: ${campione} su 397`);
  assert.deepEqual(S.daRileggere(schede, { quota: 0.1 }).map((s) => s.numero), scelte, 'lo stesso campione a ogni giro');
});

test('la scheda arriva dalla risposta dell\'agente: senza JSON, non buona, o una rilettura senza «riletta», resta da rifare', () => {
  assert.deepEqual(S.schedaDaRisposta('Ecco:\n```json\n{"numero": "12"}\n```'), { numero: '12' });
  assert.equal(S.schedaDaRisposta('12: si — Menu'), null);
  assert.equal(S.schedaDaRisposta('[1, 2]'), null);
  assert.deepEqual(S.difettiDopoAgente({ scheda: null, num: '12' }), ['la risposta dell\'agente non è una scheda in JSON']);
  assert.deepEqual(S.difettiDopoAgente({ scheda: buona(12), num: '12' }), []);
  assert.deepEqual(S.difettiDopoAgente({ scheda: buona(12), num: '12', rilettura: true }), ['manca «riletta»']);
  assert.deepEqual(S.difettiDopoAgente({ scheda: buona(12, { riletta: 'confermata' }), num: '12', rilettura: true }), []);
});

test('il timbro lo scrive solo lo script: una fonte o una rilettura inventate dall\'agente spariscono', () => {
  const v = { id: 'a', num: '12', stato: 'todo', aggiornato: 't1' };
  const adesso = new Date('2026-11-02T10:00:00Z');
  const t = S.timbra(buona(12, { _riletta: { at: 'falso' }, _fonte: { id: 'a', aggiornato: 'falso' }, _altro: 1 }), v, { modello: 'haiku', adesso });
  assert.deepEqual(t._fonte, { id: 'a', stato: 'todo', aggiornato: 't1', at: adesso.toISOString(), modello: 'haiku' });
  assert.equal('_riletta' in t, false);
  assert.equal('_altro' in t, false);
  assert.deepEqual(S.timbra(buona(12), v, { modello: 'opus', rilettura: true, adesso })._riletta, { at: adesso.toISOString(), modello: 'opus' });
});

test('il prompt porta il ruolo e in coda i dati del giro, non la cartella delle schede; la rilettura porta la scheda senza timbro', () => {
  const dati = { num: '12', radice: '/x/Filo' };
  assert.equal(S.promptScheda('# Ruolo', dati), '# Ruolo\n\nFeedback: 12\nRadice del repo: /x/Filo');
  assert.match(S.promptScheda('# Ruolo', { ...dati, radiceServer: '/x/filo-security' }), /\nRadice del server \(filo-security\): \/x\/filo-security$/);
  const r = S.promptScheda('# Ruolo', { ...dati, rilettura: true, attuale: { ...buona(12), _fonte: { id: 'a' }, _riletta: { at: 'x' } } });
  assert.match(r, /\n\nRILETTURA\. /);
  assert.match(r, /"titolo_breve": "Menu che non si apre"/);
  assert.doesNotMatch(r, /_fonte|_riletta/);
});

test('una scheda col numero di un altro feedback non vale per nessuno, e si dice', (t) => {
  const dir = cartellaTemporanea('schede-nomi');
  t.after(() => togliCartella(dir));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '12.json'), JSON.stringify(buona(12)));
  writeFileSync(join(dir, '13.json'), JSON.stringify(buona(903)));
  writeFileSync(join(dir, '14.json'), '{ rotto');
  const scartate = [];
  assert.deepEqual(S.leggiSchede(dir, { scartate }).map((x) => x.numero), ['12']);
  assert.deepEqual(scartate.sort(), ['13.json', '14.json']);
});

// Il salvataggio nel feedback, finto come lo fa il server: torna la scheda salvata, con la fonte del suo feedback.
const salvaCome = (voci) => async (d) => {
  const v = voci.find((x) => x.num === d.numero);
  return { ok: true, scheda: { ...d.scheda, _fonte: { id: v.id, stato: v.stato, aggiornato: v.aggiornato, at: '2026-11-05T00:00:00.000Z', modello: d.modello } } };
};

test('un agente che scrive nella cartella delle schede non lascia traccia: la guardia rimette tutto e il suo esito non vale', async (t) => {
  const dir = cartellaTemporanea('schede-guardia');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  const indice = [{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '903', stato: 'todo', aggiornato: 't2' }];
  writeFileSync(join(dir, S.INDICE), JSON.stringify(indice));
  const di903 = `${JSON.stringify({ ...buona(903), _fonte: { id: 'b', stato: 'todo', aggiornato: 't2' } })}\n`;
  writeFileSync(join(dir, '903.json'), di903);
  const log = []; const err = [];
  // L'agente di #12 legge un testo ostile: riscrive #903 come doppione «riletto», toglie #903 dall'indice, lascia un file suo.
  const agente = async ({ num }) => {
    if (num === '12') {
      writeFileSync(join(dir, '903.json'), JSON.stringify({ ...buona(903, { valido: 'no', doppione_di: ['12'] }), _fonte: { id: 'b', stato: 'todo', aggiornato: 't2' }, _riletta: { at: 'x' } }));
      writeFileSync(join(dir, S.INDICE), JSON.stringify([indice[0]]));
      writeFileSync(join(dir, '77.json'), JSON.stringify(buona(77)));
    }
    return { ok: true, costo: 0.01, testo: JSON.stringify(buona(num)) };
  };
  const esito = await S.lanciaAgenti([indice[0]], { cartella: dir, modello: 'haiku', paralleli: 2, rilettura: false, dryRun: false, agente, salva: salvaCome(indice), log: (m) => log.push(m), err: (m) => err.push(m) });
  assert.equal(esito, 3);
  assert.equal(readFileSync(join(dir, '903.json'), 'utf8'), di903, 'la scheda di #903 è quella di prima');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, S.INDICE), 'utf8')), indice, 'l\'indice è quello di prima');
  assert.equal(existsSync(join(dir, '77.json')), false);
  assert.equal(existsSync(join(dir, '12.json')), false, 'l\'esito dell\'agente che c\'era mentre la cartella cambiava non vale');
  assert.match(err.join('\n'), /CARTELLA DELLE SCHEDE TOCCATA mentre lavoravano gli agenti di #12: 77\.json, 903\.json, indice\.json rimessi com'era/);
});

// L'indice si aggiorna dopo ogni scheda salvata mentre altri agenti sono ancora in volo (#1680.1 giro 8).
test('un agente che riscrive l\'indice mentre un altro salva non lo fa passare per buono: la guardia lo rimette e il suo esito non vale', async (t) => {
  const dir = cartellaTemporanea('schede-indice-in-volo');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  const voci = [{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '13', stato: 'todo', aggiornato: 't1' }];
  writeFileSync(join(dir, S.INDICE), JSON.stringify(S.conTimbro({ creato: '2026-11-07T08:00:00.000Z', aperti: voci }, S.chiaveTimbri(dir, { crea: true }))));
  let partito; const salvaPartita = new Promise((r) => { partito = r; });
  let fatto; const manomesso = new Promise((r) => { fatto = r; });
  // #12 legge un testo ostile e, mentre #13 salva (una chiamata di rete), toglie #12 dall'indice; poi lavora ancora.
  const agente = async ({ num }) => {
    if (num === '12') {
      await salvaPartita;
      writeFileSync(join(dir, S.INDICE), JSON.stringify({ creato: '2026-11-07T08:00:00.000Z', aperti: [voci[1]] }));
      fatto();
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ok: true, costo: 0, testo: JSON.stringify(buona(num)) };
  };
  const salva = async (d) => {
    if (d.numero === '13') { partito(); await manomesso; }
    return { ...(await salvaCome(voci)(d)), aggiornato: 't2' };
  };
  const err = [];
  assert.equal(await S.lanciaAgenti(voci, { cartella: dir, modello: 'haiku', paralleli: 2, rilettura: false, dryRun: false, agente, salva, log() {}, err: (m) => err.push(m) }), 3);
  assert.match(err.join('\n'), /CARTELLA DELLE SCHEDE TOCCATA mentre lavoravano gli agenti di #12: indice\.json/);
  const letto = S.leggiIndice(dir);
  assert.deepEqual(letto.aperti.map((f) => [f.num, f.aggiornato]), [['12', 't1'], ['13', 't2']], 'l\'indice è quello dello script, con #13 salvata');
  assert.equal(letto.fidato, true);
  assert.equal(existsSync(join(dir, '12.json')), false, 'l\'esito dell\'agente che ha toccato l\'indice non vale');
});

test('un agente onesto: la scheda la scrive lo script dalla risposta, col timbro; uno fallito non lascia niente', async (t) => {
  const dir = cartellaTemporanea('schede-onesto');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  const voci = [{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '13', stato: 'todo', aggiornato: 't1' }];
  const agente = async ({ num, prompt }) => {
    assert.doesNotMatch(prompt, new RegExp(dir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')), 'l\'agente non sa dove stanno le schede');
    return num === '12' ? { ok: true, costo: 0, testo: JSON.stringify(buona(12)) } : { ok: false, costo: 0, errore: 'tempo scaduto' };
  };
  const log = []; const err = [];
  assert.equal(await S.lanciaAgenti(voci, { cartella: dir, modello: 'haiku', paralleli: 2, rilettura: false, dryRun: false, agente, salva: salvaCome(voci), log: (m) => log.push(m), err: (m) => err.push(m) }), 3);
  const scritta = JSON.parse(readFileSync(join(dir, '12.json'), 'utf8'));
  assert.equal(scritta._fonte.id, 'a');
  assert.deepEqual(readdirSync(dir).sort(), ['12.json']);
  assert.match(log.join('\n'), /#12: si — Menu che non si apre/);
  assert.match(err.join('\n'), /#13: agente fallito \(tempo scaduto\): resta da rifare/);
  assert.doesNotMatch(err.join('\n'), /TOCCATA/);
});

test('i lavori partono al più N alla volta, tutti, e ognuno col suo esito', async () => {
  let vivi = 0; let massimo = 0;
  const esiti = await S.aGruppi([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    vivi += 1; massimo = Math.max(massimo, vivi);
    await new Promise((r) => setTimeout(r, 5));
    vivi -= 1;
    return n * 2;
  });
  assert.deepEqual(esiti, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(massimo, 3);
});

test('le schede non si scrivono dentro il repo pubblico; stato e scrivi a vuoto leggono la cartella', async (t) => {
  const err = []; const out = [];
  const [e, l] = [console.error, console.log];
  console.error = (...a) => err.push(a.join(' ')); console.log = (...a) => out.push(a.join(' '));
  const dir = cartellaTemporanea('schede');
  t.after(() => { console.error = e; console.log = l; togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  assert.equal(await S.main(['stato', '--cartella', join(ROOT, 'tmp-schede')]), 1);
  assert.match(err.join('\n'), /dentro il repo pubblico non le scrivo/);
  assert.equal(await S.main(['scrivi', '--cartella', dir]), 1);
  assert.match(err.join('\n'), /Manca l'indice/);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, S.INDICE), JSON.stringify([{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '13', stato: 'todo', aggiornato: 't1' }]));
  const di12 = { ...buona(12), _fonte: { id: 'a', stato: 'todo', aggiornato: 't1' } };
  writeFileSync(join(dir, '12.json'), JSON.stringify(di12));
  assert.equal(await S.main(['scrivi', '--cartella', dir, '--dry-run']), 0);
  assert.match(out.join('\n'), /2 agenti haiku, 6 alla volta: #12, #13$/m, 'una scheda senza il timbro dello script si riscrive');
  writeFileSync(join(dir, '12.json'), JSON.stringify(S.conTimbro(di12, S.chiaveTimbri(dir, { crea: true }))));
  assert.equal(await S.main(['scrivi', '--cartella', dir, '--dry-run']), 0);
  assert.match(out.join('\n'), /1 agenti haiku, 6 alla volta: #13$/m);
  assert.equal(await S.main(['scrivi', '--cartella', dir, '--solo', '99', '--dry-run']), 1);
  assert.match(err.join('\n'), /Non sono fra gli aperti dell'indice: #99/);
  assert.equal(await S.main(['stato', '--cartella', dir]), 0);
  const r = JSON.parse(out[out.length - 1]);
  assert.equal(r.aperti, 2); assert.equal(r.schede, 1); assert.equal(r.daScrivere, 1);
});

// La fiducia in una scheda o nell'indice sta nel timbro dello script, non nel file: chiunque sulla macchina lo può
// riscrivere anche dopo il giro, e la guardia c'è solo mentre gli agenti lavorano.
test('una scheda riscritta dopo il giro non ha il timbro: chi legge non le crede, e scrittura la riprende', async (t) => {
  const dir = cartellaTemporanea('schede-timbro');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  const voci = [{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '903', stato: 'todo', aggiornato: 't2' }];
  const agente = async ({ num }) => ({ ok: true, costo: 0, testo: JSON.stringify(buona(num)) });
  assert.equal(await S.lanciaAgenti(voci, { cartella: dir, modello: 'haiku', paralleli: 2, rilettura: false, dryRun: false, agente, salva: salvaCome(voci), log() {}, err() {} }), 0);
  assert.ok(existsSync(S.fileChiave(dir)) && !readdirSync(dir).some((n) => /chiave/.test(n)), 'la chiave sta fuori dalla cartella');
  const lette = () => new Map(S.leggiSchede(dir).map((s) => [s.numero, s]));
  assert.equal(lette().get('903')[S.TIMBRATA], true);
  // Dopo il giro: #903 diventa un doppione «riletto» con la data giusta, e #12 cambia una virgola.
  const vera = JSON.parse(readFileSync(join(dir, '903.json'), 'utf8'));
  writeFileSync(join(dir, '903.json'), JSON.stringify({ ...vera, valido: 'no', prova: 'doppione', doppione_di: ['12'], _riletta: { at: 'x', modello: 'opus' } }));
  const di12 = JSON.parse(readFileSync(join(dir, '12.json'), 'utf8'));
  writeFileSync(join(dir, '12.json'), JSON.stringify({ ...di12, riassunto: `${di12.riassunto}.` }));
  const ora = lette();
  for (const n of ['903', '12']) assert.equal(ora.get(n)[S.TIMBRATA], false, n);
  assert.equal(S.daScrivere(voci[1], ora.get('903')), true, 'la scrittura la riprende');
  assert.deepEqual(S.daRileggere([...ora.values()], { quota: 1 }), [], 'la rilettura no: si riscrive');
  const M = await import('../../scripts/manutentore.mjs');
  assert.match(M.avvisoScheda(ora.get('903'), voci[1]), /SCHEDA SENZA IL TIMBRO DELLO SCRIPT.*non riletta: non togliere lavoro/);
  // Lo stesso timbro su un'altra chiave non vale; senza chiave nessuno è timbrato.
  assert.equal(S.timbroBuono(vera, Buffer.alloc(32, 1)), false);
  assert.equal(S.timbroBuono(vera, null), false);
});

test('le schede di prima dei timbri si firmano una volta; dopo una chiave sparita nessuna scheda senza firma diventa buona', (t) => {
  const dir = cartellaTemporanea('schede-adozione');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '5.json'), JSON.stringify(buona(5)));
  writeFileSync(join(dir, '6.json'), JSON.stringify({ ...buona(6), titolo_breve: '' }));
  assert.equal(S.adottaSenzaTimbro(dir), 1, 'solo quella buona');
  const lette = () => [...new Map(S.leggiSchede(dir).map((s) => [s.numero, s[S.TIMBRATA]]))].sort();
  assert.deepEqual(lette(), [['5', true], ['6', false]]);
  assert.equal(S.adottaSenzaTimbro(dir), 0, 'con la chiave non si adotta più');
  // Un falso scritto dopo, e la chiave cancellata: la cartella ha già visto un timbro, quindi niente si firma.
  writeFileSync(join(dir, '7.json'), JSON.stringify({ ...buona(7), valido: 'no', doppione_di: ['5'] }));
  rmSync(S.fileChiave(dir));
  assert.equal(S.adottaSenzaTimbro(dir), 0);
  assert.equal(existsSync(S.fileChiave(dir)), false);
  assert.deepEqual(lette().map(([, b]) => b), [false, false, false]);
});

test('l\'indice porta la sua data, timbrata: toccare la data del file non la cambia, riscriverlo lo rende non fidato', (t) => {
  const dir = cartellaTemporanea('schede-indice');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  const aperti = [{ id: 'a', num: '12', stato: 'todo' }];
  const f = join(dir, S.INDICE);
  writeFileSync(f, JSON.stringify(S.conTimbro({ creato: '2026-10-01T08:00:00.000Z', aperti }, S.chiaveTimbri(dir, { crea: true }))));
  utimesSync(f, new Date(), new Date());
  assert.deepEqual(S.leggiIndice(dir), { aperti, creato: '2026-10-01T08:00:00.000Z', fidato: true });
  const o = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, JSON.stringify({ ...o, creato: new Date().toISOString() }));
  assert.deepEqual(S.leggiIndice(dir), { aperti, creato: '', fidato: false });
  writeFileSync(f, JSON.stringify(aperti));
  assert.deepEqual(S.leggiIndice(dir), { aperti, creato: '', fidato: false }, 'un indice di prima dei timbri si legge, non fidato');
  rmSync(f);
  assert.equal(S.leggiIndice(dir).aperti, null);
});

test('mentre lavorano gli agenti anche la sola data di un file conta: la guardia la rimette e lo dice', async (t) => {
  const dir = cartellaTemporanea('schede-data');
  t.after(() => { togliCartella(dir); rmSync(S.fileChiave(dir), { force: true }); });
  mkdirSync(dir, { recursive: true });
  const f = join(dir, S.INDICE);
  writeFileSync(f, '[]');
  const vecchia = new Date('2026-10-01T08:00:00Z');
  utimesSync(f, vecchia, vecchia);
  const err = [];
  const agente = async ({ num }) => { utimesSync(f, new Date(), new Date()); return { ok: true, costo: 0, testo: JSON.stringify(buona(num)) }; };
  await S.lanciaAgenti([{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }], { cartella: dir, modello: 'haiku', paralleli: 1, rilettura: false, dryRun: false, agente, salva: salvaCome([{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }]), log() {}, err: (m) => err.push(m) });
  assert.equal(statSync(f).mtime.getTime(), vecchia.getTime());
  assert.match(err.join('\n'), /CARTELLA DELLE SCHEDE TOCCATA .*indice\.json rimesso com'era/);
});

// #1680.1 giro 2: l'agente della scheda legge testo di chiunque; con un comando o una scrittura falserebbe le schede degli
// altri (e la chiave dei timbri) anche dopo il giro. Solo lettura, tutto il resto negato senza chiedere.
test('l\'agente della scheda ha solo Read, Grep e Glob, senza comandi né scritture, e nessun permesso chiesto', async () => {
  const { argomentiClaude } = await import('../../scripts/orchestratore-locale.mjs');
  const a = S.argomentiScheda(argomentiClaude, { modello: 'haiku', num: '12', radiceServer: '/x/filo-security' });
  const dopo = (f) => a[a.indexOf(f) + 1];
  assert.equal(dopo('--permission-mode'), 'dontAsk');
  assert.ok(a.includes('--restricted'), 'Read e Grep chiusi nelle cartelle di lavoro: la chiave dei timbri sta fuori');
  assert.equal(dopo('--tools'), 'Read,Grep,Glob');
  assert.equal(dopo('--allowedTools'), 'Read,Grep,Glob');
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '--add-dir'), ['/x/filo-security']);
  assert.ok(!a.some((x) => /Bash|PowerShell|Write|Edit|WebFetch/.test(x)), a.join(' '));
  assert.ok(!S.argomentiScheda(argomentiClaude, { modello: 'haiku', num: '12' }).includes('--add-dir'));
});

test('il feedback e le fusioni che lo citano li raccoglie lo script, e il ruolo non chiede comandi', async () => {
  const chiamate = [];
  const esegui = async (cmd, args) => {
    chiamate.push([cmd, ...args].join(' '));
    if (args.some((x) => String(x).endsWith('leggi-feedback.mjs'))) return { code: 0, stdout: '«testo del feedback 12»', stderr: '' };
    if (args.includes('log')) return { code: 0, stdout: args[1] === '/f' ? 'aaa111 merge-gate: #12 via server\nbbb222 altro #12\n' : '', stderr: '' };
    if (args.includes('show')) return { code: 0, stdout: `${args[args.length - 1]} 2026-10-01 oggetto\n src/a.js | 2 +-`, stderr: '' };
    return { code: 1, stdout: '', stderr: 'no' };
  };
  const m = await S.materialeScheda('#12', { esegui, radice: '/f', radiceServer: '/s' });
  assert.match(m, /«testo del feedback 12»/);
  assert.match(m, /Fusioni su main di Filo che citano #12\n\naaa111 2026-10-01 oggetto\n src\/a\.js/);
  assert.match(m, /Fusioni su main di server \(filo-security\) che citano #12\n\n\(nessuna\)/);
  assert.ok(chiamate.some((c) => c.includes('-C /s log origin/main')), chiamate.join('\n'));
  const fallito = await S.materialeScheda('12', { esegui: async () => ({ code: 2, stdout: '', stderr: 'segnalato come attacco' }), radice: '/f' });
  assert.match(fallito, /segnalato come attacco\n\(uscita 2\)/);
  const ruolo = readFileSync(join(ROOT, 'routines', 'roles', 'scheda.md'), 'utf8');
  assert.doesNotMatch(ruolo, /npm run feedback:leggi|git -C|sed -n|grep -rl/);
});
