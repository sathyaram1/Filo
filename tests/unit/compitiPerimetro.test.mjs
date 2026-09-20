// Unit test del perimetro delle uscite (#533): src/shared/compiti.js e
// src/shared/autonomia.js.
//
// Quello che qui deve restare rosso per sempre: uno strumento non dichiarato
// non passa nemmeno se il modello lo chiede; leggere di più non allarga
// niente; un permesso dato vale per un compito solo. E la sentinella: ogni
// strumento dell'agente ha una classe, altrimenti un potere nuovo entrerebbe
// nel perimetro per dimenticanza.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/autonomia.js');
require('../../src/shared/compiti.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');

const C = globalThis.SN_COMPITI;
const A = globalThis.SN_AUTONOMIA;
const Tools = globalThis.SN_ACTION_TOOLS;
const Levels = globalThis.SN_ACTION_LEVELS;

// Un compito da chat che ha dichiarato `uscite` e poi ha letto una pagina.
function contaminato(uscite) {
  const c = C.nuovo({});
  if (uscite) C.dichiara(c, uscite);
  C.registraLettura(c, { type: 'CERCA_WEB' });
  return c;
}

test('si registrano su globalThis con la loro API', () => {
  assert.ok(C, 'SN_COMPITI assente');
  assert.ok(A, 'SN_AUTONOMIA assente');
  for (const fn of ['nuovo', 'dichiara', 'allarga', 'registraLettura', 'consentito', 'strumentiPermessi']) {
    assert.equal(typeof C[fn], 'function', `manca ${fn}()`);
  }
});

test('sentinella: ogni strumento dell\'agente ha una classe, e viceversa', () => {
  const strumenti = Tools.NAMES.slice().sort();
  const classificati = Object.keys(C.CLASSI).sort();
  assert.deepEqual(classificati, strumenti, 'strumenti e classi divergono');
});

test('sentinella: ogni strumento ha anche un livello (le tre tabelle combaciano)', () => {
  assert.deepEqual(Object.keys(Levels.REGISTRY).sort(), Tools.NAMES.slice().sort());
});

test('uno strumento senza classe è un\'uscita che nessuno può dichiarare', () => {
  const k = C.classeDi('POTERE_NUOVO_MAI_CLASSIFICATO');
  assert.equal(k.classe, 'uscita');
  assert.ok(!C.USCITE_DICHIARABILI.includes(k.uscita), 'una famiglia inventata non deve essere dichiarabile');
  const c = contaminato(['sveglie']);
  assert.equal(C.consentito(c, 'POTERE_NUOVO_MAI_CLASSIFICATO').ok, false);
});

test('finché non ha letto niente di esterno il perimetro non morde', () => {
  const c = C.nuovo({});
  assert.equal(c.contaminato, false);
  for (const t of ['SALVA_LEZIONE', 'NAVIGA', 'ESEGUI_COMANDO']) {
    assert.equal(C.consentito(c, t).ok, true, `${t} bloccata prima di qualunque lettura`);
  }
});

test('uno strumento non dichiarato viene rifiutato anche se il modello lo chiede', () => {
  const c = contaminato(['sveglie']);
  assert.equal(C.consentito(c, 'SVEGLIA').ok, true, 'la sveglia era dichiarata');
  const v = C.consentito(c, 'SALVA_LEZIONE');
  assert.equal(v.ok, false);
  assert.equal(v.motivo, 'fuori-perimetro');
  assert.equal(v.uscita, 'memoria');
  assert.ok(v.etichetta.length > 0, 'il rifiuto deve poter essere detto all\'utente');
  // …e non è «sconsigliato»: non compare proprio nella lista che il motore accetta.
  assert.ok(!C.strumentiPermessi(c, Tools.NAMES).includes('SALVA_LEZIONE'));
});

test('chi legge senza aver dichiarato resta con «solo chat»: risponde e propone', () => {
  const c = contaminato(null);
  assert.deepEqual(c.perimetro, []);
  const ammessi = C.strumentiPermessi(c, Tools.NAMES);
  assert.ok(!ammessi.includes('NAVIGA'), 'un\'uscita non dichiarata non deve esistere per questo compito');
  assert.ok(ammessi.includes('EVENTO_CALENDARIO'), 'proporre costa zero: resta sempre');
  assert.ok(ammessi.includes('CERCA_WEB'), 'leggere resta sempre libero');
  // Dichiarare dopo aver letto non vale: l'elenco potrebbe venire dalla pagina.
  assert.equal(C.dichiara(c, ['memoria']).ok, false);
  assert.equal(C.consentito(c, 'SALVA_LEZIONE').ok, false);
});

test('una lettura in più non cambia il perimetro', () => {
  const c = contaminato(['sveglie']);
  const prima = c.perimetro.slice();
  C.registraLettura(c, { type: 'LEGGI_DOCUMENTO' });
  C.registraLettura(c, { type: 'CERCA_WEB' });
  C.registraLettura(c, { type: 'LEGGI_FILE' });
  assert.deepEqual(c.perimetro, prima, 'leggere di più non aggiunge poteri');
  assert.equal(C.consentito(c, 'SALVA_LEZIONE').ok, false);
});

test('gli ingressi restano liberi anche a compito contaminato', () => {
  const c = contaminato([]);
  for (const t of ['CERCA_WEB', 'LEGGI_DOCUMENTO', 'LEGGI_FILE', 'LEGGI_TRASPARENZA', 'CAPACITA_DETTAGLIO']) {
    assert.equal(C.consentito(c, t).ok, true, `${t} è un ingresso: non si dichiara`);
  }
});

test('l\'allargamento accettato vale per un compito solo', () => {
  const uno = contaminato(['sveglie']);
  const due = contaminato(['sveglie']);
  C.allarga(uno, 'memoria', 'me l\'ha chiesto l\'utente');
  assert.equal(C.consentito(uno, 'SALVA_LEZIONE').ok, true);
  assert.equal(C.consentito(due, 'SALVA_LEZIONE').ok, false, 'il permesso non deve passare a un altro compito');
  // E solo di QUELLA uscita: il resto resta fuori.
  assert.equal(C.consentito(uno, 'ESEGUI_COMANDO').ok, false);
});

test('la fonte peggiore letta è quella che resta', () => {
  const c = C.nuovo({});
  C.registraLettura(c, { type: 'LEGGI_TRASPARENZA' });
  assert.equal(c.fonte, 'filo');
  C.registraLettura(c, { type: 'LEGGI_FILE' });
  assert.equal(c.fonte, 'utente');
  C.registraLettura(c, { type: 'CERCA_WEB' });
  assert.equal(c.fonte, 'esterno');
  C.registraLettura(c, { type: 'LEGGI_TRASPARENZA' });
  assert.equal(c.fonte, 'esterno', 'una lettura fidata dopo non ripulisce il compito');
});

test('le uscite di nascita non chiudono il passo di dichiarazione', () => {
  const c = C.nuovo({ sempre: ['accoglienza'] });
  assert.equal(c.dichiarato, false, 'il modello deve poter ancora dichiarare');
  assert.equal(C.dichiara(c, ['sveglie']).ok, true);
  C.registraLettura(c, { type: 'CERCA_WEB' });
  assert.equal(C.consentito(c, 'ONBOARDING').ok, true, 'il permesso di nascita resta');
  assert.equal(C.consentito(c, 'SVEGLIA').ok, true);
  assert.equal(C.consentito(c, 'NAVIGA').ok, false);
});

test('dove il perimetro è fisso non c\'è CHIEDI_USCITA: a chiedere è il motore', () => {
  const pagina = C.nuovo({ dichiarazione: 'fissa', perimetro: ['segnalazioni'] });
  C.registraLettura(pagina, { type: 'PAGINA', fonte: 'esterno' });
  assert.equal(pagina.contaminato, true, 'l\'assistente di pagina nasce contaminato');
  assert.equal(C.consentito(pagina, 'INVIA_FEEDBACK').ok, true);
  const v = C.consentito(pagina, 'SALVA_LEZIONE');
  assert.equal(v.ok, false);
  assert.equal(v.puoChiedere, false, 'chi non ha il passo di dichiarazione non chiede da sé');
  assert.ok(!C.strumentiPermessi(pagina, Tools.NAMES).includes('CHIEDI_USCITA'));
});

test('una famiglia inventata non entra nel perimetro né dalla dichiarazione né dall\'allargamento', () => {
  const c = C.nuovo({});
  const r = C.dichiara(c, ['sveglie', 'accoglienza', 'inventata']);
  assert.deepEqual(r.perimetro, ['sveglie'], 'le interne e le inventate non si dichiarano');
  assert.deepEqual(r.ignorate.sort(), ['accoglienza', 'inventata']);
  assert.equal(C.allarga(c, 'inventata').ok, false);
});

test('il registro non taglia in silenzio: le righe in più si contano', () => {
  const c = C.nuovo({});
  for (let i = 0; i < C.MAX_RIGHE + 25; i++) C.registraAzione(c, { type: 'SVEGLIA', esito: 'fatta' });
  assert.equal(c.registro.length, C.MAX_RIGHE);
  assert.equal(c.omesse, 25, 'le righe non scritte devono restare contate');
});

test('la lista che il motore accetta è l\'unica cosa che il modello vede', () => {
  const c = contaminato(['sveglie']);
  const defs = Tools.definitions({ sistema: 'win32', compito: c }).map((d) => d.function.name);
  assert.ok(defs.includes('SVEGLIA'));
  assert.ok(defs.includes('CERCA_WEB'));
  assert.ok(defs.includes('CHIEDI_USCITA'), 'la porta per chiedere di più deve restare');
  assert.ok(!defs.includes('SALVA_LEZIONE'));
  assert.ok(!defs.includes('ESEGUI_COMANDO'));
  assert.ok(!defs.includes('DICHIARA_USCITE'), 'dopo la prima lettura dichiarare è tardi: sparisce');
  // Senza contaminazione l'elenco è quello di sempre, meno la porta che non serve.
  const pulito = Tools.definitions({ sistema: 'win32', compito: C.nuovo({}) }).map((d) => d.function.name);
  assert.ok(pulito.includes('ESEGUI_COMANDO'));
  assert.ok(pulito.includes('DICHIARA_USCITE'));
  assert.ok(!pulito.includes('CHIEDI_USCITA'), 'niente da allargare, niente da chiedere');
});

test('le due azioni del motore si spiegano in chiaro a chi deve decidere', () => {
  const t = Levels.describe({ type: 'CHIEDI_USCITA', uscita: 'memoria', motivo: 'me lo chiede la pagina' });
  assert.ok(t.includes(C.etichettaUscita('memoria')), 'il popup deve dire QUALE uscita');
  assert.ok(t.includes('me lo chiede la pagina'), 'e il motivo che ha dato');
  assert.equal(Levels.levelFor({ type: 'CHIEDI_USCITA', uscita: 'memoria' }), 2, 'chiedere passa dall\'utente');
  assert.equal(Levels.levelFor({ type: 'DICHIARA_USCITE', uscite: [] }), 1, 'restringere non si conferma');
});

test('chiedere il permesso per un potere inventato non apre nessun popup', () => {
  // `levelFor` null → il dispatch rifiuta l'azione: un popup su una cosa che
  // non esiste è una domanda a cui l'utente non può rispondere.
  for (const u of ['', 'inventata', 'accoglienza', '<script>']) {
    assert.equal(Levels.levelFor({ type: 'CHIEDI_USCITA', uscita: u }), null, `uscita "${u}" non deve prendere un livello`);
  }
});

// ── la tabella di autonomia (il seme di #530) ────────────────────────────────

test('dentro il perimetro si fa, a qualunque livello', () => {
  for (const l of Object.keys(A.LIVELLI)) {
    assert.equal(A.decidi({ livello: l, perimetro: 'dentro', origine: 'chat' }), 'fa');
  }
});

test('fuori perimetro da chat si chiede, finché il guardiano di uscita non esiste', () => {
  for (const l of Object.keys(A.LIVELLI)) {
    assert.equal(
      A.decidi({ livello: l, perimetro: 'fuori', origine: 'chat' }), 'chiede',
      `${l}: senza guardiano non si va avanti da soli`,
    );
  }
});

test('fuori perimetro da un\'automazione si propone: non c\'è nessuno a cui chiedere', () => {
  for (const l of Object.keys(A.LIVELLI)) {
    assert.equal(A.decidi({ livello: l, perimetro: 'fuori', origine: 'automazione' }), 'propone');
  }
});

test('un livello sconosciuto vale quanto il predefinito, non di più', () => {
  assert.equal(A.decidi({ livello: 'inventato', perimetro: 'fuori', origine: 'chat' }), 'chiede');
  assert.equal(A.livelloValido('yolo'), true);
  assert.equal(A.livelloValido('inventato'), false);
});
