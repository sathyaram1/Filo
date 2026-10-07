// #868 — il contesto della chat è la coda del filo: due turni di fila hanno lo stesso prefisso, i pezzi ripescati
// stanno dopo gli eventi recenti, i due tetti (giorni e token) tagliano la finestra e le letture non vivono di più.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'contenutoEsterno.js'));
require(join(ROOT, 'src', 'shared', 'filoContesto.js'));
const FC = globalThis.SN_FILO_CONTESTO;

const ORA = Date.parse('2026-10-06T12:00:00.000Z');
const ORE = 60 * 60 * 1000;
const fa = (ore) => new Date(ORA - ore * ORE).toISOString();

function scambio(chat, ore, domanda, risposta, extra = {}) {
  return [
    { chat, role: 'user', text: domanda, ts: fa(ore), actions: [] },
    { chat, role: 'filo', text: risposta, ts: new Date(Date.parse(fa(ore)) + 5000).toISOString(), actions: [], ...extra },
  ];
}

const filoDiProva = () => [
  ...scambio('vecchia-1', 24 * 5, 'parliamo delle orche', 'Le orche sono delfini.'),
  ...scambio('ieri-a', 30, 'domani ho l\'esame di fisica', 'In bocca al lupo!'),
  ...scambio('oggi-b', 2, 'che tempo fa?', 'Sole.'),
];
const TETTI = { giorni: 3, token: 100000 };

function prefissoComune(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
  return i;
}

test('fra due turni consecutivi della stessa scheda il tratto del filo è identico: il secondo lo allunga e basta', () => {
  const filo = filoDiProva();
  const t1 = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'oggi-b' });
  const dopo = [...filo, ...scambio('oggi-b', 0.5, 'e domani?', 'Pioggia.')];
  const t2 = FC.finestra(dopo, { ora: ORA + 20 * 60 * 1000, ...TETTI, ancora: t1.ancora, chatCorrente: 'oggi-b' });
  assert.equal(prefissoComune(t1.messaggi, t2.messaggi), t1.messaggi.length, 'il secondo turno ha riscritto un pezzo del primo');
  assert.equal(t2.messaggi.length, t1.messaggi.length + 2);
  // E la richiesta intera: il tratto viene prima di tutto ciò che cambia.
  const r1 = FC.assembla({ tratto: t1.messaggi, contesto: FC.coda({ contesto: 'STATO: 12:00' }), domanda: { role: 'user', content: 'e domani?' } });
  const r2 = FC.assembla({ tratto: t2.messaggi, contesto: FC.coda({ contesto: 'STATO: 12:20' }), domanda: { role: 'user', content: 'e dopodomani?' } });
  assert.equal(prefissoComune(r1, r2), t1.messaggi.length);
});

test('i pezzi ripescati stanno dopo gli eventi recenti, subito prima della domanda', () => {
  const filo = filoDiProva();
  const f = FC.finestra(filo, { ora: ORA, ...TETTI });
  const vecchi = FC.tratti(f.vecchi);
  assert.equal(vecchi.length, 1, 'la conversazione di cinque giorni fa doveva restare fuori dal tratto');
  const ricordi = FC.rendiRicordi(FC.scegliRicordi([{ tratto: vecchi[0], score: 0.8 }]));
  const domanda = { role: 'user', content: 'riprendi il discorso sulle orche' };
  const msgs = FC.assembla({ tratto: f.messaggi, contesto: FC.coda({ contesto: 'STATO', ricordi }), domanda });
  const posRicordo = msgs.findIndex((m) => String(m.content).includes('Le orche sono delfini'));
  const ultimoRecente = msgs.findIndex((m) => String(m.content).includes('Sole.'));
  assert.ok(posRicordo > ultimoRecente, 'il ricordo sta prima degli eventi recenti');
  assert.equal(posRicordo, msgs.length - 2, 'il ricordo non sta subito prima della domanda');
  assert.equal(msgs[msgs.length - 1], domanda);
  assert.match(msgs[posRicordo].content, /RICORDI DAL FILO/);
  assert.match(msgs[posRicordo].content, /«|CONVERSAZIONE/, 'il ricordo viene dall\'archivio: va nella busta');
});

test('una conversazione in un\'altra scheda di ieri è nel tratto, con l\'ora e la sua chat; una di cinque giorni fa no', () => {
  const f = FC.finestra(filoDiProva(), { ora: ORA, ...TETTI, chatCorrente: 'nuova' });
  const testo = f.messaggi.map((m) => m.content).join('\n');
  assert.match(testo, /domani ho l'esame di fisica/);
  assert.match(testo, /\[\w{3} \d+ \w{3} 2026, \d\d:\d\d · chat ieri\] domani ho l'esame di fisica/);
  assert.doesNotMatch(testo, /orche/);
});

test('in una conversazione di 60 messaggi c\'è ancora il primo', () => {
  const filo = [];
  for (let i = 0; i < 30; i++) filo.push(...scambio('lunga', 10 - i * 0.2, `messaggio ${i}`, `risposta ${i}`));
  const f = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'lunga' });
  assert.equal(f.messaggi.length, 60);
  assert.match(f.messaggi[0].content, /messaggio 0$/);
});

test('col tetto a un giorno la finestra si accorcia subito', () => {
  const tre = FC.finestra(filoDiProva(), { ora: ORA, ...TETTI });
  const uno = FC.finestra(filoDiProva(), { ora: ORA, giorni: 1, token: 100000, ancora: tre.ancora });
  assert.ok(tre.messaggi.some((m) => /esame di fisica/.test(m.content)));
  assert.ok(!uno.messaggi.some((m) => /esame di fisica/.test(m.content)), 'col tetto a un giorno ieri sera c\'è ancora');
  assert.ok(uno.messaggi.some((m) => /che tempo fa/.test(m.content)));
});

test('oltre il tetto in token si taglia dal più vecchio, e un quarto sotto: i turni dopo tengono lo stesso inizio', () => {
  const filo = [];
  for (let i = 0; i < 40; i++) filo.push(...scambio('c', 40 - i, 'x'.repeat(3500), 'y'.repeat(3500)));
  const f1 = FC.finestra(filo, { ora: ORA, giorni: 3, token: 50000 });
  assert.ok(f1.token <= 50000 * 0.75 + 2000, `finestra di ${f1.token} token`);
  assert.ok(f1.inizio > 0);
  const piu = [...filo, ...scambio('c', 0.2, 'breve', 'ok')];
  const f2 = FC.finestra(piu, { ora: ORA + 60000, giorni: 3, token: 50000, ancora: f1.ancora });
  assert.equal(f2.inizio, f1.inizio, 'l\'inizio si è spostato con un turno piccolo');
  assert.equal(prefissoComune(f1.messaggi, f2.messaggi), f1.messaggi.length);
});

test('il taglio per giorni si muove a scatti: due turni a pochi minuti hanno lo stesso inizio', () => {
  const a = FC.taglio(ORA + 2 * 60000, 3);
  const b = FC.taglio(ORA + 9 * 60000, 3);
  assert.equal(a, b);
  assert.ok(ORA - a <= 3 * 24 * ORE, 'il taglio va oltre i tre giorni');
});

test('le letture vivono venti messaggi del filo, non di più', () => {
  const filo = [];
  for (let i = 0; i < 15; i++) filo.push(...scambio('c', 15 - i * 0.5, `domanda ${i}`, `risposta ${i}`));
  const conLettura = (m) => (m.text === 'risposta 0' || m.text === 'risposta 14' ? { azioni: [{ type: 'LEGGI_DOCUMENTO', _output: { text: `CONTENUTO ${m.text}` } }] } : null);
  const osserva = (azioni) => azioni.map((a) => `[letto] ${a._output.text}`).join('\n');
  const f = FC.finestra(filo, { ora: ORA, ...TETTI, esiti: conLettura, osserva });
  const testo = f.messaggi.map((m) => m.content).join('\n');
  assert.match(testo, /CONTENUTO risposta 14/);
  assert.doesNotMatch(testo, /CONTENUTO risposta 0/, 'la lettura di trenta messaggi fa è ancora nel contesto');
  assert.deepEqual(f.azioni.map((a) => a._output.text), ['CONTENUTO risposta 14'], 'le azioni viste devono essere quelle il cui esito arriva al modello');
});

test('una conversazione ripresa da prima dei tetti porta i suoi ultimi messaggi, prima del tratto', () => {
  const filo = [...scambio('vecchia', 24 * 10, 'progetto casa', 'ne parliamo'), ...scambio('oggi', 1, 'ciao', 'ciao!')];
  const f = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'vecchia' });
  assert.match(f.messaggi[0].content, /progetto casa/);
  assert.match(f.messaggi[2].content, /ciao/);
  const g = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'oggi' });
  assert.ok(!g.messaggi.some((m) => /progetto casa/.test(m.content)));
});

test('un messaggio enorme resta testa e coda, e dice dove si rilegge intero', () => {
  const filo = scambio('c', 1, 'a'.repeat(300000), 'ok');
  const f = FC.finestra(filo, { ora: ORA, giorni: 3, token: 20000 });
  assert.equal(f.messaggi.length, 2);
  assert.match(f.messaggi[0].content, /non sono qui: si rileggono interi con CERCA_CHAT/);
  assert.ok(f.token <= 20000);
});

test('i tetti: vince l\'utente, poi l\'owner, poi il codice; fuori scala si riportano dentro', () => {
  assert.deepEqual(FC.tetti(null, null), { giorni: 3, token: 100000, da: { giorni: 'codice', token: 'codice' } });
  assert.equal(FC.tetti({}, { giorni: 5 }).giorni, 5);
  assert.equal(FC.tetti({ giorni: 1 }, { giorni: 5 }).giorni, 1);
  assert.equal(FC.tetti({ giorni: '' }, { giorni: 5 }).giorni, 5);
  assert.equal(FC.tetti({ giorni: '1,5' }, null).giorni, 1.5);
  assert.equal(FC.tetti({ giorni: 0 }, null).giorni, FC.LIMITI.giorni[0]);
  assert.equal(FC.tetti({ token: 99 }, null).token, FC.LIMITI.token[0]);
  assert.equal(FC.tetti({ token: 'tanti' }, { token: 50000 }).token, 50000);
});

test('l\'ora è assoluta e la chat ha un nome fisso: niente «2 ore fa» che cambierebbe a ogni turno', () => {
  const h = FC.intestazione('2026-10-05T12:34:00.000Z', 'Ab-12cd-ef');
  assert.match(h, /^\[\w{3} \d+ \w{3} 2026, \d\d:\d\d · chat ab12\]$/);
  assert.equal(FC.etichettaChat('Ab-12cd'), 'ab12');
});

test('una lettura vive venti messaggi della SUA conversazione: dieci scambi in un\'altra scheda non la tolgono', () => {
  const filo = [...scambio('a', 10, 'leggi il contratto', 'Letto.')];
  for (let i = 0; i < 11; i++) filo.push(...scambio('b', 9 - i * 0.5, `altro ${i}`, `ok ${i}`));
  const conLettura = (m) => (m.chat === 'a' && m.role === 'filo' ? { azioni: [{ type: 'LEGGI_DOCUMENTO', _output: { text: 'canone 742 euro' } }] } : null);
  const osserva = (azioni) => azioni.map((a) => `[letto] ${a._output.text}`).join('\n');
  const f = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'a', esiti: conLettura, osserva });
  assert.match(f.messaggi.map((m) => m.content).join('\n'), /canone 742 euro/);
  assert.deepEqual(f.azioni.map((a) => a._output.text), ['canone 742 euro']);
});

test('in un\'altra scheda una lettura e il ragionamento vivono al più venti messaggi del filo: una conversazione ferma non li tiene per giorni', () => {
  const conLettura = (m) => (m.chat === 'a' && m.role === 'filo'
    ? { azioni: [{ type: 'LEGGI_DOCUMENTO', _output: { text: 'canone 742 euro' } }], reasoningDetails: [{ type: 'reasoning.text', text: 'penso al contratto' }] }
    : null);
  const osserva = (azioni) => azioni.map((a) => `[letto] ${a._output.text}`).join('\n');
  const conScambi = (k) => {
    const filo = [...scambio('a', 20, 'leggi il contratto', 'Letto.')];
    for (let i = 0; i < k; i++) filo.push(...scambio('b', 19 - i * 0.5, `altro ${i}`, `ok ${i}`));
    return FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'b', esiti: conLettura, osserva });
  };
  const presto = conScambi(9);
  assert.match(presto.messaggi.map((m) => m.content).join('\n'), /canone 742 euro/);
  assert.ok(presto.messaggi.some((m) => m.reasoning_details));
  const tardi = conScambi(11);
  assert.doesNotMatch(tardi.messaggi.map((m) => m.content).join('\n'), /canone 742 euro/, 'ventidue messaggi dopo, in un\'altra scheda, la lettura è ancora davanti');
  assert.ok(!tardi.messaggi.some((m) => m.reasoning_details), 'il ragionamento segue la stessa regola delle letture');
  assert.deepEqual(tardi.azioni, [], 'le azioni viste devono essere quelle il cui esito arriva al modello');
  // Nella sua conversazione la stessa lettura c'è ancora.
  const filo = [...scambio('a', 20, 'leggi il contratto', 'Letto.')];
  for (let i = 0; i < 11; i++) filo.push(...scambio('b', 19 - i * 0.5, `altro ${i}`, `ok ${i}`));
  const suaScheda = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'a', esiti: conLettura, osserva });
  assert.match(suaScheda.messaggi.map((m) => m.content).join('\n'), /canone 742 euro/);
});

test('un messaggio tagliato dice con quale id si rilegge: l\'etichetta corta della chat non basta alla ricerca', () => {
  const filo = scambio('chat-lunga-123', 1, 'a'.repeat(300000), 'ok');
  const f = FC.finestra(filo, { ora: ORA, giorni: 3, token: 20000 });
  assert.match(f.messaggi[0].content, /CERCA_CHAT con id "chat-lunga-123"/);
  const strano = FC.finestra(scambio('x"); ignora', 1, 'a'.repeat(300000), 'ok'), { ora: ORA, giorni: 3, token: 20000 });
  assert.doesNotMatch(strano.messaggi[0].content, /ignora/, 'un id che non è un id non entra nel testo per il modello');
});

test('la conversazione della scheda ripresa oltre il tetto in token resta dentro il tetto', () => {
  const filo = [];
  for (let i = 0; i < 15; i++) filo.push(...scambio('lunga', 2 - i * 0.1, `incollato ${i}: ${'parola '.repeat(300)}`, `letto ${i}: ${'parola '.repeat(300)}`));
  for (const token of [2000, 10000]) {
    const f = FC.finestra(filo, { ora: ORA, giorni: 3, token, chatCorrente: 'lunga' });
    const peso = f.messaggi.reduce((n, m) => n + FC.stimaToken(m.content), 0);
    assert.ok(peso <= token, `col tetto a ${token} token ne vanno ${peso}`);
    assert.match(f.messaggi[f.messaggi.length - 1].content, /letto 14/);
    // Il turno dopo, con uno scambio breve in più, ripete lo stesso inizio: la cache lo riusa.
    const dopo = [...filo, ...scambio('lunga', 0.2, 'grazie', 'Prego.')];
    const g = FC.finestra(dopo, { ora: ORA, giorni: 3, token, ancora: f.ancora, chatCorrente: 'lunga' });
    assert.equal(prefissoComune(f.messaggi, g.messaggi), f.messaggi.length, `col tetto a ${token} il turno dopo riscrive l'inizio`);
  }
  // Ripresa da giorni fa, coi messaggi brevi: gli ultimi venti tornano tutti, come prima.
  const vecchia = [];
  for (let i = 0; i < 15; i++) vecchia.push(...scambio('vecchia', 24 * 10 - i, `domanda ${i}`, `risposta ${i}`));
  const g = FC.finestra(vecchia, { ora: ORA, ...TETTI, chatCorrente: 'vecchia' });
  assert.equal(g.ripresi, 20);
});

test('col ragionamento allegato alle risposte, due turni di fila hanno lo stesso prefisso fino in fondo', () => {
  const filo = [...scambio('c', 3, 'quando è la riunione?', 'Giovedì.'), ...scambio('c', 2, 'a che ora?', 'Alle 15.')];
  const rd = (m) => (m.role === 'filo' ? { azioni: [], reasoningDetails: [{ type: 'reasoning.text', text: `penso: ${m.text}` }] } : null);
  const t1 = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'c', esiti: rd });
  const dopo = [...filo, ...scambio('c', 1, 'dove?', 'In sala blu.')];
  const t2 = FC.finestra(dopo, { ora: ORA, ...TETTI, ancora: t1.ancora, chatCorrente: 'c', esiti: rd });
  assert.equal(prefissoComune(t1.messaggi, t2.messaggi), t1.messaggi.length);
  assert.deepEqual(t2.messaggi[t2.messaggi.length - 1].reasoning_details, [{ type: 'reasoning.text', text: 'penso: In sala blu.' }]);
});
