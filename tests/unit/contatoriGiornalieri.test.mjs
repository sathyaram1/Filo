// I contatori anonimi (#969, #1461), la parte pura: esce solo quello che sta negli elenchi chiusi, ogni misura nella sua
// forma, e lo pseudonimo è del mese, nuovo a ogni mese e mai uguale al codice dei feedback o allo pseudonimo dei crediti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'actionTools', 'contatoriGiornalieri']) {
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

// Le voci specifiche (modello e host) di un documento intero, su tutte le funzioni: le righe «altro» restano fuori.
const specificheDi = (errori) => Object.values(errori).flatMap((e) => C.leggiErrori(e)).filter((x) => x.modello !== 'altro' || x.host);
const contiDi = (errori) => Object.values(errori).flatMap((e) => C.leggiErrori(e)).reduce((a, x) => a + x.n, 0);

test('gli errori hanno un tetto anche per documento: oltre, la voce va in «altro» del suo tipo e il conto resta intero (#1547)', () => {
  const g = C.oraVuota();
  let registrati = 0;
  for (const f of C.funzioni()) {
    for (let i = 0; i < 80; i++) {
      C.registraErrore(g, f, { modello: `fornitore/modello-${f}-${i}`, host: 'DeepInfra', tipo: C.ERRORI[i % C.ERRORI.length] });
      registrati += 1;
    }
  }
  const doc = docDi(g);
  assert.equal(specificheDi(doc.errori).length, C.TETTO_ERRORI_DOCUMENTO, 'le voci col modello si fermano al tetto del documento');
  assert.equal(contiDi(doc.errori), registrati, 'il passaggio ad «altro» non perde conti');
  for (const [f, e] of Object.entries(doc.errori)) {
    const lista = C.leggiErrori(e);
    assert.ok(lista.length <= C.TETTO_ERRORI_ORA, `${f}: ${lista.length} voci`);
    assert.equal(new Set(lista.map((x) => `${x.modello}|${x.host}|${x.tipo}`)).size, lista.length, `${f}: una voce ripetuta`);
  }
  assert.ok(Object.values(g.errori).reduce((a, per) => a + Object.keys(per).filter((k) => !k.startsWith('altro||')).length, 0) <= C.TETTO_ERRORI_DOCUMENTO,
    'anche l’ora sul disco si ferma al tetto');
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
  // Un documento con più voci specifiche del tetto non parte.
  const troppe = { ...doc, errori: { ...doc.errori, help: Array.from({ length: 20 }, (_, i) => `x/y${i}|H|rete|1`).join(';') } };
  assert.equal(C.valida(troppe).ok, false);
});

test('un giorno di prima con 80 combinazioni per funzione parte dentro il tetto del documento, coi conti interi (#1547)', () => {
  const errori = {};
  let registrati = 0;
  for (const f of C.funzioni()) {
    errori[f] = {};
    for (let i = 0; i < 80; i++) { errori[f][`fornitore/modello-${i}|DeepInfra|${C.ERRORI[i % C.ERRORI.length]}`] = i + 1; registrati += i + 1; }
  }
  const doc = C.documentoGiorno({ pseudonimo: PSEUDO, giorno: '2026-10-14', app: '0.2.240', os: 'win', dati: { uso: {}, errori } });
  assert.equal(specificheDi(doc.errori).length, C.TETTO_ERRORI_DOCUMENTO);
  assert.equal(contiDi(doc.errori), registrati, 'la somma dei conti nel documento è quella registrata');
  for (const e of Object.values(doc.errori)) assert.ok(C.leggiErrori(e).length <= C.TETTO_COMBINAZIONI);
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
});

test('un’ora rimasta sul disco da prima del tetto parte dentro il tetto, coi conti interi (#1547)', () => {
  const g = C.oraVuota();
  let registrati = 0;
  for (const f of C.funzioni()) {
    g.errori[f] = {};
    for (let i = 0; i < 24; i++) { g.errori[f][`fornitore/m-${i}|Host|rete`] = 2; registrati += 2; }
    g.errori[f]['altro||rete'] = 3; registrati += 3;
  }
  const doc = docDi(g);
  assert.equal(specificheDi(doc.errori).length, C.TETTO_ERRORI_DOCUMENTO);
  assert.equal(contiDi(doc.errori), registrati);
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
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

// ── La chat e l'agente (#1463) ──────────────────────────────────────────────
const chatDi = (dati, chiave = '2026-10-15T09') => C.documentoChat({ pseudonimo: PSEUDO, chiave, app: '0.2.243', os: 'win', dati });
const voci = (s) => Object.fromEntries(String(s).split(';').map((v) => { const p = v.split('|'); return [p.slice(0, -1).join('|'), Number(p[p.length - 1])]; }));

test('un turno di chat esce come «esito|fascia dei giri|n»: il dodicesimo giro è il tetto, uno fermato prima del primo vale un giro', () => {
  const g = C.oraVuota();
  for (const giri of [1, 1, 2, 3, 4, 6, 7, 11, 12]) assert.ok(C.registraTurno(g, 'filo-chat', { esito: 'risposta', giri }));
  assert.ok(C.registraTurno(g, 'filo-chat', { esito: 'fermato', giri: 0 }));
  assert.ok(C.registraTurno(g, 'filo-chat', { esito: 'tetto_giri', giri: 12 }));
  for (const no of [{ esito: 'boh', giri: 1 }, { esito: 'risposta', giri: -1 }, { esito: 'risposta', giri: 'tre' }]) assert.ok(!C.registraTurno(g, 'filo-chat', no));
  assert.ok(!C.registraTurno(g, 'explain', { esito: 'risposta', giri: 1 }), 'solo le funzioni che girano coi loro strumenti');
  const d = chatDi(g);
  assert.deepEqual(voci(d.chatTurni['filo-chat']), {
    'risposta|g1': 2, 'risposta|g2': 1, 'risposta|g3': 1, 'risposta|g4_6': 2, 'risposta|g7_11': 2, 'risposta|tetto': 1,
    'tetto_giri|tetto': 1, 'fermato|g1': 1,
  });
  assert.deepEqual(Object.keys(d.chatTurni), ['filo-chat']);
  assert.equal(C.valida(d).ok, true, C.valida(d).motivo);
});

test('gli strumenti per nome ed esito: un nome che Filo non offre è «altro», oltre il tetto si somma in «altro» e non si perde', () => {
  const g = C.oraVuota();
  assert.ok(C.registraStrumento(g, 'filo-chat', 'naviga', 'eseguito'));
  assert.ok(C.registraStrumento(g, 'filo-chat', 'NAVIGA', 'eseguito'));
  assert.ok(C.registraStrumento(g, 'filo-chat', 'cerca mario rossi su google', 'rifiutato'));
  assert.ok(!C.registraStrumento(g, 'filo-chat', 'NAVIGA', 'boh'));
  const d = chatDi(g);
  assert.deepEqual(voci(d.strumenti['filo-chat']), { 'NAVIGA|eseguito': 2, 'altro|rifiutato': 1 });

  const pieno = C.oraVuota();
  let tot = 0;
  for (const nome of C.strumenti()) for (const esito of C.ESITI_STRUMENTO) { C.registraStrumento(pieno, 'filo-chat', nome, esito); tot += 1; }
  const lista = chatDi(pieno).strumenti['filo-chat'].split(';');
  assert.ok(tot > C.TETTO_STRUMENTI && lista.length <= C.TETTO_STRUMENTI);
  assert.equal(lista.reduce((a, v) => a + Number(v.split('|')[2]), 0), tot);
  assert.ok(lista.some((v) => v.startsWith('altro|')));
  assert.equal(C.valida(chatDi(pieno)).ok, true);

  // Uno strumento sparito da Filo mentre la sua ora aspettava esce come «altro», col suo conto.
  const vecchia = C.oraVuota();
  vecchia.strumenti['filo-chat'] = { 'STRUMENTO_TOLTO|eseguito': 3, 'NAVIGA|eseguito': 1, 'NAVIGA|eseguito|x': 9, 'ciao mario': 5 };
  assert.deepEqual(voci(chatDi(vecchia).strumenti['filo-chat']), { 'NAVIGA|eseguito': 1, 'altro|eseguito': 3 });
});

test('l’esito di uno strumento: argomenti, segreto, conferma, rifiuto, proxy non disponibile, riuscita', () => {
  const E = (a, res) => C.esitoStrumento(a, res);
  assert.equal(E({ argomenti: 'JSON non valido' }, { rejected: true }), 'argomenti_errati');
  assert.equal(E({ argomenti: 'tagliati', tagliati: true }, { rejected: true }), 'argomenti_tagliati');
  assert.equal(E({}, { output: { blocked: 'segreto' }, executed: false }), 'fermato_segreto');
  assert.equal(E({}, { needsConfirm: 2, kept: true }), 'in_conferma');
  assert.equal(E({}, { rejected: true }), 'rifiutato');
  assert.equal(E({}, { no: true }), 'rifiutato');
  assert.equal(E({}, { executed: true, output: { proxy: 'non_disponibile' } }), 'non_disponibile');
  assert.equal(E({}, { executed: true, kept: true }), 'eseguito');
  assert.equal(E({}, { executed: false, kept: false }), 'non_riuscito');
  assert.equal(E(undefined, undefined), 'non_riuscito');
});

test('azioni per giro, strade di riserva, reazioni e copie: solo dagli elenchi chiusi, in conti', () => {
  const g = C.oraVuota();
  for (const n of [1, 1, 2, 3, 5, 6, 40]) assert.ok(C.registraAzioniDelGiro(g, 'filo-chat', n));
  assert.ok(!C.registraAzioniDelGiro(g, 'filo-chat', 0), 'un giro senza azioni non è un giro di strumenti');
  assert.ok(C.registraAzioniDelGiro(g, 'filo-chat', 2, 4), 'più giri uguali in un colpo');
  for (const v of ['sollecito', 'sollecito', 'senza_foto']) assert.ok(C.registraRecupero(g, v));
  for (const v of ['ferma_durante_testo', 'riprova', 'riprova', 'seguito_scritto', 'continua_muto_dopo_letture']) assert.ok(C.registraReazione(g, v));
  for (const r of ['risposta', 'attivita', 'utente', 'utente']) assert.ok(C.registraCopia(g, r));
  for (const [f, v] of [[C.registraRecupero, 'ripiego qualunque'], [C.registraReazione, 'ferma'], [C.registraCopia, 'il testo copiato']]) assert.ok(!f(g, v), v);
  const d = chatDi(g);
  assert.deepEqual(d.azioniPerGiro, { 'filo-chat': '2,5,2,2' });
  assert.deepEqual(d.chatRecuperi, { senza_foto: '1', sollecito: '2' });
  assert.deepEqual(d.chatReazioni, { ferma_durante_testo: '1', continua_muto_dopo_letture: '1', riprova: '2', seguito_scritto: '1' });
  assert.deepEqual(d.chatCopie, { risposta: '1', attivita: '1', utente: '2' });
  assert.equal(C.valida(d).ok, true, C.valida(d).motivo);
});

test('una chat chiusa esce come «messaggi|durata|tipo|n» per via; senza tipo è «nessuno», e senza messaggi della persona non conta', () => {
  const g = C.oraVuota();
  const MIN = 60 * 1000;
  assert.ok(C.registraChatChiusa(g, { via: 'uscita', messaggi: 1, durataMs: 0, tipo: 'comando' }));
  assert.ok(C.registraChatChiusa(g, { via: 'uscita', messaggi: 4, durataMs: 3 * MIN, tipo: 'conversazione' }));
  assert.ok(C.registraChatChiusa(g, { via: 'chat_nuova', messaggi: 12, durataMs: 3 * 60 * MIN, tipo: null }));
  assert.ok(C.registraChatChiusa(g, { via: 'risposta_tardiva', messaggi: 7, durataMs: 45 * MIN, tipo: 'nessuno' }));
  assert.ok(!C.registraChatChiusa(g, { via: 'uscita', messaggi: 0, durataMs: 0, tipo: 'comando' }));
  assert.ok(!C.registraChatChiusa(g, { via: 'chiusa da mario', messaggi: 1, durataMs: 0 }));
  assert.ok(!C.registraChatChiusa(g, { via: 'home', messaggi: 1, durataMs: -5 }));
  const d = chatDi(g);
  assert.deepEqual(d.chatChiuse, {
    chat_nuova: 'oltre|oltre|nessuno|1', uscita: 'm1|min1|comando|1;m3_5|min5|conversazione|1', risposta_tardiva: 'm6_10|ora|nessuno|1',
  });
  assert.equal(C.valida(d).ok, true, C.valida(d).motivo);
  // Il titolo non c'è da nessuna parte: un tipo scritto a mano sul disco non esce.
  g.chatChiuse.home = { 'm1|min1|Ricetta della nonna': 2 };
  assert.equal(chatDi(g).chatChiuse.home, undefined);
});

test('il validatore respinge una voce della chat fuori forma, ripetuta o a zero', () => {
  const base = chatDi(C.oraVuota());
  for (const [campo, v] of [
    ['chatTurni', { 'filo-chat': 'risposta|g1|0' }], ['chatTurni', { 'filo-chat': 'risposta|g1|1;risposta|g1|2' }],
    ['strumenti', { 'filo-chat': 'naviga|eseguito|1' }], ['strumenti', { explain: 'NAVIGA|eseguito|1' }],
    ['chatChiuse', { uscita: 'm1|min1|nessuno|1;m1|min1|nessuno|1' }], ['chatCopie', { risposta: 'tutto' }],
    ['azioniPerGiro', { 'filo-chat': '1,2,3' }], ['chatReazioni', { stop: '1' }],
  ]) assert.equal(C.valida({ ...base, [campo]: v }).ok, false, `${campo} ${JSON.stringify(v)}`);
});

test('la chat ha il suo documento per l’ora: la testa dell’ora senza il segno del primo, l’id con «_chat», e parte solo se ha qualcosa', () => {
  const g = C.oraVuota();
  C.registraUso(g, 'help', { visto: 100, fine: 200 });
  const ora = docDi(g);
  const vuota = chatDi(g);
  assert.deepEqual(Object.keys(ora), [...C.CAMPI], 'l’ora resta quella di #1461');
  assert.ok(!C.MISURE_CHAT.some((k) => k in ora));
  assert.deepEqual(Object.keys(vuota), [...C.CAMPI_CHAT]);
  assert.equal(vuota.v, C.VERSIONE_CHAT);
  assert.equal(C.haChat(vuota), false);
  C.registraCopia(g, 'utente');
  const chat = chatDi(g);
  assert.equal(C.haChat(chat), true);
  assert.equal(C.idDocumento(chat), `${C.idDocumento(ora)}_chat`);
  assert.equal(C.valida(chat).ok, true, C.valida(chat).motivo);
  assert.equal(C.valida({ ...chat, primo: 'mese' }).ok, false, 'un campo dell’ora nella chat non passa');
  assert.equal(C.valida({ ...ora, chatCopie: {} }).ok, false, 'un campo della chat nell’ora non passa');
  assert.equal(C.valida({ ...chat, ora: '24' }).ok, false);
});
