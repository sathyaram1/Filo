// #1412 giro 2, rilievo 1: dopo una decina di scambi il punto di cache in fondo alla storia non viene mai riletto.
// Logica pura, come la compone il main: due turni di fila della stessa conversazione, col ragionamento sulle risposte.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/capabilities.js');
require('../../../src/shared/constants.js');
require('../../../src/shared/contenutoEsterno.js');
require('../../../src/shared/filoContesto.js');

const C = globalThis.SN_CONST;
const FC = globalThis.SN_FILO_CONTESTO;

const ORA = Date.parse('2026-10-21T10:00:00Z');
const MIN = 60 * 1000;
const CHAT = 'ab12cd34';
// Uno scambio al minuto nella stessa scheda: l'utente chiede, Filo risponde ragionando (Haiku 5.5 ragiona di serie).
const FILO = Array.from({ length: 40 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  text: i % 2 ? `Risposta numero ${i}, con qualche riga di testo.` : `Domanda numero ${i}?`,
  ts: new Date(ORA - (40 - i) * MIN).toISOString(),
  chat: CHAT,
}));
const RAGIONAMENTO = (m) => (m.role === 'assistant'
  ? { azioni: [], reasoningDetails: [{ type: 'reasoning.text', text: `penso a ${m.ts}`, signature: 'firma' }] }
  : null);

// La richiesta della chat al turno in cui la domanda è FILO[n]: parte fissa, tratto, contesto di adesso, domanda.
function richiesta(n) {
  const f = FC.finestra(FILO.slice(0, n), { ora: ORA, giorni: 3, token: 100000, chatCorrente: CHAT, esiti: RAGIONAMENTO });
  const sistema = { role: 'system', content: C.PROMPTS.filoChatStatic({ capacita: '', sistema: 'linux' }) };
  return FC.assembla({
    tratto: [sistema, ...f.messaggi],
    contesto: FC.coda({ contesto: `STATO: ore 10:${String(n).padStart(2, '0')}`, chatCorrente: CHAT }),
    domanda: { role: 'user', content: FILO[n].text },
  });
}

test('r1 la storia su cui il turno mette il punto di cache si ritrova uguale al messaggio dopo', () => {
  for (const n of [10, 20, 30, 36]) {
    const adesso = richiesta(n);
    const dopo = richiesta(n + 2);
    const piano = FC.pianoDellaCache(C.ACTIONS.FILO_CHAT, adesso, { durata: '1h' });
    const ultimo = adesso.length - 1;
    // I punti che servono al turno dopo (non l'ultimo, che serve ai giri di strumenti dello stesso turno).
    const perIlDopo = piano.punti.filter((p) => p.indice > 0 && p.indice < ultimo);
    expect(perIlDopo.length, `turno ${n}: un punto in fondo alla storia`).toBeGreaterThan(0);
    for (const p of perIlDopo) {
      const prefisso = (msgs) => JSON.stringify(msgs.slice(1, p.indice + 1));
      expect(prefisso(dopo), `turno ${n}: la storia fino al punto ${p.indice} cambia al messaggio dopo, la cache non la rilegge`)
        .toBe(prefisso(adesso));
    }
  }
});
