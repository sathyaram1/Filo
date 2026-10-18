// Il tasto microfono delle chat (#948): la sua scorciatoia arriva davvero alla pagina su ogni sistema e si
// chiama col nome di quel sistema; la scelta «invia da solo / lascia da correggere» si chiede anche a Filo;
// ogni guasto del microfono o della trascrizione diventa una frase che dice cosa fare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants.js', 'i18n.js', 'tasti.js', 'chatErrors.js', 'preferences.js', 'actionTools.js',
  'cambi.js', 'ascolto.js', 'voceChat.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const T = globalThis.SN_TASTI;
const V = globalThis.SN_VOCE_CHAT;
const A = globalThis.SN_ASCOLTO;
const I18n = globalThis.SN_I18N;

test('la scorciatoia del microfono arriva alla pagina su Windows, Mac e Linux, e su Mac si chiama con Cmd', () => {
  for (const sistema of ['win32', 'darwin', 'linux']) {
    assert.equal(T.riservato(V.TASTO, sistema), false, `${sistema}: la prende Filo o la barra dei menu`);
    assert.equal(T.delSistema(V.TASTO, sistema), false, `${sistema}: la prende il sistema`);
    assert.ok(T.tastoRiconosciuto(V.TASTO), 'il tasto finale si riconosce alla pressione');
  }
  assert.equal(T.etichetta(V.TASTO, 'darwin'), 'Cmd+Shift+Spazio');
  assert.equal(T.etichetta(V.TASTO, 'win32'), 'Ctrl+Shift+Spazio');
  // Cmd vale Ctrl alla pressione.
  const premi = (o) => T.combacia({ key: ' ', code: 'Space', shiftKey: true, ...o }, V.TASTO);
  assert.equal(premi({ ctrlKey: true }), true);
  assert.equal(premi({ metaKey: true }), true);
  assert.equal(premi({}), false, 'Shift+Spazio da solo scrive uno spazio');
});

test('«invia da solo» e «lascia il testo da correggere» si chiedono anche a Filo, e il cambio ha un nome', () => {
  const P = globalThis.SN_PREF;
  const auto = (v) => P.buildPreferencePartial('invio_vocale', v)?.partial?.dictation?.autoSend;
  assert.equal(auto('invia da solo'), true);
  assert.equal(auto('lascia il testo da correggere'), false);
  assert.equal(auto('non inviare da solo'), false);
  assert.equal(auto(false), false);
  assert.equal(auto('boh'), undefined);
  assert.equal(P.buildPreferencePartial('invio_vocale', true).costo, 1, 'reversibile e innocua: niente conferma');
  const desc = globalThis.SN_ACTION_TOOLS.definitions({ sistema: 'linux' })
    .find((d) => d.function.name === 'IMPOSTA_PREFERENZA').function.description;
  assert.match(desc, /invio_vocale/, 'il modello non sa che la chiave esiste');
  assert.equal(globalThis.SN_CONST.DEFAULT_SETTINGS.dictation.autoSend, true, 'di serie la richiesta parte da sola');
  const frase = globalThis.SN_CAMBI.fraseCambio({ chiave: 'dictation.autoSend', prima: true, dopo: false });
  assert.equal(frase, 'invio di quello che detti nelle chat: da solo → a mano, dopo averlo corretto');
});

test('la pausa che chiude e l\'attimo per annullare sono dell\'utente: si chiedono a Filo, restano nei limiti e hanno un nome', () => {
  const C = globalThis.SN_CONST;
  const P = globalThis.SN_PREF;
  assert.deepEqual(C.dictationTimes(C.DEFAULT_SETTINGS.dictation), { silenceSec: 2, cancelSec: 2.5 });
  assert.deepEqual(C.dictationTimes(undefined), { silenceSec: 2, cancelSec: 2.5 });
  assert.deepEqual(C.dictationTimes({ silenceSec: 0.2, cancelSec: 99 }), { silenceSec: 1, cancelSec: 10 });
  assert.deepEqual(C.dictationTimes({ silenceSec: 'boh', cancelSec: 0 }), { silenceSec: 2, cancelSec: 0 });
  assert.equal(P.buildPreferencePartial('pausa_microfono', '4 secondi').partial.dictation.silenceSec, 4);
  assert.equal(P.buildPreferencePartial('attesa_invio_vocale', '0').partial.dictation.cancelSec, 0);
  assert.equal(P.buildPreferencePartial('attesa_invio_vocale', '3,5').partial.dictation.cancelSec, 3.5);
  assert.equal(P.buildPreferencePartial('pausa_microfono', 'boh'), null);
  const desc = globalThis.SN_ACTION_TOOLS.definitions({ sistema: 'linux' })
    .find((d) => d.function.name === 'IMPOSTA_PREFERENZA').function.description;
  assert.match(desc, /pausa_microfono/);
  assert.match(desc, /attesa_invio_vocale/);
  assert.equal(globalThis.SN_CAMBI.fraseCambio({ chiave: 'dictation.silenceSec', prima: 2, dopo: 4 }),
    'pausa che chiude il microfono delle chat: 2 s → 4 s');
});

test('un microfono negato, assente o occupato dice cosa fare, col posto giusto del sistema', () => {
  const negato = A.fraseMicrofono({ name: 'NotAllowedError' });
  assert.match(negato, /permesso/);
  assert.match(negato, /riprova/);
  assert.match(A.fraseMicrofono({ name: 'NotFoundError' }), /collegane uno/);
  assert.match(A.fraseMicrofono({ name: 'NotReadableError' }), /un'altra app/);
  assert.match(A.fraseMicrofono(null), /permesso/, 'un rifiuto senza nome è un permesso mancante');
  for (const k of ['voce_dove_mac', 'voce_dove_windows', 'voce_dove_linux']) {
    assert.doesNotMatch(I18n.t('voce_err_mic_negato', I18n.t(k)), /in nelle|%s/);
  }
});

test('una trascrizione fallita dice perché: la configurazione com\'è, il guasto in parole, mai il messaggio grezzo', () => {
  const host = 'Il modello «x» lo serve solo OpenAI, che Filo esclude. Non ho mandato niente: scegli un altro modello.';
  assert.equal(A.fraseTrascrizione({ ok: false, error: host, code: 'NO_ALLOWED_HOST' }), host);
  const rete = A.fraseTrascrizione({ ok: false, error: 'fetch failed', code: 'UNKNOWN' });
  assert.match(rete, /^Non sono riuscito a trascrivere/);
  assert.match(rete, /connessione/);
  assert.doesNotMatch(rete, /fetch failed/);
  const crediti = A.fraseTrascrizione({ ok: false, error: 'OpenRouter 402: Insufficient credits', code: 'UNKNOWN' });
  assert.match(crediti, /crediti/);
  assert.match(A.fraseTrascrizione(null), /Riprova/, 'anche senza risposta c\'è una frase');
});
