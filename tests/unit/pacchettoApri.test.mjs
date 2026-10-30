// `feedback:apri --pacchetto` (FEEDBACK-STATES.md § 3a, Pacchetti): il pacchetto nasce con gli allegati delle unite
// copiati (tutti, o non nasce), le archivia con la nota, e chi le aspettava aspetta lui. Le segnalazioni che non possono
// entrare fermano tutto prima di aprire, coi motivi detti insieme. Rete finta: si guarda cosa arriva a submit e cosa si scrive.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = await import('../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;
const TH = globalThis.SN_FEEDBACK_THREAD;
SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
SCRIPT.ambiente.routine = () => false;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const seg = (num, extra = {}) => ({ ok: true, id: `id${num}`, num, stato: 'todo', priorita: 1, locale: false, attese: [], ...extra });
const img = (indice, extra = {}) => ({ tipo: 'immagine', nome: '', type: '', url: `u-img-${indice}`, conversazione: false, indice, ...extra });
const doc = (nome, extra = {}) => ({ tipo: 'documento', nome, type: 'text/plain', url: `u-${nome}`, conversazione: false, indice: 1, ...extra });

async function conRete({ lette, allegati = {}, byte = () => PNG, attesi = [], sposta = async () => ({ ok: true }), archivia = async () => ({ ok: true }), seq = 900 }, fn) {
  const P = SCRIPT.pacchetto;
  const orig = { submit: FB.submit, risolvi: SCRIPT.attese.risolvi, ...P, log: console.log, err: console.error };
  SCRIPT.attese.risolvi = async (numeri) => ({ ok: true, attese: numeri.map((n) => ({ id: `id${n}`, num: n })) });
  const visti = { submit: [], spostate: [], archiviate: [], out: [], err: [] };
  FB.submit = async (payload, opts) => { visti.submit.push({ payload, opts }); return { id: 'pacco', seq, senderProof: 'admin', images: payload.images, files: payload.files }; };
  P.leggi = async (numeri) => numeri.map((n) => lette[n] || { ok: false, num: n, motivo: `nessun feedback #${n}` });
  P.allegati = async (u) => allegati[u.num] || [];
  P.scarica = async (a) => byte(a);
  P.attesiDa = async () => attesi;
  P.sposta = async (x, voce) => { visti.spostate.push({ id: x.id, voce }); return sposta(x, voce); };
  P.archivia = async (u, nota) => { visti.archiviate.push({ id: u.id, nota }); return archivia(u, nota); };
  console.log = (...a) => visti.out.push(a.join(' '));
  console.error = (...a) => visti.err.push(a.join(' '));
  try { return { code: await fn(), ...visti }; } finally {
    FB.submit = orig.submit; SCRIPT.attese.risolvi = orig.risolvi;
    for (const k of ['leggi', 'allegati', 'scarica', 'attesiDa', 'sposta', 'archivia']) P[k] = orig[k];
    console.log = orig.log; console.error = orig.err;
  }
}

test('il pacchetto nasce con le unite, le archivia con la nota e prende la priorità più alta fra loro', async () => {
  const r = await conRete({ lette: { 812: seg('812', { priorita: 2 }), 815: seg('815', { attese: [{ id: 'x', num: '700' }] }) } },
    () => SCRIPT.main(['Menu del tasto destro', 'La spec: #812 la voce manca, #815 il hover.', '--non-locale', '--pacchetto', '812,815']));
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.deepEqual(r.submit[0].opts.unisce, [{ id: 'id812', num: '812' }, { id: 'id815', num: '815' }]);
  assert.equal(r.submit[0].opts.priority, 2, 'senza --priorita il pacchetto non sta sotto le sue segnalazioni');
  assert.equal(r.submit[0].opts.interi, true, 'un allegato che non sale ferma la nascita');
  assert.deepEqual(r.archiviate, [{ id: 'id812', nota: 'Unito nel pacchetto #900: il lavoro continua lì' }, { id: 'id815', nota: 'Unito nel pacchetto #900: il lavoro continua lì' }]);
  assert.deepEqual(r.spostate, [], 'nessuno le aspettava');
  assert.match(r.out.join('\n'), /Archiviate #812, #815 con la nota «Unito nel pacchetto #900: il lavoro continua lì»/);
  assert.equal(r.submit[0].payload.text, 'La spec: #812 la voce manca, #815 il hover.', 'senza allegati la spec resta com\'è');
});

test('gli allegati delle unite salgono col pacchetto: documenti col nome di origine, immagini con l\'origine in coda alla spec', async () => {
  const r = await conRete({
    lette: { 812: seg('812'), 815: seg('815') },
    allegati: {
      812: [img(1), doc('log.txt')],
      815: [img(1), img(1, { conversazione: true, url: 'u-conv' })],
    },
    byte: (a) => (a.tipo === 'documento' ? Buffer.from('riga di log') : PNG),
  }, () => SCRIPT.main(['t', 'La spec.', '--non-locale', '--pacchetto', '812,815']));
  assert.equal(r.code, 0, r.err.join('\n'));
  const { payload } = r.submit[0];
  assert.deepEqual(payload.images.map((i) => i.name), ['#812 — immagine 1', '#815 — immagine 1', '#815 — immagine 1 della conversazione']);
  assert.ok(payload.images.every((i) => i.dataUrl.startsWith('data:image/png;base64,')));
  assert.deepEqual(payload.files.map((f) => [f.name, f.type]), [['#812 — log.txt', 'text/plain']]);
  assert.equal(Buffer.from(payload.files[0].dataUrl.split(',')[1], 'base64').toString(), 'riga di log', 'il contenuto è quello dell\'unita, in chiaro per la cifratura di submit');
  assert.equal(payload.text, [
    'La spec.', '', 'Allegati copiati dalle segnalazioni unite:',
    '- immagine 1: da #812, la sua immagine 1',
    '- «#812 — log.txt»: da #812',
    '- immagine 2: da #815, la sua immagine 1',
    '- immagine 3: da #815, la sua immagine 1 della conversazione',
  ].join('\n'));
  assert.match(r.out.join('\n'), /Allegati copiati dalle unite: 3 immagini, 1 documenti/);
  assert.match(r.out.join('\n'), /Nasce non fidato perché porta allegati di #812, #815, scritti da chi non è fidato/);
});

test('un pacchetto che porta allegati di unite non fidate nasce non fidato anche da una sessione pulita', async () => {
  assert.deepEqual(SCRIPT.uniteNonFidate([
    { u: { num: '1', fidato: true }, allegati: [img(1)] },
    { u: { num: '2', fidato: false }, allegati: [img(1)] },
    { u: { num: '3', fidato: false }, allegati: [] },
    { u: { num: '4', fidato: true }, allegati: [img(1, { conversazione: true, daAltri: true })] },
  ]), ['#2', '#4'], 'una unita fidata senza allegati, o con allegati suoi, non toglie niente');
  const orig = FB.submit;
  const visti = [];
  FB.submit = async (payload, opts) => { visti.push(opts); return { id: 'p', seq: 1, senderProof: 'admin' }; };
  try {
    const pulito = { fp: 'a'.repeat(64), fiducia: 'fidato' };
    const r = await SCRIPT.apri({ titolo: 't', testo: 'x', idToken: 'tok', biglietto: pulito, unisce: [{ id: 'id2', num: '2' }], nonFidato: 'porta allegati di #2' });
    assert.equal(visti[0].bigliettoLocale, undefined, 'senza biglietto il server lo fa nascere non fidato');
    assert.equal(r.biglietto, 'tolto');
    await SCRIPT.apri({ titolo: 't', testo: 'x', idToken: 'tok', biglietto: pulito, unisce: [{ id: 'id1', num: '1' }] });
    assert.equal(visti[1].bigliettoLocale, pulito.fp);
  } finally { FB.submit = orig; }
});

test('oltre il tetto di un feedback il pacchetto non nasce, e il conto si dice per unita', async () => {
  const tre = [img(1), img(2), img(3)];
  const r = await conRete({ lette: { 812: seg('812'), 815: seg('815') }, allegati: { 812: tre, 815: tre } },
    () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,815']));
  assert.equal(r.code, 3);
  assert.equal(r.submit.length, 0, 'niente pacchetto monco');
  assert.deepEqual(r.archiviate, []);
  assert.match(r.err.join('\n'), /le unite portano 6 immagini \(#812: 3, #815: 3\): un feedback ne tiene al più 5/);
  assert.deepEqual(SCRIPT.tettoAllegati([{ u: { num: '1' }, allegati: [img(1), img(2), img(3)] }], { immagini: 3 }),
    ['le unite portano 3 immagini (#1: 3) e tu ne alleghi 3: un feedback ne tiene al più 5. Dividi il pacchetto, o allega meno']);
  assert.deepEqual(SCRIPT.tettoAllegati([{ u: { num: '1' }, allegati: [img(1), doc('a.md'), doc('b.md')] }], { immagini: 4, documenti: 3 }), [], 'il tetto è per tipo');
});

test('un allegato che non si apre, o che un feedback non ammette, ferma tutto prima di aprire', async () => {
  const giu = await conRete({
    lette: { 812: seg('812') }, allegati: { 812: [img(1)] },
    byte: () => { throw Object.assign(new Error('allegato cifrato, ma la chiave privata non è configurata'), { definitivo: true }); },
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812']));
  assert.equal(giu.code, 3);
  assert.equal(giu.submit.length, 0);
  assert.match(giu.err.join('\n'), /#812: l'immagine 1 non si apre \(allegato cifrato, ma la chiave privata non è configurata\)\. Non ho aperto niente/);
  const rete = await conRete({ lette: { 812: seg('812') }, allegati: { 812: [img(1)] }, byte: () => { throw new Error('fetch failed'); } },
    () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812']));
  assert.equal(rete.code, 4, 'la rete caduta si riprova');
  const strani = await conRete({
    lette: { 812: seg('812') },
    allegati: { 812: [img(1), doc('pagina.html', { type: 'text/html' }), doc('vuoto.txt')] },
    byte: (a) => (a.tipo === 'immagine' ? Buffer.from('<svg onload=x>') : a.nome === 'vuoto.txt' ? new Uint8Array(0) : Buffer.from('<p>')),
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812']));
  assert.equal(strani.code, 3);
  assert.equal(strani.submit.length, 0);
  const testo = strani.err.join('\n');
  assert.match(testo, /#812: l'immagine 1 non è un'immagine che Filo apre/);
  assert.match(testo, /#812: l'allegato «pagina\.html» ha un tipo che un feedback non ammette \(text\/html\)/);
  assert.match(testo, /#812: l'allegato «vuoto\.txt» è vuoto/);
});

test('chi aspettava una unita passa al pacchetto prima che lei si archivi; se non passa, lei resta aperta e la riga per rimediare è intera', async () => {
  const attesi = [
    { id: 'id903', num: '903', togli: ['id812'], quali: ['812'], tenute: ['676'] },
    { id: 'id904', num: '904', togli: ['id815'], quali: ['815'], tenute: [] },
  ];
  const ordine = [];
  const r = await conRete({
    lette: { 812: seg('812'), 815: seg('815') }, attesi,
    sposta: async (x) => { ordine.push(`sposta ${x.num}`); return x.id === 'id904' ? { ok: false, motivo: 'scrittura fallita (503)' } : { ok: true }; },
    archivia: async (u) => { ordine.push(`archivia ${u.num}`); return { ok: true }; },
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,815']));
  assert.equal(r.code, 3);
  assert.deepEqual(r.spostate.map((s) => [s.id, s.voce]), [['id903', { id: 'pacco', num: '900' }], ['id904', { id: 'pacco', num: '900' }]]);
  assert.deepEqual(ordine.slice(0, 2).sort(), ['sposta 903', 'sposta 904'], 'le attese si spostano prima di archiviare');
  assert.deepEqual(r.archiviate.map((a) => a.id), ['id812'], '#815 la aspetta ancora #904: non si archivia');
  assert.match(r.out.join('\n'), /Attese spostate sul pacchetto: #903 \(aspettava #812\)/);
  const err = r.err.join('\n');
  assert.match(err, /ATTESA NON SPOSTATA su #904 \(scrittura fallita \(503\)\): aspetta ancora #815\. Rimedia con: npm run feedback -- 904 --aspetta 900/);
  assert.match(err, /#815 NON ARCHIVIATA.*npm run feedback -- 815 archived "Unito nel pacchetto #900: il lavoro continua lì"/);
});

test('un\'archiviazione che non riesce si dice con la riga per rimediare', async () => {
  const r = await conRete({
    lette: { 812: seg('812'), 815: seg('815') },
    archivia: async (u) => (u.num === '815' ? { ok: false, motivo: 'scrittura fallita (503)' } : { ok: true }),
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,815']));
  assert.equal(r.code, 3);
  assert.match(r.out.join('\n'), /Archiviate #812 con la nota/);
  assert.match(r.err.join('\n'), /ARCHIVIAZIONE NON RIUSCITA su #815 \(scrittura fallita \(503\)\): resta in coda.*npm run feedback -- 815 archived "Unito nel pacchetto #900: il lavoro continua lì"/);
});

test('chi aspetta una unita ed è aspettato dal pacchetto chiuderebbe un giro: si dice prima di aprire', async () => {
  const r = await conRete({
    lette: { 812: seg('812'), 700: seg('700') },
    attesi: [{ id: 'id700', num: '700', togli: ['id812'], quali: ['812'], tenute: [] }],
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812', '--aspetta', '700']));
  assert.equal(r.code, 3, r.err.join('\n'));
  assert.equal(r.submit.length, 0);
  assert.match(r.err.join('\n'), /#700 aspetta #812, che entra nel pacchetto, e il pacchetto aspetta #700: si aspetterebbero a vicenda/);
});

test('un pacchetto nato senza numero non archivia niente, e dice i passi in ordine', async () => {
  const r = await conRete({
    lette: { 812: seg('812') }, seq: null,
    attesi: [{ id: 'id903', num: '903', togli: ['id812'], quali: ['812'], tenute: ['676'] }],
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812']));
  assert.equal(r.code, 3);
  assert.deepEqual(r.archiviate, []);
  assert.deepEqual(r.spostate, []);
  const err = r.err.join('\n');
  assert.match(err, /UNITE NON ARCHIVIATE: il pacchetto è nato senza numero/);
  assert.ok(err.indexOf('npm run feedback -- 903 --aspetta 676,<numero del pacchetto>') < err.indexOf('npm run feedback -- 812 archived'), 'prima le attese');
});

test('i riferimenti agli allegati di una unita comprendono quelli della conversazione', () => {
  const s = (v) => ({ stringValue: v });
  const fields = {
    images: { arrayValue: { values: [s('https://a/1')] } },
    files: { arrayValue: { values: [{ mapValue: { fields: { url: s('https://a/2'), name: s('spec.md'), type: s('text/markdown') } } }] } },
  };
  const conversazione = ['un commento', TH.serializeAttachment({ kind: 'img', url: 'https://a/3' }), TH.serializeAttachment({ kind: 'file', url: 'https://a/4', name: 'log.txt', type: 'text/plain' })].join('\n');
  assert.deepEqual(SCRIPT.riferimentiAllegati(fields, conversazione), [
    { tipo: 'immagine', nome: '', type: '', url: 'https://a/1', conversazione: false, indice: 1 },
    { tipo: 'immagine', nome: '', type: '', url: 'https://a/3', conversazione: true, indice: 1 },
    { tipo: 'documento', nome: 'spec.md', type: 'text/markdown', url: 'https://a/2', conversazione: false, indice: 1 },
    { tipo: 'documento', nome: 'log.txt', type: 'text/plain', url: 'https://a/4', conversazione: true, indice: 1 },
  ]);
});

test('le letture vere: allegati col documento e la conversazione, una conversazione che non si decifra ferma, una scansione a metà pure', async () => {
  const vero = globalThis.fetch;
  const viste = [];
  const conversazione = (notes) => async (url) => {
    viste.push(String(url));
    return { ok: true, status: 200, json: async () => ({ fields: { images: { arrayValue: { values: [{ stringValue: 'https://a/1' }] } }, notes: { stringValue: notes } } }) };
  };
  try {
    globalThis.fetch = conversazione(TH.serializeAttachment({ kind: 'img', url: 'https://a/2' }));
    const refs = await SCRIPT.pacchetto.allegati({ id: 'id812', num: '812' }, 'tok');
    assert.deepEqual(refs.map((a) => [a.url, a.conversazione]), [['https://a/1', false], ['https://a/2', true]]);
    assert.match(viste[0], /feedback\/id812\?mask\.fieldPaths=images&mask\.fieldPaths=files&mask\.fieldPaths=notes$/, 'si chiedono solo i campi che servono');
    // Un cifrato che nessuna chiave apre: la prova non dipende da quale chiave ha la macchina che la lancia.
    globalThis.fetch = conversazione('FENC1:nessuna-chiave-lo-apre');
    await assert.rejects(SCRIPT.pacchetto.allegati({ id: 'id812', num: '812' }, 'tok'), (e) => e.definitivo === true && /la conversazione di #812 non si decifra/.test(e.message));
  } finally { globalThis.fetch = vero; }
  await assert.rejects(SCRIPT.pacchetto.scarica({ url: 'https://altrove.example/x.png' }), (e) => e.definitivo === true);
  const lista = FB.listAllPaged;
  FB.listAllPaged = async () => ({ rows: [{ _id: 'a' }], complete: false });
  try { await assert.rejects(SCRIPT.pacchetto.attesiDa([{ id: 'id812', num: '812' }], 'tok'), /non è completa \(1 documenti\)/); } finally { FB.listAllPaged = lista; }
});

test('chi aspetta le unite si trova per id, e le unite stesse no', () => {
  const righe = [
    { _id: 'id903', seq: 903, waitsFor: [{ id: 'id676', num: '676' }, { id: 'id812', num: '' }] },
    { _id: 'id815', seq: 815, waitsFor: [{ id: 'id812', num: '812' }] },
    { _id: 'id904', seq: 904, waitsFor: [{ id: 'id676', num: '676' }] },
  ];
  assert.deepEqual(SCRIPT.chiAspetta(righe, [{ id: 'id812', num: '812' }, { id: 'id815', num: '815' }]), [
    { id: 'id903', num: '903', togli: ['id812'], quali: ['812'], tenute: ['676'] },
  ]);
});

test('una segnalazione che non può entrare ferma tutto prima di aprire, e i motivi si dicono insieme', async () => {
  const lette = {
    1: seg('1', { stato: 'working' }),
    2: seg('2', { priorita: 3 }),
    3: seg('3', { locale: true }),
    4: seg('4', { stato: '' }),
    5: seg('5', { attese: Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, num: String(100 + i) })) }),
  };
  const r = await conRete({ lette }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '1,2,3,4,5,6']));
  assert.equal(r.code, 3);
  assert.equal(r.submit.length, 0, 'non si apre niente');
  const testo = r.err.join('\n');
  for (const atteso of [/#1 è «working»/, /#2 ha priorità 3/, /#3 è un lavoro locale/, /#4: lo stato non si legge/, /#5 aspetta già 20/, /#6: nessun feedback #6/]) {
    assert.match(testo, atteso);
  }
});

test('una segnalazione che il pacchetto stesso aspetta non si unisce: si aspetterebbero a vicenda', () => {
  assert.deepEqual(SCRIPT.controllaUnite([seg('7')], { aspetta: ['7'] }), ['#7 è anche fra quelli che il pacchetto aspetta: si aspetterebbero a vicenda']);
  assert.deepEqual(SCRIPT.controllaUnite([seg('7')]), []);
  assert.equal(SCRIPT.prioritaDelPacchetto(0, [seg('1', { priorita: 2 })]), 0, 'una priorità scelta vale');
  assert.equal(SCRIPT.prioritaDelPacchetto(null, [seg('1', { priorita: null })]), null);
});

test('--pacchetto senza numeri, o con numeri storti, è un errore d\'uso; a vuoto non tocca la rete', async () => {
  const vuoto = await conRete({ lette: {} }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto']));
  assert.equal(vuoto.code, 1);
  assert.match(vuoto.err.join('\n'), /--pacchetto vuole un valore/);
  const storto = await conRete({ lette: {} }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', 'menu']));
  assert.equal(storto.code, 1);
  assert.match(storto.err.join('\n'), /«menu» non è un numero di feedback/);
  const prova = await conRete({ lette: {} }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,815', '--dry-run']));
  assert.equal(prova.code, 0);
  assert.equal(prova.submit.length, 0);
  assert.match(prova.out.join('\n'), /come pacchetto che unisce #812, #815 \(coi loro allegati, e alla nascita le archivio\)/);
});

test('submit scrive `unisce` solo col token admin, nella forma delle attese', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../src/shared/feedback.js', import.meta.url), 'utf8');
  assert.match(src, /if \(unite\.length\) doc\.fields\.unisce = toFsValue\(unite\)/);
  const regole = (await import('node:fs')).readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(regole, /&& unisceValido\(request\.resource\.data\)/, 'le regole controllano la forma alla nascita');
});

test('submit con `interi`: un allegato che non sale ferma tutto prima di scrivere il documento', async () => {
  const vero = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url) => {
    chiamate.push(String(url));
    return { ok: false, status: 503, json: async () => ({}), text: async () => 'giù' };
  };
  try {
    await assert.rejects(
      FB.submit({ text: 'spec', name: 't', clientId: 'local:claude', images: [{ name: '#812 — immagine 1', dataUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` }] },
        { idToken: 'tok', soloAdmin: true, unisce: [{ id: 'id812', num: '812' }], interi: true }),
      (e) => /allegati non caricati: #812 — immagine 1 \(caricamento non riuscito\)/.test(e.message) && Array.isArray(e.allegatiFalliti),
    );
    assert.ok(chiamate.length >= 1, 'il caricamento è stato tentato');
    assert.ok(chiamate.every((u) => !u.includes(':commit') && !u.includes('/documents/')), `nessun documento scritto: ${chiamate.join(', ')}`);
  } finally { globalThis.fetch = vero; }
});

test('una segnalazione già in un pacchetto aperto, o con un ramo di lavoro, non entra in un altro', async () => {
  const lette = {
    812: seg('812', { attese: [{ id: 'id950', num: '950' }] }),
    815: seg('815', { ramo: 'worker/abc-20261020T100000Z' }),
    816: seg('816', { attese: [{ id: 'id700', num: '700' }] }),
    950: seg('950', { unisce: ['812'] }),
    700: seg('700'),
  };
  const r = await conRete({ lette }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,815,816']));
  assert.equal(r.code, 3);
  assert.equal(r.submit.length, 0);
  const testo = r.err.join('\n');
  assert.match(testo, /#812 è già nel pacchetto #950/);
  assert.match(testo, /#815 ha già un ramo con lavoro/);
  assert.doesNotMatch(testo, /#816/, 'aspettare un feedback che non è un pacchetto non ferma');
});

test('una unita rimasta in coda col rimando a un pacchetto aperto non entra in un altro; un rimando a un pacchetto chiuso no', async () => {
  const lette = {
    812: seg('812', { unitoIn: 'id960' }),
    813: seg('813', { unitoIn: 'id970' }),
    814: seg('814', { unitoIn: 'id980' }),
    id960: seg('960', { unisce: ['812'] }),
    id970: seg('970', { unisce: ['813'], stato: 'archived' }),
    id980: seg('980'),
  };
  const r = await conRete({ lette }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,813,814']));
  assert.equal(r.code, 3);
  assert.equal(r.submit.length, 0, 'due pacchetti farebbero lo stesso lavoro su #812');
  const testo = r.err.join('\n');
  assert.match(testo, /#812 è già nel pacchetto #960/);
  assert.doesNotMatch(testo, /#813|#814/, 'rimessa in coda dopo un pacchetto archiviato, o unita in un feedback che non è un pacchetto: entra');
  assert.deepEqual(SCRIPT.controllaUnite([seg('812', { unitoIn: 'id960', attese: [{ id: 'id960', num: '960' }] })], { pacchetti: ['960'], pacchettiPerId: { id960: '960' } }),
    ['#812 è già nel pacchetto #960: due pacchetti farebbero lo stesso lavoro'], 'attesa e rimando sullo stesso pacchetto: un motivo solo');
});
