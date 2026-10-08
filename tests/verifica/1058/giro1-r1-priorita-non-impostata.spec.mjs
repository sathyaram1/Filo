// #1058 giro 1 — r1: quando la priorità chiesta all'apertura non attecchisce, lo strumento che apre
// deve indicare la strada da riga di comando appena nata, non rimandare alla dashboard (il clic che #1058 toglie).
import { test, expect } from '@playwright/test';

test('r1 priorità non impostata alla nascita: il messaggio dà il comando per metterla, non la dashboard', async () => {
  const S = await import('../../../scripts/claude-feedback.mjs');
  const FB = globalThis.SN_FEEDBACK;
  S.credenziale.ottieni = async () => ({ idToken: 'tok-finto' });
  S.ambiente.routine = () => false;
  const origSubmit = FB.submit;
  const origLog = console.log;
  const righe = [];
  // Il server non riconosce il mittente: la priorità non nasce col documento.
  FB.submit = async () => ({ id: 'doc1', seq: 4321, senderProof: '' });
  console.log = (...a) => righe.push(a.join(' '));
  try {
    await S.main(['titolo', 'testo', '--locale', '--priorita', '3']);
  } finally {
    FB.submit = origSubmit;
    console.log = origLog;
  }
  const out = righe.join('\n');
  expect(out).toMatch(/NON impostata/);
  expect(out).toMatch(/--priorita 3/);
  expect(out).toMatch(/4321/);
  expect(out).not.toMatch(/dashboard/i);
});
