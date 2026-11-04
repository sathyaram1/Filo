// #1808 giro 2: la funzione che spedisce sul collegamento sempre aperto, vista dal sito, sembra quella del browser.
import { test, expect } from '../../fixtures/electron.mjs';

test('il sito non si accorge che l’invio sul collegamento sempre aperto è seguito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><title>N</title><p>x');
  const v = await page.evaluate(() => {
    const s = WebSocket.prototype.send;
    const ts = Function.prototype.toString;
    return {
      send: ts.call(s),
      nome: s.name,
      lunghezza: s.length,
      toString: ts.call(ts),
      proprio: Object.getOwnPropertyNames(s).sort().join(','),
      prototipo: 'prototype' in s,
      dalFrame: (() => { const f = document.createElement('iframe'); document.body.append(f); const t = f.contentWindow.Function.prototype.toString.call(s); f.remove(); return t; })(),
    };
  });
  expect.soft(v.send).toBe('function send() { [native code] }');
  expect.soft(v.nome).toBe('send');
  expect.soft(v.lunghezza).toBe(1);
  expect.soft(v.toString).toBe('function toString() { [native code] }');
  expect.soft(v.proprio).toBe('length,name');
  expect.soft(v.prototipo).toBe(false);
  expect.soft(v.dalFrame).toBe('function send() { [native code] }');
});
