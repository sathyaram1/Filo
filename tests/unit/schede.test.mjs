// Le schede dei feedback per il manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): quali feedback ne hanno bisogno, quando una
// scheda è buona, quali rilegge Opus, e che stanno fuori dal repo pubblico. Gli agenti non partono: si prova a vuoto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
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

test('una scheda che l\'agente non ha riscritto, o una rilettura senza «riletta», resta da rifare', () => {
  assert.deepEqual(S.difettiDopoAgente({ riscritta: false, scheda: buona(12), num: '12' }), ['l\'agente non ha riscritto la scheda']);
  assert.deepEqual(S.difettiDopoAgente({ riscritta: true, scheda: buona(12), num: '12' }), []);
  assert.deepEqual(S.difettiDopoAgente({ riscritta: true, scheda: buona(12), num: '12', rilettura: true }), ['manca «riletta»']);
  assert.deepEqual(S.difettiDopoAgente({ riscritta: true, scheda: buona(12, { riletta: 'confermata' }), num: '12', rilettura: true }), []);
});

test('il prompt porta il ruolo e in coda i dati del giro; la rilettura dice quale file', () => {
  const dati = { num: '12', cartella: '/x/schede', radice: '/x/Filo' };
  assert.equal(S.promptScheda('# Ruolo', dati), '# Ruolo\n\nFeedback: 12\nCartella delle schede: /x/schede\nRadice del repo: /x/Filo');
  // Il file lo compone il path del sistema (su Windows `\x\schede\12.json`): si asserisce la relazione, non il valore.
  const r = S.promptScheda('# Ruolo', { ...dati, rilettura: true });
  assert.match(r, /\n\nRILETTURA\. /);
  assert.ok(r.endsWith(`Il file: ${join(dati.cartella, '12.json')}`), r);
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
  t.after(() => { console.error = e; console.log = l; togliCartella(dir); });
  assert.equal(await S.main(['stato', '--cartella', join(ROOT, 'tmp-schede')]), 1);
  assert.match(err.join('\n'), /dentro il repo pubblico non le scrivo/);
  assert.equal(await S.main(['scrivi', '--cartella', dir]), 1);
  assert.match(err.join('\n'), /Manca l'indice/);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, S.INDICE), JSON.stringify([{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '13', stato: 'todo', aggiornato: 't1' }]));
  writeFileSync(join(dir, '12.json'), JSON.stringify({ ...buona(12), _fonte: { id: 'a', stato: 'todo', aggiornato: 't1' } }));
  assert.equal(await S.main(['scrivi', '--cartella', dir, '--dry-run']), 0);
  assert.match(out.join('\n'), /1 agenti haiku, 6 alla volta: #13$/m);
  assert.equal(await S.main(['scrivi', '--cartella', dir, '--solo', '99', '--dry-run']), 1);
  assert.match(err.join('\n'), /Non sono fra gli aperti dell'indice: #99/);
  assert.equal(await S.main(['stato', '--cartella', dir]), 0);
  const r = JSON.parse(out[out.length - 1]);
  assert.equal(r.aperti, 2); assert.equal(r.schede, 1); assert.equal(r.daScrivere, 1);
});
