// Esplorazione: un PowerShell che dopo il sonno impiega più di tre secondi per la prima riga.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);

test('dopo il sonno, con un avvio lento, il lettore di Windows non consegna la lettura di prima', async () => {
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
  w.assicura();
  await w.pronto(3000);
  const letta = w.ultimo();
  w.ferma();
  expect(letta && letta.batteria ? letta.batteria.livello : null).not.toBe(80);
});
