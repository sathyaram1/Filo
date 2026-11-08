// #2312 giro 1: con cmd la cartella di lavoro non è più nella ricerca dei programmi, e il modello deve saperlo
// prima di scrivere `gradlew build`: altrimenti l'utente conferma un comando che fallisce, e poi un secondo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/constants.js');
const P = globalThis.SN_CONST.PROMPTS;

test('r1 su Windows il modello sa che un programma della cartella si chiama con .\\', () => {
  const computer = P.filoChatComputer('win32');
  expect(computer).toMatch(/\.\\/);
});
