// #1398: il testo della chat esce dal fornitore e arriva a chi lo mostra identico, lettera per lettera, comunque la
// rete spezzi i pezzi (a metà parola, a metà lettera accentata, a metà riga SSE). Il rovescio si cerca nel modello.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/main/services/providers/openrouter.js');
require('../../src/shared/streamingJson.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;

// Le frasi della segnalazione scritte giuste, con quello che rompe un decodificatore distratto: accenti, apostrofi
// tipografici, «», emoji fuori dal piano base, a capo, virgolette e barre da sfuggire nel JSON.
const RISPOSTA = 'Buon ascolto, e qui sono sempre io, quando vuoi.\n'
  + 'Fatto, applicato: d’ora in poi ti do del tu, e spendiamo meno parole.\n'
  + 'Ho riletto «tutto»: è così, perché l’intervista è già finita 👍🏽.\n'
  + 'Virgolette "doppie", barra \\ e tab\tqui. Città, più, già, così — né sì né no.';

// I pezzi come li manda un modello: tagliati a metà parola, mai sulle parole intere.
function aPezziDiToken(testo) {
  const out = [];
  let i = 0;
  const passi = [3, 1, 4, 2, 5, 3, 2];
  for (let k = 0; i < testo.length; k++) {
    const n = passi[k % passi.length];
    out.push(testo.slice(i, i + n));
    i += n;
  }
  return out;
}

function eventiSse(pezzi) {
  const righe = [': OPENROUTER PROCESSING\n\n'];
  for (const p of pezzi) righe.push(`data: ${JSON.stringify({ id: 'gen-1', choices: [{ delta: { content: p } }], provider: 'Host' })}\n\n`);
  righe.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
  righe.push('data: [DONE]\n\n');
  return new TextEncoder().encode(righe.join(''));
}

// I byte della risposta HTTP consegnati a fette di misura data: la rete non rispetta righe né lettere.
function corpoAFette(bytes, misure) {
  return new ReadableStream({
    start(controller) {
      let i = 0;
      let k = 0;
      while (i < bytes.length) {
        const n = Math.max(1, misure[k++ % misure.length]);
        controller.enqueue(bytes.slice(i, i + n));
        i += n;
      }
      controller.close();
    },
  });
}

async function riceviA(misure, pezzi) {
  const orig = globalThis.fetch;
  const bytes = eventiSse(pezzi);
  globalThis.fetch = async () => new Response(corpoAFette(bytes, misure), { status: 200 });
  const visti = [];
  try {
    const r = await OR.streamComplete({ apiKey: 'k', model: 'm', messages: [], onDelta: (d) => visti.push(d) });
    return { finale: r.text, mostrato: visti.join('') };
  } finally {
    globalThis.fetch = orig;
  }
}

function misureCasuali(seme, quante) {
  let x = seme;
  const out = [];
  for (let i = 0; i < quante; i++) { x = (x * 1103515245 + 12345) % 2147483648; out.push(1 + (x % 40)); }
  return out;
}

test('i pezzi spezzati a metà parola e a metà lettera arrivano identici, nei delta e nel testo finale', async () => {
  const pezzi = aPezziDiToken(RISPOSTA);
  assert.ok(pezzi.some((p) => /^\w+$/.test(p) && !/\s/.test(p)), 'i pezzi tagliano davvero le parole');
  const prove = [[1], [2], [3], [5], [7], [13], [64], [4096], ...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => misureCasuali(s, 200))];
  for (const misure of prove) {
    const { finale, mostrato } = await riceviA(misure, pezzi);
    assert.equal(mostrato, RISPOSTA, `delta mostrati, fette di ${misure.slice(0, 4).join(',')}…`);
    assert.equal(finale, RISPOSTA, `testo finale, fette di ${misure.slice(0, 4).join(',')}…`);
  }
});

test('un’emoji spezzata fra due pezzi del modello si ricompone', async () => {
  const testo = 'Ecco 👍🏽 fatto';
  const i = testo.indexOf('👍') + 1; // fra le due metà della coppia surrogata
  const { finale, mostrato } = await riceviA([1], [testo.slice(0, i), testo.slice(i)]);
  assert.equal(mostrato, testo);
  assert.equal(finale, testo);
});

test('il vecchio formato JSON: il campo "text" estratto a pezzi è identico a quello del JSON intero', () => {
  const grezzo = JSON.stringify({ text: RISPOSTA, actions: [] });
  for (const n of [1, 2, 3, 5, 7, 11]) {
    const s = globalThis.SN_STREAM_JSON.createTextStreamer('text');
    let mostrato = '';
    for (let i = 0; i < grezzo.length; i += n) mostrato += s.push(grezzo.slice(i, i + n)).delta;
    assert.equal(mostrato, JSON.parse(grezzo).text, `pezzi da ${n}`);
  }
});
