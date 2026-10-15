// Verifica #822 giro 1, rilievo 1: due rossi di marchio (YouTube, Netflix) devono stare vicini nell'arcobaleno.
import { createRequire } from 'node:module';
import { test, expect } from '../../fixtures/electron.mjs';

createRequire(import.meta.url)('../../../src/shared/tabColor.js');
const { compareRainbow } = globalThis.SN_TAB_COLOR;

test('r1 un rosso che tende al magenta non finisce dopo il blu', () => {
  const schede = [
    ['Blu', 'rgb(0, 0, 255)'],
    ['Netflix', 'rgb(255, 0, 21)'],
    ['Arancio', 'rgb(255, 140, 0)'],
    ['YouTube', 'rgb(255, 0, 0)'],
  ];
  const ordine = schede.map((s, i) => ({ s, i }))
    .sort((a, b) => compareRainbow(a.s[1], b.s[1]) || a.i - b.i).map((x) => x.s[0]);
  expect(ordine.indexOf('Netflix')).toBeLessThan(ordine.indexOf('Blu'));
});
