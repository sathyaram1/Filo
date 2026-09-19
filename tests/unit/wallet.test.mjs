// Unit test di src/shared/wallet.js (SN_WALLET) — crediti sul server e chiave
// personale (#598). Logica pura: node:test, niente Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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

test('il messaggio di crediti finiti distingue chiave di Filo e chiave propria', () => {
  assert.match(W.outOfCreditsMessage({ usingOwnKey: true }), /tua chiave OpenRouter/);
  assert.match(W.outOfCreditsMessage({ usingOwnKey: true }), /togli la chiave/);
  const mine = W.outOfCreditsMessage({ dailyCredits: 100 });
  assert.match(mine, /crediti di Filo sono finiti/);
  assert.match(mine, /100/);
  assert.match(W.outOfCreditsMessage({}), /domani/);
});

test('ogni esito del server ha una frase; uno sconosciuto cade su quella generica', () => {
  for (const s of ['ok', 'invalid_code', 'code_used', 'own_code', 'already_in', 'invites_exhausted', 'global_cap', 'missing_exchange_rate', 'not_configured', 'provider_error', 'internal', 'not_reachable']) {
    assert.ok(W.redeemMessage(s).length > 10, s);
  }
  assert.equal(W.redeemMessage('boh'), W.REDEEM_MESSAGES.internal);
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

test('la frase del riscatto riuscito dice quanti crediti locali sono passati e perché non tutti', () => {
  // Nessun conteggio locale: la frase di sempre.
  assert.equal(W.redeemOkMessage({ entryCredits: 5000, migrated: 0, localRequested: 0 }), W.REDEEM_MESSAGES.ok);
  assert.equal(W.redeemOkMessage(), W.REDEEM_MESSAGES.ok);
  // Tutti passati: i due numeri.
  const tutti = W.redeemOkMessage({ entryCredits: 5000, migrated: 1234, localRequested: 1234, cutReason: null });
  assert.match(tutti, /5\.000 crediti/);
  assert.match(tutti, /i 1\.234 che avevi/);
  // Tagliati dal tetto migrabile: passati, dichiarati, e il motivo.
  const tetto = W.redeemOkMessage({ entryCredits: 5000, migrated: 10000, localRequested: 12000, cutReason: 'migrate_cap' });
  assert.match(tetto, /10\.000 dei 12\.000/);
  assert.match(tetto, /oltre non si portano/);
  // Tagliati dal tetto globale: un motivo diverso.
  const globale = W.redeemOkMessage({ entryCredits: 5000, migrated: 952, localRequested: 1500, cutReason: 'global_cap' });
  assert.match(globale, /952 dei 1\.500/);
  assert.match(globale, /posto/);
  // Nessuno passato.
  assert.match(W.redeemOkMessage({ entryCredits: 5000, migrated: 0, localRequested: 300, cutReason: 'global_cap' }), /nessuno dei 300/);
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

// #652 — le sette manopole della pagina dell'owner. La tabella sta qui perché
// la usano sia la pagina (per disegnare i campi) sia il main (per rifiutare un
// numero storto prima di scriverlo): se divergessero, il main accetterebbe
// quello che la pagina rifiuta.
test('le manopole dei crediti sono sette, hanno un nome e limiti sensati', () => {
  assert.equal(W.OWNER_KNOBS.length, 7);
  assert.deepEqual(W.OWNER_KNOB_KEYS, [
    'entryCredits', 'dailyCredits', 'invitesPerUser', 'invitesMaxUses',
    'maxGrantCredits', 'rewardFeedbackSent', 'rewardFeedbackClosed',
  ]);
  for (const k of W.OWNER_KNOBS) {
    assert.ok(k.etichetta && k.etichetta.length > 2, `${k.chiave}: serve un nome leggibile`);
    assert.ok(k.aiuto && k.aiuto.length > 10, `${k.chiave}: serve una spiegazione`);
    assert.ok(Number.isInteger(k.min) && k.min >= 0, `${k.chiave}: niente valori negativi`);
    assert.ok(k.max > k.min, `${k.chiave}: il tetto deve stare sopra il minimo`);
  }
  // Un invito per zero persone non è un invito: quella manopola parte da 1.
  assert.equal(W.knobOf('invitesMaxUses').min, 1);
  assert.equal(W.knobOf('non-esiste'), null);
});
