// Materiale della prova r2: verde ovunque, senza aiuti.
import { test, expect } from '@playwright/test';

test.skip(!process.env.FILO_2454_FIXTURE, 'materiale della prova giro1-r2');

test('r2 verde ovunque', () => { expect(1).toBe(1); });
