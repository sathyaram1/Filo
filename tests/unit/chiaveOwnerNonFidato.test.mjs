// #2015: domanda.mjs e il manutentore con la chiave owner-non-fidato. Ordine delle credenziali, corpi delle richieste
// verso chiaveDomande e routineManutentore, rifiuti prima di chiamare, e la stampa che dice con cosa si parla.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const K = await import('../../scripts/lib/chiave-di-classe.mjs');
const Q = await import('../../scripts/domanda.mjs');
const M = await import('../../scripts/manutentore.mjs');

const NON_FIDATO = { tipo: 'owner-non-fidato', passphrase: 'parola-owner', variabile: 'FILO_OWNER_NON_FIDATO_KEY' };
const DEL_MANUTENTORE = { tipo: 'manutentore', passphrase: 'parola-man', variabile: 'FILO_MANUTENTORE_KEY' };

test('l’ordine delle credenziali: token admin, poi chiave owner-non-fidato, poi quella del manutentore', () => {
  const tutte = { FILO_OWNER_NON_FIDATO_KEY: ' o ', FILO_MANUTENTORE_KEY: 'm' };
  assert.deepEqual(Q.credenzialeDomande({ env: tutte, tokenAdmin: 'tok' }), { tipo: 'admin' });
  assert.deepEqual(Q.credenzialeDomande({ env: tutte }), { tipo: 'owner-non-fidato', passphrase: 'o', variabile: 'FILO_OWNER_NON_FIDATO_KEY' });
  assert.deepEqual(Q.credenzialeDomande({ env: { FILO_MANUTENTORE_KEY: 'm', FILO_OWNER_NON_FIDATO_KEY: '  ' } }),
    { tipo: 'manutentore', passphrase: 'm', variabile: 'FILO_MANUTENTORE_KEY' }, 'una chiave di soli spazi non conta');
  assert.equal(Q.credenzialeDomande({ env: {} }), null);
  assert.equal(K.chiaveDallAmbiente(null), null);
  // Il manutentore legge lo stesso ordine: la chiave owner-non-fidato vince, il biglietto viene prima di tutte e due.
  assert.deepEqual(M.credenziale({ env: tutte }), { passphrase: 'o', classe: 'owner-non-fidato' });
  assert.deepEqual(M.credenziale({ argv: ['stato', '--ticket', 'b'], env: tutte }), { ticket: 'b' });
  assert.deepEqual(M.credenziale({ env: tutte, bigliettoDelGiro: 'g', ruoloDelGiro: 'manutentore' }), { ticket: 'g' });
});

test('senza credenziali il rifiuto nomina le variabili che mancano, in tutti e due gli strumenti', () => {
  for (const v of ['FILO_ADMIN_REFRESH_TOKEN', 'FILO_OWNER_NON_FIDATO_KEY']) assert.match(Q.SENZA_CREDENZIALI, new RegExp(v));
  for (const v of ['FILO_OWNER_NON_FIDATO_KEY', 'FILO_MANUTENTORE_KEY', 'crea <nome> owner-non-fidato', 'crea <nome> manutentore']) {
    assert.ok(M.SENZA_CREDENZIALE.includes(v), v);
  }
});

test('il corpo per chiaveDomande: la parola d’ordine in passphrase, senza biglietto né sessione', async () => {
  assert.deepEqual(Q.corpoChiave({ op: 'rispondi', id: 'D-3', scelta: 1, sessione: true, biglietto: 'segreto' }, 'k'),
    { op: 'rispondi', id: 'D-3', scelta: 1, passphrase: 'k' });
  assert.deepEqual(Q.corpoChiave({ op: 'elenco', passphrase: 'altra' }, 'k'), { op: 'elenco', passphrase: 'k' });
  const viste = [];
  const fetchImpl = async (url, init) => {
    viste.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ result: { ok: true, domande: [] } }) };
  };
  assert.deepEqual(await Q.chiamaConChiave({ op: 'elenco', biglietto: 's' }, 'k', { fetchImpl }), { ok: true, domande: [] });
  assert.match(viste[0].url, /\/chiaveDomande$/);
  assert.equal(viste[0].init.headers.Authorization, undefined, 'niente token admin con la chiave');
  assert.deepEqual(JSON.parse(viste[0].init.body), { data: { op: 'elenco', passphrase: 'k' } });
  const rifiuto = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'serve la chiave owner-non-fidato' } }) });
  await assert.rejects(Q.chiamaConChiave({ op: 'elenco' }, 'k', { fetchImpl: rifiuto }), /Non riuscito: serve la chiave owner-non-fidato/);
  const assente = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(Q.chiamaConChiave({ op: 'elenco' }, 'k', { fetchImpl: assente }), /chiaveDomande non esiste/);
});

/** Lo strumento delle domande con la credenziale scelta e i canali finti. */
function finto(cred, risposte = {}) {
  const owner = []; const chiave = []; const registri = []; const consegne = []; const out = []; const err = []; const ordine = [];
  const rispondi = (data) => {
    const r = typeof risposte[data.op] === 'function' ? risposte[data.op](data) : risposte[data.op];
    return r || { ok: true };
  };
  const io = {
    credenziale: async () => cred,
    chiama: async (data) => { owner.push(data); return rispondi(data); },
    chiamaChiave: async (data, passphrase) => { chiave.push({ data, passphrase }); return rispondi(data); },
    registroChiave: async (passphrase, parole) => { registri.push({ passphrase, parole }); return { voci: risposte.voci || [] }; },
    consegna: async (t, domanda) => { consegne.push({ t, domanda }); return { outcome: 'ok', id: 'D-7', num: 'D-7' }; },
    registroCanale: async () => ({ outcome: 'ok', reply: { voci: [] } }),
    biglietto: async () => risposte.biglietto || '',
    bigliettoLocale: async () => 'segreto-locale',
    sporca: async () => { ordine.push('sporca'); return 'sporcato'; },
    leggiFile: (p) => risposte.file[p],
    stdin: async () => '',
    scrivi: (s) => { out.push(String(s)); ordine.push('scrivi'); },
    errore: (s) => err.push(String(s)),
  };
  return { io, owner, chiave, registri, consegne, out, err, ordine };
}

const DOMANDA = (o = {}) => ({
  id: 'D-3', titolo: 'Prova', stato: 'aperta', fiducia: 'fidato', priorita: 'importante',
  opzioni: [
    { testo: 'Riprendi', pro: 'p', contro: 'c', azione: { tipo: 'riprendi', feedbackId: 'F1' } },
    { testo: 'Spegni', pro: 'p', contro: 'c', azione: { tipo: 'automazione', chiave: 'routine.enabled', valore: false } },
  ],
  consiglio: { opzione: 0, perche: 'x' },
  ...o,
});

test('con la chiave owner-non-fidato elenco, mostra, rispondi, archivia e riapri vanno a chiaveDomande, e la stampa lo dice', async () => {
  const f = finto(NON_FIDATO, {
    elenco: { domande: [DOMANDA()] },
    mostra: { domanda: DOMANDA(), riferimenti: {} },
    rispondi: { domanda: DOMANDA({ stato: 'in_lavorazione' }), esito: { ok: true, azione: { tipo: 'riprendi', feedbackId: 'F1' } } },
    archivia: { domanda: DOMANDA({ stato: 'chiusa' }) },
    riapri: { domanda: DOMANDA({ stato: 'aperta' }) },
  });
  for (const argv of [['elenco'], ['mostra', 'D-3'], ['rispondi', 'D-3', '--scelta', '1'], ['archivia', 'D-3'], ['riapri', 'D-3']]) {
    assert.equal(await Q.esegui(argv, f.io), 0, `${argv.join(' ')}: ${f.err.join(' | ')}`);
  }
  assert.equal(f.owner.length, 0, 'il token admin non è stato usato');
  assert.deepEqual(f.chiave.map((c) => c.passphrase), Array(6).fill('parola-owner'));
  assert.deepEqual(f.chiave.map((c) => c.data), [
    { op: 'elenco' }, { op: 'mostra', id: 'D-3' }, { op: 'mostra', id: 'D-3' }, { op: 'rispondi', id: 'D-3', scelta: 0 },
    { op: 'archivia', id: 'D-3' }, { op: 'riapri', id: 'D-3' },
  ], 'niente biglietto locale né «sessione»: con la chiave il server non li legge');
  const righe = f.out.filter((s) => s.startsWith('Parlo con la chiave owner-non-fidato (FILO_OWNER_NON_FIDATO_KEY)'));
  assert.equal(righe.length, 5, 'ogni comando dice con cosa parla');
  assert.match(righe[0], /nascono non fidate/);
  assert.ok(f.out.some((s) => /^OK: D-3 è in_lavorazione; applicata/.test(s)));
  assert.ok(f.out.some((s) => s === 'OK: D-3 è chiusa.'));
  assert.ok(f.out.some((s) => s === 'OK: D-3 è aperta.'), 'la riapre');
  const c = finto(NON_FIDATO, { mostra: { domanda: DOMANDA(), riferimenti: {} }, consiglio: { esiti: [{ id: 'D-3', ok: true }] } });
  assert.equal(await Q.esegui(['consiglio', 'D-3'], c.io), 0, c.err.join(' | '));
  assert.deepEqual(c.chiave.map((x) => x.data), [{ op: 'mostra', id: 'D-3' }, { op: 'consiglio', ids: ['D-3'] }]);
  assert.equal(c.owner.length, 0);
});

test('con la chiave restano i controlli di prima: l’opzione «solo dalla finestra» non parte, la non fidata sporca prima di stampare', async () => {
  const f = finto(NON_FIDATO, { mostra: { domanda: DOMANDA({ fiducia: 'non_fidato' }), riferimenti: {} } });
  assert.equal(await Q.esegui(['rispondi', 'D-3', '--scelta', '2'], f.io), 1);
  assert.match(f.err.join('\n'), /solo dalla finestra di Filo/);
  assert.deepEqual(f.chiave.map((c) => c.data.op), ['mostra'], 'rispondi non è partito');
  const g = finto(NON_FIDATO, { mostra: { domanda: DOMANDA({ fiducia: 'non_fidato' }), riferimenti: {} } });
  assert.equal(await Q.esegui(['mostra', 'D-3'], g.io), 0);
  assert.deepEqual(g.ordine, ['scrivi', 'sporca', 'scrivi'], 'la riga della credenziale, poi lo sporco, poi il testo');
});

test('chiedi con una chiave non parte; col biglietto delle routine il biglietto vince sulla chiave', async () => {
  const testo = JSON.stringify({
    titolo: 'Una prova', priorita: 'quando_puoi', contesto: 'c', problema: 'Scegli tu.',
    opzioni: [{ testo: 'A', pro: 'p', contro: 'c', azione: { tipo: 'archivia', feedbackId: 'F1' } }, { testo: 'B', pro: 'p', contro: 'c', azione: { tipo: 'riprendi', feedbackId: 'F1' } }],
    consiglio: { opzione: 0, perche: 'x' }, blocca: true,
    origine: { tipo: 'feedback', id: 'F1' },
  });
  const f = finto(NON_FIDATO, { file: { 'd.json': testo } });
  assert.equal(await Q.esegui(['chiedi', 'd.json'], f.io), 1);
  assert.match(f.err.join('\n'), /«chiedi» con la chiave owner-non-fidato non parte.*Non ho chiamato il server/s);
  assert.equal(f.owner.length + f.chiave.length + f.consegne.length, 0);
  const g = finto(NON_FIDATO, { file: { 'd.json': testo.replace(/,"origine":\{[^}]*\}/, '') }, biglietto: 'bigl' });
  assert.equal(await Q.esegui(['chiedi', 'd.json'], g.io), 0, g.err.join(' | '));
  assert.equal(g.consegne.length, 1);
  assert.equal(g.out.some((s) => s.startsWith('Parlo con la chiave')), false, 'col biglietto la chiave non c’entra');
});

test('la chiave del manutentore delle domande fa solo il registro; senza credenziali non si chiama niente', async () => {
  const f = finto(DEL_MANUTENTORE, { voci: [{ id: 'D-1', titolo: 'T', principio: 'P', fiducia: 'fidato' }] });
  assert.equal(await Q.esegui(['registro', 'crediti', 'dichiarati'], f.io), 0, f.err.join(' | '));
  assert.deepEqual(f.registri, [{ passphrase: 'parola-man', parole: 'crediti dichiarati' }]);
  assert.match(f.out.join('\n'), /D-1 T/);
  assert.equal(await Q.esegui(['elenco'], f.io), 1);
  assert.match(f.err.join('\n'), /legge solo il registro: per elenco serve FILO_ADMIN_REFRESH_TOKEN o FILO_OWNER_NON_FIDATO_KEY/);
  const g = finto(NON_FIDATO);
  assert.equal(await Q.esegui(['registro', 'crediti'], g.io), 0);
  assert.deepEqual(g.registri, [{ passphrase: 'parola-owner', parole: 'crediti' }]);
  for (const argv of [['elenco'], ['mostra', 'D-3'], ['rispondi', 'D-3', '--testo', 'ok'], ['archivia', 'D-3'], ['registro', 'x']]) {
    const n = finto(null);
    assert.equal(await Q.esegui(argv, n.io), 1, argv.join(' '));
    assert.match(n.err.join('\n'), /FILO_OWNER_NON_FIDATO_KEY.*Non ho chiamato il server/s);
    assert.equal(n.owner.length + n.chiave.length + n.registri.length, 0);
  }
});

/** Il server finto del manutentore: tiene i corpi, risponde per operazione. */
function serverFinto(t, risposte) {
  const corpi = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    corpi.push({ url: String(url), ...b });
    const r = risposte[b.op] || [400, { ok: false, reason: 'malformed', detail: `op ${b.op}` }];
    return { status: r[0], ok: r[0] < 300, text: async () => JSON.stringify(r[1]), json: async () => r[1] };
  };
  const out = []; const err = [];
  const [l, e] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => err.push(a.join(' '));
  t.after(() => { globalThis.fetch = prima; console.log = l; console.error = e; });
  return { corpi, out, err };
}

test('il manutentore con la chiave owner-non-fidato: ordini e sblocco sul suo canale, con quella chiave', async (t) => {
  const s = serverFinto(t, { sblocca: [200, { ok: true, numero: '812', sbloccato: 'F' }], registro: [200, { ok: true, voci: [] }] });
  const opts = { env: { FILO_OWNER_NON_FIDATO_KEY: 'parola-owner', FILO_MANUTENTORE_KEY: 'parola-man' }, root: cartellaTemporanea('chiave-owner') };
  assert.equal(await M.main(['sblocca', '812', 'riparato'], opts), 0, s.err.join(' | '));
  assert.equal(await M.main(['registro', 'crediti'], opts), 0, s.err.join(' | '));
  assert.deepEqual(s.corpi.map((c) => [c.url.replace(/.*\//, ''), c.op, c.passphrase]), [
    ['routineManutentore', 'sblocca', 'parola-owner'], ['routineManutentore', 'registro', 'parola-owner'],
  ], 'lo sblocco non passa dal canale dell’owner, e la chiave è quella owner-non-fidato');
});

test('la chat con la chiave owner-non-fidato sa che risponde anche alle domande; con quella del manutentore no', () => {
  const con = M.primoMessaggioChat('/x/contesto.md', { classe: 'owner-non-fidato' });
  assert.match(con, /node scripts\/domanda\.mjs elenco/);
  assert.match(con, /nascono non fidate/);
  assert.equal(/domanda\.mjs/.test(M.primoMessaggioChat('/x/contesto.md', { classe: 'manutentore' })), false);
  assert.ok(con.endsWith('Poi chiedigli di cosa vuole parlare.'));
});
