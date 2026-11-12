// Il manifesto e i documenti di trasparenza non promettono che qualcosa «non esce dal computer»: quasi ogni
// funzione fa leggere quello che le dai a un modello (#1452). Si dice dove un dato è SALVATO e verso chi NON va.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'capabilities.js'));
const CAP = globalThis.SN_CAPABILITIES;

const COMPUTER = String.raw`(?:il\s+|dal\s+|sul\s+|nel\s+)?(?:tuo\s+|suo\s+)?(?:computer|pc)\b`;
const PROMESSE = [
  new RegExp(String.raw`\b(?:non|nessun[oa]?|niente|nulla|mai)\b[^.;!?]{0,80}?\besc(?:e|ono)\s+(?:mai\s+)?dal\s+(?:tuo\s+|suo\s+)?(?:computer|pc)\b`, 'i'),
  new RegExp(String.raw`\b(?:non|nessun[oa]?|niente|nulla|mai)\b[^.;!?]{0,80}?\blascia(?:no)?\s+(?:mai\s+)?${COMPUTER}`, 'i'),
  /\b(?:non\s+)?finisc(?:e|ono)\s+altrove\b/i,
  new RegExp(String.raw`\brest(?:a|ano)\s+solo\s+${COMPUTER}`, 'i'),
];

function promessa(testo) {
  for (const re of PROMESSE) {
    const m = String(testo || '').match(re);
    if (m) return m[0];
  }
  return null;
}

test('la regola riconosce le promesse e lascia stare dove un dato è salvato', () => {
  for (const s of [
    'Niente sparisce da solo, e nessuna chat esce dal tuo computer.',
    'Resta solo sul tuo computer.',
    'Niente di quello che scrivi finisce altrove.',
    'I passi che fai con lui, per ora, non escono dal tuo computer.',
    'Le tue chat non lasciano mai il computer.',
  ]) assert.ok(promessa(s), `doveva riconoscere «${s}»`);
  for (const s of [
    'Le chat restano salvate sul tuo computer, ma Filo le fa leggere a un modello.',
    'Il contenuto che esce dal tuo computer è quello che serve alla funzione.',
    'I tuoi percorsi non arrivano al server.',
    'La lettura avviene sul tuo computer, senza crediti.',
  ]) assert.equal(promessa(s), null, `non doveva riconoscere «${s}»`);
});

test('nessuna voce del manifesto promette che qualcosa non esce dal computer', () => {
  const trovate = [];
  for (const c of CAP.CAPABILITIES) {
    for (const campo of ['title', 'desc', 'invoke', 'doesNot']) {
      const m = promessa(c[campo]);
      if (m) trovate.push(`${c.id}.${campo}: «${m}»`);
    }
  }
  assert.deepEqual(trovate, [], 'Una funzione che chiama un modello fa uscire quello che le dai: '
    + 'di\' dove il dato resta salvato e verso chi non va (il server di Filo, altri utenti).');
});

test('nemmeno i documenti di trasparenza, che Filo legge a chi chiede dove vanno i suoi dati', () => {
  const dir = join(ROOT, 'transparency');
  const trovate = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    for (const [i, riga] of readFileSync(join(dir, f), 'utf8').split('\n').entries()) {
      const m = promessa(riga);
      if (m) trovate.push(`${f}:${i + 1}: «${m}»`);
    }
  }
  assert.deepEqual(trovate, []);
});

test('le voci delle chat, del quaderno e dell\'Aiuto dicono che un modello le legge', () => {
  const testo = (id) => { const c = CAP.get(id); assert.ok(c, `manca la voce ${id}`); return `${c.desc} ${c.doesNot || ''}`; };
  const chat = testo('chat-archive');
  assert.match(chat, /restano salvate sul tuo computer/);
  assert.match(chat, /le fa leggere a un modello per risponderti e per dare un nome/);
  assert.match(testo('chat-archive-recall'), /passa una volta dal modello/);
  assert.match(testo('filo-memory'), /le scrive un modello/);
  assert.match(testo('filo-memory'), /i modelli che ti rispondono le leggono/);
  assert.match(testo('help-sidebar'), /fa leggere a un modello la pagina/);
});
