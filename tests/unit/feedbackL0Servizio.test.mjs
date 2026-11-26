// #1403 — L0 lato main: la rilettura anticipata si ritrova all'invio, oltre l'attesa o senza modello il feedback parte,
// le immagini vanno al loro slot, spento non chiede niente a nessuno.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['contenutoEsterno', 'guardianoStatico', 'feedbackL0']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const { crea } = require(join(ROOT, 'src', 'main', 'services', 'feedbackL0.js'));

const AZ = { FEEDBACK_L0: 'feedback_l0', FEEDBACK_L0_IMMAGINI: 'feedback_l0_immagini' };
const muto = { log() {}, warn() {} };

function servizio({ risposte = {}, ritardo = 0, acceso = true, segreti = [], redTeam = false } = {}) {
  const chiamate = [];
  const gate = {
    async complete({ action, messages, signal }) {
      chiamate.push({ action, messages });
      if (ritardo) await new Promise((r, rej) => { const t = setTimeout(r, ritardo); signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
      const r = risposte[action];
      if (r instanceof Error) throw r;
      return { text: r ?? '{"trovati":[]}', servedBy: 'Host', model: 'm' };
    },
  };
  const L0 = crea({
    gate, azioni: AZ, log: muto,
    impostazioni: async () => ({ feedbackRilettura: { enabled: acceso } }),
    segreti: async () => segreti,
    redTeam: () => redTeam,
  });
  return { L0, chiamate };
}

test('niente trovato: il feedback è pulito', async () => {
  const { L0, chiamate } = servizio();
  assert.deepEqual(await L0.controlla({ testo: 'il tasto non va' }), { stato: 'pulito' });
  assert.deepEqual(chiamate.map((c) => c.action), ['feedback_l0']);
});

test('trovato: torna l\'avviso coi pezzi da evidenziare', async () => {
  const { L0 } = servizio({ risposte: { feedback_l0: '{"trovati":[{"tipo":"segreto","pezzo":"Pippo#99x"}]}' } });
  const r = await L0.controlla({ testo: 'la password è Pippo#99x' });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['Pippo#99x']);
});

test('la rilettura anticipata mentre si scrive vale all\'invio: niente seconda chiamata', async () => {
  const { L0, chiamate } = servizio({ risposte: { feedback_l0: '{"trovati":[]}' } });
  assert.equal(await L0.anticipa('testo scritto'), true);
  await L0.controlla({ testo: 'testo scritto' });
  assert.equal(chiamate.length, 1);
  await L0.controlla({ testo: 'testo cambiato' });
  assert.equal(chiamate.length, 2, 'col testo cambiato si rilegge');
});

test('oltre l\'attesa il feedback parte: «saltato», mai un muro', async () => {
  const { L0 } = servizio({ ritardo: 300 });
  const t0 = Date.now();
  const r = await L0.controlla({ testo: 'qualcosa', entroMs: 50 });
  assert.equal(r.stato, 'saltato');
  assert.ok(Date.now() - t0 < 250);
});

test('un modello che fallisce o una risposta illeggibile non fermano il feedback', async () => {
  const errore = servizio({ risposte: { feedback_l0: Object.assign(new Error('nessun host ammesso'), { code: 'NO_ALLOWED_HOST' }) } });
  assert.equal((await errore.L0.controlla({ testo: 'x' })).stato, 'saltato');
  const strana = servizio({ risposte: { feedback_l0: 'boh' } });
  assert.equal((await strana.L0.controlla({ testo: 'x' })).stato, 'saltato');
});

test('le immagini vanno allo slot che legge le immagini, col testo per capire di cosa parla', async () => {
  const { L0, chiamate } = servizio({ risposte: { feedback_l0_immagini: '{"trovati":[{"tipo":"schede","immagine":1}]}' } });
  const r = await L0.controlla({ testo: 'guarda', immagini: ['data:image/png;base64,AAA', 'non un\'immagine'] });
  assert.deepEqual(chiamate.map((c) => c.action).sort(), ['feedback_l0', 'feedback_l0_immagini']);
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.immagini, [0]);
});

test('spento non chiama nessun modello', async () => {
  const { L0, chiamate } = servizio({ acceso: false });
  assert.equal((await L0.controlla({ testo: 'x', immagini: ['data:image/png;base64,A'] })).stato, 'saltato');
  assert.equal(await L0.anticipa('x'), false);
  assert.equal(chiamate.length, 0);
});

test('un segreto che Filo custodisce si segna anche se il modello non lo vede', async () => {
  const { L0 } = servizio({ segreti: [{ valore: 'sk-or-v1-abcdef1234567890', tipo: 'chiave' }] });
  const r = await L0.controlla({ testo: 'la mia chiave è sk-or-v1-abcdef1234567890 ok' });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['sk-or-v1-abcdef1234567890']);
});

// #1403.1 — la chiave custodita si riconosce come la riconosce il passaggio verso i modelli, che la nasconde travestita.
// Composta a runtime: scritta intera nel sorgente, la protezione dei push di GitHub la prende per una chiave vera.
const CORPO = ['4f9c2a7e', '1b8d3065', 'c4a9e2f7', '1d0b6c3a', '8e5f2d9a', '1c7b4e0f', '6a3d8c2b', '9e1f5a07'].join('');
const CHIAVE = ['sk', 'or', 'v1', CORPO].join('-');

test('una chiave custodita incollata senza prefisso si segna, anche se il modello non la vede', async () => {
  const { L0 } = servizio({ segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  const testo = `Non va, uso la chiave ${CORPO} da ieri.`;
  assert.notEqual(globalThis.SN_GUARDIANO_STATICO.oscuraSegreti(testo, [CHIAVE]), testo, 'verso i modelli la chiave è nascosta');
  const r = await L0.controlla({ testo });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), [CORPO]);
});

test('una chiave custodita con spazi in mezzo si segna intera, spazi compresi', async () => {
  const { L0 } = servizio({ segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  const spezzata = CORPO.match(/.{1,8}/g).join(' ');
  const r = await L0.controlla({ testo: `Ecco la chiave: ${spezzata}. Grazie.` });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), [spezzata]);
});

const dataUrl = (testo, type = 'text/plain') => `data:${type};base64,${Buffer.from(testo).toString('base64')}`;

test('un log allegato con una password: avviso sull\'allegato, senza mandarlo al modello', async () => {
  const { L0, chiamate } = servizio();
  const log = 'avvio...\nutente = mario.rossi\npassword = hunter22\nerrore 401\n';
  const r = await L0.controlla({
    testo: 'Allego il log: il login fallisce sempre',
    allegati: [{ name: 'foto.pdf', type: 'application/pdf', dataUrl: dataUrl('password = hunter22', 'application/pdf') }, { name: 'filo.log', type: '', dataUrl: dataUrl(log) }],
  });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.allegati, [1], 'segnato il log, non il PDF');
  assert.deepEqual(r.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_ALLEGATO.segreto]);
  assert.deepEqual(r.esito.pezzi, []);
  assert.ok(!JSON.stringify(chiamate).includes('hunter22'), 'il log non va al modello');
});

test('allegati di testo: tutti i tipi del riquadro, carte e conti col loro nome, chiavi custodite travestite', async () => {
  const { L0 } = servizio({ segreti: [{ valore: CHIAVE, tipo: 'chiave' }] });
  for (const [name, type] of [['a.txt', 'text/plain'], ['a.json', 'application/json'], ['a.csv', 'text/csv'], ['a.md', 'text/markdown'], ['a.yaml', '']]) {
    const r = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name, type, dataUrl: dataUrl('{"password": "Tr7#kq29Lm"}\npassword: Tr7#kq29Lm') }] });
    assert.equal(r.stato, 'trovato', name);
  }
  const iban = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'c.txt', type: 'text/plain', dataUrl: dataUrl('conto IT60 X054 2811 1010 0000 0123 456') }] });
  assert.deepEqual(iban.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_ALLEGATO.documento]);
  const chiave = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'env.txt', type: 'text/plain', dataUrl: dataUrl(`KEY=${CORPO.toUpperCase()}`) }] });
  assert.deepEqual(chiave.esito.allegati, [0]);
  const pulito = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'ok.log', type: 'text/plain', dataUrl: dataUrl('tutto normale, errore 500 alle 12:30') }] });
  assert.equal(pulito.stato, 'pulito');
});

// #1403.1, giro 1, r1: quello che il pavimento nasconde ai modelli il modello della rilettura non lo vede.
const FORME_DI_LOG = [
  ['config.json', 'application/json', '{"utente":"mario.rossi","password":"hunter22"}'],
  ['filo.log', 'text/plain', 'utente=mario.rossi password=hunter22\nerrore 401'],
  ['note.md', 'text/markdown', 'Config:\n- pwd: hunter22'],
  ['env.txt', 'text/plain', 'DB_PASSWORD=hunter22'],
  ['rete.log', '', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop'],
  ['accessi.log', '', 'GET https://example.com/reset?token=8f7d6c5b4a3928171615 200'],
  ['comandi.txt', 'text/plain', 'mysql -u root -pSegreto123'],
];
test('le password scritte come nei log e nelle configurazioni si segnano, negli allegati e nel testo', async () => {
  const { L0, chiamate } = servizio();
  for (const [name, type, corpo] of FORME_DI_LOG) {
    const r = await L0.controlla({ testo: 'Allego il file: il login fallisce sempre', allegati: [{ name, type, dataUrl: dataUrl(corpo) }] });
    assert.equal(r.stato, 'trovato', name);
    assert.deepEqual(r.esito.allegati, [0], name);
  }
  for (const testo of ['nel file ho password=hunter22 e mi dà 401', 'il PIN 4821 del bancomat non va', 'Il CVV della carta è 123 e il pagamento fallisce']) {
    const r = await L0.controlla({ testo });
    assert.equal(r.stato, 'trovato', testo);
    assert.deepEqual(r.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_TESTO.segreto], testo);
    assert.equal(r.esito.pezzi.length, 1, testo);
    assert.ok(testo.includes(r.esito.pezzi[0].testo), testo);
  }
  assert.ok(chiamate.length > 0);
  const normale = await L0.controlla({ testo: 'Il campo password non accetta i simboli e il PIN si dimentica' });
  assert.equal(normale.stato, 'pulito');
});

test('una password senza forma si segna solo dove sta, non in ogni parola uguale', async () => {
  const { L0 } = servizio();
  const testo = 'Password\ngattino\nHo anche un gattino vero.';
  const r = await L0.controlla({ testo });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['gattino']);
});

// r2: Windows salva testo anche in UTF-16.
test('un allegato in UTF-16, con o senza segno d\'ordine, si legge come testo', async () => {
  const { L0 } = servizio();
  const riga = 'avvio...\r\npassword = hunter22\r\nerrore 401\r\n';
  const le = Buffer.from(riga, 'utf16le');
  const be = Buffer.from(le).swap16();
  const casi = {
    'LE con segno': Buffer.concat([Buffer.from([0xFF, 0xFE]), le]),
    'BE con segno': Buffer.concat([Buffer.from([0xFE, 0xFF]), be]),
    'LE senza segno': le,
    'BE senza segno': be,
  };
  for (const [nome, b] of Object.entries(casi)) {
    const r = await L0.controlla({ testo: 'vedi log', allegati: [{ name: 'output.txt', type: 'text/plain', dataUrl: `data:text/plain;base64,${b.toString('base64')}` }] });
    assert.equal(r.stato, 'trovato', nome);
  }
  const utf8 = await L0.controlla({ testo: 'vedi log', allegati: [{ name: 'ok.txt', type: 'text/plain', dataUrl: dataUrl('città: è tutto normale, errore 500') }] });
  assert.equal(utf8.stato, 'pulito');
});

// #1403.2: i byte si leggono come li legge il lettore dei documenti, anche in un alfabeto non latino e nella tabella di Windows.
test('un log in UTF-16 senza firma scritto in cirillico e uno nella tabella di Windows si leggono come testo', async () => {
  const b64 = (b) => `data:text/plain;base64,${b.toString('base64')}`;
  const cirillico = `${'Журнал входа в систему: пользователь мария вошла успешно. '.repeat(20)}\r\npassword = hunter22\r\n`;
  const r = await servizio().L0.controlla({ testo: 'vedi log', allegati: [{ name: 'output.txt', type: 'text/plain', dataUrl: b64(Buffer.from(cirillico, 'utf16le')) }] });
  assert.equal(r.stato, 'trovato', 'UTF-16 senza firma in cirillico');

  const custodita = 'Caffè2024!';
  const cp1252 = Buffer.from(`Note del giorno\r\nla chiave del portale: ${custodita}\r\n`, 'latin1');
  const w = await servizio({ segreti: [{ valore: custodita, password: true }] }).L0
    .controlla({ testo: 'vedi log', allegati: [{ name: 'note.txt', type: 'text/plain', dataUrl: b64(cp1252) }] });
  assert.equal(w.stato, 'trovato', 'la password custodita con la lettera accentata si riconosce');
});

// #1403.2: un CSV con la colonna password, nel formato normale e in quello delle esportazioni dei browser.
test('un CSV allegato con la colonna password dà l\'avviso: punti e virgola, virgole, virgolette, ogni riga', async () => {
  const { L0, chiamate } = servizio();
  for (const [name, csv] of [
    ['utenti.csv', 'utente;password\nmario.rossi;hunter22\n'],
    ['Chrome Passwords.csv', 'name,url,username,password,note\nGmail,https://mail.google.com,mario,gattino,\nBanca,https://banca.it,mario.rossi,Xk9#pQ2v,\n'],
    ['export.csv', '"user","password"\r\n"mario","Hunter22!"\r\n'],
    ['righe.csv', 'utente;password;ruolo\nanna;;ospite\nluca;;ospite\nmario;hunter22;admin\n'],
  ]) {
    const r = await L0.controlla({ testo: 'Allego l\'esportazione: il login fallisce sempre', allegati: [{ name, type: 'text/csv', dataUrl: dataUrl(csv) }] });
    assert.equal(r.stato, 'trovato', name);
    assert.deepEqual(r.esito.allegati, [0], name);
    assert.deepEqual(r.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_ALLEGATO.segreto], name);
  }
  assert.ok(!JSON.stringify(chiamate).includes('hunter22'), 'l\'allegato non va al modello');
  const senza = await L0.controlla({ testo: 'vedi allegato', allegati: [{ name: 'a.csv', type: 'text/csv', dataUrl: dataUrl('utente;ruolo\nmario;admin\n') }] });
  assert.equal(senza.stato, 'pulito');
});

test('il controllo senza modello che non risponde: niente avviso inventato, e la rilettura vale come saltata', async () => {
  const L0 = crea({
    gate: { async complete() { return { text: '{"trovati":[]}' }; } }, azioni: AZ, log: muto,
    impostazioni: async () => ({}), statico: { prepara() {}, leggi: async () => null },
  });
  const r = await L0.controlla({ testo: 'vedi log', allegati: [{ name: 'a.log', type: 'text/plain', dataUrl: dataUrl('password = hunter22') }] });
  assert.deepEqual(r, { stato: 'saltato' });
  assert.deepEqual(await L0.controlla({ testo: 'niente allegati' }), { stato: 'pulito' }, 'il testo l\'ha riletto il modello');
});

// #2645 — la password che l'utente ha appena lasciato uscire con la parola «conferma» non si ripropone; il resto sì.
test('un segreto già confermato con la parola non torna nell\'avviso, gli altri casi sì', async () => {
  require(join(ROOT, 'src', 'shared', 'autonomia.js'));
  const testo = 'Non riesco a entrare nel sito della banca. La mia password è Gatto!2024 e mi dice che è sbagliata.';
  const { valori } = globalThis.SN_AUTONOMIA.segretoDettaglio(testo, { richiesta: testo });
  assert.deepEqual(valori, ['Gatto!2024'], 'la porta delle uscite e la rilettura parlano dello stesso valore');
  const modello = (trovati) => servizio({ risposte: { feedback_l0: JSON.stringify({ trovati }) } }).L0;

  // Lo trovano sia il controllo senza modello sia il modello, anche con un pezzo più lungo del valore.
  for (const pezzo of ['Gatto!2024', 'password è Gatto!2024']) {
    const L0 = modello([{ tipo: 'segreto', pezzo }]);
    assert.equal((await L0.controlla({ testo })).stato, 'trovato', 'senza conferma si ferma');
    assert.deepEqual(await L0.controlla({ testo, confermati: valori }), { stato: 'pulito' }, pezzo);
  }

  const conTelefono = `${testo} Chiamatemi al 333 1234567.`;
  const r = await modello([{ tipo: 'segreto', pezzo: 'Gatto!2024' }, { tipo: 'recapito', pezzo: '333 1234567' }])
    .controlla({ testo: conTelefono, confermati: valori });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_TESTO.recapito], 'resta solo il recapito');
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['333 1234567']);

  const altra = await modello([{ tipo: 'segreto', pezzo: 'Pippo#99x' }]).controlla({ testo: `${testo} Quella vecchia era Pippo#99x.`, confermati: valori });
  assert.deepEqual(altra.esito.pezzi.map((p) => p.testo), ['Pippo#99x'], 'un segreto che la parola non copriva resta');

  const log = await modello([]).controlla({ testo, confermati: valori, allegati: [{ name: 'filo.log', type: 'text/plain', dataUrl: dataUrl('password = Gatto!2024') }] });
  assert.deepEqual(log.esito.allegati, [0], 'un allegato non l\'ha visto il riquadro della parola');
});

// r3: una carta scritta nel testo del feedback ha la frase delle carte, non quella delle password.
test('una carta valida nel testo: la frase di carte e conti, e la carta evidenziata', async () => {
  const { L0 } = servizio();
  const r = await L0.controlla({ testo: 'Il pagamento con la carta 4539 1488 0343 6467 viene rifiutato' });
  assert.equal(r.stato, 'trovato');
  assert.deepEqual(r.esito.frasi, [globalThis.SN_FEEDBACK_L0.FRASI_TESTO.documento]);
  assert.deepEqual(r.esito.pezzi.map((p) => p.testo), ['4539 1488 0343 6467'], 'la carta scritta a gruppi si evidenzia com\'è scritta');
  assert.ok(r.esito.pezzi.every((p) => p.tipo === 'documento'));
});
