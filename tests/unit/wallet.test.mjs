// Unit test di src/shared/wallet.js (SN_WALLET) — crediti sul server e chiave
// personale (#598). Logica pura: node:test, niente Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
require('../../src/shared/wallet.js');
require('../../src/shared/chatErrors.js');
const W = globalThis.SN_WALLET;
const CE = globalThis.SN_CHAT_ERRORS;

test('402 è «crediti finiti», in tutte le forme in cui arriva; 429 e 500 no', () => {
  const e402 = Object.assign(new Error('OpenRouter 402: {"error":{"code":402}}'), { status: 402, provider: 'openrouter' });
  assert.equal(W.isOutOfCredits(e402), true);
  assert.equal(W.isOutOfCredits(new Error('OpenRouter 402: insufficient')), true, 'anche senza status strutturato');
  assert.equal(W.isOutOfCredits(new Error('Key limit exceeded')), true);
  assert.equal(W.isOutOfCredits(Object.assign(new Error('x'), { status: 429 })), false);
  assert.equal(W.isOutOfCredits(Object.assign(new Error('x'), { status: 500 })), false);
  assert.equal(W.isOutOfCredits(null), false);
});

test('402 in chat diventa una frase che dice cosa fare, senza il codice nudo', () => {
  const e = Object.assign(new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'), { status: 402, provider: 'openrouter' });
  const out = CE.friendly(e);
  assert.match(out, /crediti/i);
  assert.match(out, /chiave OpenRouter/i);
  assert.ok(!/402/.test(out), `il codice HTTP è passato: ${out}`);
  assert.ok(!/Insufficient/.test(out), `il messaggio grezzo è passato: ${out}`);
});

test('402 non è un guasto di rete passeggero: non si ritenta', () => {
  const e = Object.assign(new Error('OpenRouter 402: no credits'), { status: 402, provider: 'openrouter' });
  assert.equal(CE.isTransientNetwork(e), false);
});

test('dollari → crediti coi parametri del server, per eccesso al decimo', () => {
  // 0,00084 $ a 1,20 = 1 credito esatto (0,0007 € × 1,2)
  assert.equal(W.creditsForUsd(0.00084, { eurPerCredit: 0.0007, eurUsd: 1.2 }), 1);
  assert.equal(W.creditsForUsd(0.001, { eurPerCredit: 0.0007, eurUsd: 1.2 }), 1.2);
  assert.equal(W.creditsForUsd(0, {}), 0);
  assert.equal(W.creditsForUsd('x', {}), 0);
  assert.ok(W.creditsForUsd(0.01, {}) > 0, 'senza parametri usa un ripiego, non zero');
});

test('la riga del registro ha SOLO i campi del contratto, nell\'ordine, con tipi sani', () => {
  const row = W.usageRow({
    pseudonym: 'abc', action: 'CHAT', model: 'm', servedBy: 'Fireworks',
    usage: { promptTokens: 12.7, completionTokens: -3, costUsd: 0.002, cachedPromptTokens: 5, extra: 'no' },
    credits: 2.4, at: '2026-09-08T10:00:00.000Z',
  });
  assert.deepEqual(Object.keys(row), [...W.USAGE_FIELDS]);
  assert.equal(row.promptTokens, 12);
  assert.equal(row.completionTokens, 0);
  assert.equal(row.costUsd, 0.002);
  assert.equal(row.credits, 2.4);
  assert.equal(row.at, '2026-09-08T10:00:00.000Z');
  assert.equal(W.usageRow({ action: 'CHAT' }), null, 'senza pseudonimo non c\'è riga');
  assert.equal(W.usageRow({ pseudonym: 'p', costUsd: 'boh' }).costUsd, 0);
});

test('la riga del registro sta nei tetti di lunghezza della regola, e i tetti sono quelli di firestore.rules', () => {
  const regole = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const blocco = regole.slice(regole.indexOf('match /wallet-usage/{id}'));
  for (const [campo, tetto] of Object.entries(W.USAGE_LIMITS)) {
    const m = blocco.match(new RegExp(`request\\.resource\\.data\\.${campo}\\.size\\(\\) <= (\\d+)`));
    assert.ok(m, `la regola non ha più il tetto su ${campo}`);
    assert.equal(Number(m[1]), tetto, `tetto di ${campo}`);
  }
  const row = W.usageRow({ pseudonym: 'abcdef0123456789', action: 'A'.repeat(300), model: 'm'.repeat(500), servedBy: 's'.repeat(300) });
  for (const [campo, tetto] of Object.entries(W.USAGE_LIMITS)) assert.ok(row[campo].length <= tetto, `${campo} lungo ${row[campo].length}`);
  assert.equal(row.model, 'm'.repeat(200));
});

test('una riga che il server rifiuta non ferma le altre: il lotto si divide finché resta sola (#1601)', async () => {
  const righe = ['a', 'b', 'CATTIVA', 'c', 'd'].map((id) => ({ id }));
  const visti = [];
  const commit = async (lotto) => {
    visti.push(lotto.map((r) => r.id));
    return lotto.some((r) => r.id === 'CATTIVA') ? { ok: false, motivo: '403: Missing or insufficient permissions.' } : { ok: true };
  };
  const esito = await W.scriviIsolando(righe, commit);
  assert.deepEqual(esito.scritte.map((r) => r.id), ['a', 'b', 'c', 'd'], 'le buone passano, nell\'ordine');
  assert.deepEqual(esito.rifiutate.map((x) => x.riga.id), ['CATTIVA']);
  assert.match(esito.rifiutate[0].motivo, /403/);
  assert.deepEqual(esito.rimaste, []);
  assert.equal(esito.errore, null);
  assert.ok(visti.length <= 7, `troppi commit: ${JSON.stringify(visti)}`);

  const tutteCattive = await W.scriviIsolando(righe, async () => ({ ok: false, motivo: 'no' }));
  assert.equal(tutteCattive.rifiutate.length, righe.length);
  assert.equal(tutteCattive.scritte.length, 0);

  assert.deepEqual(await W.scriviIsolando([], commit), { scritte: [], rifiutate: [], rimaste: [], errore: null });
});

test('rifiuto della riga o guasto: la regola che dice no sì, la chiave API ruotata o la rete no', () => {
  const regola = '{ "error": { "code": 403, "message": "Missing or insufficient permissions.", "status": "PERMISSION_DENIED" } }';
  assert.equal(W.rifiutoDellaRigaUso(403, regola), true);
  assert.equal(W.rifiutoDellaRigaUso(400, '{ "error": { "code": 400, "message": "Invalid value at \'writes[0].update.fields[1].value\'", "status": "INVALID_ARGUMENT" } }'), true);
  assert.equal(W.rifiutoDellaRigaUso(400, '{ "error": { "code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT" } }'), false);
  assert.equal(W.rifiutoDellaRigaUso(403, '{ "error": { "code": 403, "message": "Requests to this API firestore.googleapis.com method google.firestore.v1.Firestore.Commit are blocked.", "status": "PERMISSION_DENIED", "details": [{ "reason": "API_KEY_SERVICE_BLOCKED" }] } }'), false);
  for (const st of [401, 404, 429, 500, 503]) assert.equal(W.rifiutoDellaRigaUso(st, regola), false, `${st}`);
});

test('un guasto passeggero a metà ferma gli invii e tiene tutto ciò che non è passato, nell\'ordine', async () => {
  const righe = ['a', 'CATTIVA', 'b', 'c'].map((id) => ({ id }));
  let n = 0;
  const commit = async (lotto) => {
    n += 1;
    if (n === 4) throw new Error('fetch failed');
    return lotto.some((r) => r.id === 'CATTIVA') ? { ok: false, motivo: '403' } : { ok: true };
  };
  const esito = await W.scriviIsolando(righe, commit);
  const contate = [...esito.scritte, ...esito.rifiutate.map((x) => x.riga), ...esito.rimaste].map((r) => r.id).sort();
  assert.deepEqual(contate, ['CATTIVA', 'a', 'b', 'c'], 'nessuna riga persa né doppia');
  assert.match(String(esito.errore && esito.errore.message), /fetch failed/);
  assert.ok(esito.rimaste.length > 0);
  const ordine = righe.map((r) => r.id).filter((id) => esito.rimaste.some((r) => r.id === id));
  assert.deepEqual(esito.rimaste.map((r) => r.id), ordine);
});

test('la riga della pagina Crediti sui consumi non registrati: numero, motivo, singolare e plurale', () => {
  assert.equal(W.registroScartateTesto(null), '');
  assert.equal(W.registroScartateTesto({ rifiutata: 0 }), '');
  assert.equal(W.registroScartateTesto({ rifiutata: 1 }), 'Un consumo non è stato registrato: rifiutato dal server.');
  assert.equal(W.registroScartateTesto({ altra_identita: 3 }), '3 consumi non sono stati registrati: di un portafoglio di prima.');
  const misto = W.registroScartateTesto({ rifiutata: 1, altra_identita: 2, coda_piena: 4, ignoto: 9 });
  assert.equal(misto, '7 consumi non sono stati registrati: 1 rifiutato dal server, 2 di un portafoglio di prima, 4 persi perché ce n\'erano troppi in attesa.');
});

test('il messaggio di crediti finiti distingue chiave di Filo e chiave propria', () => {
  assert.match(W.outOfCreditsMessage({ usingOwnKey: true }), /tua chiave OpenRouter/);
  assert.match(W.outOfCreditsMessage({ usingOwnKey: true }), /togli la chiave/);
  const mine = W.outOfCreditsMessage({ dailyCredits: 100 });
  assert.match(mine, /crediti di Filo sono finiti/);
  assert.match(mine, /100/);
  assert.match(W.outOfCreditsMessage({}), /domani/);
});

test('ogni esito del server ha una frase; uno sconosciuto cade su quella generica', () => {
  for (const s of ['ok', 'invalid_code', 'code_used', 'own_code', 'already_in', 'invites_exhausted', 'global_cap', 'missing_exchange_rate', 'not_configured', 'provider_error', 'internal', 'not_reachable', 'inviter_not_linked', 'network_cap']) {
    assert.ok(W.redeemMessage(s).length > 10, s);
  }
  assert.equal(W.redeemMessage('boh'), W.REDEEM_MESSAGES.internal);
});

test('troppe chiavi nuove nel mese (#1520): il rifiuto del server si dice, non cade su «qualcosa è andato storto»', () => {
  assert.notEqual(W.redeemMessage('too_many_reissues'), W.REDEEM_MESSAGES.internal);
  assert.match(W.redeemMessage('too_many_reissues'), /chiavi nuove/);
});

// #1503: i rifiuti della nuova chiave non cadono su «qualcosa è andato storto», che invita a riprovare subito.
test('ogni rifiuto della nuova chiave ha la sua frase, diversa dalle altre e da quella generica', () => {
  const nuovi = ['busy', 'too_soon', 'suspended', 'empty', 'conflict'];
  const frasi = nuovi.map((s) => W.redeemMessage(s));
  for (const [i, s] of nuovi.entries()) {
    assert.ok(Object.hasOwn(W.REDEEM_MESSAGES, s), s);
    assert.notEqual(frasi[i], W.REDEEM_MESSAGES.internal, s);
  }
  assert.equal(new Set(frasi).size, nuovi.length);
  assert.match(W.redeemMessage('too_soon'), /dieci minuti/);
  assert.match(W.redeemMessage('suspended'), /sospesi/);
  assert.match(W.redeemMessage('empty'), /finiti/);
  assert.ok(W.redeemMessage('provider_error').length > 10);
});

// Un invito vale per più persone: un rifiuto per posti finiti non si racconta
// come «il codice è già stato usato», o chi l'ha ricevuto crede che se lo sia
// speso chi gliel'ha mandato e va a chiedergliene un altro che non esiste.
test('l’invito pieno si spiega coi posti finiti, non come un codice a un uso solo', () => {
  const frase = W.redeemMessage('code_used');
  assert.ok(!/gi[àa] stato usato/i.test(frase), frase);
  assert.match(frase, /post[oi]/i);
});

test('il codice si estrae da quello che si incolla: riga intera, spazi, minuscole; il resto torna com\'è', () => {
  // Un codice già pulito passa com'è: lo normalizza il server.
  assert.equal(W.extractCode('ABCD-EFGH'), 'ABCD-EFGH');
  assert.equal(W.extractCode(' abcd - efgh '), 'abcd - efgh');
  assert.equal(W.extractCode('Codice: ABCD-EFGH'), 'ABCDEFGH');
  assert.equal(W.extractCode('il tuo invito è abcd efgh, buon divertimento'), 'ABCDEFGH');
  assert.equal(W.extractCode('https://filo.red/?invito=ABCD-EFGH'), 'ABCDEFGH');
  // Niente codice dentro: si passa il testo com'è, e il server dirà «non esiste».
  assert.equal(W.extractCode('A'.repeat(10000)), 'A'.repeat(10000));
  assert.equal(W.extractCode('<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(W.extractCode('   '), '');
  assert.equal(W.extractCode(''), '');
});

// #1138: il conteggio locale non passa al portafoglio, e la frase non lo nomina
// qualunque cosa il server rimandi (un server ancora col tetto vecchio compreso).
test('la frase del riscatto riuscito dice solo i crediti d’ingresso, mai quelli di prima', () => {
  const casi = [
    { migrated: 0, localRequested: 0, cutReason: null },
    { migrated: 0, localRequested: 1000, cutReason: 'migrate_cap' },
    { migrated: 0, localRequested: 300, cutReason: 'global_cap' },
    { migrated: 0, localRequested: 12000 },
    { migrated: 1010, localRequested: 1010, cutReason: null },
    { migrated: 952, localRequested: 1500, cutReason: 'global_cap' },
  ];
  for (const c of casi) {
    const frase = W.redeemOkMessage({ entryCredits: 5000, ...c });
    assert.equal(frase, 'Invito riscattato: hai 5.000 crediti d’ingresso.', JSON.stringify(c));
    assert.doesNotMatch(frase, /avevi|nessuno|oltre|posto|1\.000|1\.010|12\.000|300|952/);
  }
  // Senza il numero d'ingresso: la frase di sempre, senza cifre.
  assert.equal(W.redeemOkMessage({ entryCredits: 0, migrated: 0, localRequested: 1000 }), W.REDEEM_MESSAGES.ok);
  assert.equal(W.redeemOkMessage(), W.REDEEM_MESSAGES.ok);
  assert.match(W.redeemOkMessage({ entryCredits: 12345 }), /12\.345 crediti d’ingresso/);
});

// ── Link d'invito (#651) ────────────────────────────────────────────────────

test('normalizeCode: codice, codice sporco, link intero — e tutto il resto è null', () => {
  // Il codice com'è, e come lo si copia da un messaggio.
  assert.equal(W.normalizeCode('ABCDEFGH'), 'ABCDEFGH');
  assert.equal(W.normalizeCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(W.normalizeCode('AB CD EF GH'), 'ABCDEFGH');
  // Il link intero, in tutte le forme in cui lo si incolla.
  assert.equal(W.normalizeCode('https://filo.red/i/ABCDEFGH'), 'ABCDEFGH');
  assert.equal(W.normalizeCode('https://filo.red/i/abcdefgh/'), 'ABCDEFGH');
  assert.equal(W.normalizeCode('filo.red/i/ABCD-EFGH'), 'ABCDEFGH');
  assert.equal(W.normalizeCode('filo.red/ABCDEFGH'), 'ABCDEFGH');
  // Lunghezza sbagliata, caratteri ambigui (0 1 I L O non sono nell'alfabeto),
  // niente del tutto.
  assert.equal(W.normalizeCode('ABCD'), null);
  assert.equal(W.normalizeCode('ABCDEFGHIJ'), null);
  assert.equal(W.normalizeCode('ABCD-EFGO'), null, 'la O non esiste nei codici');
  assert.equal(W.normalizeCode('ABCD-EFG0'), null, 'nemmeno lo zero');
  assert.equal(W.normalizeCode('ABCD-EFG1'), null);
  assert.equal(W.normalizeCode(''), null);
  assert.equal(W.normalizeCode(null), null);
  assert.equal(W.normalizeCode(undefined), null);
  assert.equal(W.normalizeCode('   '), null);
  assert.equal(W.normalizeCode('https://filo.red/i/'), null, 'un link senza codice non è un codice');
  assert.equal(W.normalizeCode('x'.repeat(10000)), null, 'un incollato enorme non è un codice');
});

test('formatCode e inviteLink: il codice si legge a metà, il link si dà intero', () => {
  assert.equal(W.formatCode('abcdefgh'), 'ABCD-EFGH');
  assert.equal(W.formatCode('ABCD-EFGH'), 'ABCD-EFGH');
  assert.equal(W.formatCode('non un codice'), 'non un codice', 'formatCode non inventa');
  assert.equal(W.inviteLink('abcd-efgh'), 'https://filo.red/i/ABCDEFGH');
  assert.equal(W.inviteLink('https://filo.red/i/ABCDEFGH'), 'https://filo.red/i/ABCDEFGH');
  assert.equal(W.inviteLink('boh'), '', 'senza un codice valido non si costruisce un link che non porta da nessuna parte');
});

test('codeFromInput: legge anche la riga intera in cui il codice è arrivato', () => {
  assert.equal(W.codeFromInput('Codice: ABCD-EFGH'), 'ABCDEFGH');
  assert.equal(W.codeFromInput('il tuo invito è abcd efgh, buon divertimento'), 'ABCDEFGH');
  assert.equal(W.codeFromInput('https://filo.red/i/ABCDEFGH?utm=chat'), 'ABCDEFGH');
  assert.equal(W.codeFromInput('ciao come stai'), null);
  assert.equal(W.codeFromInput(''), null);
});

// Da un telefono un messaggio si copia tenendolo premuto, e negli appunti
// finisce la frase intera: saluto davanti, congedo dietro, il link in mezzo.
// Il link dev'essere il segno più forte. Prima vinceva il primo blocco di
// quattro più quattro caratteri, e «Ciao Anna» faceva rifiutare un incollaggio
// giusto (terzo giro di verifica del #651).
test('codeFromInput: il link dentro un messaggio intero vince sulle parole intorno', () => {
  const messaggi = [
    'Ciao Anna, ecco: https://filo.red/i/ABCDEFGH fammi sapere',
    'Ciao Luca, ecco: https://filo.red/i/ABCDEFGH ci vediamo',
    'Ciao come va, ecco il link https://filo.red/i/ABCDEFGH fammi sapere',
    'Anna ecco https://filo.red/i/ABCDEFGH subito',
    'Ecco qua: https://filo.red/i/ABCD-EFGH — scaricalo',
    'Ciao Anna, ecco: filo://invito/ABCDEFGH fammi sapere',
    'Ciao Anna, ecco: filo.red/i/abcdefgh fammi sapere',
  ];
  for (const m of messaggi) assert.equal(W.codeFromInput(m), 'ABCDEFGH', m);
  // Un messaggio senza nessun link resta quello che era: nessun codice.
  assert.equal(W.codeFromInput('Ciao Anna, come stai?'), null);
  assert.equal(W.codeFromInput('Ciao Anna, ecco: https://filo.red/i/ fammi sapere'), null);
});

// Lo stesso messaggio, ma col CODICE nudo al posto del link: capita perché
// accanto a ogni invito c'è un pulsante che copia il solo codice, e perché la
// pagina del link, a chi arriva da un telefono, dice di segnarselo. Il saluto
// davanti non deve mangiarsi il codice: si guardano tutti i blocchi di otto
// caratteri, non solo il primo (quarto giro di verifica del #651).
test('codeFromInput: il codice nudo si trova anche col saluto davanti', () => {
  const messaggi = [
    'Ciao Anna, ecco il codice: ABCD-EFGH',
    'Ciao Anna, il tuo codice è ABCDEFGH',
    'Anna ecco ABCD-EFGH',
    'Ciao Sara, ecco: ABCD-EFGH a dopo',
    // Il blocco scartato si mangia metà di quello buono: «ecco ABCD» prima,
    // e «ABCD EFGH» non veniva più guardato.
    'Ciao Luca, ecco ABCD EFGH a dopo',
  ];
  for (const m of messaggi) assert.equal(W.codeFromInput(m), 'ABCDEFGH', m);
  // Le parole di una frase qualsiasi non diventano un codice: l'alfabeto dei
  // codici non ha I, L, O, zero e uno.
  assert.equal(W.codeFromInput('Ciao Anna, come stai?'), null);
  assert.equal(W.codeFromInput('buon giro a tutti quanti'), null);
});

// Un saluto fatto di lettere che un codice può avere («Cara Sara», «Sera
// Anna») è otto caratteri buoni: non deve vincere sul codice che segue (#664).
// Il codice scritto come si mostra (col trattino, con una cifra, in
// maiuscolo) passa davanti; a pari segni il server sceglie, e chi riscatta
// prova il blocco dopo.
test('codesFromInput: il saluto che sembra un codice non vince sul codice', () => {
  for (const m of [
    'Cara Sara, ecco il codice: ABCD-EFGH',
    'Sera Anna, ecco il codice: ABCD-EFGH fammi sapere',
    'Bene Anna, ti mando il codice ABCD-EFGH',
    'Cara Sara ABCDEFGH',
    'cara sara, il codice è abcd-efgh',
  ]) {
    assert.equal(W.codeFromInput(m), 'ABCDEFGH', m);
  }
  assert.equal(W.codeFromInput('Cara Sara, ecco: AB2D EFGH'), 'AB2DEFGH', 'una cifra: le parole non ne hanno');
  // A pari segni restano tutti e due, nell'ordine del testo.
  assert.deepEqual(W.codesFromInput('CARA SARA ABCDEFGH'), ['CARASARA', 'ABCDEFGH']);
  assert.deepEqual(W.codesFromInput('ABCD-EFGH e ancora ABCD-EFGH'), ['ABCDEFGH'], 'lo stesso codice si prova una volta');
  assert.deepEqual(W.codesFromInput('ciao come stai'), []);
  assert.ok(W.CODE_TRIES >= 3, 'un messaggio vero ha saluto, codice e magari una firma');
  assert.match(W.tooManyCodesMessage(12, 5), /12 blocchi.*primi 5/);
});

// Il campo si legge nel main: una lettura che cresce col quadrato della
// lunghezza ferma tutte le schede per decine di secondi (#664).
test('codesFromInput: un incollaggio lunghissimo si legge in fretta', () => {
  // Duecentomila caratteri: la lettura di prima ci metteva quasi un minuto,
  // migliaia di unità di riferimento; quella lineare ne costa qualcuna.
  const n = 200000;
  const testi = {
    trattini: '-'.repeat(n),
    lettere: 'a'.repeat(n),
    codici: 'ABCD EFGH '.repeat(n / 10),
    sottodomini: ('x'.repeat(30) + '.').repeat(n / 31),
    link: ('filo.red/i/' + '-'.repeat(1000) + ' ').repeat(n / 1012),
    barre: ('filo:' + '/'.repeat(1000)).repeat(n / 1005),
  };
  for (const [nome, t] of Object.entries(testi)) {
    const c = costoInUnita(() => W.codesFromInput(t), { tetto: 30 });
    assert.ok(c.entro, `${nome}: ${c.come}`);
  }
});

test('inviteCodeFromLink: il link di filo.red e filo://invito, nient\'altro', () => {
  assert.equal(W.inviteCodeFromLink('https://filo.red/i/ABCD-EFGH'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromLink('https://www.filo.red/i/abcdefgh/'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromLink('filo://invito/abcd-efgh'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromLink('https://filo.red.evil.com/i/ABCDEFGH'), null);
  assert.equal(W.inviteCodeFromLink('https://evil.com/filo.red/i/ABCDEFGH'), null);
  assert.equal(W.inviteCodeFromLink('https://filo.red/i/ABCD'), null, 'codice storto: niente voce');
  assert.equal(W.inviteCodeFromLink('https://filo.red/'), null);
  assert.equal(W.inviteCodeFromLink('filo://credits/credits.html'), null);
  assert.equal(W.inviteCodeFromLink('javascript:alert(1)'), null);
  assert.equal(W.inviteCodeFromLink(''), null);
});

test('filo://invito/<codice>: si accetta il solo host invito, il resto non apre niente', () => {
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/ABCDEFGH'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/abcd-efgh'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/ABCDEFGH/'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromDeepLink('FILO://INVITO/abcdefgh'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/ABCDEFGH?da=chat'), 'ABCDEFGH');
  // Il sistema consegna QUALUNQUE filo://…: una pagina interna messa in un
  // link da un sito qualsiasi non deve aprire niente.
  assert.equal(W.inviteCodeFromDeepLink('filo://credits/credits.html'), null);
  assert.equal(W.inviteCodeFromDeepLink('filo://shell/shell.html'), null);
  assert.equal(W.inviteCodeFromDeepLink('filo://newtab/'), null);
  assert.equal(W.inviteCodeFromDeepLink('filo://invito.example.com/ABCDEFGH'), null);
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/../credits/credits.html'), null);
  assert.equal(W.inviteCodeFromDeepLink('https://filo.red/i/ABCDEFGH'), null, 'un link web non è un deep link');
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/ABCD'), null);
  assert.equal(W.inviteCodeFromDeepLink(''), null);
  assert.equal(W.inviteCodeFromDeepLink(null), null);
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/%41BCDEFGH'), 'ABCDEFGH');
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/%zz'), null, 'una percentuale storta non fa esplodere niente');
});

test('un invito col codice storto è comunque un invito: si dice, non si tace', () => {
  // «Non è un invito» e «è un invito ma il codice è storto» sono due cose
  // diverse: la prima si lascia cadere in silenzio (l'ha scritta una pagina),
  // la seconda va detta (l'ha cliccata una persona, che aspetta qualcosa).
  assert.equal(W.isInviteDeepLink('filo://invito/ABCDEFGH'), true);
  assert.equal(W.isInviteDeepLink('filo://invito/ABCD'), true);
  assert.equal(W.isInviteDeepLink('filo://invito/'), true);
  assert.equal(W.isInviteDeepLink('filo://credits/credits.html'), false);
  assert.equal(W.isInviteDeepLink('https://filo.red/i/ABCDEFGH'), false);
  assert.equal(W.isInviteDeepLink(''), false);
  assert.equal(W.inviteCodeFromDeepLink('filo://invito/ABCD'), null);
});

test('l\'indirizzo si CERCA negli argomenti: la posizione non è mai fissa', () => {
  // In sviluppo il secondo argomento è «.», nei test «.» è l'ultimo: cercarlo
  // per posizione vuol dire trovarlo solo per caso.
  assert.equal(W.filoUrlFromArgv(['filo.exe', 'filo://invito/ABCDEFGH']), 'filo://invito/ABCDEFGH');
  assert.equal(W.filoUrlFromArgv(['electron.exe', '.', 'filo://invito/abcd-efgh']), 'filo://invito/abcd-efgh');
  assert.equal(W.filoUrlFromArgv(['electron.exe', 'filo://invito/ABCDEFGH', '.']), 'filo://invito/ABCDEFGH');
  assert.equal(W.filoUrlFromArgv(['filo.exe', '--flag', '.']), null);
  assert.equal(W.filoUrlFromArgv([]), null);
  assert.equal(W.filoUrlFromArgv(null), null);
});

test('un invito si legge a posti: «entrati N su M», e i vecchi valgono un posto solo', () => {
  const tre = W.inviteView({
    code: 'ABCD-EFGH', link: 'https://filo.red/i/ABCDEFGH', used: 2, max: 3,
    uses: [{ pseudonym: 'aaaa1111bbbb2222', at: '2026-09-10T10:00:00.000Z' }, { pseudonym: 'cccc3333dddd4444', at: null }],
    revoked: false,
  });
  assert.equal(tre.used, 2);
  assert.equal(tre.left, 1);
  assert.equal(tre.exhausted, false);
  assert.equal(W.inviteStateLine(tre), 'entrati 2 su 3');
  assert.equal(tre.uses.length, 2);

  const pieno = W.inviteView({ code: 'ABCDEFGH', used: 3, max: 3, uses: [{}, {}, {}] });
  assert.equal(pieno.exhausted, true);
  assert.equal(W.inviteStateLine(pieno), 'entrati 3 su 3');

  // Il link si ricostruisce se il server non lo manda (portafoglio letto da
  // una copia vecchia dello stato).
  assert.equal(W.inviteView({ code: 'ABCD-EFGH', used: 0, max: 3 }).link, 'https://filo.red/i/ABCDEFGH');

  // Forma vecchia: «used» booleano, nessun «max».
  const vecchio = W.inviteView({ code: 'AAAA-2222', used: true, usedAt: '2026-09-08T10:00:00.000Z' });
  assert.equal(vecchio.max, 1);
  assert.equal(vecchio.used, 1);
  assert.equal(vecchio.exhausted, true);
  assert.equal(W.inviteStateLine(vecchio), 'entrati 1 su 1');
  const vecchioLibero = W.inviteView({ code: 'AAAA-2222', used: false });
  assert.equal(vecchioLibero.exhausted, false);
  assert.equal(W.inviteStateLine(vecchioLibero), 'entrati 0 su 1');

  // Annullato dall'owner: lo dice, e non conta i posti.
  assert.equal(W.inviteStateLine(W.inviteView({ code: 'ABCDEFGH', used: 0, max: 3, revoked: true })), 'annullato');
});

test('un codice storto non arriva nemmeno al server: lo dice la frase', () => {
  assert.match(W.redeemMessage('bad_code'), /otto caratteri/);
  assert.match(W.entryNoticeText({ credits: 5000 }), /5\.000 crediti/);
  assert.match(W.entryNoticeText({}), /crediti sono pronti/);
});

// #652 — i movimenti del portafoglio. Il `why` che arriva dal server è un
// codice, a volte con l'id del feedback attaccato: chi legge la pagina Crediti
// deve trovarci una frase.
test('un movimento del portafoglio si legge in italiano, anche con l’id attaccato', () => {
  assert.equal(W.grantLabel('entry'), 'Invito riscattato');
  assert.equal(W.grantLabel('daily'), 'Quota del giorno');
  assert.equal(W.grantLabel('owner'), 'Regalo di Filo');
  assert.equal(W.grantLabel('gift'), 'Regalo di Filo');
  assert.equal(W.grantLabel('feedback_sent:aBc123'), 'Segnalazione inviata');
  assert.equal(W.grantLabel('feedback_closed:aBc123'), 'Segnalazione risolta');
  assert.equal(W.grantLabel('qualcosa_di_nuovo'), 'Crediti ricevuti', 'un motivo sconosciuto non lascia la riga vuota');
  assert.equal(W.grantLabel(''), 'Crediti ricevuti');
  assert.equal(W.grantLabel(null), 'Crediti ricevuti');
});

// #652 — le manopole della pagina dell'owner. La tabella sta qui perché
// la usano sia la pagina (per disegnare i campi) sia il main (per rifiutare un
// numero storto prima di scriverlo): se divergessero, il main accetterebbe
// quello che la pagina rifiuta.
test('le manopole dei crediti sono undici, hanno un nome e limiti sensati', () => {
  assert.equal(W.OWNER_KNOBS.length, 11);
  assert.deepEqual(W.OWNER_KNOB_KEYS, [
    'entryCredits', 'dailyCredits', 'invitesPerUser', 'invitesMaxUses', 'invitesRemaining',
    'maxGrantCredits', 'rewardFeedbackSent', 'rewardSentPerDay', 'rewardFeedbackClosed', 'redeemsPerNetwork', 'redeemsPerNetworkHours',
  ]);
  // #1077 — il tetto giornaliero dei premi d'invio si può chiudere (zero) e aprire a molti.
  assert.equal(W.knobOf('rewardSentPerDay').min, 0);
  assert.ok(W.knobOf('rewardSentPerDay').max >= 1000);
  for (const k of W.OWNER_KNOBS) {
    assert.ok(k.etichetta && k.etichetta.length > 2, `${k.chiave}: serve un nome leggibile`);
    assert.ok(k.aiuto && k.aiuto.length > 10, `${k.chiave}: serve una spiegazione`);
    assert.ok(Number.isInteger(k.min) && k.min >= 0, `${k.chiave}: niente valori negativi`);
    assert.ok(k.max > k.min, `${k.chiave}: il tetto deve stare sopra il minimo`);
  }
  // Un invito per zero persone non è un invito: quella manopola parte da 1.
  assert.equal(W.knobOf('invitesMaxUses').min, 1);
  assert.equal(W.knobOf('non-esiste'), null);
  // #854 — gli ingressi con invito si possono chiudere (zero) e aprire a molti: il tetto ferma un errore di
  // battitura, non un lancio.
  const ingressi = W.knobOf('invitesRemaining');
  assert.equal(ingressi.etichetta, 'Ingressi con invito rimasti');
  assert.equal(ingressi.aiuto, 'Quante persone possono ancora entrare con un invito, in tutto. A zero nessun invito funziona più.');
  assert.equal(ingressi.min, 0);
  assert.ok(ingressi.max >= 1000000);
  // #1120 — il tetto per rete si spegne a zero; la finestra dura almeno un'ora e arriva a un anno.
  assert.equal(W.knobOf('redeemsPerNetwork').min, 0);
  assert.match(W.knobOf('redeemsPerNetwork').aiuto, /A zero nessun limite/);
  assert.equal(W.knobOf('redeemsPerNetworkHours').min, 1);
  assert.ok(W.knobOf('redeemsPerNetworkHours').max >= 24 * 365);
});

// #1120 — chi trova il tetto per rete deve sapere quando riprovare, coi numeri del server, e che il codice resta buono.
test('tetto per rete: la frase dice quante persone, in quante ore, e l\'ora in cui riprovare', () => {
  const ora = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const ieri = new Date(2026, 9, 21, 9, 0).getTime();
  const domani = new Date(2026, 9, 22, 8, 30).toISOString();
  const f = W.redeemMessage('network_cap', { status: 'network_cap', reopensAt: domani, cap: 3, hours: 24 });
  assert.equal(f, W.networkCapMessage({ reopensAt: domani, cap: 3, hours: 24 }));
  const g = W.networkCapMessage({ reopensAt: domani, cap: 3, hours: 24 }, ieri);
  assert.equal(g, `Da questa connessione sono già entrate 3 persone nelle ultime 24 ore. Il tuo codice resta valido, riprova domani dopo le ${ora(domani)}.`);
  const oggi = new Date(2026, 9, 21, 17, 5).toISOString();
  assert.match(W.networkCapMessage({ reopensAt: oggi, cap: 1, hours: 1 }, ieri), new RegExp(`è già entrata una persona nell’ultima ora\\. .* riprova dopo le ${ora(oggi)}\\.$`));
  const fra3 = new Date(2026, 9, 24, 10, 0).toISOString();
  assert.match(W.networkCapMessage({ reopensAt: fra3, cap: 3, hours: 24 }, ieri), /riprova da sabato 24 ottobre alle 10:00\.$/);
  for (const storto of [{}, { reopensAt: 'mai' }, null, undefined]) {
    assert.equal(W.redeemMessage('network_cap', storto), W.REDEEM_MESSAGES.network_cap, JSON.stringify(storto));
  }
  assert.match(W.REDEEM_MESSAGES.network_cap, /resta valido/);
  assert.match(W.redeemMessage('inviter_not_linked'), /Google/);
});

// #854 — il main rifà il controllo della pagina con la stessa tabella: un numero storto per gli ingressi
// non arriva a config/credits nemmeno se la pagina venisse saltata.
test('gli ingressi con invito si rifiutano come le altre manopole: negativi, decimali e parole no', () => {
  require('../../src/shared/campoNumero.js');
  const CN = globalThis.SN_CAMPO_NUMERO;
  const k = W.knobOf('invitesRemaining');
  const regole = { min: k.min, max: k.max, intero: true, etichetta: k.etichetta };
  assert.deepEqual(CN.controlla('20', regole), { ok: true, valore: 20 });
  assert.deepEqual(CN.controlla('0', regole), { ok: true, valore: 0 });
  assert.equal(CN.controlla('-1', regole).testo, 'Ingressi con invito rimasti: non può essere negativo.');
  assert.equal(CN.controlla('2,5', regole).testo, 'Ingressi con invito rimasti: un numero intero, senza virgola.');
  assert.equal(CN.controlla('venti', regole).testo, 'Ingressi con invito rimasti: ci vuole un numero.');
});

// ── #816: le cifre dette fuori dalla pagina Crediti ─────────────────────────

test('formatCredits scrive il saldo come la pagina Crediti: un decimale al più, alla italiana', () => {
  assert.equal(W.formatCredits(4321.5), new Intl.NumberFormat('it-IT', { useGrouping: true, maximumFractionDigits: 1 }).format(4321.5));
  assert.equal(W.formatCredits(4321.5), '4.321,5');
  assert.equal(W.formatCredits(12345.44), '12.345,4');
  assert.equal(W.formatCredits(0.3), '0,3');
  assert.equal(W.formatCredits(null), '0');
});

const ORA = Date.parse('2026-09-28T12:00:00.000Z');
const scheda = (extra = {}) => ({
  _id: 'fbX', status: 'done', statusPublic: 'closed',
  createdAt: '2026-09-20T10:00:00.000Z', resolvedAt: '2026-09-28T11:00:00.000Z', ...extra,
});

test('risoluzione premiata dal server: si annuncia la cifra del suo movimento', () => {
  const grants = [
    { at: '2026-09-28T11:00:05.000Z', credits: 50, why: 'feedback_closed:fbX' },
    { at: '2026-09-20T10:00:05.000Z', credits: 10, why: 'feedback_sent:fbX' },
  ];
  assert.deepEqual(W.resolutionReward({ card: scheda(), grants, grantsFresh: true, now: ORA }), { announce: true, credits: 50 });
  // Il premio d'invio della stessa segnalazione non è quello di risoluzione.
  assert.deepEqual(W.resolutionReward({ card: scheda(), grants: grants.slice(1), grantsFresh: true, now: ORA }), { announce: false, credits: 0 });
});

test('movimento non ancora arrivato: si aspetta, e dopo un giorno si annuncia senza cifra', () => {
  assert.deepEqual(W.resolutionReward({ card: scheda(), grants: [], grantsFresh: true, now: ORA }), { announce: false, credits: 0 });
  const dopo = ORA + W.PREMIO_ATTESA_MS;
  assert.deepEqual(W.resolutionReward({ card: scheda(), grants: [], grantsFresh: true, now: dopo }), { announce: true, credits: 0 });
  // Con i movimenti di una lettura vecchia (server muto) quello che manca può
  // solo non essere ancora letto: si aspetta comunque.
  assert.deepEqual(W.resolutionReward({ card: scheda(), grants: [], grantsFresh: false, now: dopo }), { announce: false, credits: 0 });
  assert.deepEqual(W.resolutionReward({ card: scheda(), grants: null, grantsFresh: false, now: ORA }), { announce: false, credits: 0 });
});

test('archiviata o doppione: il server non la premia, si annuncia senza cifra e senza aspettare', () => {
  assert.deepEqual(W.resolutionReward({ card: scheda({ status: 'archived' }), grants: [], grantsFresh: true, now: ORA }), { announce: true, credits: 0 });
  assert.deepEqual(W.resolutionReward({ card: scheda({ status: 'archived' }), grants: null, grantsFresh: false, now: ORA }), { announce: true, credits: 0 });
});

test('segnalazione mandata prima del riscatto: il server non sa a chi darlo, niente attesa', () => {
  const r = W.resolutionReward({ card: scheda(), grants: [], grantsFresh: true, redeemedAt: '2026-09-25T00:00:00.000Z', now: ORA });
  assert.deepEqual(r, { announce: true, credits: 0 });
});

// Il preload delle pagine manda il clic sull'invito prima che SN_MSG esista,
// col valore letterale: se il nome del messaggio cambia, il clic non arriva più.
test('il clic sull\'invito dal preload delle pagine usa il messaggio giusto', async () => {
  const { readFileSync } = await import('node:fs');
  require('../../src/shared/messages.js');
  const preload = readFileSync(new URL('../../src/preload/page-preload.js', import.meta.url), 'utf8');
  assert.ok(globalThis.SN_MSG.MSG.WALLET_INVITE_OPEN, 'il messaggio esiste');
  assert.ok(preload.includes(`type: '${globalThis.SN_MSG.MSG.WALLET_INVITE_OPEN}'`), 'il preload lo chiama col suo nome');
});

// #1077 — il server paga al più N premi d'invio al giorno (UTC) per portafoglio: il messaggio d'invio non
// promette un premio oltre il tetto. Contano i premi già arrivati oggi più gli invii di oggi ancora senza premio.
test('premio d\'invio: oltre il tetto del giorno non si promette, e la frase dice perché', () => {
  const ORA = Date.parse('2026-10-06T19:00:00Z');
  const oggi = (h) => `2026-10-06T${String(h).padStart(2, '0')}:00:00.000Z`;
  const arrivati = (n) => Array.from({ length: n }, (_, i) => ({ at: oggi(8 + i), credits: 10, why: `feedback_sent:f${i}` }));
  assert.deepEqual(W.premioInvio({ grants: arrivati(4), perDay: 5, now: ORA }), { esaurito: false, perDay: 5 });
  assert.deepEqual(W.premioInvio({ grants: arrivati(5), perDay: 5, now: ORA }), { esaurito: true, perDay: 5 });
  // Gli invii il cui premio non è ancora arrivato contano; quelli già pagati non contano due volte.
  const invii = [{ id: 'f2', at: ORA - 3000 }, { id: 'n1', at: ORA - 2000 }, { id: 'n2', at: ORA - 1000 }];
  assert.equal(W.premioInvio({ grants: arrivati(3), perDay: 5, invii, now: ORA }).esaurito, true, '3 pagati + 2 in attesa');
  assert.equal(W.premioInvio({ grants: arrivati(3), perDay: 6, invii, now: ORA }).esaurito, false, 'f2 è già fra i pagati');
  assert.equal(W.premioInvio({ grants: arrivati(3), perDay: 5, invii: [{ at: ORA - 1000 }, { id: '', at: ORA - 500 }], now: ORA }).esaurito, true, 'un invio senza id conta come in attesa');
  // Ieri non conta, né i premi che non sono d'invio.
  const ieri = [
    ...Array.from({ length: 5 }, (_, i) => ({ at: '2026-10-05T10:00:00.000Z', credits: 10, why: `feedback_sent:v${i}` })),
    { at: oggi(3), credits: 100, why: 'daily' }, { at: oggi(4), credits: 50, why: 'feedback_closed:x' }, null,
  ];
  assert.equal(W.premioInvio({ grants: ieri, perDay: 5, invii: [{ id: 'y', at: Date.parse('2026-10-05T23:00:00Z') }, null], now: ORA }).esaurito, false);
  // Senza tetto noto (server vecchio, stato mai letto) non si nega niente.
  for (const perDay of [undefined, null, 'cinque', -1, 2.5]) {
    assert.deepEqual(W.premioInvio({ grants: arrivati(9), perDay, now: ORA }), { esaurito: false, perDay: null }, String(perDay));
  }
  // Tetto a zero: nessun invio paga.
  assert.equal(W.premioInvio({ grants: [], perDay: 0, now: ORA }).esaurito, true);
  assert.equal(W.premioInvioEsauritoTesto(5), 'Il premio vale per i primi 5 feedback del giorno. Questo non ne riceve.');
  assert.equal(W.premioInvioEsauritoTesto(1), 'Il premio vale solo per il primo feedback del giorno. Questo non ne riceve.');
  assert.equal(W.premioInvioEsauritoTesto(0), 'Per ora i feedback inviati non ricevono premi.');
});

// #1077 — la chat risponde dal manifesto: se non sa del tetto dei premi d'invio, non sa spiegare un premio mancato.
test('il manifesto delle capacità dice che i premi d\'invio hanno un tetto al giorno, e quelli di risoluzione no', () => {
  require('../../src/shared/capabilities.js');
  const C = globalThis.SN_CAPABILITIES;
  const crediti = C.get('credits').desc;
  assert.match(crediti, /solo per le prime del giorno/);
  assert.match(crediti, /risolta non ha questo tetto/);
  assert.match(C.get('feedback').desc, /solo per le prime segnalazioni del giorno/);
});
