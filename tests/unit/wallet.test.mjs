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
