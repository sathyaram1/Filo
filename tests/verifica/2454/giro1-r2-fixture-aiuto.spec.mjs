// Materiale della prova r2: usa un aiuto che su main non c'è, quindi lì non si carica.
import { test, expect } from '@playwright/test';
import { uno } from './giro1-r2-aiuto.mjs';

test.skip(!process.env.FILO_2454_FIXTURE, 'materiale della prova giro1-r2');

test('r2 usa un aiuto del ramo', () => { expect(uno).toBe(1); });
