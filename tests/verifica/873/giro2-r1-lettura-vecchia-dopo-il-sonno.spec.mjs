// #873 giro 2, rilievo 1: dopo il sonno del lettore, se la prima lettura nuova tarda più di tre secondi (un PowerShell
// che riparte lento), la chat riceve come fresca la lettura di prima del sonno.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);

test('il lettore di Windows che riparte lento non consegna la lettura di prima del sonno', async () => {
  const { lettoreWindows } = require('../../../src/main/services/statoSistema.js');
  let avvii = 0;
  const avvia = () => {
    const f = new EventEmitter();
    f.stdout = new PassThrough();
    f.kill = () => setImmediate(() => f.emit('exit'));
    avvii += 1;
    const riga = avvii === 1
      ? { batteria: { livello: 80, inCarica: true, collegata: true } }
      : { batteria: { livello: 30, inCarica: false, collegata: false } };
    setTimeout(() => f.stdout.write(`${JSON.stringify(riga)}\n`), avvii === 1 ? 300 : 3500);
    return f;
  };
  const w = lettoreWindows({ avvia });
  w.assicura();
  await w.pronto(3000);
  w.ferma();
  // Il caricatore si stacca mentre il lettore dorme; poi qualcuno chiede, e il PowerShell riparte in 3,5 s.
  w.assicura();
  await w.pronto(3000);
  const letta = w.ultimo();
  w.ferma();
  expect(letta && letta.batteria ? letta.batteria.livello : null, 'la lettura di prima del sonno').not.toBe(80);
});

test('la chat non riceve come «letto adesso» lo stato di prima quando la lettura nuova tarda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    globalThis.__sf = { batteria: { livello: 80, inCarica: true, collegata: true }, rete: null, bluetooth: null };
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__sf);
  });
  // La home va dietro un sito e il lettore si ferma: nessuno guarda. Intanto il caricatore si stacca.
  await openTab(testServer.html('<h1>un sito qualunque</h1>'));
  await app.evaluate(() => globalThis.SN_SISTEMA_MAIN.ferma());
  await new Promise((r) => setTimeout(r, 7_000));
  const letta = await app.evaluate(async () => {
    globalThis.__sf = { batteria: { livello: 30, inCarica: false, collegata: false }, rete: null, bluetooth: null };
    // Il computer risponde in cinque secondi, come un PowerShell che riparte lento.
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return globalThis.__sf;
    });
    const s = await globalThis.SN_SISTEMA_MAIN.statoPerChat();
    return s && s.batteria ? s.batteria.livello : null;
  });
  expect(letta, 'alla chat arriva il livello di prima del sonno come se fosse di adesso').not.toBe(80);
});
