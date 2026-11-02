// Il testo di un pacchetto è la spec (#2033): chi lavora riceve testo e allegati, mai le note, e un pacchetto si ferma
// solo sulle sue attese. Un testo che manda la spec nelle note, non nomina un'unita o mette prima un feedback che non
// aspetta non apre niente, già in prova a vuoto. Regole: scripts/lib/spec-del-pacchetto.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const SCRIPT = await import('../../scripts/claude-feedback.mjs');
const SPEC = await import('../../scripts/lib/spec-del-pacchetto.mjs');
const FB = globalThis.SN_FEEDBACK;
SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
SCRIPT.ambiente.routine = () => false;

const seg = (num) => ({ ok: true, id: `id${num}`, num, stato: 'todo', priorita: 1, locale: false, attese: [] });

async function conRete(fn) {
  const P = SCRIPT.pacchetto;
  const orig = { submit: FB.submit, risolvi: SCRIPT.attese.risolvi, ...P, log: console.log, err: console.error };
  const visti = { submit: [], letture: 0, out: [], err: [] };
  SCRIPT.attese.risolvi = async (numeri) => ({ ok: true, attese: numeri.map((n) => ({ id: `id${n}`, num: n })) });
  FB.submit = async (payload, opts) => { visti.submit.push({ payload, opts }); return { id: 'pacco', seq: 900, senderProof: 'admin', files: payload.files }; };
  P.leggi = async (numeri) => { visti.letture += 1; return numeri.map((n) => seg(n)); };
  P.allegati = async () => [];
  P.attesiDa = async () => [];
  P.archivia = async () => ({ ok: true });
  console.log = (...a) => visti.out.push(a.join(' '));
  console.error = (...a) => visti.err.push(a.join(' '));
  try { return { code: await fn(), ...visti }; } finally {
    FB.submit = orig.submit; SCRIPT.attese.risolvi = orig.risolvi;
    for (const k of ['leggi', 'allegati', 'attesiDa', 'archivia']) P[k] = orig[k];
    console.log = orig.log; console.error = orig.err;
  }
}

const apri = (testo, ...altro) => conRete(() => SCRIPT.main(['Menu del tasto destro', testo, '--non-locale', '--pacchetto', '812,815', ...altro]));

test('il caso di #1750: un pacchetto che manda la spec nelle note non nasce, e lo dice già in prova a vuoto', async () => {
  const testo = 'Pacchetto #812, #815: spec nelle note del feedback, SPEC DEL PACCHETTO, da seguire per intero.';
  for (const extra of [[], ['--dry-run']]) {
    const r = await apri(testo, ...extra);
    assert.equal(r.code, 1, r.err.join('\n'));
    assert.equal(r.submit.length, 0, 'niente pacchetto senza spec');
    assert.equal(r.letture, 0, 'si ferma prima della rete: le unite restano in coda');
    assert.match(r.err.join('\n'), /il testo manda la spec nelle note \(«Pacchetto #812, #815: spec nelle note del feedback, SPEC DEL PACCHETTO, da seguire per intero»\): le note non arrivano a chi lavora/);
    assert.match(r.err.join('\n'), /--allega spec\.md/);
  }
});

test('la stessa spec scritta nel testo apre il pacchetto, e il testo che arriva a chi lavora è quello', async () => {
  const testo = '#812: la voce Copia manca nel menu del tasto destro; la prova apre il menu e la clicca.\n#815: il hover della voce non risponde; la prova ci passa sopra e guarda il colore.';
  const r = await apri(testo);
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.equal(r.submit.length, 1);
  assert.equal(r.submit[0].payload.text, testo);
  assert.deepEqual(r.submit[0].opts.unisce, [{ id: 'id812', num: '812' }, { id: 'id815', num: '815' }]);
});

test('una spec allegata con --allega vale come scritta: le unite nominate solo lì bastano', async () => {
  const dir = cartellaTemporanea('spec-pacchetto-');
  try {
    const file = join(dir, 'spec.md');
    writeFileSync(file, '# Spec\n\n- #812: la voce manca. Prova: apri il menu.\n- #815: il hover. Prova: passaci sopra.\n');
    const r = await apri('La spec intera è allegata.', '--allega', file);
    assert.equal(r.code, 0, r.err.join('\n'));
    assert.deepEqual(r.submit[0].payload.files.map((f) => f.name), ['spec.md'], 'la spec viaggia col pacchetto, e chi lavora la riceve fra i documenti');
    const senza = await apri('La spec intera è allegata.');
    assert.equal(senza.code, 1);
    assert.match(senza.err.join('\n'), /la spec non nomina #812, #815: per ogni segnalazione unita dice cosa cambia e come si verifica/);
  } finally { togliCartella(dir); }
});

test('un prerequisito scritto nel testo mette il pacchetto in attesa, o il pacchetto non nasce', async () => {
  const testo = '#812: la voce manca. #815: il hover. #1202 si fonde prima: le due correzioni stanno sopra il suo menu.';
  const senza = await apri(testo);
  assert.equal(senza.code, 1);
  assert.equal(senza.submit.length, 0, 'senza attesa il server lo darebbe da lavorare con #1202 fuori da main');
  assert.match(senza.err.join('\n'), /il testo mette #1202 prima del pacchetto \(«#1202 si fonde prima: le due correzioni stanno sopra il suo menu»\), ma il pacchetto non lo aspetta.*Apri con --aspetta 1202/);
  const con = await apri(testo, '--aspetta', '1202');
  assert.equal(con.code, 0, con.err.join('\n'));
  assert.deepEqual(con.submit[0].opts.waitsFor, [{ id: 'id1202', num: '1202' }], 'nasce aspettando #1202: nessuna routine lo prende prima della fusione');
  const altra = await apri(testo, '--aspetta', '700');
  assert.match(altra.err.join('\n'), /Apri con --aspetta 700,1202/, 'la riga suggerita tiene le attese già scritte');
});

test('rimandi alle note: si riconosce chi manda a leggerle, non chi ne parla', () => {
  for (const f of ['spec nelle note del feedback', 'La spec è nelle note', 'Vedi le note', 'i dettagli stanno nelle sue note', 'leggi la nota', 'il resto in nota', 'istruzioni complete nelle note, da seguire',
    // Gli altri verbi e modi (#2033 giro 1): il controllo non riconosceva che la frase del caso.
    'Pacchetto di #812 e #815: vedere le note', 'Leggere le note del feedback', 'consulta le note per la spec', 'Tutto nelle note', 'come da note', 'Spec: note del feedback', 'la spec completa è nel campo note']) {
    assert.equal(SPEC.rimandiAlleNote(f).length, 1, f);
  }
  for (const f of ['#815: nelle note manca la data', '#812: le note del feedback non si vedono in Gestione', 'la nota di archiviazione cambia', 'un risultato notevole', 'la spec: notare il colore', '#812: le note si vedono solo dopo il riavvio']) {
    assert.deepEqual(SPEC.rimandiAlleNote(f), [], f);
  }
});

test('prerequisiti: le forme che mettono un feedback prima, non chi lo cita e basta', () => {
  const nums = (t, escludi) => SPEC.prerequisitiNelTesto(t, escludi).map((p) => p.num);
  assert.deepEqual(nums('#1202 si fonde prima'), ['1202']);
  assert.deepEqual(nums('Prerequisito: #1202 e #663.2'), ['1202', '663.2'], 'il punto di un sotto-numero non chiude la frase');
  assert.deepEqual(nums('prima va fuso #1202, poi il resto'), ['1202']);
  assert.deepEqual(nums('si lavora dopo che #1202 è su main'), ['1202']);
  assert.deepEqual(nums('dopo la fusione di #1202'), ['1202']);
  assert.deepEqual(nums('dipende da #1202'), ['1202']);
  assert.deepEqual(nums('il pacchetto aspetta #1202'), ['1202']);
  assert.deepEqual(nums('#1202 deve arrivare su main prima di questo'), ['1202']);
  // Senza la parola «prima» (#2033 giro 1).
  assert.deepEqual(nums('Da lavorare solo dopo #1202'), ['1202']);
  assert.deepEqual(nums('Partire quando #1202 è fuso'), ['1202']);
  assert.deepEqual(nums('#1202 deve essere già fuso'), ['1202']);
  assert.deepEqual(nums('non prima di #1202'), ['1202']);
  assert.deepEqual(nums('una volta fuso #1202, il menu'), ['1202']);
  assert.deepEqual(nums('#812: il menu si rompe dopo #1202'), [], 'una regressione nata dopo un feedback è cronaca');
  assert.deepEqual(nums('#1202 va aperto dal tasto destro'), [], '«va» senza fusione non mette niente prima');
  assert.deepEqual(nums('come in #1785, il menu si apre dal tasto destro'), [], 'una citazione non è un prerequisito');
  assert.deepEqual(nums('#903 aspettava #812 fino a ieri'), [], 'una cronaca al passato non mette niente prima');
  assert.deepEqual(nums('#812: dopo che #815 si fonde', ['812', '815']), [], 'le unite non si aspettano: entrano nel pacchetto');
  assert.deepEqual(nums('#1202 si fonde prima', ['#1202']), [], 'un\'attesa già scritta basta');
});

test('le unite si contano nominate con o senza #, mai dentro un altro numero', () => {
  assert.deepEqual(SPEC.uniteNonNominate('#812 e 815 cambiano', ['812', '815']), []);
  assert.deepEqual(SPEC.uniteNonNominate('#8120, #1812 e #812.3', ['812']), ['812']);
  assert.deepEqual(SPEC.uniteNonNominate('#663.2: il menu', ['663.2']), []);
  assert.deepEqual(SPEC.testoDegliAllegati([
    { type: 'text/markdown', dataUrl: `data:text/markdown;base64,${Buffer.from('#812').toString('base64')}` },
    { type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
  ]), ['#812'], 'le immagini non sono testo da leggere');
});

test('un feedback che non è un pacchetto non passa da questo controllo', async () => {
  const r = await conRete(() => SCRIPT.main(['t', 'Vedi le note: #1202 si fonde prima.', '--non-locale', '--dry-run']));
  assert.equal(r.code, 0, r.err.join('\n'));
});
