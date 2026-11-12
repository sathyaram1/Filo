// Sentinella del testo mandato su un collegamento sempre aperto (#824.4, #1808): conta come arrivato solo con una
// conferma del server (l'eco del testo, o una risposta dopo cui il collegamento tace); un errore del server lo respinge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { sorgenteSonda } = require('../../src/preload/collegamento-aperto.js');

function pagina() {
  class WebSocket extends EventTarget { constructor() { super(); this.readyState = 1; this.mandati = []; } }
  WebSocket.prototype.send = function send(d) { this.mandati.push(d); };
  const window = new EventTarget();
  const ctx = vm.createContext({ window, WebSocket, EventTarget, CustomEvent, TextDecoder, setTimeout, clearTimeout });
  vm.runInContext(sorgenteSonda('sonda'), ctx);
  const arrivati = [];
  const respinti = [];
  window.addEventListener('sonda', (e) => arrivati.push(e.detail));
  window.addEventListener('sonda:r', (e) => respinti.push(e.detail));
  const ws = new WebSocket();
  const dal = (data) => ws.dispatchEvent(Object.assign(new Event('message'), { data }));
  return { ws, dal, arrivati, respinti, ctx };
}
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const POST = JSON.stringify({ type: 'post', testo: 'Oggi ho finito la maratona di Firenze' });

test('una risposta a cui segue il silenzio conferma il post', async () => {
  const p = pagina();
  p.ws.send(POST);
  p.dal('{"ok":true}');
  assert.deepEqual(p.arrivati, []);
  await attesa(1700);
  assert.deepEqual(p.arrivati, [POST]);
  assert.deepEqual(p.ws.mandati, [POST]);
});

test('un errore del server respinge il post, e non lo conferma', async () => {
  for (const errore of ['{"type":"error","message":"Devi accedere"}', '{"ok":false}', '{"error":{"code":401}}', 'Error: rate limit']) {
    const p = pagina();
    p.ws.send(POST);
    p.dal(errore);
    await attesa(1700);
    assert.deepEqual(p.arrivati, [], errore);
    assert.deepEqual(p.respinti, [POST], errore);
  }
});

test('un collegamento che parla di continuo non conferma con una risposta qualunque, con l\'eco sì', async () => {
  const p = pagina();
  p.ws.send(POST);
  for (let i = 0; i < 12; i++) { p.dal('{"type":"presenza","online":3}'); await attesa(200); }
  assert.deepEqual(p.arrivati, []);
  p.dal(JSON.stringify({ type: 'nuovo', post: { testo: 'Oggi ho finito la maratona di Firenze' } }));
  assert.deepEqual(p.arrivati, [POST]);
});

test('l\'eco dell\'identificativo del messaggio lo conferma subito', () => {
  const p = pagina();
  const m = JSON.stringify({ nonce: 'a81f-22c9', testo: 'ciao' });
  p.ws.send(m);
  p.dal('{"ack":"a81f-22c9"}');
  assert.deepEqual(p.arrivati, [m]);
});

test('il testo mandato in binario si legge come testo', async () => {
  const p = pagina();
  p.ws.send(new TextEncoder().encode(POST));
  p.dal('{"ok":true}');
  await attesa(1700);
  assert.deepEqual(p.arrivati, [POST]);
});

test('la funzione sostituita sembra nativa a chi la ispeziona dalla pagina', () => {
  const p = pagina();
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify([Function.prototype.toString.call(WebSocket.prototype.send), WebSocket.prototype.send.name, '
    + 'Object.prototype.hasOwnProperty.call(WebSocket.prototype.send, "prototype"), Function.prototype.toString.call(Function.prototype.toString)])', p.ctx)),
  ['function send() { [native code] }', 'send', false, 'function toString() { [native code] }']);
});
