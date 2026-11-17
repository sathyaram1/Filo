// Verifica #2394, giro 1, rilievo 1: una sola risposta lenta del PowerShell della home agli elenchi lo segna «muto»
// per tutta la sessione; anche dopo che il lettore si è spento e riacceso, gli elenchi tornano allo script lento.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const L = require(join(resolve(process.cwd()), 'src', 'main', 'services', 'statoSistema.js'));

// Un PowerShell finto: scrive la prima riga di stato, e agli elenchi risponde solo se `risponde()` dice sì.
function avviaFinto(risponde) {
  return () => {
    const f = new EventEmitter();
    f.stdout = new PassThrough();
    f.stdin = new PassThrough();
    f.kill = () => { setImmediate(() => f.emit('exit', null, 'SIGTERM')); };
    f.stdin.on('data', (b) => {
      const cosa = String(b).trim();
      if (!risponde()) return;
      setTimeout(() => f.stdout.write(`${JSON.stringify({ elenco: { cosa, acceso: true, dispositivi: [] } })}\n`), 5);
    });
    setTimeout(() => f.stdout.write(`${JSON.stringify({ volume: { livello: 10, muto: false } })}\n`), 5);
    return f;
  };
}

test('r1 un PowerShell nuovo, che risponde, legge di nuovo gli elenchi dopo una risposta lenta di quello di prima', async () => {
  let lento = true;
  const w = L.lettoreWindows({ avvia: avviaFinto(() => !lento) });
  w.assicura();
  await w.pronto(2000);
  // Una volta il sistema era occupato: la risposta non arriva in tempo, e l'elenco passa allo script.
  expect(await w.chiedi('bluetooth', 50)).toBe(null);
  // La home si chiude, il lettore si spegne; riaperta, riparte un PowerShell nuovo che risponde subito.
  w.ferma();
  lento = false;
  w.assicura();
  await w.pronto(2000);
  const r = await w.chiedi('bluetooth', 2000);
  w.ferma();
  expect(r && r.cosa).toBe('bluetooth');
});
