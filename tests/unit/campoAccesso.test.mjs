// Quali campi chiedono l'email o il nome utente, e quando proporre l'email dell'account (#1124).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/campoAccesso.js');
const A = globalThis.SN_CAMPO_ACCESSO;

const campo = (c) => ({ tag: 'INPUT', type: 'text', autocomplete: '', name: '', id: '', placeholder: '', ariaLabel: '', label: '', disabled: false, readOnly: false, ...c });

test('i campi di accesso si riconoscono da tipo, autocomplete, nome ed etichetta', () => {
  const si = [
    { type: 'email' },
    { autocomplete: 'username' },
    { autocomplete: 'username webauthn' },
    { autocomplete: 'section-login email' },
    { name: 'login' },
    { name: 'user_name' },
    { name: 'user' },
    { id: 'userEmail' },
    { name: 'session[username_or_email]' },
    { name: 'loginfmt' },
    { placeholder: 'Indirizzo email' },
    { placeholder: 'Nome utente o email' },
    { ariaLabel: 'Email or phone' },
    { label: 'E-mail' },
    { labelledBy: 'Email address' },
    { title: 'Il tuo indirizzo e-mail' },
  ];
  for (const c of si) assert.equal(A.chiedeAccesso(campo(c), 'esempio.it'), true, JSON.stringify(c));
});

test('il campo identificativo di accounts.google.com, anche senza type=email', () => {
  assert.equal(A.chiedeAccesso(campo({ id: 'identifierId' }), 'accounts.google.com'), true);
  assert.equal(A.chiedeAccesso(campo({ name: 'identifier' }), 'accounts.google.com'), true);
  assert.equal(A.chiedeAccesso(campo({ type: 'email', id: 'identifierId', name: 'identifier', autocomplete: 'username webauthn' }), 'accounts.google.com'), true);
});

test('password, codici, ricerche, nomi di battesimo e campi spenti non sono campi di accesso', () => {
  const no = [
    { type: 'password', name: 'login' },
    { type: 'search', placeholder: 'email' },
    { type: 'tel', name: 'login' },
    { autocomplete: 'one-time-code', name: 'login' },
    { autocomplete: 'current-password', name: 'username' },
    { name: 'login_password' },
    { name: 'user[first_name]' },
    { name: 'user_phone' },
    { name: 'search' },
    { placeholder: 'Cerca nel sito' },
    { labelledBy: 'Cerca un utente' },
    { placeholder: 'Codice di accesso' },
    { name: 'account' },
    { name: 'nome' },
    { type: 'email', disabled: true },
    { type: 'email', readOnly: true },
    { tag: 'TEXTAREA', name: 'email' },
  ];
  for (const c of no) assert.equal(A.chiedeAccesso(campo(c), 'esempio.it'), false, JSON.stringify(c));
});

test('si propone a campo vuoto o con l\'inizio scritto dall\'utente, mai con un valore messo dalla pagina', () => {
  const e = 'Chi.Usa@Example.com';
  assert.equal(A.daProporre('', e, false), true);
  assert.equal(A.daProporre('chi', e, true), true);
  assert.equal(A.daProporre('CHI.usa@', e, true), true);
  assert.equal(A.daProporre('  ', e, true), true);
  assert.equal(A.daProporre('chi', e, false), false, 'scritto dalla pagina: sarebbe un oracolo prefisso per prefisso');
  assert.equal(A.daProporre('altro', e, true), false);
  assert.equal(A.daProporre('chi.usa@example.com', e, true), false, 'già intera: niente da aggiungere');
  assert.equal(A.daProporre('', '', false), false, 'senza account niente');
  assert.equal(A.daProporre('c'.repeat(A.VALORE_MAX + 1), e, true), false);
  assert.equal(A.daProporre(undefined, e, true), false);
});

test('dalla chat la proposta si spegne e si riaccende, anche per l\'incognito; di serie accesa, in incognito no', () => {
  globalThis.self = globalThis;
  for (const m of ['tabColor', 'constants', 'contenutoEsterno', 'preferences']) require(`../../src/shared/${m}.js`);
  const P = globalThis.SN_PREF;
  for (const chiave of ['proposta_email', 'suggerisci email', 'email nei siti']) {
    const r = P.buildPreferencePartial(chiave, 'no');
    assert.deepEqual(r.partial, { propostaEmail: { attiva: false } }, chiave);
    assert.equal(r.costo, 1);
  }
  assert.deepEqual(P.buildPreferencePartial('proposta_email_incognito', 'sì').partial, { propostaEmail: { incognito: true } });
  assert.deepEqual(globalThis.SN_CONST.DEFAULT_SETTINGS.propostaEmail, { attiva: true, incognito: false });
});
