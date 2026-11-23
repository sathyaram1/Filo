// #2654.1: il turno dell'Aiuto si trova fra le chiamate al modello finto anche quando il saluto della home o il
// correttore arrivano prima o dopo. Qui `app.evaluate` gira nel processo, con __visti scritto dalla prova.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnoDellAiuto, partiDellUtente, fotoDelTurno } from '../helpers/turniDellAiuto.mjs';

const app = { evaluate: async (fn, arg) => fn(null, arg) };
const SISTEMA_AIUTO = { role: 'system', content: [{ type: 'text', text: 'Sei l’Aiuto.\n# Protocollo di risposta\n…' }] };
const saluto = (frase) => [
  { role: 'system', content: 'Stai per preparare la dashboard della home.' },
  { role: 'user', content: `Ultimi messaggi: «${frase}». Saluta.` },
];
const turno = (frase, foto, prima = []) => [
  SISTEMA_AIUTO, ...prima,
  { role: 'user', content: [...(foto ? [{ type: 'image_url', image_url: { url: foto } }] : []), { type: 'text', text: frase }] },
];

test('il saluto della home arrivato prima non passa per il turno dell’Aiuto', async () => {
  globalThis.__visti = [saluto('aiutami a pagare'), turno('aiutami a pagare', 'data:image/jpeg;base64,UNO')];
  assert.equal(await fotoDelTurno(app, 'aiutami a pagare'), 'data:image/jpeg;base64,UNO');
});

test('una chiamata arrivata dopo non prende il posto dell’ultimo turno', async () => {
  const primo = turno('come ha fatto a volare?', null);
  globalThis.__visti = [
    primo,
    turno('e chi la ha lanciata?', null, primo.slice(1)),
    saluto('e chi la ha lanciata?'),
    [{ role: 'system', content: 'Correggi quello che è scritto in un campo editabile.' }, { role: 'user', content: 'e chi la ha lanciata?' }],
  ];
  const seconda = await turnoDellAiuto(app, 'e chi la ha lanciata?');
  assert.equal(partiDellUtente(seconda).at(-1).text, 'e chi la ha lanciata?');
  assert.equal(JSON.stringify(seconda).split('come ha fatto a volare?').length - 1, 1, 'la cronologia c’è una volta sola');
});

test('la stessa frase chiesta due volte: ogni turno ha la sua foto, e uno senza foto torna null', async () => {
  globalThis.__visti = [
    turno('aiutami a pagare', 'data:image/jpeg;base64,UNO'),
    saluto('aiutami a pagare'),
    turno('aiutami a pagare', null, [{ role: 'user', content: 'aiutami a pagare' }, { role: 'assistant', content: 'Premi «Paga».' }]),
  ];
  assert.equal(await fotoDelTurno(app, 'aiutami a pagare', 0), 'data:image/jpeg;base64,UNO');
  assert.equal(await fotoDelTurno(app, 'aiutami a pagare', 1), null);
});

test('un turno che non arriva è un rosso che dice quale frase manca', async () => {
  globalThis.__visti = [saluto('aiutami a pagare')];
  await assert.rejects(turnoDellAiuto(app, 'aiutami a pagare', 0, { timeout: 300 }), /non ha chiamato il modello per «aiutami a pagare»/);
});
