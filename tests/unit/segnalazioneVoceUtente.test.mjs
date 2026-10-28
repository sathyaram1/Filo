// #1627: una segnalazione che Filo scrive per l'utente parla con la voce dell'utente.
// In tono da agente (nomi di azioni, ordini a chi lavora) i giudici all'ingresso la bloccano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'capabilities.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'actionTools.js'));

const C = globalThis.SN_CONST;
const VOCE = C.VOCE_SEGNALAZIONE;

test('la regola dice di scrivere come l\'utente, senza nomi interni', () => {
  assert.equal(typeof VOCE, 'string');
  assert.match(VOCE, /come lo direbbe l'utente/);
  assert.match(VOCE, /Niente nomi di azioni o strumenti, di funzioni interne di Filo/);
  assert.match(VOCE, /nessun ordine a chi lo leggerà/);
});

test('ogni prompt che fa scrivere una segnalazione porta la regola', () => {
  for (const sistema of ['win32', 'darwin', 'linux']) {
    const chat = C.PROMPTS.filoChatStatic({ capacita: '[x] Una capacità', sistema });
    assert.ok(chat.includes(VOCE), `chat (${sistema}) senza la regola`);
  }
  const aiuto = C.PROMPTS.helpStatic();
  assert.ok(aiuto.includes('INVIA_FEEDBACK') && aiuto.includes(VOCE), 'aiuto della pagina senza la regola');
});

test('nessun prompt chiede di dire che all\'assistente manca un\'azione', () => {
  const chat = C.PROMPTS.filoChatStatic({ capacita: '[x] Una capacità', sistema: 'linux' });
  assert.doesNotMatch(chat, /non hai un'azione per comandarlo/);
  assert.doesNotMatch(chat, /cosa aveva chiesto l'utente e cosa non è stato possibile/);
});

test('lo strumento della chat chiede il testo con le parole dell\'utente', () => {
  const def = globalThis.SN_ACTION_TOOLS.definitions({ sistema: 'linux' })
    .find((t) => t.function.name === 'INVIA_FEEDBACK');
  assert.match(def.function.parameters.properties.testo.description, /parole dell'utente/);
});
