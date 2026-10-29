// #868 — il contesto della chat è la coda del filo: due turni di fila hanno lo stesso prefisso, i pezzi ripescati
// stanno nella domanda, i due tetti (giorni e token) tagliano la finestra e le letture vivono quanto il tratto (#1562).

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
  // E la richiesta intera: system e tratto vengono prima della domanda, che è l'unica cosa nuova.
  const r1 = FC.richiesta({ sistema: 'S', tratto: t1.messaggi, domanda: { role: 'user', content: 'e domani?' } });
  const r2 = FC.richiesta({ sistema: 'S', tratto: t2.messaggi, domanda: { role: 'user', content: 'e dopodomani?' } });
  assert.equal(prefissoComune(r1, r2), t1.messaggi.length + 1);
});

test('i pezzi ripescati stanno nella domanda, dopo gli eventi recenti, e i ricordi del tratto non tornano due volte', () => {
  const filo = filoDiProva();
  const f = FC.finestra(filo, { ora: ORA, ...TETTI });
  const vecchi = FC.tratti(f.vecchi);
  assert.equal(vecchi.length, 1, 'la conversazione di cinque giorni fa doveva restare fuori dal tratto');
  const ricordi = FC.rendiRicordi(FC.scegliRicordi([{ tratto: vecchi[0], score: 0.8 }]));
  const m = { chat: 'oggi-b', role: 'user', text: 'riprendi il discorso sulle orche', ts: fa(0.1), actions: [] };
  const domanda = FC.rendiMessaggio(m, null, { tetto: 100000, preambolo: ricordi });
  const msgs = FC.richiesta({ sistema: 'S', tratto: f.messaggi, domanda });
  const posRicordo = msgs.findIndex((x) => String(x.content).includes('Le orche sono delfini'));
  const ultimoRecente = msgs.findIndex((x) => String(x.content).includes('Sole.'));
  assert.ok(posRicordo > ultimoRecente, 'il ricordo sta prima degli eventi recenti');
  assert.equal(posRicordo, msgs.length - 1, 'il ricordo non sta nella domanda');
  assert.match(msgs[posRicordo].content, /RICORDI DAL FILO/);
  assert.match(msgs[posRicordo].content, /«|CONVERSAZIONE/, 'il ricordo viene dall\'archivio: va nella busta');
  assert.ok(msgs[posRicordo].content.indexOf('RICORDI DAL FILO') < msgs[posRicordo].content.indexOf('riprendi il discorso'), 'il ricordo sta prima delle parole dell\'utente');
  // Nel turno dopo il ricordo è ancora nella sua domanda: la risposta non lo ripete fra i suoi esiti.
  const esito = { azioni: [FC.ricordoComeAzione(FC.scegliRicordi([{ tratto: vecchi[0], score: 0.8 }]))] };
  const risposta = FC.rendiMessaggio({ chat: 'oggi-b', role: 'filo', text: 'Ne parlavamo lunedì.', ts: fa(0.09), actions: [] }, m, { tetto: 100000, esito, osserva: () => 'ESITO' });
  assert.doesNotMatch(risposta.content, /ESITO/);
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

test('le letture restano nel tratto finché c\'è il loro messaggio: un turno passato non si riscrive (#1562)', () => {
  const filo = [];
  for (let i = 0; i < 15; i++) filo.push(...scambio('c', 15 - i * 0.5, `domanda ${i}`, `risposta ${i}`));
  const conLettura = (m) => (m.text === 'risposta 0' || m.text === 'risposta 14' ? { azioni: [{ type: 'LEGGI_DOCUMENTO', _output: { text: `CONTENUTO ${m.text}` } }] } : null);
  const osserva = (azioni) => azioni.map((a) => `[letto] ${a._output.text}`).join('\n');
  const f = FC.finestra(filo, { ora: ORA, ...TETTI, esiti: conLettura, osserva });
  const testo = f.messaggi.map((m) => m.content).join('\n');
  assert.match(testo, /CONTENUTO risposta 14/);
  assert.match(testo, /CONTENUTO risposta 0/, 'la lettura di trenta messaggi fa è uscita: il messaggio è cambiato sotto la cache');
  assert.deepEqual(f.azioni.map((a) => a._output.text), ['CONTENUTO risposta 0', 'CONTENUTO risposta 14'], 'le azioni viste devono essere quelle il cui esito arriva al modello');
});

test('il testo che la chat scrive da fuori (l\'esito di un comando dato in chat) è una lettura: mai nudo, resta col tratto, conta per le uscite', () => {
  const filo = [
    { chat: 'term', role: 'user', text: '/cat note.txt', ts: fa(15), actions: [] },
    { chat: 'term', role: 'filo', text: 'CODICE-DA-FUORI', ts: fa(14.9), actions: [], esterno: FC.ESTERNO_COMANDO },
    { chat: 'term', role: 'filo', text: 'FILE-SCARICATO.pdf', ts: fa(14.8), actions: [], esterno: 'dal nome di un file scaricato' },
  ];
  const osserva = (azioni) => azioni.map((a) => `[${a.type} ${a.command || ''}] ${a._output.stdout || a._output.text}`).join('\n');
  const vicino = FC.finestra(filo, { ora: ORA, ...TETTI, osserva });
  const t1 = vicino.messaggi.map((m) => m.content).join('\n');
  assert.match(t1, /\[ESEGUI_COMANDO cat note\.txt\] CODICE-DA-FUORI/);
  assert.match(t1, /\[TESTO_DI_FUORI \] FILE-SCARICATO\.pdf/);
  assert.deepEqual(vicino.azioni.map((a) => a.type), ['ESEGUI_COMANDO', 'TESTO_DI_FUORI']);
  for (let i = 0; i < 11; i++) filo.push(...scambio('altra', 14 - i * 0.5, `domanda ${i}`, `risposta ${i}`));
  const lontano = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'altra', osserva });
  const t2 = lontano.messaggi.map((m) => m.content).join('\n');
  assert.match(t2, /\[ESEGUI_COMANDO cat note\.txt\] CODICE-DA-FUORI/, 'il testo di fuori, sempre imbustato, resta col tratto');
  assert.deepEqual(lontano.azioni.map((a) => a.type), ['ESEGUI_COMANDO', 'TESTO_DI_FUORI']);
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
  assert.deepEqual(FC.tetti(null, null), { giorni: 3, token: 100000, cache: '1h', da: { giorni: 'codice', token: 'codice', cache: 'codice' } });
  assert.equal(FC.tetti({}, { cache: '5m' }).cache, '5m');
  assert.equal(FC.tetti({ cache: '1h' }, { cache: '5m' }).cache, '1h');
  assert.equal(FC.tetti({ cache: '3 giorni' }, { cache: 'mai' }).cache, '1h');
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

test('in un\'altra scheda una lettura e il ragionamento restano col tratto: il messaggio passato non cambia (#1562)', () => {
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
  const tardi = conScambi(11);
  for (const f of [presto, tardi]) {
    assert.match(f.messaggi.map((m) => m.content).join('\n'), /canone 742 euro/);
    assert.ok(f.messaggi.some((m) => m.reasoning_details));
  }
  assert.equal(prefissoComune(presto.messaggi, tardi.messaggi), presto.messaggi.length, 'due turni dopo il messaggio con la lettura è cambiato');
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

test('il testo di fuori resta una lettura anche quando torna dall\'archivio: ricordo, ricerca, rilettura (#868, giro 7)', () => {
  require(join(ROOT, 'src', 'shared', 'urlExfil.js'));
  require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
  const X = globalThis.SN_URL_EXFIL;
  const L = globalThis.SN_ACTION_LEVELS;
  const lungo = Array.from({ length: 80 }, (_, i) => `riga ${i} di appunti qualunque`).join('\n');
  const vecchi = [
    { chat: 'v', role: 'user', text: '/cat note.txt', ts: fa(24 * 6), actions: [] },
    { chat: 'v', role: 'filo', text: `${lungo}\nCODICE-IN-FONDO`, ts: fa(24 * 6 - 0.1), actions: [], esterno: FC.ESTERNO_COMANDO },
  ];
  const [t] = FC.tratti(vecchi);
  assert.equal(t.daFuori.length, 1, 'il tratto non sa che il suo esito viene da fuori');
  assert.match(FC.testoRicordo(t), /CODICE-IN-FONDO/, 'il modello vede la coda del ricordo');
  // Qualunque azione che riporti quel testo lo dichiara in `daFuori`: sporca il compito e conta per le uscite.
  const ricordo = { type: 'CERCA_CHAT', _output: { automatica: true, results: [], daFuori: t.daFuori } };
  const ctx = X.contestoDaAzioni([ricordo]);
  assert.equal(ctx.nonFidato, true);
  assert.match(ctx.letto, /CODICE-IN-FONDO/);
  assert.deepEqual(ctx.esterni.map((e) => e.fonte), [FC.ESTERNO_COMANDO]);
  assert.equal(L.fonteDi(ricordo).classe, 4, 'un esito di comando riletto dall\'archivio non sporca il compito');
  assert.equal(L.fonteDi({ type: 'CERCA_CHAT', _output: { automatica: true, results: [] } }), null, 'una conversazione dell\'utente non sporca il compito');
  // Il nome di un file scaricato, nella finestra come dall'archivio: lo sceglie un sito.
  const nome = FC.letturaDaFuori({ chat: 'v', role: 'filo', text: 'fattura.pdf', esterno: 'dal nome di un file scaricato' });
  assert.equal(L.fonteDi(nome).classe, 5);
  assert.match(X.contestoDaAzioni([nome]).letto, /fattura\.pdf/);
  assert.deepEqual(FC.daFuoriDi([{ role: 'user', text: 'x', esterno: 'finto' }, { role: 'filo', text: 'y' }]), [], 'solo le righe di Filo segnate da fuori');
});

test('senza vettori il ricordo per parole vuole due parole rare nello stesso scambio: un «ok grazie» non ripesca niente', () => {
  require(join(ROOT, 'src', 'shared', 'chatArchive.js'));
  const vecchi = [
    ...scambio('mutuo', 24 * 8, 'quanto pago di rata del mutuo?', 'La rata è di 640 euro al mese.'),
    ...scambio('mutuo', 24 * 8 - 0.1, 'grazie', 'Figurati!'),
    ...scambio('medico', 24 * 9, 'ho la visita dal dermatologo martedì, grazie per avermelo ricordato', 'Di niente.'),
    ...scambio('lisbona', 24 * 10, 'segnati il ristorante di Lisbona: Taberna da Rua', 'Fatto.'),
    ...scambio('lisbona', 24 * 10 - 0.1, 'a Lisbona prendo il tram 28?', 'Sì, parte da Martim Moniz.'),
  ];
  const tratti = FC.tratti(vecchi);
  for (const q of ['ok grazie', 'grazie mille', 'perfetto', 'ciao', 'va bene grazie']) {
    assert.deepEqual(FC.ricordiPerParole(q, tratti), [], q);
  }
  const presi = FC.ricordiPerParole('il ristorante di Lisbona', tratti);
  assert.equal(presi.length, 1);
  assert.equal(presi[0].tratto.chat, 'lisbona');
  // «Lisbona» torna in tutta la sua conversazione e distingue lo stesso; «grazie», in tante conversazioni, no.
  assert.equal(FC.ricordiPerParole('grazie per il ristorante di Lisbona', tratti)[0].tratto.chat, 'lisbona');
});

test('senza vettori il ricordo per parole ripesca davanti a una domanda scritta normalmente: punteggiatura e parole assenti (#868.8)', () => {
  require(join(ROOT, 'src', 'shared', 'chatArchive.js'));
  const vecchi = [
    ...scambio('lisbona', 24 * 10, 'consigliami un ristorante di pesce a Lisbona', 'La Taberna da Rua das Flores.'),
    ...scambio('mutuo', 24 * 8, 'quanto pago di rata del mutuo?', 'La rata è di 640 euro al mese.'),
    ...scambio('medico', 24 * 9, 'ho la visita dal dermatologo martedì', 'Te lo ricordo.'),
  ];
  const tratti = FC.tratti(vecchi);
  for (const q of ['il ristorante di Lisbona?', 'il ristorante di «Lisbona»!', 'Lisbona, il ristorante...', 'come si chiamava il ristorante di Lisbona?']) {
    const presi = FC.ricordiPerParole(q, tratti);
    assert.equal(presi.length, 1, q);
    assert.equal(presi[0].tratto.chat, 'lisbona', q);
  }
  // Le parole che non compaiono da nessuna parte non si pretendono, ma una sola parola rara resta troppo poco.
  assert.deepEqual(FC.ricordiPerParole('come si chiamava quel tizio di Lisbona?', tratti), []);
  assert.deepEqual(FC.ricordiPerParole('zanzibar? kilimangiaro!', tratti), []);
  // Una parola rara che sta solo in un'altra conversazione non blocca lo scambio giusto: vince chi ne ha di più.
  const conFilm = FC.tratti([
    ...scambio('film', 24 * 15, 'come si chiamava quel film con De Niro sul taxi?', 'Taxi Driver, del 1976.'),
    ...vecchi,
  ]);
  const presi = FC.ricordiPerParole('come si chiamava il ristorante di Lisbona?', conFilm);
  assert.deepEqual(presi.map((r) => r.tratto.chat), ['lisbona']);
  assert.deepEqual(FC.ricordiPerParole('come si chiamava il film di De Niro?', conFilm).map((r) => r.tratto.chat), ['film']);
});

test('una frase di cortesia detta una volta sola in una conversazione vecchia non la ripesca a ogni ripetizione', () => {
  require(join(ROOT, 'src', 'shared', 'chatArchive.js'));
  const vecchi = [
    ...scambio('mutuo', 24 * 8, 'quanto pago di rata del mutuo?', 'La rata è di 640 euro al mese.'),
    ...scambio('mutuo', 24 * 8 - 0.1, 'perfetto grazie mille', 'Figurati!'),
    ...scambio('tema', 24 * 9, 'metti il tema chiaro', 'Fatto, tema chiaro.'),
  ];
  for (let i = 0; i < 10; i++) vecchi.push(...scambio(`altro-${i}`, 24 * 5 + i, `domanda numero ${i}`, `risposta ${i}`));
  vecchi.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const tratti = FC.tratti(vecchi);
  for (const q of ['grazie mille', 'perfetto grazie', 'ok perfetto, grazie mille!', 'Perfetto! Grazie mille']) {
    assert.deepEqual(FC.ricordiPerParole(q, tratti), [], q);
  }
  // Una parola che può essere l'argomento resta: «tema chiaro» ritrova il suo scambio.
  assert.equal(FC.ricordiPerParole('il tema chiaro', tratti)[0].tratto.chat, 'tema');
  assert.equal(FC.ricordiPerParole('grazie, la rata del mutuo', tratti)[0].tratto.chat, 'mutuo');
});

test('il rifiuto per finestra del modello si riconosce, e il tratto si stringe quanto basta', () => {
  const or = { status: 400, message: 'OpenRouter 400: {"error":{"message":"This endpoint\'s maximum context length is 32768 tokens. However, you requested about 70000 tokens (69000 of text input, 1000 in the output). Please reduce the length of the messages or completion."}}' };
  assert.deepEqual(FC.troppoLungo(or), { max: 32768, chiesti: 70000 });
  assert.deepEqual(FC.troppoLungo({ status: 400, message: 'prompt is too long' }), { max: null, chiesti: null });
  assert.equal(FC.troppoLungo({ status: 400, message: 'Invalid tool schema' }), null);
  assert.equal(FC.troppoLungo({ status: 503, message: 'maximum context length is 32768 tokens' }), null);
  // Con le misure: la richiesta intera rientra sotto la finestra, e a stringersi è solo il tratto.
  const caratteri = 250000;
  const caratteriTratto = 230000;
  const t = FC.tettoDopoRifiuto({ max: 32768, chiesti: 70000, caratteri, caratteriTratto });
  const totale = (caratteri - caratteriTratto) + t * FC.CARATTERI_PER_TOKEN;
  assert.ok(totale <= caratteri * (32768 / 70000), `${totale}`);
  assert.ok(t > 0);
  // Senza misure il tratto si dimezza; senza tratto non c'è niente da stringere.
  assert.equal(FC.tettoDopoRifiuto({ caratteriTratto: 70000 }), Math.floor(35000 / FC.CARATTERI_PER_TOKEN));
  assert.equal(FC.tettoDopoRifiuto({ max: 1000, chiesti: 2000, caratteri: 100, caratteriTratto: 0 }), null);
});

test('una rilettura sta nella finestra nota del modello insieme al resto della richiesta, fin dal primo tentativo (#868.7)', () => {
  const finestra = 32768;
  const occupati = 6000;
  const risposta = 4096;
  const cap = FC.capRilettura({ tetto: 100000, finestra, occupati, risposta });
  // Richiesta intera (quello che c'era, la rilettura, il tetto della risposta) sotto la finestra.
  assert.ok(occupati + cap / FC.CARATTERI_PER_TOKEN + risposta <= finestra, `${cap}`);
  assert.ok(cap > 50000, 'con la finestra quasi vuota la rilettura la usa');
  // Senza finestra nota vale il tetto in token; con una finestra grande vince il tetto.
  assert.equal(FC.capRilettura({ tetto: 100000 }), 100000 * FC.CARATTERI_PER_TOKEN);
  assert.equal(FC.capRilettura({ tetto: 100000, finestra: 1000000, occupati, risposta }), 100000 * FC.CARATTERI_PER_TOKEN);
  // Una finestra già piena lascia il minimo: il resto si legge a pezzi.
  assert.equal(FC.capRilettura({ tetto: 100000, finestra, occupati: 30000, risposta }), FC.RILETTURA_MIN);
  // Dopo un rifiuto la rilettura si accorcia quanto dicono le misure, mai sotto il minimo; al minimo non si stringe più.
  const caratteri = 160000;
  const caratteriRiletture = 150000;
  const resta = FC.rilettureDopoRifiuto({ max: 32768, chiesti: 46000, caratteri, caratteriRiletture, n: 1 });
  assert.ok((caratteri - caratteriRiletture) + resta <= caratteri * (32768 / 46000), `${resta}`);
  assert.ok(resta >= FC.RILETTURA_MIN);
  assert.ok(Math.abs(FC.rilettureDopoRifiuto({ caratteriRiletture: 100000 }) - 50000) < 5, 'senza misure si dimezza');
  assert.equal(FC.rilettureDopoRifiuto({ caratteriRiletture: FC.RILETTURA_MIN }), null);
});

// #1166 — le immagini mandate in chat tornano col loro messaggio finché vive come una lettura; poi, o se non sono più
// in memoria, al loro posto c'è una nota che dice che c'erano.
const FOTO_A = 'data:image/png;base64,AAAA';
const FOTO_B = 'data:image/jpeg;base64,BBBB';
const immaginiDi = (mappa) => (m) => mappa[`${m.chat}|${m.ts}`] || null;
const conFoto = (msgs, n) => msgs.map((m, i) => (i === 0 ? { ...m, images: n } : m));
const fotoNel = (m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url) : []);

test('le foto del messaggio di prima tornano attaccate a lui, e dal turno dopo il prefisso non si muove', () => {
  const primo = conFoto(scambio('c', 1, 'cosa c\'è nella dispensa?', 'Vedo farina, uova e un barattolo di ceci.'), 2);
  const memoria = { [`c|${primo[0].ts}`]: [FOTO_A, FOTO_B] };
  const t1 = FC.finestra(primo, { ora: ORA, ...TETTI, chatCorrente: 'c', immagini: immaginiDi(memoria) });
  const domanda = t1.messaggi.find((m) => m.role === 'user');
  assert.deepEqual(fotoNel(domanda), [FOTO_A, FOTO_B]);
  assert.match(domanda.content[0].text, /cosa c'è nella dispensa\?/);
  assert.doesNotMatch(JSON.stringify(t1.messaggi), /non hai più davanti/);
  const dopo = [...primo, ...scambio('c', 0.5, 'e con i ceci cosa faccio?', 'Un hummus.')];
  const t2 = FC.finestra(dopo, { ora: ORA + 60000, ...TETTI, ancora: t1.ancora, chatCorrente: 'c', immagini: immaginiDi(memoria) });
  assert.equal(prefissoComune(t1.messaggi, t2.messaggi), t1.messaggi.length);
  // Le foto pesano per i tetti quanto costano, non per i caratteri del data URL.
  assert.equal(FC.tokenDi(domanda.content), FC.stimaToken(domanda.content[0].text) + 2 * FC.TOKEN_PER_IMMAGINE);
});

test('senza le foto in memoria resta la nota con quante erano; finché ci sono, tornano anche venti messaggi dopo', () => {
  const primo = conFoto(scambio('c', 12, 'leggi queste etichette', 'Farina 00, scade a marzo.'), 3);
  const senza = FC.finestra(primo, { ora: ORA, ...TETTI, chatCorrente: 'c', immagini: () => null });
  const u = senza.messaggi.find((m) => m.role === 'user');
  assert.equal(typeof u.content, 'string');
  assert.match(u.content, /leggi queste etichette\n\(qui l'utente aveva mandato 3 immagini che non hai più davanti: quello che ne hai scritto dopo l'avevi letto da lì/);
  const una = FC.finestra(conFoto(scambio('c', 12, 'e questa?', 'Una mela.'), 1), { ora: ORA, ...TETTI, chatCorrente: 'c' });
  assert.match(una.messaggi[0].content, /un'immagine che non hai più davanti/);
  // Ventidue messaggi dopo le foto in memoria tornano ancora: il messaggio passato non cambia (#1562).
  const memoria = { [`c|${primo[0].ts}`]: [FOTO_A] };
  const lungo = [...primo];
  for (let i = 0; i < 11; i++) lungo.push(...scambio('c', 11 - i * 0.5, `altro ${i}`, `ok ${i}`));
  const tardi = FC.finestra(lungo, { ora: ORA, ...TETTI, chatCorrente: 'c', immagini: immaginiDi(memoria) });
  assert.match(JSON.stringify(tardi.messaggi[0]), /data:image/);
});

test('oltre il tetto delle foto rimandate tornano le più nuove, le più vecchie lasciano la nota', () => {
  const filo = [];
  const memoria = {};
  for (let i = 0; i < 6; i++) {
    const s = conFoto(scambio('c', 6 - i * 0.5, `foto ${i}`, `vista ${i}`), 4);
    memoria[`c|${s[0].ts}`] = [1, 2, 3, 4].map((k) => `data:image/png;base64,${i}${k}`);
    filo.push(...s);
  }
  const f = FC.finestra(filo, { ora: ORA, ...TETTI, chatCorrente: 'c', immagini: immaginiDi(memoria) });
  const tornate = f.messaggi.reduce((n, m) => n + fotoNel(m).length, 0);
  // Oltre il tetto il taglio scende di un quarto, come per i token (#1562).
  assert.equal(tornate, FC.MAX_IMMAGINI_RIMANDATE * 0.75);
  assert.match(f.messaggi[0].content, /^\[.*\] foto 0\n\(qui l'utente aveva mandato 4 immagini/);
  assert.equal(fotoNel(f.messaggi[f.messaggi.length - 2]).length, 4, 'le foto dell\'ultimo messaggio devono tornare');
  // Il conto dei caratteri per il rifiuto di finestra pesa la foto come i suoi token.
  assert.equal(FC.caratteriDi([{ role: 'user', content: [{ type: 'text', text: 'abc' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'x'.repeat(100000) } }] }]),
    3 + FC.TOKEN_PER_IMMAGINE * FC.CARATTERI_PER_TOKEN);
});

test('oltre il tetto delle foto il taglio va a scatti: una foto nuova non riscrive il tratto a ogni messaggio (#1562)', () => {
  const filo = [];
  const memoria = {};
  let ancora = null;
  let prima = null;
  const rotture = [];
  for (let i = 0; i < 30; i++) {
    const s = conFoto(scambio('c', 30 - i * 0.5, `foto ${i}`, `vista ${i}`), 1);
    memoria[`c|${s[0].ts}`] = [`data:image/png;base64,${i}`];
    filo.push(...s);
    const f = FC.finestra(filo, { ora: ORA, ...TETTI, ancora, chatCorrente: 'c', immagini: immaginiDi(memoria) });
    const tornate = f.messaggi.reduce((n, m) => n + fotoNel(m).length, 0);
    assert.ok(tornate <= FC.MAX_IMMAGINI_RIMANDATE, `al turno ${i} tornano ${tornate} foto`);
    assert.equal(fotoNel(f.messaggi[f.messaggi.length - 2]).length, 1, 'la foto dell\'ultimo messaggio deve tornare');
    if (prima && prefissoComune(prima, f.messaggi) < prima.length) rotture.push(i);
    prima = f.messaggi;
    ancora = f.ancora;
  }
  // Trenta foto, una per messaggio: il tetto si passa due volte, e solo lì il tratto cambia.
  assert.deepEqual(rotture, [16, 21, 26].slice(0, rotture.length));
  assert.ok(rotture.length <= 3, `il tratto si riscrive ai turni ${rotture.join(', ')}`);
});

test('un messaggio con più foto di quante ne stiano nei tetti tiene le prime che ci stanno, e la nota dice le altre', () => {
  const pesante = (k) => `data:image/jpeg;base64,${String(k).repeat(5_400_000)}`;
  const tante = conFoto(scambio('c', 1, 'ecco la dispensa', 'Cinque scaffali.'), 5);
  const memoria = { [`c|${tante[0].ts}`]: [0, 1, 2, 3, 4].map(pesante) };
  const f = FC.finestra(tante, { ora: ORA, ...TETTI, chatCorrente: 'c', immagini: immaginiDi(memoria) });
  const u = f.messaggi.find((m) => m.role === 'user');
  assert.equal(Math.floor(FC.MAX_CARATTERI_IMMAGINI / pesante(0).length), 4);
  assert.deepEqual(fotoNel(u), [0, 1, 2, 3].map(pesante));
  assert.match(u.content[u.content.length - 1].text, /anche un'altra immagine che non hai più davanti/);
  assert.match(FC.notaImmagini(3, { altre: true }), /anche altre 3 immagini che non hai più davanti/);
  // Più di sedici foto in un messaggio: tornano le prime sedici, una la dice la nota.
  const diciassette = conFoto(scambio('c', 1, 'tutte', 'Viste.'), 17);
  const mem17 = { [`c|${diciassette[0].ts}`]: Array.from({ length: 17 }, (_, k) => `data:image/png;base64,${k}`) };
  const g = FC.finestra(diciassette, { ora: ORA, ...TETTI, chatCorrente: 'c', immagini: immaginiDi(mem17) });
  const v = g.messaggi.find((m) => m.role === 'user');
  assert.equal(fotoNel(v).length, FC.MAX_IMMAGINI_RIMANDATE);
  assert.match(v.content[v.content.length - 1].text, /anche un'altra immagine che non hai più davanti/);
});

test('il rifiuto delle immagini si riconosce; quello per la finestra o per i crediti no', () => {
  assert.equal(FC.rifiutaImmagini({ status: 404, message: 'OpenRouter 404: {"error":{"message":"No endpoints found that support image input","code":404}}' }), true);
  assert.equal(FC.rifiutaImmagini({ status: 400, message: 'Failed to deserialize the JSON body: messages[1]: unknown variant `image_url`, expected `text`' }), true);
  assert.equal(FC.rifiutaImmagini({ status: 400, message: 'At most 1 image(s) may be provided in one request.' }), true);
  assert.equal(FC.rifiutaImmagini({ status: 413, message: 'Request Entity Too Large' }), true);
  assert.equal(FC.rifiutaImmagini({ status: 400, message: 'This endpoint\'s maximum context length is 32768 tokens.' }), false);
  assert.equal(FC.rifiutaImmagini({ status: 402, message: 'Insufficient credits for image input' }), false);
  assert.equal(FC.rifiutaImmagini({ status: 404, message: 'No endpoints found for moonshotai/kimi' }), false);
});
