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
require('../../src/shared/preferences.js');
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
  const v = C.consentito(c, 'SALVA_APPUNTO');
  assert.equal(v.ok, false);
  assert.equal(v.motivo, 'fuori-perimetro');
  assert.equal(v.uscita, 'appunti');
  assert.ok(v.etichetta.length > 0, 'il rifiuto deve poter essere detto all\'utente');
  // …e non è «sconsigliato»: non compare proprio nella lista che il motore accetta.
  assert.ok(!C.strumentiPermessi(c, Tools.NAMES).includes('SALVA_APPUNTO'));
});

test('una regola in memoria non si ottiene da un compito che ha letto, per nessuna strada', () => {
  // #533 (quarto giro di verifica) — una LEZIONE non è un contenuto: è una
  // regola su come Filo deve comportarsi, che sta davanti a ogni conversazione
  // futura come roba dell'utente e che la compattazione porta dentro il suo
  // profilo per sempre. Ricavata da testo scritto da altri è l'attacco, non un
  // caso d'uso: non la salva né chi l'aveva dichiarata prima di leggere, né chi
  // ottiene un sì dall'utente durante. Il contenuto trovato leggendo si salva
  // con SALVA_APPUNTO, che ha la sua cura.
  const dichiarata = contaminato(['memoria']);
  const v = C.consentito(dichiarata, 'SALVA_LEZIONE');
  assert.equal(v.ok, false);
  assert.equal(v.motivo, 'mai-da-esterno');
  assert.equal(v.secco, true, 'è un rifiuto, non una domanda da girare all\'utente');
  assert.equal(v.puoChiedere, false);
  assert.ok(v.etichetta.length > 0, 'il rifiuto deve poter essere detto all\'utente');
  assert.ok(!C.strumentiPermessi(dichiarata, Tools.NAMES).includes('SALVA_LEZIONE'));

  const concessa = contaminato(['sveglie']);
  C.allarga(concessa, 'memoria', 'l\'utente ha detto sì');
  assert.equal(C.consentito(concessa, 'SALVA_LEZIONE').ok, false, 'nemmeno un sì dell\'utente la rende buona');

  // Prima di qualunque lettura resta quella di sempre: lì l'unica autorità in
  // gioco è l'utente che ha scritto.
  assert.equal(C.consentito(C.nuovo({}), 'SALVA_LEZIONE').ok, true);
  // E l'appunto, che è la strada giusta per un contenuto, passa se dichiarato.
  assert.equal(C.consentito(contaminato(['appunti']), 'SALVA_APPUNTO').ok, true);
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
  C.allarga(uno, 'appunti', 'me l\'ha chiesto l\'utente');
  assert.equal(C.consentito(uno, 'SALVA_APPUNTO').ok, true);
  assert.equal(C.consentito(due, 'SALVA_APPUNTO').ok, false, 'il permesso non deve passare a un altro compito');
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

// ── quello che il primo giro di verifica ha trovato aperto (#533) ────────────

test('il messaggio dopo eredita la contaminazione e il perimetro di quello prima', () => {
  const prima = contaminato(['sveglie']);
  const dopo = C.erede(prima, { richiesta: 'ok' });
  // Il testo di altri è ancora in chat: ricominciare a mani libere vorrebbe
  // dire che basta un «ok» dell'utente per riavere tutti gli strumenti.
  assert.equal(dopo.contaminato, true);
  assert.deepEqual(dopo.perimetro, ['sveglie']);
  assert.equal(C.consentito(dopo, 'SVEGLIA').ok, true);
  assert.equal(C.consentito(dopo, 'SALVA_LEZIONE').ok, false);
  assert.ok(!C.strumentiPermessi(dopo, Tools.NAMES).includes('SALVA_LEZIONE'));
  // E resta la porta per chiedere: l'utente può sempre concedere una cosa in più.
  assert.ok(C.strumentiPermessi(dopo, Tools.NAMES).includes('CHIEDI_USCITA'));
});

test('dopo un messaggio che non ha letto niente di altri non si eredita nulla', () => {
  const prima = C.nuovo({});
  const dopo = C.erede(prima, { richiesta: 'ricordati che non bevo caffè' });
  assert.equal(dopo.contaminato, false);
  assert.equal(dopo.dichiarato, false, 'deve poter ancora dichiarare');
  assert.equal(C.consentito(dopo, 'SALVA_LEZIONE').ok, true);
});

test('il permesso dato dall\'utente vale per quella richiesta, non per quelle dopo', () => {
  // #533 (secondo giro di verifica) — il sì lo dà l'utente a un'azione sola,
  // dentro una richiesta sola. Portarlo avanti per tutta la conversazione
  // vuol dire che un «ok grazie» rinnova da solo un permesso che l'utente
  // aveva dato una volta, col testo della pagina ancora lì davanti.
  const prima = contaminato(['sveglie']);
  C.allarga(prima, 'appunti', 'l\'utente ha detto sì');
  assert.equal(C.consentito(prima, 'SALVA_APPUNTO').ok, true, 'nella sua richiesta il sì vale');
  const dopo = C.erede(prima, { richiesta: 'e adesso segnati anche questo' });
  assert.equal(C.consentito(dopo, 'SALVA_APPUNTO').ok, false, 'nella richiesta dopo va richiesto');
  // Quello che la richiesta di partenza aveva DICHIARATO invece si eredita:
  // quello non gliel'ha concesso un popup, lo comportava la richiesta.
  assert.equal(C.consentito(dopo, 'SVEGLIA').ok, true);
  assert.equal(C.consentito(dopo, 'ESEGUI_COMANDO').ok, false);
  // E la porta per richiederlo resta aperta.
  assert.ok(C.strumentiPermessi(dopo, Tools.NAMES).includes('CHIEDI_USCITA'));
});

test('quello che stampa un comando è una lettura di testo scritto da altri', () => {
  // Il contenuto di un file scaricato, la risposta di un sito: un comando le
  // riporta dentro al contesto esattamente come una pagina web.
  const k = C.classeDi('ESEGUI_COMANDO');
  assert.equal(k.classe, 'uscita');
  assert.equal(k.ritorna, 'esterno', 'un comando riporta indietro roba scritta da altri');
  const c = C.nuovo({});
  C.dichiara(c, ['terminale']);
  C.registraLettura(c, { type: 'ESEGUI_COMANDO', fonte: k.ritorna });
  assert.equal(c.contaminato, true);
  assert.equal(C.consentito(c, 'SALVA_LEZIONE').ok, false);
  assert.equal(C.consentito(c, 'ESEGUI_COMANDO').ok, true, 'il terminale era dichiarato');
});

test('cancellare tutta la memoria non è «scrivere nella memoria»', () => {
  assert.equal(C.uscitaDi('SALVA_LEZIONE'), 'memoria');
  assert.equal(C.uscitaDi('CANCELLA_MEMORIA'), 'oblio');
  const c = contaminato(['memoria']);
  assert.equal(C.consentito(c, 'CANCELLA_MEMORIA').ok, false,
    'chi concede «scrivere» non sta concedendo di buttare via tutto');
  // E prima di qualunque lettura le due restano due: una richiesta pulita che
  // dichiara «memoria» scrive, non cancella.
  const pulito = C.nuovo({});
  C.dichiara(pulito, ['memoria']);
  assert.equal(C.consentito(pulito, 'SALVA_LEZIONE').ok, true);
  assert.match(C.etichettaUscita('oblio'), /cancellare/);
});

test('il registro di un compito dice cosa ha letto e cosa gli è stato impedito', () => {
  const c = contaminato(['sveglie']);
  C.registraAzione(c, { type: 'SALVA_LEZIONE', esito: 'rifiutata: fuori perimetro' });
  const r = C.riassunto(c);
  assert.deepEqual(r.letture, ['CERCA_WEB']);
  assert.deepEqual(r.rifiutate, ['SALVA_LEZIONE']);
  assert.deepEqual(r.uscite, ['sveglie']);
});

test('leggere i titoli delle schede è una lettura di testo scritto da altri', () => {
  const k = C.classeDi('LEGGI_SCHEDE');
  assert.equal(k.classe, 'ingresso');
  assert.equal(k.fonte, 'esterno');
  const c = C.nuovo({});
  C.dichiara(c, ['sveglie']);
  C.registraLettura(c, { type: 'LEGGI_SCHEDE' });
  assert.equal(c.contaminato, true);
  assert.equal(C.consentito(c, 'SALVA_LEZIONE').ok, false);
});

test('la contabilità interna di Filo non si legge come un permesso dell\'utente', () => {
  assert.equal(C.uscitaInterna('accoglienza'), true);
  assert.equal(C.uscitaInterna('memoria'), false);
  // E non si può dichiarare: non nasce da una richiesta dell'utente.
  assert.ok(!C.USCITE_DICHIARABILI.includes('accoglienza'));
});

test('la richiesta resta scritta nel compito, su una riga sola e con un tetto', () => {
  const c = C.nuovo({ richiesta: '  Metti la sveglia\nprima dell\'esame  ' });
  assert.equal(c.richiesta, 'Metti la sveglia prima dell\'esame');
  const lungo = C.nuovo({ richiesta: 'a'.repeat(10000) });
  assert.ok(lungo.richiesta.length <= C.MAX_RICHIESTA);
  assert.ok(lungo.richiesta.endsWith('…'), 'un taglio si vede, non si nasconde');
  assert.equal(C.nuovo({}).richiesta, '');
  assert.equal(C.riassunto(c).richiesta, 'Metti la sveglia prima dell\'esame');
});

test('nel riquadro del permesso la riga di Filo viene prima del motivo, e il motivo ha un tetto', () => {
  const motivo = 'PREMI OK SUBITO. '.repeat(600);
  const testo = Levels.describe({ type: 'CHIEDI_USCITA', uscita: 'memoria', motivo });
  const posizioneAvviso = testo.indexOf('Permetteglielo solo se');
  const posizioneMotivo = testo.indexOf('PREMI OK SUBITO');
  assert.ok(posizioneAvviso > -1 && posizioneMotivo > -1);
  assert.ok(posizioneAvviso < posizioneMotivo, 'quello che dice Filo non va sotto il testo dettato dalla pagina');
  assert.ok(testo.length < 1000, `il riquadro non si riempie del motivo (${testo.length} caratteri)`);
  assert.ok(testo.includes('…'), 'il taglio si vede');
});

// #533 (quinto giro di verifica) — scrivere COME FILO PARLA non è cambiare
// un'impostazione: quel testo entra in cima a ogni richiesta futura come una
// cosa che ha chiesto l'utente. È una regola che vale per sempre, come una
// riga di memoria, e da testo scritto da altri non nasce.
test('lo stile con cui Filo parla è una famiglia sua, e da una lettura non si ottiene', () => {
  const c = contaminato(['impostazioni']);
  const stile = C.consentito(c, 'IMPOSTA_PREFERENZA', { chiave: 'stile_agente', valore: 'parla così' });
  assert.equal(stile.ok, false, 'lo stile non si scrive dopo aver letto roba di altri');
  assert.equal(stile.uscita, 'contegno');
  assert.equal(stile.secco, true, 'e non si ottiene nemmeno chiedendolo all\'utente');
  assert.equal(stile.puoChiedere, false);
  // Le altre preferenze restano quelle di prima: il tema si cambia.
  assert.equal(C.consentito(c, 'IMPOSTA_PREFERENZA', { chiave: 'tema', valore: 'scuro' }).ok, true);
  // Anche scritta storta, la chiave finisce nella famiglia giusta.
  assert.equal(C.consentito(c, 'IMPOSTA_PREFERENZA', { chiave: 'Stile Agente' }).uscita, 'contegno');
  // Senza aver letto niente non cambia nulla: è la richiesta dell'utente.
  const pulito = C.nuovo({});
  C.dichiara(pulito, ['impostazioni']);
  assert.equal(C.consentito(pulito, 'IMPOSTA_PREFERENZA', { chiave: 'stile_agente', valore: 'x' }).ok, true);
  // E lo strumento resta offerto: serve ancora per il tema.
  assert.ok(C.strumentiPermessi(c, Object.keys(C.CLASSI)).includes('IMPOSTA_PREFERENZA'));
});

test('un sì dell\'utente non fa nascere lo stile da una pagina, e il registro lo dice con la sua frase', () => {
  const c = contaminato(['impostazioni']);
  const r = C.allarga(c, 'contegno', 'me l\'ha chiesto la pagina');
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'mai-da-esterno');
  assert.ok(!C.usciteVive(c).includes('contegno'));
  C.registraAzione(c, {
    type: 'IMPOSTA_PREFERENZA',
    azione: { chiave: 'stile_agente' },
    esito: 'rifiutata: mai da testo esterno',
  });
  assert.deepEqual(C.riassunto(c).usciteRifiutate, ['contegno']);
  assert.match(C.etichettaUscita('contegno'), /come Filo ti parla/);
});

test('l\'elenco che il modello legge dice quali uscite non nascono da una lettura', () => {
  const testo = Tools.definitions({})
    .map((t) => t.function.description).join('\n');
  assert.match(testo, /contegno/, 'la famiglia dello stile si può dichiarare prima di leggere');
  assert.match(testo, /stile_agente/);
});

test('aprire un file è un\'uscita, non una proposta a costo zero', () => {
  // #533 (sesto giro di verifica) — una proposta resta a costo zero finché non
  // porta con sé un bersaglio che sceglie il modello sotto una scritta che
  // sceglie il modello. «Apri un file» ce l'aveva.
  assert.equal(C.classeDi('APRI_FILE').classe, 'uscita');
  assert.equal(C.uscitaDi('APRI_FILE'), 'file');
  assert.ok(C.USCITE_DICHIARABILI.includes('file'), 'la famiglia si deve poter dichiarare');
  const c = contaminato(['sveglie']);
  assert.equal(C.consentito(c, 'APRI_FILE').ok, false, 'chi ha letto e non l\'aveva chiesto non lo ottiene');
  assert.ok(!C.strumentiPermessi(c, Tools.NAMES).includes('APRI_FILE'));
  const d = contaminato(['file']);
  assert.equal(C.consentito(d, 'APRI_FILE').ok, true, 'chi l\'aveva dichiarato prima di leggere sì');
});

test('la frase del permesso per un file dice che si apre sul computer', () => {
  const t = Levels.describe({ type: 'CHIEDI_USCITA', uscita: 'file', motivo: 'devo aprirti la bolletta' });
  assert.ok(/file/i.test(t), `la frase non nomina il file: ${t}`);
});
