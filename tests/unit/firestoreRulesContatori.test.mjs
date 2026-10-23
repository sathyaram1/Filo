// Sentinella sulle regole dei contatori anonimi (#969, #1461, #1463, #1464, #1466, #1469, #1471): collezioni a sola creazione,
// lette solo dall'admin, nella forma che l'app costruisce: ore (v3, più v2 e giorni v1 delle copie vecchie), la loro chat (v4),
// chiamate, navigazione e gesti di un'ora; e gli elenchi della navigazione uguali al codice che li possiede. Il motore vero: contatoriRegole.motore-vero.mjs.

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

for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'actionTools',
  'chatArchive', 'disposizioneIcone', 'carteHome', 'themeTokens', 'tabColor', 'contatoriGiornalieri']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const F = C.FORME;
const T = C.TETTI;

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
const BG = blocco(C.COLLEZIONE_GESTI);
const BN = blocco(C.COLLEZIONE_NAVIGAZIONE);
// Le funzioni che le ore e le loro chiamate condividono stanno fra l'intestazione dei contatori e il blocco delle ore.
const CONDIVISE = (() => {
  const a = RULES.indexOf('    // ── I contatori anonimi');
  const b = RULES.indexOf(`    match /${C.COLLEZIONE}/{`);
  assert.ok(a >= 0 && b > a, 'le funzioni condivise dei contatori stanno prima del blocco delle ore');
  return senzaCommenti(RULES.slice(a, b));
})();
const TUTTO = [CONDIVISE, B, BC, BG, BN].join('\n');

// Il corpo di una funzione delle regole, coi `let` già sostituiti dove sono usati: la rilettura vede quello che si valuta.
function corpo(nome) {
  const m = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{\\s*((?:let [^;]+;\\s*)*)return([\\s\\S]*?);\\s*\\}`).exec(TUTTO);
  assert.ok(m, `manca la funzione ${nome} nelle regole`);
  let testo = m[2];
  // Fuori dalle stringhe: la «f» delle chiamate starebbe anche dentro «[0-9a-f]».
  for (const [, n, v] of m[1].matchAll(/let (\w+) = ([^;]*);/g)) {
    testo = testo.split(/('[^']*')/).map((p, i) => (i % 2 ? p : p.replace(new RegExp(`\\b${n}\\b`, 'g'), v.trim()))).join('');
  }
  return testo.replace(/\s+/g, ' ').trim();
}
const GIORNO = corpo('contatoriGiorno');
const ORA = corpo('contatoriOra');
const CHIAMATE = corpo('contatoriChiamate');
const ORA3 = corpo('contatoriOra3');
const TESTA = corpo('testaOra');
const MISURE_ORA = corpo('misureOra');
const GESTI = corpo('contatoriGesti');
const NAVIGAZIONE = corpo('contatoriNavigazione');
const CHAT = corpo('contatoriChat');

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

// Le misure dell'ora come le controllano le regole: chiuse(d.x, elenco, tetto, valori) o aForma(d.x, chiavi, tettoChiavi,
// tetto, valori); il sistema (#1466), una stringa sola, è controllato a parte nell'ora v3.
function misureChiuse(testo) {
  const out = {};
  for (const m of testo.matchAll(/chiuse\(d\.(\w+), (funzioniContate\(\)|f|\[[^\]]*\]), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { chiavi: ['funzioniContate()', 'f'].includes(m[2]) ? FUNZIONI_REGOLE : stringhe(m[2]), tetto: Number(m[3]), valori: m[4] };
  }
  return out;
}
function misureDelleRegole(testo) {
  const out = misureChiuse(testo);
  for (const m of testo.matchAll(/aForma\(d\.(\w+), '([^']+)', (\d+), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { formaChiavi: m[2], tettoChiavi: Number(m[3]), tetto: Number(m[4]), valori: m[5] };
  }
  const pv = /d\.primeVolte is list && d\.primeVolte\.size\(\) <= (\d+) && d\.primeVolte\.join\('#'\)\.size\(\) <= (\d+) && d\.primeVolte\.join\('#'\)\.matches\('([^']+)'\)/.exec(testo);
  if (pv) out.primeVolte = { lista: true, quante: Number(pv[1]), tetto: Number(pv[2]), valori: pv[3] };
  return out;
}
const MO = misureDelleRegole(MISURE_ORA);
const MC = misureChiuse(CHIAMATE);
const sis = /d\.sistema is string && d\.sistema\.size\(\) <= (\d+) && d\.sistema\.matches\('([^']+)'\)$/.exec(ORA3);
assert.ok(sis, 'manca il controllo del sistema nell’ora v3');
const MS = { sistema: { stringa: true, tetto: Number(sis[1]), valori: sis[2] } };
const M = { ...MO, ...MS };

// Le regole applicate a un documento, come le applica il server a una stringa unita.
function passa(doc, misure = M) {
  for (const [campo, r] of Object.entries(misure)) {
    const v = doc[campo];
    if (r.stringa) {
      if (typeof v !== 'string' || v.length > r.tetto || !new RegExp(r.valori).test(v)) return `${campo}`;
      continue;
    }
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
  assert.equal(per('create')[0].cond, 'contatori(request.resource.data)');
  // La forma si sceglie dalla versione: provarle tutte in fila passerebbe il tetto di mille espressioni a richiesta.
  assert.equal(corpo('contatori'), '(d.v == 3 && contatoriOra3(d)) || (d.v == 2 && contatoriOra(d)) || (d.v == 4 && contatoriChat(d)) || (d.v == 1 && contatoriGiorno(d))');
});

test('i campi dell’ora sono quelli che l’app costruisce, tutti obbligatori; le ore v2 e i giorni di prima tengono la loro forma', () => {
  assert.deepEqual(elencoDopo(ORA3, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI]);
  assert.deepEqual(elencoDopo(ORA3, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI]);
  assert.deepEqual(elencoDopo(ORA, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_ORA_V2]);
  assert.deepEqual(elencoDopo(ORA, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_ORA_V2]);
  // Le due ore controllano la stessa testa e le stesse misure di #1461; solo la v3 quelle del sistema.
  assert.match(ORA, /&& d\.v == 2 && testaOra\(d\) && misureOra\(d\)$/);
  assert.match(ORA3, /&& d\.v == 3 && testaOra\(d\) && misureOra\(d\) && d\.sistema is string/);
  assert.deepEqual(elencoDopo(GIORNO, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_GIORNO]);
  assert.deepEqual(elencoDopo(GIORNO, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_GIORNO]);
  assert.equal(Number(/d\.v == (\d+)/.exec(ORA3)[1]), C.VERSIONE);
  assert.equal(Number(/d\.v == (\d+)/.exec(ORA)[1]), 2);
  assert.equal(Number(/d\.v == (\d+)/.exec(GIORNO)[1]), C.VERSIONE_GIORNO);
  const ora = C.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.243', os: 'win', dati: C.oraVuota() });
  assert.deepEqual(Object.keys(ora), [...C.CAMPI]);
  const giorno = C.documentoGiorno({ pseudonimo: 'a'.repeat(20), giorno: '2026-10-15', app: '0.2.243', os: 'win', dati: {} });
  assert.deepEqual(Object.keys(giorno), [...C.CAMPI_GIORNO]);
  assert.deepEqual(Object.keys(MO).sort(), [...C.MISURE_ORA].sort(), 'ogni misura ha il suo controllo nelle regole, e nessuna in più');

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
  // Il sistema (#1466): la forma delle regole è quella dell'app, e ogni percorso viene dagli elenchi chiusi.
  assert.equal(M.sistema.valori, F.SISTEMA_FORMA);
  assert.ok(M.sistema.tetto >= T.TETTO_CARATTERI_SISTEMA, 'il tetto del sistema nelle regole è sotto quello dell’app');
  const voce = new RegExp(F.SISTEMA_FORMA);
  for (const m of C.MISURE_SISTEMA) {
    const giu = (nodo, base) => {
      for (const [k, figlio] of Object.entries(nodo)) {
        if (figlio) giu(figlio, `${base}.${k}`);
        else assert.ok(voce.test(`${base}.${k}|1`), `${base}.${k} non passerebbe le regole`);
      }
    };
    giu(C.SCHEMA_SISTEMA[m], m);
  }
  for (const k of ['mario rossi', 'https://x.it/a', 'relazione finale.docx', '<script>', 'ciao, come stai', 'settings.apiKeys',
    'processoMorto.gpu.C:/Users/mario', 'eccezioneMain.uncaught.Cannot read', 'storageEsito.settings']) {
    assert.ok(!voce.test(`${k}|1`), `sistema: «${k}» passerebbe le regole`);
  }

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
  // Il sistema (#1466), ogni voce di ogni elenco.
  for (const p of C.PASSI_AVVIO) for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraPassoAvvio(ora, p, ms);
  for (const t of C.TIPI_AVVIO) C.registraTipoAvvio(ora, t);
  for (const t of C.TIPI_PROCESSO) for (const m of C.MOTIVI_CRASH) C.registraProcessoMorto(ora, t, m);
  C.registraFinestraBloccata(ora, 'volte');
  for (const cosa of ['tornata', 'chiusa_da_utente']) for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraFinestraBloccata(ora, cosa, ms);
  for (const ms of [10, 300, 2000, 60000]) C.registraMainFermo(ora, ms);
  for (const o of C.ORIGINI_ECCEZIONE) for (const n of C.NOMI_ECCEZIONE) C.registraEccezione(ora, o, { name: n });
  for (const [mb, n] of [[100, 0], [400, 1], [800, 3], [1500, 10], [3000, 40], [9000, 99]]) C.registraMemoria(ora, { mb, vive: n, attesa: n });
  for (const c of C.CANALI_SINCRONI) for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraIpcSincrono(ora, c, ms);
  for (const ms of [100, 900, 1500, 4000, 9000, 20000, 99999]) C.registraChiusura(ora, { ms, tetto: true });
  for (const e of C.ESITI_USCITA) C.registraUscita(ora, e);
  for (const e of C.EVENTI_STORAGE) C.registraStorage(ora, e);
  for (const [schede, ms] of [[0, 100], [1, 900], [4, 1500], [19, 4000], [49, 9000], [400, 20000], [2, 99999]]) {
    C.registraSessione(ora, { esito: 'ripristinata', schede, vistaMs: ms, codaMs: ms });
  }
  C.registraSessione(ora, { esito: 'niente' }); C.registraSessione(ora, { esito: 'lettura_fallita' });
  for (const e of C.EVENTI_AGGIORNAMENTO) C.registraAggiornamento(ora, e);
  const gonfia = (o) => { for (const k of Object.keys(o)) { if (Number.isInteger(o[k]) && k !== 'maxMs') o[k] = 999999999; else if (o[k] && typeof o[k] === 'object') gonfia(o[k]); } };
  gonfia(ora);

  const doc = C.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T23', app: '9999.9999.999999', os: 'win', dati: ora });
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
  assert.equal(passa(doc), '', 'il documento più carico dell’app deve passare le regole');
  const letto = C.leggiSistema(doc.sistema);
  for (const campo of C.MISURE_SISTEMA) assert.ok(Object.keys(letto[campo]).length, `${campo} è pieno nel documento più carico`);
  assert.ok(doc.sistema.length <= T.TETTO_CARATTERI_SISTEMA, `il sistema più carico è lungo ${doc.sistema.length}`);
  // Un'ora v2 di una copia vecchia passa ancora le misure di #1461.
  const v2 = Object.fromEntries(Object.entries(doc).filter(([k]) => C.CAMPI_ORA_V2.includes(k)));
  assert.equal(passa(v2, MO), '');
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
  // Il sistema: un percorso, un messaggio o una chiave dello storage non passano, né come voce né come conto.
  assert.notEqual(manomesso('sistema', 'processoMorto.gpu.crashed|1;C:\\Users\\mario\\x.dmp|1'), '');
  assert.notEqual(manomesso('sistema', 'eccezioneMain.uncaught.Cannot read properties|1'), '');
  assert.notEqual(manomesso('sistema', 'storageEsito.settings.apiKeys|1'), '');
  assert.notEqual(manomesso('sistema', 'avvioPasso.adblock.ms500|1 lento'), '');
  assert.notEqual(manomesso('sistema', { avvioPasso: 'adblock' }), '', 'una mappa al posto della stringa');
  assert.notEqual(manomesso('sistema', 'aggiornamento.trovato|1;'.repeat(2000)), '', 'oltre il tetto');
});

test('pseudonimo, giorno, ora, versione e sistema hanno la forma dell’app, e l’id dice pseudonimo, giorno e ora', () => {
  for (const testo of [GIORNO, TESTA, CHAT, CHIAMATE, GESTI, NAVIGAZIONE]) {
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
  for (const testo of [TESTA, CHIAMATE, GESTI, NAVIGAZIONE]) {
    assert.match(testo, /docId == d\.pseudonimo \+ '_' \+ d\.giorno \+ '_' \+ d\.ora/);
    const ora = /d\.ora is string && d\.ora\.matches\('([^']+)'\)/.exec(testo);
    assert.ok(ora);
    for (let h = 0; h < 24; h++) assert.ok(new RegExp(ora[1]).test(String(h).padStart(2, '0')));
    for (const no of ['24', '7', 'T07', '07 ']) assert.ok(!new RegExp(ora[1]).test(no));
  }
  // Il segno del primo documento è di un elenco chiuso: è quello che l'owner legge per contare le copie.
  const primo = /d\.primo in \[([^\]]*)\]/.exec(TESTA);
  assert.ok(primo, 'manca l’elenco dei segni del primo documento');
  assert.deepEqual(stringhe(primo[1]), [...C.PRIMI]);
  const doc = C.documento({ pseudonimo: 'b'.repeat(20), chiave: '2026-10-15T07', app: '0.2.243', os: 'mac', dati: C.oraVuota() });
  assert.equal(C.idDocumento(doc), `${'b'.repeat(20)}_2026-10-15_07`);
  assert.equal(C.idDocumento({ ...doc, v: 2 }), `${'b'.repeat(20)}_2026-10-15_07`, 'un’ora v2 resta un’ora');
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

test('nessuna espressione regolare del blocco passa i 4096 caratteri che le regole accettano', () => {
  const lunghe = [...B.matchAll(/'(\^[^']*)'/g)].map((m) => m[1].length).filter((n) => n > 4096);
  assert.deepEqual(lunghe, [], 'una forma oltre i 4096 caratteri: le regole non si pubblicano');
});

// ── La navigazione di un'ora (#1469) ─────────────────────────────────────
const CODICI_REGOLE = (() => {
  const m = /let codici = \[([^\]]*)\];/.exec(BN);
  assert.ok(m, 'manca l’elenco dei codici di rete nelle regole della navigazione');
  return stringhe(m[1]);
})();
const MN = (() => {
  const out = {};
  for (const m of NAVIGAZIONE.matchAll(/chiuse\(d\.(\w+), (codici|\[[^\]]*\]), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { chiavi: m[2] === 'codici' ? CODICI_REGOLE : stringhe(m[2]), tetto: Number(m[3]), valori: m[4] };
  }
  return out;
})();

test('la navigazione: sola creazione, letta dall’admin, coi campi e la versione dell’app', () => {
  const RN = regole(BN);
  assert.deepEqual(per('get', RN).map((r) => r.cond), ['isAdmin()']);
  assert.deepEqual(per('list', RN).map((r) => r.cond), ['isAdmin()']);
  assert.ok(!per('read', RN).length && !per('write', RN).length);
  for (const v of ['update', 'delete']) assert.ok(per(v, RN).length >= 1 && per(v, RN).every((r) => r.cond === 'false'));
  assert.deepEqual(per('create', RN).map((r) => r.cond), ['contatoriNavigazione(request.resource.data)']);
  assert.deepEqual(elencoDopo(NAVIGAZIONE, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_NAVIGAZIONE]);
  assert.deepEqual(elencoDopo(NAVIGAZIONE, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_NAVIGAZIONE]);
  assert.equal(Number(/d\.v == (\d+)/.exec(NAVIGAZIONE)[1]), C.VERSIONE_NAVIGAZIONE);
  const doc = C.documentoNavigazione({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.249', os: 'win', dati: C.oraVuota() });
  assert.deepEqual(Object.keys(doc), [...C.CAMPI_NAVIGAZIONE]);
  assert.equal(C.idDocumento(doc), `${'a'.repeat(20)}_2026-10-15_09`, 'lo stesso id della sua ora');
  assert.ok(!/primo/.test(NAVIGAZIONE), 'il segno del primo documento è dell’ora');
});

test('la navigazione: ogni misura ha le chiavi, il tetto e la forma dell’app, e il documento più carico passa', () => {
  assert.deepEqual(Object.keys(MN).sort(), [...C.MISURE_NAVIGAZIONE].sort(), 'ogni misura ha il suo controllo, e nessuna in più');
  for (const c of C.MISURE_NAVIGAZIONE) {
    assert.deepEqual(MN[c].chiavi, [...C.NAVIGAZIONE[c].chiavi], `${c}: le chiavi delle regole sono quelle dell’app`);
    assert.equal(MN[c].tetto, C.TETTI.NAVIGAZIONE[c], `${c}: il tetto`);
    assert.equal(MN[c].valori, unite(C.FORME.NAVIGAZIONE[c]), `${c}: la forma dei valori`);
  }
  const ora = C.oraVuota();
  for (const c of C.MISURE_NAVIGAZIONE) {
    const n = C.NAVIGAZIONE[c].gruppi.reduce((a, g) => a + g.length, 0);
    for (const k of C.NAVIGAZIONE[c].chiavi) ora[c][k] = Array(n).fill(999999999);
  }
  const doc = C.documentoNavigazione({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T23', app: '9999.9999.999999', os: 'linux', dati: ora });
  assert.equal(C.validaNavigazione(doc).ok, true, C.validaNavigazione(doc).motivo);
  assert.equal(passa(doc, MN), '', 'la navigazione più carica dell’app deve passare le regole');
  assert.ok(JSON.stringify(doc).length < 1000000);
  const vuoto = C.documentoNavigazione({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T00', app: '0.2.249', os: 'win', dati: C.oraVuota() });
  assert.equal(passa(vuoto, MN), '');
  assert.equal(C.senzaNavigazione(vuoto), true, 'un’ora senza navigazione non ha il terzo documento');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v }, MN);
  assert.notEqual(manomesso('navFallite', { 'mario.rossi.it': '1,0' }), '', 'un dominio come chiave');
  assert.notEqual(manomesso('navFallite', { '-105': '1,0 https://mario.it' }), '', 'un indirizzo dentro il valore');
  assert.notEqual(manomesso('scaricamenti', { 'relazione finale.docx': '1,0,0,0,0;1,0,0,0,0,0' }), '', 'un nome di file come chiave');
  assert.notEqual(manomesso('riquadri', { 'instagram-accesso.xyz': '1,0,0,0,0,0,0,0,0,0,0' }), '', 'un sito fuori dai servizi');
  assert.notEqual(manomesso('geoProxy', { 'it|datacenter': '1,0' }), '', 'un paese fuori elenco ha la sua riga «altro»');
  assert.notEqual(manomesso('liste', { adblock: '1,0,0,0;1,0,0,0,0,0' }), '', 'un gruppo che manca');
  assert.notEqual(manomesso('programmi', { programma: { n: 1 } }), '', 'una mappa al posto della stringa');
});

test('gli elenchi della navigazione sono la copia di quelli del codice: cambiarne uno da solo fa rosso', () => {
  const S = (...p) => require(join(ROOT, 'src', 'main', 'services', ...p));
  const ordina = (l) => [...l].sort();
  require(join(ROOT, 'src', 'shared', 'netError.js'));
  assert.deepEqual(ordina(globalThis.SN_NET_ERROR.CODICI), ordina(C.CODICI_RETE), 'i codici con un messaggio di netError.js');
  assert.deepEqual(ordina(Object.values(S('geoBlock.js').SOURCES)), ordina(C.FONTI_GEO), 'le fonti del blocco per paese');
  const classi = Object.values(S('geoBlockClassifier.js').CLASSES);
  assert.deepEqual(ordina([...classi, 'saltato_budget', 'no_model']), ordina(C.CLASSI_GEO), 'le classi del modello e i due salti');
  const sorgente = readFileSync(join(ROOT, 'src', 'main', 'services', 'geoBlockClassifier.js'), 'utf8');
  assert.match(sorgente, /reason: 'budget'/, 'il salto per il tetto che classeGeo riconosce');
  assert.match(sorgente, /error: 'no_model'/, 'il salto senza modello che classeGeo riconosce');
  const Rg = S('geoBlockRules.js');
  const motivi = new Set();
  for (const flaggedDangerous of [true, false]) for (const hasLoginCookies of [true, false]) for (const proxyConfigured of [true, false]) {
    for (const stage of [undefined, ...Object.values(Rg.STAGES)]) motivi.add(Rg.decideGeoAction({ flaggedDangerous, hasLoginCookies, proxyConfigured, stage }).reason);
  }
  assert.deepEqual(ordina(motivi), ordina(C.MOTIVI_GEO), 'i motivi delle decisioni sul blocco per paese');
  const P = S('proxyTab.js');
  assert.deepEqual(P.LOCATIONS.map((l) => l.code), [...C.PAESI_PROXY], 'i paesi della scelta «Apri da un altro paese»');
  assert.deepEqual(ordina(Object.values(P.TIERS)), ordina(C.TIER_PROXY));
  const servizi = S('riquadriRottiRegole.js').SERVIZI;
  assert.ok(servizi.every((s) => typeof s.id === 'string' && /^[a-z0-9-]{1,30}$/.test(s.id)), 'ogni servizio ha il suo id');
  assert.deepEqual(servizi.map((s) => s.id), [...C.SERVIZI_RIQUADRO], 'i servizi dei riquadri rotti');
  // E le regole tengono gli stessi elenchi dell'app: le chiavi delle misure sopra lo confrontano voce per voce.
  assert.deepEqual(CODICI_REGOLE, [...C.CODICI_RETE, 'altro']);
});

test('le due funzioni di controllo delle mappe sono quelle che si credono', () => {
  assert.equal(corpo('chiuse'), "m is map && m.keys().hasOnly(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches(valori)");
  assert.equal(corpo('aForma'), "m is map && m.keys().join('#').size() <= tettoChiavi && m.keys().join('#').matches(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches(valori)");
});

// ── I gesti della personalizzazione di un'ora (#1471) ─────────────────────
function misureGesti(testo) {
  const out = misureChiuse(testo);
  for (const m of testo.matchAll(/aForma\(d\.(\w+), '([^']+)', (\d+), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { formaChiavi: m[2], tettoChiavi: Number(m[3]), tetto: Number(m[4]), valori: m[5] };
  }
  return out;
}
const MG = misureGesti(GESTI);

// L'ora più carica: ogni voce di ogni chiave di ogni misura, ai conti più alti.
function gestiPieni() {
  const ora = C.oraVuota();
  for (const c of C.MISURE_GESTI) {
    if (c === 'barra_aperta') {
      for (const m of C.MOTIVI_BARRA) {
        ora[c][m] = Object.fromEntries(C.ESITI_BARRA.map((e) => [e, { n: 999999999, fasce: Object.fromEntries(C.NOMI_FASCE.map((f) => [f, 142857142])) }]));
      }
    } else if (c === 'disposizione_di_serie') ora[c] = { primary: 'no', secondary: 'no', bar: 'no' };
    else for (const k of C.chiaviGesto(c)) ora[c][k] = Object.fromEntries(C.vociGesto(c, k).map((v) => [v, 999999999]));
  }
  return C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T23', app: '9999.9999.999999', os: 'win', dati: ora });
}

test('i gesti: sola creazione, letti dall’admin, coi campi e la versione dell’app e lo stesso id dell’ora', () => {
  const RG = regole(BG);
  assert.deepEqual(per('get', RG).map((r) => r.cond), ['isAdmin()']);
  assert.deepEqual(per('list', RG).map((r) => r.cond), ['isAdmin()']);
  assert.ok(!per('read', RG).length && !per('write', RG).length);
  for (const v of ['update', 'delete']) assert.ok(per(v, RG).length >= 1 && per(v, RG).every((r) => r.cond === 'false'));
  assert.deepEqual(per('create', RG).map((r) => r.cond), ['contatoriGesti(request.resource.data)']);
  assert.deepEqual(elencoDopo(GESTI, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_GESTI]);
  assert.deepEqual(elencoDopo(GESTI, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_GESTI]);
  assert.equal(Number(/d\.v == (\d+)/.exec(GESTI)[1]), C.VERSIONE_GESTI);
  const doc = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.249', os: 'win', dati: C.oraVuota() });
  assert.deepEqual(Object.keys(doc), [...C.CAMPI_GESTI]);
  assert.equal(C.idDocumento(doc), `${'a'.repeat(20)}_2026-10-15_09`, 'lo stesso id della sua ora');
  assert.equal(C.senzaGesti(doc), true, 'un’ora senza gesti non ha il terzo documento');
});

test('i gesti: chiavi e valori di ogni misura hanno la forma dell’app, e il documento più carico passa', () => {
  assert.deepEqual(Object.keys(MG).sort(), [...C.MISURE_GESTI].sort(), 'ogni misura ha il suo controllo, e nessuna in più');
  for (const c of C.MISURE_GESTI) {
    const chiavi = C.CHIAVI_GESTI[c];
    if (Array.isArray(chiavi)) assert.deepEqual(MG[c].chiavi, [...chiavi], `${c}: le chiavi chiuse sono l’elenco dell’app`);
    else assert.equal(MG[c].formaChiavi, unite(chiavi), `${c}: la forma delle chiavi è quella dell’app`);
    assert.equal(MG[c].valori, unite(C.FORME_GESTI[c]), `forma dei valori di ${c}`);
    // Ogni chiave che l'app può scrivere entra nella forma delle regole.
    if (!Array.isArray(chiavi)) for (const k of C.chiaviGesto(c)) assert.match(k, new RegExp(chiavi), `${c}: «${k}»`);
  }
  const doc = gestiPieni();
  assert.equal(C.validaGesti(doc).ok, true, C.validaGesti(doc).motivo);
  assert.equal(passa(doc, MG), '', 'i gesti più carichi dell’app devono passare le regole');
  const totale = Object.values(MG).reduce((a, r) => a + r.tetto + (r.tettoChiavi || 0), 0);
  assert.ok(totale <= 1000000, `i tetti dei gesti sommano ${totale}: oltre, un documento passerebbe il limite di Firestore (1 MiB)`);
  assert.ok(JSON.stringify(doc).length < 1000000);
  const vuoto = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T00', app: '0.2.249', os: 'win', dati: C.oraVuota() });
  assert.equal(passa(vuoto, MG), '');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v }, MG);
  assert.notEqual(manomesso('trascinamento', { carta_home: 'chat_home|posato|1;Ciao Mario, ecco il file|1' }), '');
  assert.notEqual(manomesso('trascinamento', { 'appunti di mario': 'chat_home|posato|1' }), '', 'un’origine fuori elenco');
  assert.notEqual(manomesso('icona_spostata', { 'mario rossi': 'bar|primary|trascina|1' }), '', 'una chiave con uno spazio');
  assert.notEqual(manomesso('carta_home', { editor: 'spostata in alto|1' }), '');
  assert.notEqual(manomesso('ripristino', { token: 'rosso fuoco|1' }), '', 'il valore di un token non esce');
  assert.notEqual(manomesso('annulla_cambio', { 'https://mario.it': 'chat|m1|1' }), '', 'un indirizzo come chiave');
  assert.notEqual(manomesso('modulo_editor', { griglia: '20|30|1' }), '', 'una griglia fuori dai numeri chiusi');
  assert.notEqual(manomesso('disposizione_di_serie', { bar: 'forse' }), '');
  assert.notEqual(manomesso('barra_aperta', { spinta: { n: 1 } }), '', 'una mappa al posto della stringa non si unisce');
  for (const k of ['mario rossi', 'https://x.it/a', 'relazione finale.docx', '<script>', 'ciao, come stai']) {
    for (const c of C.MISURE_GESTI.filter((x) => !Array.isArray(C.CHIAVI_GESTI[x]))) {
      assert.ok(!new RegExp(C.CHIAVI_GESTI[c]).test(k), `${c}: «${k}» passerebbe le regole`);
    }
  }
});

test('le funzioni di controllo delle mappe stanno fra quelle comuni: ore, chiamate e gesti le usano tutte', () => {
  assert.match(CONDIVISE, /function chiuse\(/);
  assert.match(CONDIVISE, /function aForma\(/);
  assert.equal((TUTTO.match(/function aForma\(/g) || []).length, 1, 'una regola sola, in un posto');
});

// ── La chat dell'ora (#1463) ────────────────────────────────────────────────
// Nell'ora le regole non hanno più posto: il motore valuta al più mille espressioni per scrittura, e l'ora ne usa quasi
// tutte. La chat ha il suo documento, coi suoi elenchi chiusi e le sue forme, tutte uguali a quelle dell'app.
function misureDellaChat() {
  const out = {};
  for (const m of CHAT.matchAll(/chiuse\(d\.(\w+), (\[[^\]]*\]), (\d+), '([^']+)'\)/g)) {
    out[m[1]] = { chiavi: stringhe(m[2]), tetto: Number(m[3]), valori: m[4] };
  }
  return out;
}
const MCHAT = misureDellaChat();
const formaChat = {
  chatTurni: F.TURNI_FORMA, chatRecuperi: F.CONTO_FORMA, strumenti: F.STRUMENTI_FORMA, azioniPerGiro: F.AZIONI_PER_GIRO_FORMA,
  chatReazioni: F.CONTO_FORMA, chatCopie: F.CONTO_FORMA, chatChiuse: F.CHIUSE_FORMA,
};
const chiaviChat = {
  chatTurni: C.AGENTI, strumenti: C.AGENTI, azioniPerGiro: C.AGENTI, chatRecuperi: C.RECUPERI, chatReazioni: C.REAZIONI,
  chatCopie: C.RUOLI_COPIA, chatChiuse: C.VIE_CHIUSURA,
};
function passaChat(doc) {
  for (const [campo, r] of Object.entries(MCHAT)) {
    const v = doc[campo];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${campo} non è una mappa`;
    if (!Object.keys(v).every((k) => r.chiavi.includes(k))) return `${campo}: chiave fuori elenco`;
    const valori = Object.values(v);
    if (!valori.every((x) => typeof x === 'string' || Number.isInteger(x))) return `${campo}: un valore non si unisce`;
    if (valori.join('#').length > r.tetto || !new RegExp(r.valori).test(valori.join('#'))) return `${campo}: valori fuori forma`;
  }
  return '';
}

test('la chat dell’ora ha i campi, le chiavi chiuse e le forme dell’app, e l’id dell’ora con «_chat»', () => {
  assert.deepEqual(elencoDopo(CHAT, 'd\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI_CHAT]);
  assert.deepEqual(elencoDopo(CHAT, 'd\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI_CHAT]);
  assert.equal(Number(/d\.v == (\d+)/.exec(CHAT)[1]), C.VERSIONE_CHAT);
  assert.match(CHAT, /docId == d\.pseudonimo \+ '_' \+ d\.giorno \+ '_' \+ d\.ora \+ '_chat'/);
  assert.ok(new Set([C.VERSIONE, C.VERSIONE_GIORNO, C.VERSIONE_CHAT]).size === 3);
  assert.deepEqual(Object.keys(MCHAT).sort(), [...C.MISURE_CHAT].sort(), 'ogni misura della chat ha il suo controllo, e nessuna in più');
  for (const campo of C.MISURE_CHAT) {
    assert.deepEqual(MCHAT[campo].chiavi, [...chiaviChat[campo]], `chiavi di ${campo}`);
    assert.equal(MCHAT[campo].valori, unite(formaChat[campo]), `forma dei valori di ${campo}`);
  }
  const ora = /d\.ora is string && d\.ora\.matches\('([^']+)'\)/.exec(CHAT);
  assert.ok(ora);
  for (let h = 0; h < 24; h++) assert.ok(new RegExp(ora[1]).test(String(h).padStart(2, '0')));
  const doc = C.documentoChat({ pseudonimo: 'b'.repeat(20), chiave: '2026-10-15T07', app: '0.2.243', os: 'mac', dati: C.oraVuota() });
  assert.deepEqual(Object.keys(doc), [...C.CAMPI_CHAT]);
  assert.equal(C.idDocumento(doc), `${'b'.repeat(20)}_2026-10-15_07_chat`);
  // Il tipo di una chat è quello dell'archivio, più «nessuno»; ogni strumento ha un nome che le regole accettano.
  assert.deepEqual([...C.TIPI_CHAT], [...globalThis.SN_CHAT_ARCHIVE.KINDS, C.SENZA_TIPO]);
  const nomi = globalThis.SN_ACTION_TOOLS.NAMES;
  assert.ok(nomi.length >= 50);
  assert.deepEqual(nomi.filter((n) => !new RegExp(F.NOME_STRUMENTO_FORMA).test(n)), []);
  assert.deepEqual(C.strumenti(), [...nomi]);
});

test('la chat più carica che l’app sa fare passa le regole, e una manomessa no', () => {
  const dati = C.oraVuota();
  for (const f of C.AGENTI) {
    for (const esito of C.ESITI_TURNO) for (const giri of [1, 2, 3, 5, 9, 12, 40]) C.registraTurno(dati, f, { esito, giri });
    for (const nome of [...C.strumenti(), ...Array.from({ length: 80 }, (_, i) => `INVENTATO_${i}`)]) {
      for (const esito of C.ESITI_STRUMENTO) C.registraStrumento(dati, f, nome, esito, 999999999);
    }
    for (const n of [1, 2, 4, 30]) C.registraAzioniDelGiro(dati, f, n, 999999999);
  }
  for (const v of C.RECUPERI) for (let i = 0; i < 3; i++) C.registraRecupero(dati, v);
  for (const v of C.REAZIONI) C.registraReazione(dati, v);
  for (const r of C.RUOLI_COPIA) C.registraCopia(dati, r);
  for (const via of C.VIE_CHIUSURA) for (const messaggi of [1, 2, 4, 8, 50]) for (const durataMs of [0, 2e5, 6e5, 2e6, 1e9]) {
    for (const tipo of C.TIPI_CHAT) C.registraChatChiusa(dati, { via, messaggi, durataMs, tipo });
  }
  const gonfia = (o) => { for (const k of Object.keys(o)) { if (Number.isInteger(o[k])) o[k] = 999999999; else if (o[k] && typeof o[k] === 'object') gonfia(o[k]); } };
  gonfia(dati);
  const doc = C.documentoChat({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T23', app: '9999.9999.999999', os: 'win', dati });
  assert.equal(C.valida(doc).ok, true, C.valida(doc).motivo);
  assert.equal(passaChat(doc), '', 'la chat più carica dell’app deve passare le regole');
  assert.ok(JSON.stringify(doc).length < 200000);
  const vuota = C.documentoChat({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T00', app: '0.2.243', os: 'win', dati: C.oraVuota() });
  assert.equal(passaChat(vuota), '');
  const manomesso = (campo, v) => passaChat({ ...doc, [campo]: v });
  assert.notEqual(manomesso('strumenti', { 'filo-chat': 'cerca mario rossi|eseguito|1' }), '');
  assert.notEqual(manomesso('strumenti', { 'filo-chat': 'NAVIGA|https://x.it|1' }), '');
  assert.notEqual(manomesso('strumenti', { explain: 'NAVIGA|eseguito|1' }), '');
  assert.notEqual(manomesso('chatTurni', { 'filo-chat': 'risposta|g1|1 ciao' }), '');
  assert.notEqual(manomesso('chatChiuse', { home: 'm1|min1|chat con mario|1' }), '');
  assert.notEqual(manomesso('chatReazioni', { 'ferma perché sbagliava': '1' }), '');
  assert.notEqual(manomesso('chatCopie', { risposta: 'il testo copiato' }), '');
  assert.notEqual(manomesso('chatRecuperi', { sollecito: { n: 1, nota: 'ciao' } }), '', 'una mappa al posto della stringa non si unisce');
});
