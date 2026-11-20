// Materiale della prova r1: corre solo quando la lancia lo strumento di confronto (FILO_2454_FIXTURE).
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!process.env.FILO_2454_FIXTURE, 'materiale della prova giro1-r1');

test('r1 caso rosso anche su main', () => { expect(1).toBe(2); });

test('r1 caso rosso solo sul ramo', () => {
  expect(existsSync('tests/verifica/2454/giro1-r1-segno-ramo.txt')).toBe(false);
});
