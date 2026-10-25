// #1273 — la foto del profilo Google è una copia che Filo tiene: una volta arrivata non si richiede agli avvii dopo,
// e una mancata (rete assente, server che non risponde) si richiede all'avvio dopo invece di restare persa.
// L'«avvio» qui è restore() sulla sessione salvata, come lo fa Filo partendo.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');

// `shell`: la finestra nasce dopo il restore() dell'avvio vero, che altrimenti può cadere a metà prova e chiedere la foto di nuovo.
test('la foto mancata a un avvio arriva all\'avvio dopo, e poi non si richiede più', async ({ app, shell }) => {
  expect(shell).toBeTruthy();
  test.setTimeout(60_000);
  let giu = true;
  const chieste = [];
  const s = createServer((req, res) => {
    chieste.push(req.url);
    if (giu) { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const foto = `http://127.0.0.1:${s.address().port}/foto.png`;
  // La sessione è finta: il rinnovo dell'accesso che parte all'arrivo della foto, se arriva a Google, la fa
  // rifiutare e chiudere. Qui il servizio dei token è irraggiungibile, come senza rete: la sessione resta.
  await app.evaluate(() => {
    const vera = globalThis.fetch;
    globalThis.fetch = function fetch(input, init) {
      const url = String((input && input.url) || input);
      if (/^https:\/\/securetoken\.googleapis\.com\//.test(url)) return Promise.reject(new TypeError('fetch failed'));
      return vera.call(this, input, init);
    };
  });
  const avvio = (nuova) => app.evaluate(async (_e, nuova) => {
    const req = process.getBuiltinModule('module').createRequire(`${process.cwd()}/src/main/main.js`);
    const ga = req('./auth/google-auth');
    if (nuova) req('./auth/token-store').save({ refreshToken: 'r-finto', email: 'a@b.it', name: 'A', picture: nuova, foto: '', fotoDi: '' });
    ga.restore();
    await ga.aggiornaFoto();
    return ga.getProfile();
  }, nuova);
  try {
    // Primo avvio con il server delle foto che non risponde: niente foto, solo l'icona generica.
    expect((await avvio(foto)).picture).toBe('');
    expect(chieste).toHaveLength(1);
    // Avvio dopo, la rete è tornata: la foto arriva ed è la copia, non l'indirizzo di Google.
    giu = false;
    expect((await avvio()).picture).toMatch(/^filo:\/\/icone\/[0-9a-f]{40}\.png$/);
    expect(chieste).toHaveLength(2);
    // Gli avvii dopo mostrano la copia senza chiedere niente.
    expect((await avvio()).picture).toMatch(/^filo:\/\/icone\//);
    expect(chieste).toHaveLength(2);
  } finally {
    await new Promise((r) => { s.closeAllConnections?.(); s.close(r); });
  }
});
