// Verifica #667 — giro 2: la suoneria che dura.
//
// Una scadenza suona finché l'utente non torna, quindi il minuto non è il caso
// raro: è il caso. Qui si guarda cosa sta suonando dopo un minuto, contando le
// note che la finestra manda davvero in onda.

import { test, expect } from '../../fixtures/electron.mjs';

// Le note di un motivo sono in fila, mai sovrapposte: due che si accavallano
// vogliono dire due copie della stessa suoneria sopra sé stessa.
async function noteSovrapposte(shell, secondi) {
  await shell.evaluate(() => {
    window.SN_SOUNDS.silence();
    window.__note = [];
    const P = window.OscillatorNode.prototype;
    if (!P.__spiato) {
      const start = P.start;
      const stop = P.stop;
      P.start = function (t) { this.__t0 = t; window.__note.push(this); return start.call(this, t); };
      P.stop = function (t) { this.__t1 = t; return stop.call(this, t); };
      P.__spiato = true;
    }
  });
  await shell.evaluate(() => window.SN_SOUNDS.ring('urgent'));
  await shell.waitForTimeout(secondi * 1000);
  const note = await shell.evaluate(() => {
    const out = window.__note.map((o) => [o.__t0, o.__t1]);
    window.SN_SOUNDS.silence();
    return out;
  });
  note.sort((a, b) => a[0] - b[0]);
  let sovrapposte = 0;
  for (let i = 1; i < note.length; i++) if (note[i][0] < note[i - 1][1] - 0.001) sovrapposte++;
  return { totali: note.length, sovrapposte };
}

test('dopo un minuto la suoneria è ancora una sola', async ({ shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const r = await noteSovrapposte(shell, 56);
  expect(r.totali, 'la suoneria deve aver programmato delle note').toBeGreaterThan(10);
  expect(r.sovrapposte, 'nessuna nota deve suonare sopra un altra').toBe(0);
});
