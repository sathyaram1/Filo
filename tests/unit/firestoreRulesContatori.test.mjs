// Sentinella sulle regole dei contatori anonimi (#969, #1461, #1464): le collezioni sono a sola creazione, lette solo
// dall'admin, e la forma che accettano è quella che l'app costruisce: le ore (v2), i giorni di prima (v1) e le chiamate
// ai modelli di un'ora. Il motore vero la prova contatoriRegole.motore-vero.mjs; questa rilegge il file che si pubblica.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const F = C.FORME;

const senzaCommenti = (s) => s.replace(/\/\/[^\n]*/g, ' ');
function blocco(collezione) {
  const righe = RULES.split('\n');
  const i = righe.findIndex((r) => new RegExp(`^ {4}match\\s+/${collezione}/\\{`).test(r));
  assert.ok(i >= 0, `manca il blocco match /${collezione}`);
  const j = righe.findIndex((r, k) => k > i && /^ {4}\}\s*$/.test(r));
  return senzaCommenti(righe.slice(i, j + 1).join('\n'));
}
const B = blocco(C.COLLEZIONE);
const BC = blocco(C.COLLEZIONE_CHIAMATE);
const BA = blocco(C.COLLEZIONE_ATTIVITA);
// Le funzioni che le ore e le loro chiamate condividono stanno fra l'intestazione dei contatori e il blocco delle ore.
const CONDIVISE = (() => {
  const a = RULES.indexOf('    // ── I contatori anonimi');
  const b = RULES.indexOf(`    match /${C.COLLEZIONE}/{`);
  assert.ok(a >= 0 && b > a, 'le funzioni condivise dei contatori stanno prima del blocco delle ore');
  return senzaCommenti(RULES.slice(a, b));
})();
const TUTTO = [CONDIVISE, B, BC, BA].join('\n');

function corpo(nome) {
  const m = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{\\s*((?:let [^;]+;\\s*)*)return([\\s\\S]*?);\\s*\\}`).exec(TUTTO);
  assert.ok(m, `manca la funzione ${nome} nelle regole`);
  return m[2].replace(/\s+/g, ' ').trim();
}
const GIORNO = corpo('contatoriGiorno');
const ORA = corpo('contatoriOra');
const CHIAMATE = corpo('contatoriChiamate');
const ATTIVITA = corpo('contatoriAttivita');

function regole(testo) {
  const out = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(testo)) !== null) out.push({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].replace(/\s+/g, ' ').trim() });
  return out;
}
const R = regole(B);
const per = (verbo, r = R) => r.filter((x) => x.verbi.includes(verbo));

const stringhe = (s) => [...s.matchAll(/'([^']*)'/g)].map((x) => x[1]);
function elencoDopo(testo, etichetta) {
  const m = new RegExp(`${etichetta}[\\s\\S]*?\\[([^\\]]*)\\]`).exec(testo);
  assert.ok(m, `non trovo l'elenco dopo «${etichetta}»`);
  return stringhe(m[1]);
}
const FUNZIONI_REGOLE = elencoDopo(TUTTO, 'function funzioniContate\\(\\)');
const unite = (forma) => `^(${forma.slice(1, -1)}(#${forma.slice(1, -1)})*)?$`;

// Le misure dell'ora come le controllano le regole: chiuse(d.x, elenco, tetto, valori) o aForma(d.x, chiavi, tettoChiavi, tetto, valori).
// Nelle chiamate l'elenco delle funzioni sta in `f`, legato una volta sola a funzioniContate().
function misureChiuse(testo) {
  const out = {};
  for (const m of testo.matchAll(/chiuse\(d\.(\w+), (funzioniContate\(\)|f|\[[^\]]*\]), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { chiavi: ['funzioniContate()', 'f'].includes(m[2]) ? FUNZIONI_REGOLE : stringhe(m[2]), tetto: Number(m[3]), valori: m[4] };
  }
  return out;
}
function misureDelleRegole() {
  const out = misureChiuse(ORA);
  for (const m of ORA.matchAll(/aForma\(d\.(\w+), '([^']+)', (\d+), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { formaChiavi: m[2], tettoChiavi: Number(m[3]), tetto: Number(m[4]), valori: m[5] };
  }
  const pv = /d\.primeVolte is list && d\.primeVolte\.size\(\) <= (\d+) && d\.primeVolte\.join\('#'\)\.size\(\) <= (\d+) && d\.primeVolte\.join\('#'\)\.matches\('([^']+)'\)/.exec(ORA);
  assert.ok(pv, 'manca il controllo delle prime volte');
  out.primeVolte = { lista: true, quante: Number(pv[1]), tetto: Number(pv[2]), valori: pv[3] };
  return out;
}
const M = misureDelleRegole();
const MC = misureChiuse(CHIAMATE);

// Le regole applicate a un documento, come le applica il server a una stringa unita.
function passa(doc, misure = M) {
  for (const [campo, r] of Object.entries(misure)) {
    const v = doc[campo];
    if (r.lista) {
      if (!Array.isArray(v) || v.length > r.quante || v.join('#').length > r.tetto || !new RegExp(r.valori).test(v.join('#'))) return `${campo}`;
      continue;
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${campo} non è una mappa`;
    const chiavi = Object.keys(v);
    if (r.chiavi && !chiavi.every((k) => r.chiavi.includes(k))) return `${campo}: chiave fuori elenco`;
    if (r.formaChiavi && (chiavi.join('#').length > r.tettoChiavi || !new RegExp(r.formaChiavi).test(chiavi.join('#')))) return `${campo}: chiavi fuori forma`;
    // Il server unisce anche i numeri (un numero è un numero): una mappa o una lista dentro, invece, fa fallire l'unione.
    const valori = Object.values(v);
    if (!valori.every((x) => typeof x === 'string' || Number.isInteger(x))) return `${campo}: un valore non si unisce`;
    if (valori.join('#').length > r.tetto || !new RegExp(r.valori).test(valori.join('#'))) return `${campo}: valori fuori forma`;
  }
  return '';
}

test('si legge solo da admin, si crea una volta e non si tocca più', () => {
  assert.deepEqual(per('get').map((r) => r.cond), ['isAdmin()']);
  assert.deepEqual(per('list').map((r) => r.cond), ['isAdmin()']);
  assert.ok(per('read').length === 0, 'una `read` larga riaprirebbe get e list');
  for (const v of ['update', 'delete']) {
    assert.ok(per(v).length >= 1 && per(v).every((r) => r.cond === 'false'), `${v} deve essere negato in chiaro: un'ora si scrive una volta`);
  }
  assert.ok(per('write').length === 0, 'una `write` scavalcherebbe il no a update e delete');
  assert.equal(per('create').length, 1);
  assert.equal(per('create')[0].cond, 'contatoriGiorno(request.resource.data) || contatoriOra(request.resource.data)');
});

test('i campi dell’ora sono quelli che l’app costruisce, tutti obbligatori; i giorni di prima tengono la loro forma', () => {
  assert.deepEqual(elencoDopo(ORA, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI]);
  assert.deepEqual(elencoDopo(ORA, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI]);
  assert.deepEqual(elencoDopo(GIORNO, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_GIORNO]);
  assert.deepEqual(elencoDopo(GIORNO, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_GIORNO]);
  assert.equal(Number(/d\.v == (\d+)/.exec(ORA)[1]), C.VERSIONE);
  assert.equal(Number(/d\.v == (\d+)/.exec(GIORNO)[1]), C.VERSIONE_GIORNO);
  const ora = C.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.243', os: 'win', dati: C.oraVuota() });
  assert.deepEqual(Object.keys(ora), [...C.CAMPI]);
  const giorno = C.documentoGiorno({ pseudonimo: 'a'.repeat(20), giorno: '2026-10-15', app: '0.2.243', os: 'win', dati: {} });
  assert.deepEqual(Object.keys(giorno), [...C.CAMPI_GIORNO]);
  assert.deepEqual(Object.keys(M).sort(), [...C.MISURE_ORA].sort(), 'ogni misura ha il suo controllo nelle regole, e nessuna in più');
});

test('le chiavi chiuse vengono dagli elenchi dell’app; le altre hanno una forma che ogni voce dell’app rispetta', () => {
  const mancano = C.funzioni().filter((f) => !FUNZIONI_REGOLE.includes(f));
  assert.deepEqual(mancano, [],
    'ogni funzione di SN_CONTATORI.funzioni() deve stare nelle regole. Una funzione nuova va aggiunta qui '
    + 'e le regole ripubblicate (npm run regole:pubblica): finché non lo sono, le ore che la portano '
    + 'vengono rifiutate e restano in attesa. Una funzione tolta dall’app resta: le copie vecchie la mandano ancora.');
  assert.equal(new Set(FUNZIONI_REGOLE).size, FUNZIONI_REGOLE.length, 'una funzione scritta due volte nelle regole');
  assert.match(GIORNO, /d\.uso is map && d\.uso\.keys\(\)\.hasOnly\(funzioniContate\(\)\)/);
  assert.match(GIORNO, /d\.errori is map && d\.errori\.keys\(\)\.hasOnly\(funzioniContate\(\)\)/);
  for (const campo of ['uso', 'errori', 'anticipi', 'chiedi']) assert.equal(M[campo].chiavi, FUNZIONI_REGOLE, `${campo} si chiude sulle funzioni`);
  assert.deepEqual(M.ricerche.chiavi, [...C.PANNELLI]);
  assert.deepEqual(M.correttore.chiavi, [...C.TIPI_PROPOSTA]);

  const forma = (campo) => new RegExp(`^${M[campo].formaChiavi.slice(2, -4).split('(#')[0]}$`);
  const fuori = (lista, campo) => lista.filter((k) => !forma(campo).test(k));
  assert.equal(M.azioni.formaChiavi, unite(F.CHIAVE_AZIONE_FORMA));
  assert.deepEqual(fuori(C.azioni(), 'azioni'), [], 'un id del manifesto delle capacità fuori dalla forma delle regole');
  assert.equal(M.impostazioni.formaChiavi, unite(F.CHIAVE_IMPOSTAZIONE_FORMA));
  assert.deepEqual(fuori([...C.chiaviImpostazioni(), 'altro'], 'impostazioni'), []);
  for (const campo of ['conferme', 'annullati']) assert.equal(M[campo].formaChiavi, unite(F.TIPO_AZIONE_FORMA));
  assert.deepEqual(fuori([...C.tipiAzione(), ...C.ANNULLABILI_IN_PAGINA], 'annullati'), []);
  assert.equal(M.erroriVisti.formaChiavi, unite(F.ERRORE_VISTO_FORMA));
  assert.equal(M.intervista.formaChiavi, unite(F.PASSO_FORMA));
  assert.deepEqual(fuori(C.passiIntervista(), 'intervista'), []);
  assert.equal(M.primeVolte.valori, unite(F.CHIAVE_AZIONE_FORMA));
  assert.deepEqual(fuori([...C.funzioni(), ...C.azioni()], 'azioni'), [], 'una prima volta fuori dalla forma delle regole');
  // Una chiave a forma non porta testo: niente spazi, niente segni, e un nome di file o un indirizzo non ci stanno.
  for (const campo of ['azioni', 'impostazioni', 'conferme', 'erroriVisti', 'intervista']) {
    for (const k of ['mario rossi', 'https://x.it/a', 'relazione finale.docx', '<script>', 'ciao, come stai']) {
      assert.ok(!forma(campo).test(k), `${campo}: «${k}» passerebbe le regole`);
    }
  }
});

test('i valori annidati hanno la forma dell’app, e i tetti reggono il documento più carico che l’app sa fare', () => {
  const formaApp = {
    uso: F.MISURA_FORMA, errori: F.ERRORI_FORMA, azioni: F.MISURA_FORMA, impostazioni: F.IMPOSTAZIONI_FORMA,
    ricerche: F.RICERCA_FORMA, correttore: F.CORRETTORE_FORMA, conferme: F.CONFERME_FORMA, annullati: F.CONTO_FORMA,
    anticipi: F.ANTICIPO_FORMA, chiedi: F.CONTO_FORMA, erroriVisti: F.CONTO_FORMA, intervista: F.INTERVISTA_FORMA,
  };
  for (const [campo, f] of Object.entries(formaApp)) assert.equal(M[campo].valori, unite(f), `forma dei valori di ${campo}`);
  assert.match(GIORNO, new RegExp(`d\\.uso\\.values\\(\\)\\.join\\('#'\\)\\.matches\\('${unite(F.USO_FORMA).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
  assert.match(GIORNO, new RegExp(`d\\.errori\\.values\\(\\)\\.join\\('#'\\)\\.matches\\('${unite(F.ERRORI_FORMA).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));

  // L'ora più carica possibile: ogni funzione, azione, impostazione, pannello, tipo e scelta, ai loro tetti.
  const ora = C.oraVuota();
  const modello = (i) => `${'m'.repeat(60)}/${'x'.repeat(50)}${i}`;
  for (const f of C.funzioni()) {
    for (let i = 0; i < 80; i++) C.registraErrore(ora, f, { modello: modello(i), host: 'H'.repeat(48), tipo: 'fornitore' });
    for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraUso(ora, f, { visto: ms, fine: ms * 2, ripetuta: true });
    C.registraAnticipo(ora, f, 'preparato'); C.registraAnticipo(ora, f, 'aperto'); C.registraChiesto(ora, f);
    C.registraPrimaVolta(ora, f);
  }
  for (const a of C.azioni()) {
    for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraAzione(ora, a, { visto: ms, fine: ms, ripetuta: true });
    C.registraPrimaVolta(ora, a);
  }
  for (const k of C.chiaviImpostazioni()) {
    for (const via of C.VIE) for (const v of [true, false, 'dark', 'light', 'system', 'yolo', 3, 'x'.repeat(200)]) C.registraImpostazione(ora, k, v, via);
  }
  for (const p of C.PANNELLI) {
    C.registraRicerca(ora, p, { esito: 'aperta' }); C.registraRicerca(ora, p, { esito: 'vuota' });
    for (let i = 1; i < 30; i++) C.registraRicerca(ora, p, { esito: 'scelta', attesaMs: i * 1000, posizione: i });
  }
  for (const t of C.TIPI_PROPOSTA) for (let i = 0; i < 80; i++) for (const e of C.ESITI_PROPOSTA) C.registraProposta(ora, t, modello(i), e);
  for (const t of C.tipiAzione()) {
    for (const livello of C.LIVELLI_AUTONOMIA) for (const risposta of C.RISPOSTE) for (const esito of C.ESITI_CONFERMA) {
      C.registraConferma(ora, t, { livello, stato: 'contaminato', costo: 3, perimetro: 'fuori', origine: 'automazione', risposta, esito });
    }
    C.registraAnnullato(ora, t);
  }
  for (const t of C.ANNULLABILI_IN_PAGINA) C.registraAnnullato(ora, t);
  for (const d of C.DOVE_CRASH) { C.registraErroreVisto(ora, `bloccata:${d}`); for (const m of C.MOTIVI_CRASH) C.registraErroreVisto(ora, `crash:${d}:${m}`); }
  for (const t of C.TIPI_ERRORE_VISTO) { C.registraErroreVisto(ora, `chat:${t}`); C.registraErroreVisto(ora, `modello:${t}`); }
  for (const a of C.AVVISI_ERRORE) C.registraErroreVisto(ora, `avviso:${a}`);
  for (let i = 1; i < 300; i++) C.registraErroreVisto(ora, `rete:-${i}`);
  for (const p of C.passiIntervista()) for (const s of C.SCELTE_INTERVISTA) C.registraIntervista(ora, p, s);
  const gonfia = (o) => { for (const k of Object.keys(o)) { if (Number.isInteger(o[k])) o[k] = 999999999; else if (o[k] && typeof o[k] === 'object') gonfia(o[k]); } };
  gonfia(ora);

  const doc = C.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T23', app: '9999.9999.999999', os: 'win', dati: ora });
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
  assert.equal(passa(doc), '', 'il documento più carico dell’app deve passare le regole');
  const totale = Object.values(M).reduce((a, r) => a + r.tetto + (r.tettoChiavi || 0), 0);
  assert.ok(totale <= 1000000, `i tetti delle regole sommano ${totale}: oltre, un documento passerebbe il limite di Firestore (1 MiB)`);
  assert.ok(JSON.stringify(doc).length < 1000000);

  const vuoto = C.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T00', app: '0.2.243', os: 'win', dati: C.oraVuota() });
  assert.equal(passa(vuoto), '', 'un’ora senza niente passa');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v });
  assert.notEqual(manomesso('errori', { explain: 'modello|host|fornitore|1;<script>alert(1)</script>' }), '');
  assert.notEqual(manomesso('uso', { explain: '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0 ciao' }), '');
  assert.notEqual(manomesso('impostazioni', { theme: 'il mio tema preferito|mano|1' }), '');
  assert.notEqual(manomesso('azioni', { 'cerca su google': '1;0,0,0,0,0,0,0;0,0,0,0,0,0,0;0' }), '');
  assert.notEqual(manomesso('intervista', { privacy: 'mi chiamo Mario|1' }), '');
  assert.notEqual(manomesso('primeVolte', ['explain', 'appunti di mario']), '');
  assert.notEqual(manomesso('chiedi', { explain: { n: 3, nota: 'ciao' } }), '', 'una mappa al posto della stringa non si unisce: rifiutata');
  assert.notEqual(manomesso('annullati', { NAVIGA: '1 volta' }), '');
});

test('pseudonimo, giorno, ora, versione e sistema hanno la forma dell’app, e l’id dice pseudonimo, giorno e ora', () => {
  for (const testo of [GIORNO, ORA, CHIAMATE, ATTIVITA]) {
    const pattern = (campo) => {
      const m = new RegExp(`d\\.${campo}\\.matches\\('([^']+)'\\)`).exec(testo);
      assert.ok(m, `manca il controllo di forma su ${campo}`);
      return new RegExp(m[1]);
    };
    const ps = pattern('pseudonimo');
    assert.ok(ps.test('0123456789abcdef0123') && !ps.test('0123456789abcdef') && !ps.test('mario rossi 12345678'));
    const g = pattern('giorno');
    assert.ok(g.test('2026-10-15') && !g.test('15/10/2026'));
    const app = pattern('app');
    assert.ok(app.test('0.2.243') && !app.test('ciao') && app.test(C.versioneApp('versione strana')));
    assert.match(testo, /d\.giorno\.matches\(d\.mese \+ '-\[0-3\]\[0-9\]'\)/);
    const os = /d\.os in \[([^\]]*)\]/.exec(testo);
    assert.ok(os, 'manca l’elenco dei sistemi');
    assert.deepEqual(stringhe(os[1]), [...C.OS]);
  }
  assert.match(GIORNO, /docId == d\.pseudonimo \+ '_' \+ d\.giorno &&/);
  for (const testo of [ORA, CHIAMATE]) {
    assert.match(testo, /docId == d\.pseudonimo \+ '_' \+ d\.giorno \+ '_' \+ d\.ora/);
    const ora = /d\.ora is string && d\.ora\.matches\('([^']+)'\)/.exec(testo);
    assert.ok(ora);
    for (let h = 0; h < 24; h++) assert.ok(new RegExp(ora[1]).test(String(h).padStart(2, '0')));
    for (const no of ['24', '7', 'T07', '07 ']) assert.ok(!new RegExp(ora[1]).test(no));
  }
  // Il segno del primo documento è di un elenco chiuso: è quello che l'owner legge per contare le copie.
  const primo = /d\.primo in \[([^\]]*)\]/.exec(ORA);
  assert.ok(primo, 'manca l’elenco dei segni del primo documento');
  assert.deepEqual(stringhe(primo[1]), [...C.PRIMI]);
  const doc = C.documento({ pseudonimo: 'b'.repeat(20), chiave: '2026-10-15T07', app: '0.2.243', os: 'mac', dati: C.oraVuota() });
  assert.equal(C.idDocumento(doc), `${'b'.repeat(20)}_2026-10-15_07`);
  const vecchio = C.documentoGiorno({ pseudonimo: 'b'.repeat(20), giorno: '2026-10-15', app: '0.2.243', os: 'mac', dati: {} });
  assert.equal(C.idDocumento(vecchio), `${'b'.repeat(20)}_2026-10-15`);
});

// ── Le chiamate ai modelli di un'ora (#1464) ─────────────────────────────
test('le chiamate: sola creazione, lette dall’admin, con gli stessi campi e la stessa versione dell’app', () => {
  const RC = regole(BC);
  assert.deepEqual(per('get', RC).map((r) => r.cond), ['isAdmin()']);
  assert.deepEqual(per('list', RC).map((r) => r.cond), ['isAdmin()']);
  assert.ok(!per('read', RC).length && !per('write', RC).length);
  for (const v of ['update', 'delete']) assert.ok(per(v, RC).length >= 1 && per(v, RC).every((r) => r.cond === 'false'));
  assert.deepEqual(per('create', RC).map((r) => r.cond), ['contatoriChiamate(request.resource.data)']);
  assert.deepEqual(elencoDopo(CHIAMATE, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_CHIAMATE]);
  assert.deepEqual(elencoDopo(CHIAMATE, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_CHIAMATE]);
  assert.equal(Number(/d\.v == (\d+)/.exec(CHIAMATE)[1]), C.VERSIONE_CHIAMATE);
  // La lista delle funzioni si valuta una volta: Firestore conta ogni espressione, e il tetto è mille per scrittura.
  assert.match(TUTTO, /function contatoriChiamate\(d\) \{\s*let f = funzioniContate\(\);/);
  const doc = C.documentoChiamate({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.249', os: 'win', dati: C.oraVuota() });
  assert.deepEqual(Object.keys(doc), [...C.CAMPI_CHIAMATE]);
  assert.equal(C.idDocumento(doc), `${'a'.repeat(20)}_2026-10-15_09`, 'lo stesso id della sua ora');
  assert.ok(!/primo/.test(CHIAMATE), 'il segno del primo documento è dell’ora');
});

test('le chiamate: ogni misura si chiude sulle funzioni con la forma dell’app, e il documento più carico passa', () => {
  assert.deepEqual(Object.keys(MC).sort(), [...C.MISURE_CHIAMATE].sort());
  for (const c of C.MISURE_CHIAMATE) {
    assert.equal(MC[c].chiavi, FUNZIONI_REGOLE, `${c} si chiude sulle funzioni`);
    assert.equal(MC[c].valori, unite(c === 'chiamate' ? F.CHIAMATE_FORMA : F.MODELLI[c]), `forma dei valori di ${c}`);
  }
  // Ogni resto dell'app entra nella forma delle regole.
  for (const c of C.MISURE_MODELLI) for (const r of C.RESTI[c]) assert.ok(new RegExp(MC[c].valori).test(`a/b|${r}|1`), `${c}: «${r}»`);

  // Per ogni funzione ogni resto, col modello più lungo che l'app lascia uscire: oltre il tetto dell'ora diventa «altro».
  const ora = C.oraVuota();
  const lunghissimo = (i) => `${'m'.repeat(60)}/${'x'.repeat(56)}${String(i % 1000).padStart(3, '0')}`;
  assert.equal(C.modelloPulito(lunghissimo(1)), lunghissimo(1));
  let k = 0;
  for (const f of C.funzioni()) {
    for (const c of C.MISURE_MODELLI) {
      ora[c][f] = {};
      for (const r of [...C.RESTI[c]].sort((a, b) => b.length - a.length)) {
        ora[c][f][`${lunghissimo(k++)}|${r}`] = 999999999;
        ora[c][f][`altro|${r}`] = 999999999;
      }
    }
    for (const n of [1, 2, 4, 9, 40]) { C.registraChiamate(ora, f, n); ora.chiamate[f] = Object.fromEntries(Object.keys(ora.chiamate[f]).map((x) => [x, 999999999])); }
  }
  const doc = C.documentoChiamate({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T23', app: '9999.9999.999999', os: 'win', dati: ora });
  assert.equal(C.validaChiamate(doc).ok, true, C.validaChiamate(doc).motivo);
  assert.equal(passa(doc, MC), '', 'le chiamate più cariche dell’app devono passare le regole');
  for (const c of C.MISURE_MODELLI) {
    const voci = Object.values(doc[c]).flatMap((v) => C.leggiModelli(c, v));
    assert.equal(voci.filter((x) => x.modello !== 'altro').length, C.TETTO_MODELLI_ORA, `${c}: le voci col modello si fermano al tetto`);
    assert.equal(voci.filter((x) => x.modello === 'altro').length, C.funzioni().length * C.RESTI[c].length, `${c}: il resto finisce in «altro»`);
  }
  const totale = Object.values(MC).reduce((a, r) => a + r.tetto, 0);
  assert.ok(totale <= 1000000, `i tetti delle chiamate sommano ${totale}: oltre, un documento passerebbe il limite di Firestore (1 MiB)`);
  assert.ok(JSON.stringify(doc).length < 1000000);

  const vuoto = C.documentoChiamate({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T00', app: '0.2.249', os: 'win', dati: C.oraVuota() });
  assert.equal(passa(vuoto, MC), '');
  assert.equal(C.senzaChiamate(vuoto), true, 'un’ora senza chiamate non ha il secondo documento');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v }, MC);
  assert.notEqual(manomesso('contesto', { 'filo-chat': 'deepseek/v4|t2k|1;come stai oggi|t2k|1' }), '');
  assert.notEqual(manomesso('uscita', { 'filo-chat': 'deepseek/v4|o1k|finito bene|1' }), '');
  assert.notEqual(manomesso('spesa', { 'filo-chat': 'deepseek/v4|regalo|1' }), '');
  assert.notEqual(manomesso('spesa', { 'filo-chat': 'deepseek/v4|router|1.5' }), '', 'la spesa esce intera');
  assert.notEqual(manomesso('cache', { 'appunti di mario': 'deepseek/v4|q25|1' }), '', 'una chiave fuori dalle funzioni');
  assert.notEqual(manomesso('chiamate', { 'filo-chat': '1,2,3' }), '');
  assert.notEqual(manomesso('ragionamento', { 'filo-chat': { n: 1 } }), '');
});

test('le due funzioni di controllo delle mappe sono quelle che si credono', () => {
  assert.equal(corpo('chiuse'), "m is map && m.keys().hasOnly(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches(valori)");
  assert.equal(corpo('aForma'), "m is map && m.keys().join('#').size() <= tettoChiavi && m.keys().join('#').matches(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches(valori)");
});
