// I contatori anonimi (#969, #1461), la parte pura: esce solo quello che sta negli elenchi chiusi, ogni misura nella sua
// forma, e lo pseudonimo è del mese, nuovo a ogni mese e mai uguale al codice dei feedback o allo pseudonimo dei crediti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const U = globalThis.SN_MODEL_USAGE;
const A = globalThis.SN_CONST.ACTIONS;

const PSEUDO = '0123456789abcdef0123';
const docDi = (dati, chiave = '2026-10-15T09') => C.documento({ pseudonimo: PSEUDO, chiave, app: '0.2.243', os: 'win', dati });

test('le funzioni contate sono quelle dell’app che usano un modello; le azioni sono il manifesto delle capacità più l’avvio', () => {
  const attese = U.ENTRIES.filter((e) => (e.from === 'user' && e.ref) || (e.from === 'owner' && e.action)).map((e) => e.id);
  assert.deepEqual(C.funzioni(), attese);
  assert.ok(!C.funzioni().includes('judge1'), 'i giudici girano sul server: non li conta l’app');
  assert.equal(C.funzioneDi(A.FILO_CHAT), 'filo-chat');
  assert.equal(C.funzioneDi(A.MANAGE_SEARCH), 'manage-search', 'le funzioni dell’owner si riconoscono dall’azione, non dallo slot');
  assert.equal(C.funzioneDi('un testo qualsiasi'), '');
  assert.deepEqual(C.azioni(), [...globalThis.SN_CAPABILITIES.CAPABILITIES.map((c) => c.id), 'avvio']);
  const icone = Object.keys(globalThis.SN_DISPOSIZIONE_ICONE ? globalThis.SN_DISPOSIZIONE_ICONE.ICONE : {});
  for (const [icona, azione] of Object.entries(C.AZIONE_DI_ICONA)) {
    assert.ok(C.azioni().includes(azione), `l’icona ${icona} vale un’azione che non è nel manifesto: ${azione}`);
  }
  if (icone.length) assert.deepEqual(icone.filter((i) => !C.AZIONE_DI_ICONA[i]), [], 'ogni icona ha la sua azione');
});

test('un campo di testo libero non passa: funzioni, azioni, modelli, impostazioni e scelte vengono da elenchi chiusi', () => {
  const g = C.oraVuota();
  assert.equal(C.registraUso(g, 'Mario Rossi, via Roma 1', { visto: 300 }), false);
  assert.equal(C.registraAzione(g, 'apri il file relazione.docx', { fine: 10 }), false);
  assert.equal(C.registraErrore(g, 'explain', { modello: 'x', host: 'y', tipo: 'il mio errore preferito' }), false);
  assert.equal(C.registraErrore(g, 'filo-chat', { modello: 'Scrivi a mario.rossi@gmail.com', host: 'Mario <mario@x.it>', tipo: 'rete' }), true);
  assert.equal(C.registraUso(g, 'filo-chat', { visto: 1200, fine: 4000 }), true);
  assert.equal(C.registraImpostazione(g, 'themeTokens.Il mio colore', '#ff0000', 'mano'), true);
  assert.equal(C.registraImpostazione(g, 'security.siti.mario-rossi.it', true, 'chat'), true);
  assert.equal(C.registraImpostazione(g, 'theme', 'il tema di Mario', 'mano'), true);
  assert.equal(C.registraImpostazione(g, 'theme', 'dark', 'mano'), true);
  assert.equal(C.registraImpostazione(g, 'theme', 'dark', 'una via inventata'), false);
  assert.equal(C.registraRicerca(g, 'la mia ricerca', { esito: 'aperta' }), false);
  assert.equal(C.registraProposta(g, 'ortografia', 'Mario <mario@x.it>', 'accettata'), true);
  assert.equal(C.registraProposta(g, 'la parola sbagliata', 'a/b', 'accettata'), false);
  assert.equal(C.registraConferma(g, 'NAVIGA', { livello: 'il mio', stato: 'pulito', costo: 9, risposta: 'chiede', esito: 'approvata' }), true);
  assert.equal(C.registraConferma(g, 'apri mario.it', { esito: 'approvata' }), false);
  assert.equal(C.registraErroreVisto(g, 'avviso:Impossibile salvare relazione.docx'), false);
  assert.equal(C.registraErroreVisto(g, 'rete:https://mario.it'), false);
  assert.equal(C.registraIntervista(g, 'privacy', 'mi chiamo Mario'), false);
  assert.equal(C.registraPrimaVolta(g, 'appunti di mario'), false);
  // Un disco manomesso: chiavi e valori che l'app non scriverebbe mai.
  g.uso['testo segreto'] = { n: 3, visto: {}, fine: {} };
  g.uso['filo-chat'].visto['la mia fascia'] = 4;
  g.uso['filo-chat'].nota = 'ciao';
  g.errori.explain = { 'deepseek/deepseek-v4-pro|DeepInfra|inventato': 2 };
  g.azioni['cerca mario'] = { n: 1 };
  g.impostazioni['mario.rossi'] = { 'segreto|mano': 1 };
  g.impostazioni.theme['il mio tema|mano'] = 3;
  g.conferme.NAVIGA['segreto|pulito|1|dentro|chat|si|automatica'] = 2;
  g.erroriVisti['avviso:la pagina di Mario'] = 1;
  g.intervista.privacy = { 'ciao Mario': 1 };
  g.primeVolte.push('appunti segreti');
  g.titolo = 'la pagina di prima';
  const doc = docDi(g);
  assert.deepEqual(doc.uso, { 'filo-chat': '1;0,0,1,0,0,0,0;0,0,0,1,0,0,0;0' });
  assert.deepEqual(doc.errori, { 'filo-chat': 'altro||rete|1' });
  assert.deepEqual(doc.azioni, {});
  assert.deepEqual(doc.impostazioni, { 'themeTokens.*': 'cambiato|mano|1', altro: 'cambiato|chat|1', theme: 'cambiato|mano|1;dark|mano|1;cambiato|mano|3' });
  assert.deepEqual(doc.correttore, { ortografia: 'altro|0,1,0,0' });
  assert.deepEqual(doc.conferme, { NAVIGA: 'altro|pulito|altro|altro|altro|chiede|approvata|1' });
  assert.deepEqual(doc.erroriVisti, {});
  assert.deepEqual(doc.intervista, {});
  assert.deepEqual(doc.primeVolte, []);
  assert.deepEqual(Object.keys(doc), [...C.CAMPI]);
  const tutto = JSON.stringify(doc);
  for (const parola of ['Mario', 'mario', 'Roma', 'segreto', 'ciao', 'pagina', 'inventato', 'preferito', 'relazione', '#ff', 'colore']) {
    assert.ok(!tutto.includes(parola), `«${parola}» è uscito nel documento: ${tutto}`);
  }
  assert.deepEqual(C.valida(doc), { ok: true, motivo: '' });
});

test('il validatore respinge quello che le regole non vedono: valori annidati fuori forma', () => {
  const g = C.oraVuota();
  C.registraUso(g, 'help', { visto: 900, fine: 2000 });
  C.registraAzione(g, 'new-tab', { visto: 90, fine: 300 });
  const buono = docDi(g);
  assert.equal(C.valida(buono).ok, true, C.valida(buono).motivo);
  const rotti = [
    { ...buono, nota: 'x' },
    { ...buono, os: 'Windows 11' },
    { ...buono, ora: '24' },
    { ...buono, ora: 9 },
    { ...buono, app: 'ciao' },
    { ...buono, pseudonimo: 'mario' },
    { ...buono, mese: '2026-09' },
    { ...buono, uso: { help: '1;0,2,0,0,0,0,0;0,0,0,0,0,0,0;0' } },
    { ...buono, uso: { help: '1;0,0,0,0,0,0,0' } },
    { ...buono, uso: { help: '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;2' } },
    { ...buono, uso: { 'non esiste': '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0' } },
    { ...buono, azioni: { 'nuova scheda': '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0' } },
    { ...buono, errori: { help: 'Scrivi qui il tuo nome||rete|1' } },
    { ...buono, errori: { help: [{ modello: 'altro', host: '', tipo: 'rete', n: 1 }] } },
    { ...buono, errori: { help: `altro||rete|1${';altro||rete|1'.repeat(C.TETTO_ERRORI_ORA)}` } },
    { ...buono, impostazioni: { theme: 'chiaro come piace a me|mano|1' } },
    { ...buono, ricerche: { 'cerca-filo': '1;0,0,1,0,0,0,0;1,1,0,0,0,0;0' } },
    { ...buono, conferme: { NAVIGA: 'default|pulito|1|dentro|chat|si|forse|1' } },
    { ...buono, chiedi: { explain: 2 } },
    { ...buono, primeVolte: ['explain', 'explain'] },
    { ...buono, primeVolte: 'explain' },
  ];
  for (const r of rotti) assert.equal(C.valida(r).ok, false, `doveva essere respinto: ${JSON.stringify(r).slice(0, 300)}`);
});

test('le attese finiscono in fasce, fino alla prima cosa visibile e fino alla fine; senza risposta l’uso conta senza fascia', () => {
  const g = C.oraVuota();
  for (const ms of [120, 900, 1500, 4000, 9000, 29000, 61000]) C.registraUso(g, 'explain', { visto: ms, fine: ms * 2 });
  C.registraUso(g, 'explain', { visto: null, fine: null, ripetuta: true });
  const d = docDi(g);
  assert.equal(d.uso.explain, '8;1,1,1,1,1,1,1;1,0,1,1,1,1,2;1');
  assert.deepEqual(C.leggiMisura(d.uso.explain), {
    n: 8, visto: { ms500: 1, s1: 1, s2: 1, s5: 1, s10: 1, s30: 1, oltre: 1 }, fine: { ms500: 1, s2: 1, s5: 1, s10: 1, s30: 1, oltre: 2 }, ripetute: 1,
  });
});

test('le impostazioni: la chiave dal registro dei cambi, il valore solo se di elenco chiuso, e chi l’ha cambiata', () => {
  assert.equal(C.chiaveImpostazione('theme'), 'theme');
  assert.equal(C.chiaveImpostazione('themeTokens.accent'), 'themeTokens.*');
  assert.equal(C.chiaveImpostazione('una.chiave.senza.nome'), 'altro');
  assert.equal(C.chiaveImpostazione('autonomia.livello'), 'autonomia.livello');
  assert.equal(C.chiaveImpostazione('contatori.attivi'), '', 'l’interruttore dei contatori non si conta: spento, non esce niente');
  assert.equal(C.valoreImpostazione('spiegaAnticipata.enabled', false), 'spento');
  assert.equal(C.valoreImpostazione('theme', 'dark'), 'dark');
  assert.equal(C.valoreImpostazione('theme', 'il mio'), 'cambiato');
  assert.equal(C.valoreImpostazione('textScale', 1.25), 'cambiato', 'un numero non è da elenco chiuso');
  assert.equal(C.valoreImpostazione('autonomia.livello', 'yolo'), 'yolo');
  assert.equal(C.valoreImpostazione('autonomia.livello', 'tutto'), 'cambiato');
  assert.equal(C.viaDi({ via: 'chat' }), 'chat');
  assert.equal(C.viaDi({ via: 'assistente' }), 'chat');
  assert.equal(C.viaDi({ via: 'interfaccia' }), 'mano');
  assert.equal(C.viaDi({ via: 'pagina' }), 'mano');
  assert.equal(C.viaDi({ via: 'importazione' }), 'import');
  assert.equal(C.viaDi(null), 'auto');
  const g = C.oraVuota();
  for (let i = 0; i < 30; i++) C.registraImpostazione(g, 'notifications.sound', ['default', 'gentle', 'urgent', 'chime'][i % 4], C.VIE[i % 4]);
  const voci = docDi(g).impostazioni['notifications.sound'].split(';');
  assert.ok(voci.length <= C.TETTO_VALORI);
  assert.equal(voci.reduce((a, v) => a + Number(v.split('|')[2]), 0), 30, 'oltre il tetto i valori si sommano in «cambiato», non si perdono');
});

test('ricerche, correttore, conferme e gli altri conti escono nella loro forma, e i tetti sommano in «altro»', () => {
  const g = C.oraVuota();
  C.registraRicerca(g, 'cerca-filo', { esito: 'aperta' });
  C.registraRicerca(g, 'cerca-filo', { esito: 'scelta', attesaMs: 1800, posizione: 1 });
  const lunga = 7000;
  C.registraRicerca(g, 'cerca-filo', { esito: 'scelta', attesaMs: lunga, posizione: 12 });
  C.registraRicerca(g, 'cerca-filo', { esito: 'vuota' });
  for (let i = 0; i < C.TETTO_COMBINAZIONI + 5; i++) C.registraProposta(g, 'frase', `x/modello-${i}`, 'mostrata');
  C.registraProposta(g, 'ortografia', 'deepseek/deepseek-v4-flash', 'ignorata');
  for (let i = 0; i < C.TETTO_CONFERME + 5; i++) {
    C.registraConferma(g, 'NAVIGA', { livello: C.LIVELLI_AUTONOMIA[i % 4], stato: C.STATI_COMPITO[i % 2], costo: i % 4, perimetro: 'dentro', origine: 'chat', risposta: C.RISPOSTE[i % 5], esito: C.ESITI_CONFERMA[i % 6] });
  }
  C.registraAnnullato(g, 'IMPOSTA_PREFERENZA');
  C.registraAnnullato(g, 'correzione-automatica');
  C.registraAnticipo(g, 'explain', 'preparato'); C.registraAnticipo(g, 'explain', 'preparato'); C.registraAnticipo(g, 'explain', 'aperto');
  C.registraChiesto(g, 'describe-image');
  C.registraErroreVisto(g, 'crash:scheda:oom'); C.registraErroreVisto(g, 'chat:crediti'); C.registraErroreVisto(g, 'rete:-105');
  C.registraIntervista(g, 'autonomia', 'automatico'); C.registraIntervista(g, 'chiusura', 'anticipata');
  const d = docDi(g);
  assert.deepEqual(C.leggiRicerca(d.ricerche['cerca-filo']), { aperte: 1, scelte: { s2: 1, s10: 1 }, posizioni: { p1: 1, oltre: 1 }, vuote: 1 });
  const frasi = d.correttore.frase.split(';');
  assert.ok(frasi.length <= C.TETTO_COMBINAZIONI);
  assert.equal(frasi.reduce((a, v) => a + Number(v.split('|')[1].split(',')[0]), 0), C.TETTO_COMBINAZIONI + 5);
  assert.equal(d.correttore.ortografia, 'deepseek/deepseek-v4-flash|0,0,0,1');
  const conferme = d.conferme.NAVIGA.split(';');
  assert.ok(conferme.length <= C.TETTO_CONFERME);
  assert.equal(conferme.reduce((a, v) => a + Number(v.split('|')[7]), 0), C.TETTO_CONFERME + 5);
  assert.deepEqual(d.annullati, { IMPOSTA_PREFERENZA: '1', 'correzione-automatica': '1' });
  assert.deepEqual(d.anticipi, { explain: '2;1' });
  assert.deepEqual(d.chiedi, { 'describe-image': '1' });
  assert.deepEqual(d.erroriVisti, { 'crash:scheda:oom': '1', 'chat:crediti': '1', 'rete:-105': '1' });
  assert.deepEqual(d.intervista, { autonomia: 'automatico|1', chiusura: 'anticipata|1' });
  assert.equal(C.valida(d).ok, true, C.valida(d).motivo);
});

test('il guasto che una persona vede viene dall’elenco chiuso', () => {
  const e = (props, msg = 'x') => Object.assign(new Error(msg), props);
  assert.equal(C.tipoErroreVisto(e({ code: 'NO_API_KEY' })), 'senza_chiave');
  assert.equal(C.tipoErroreVisto(e({ code: 'LIMIT_REACHED' })), 'limite_spesa');
  assert.equal(C.tipoErroreVisto(e({ status: 402 })), 'crediti');
  assert.equal(C.tipoErroreVisto(e({ status: 429 })), 'troppe_richieste');
  assert.equal(C.tipoErroreVisto(new TypeError('fetch failed')), 'rete');
  assert.equal(C.tipoErroreVisto(e({ name: 'AbortError' })), '', 'annullare non è un errore visto');
  for (const t of C.TIPI_ERRORE_VISTO) assert.equal(C.erroreVisto(`chat:${t}`), `chat:${t}`);
  for (const a of C.AVVISI_ERRORE) assert.equal(C.erroreVisto(`avviso:${a}`), `avviso:${a}`);
  for (const no of ['crash:scheda:boh', 'bloccata:la mia pagina', 'chat:', 'avviso:toast_ok', 'qualcosa']) assert.equal(C.erroreVisto(no), '', no);
});

test('le combinazioni di errore hanno un tetto, oltre si sommano in «altro» e non si perdono', () => {
  const g = C.oraVuota();
  for (let i = 0; i < C.TETTO_ERRORI_ORA + 5; i++) C.registraErrore(g, 'help', { modello: `x/modello-${i}`, host: 'Host', tipo: 'fornitore' });
  const lista = C.leggiErrori(docDi(g).errori.help);
  assert.ok(lista.length <= C.TETTO_ERRORI_ORA);
  assert.equal(lista.reduce((a, x) => a + x.n, 0), C.TETTO_ERRORI_ORA + 5);
});

test('il tipo di guasto viene dall’elenco chiuso, e annullare non è un guasto', () => {
  const e = (props, msg = 'x') => Object.assign(new Error(msg), props);
  assert.equal(C.tipoErrore(e({ status: 402 })), 'crediti');
  assert.equal(C.tipoErrore(new Error('OpenRouter 402: Insufficient credits')), 'crediti');
  assert.equal(C.tipoErrore(e({ status: 401 })), 'chiave');
  assert.equal(C.tipoErrore(e({ status: 403 }, 'OpenRouter 403: invalid key')), 'chiave');
  assert.equal(C.tipoErrore(e({ status: 403 }, 'OpenRouter 403: flagged by moderation')), 'fornitore');
  assert.equal(C.tipoErrore(e({ code: 'NO_ALLOWED_HOST' })), 'nessun_host');
  assert.equal(C.tipoErrore(e({ status: 404, code: 'MODEL_UNAVAILABLE' })), 'nessun_host');
  assert.equal(C.tipoErrore(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), 'rete');
  assert.equal(C.tipoErrore(e({ code: 'ECONNRESET' })), 'rete');
  assert.equal(C.tipoErrore(e({ name: 'TimeoutError' })), 'tempo');
  assert.equal(C.tipoErrore(e({ status: 504 })), 'tempo');
  assert.equal(C.tipoErrore(e({}, 'connect ETIMEDOUT 1.2.3.4:443')), 'tempo');
  assert.equal(C.tipoErrore(e({ status: 500 })), 'fornitore');
  assert.equal(C.tipoErrore(e({ status: 429 })), 'fornitore');
  assert.equal(C.tipoErrore(e({ name: 'AbortError' })), null);
  for (const code of ['NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION']) assert.equal(C.tipoErrore(e({ code })), null, code);
});

test('lo pseudonimo cambia al cambio di mese e resta lo stesso dentro il mese', () => {
  let n = 0;
  const casuale = () => `${'a'.repeat(18)}${String(++n).padStart(2, '0')}`;
  const ott = C.pseudonimoDelMese({}, '2026-10', { casuale });
  const ott2 = C.pseudonimoDelMese(ott.pseudonimi, '2026-10', { casuale });
  const nov = C.pseudonimoDelMese(ott2.pseudonimi, '2026-11', { casuale });
  assert.equal(ott.id, ott2.id);
  assert.equal(ott2.nuovo, false);
  assert.notEqual(nov.id, ott.id);
  assert.equal(nov.nuovo, true);
  assert.match(nov.id, C.PSEUDONIMO_RE);
  assert.equal(C.pseudonimoDelMese(nov.pseudonimi, '2026-10', { casuale }).id, ott.id);
});

test('lo pseudonimo non è mai il codice dei feedback né lo pseudonimo dei crediti, nemmeno per caso', () => {
  const crediti = 'abcdef0123456789';
  const feedback = '6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f';
  const prove = [`${crediti}0000`, '11111111111111111111'];
  const r = C.pseudonimoDelMese({}, '2026-10', { casuale: () => prove.shift(), esclusi: [`${crediti}0000`, feedback] });
  assert.equal(r.id, '11111111111111111111');
  assert.ok(!C.PSEUDONIMO_RE.test(crediti) && !C.PSEUDONIMO_RE.test(feedback), 'hanno un’altra forma: non si scambiano');
  assert.throws(() => C.pseudonimoDelMese({}, '2026-10', { casuale: () => 'non va' }));
});

test('le ore da spedire sono quelle chiuse, dalla più vecchia, con un tetto; i giorni di prima partono come allora', () => {
  const ore = {};
  for (let h = 0; h < 24; h++) ore[`2026-10-15T${String(h).padStart(2, '0')}`] = C.oraVuota();
  ore['2026-10-16T00'] = C.oraVuota();
  assert.deepEqual(C.oreDaInviare(ore, '2026-10-15T03'), ['2026-10-15T00', '2026-10-15T01', '2026-10-15T02']);
  assert.equal(C.oreDaInviare(ore, '2026-10-16T00').length, 24, 'l’ora in corso non parte');
  assert.equal(C.oreDaInviare(ore, '2026-10-17T00', 5)[0], '2026-10-15T00');
  const via = C.potaOre(ore, 20);
  assert.equal(via.length, 5);
  assert.equal(Object.keys(ore).length, 20);
  assert.equal(C.oraDi(new Date(2026, 9, 15, 7, 59, 59).getTime()), '2026-10-15T07');
  assert.equal(C.oraDi(new Date(2026, 9, 15, 23, 0, 0).getTime()), '2026-10-15T23');
  const vecchio = C.documentoGiorno({ pseudonimo: PSEUDO, giorno: '2026-10-14', app: '0.2.243', os: 'win', dati: { uso: { help: { n: 2, fasce: { s1: 1 } } }, errori: {} } });
  assert.deepEqual(vecchio, { v: 1, pseudonimo: PSEUDO, giorno: '2026-10-14', mese: '2026-10', app: '0.2.243', os: 'win', uso: { help: '2;0,1,0,0,0,0,0' }, errori: {} });
  assert.equal(C.valida(vecchio).ok, true);
  assert.equal(C.giornoPrima('2026-11-01'), '2026-10-31');
  assert.equal(C.famigliaOs('win32'), 'win');
  assert.equal(C.famigliaOs('freebsd'), 'altro');
});

// Quello che Filo dice in chat dei contatori (la descrizione dell'interruttore e l'avviso del cambio) segue l'invio
// ogni ora, come Preferenze e Privacy.
test('l’interruttore dei contatori, visto dalla chat, dice ogni ora e non una volta al giorno', () => {
  for (const m of ['tabColor', 'contenutoEsterno', 'preferences']) require(join(ROOT, 'src', 'shared', `${m}.js`));
  const P = globalThis.SN_PREF;
  const r = P.buildPreferencePartial('contatori anonimi', false);
  const testi = `${r.risk} ${P.setterDellaChiave('contatori anonimi').aiuto}`;
  assert.doesNotMatch(testi, /una volta al giorno/i);
  assert.match(r.risk, /ogni ora/);
});

// Le pagine di Filo aperte da un gesto sono azioni del manifesto, da qualunque strada ci si arrivi.
test('ogni pagina di Filo contata come azione porta un id del manifesto delle capacità', () => {
  for (const id of Object.values(C.AZIONE_DI_PAGINA)) assert.ok(C.azioni().includes(id), id);
  assert.equal(C.azioneDiPagina('filo://editor/editor.html'), 'editor');
  assert.equal(C.azioneDiPagina('https://filo://editor/'), '');
  assert.ok(C.PANNELLI.includes('barra-laterale') && C.PANNELLI.includes('tasto-destro'));
});
