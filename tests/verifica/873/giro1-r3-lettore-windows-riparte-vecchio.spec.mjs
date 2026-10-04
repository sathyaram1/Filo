// #873 giro 1, rilievo 3: su Windows, quando il lettore si è addormentato e riparte, la prima lettura che
// consegna è quella di prima del sonno, e la chat la riceve come fresca.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);

test('dopo il sonno il lettore di Windows non consegna la lettura di prima', async () => {
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
    setTimeout(() => f.stdout.write(`${JSON.stringify(riga)}\n`), 300);
    return f;
  };
  const w = lettoreWindows({ avvia });
  w.assicura();
  await w.pronto(3000);
  expect(w.ultimo().batteria.livello).toBe(80);
  w.ferma();
  // Il caricatore si stacca mentre il lettore dorme; poi qualcuno chiede.
  w.assicura();
  await w.pronto(3000);
  const letta = w.ultimo();
  w.ferma();
  expect(letta && letta.batteria && letta.batteria.livello).toBe(30);
});
