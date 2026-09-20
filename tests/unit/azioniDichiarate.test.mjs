// #517 — «Azione raccontata a parole e mai eseguita: fallimento muto».
//
// Il feedback: nei turni di prosecuzione il modello a volte scrive «Ti ho messo
// una sveglia alle 19:00» senza aver chiamato nessuno strumento. Il testo arriva
// all'utente, la sveglia no. Qui si prova la parte deterministica del presidio
// (src/shared/azioniDichiarate.js): riconoscere la dichiarazione, NON scattare
// quando l'azione c'è davvero, e non gridare al lupo su una frase qualunque.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/actionTools.js');
require('../../src/shared/azioniDichiarate.js');
const AD = globalThis.SN_AZIONI_DICHIARATE;
const Tools = globalThis.SN_ACTION_TOOLS;

const ids = (list) => list.map((f) => f.id).sort();

test('il caso del feedback: la sveglia raccontata e mai chiamata', () => {
  const testo = 'Ti ho messo una sveglia alle 19:00 per ognuna di quelle notti, così non te ne dimentichi.';
  const trovati = AD.rileva(testo, []);
  assert.deepEqual(ids(trovati), ['sveglia']);
  // La frase torna intera: al modello serve sapere cosa rimangiarsi, all'utente
  // cosa credeva fatto.
  assert.match(trovati[0].frase, /Ti ho messo una sveglia alle 19:00/);
  assert.ok(trovati[0].tipi.includes('SVEGLIA'));
});

test('con l\'azione nel turno non scatta niente', () => {
  const testo = 'Ti ho messo una sveglia alle 19:00, buonanotte!';
  assert.deepEqual(AD.rileva(testo, [{ type: 'SVEGLIA', time: '19:00' }]), []);
});

test('scatta anche quando l\'azione del turno è di un\'altra famiglia', () => {
  // Ha cercato sul web e poi ha DETTO di aver messo la sveglia: la ricerca non
  // regge la sveglia.
  const testo = 'Domani piove alle 18. Ti ho impostato la sveglia alle 19:00.';
  assert.deepEqual(ids(AD.rileva(testo, [{ type: 'CERCA_WEB' }])), ['sveglia']);
});

test('le altre famiglie: timer, appunto, apertura, comando, impostazione, segnalazione', () => {
  const casi = [
    ['Ho avviato il timer da dieci minuti.', 'timer', 'TIMER'],
    ['Ho salvato l\'appunto con la lista della spesa.', 'appunto', 'SALVA_APPUNTO'],
    ['Ho aperto la pagina di Wikipedia in una nuova scheda.', 'apertura', 'NAVIGA'],
    ['Ho eseguito il comando e non ha stampato niente.', 'comando', 'ESEGUI_COMANDO'],
    ['Ho messo il tema scuro come mi hai chiesto.', 'impostazione', 'IMPOSTA_PREFERENZA'],
    ['Ho inviato la segnalazione agli sviluppatori.', 'segnalazione', 'INVIA_FEEDBACK'],
    ['Ho tolto la sveglia della palestra.', 'sveglia-tolta', 'CANCELLA_SVEGLIA'],
    ['Ho spostato la sveglia delle 7 alle 8.', 'sveglia-spostata', 'MODIFICA_SVEGLIA'],
    ['Ho letto il documento: la giacenza media è 3.200 euro.', 'lettura', 'LEGGI_DOCUMENTO'],
    ['Ho cancellato la memoria come mi avevi chiesto.', 'memoria-cancellata', 'CANCELLA_MEMORIA'],
  ];
  for (const [testo, id, tipo] of casi) {
    const trovati = AD.rileva(testo, []);
    assert.ok(trovati.some((f) => f.id === id), `non riconosciuto: ${testo}`);
    // E con l'azione giusta nel turno tace.
    assert.ok(
      !AD.rileva(testo, [{ type: tipo }]).some((f) => f.id === id),
      `scatta anche con l'azione ${tipo}: ${testo}`,
    );
  }
});

test('una negazione non è una dichiarazione', () => {
  const frasi = [
    'Non ho messo nessuna sveglia: dimmi tu a che ora.',
    'Non sono riuscito a salvare l\'appunto, il file era bloccato.',
    'Non ho aperto niente perché non ho capito quale link intendevi.',
    'Non ho ancora eseguito il comando: vuoi che lo lanci?',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('una domanda o un\'ipotesi non è una dichiarazione', () => {
  const frasi = [
    'Ho aperto la pagina giusta?',
    'Se ho aperto la pagina sbagliata dimmelo.',
    'Vuoi che ti metta una sveglia alle 19:00?',
    'Posso mettere una sveglia alle 19:00, dimmi solo se la vuoi ripetuta.',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('una constatazione dello STATO non è una rivendicazione', () => {
  // I processi attivi arrivano al modello nello STATO: dirne uno non vuol dire
  // averlo appena creato, e un participio da solo non basta a far scattare
  // niente.
  const frasi = [
    'La sveglia delle 7 è già impostata, ne vuoi un\'altra?',
    'Hai due timer in corso: pasta e forno.',
    'La modalità terminale è disattivata: vuoi che la attivi?',
    'Ci sono tre schede aperte, due su Wikipedia e una su GitHub.',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('una risposta normale non fa scattare niente', () => {
  const frasi = [
    'Domani a Milano sono previsti 18 gradi e cielo coperto.',
    'Ti conviene partire prima delle 8 per evitare il traffico.',
    'Certo, dimmi pure a che ora la vuoi.',
    'Ho capito cosa intendi, ma il sito non è raggiungibile.',
  ];
  for (const f of frasi) assert.deepEqual(AD.rileva(f, []), [], f);
});

test('la cronologia regge una dichiarazione su un turno precedente', () => {
  const cronologia = [
    { role: 'user', text: 'sveglia alle 7' },
    { role: 'filo', text: 'Fatto.', actions: [{ type: 'SVEGLIA', time: '07:00' }] },
    { role: 'user', text: 'l\'hai messa davvero?' },
  ];
  const tipi = AD.tipiDallaCronologia(cronologia);
  assert.ok(tipi.has('SVEGLIA'));
  assert.deepEqual(AD.rileva('Sì, te l\'ho messa alle 7.', tipi), []);
  // Ma una cronologia senza azioni non regge niente.
  assert.deepEqual(
    ids(AD.rileva('Sì, ti ho messo la sveglia alle 7.', AD.tipiDallaCronologia([{ role: 'filo', text: 'ciao' }]))),
    ['sveglia'],
  );
});

test('formatoSospetto riconosce la risposta in formato macchina, non la prosa', () => {
  assert.equal(AD.formatoSospetto('{"text": "Fatto", "actions": [{"type": "SVEGLIA"}]'), true);
  assert.equal(AD.formatoSospetto('```json\n{"actions": [{"type":"TIMER"}]}\n```'), true);
  assert.equal(AD.formatoSospetto('SVEGLIA {"time": "19:00"}'), true);
  assert.equal(AD.formatoSospetto('Fatto, sveglia alle 19:00.'), false);
  assert.equal(AD.formatoSospetto('Il JSON di risposta contiene "actions" tra i campi.'), false);
  assert.equal(AD.formatoSospetto(''), false);
});

test('la spinta al modello elenca le frasi e le tre uscite', () => {
  const fantasmi = AD.rileva('Ti ho messo una sveglia alle 19:00.', []);
  const spinta = AD.spintaAzioniMancanti(fantasmi);
  assert.match(spinta, /Ti ho messo una sveglia alle 19:00/);
  assert.match(spinta, /SVEGLIA/);
  assert.match(spinta, /turno PRECEDENTE/);
  assert.match(spinta, /non lo vede l'utente/);
});

test('l\'avviso per l\'utente dice cosa NON è successo', () => {
  const uno = AD.avvisoPerUtente(AD.rileva('Ti ho messo una sveglia alle 19:00.', []));
  assert.match(uno, /la sveglia non c'è/);
  assert.match(uno, /chiediglielo di nuovo/i);
  const due = AD.avvisoPerUtente([
    { avviso: 'la sveglia non c\'è' },
    { avviso: 'l\'appunto non c\'è' },
  ]);
  assert.match(due, /la sveglia non c'è e l'appunto non c'è/);
  assert.equal(AD.avvisoPerUtente([]), '');
});

test('sentinella: ogni tipo citato dalle famiglie è uno strumento vero (o un segno di contesto dichiarato)', () => {
  const veri = new Set(Tools.NAMES);
  const contesto = new Set(AD.TIPI_DI_CONTESTO);
  for (const c of contesto) {
    assert.ok(!veri.has(c), `${c} è dichiarato come segno di contesto ma è anche uno strumento vero: sceglierne uno`);
  }
  for (const fam of AD.FAMIGLIE) {
    for (const t of fam.tipi) {
      assert.ok(veri.has(t) || contesto.has(t),
        `la famiglia ${fam.id} cita ${t}, che non è né uno strumento del modello né un segno di contesto dichiarato`);
    }
  }
});

// Il presidio è fatto di espressioni regolari, e in JavaScript `\b` guarda solo
// l'alfabeto ASCII: dopo la à di «modalità» non c'è nessun confine di parola,
// quindi una regola scritta `modalità\b` non può fare match su NIENTE. Tre
// regole erano nate così — spente, verdi, e inutili — e nessuno poteva
// accorgersene leggendole. Questa sentinella lo impedisce per sempre.
test('sentinella: nessuna regola è nata spenta (accento subito prima di \\b)', () => {
  const sorgenti = [];
  for (const fam of AD.FAMIGLIE) for (const re of fam.frasi) sorgenti.push([fam.id, re.source]);
  for (const [id, src] of sorgenti) {
    assert.ok(!/[àèéìíòóùúÀÈÉÌÍÒÓÙÚ]\\b/.test(src),
      `la famiglia ${id} ha una regola con un accento subito prima di \\b: non potrà mai scattare`);
  }
  // E la prova che le tre regole rifatte scattano davvero.
  assert.deepEqual(ids(AD.rileva('Ho attivato la modalità scura.', [])), ['impostazione']);
  assert.deepEqual(
    ids(AD.rileva('Non ho trovato l\'evento però ti ho messo una sveglia alle 19.', [])),
    ids(AD.rileva('Non ho trovato l\'evento ma ti ho messo una sveglia alle 19.', [])),
  );
});

// La conferma col PRONOME: quando la cosa l'ha appena nominata l'utente, in
// italiano si risponde «l'ho messa alle 19». Era la forma più probabile subito
// dopo la richiesta, ed era anche l'unica che passava intera.
test('la conferma col pronome viene vista, e tace appena un\'azione c\'è', () => {
  for (const frase of [
    'L\'ho messa alle 19.',
    'Te l\'ho messa alle 19, buonanotte.',
    'Le ho impostate tutte e tre.',
    'Te l’ho messa alle 19.',
  ]) {
    assert.deepEqual(ids(AD.rileva(frase, [])), ['senza-nome'], frase);
    assert.deepEqual(AD.rileva(frase, [{ type: 'SVEGLIA' }]), [], `${frase} (con un'azione nel turno)`);
  }
  // Una famiglia che sa dire DI COSA si tratta vince: niente doppio avviso.
  assert.deepEqual(ids(AD.rileva('L\'ho aggiunta al calendario.', [])), ['calendario']);
  assert.deepEqual(ids(AD.rileva('Fatto! L\'ho salvata fra gli appunti.', [])), ['appunto']);
});

// L'avviso che accusa Filo di non aver fatto una cosa che HA fatto è il modo
// più rapido di rendere il presidio inutile: lo si smette di leggere.
test('niente falsi allarmi su quello che Filo fa per altre strade', () => {
  // Un programma o una cartella si aprono con un comando di shell.
  assert.deepEqual(AD.rileva('Ho aperto il blocco note.', [{ type: 'ESEGUI_COMANDO' }]), []);
  // I riassunti dei file dell'editor sono già in contesto a ogni turno.
  assert.deepEqual(AD.rileva('Ho letto il file bolletta.pdf: sono 84 euro.', [{ type: 'CONTESTO_FILE' }]), []);
  // Quello che Filo impara lo scrive in memoria un passaggio che parte da solo
  // dopo il turno: «l'ho memorizzato» è vero, e non ha più una famiglia.
  assert.deepEqual(AD.rileva('L\'ho memorizzato: preferisci le risposte brevi.', []), []);
  assert.deepEqual(AD.rileva('D\'ora in poi me lo ricorderò.', []), []);
});

// «Scrive la risposta buona come preambolo e chiude con un oggetto»: la metà
// del guasto che passava intera, perché si guardava solo l'inizio del testo.
test('il formato macchina si riconosce anche in coda alla risposta', () => {
  assert.equal(AD.formatoSospetto('Ti metto la sveglia alle 19.\n\nSVEGLIA{"time":"19:00"}'), true);
  assert.equal(AD.formatoSospetto('Ecco fatto.\n\n{}'), true);
  assert.equal(AD.formatoSospetto('[{"type":"SVEGLIA","time":"19:00"}]'), true);
  assert.equal(AD.formatoSospetto('Ecco.\n\n{"text":"","actions":[]}'), true);
  // Un esempio dentro un blocco recintato è una risposta, non un guasto.
  assert.equal(AD.formatoSospetto('Un esempio:\n\n```json\n{"text":"x","actions":[]}\n```\n\nChiaro?'), false);
  // E una parola maiuscola con una parentesi dietro non è una chiamata.
  assert.equal(AD.formatoSospetto('Ho scritto TODO{ sistemare } nel file.'), false);
  assert.equal(AD.formatoSospetto('Poi ho messo NOTA{da rivedere} in fondo.'), false);
});

test('input limite: vuoto, spazi, testo lunghissimo, caratteri strani', () => {
  assert.deepEqual(AD.rileva('', []), []);
  assert.deepEqual(AD.rileva('   \n\t  ', []), []);
  assert.deepEqual(AD.rileva(null, []), []);
  const lungo = `${'blah blah '.repeat(3000)}Ti ho messo una sveglia alle 19:00.`;
  const t0 = Date.now();
  assert.deepEqual(ids(AD.rileva(lungo, [])), ['sveglia']);
  assert.ok(Date.now() - t0 < 1000, 'troppo lento su un testo lungo');
  assert.deepEqual(AD.rileva('¡™£¢ 😀 <<<ROBA>>> ho messo', []), []);
});
