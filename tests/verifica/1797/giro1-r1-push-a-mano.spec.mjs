// #1797 giro 1 — oltre ai ruoli, anche le risposte degli script che un worker di routine legge come istruzioni non
// devono chiedergli un push a mano: in cloud il controllo dei permessi lo ferma e la sessione resta appesa.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifierReplyText } from '../../../scripts/dispatch.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('r1 la risposta del server a una verifica superata con derivati non chiede di spingere a mano', () => {
  const t = verifierReplyText({ outcome: 'pass', derived: [{ level: 1, sede: 'e', text: 'bordo freddo', priority: 1, num: '#7.1', n: 1 }] });
  expect(t).toContain('Prove del giro da TOGLIERE');
  expect(t).not.toMatch(/\bspingi\b|\bgit\s+push\b/i);
});

test('r1 il rilascio che non riesce a spedire il ramo non manda il worker a sistemare il push a mano', () => {
  const src = readFileSync(`${ROOT}scripts/routine-channel.mjs`, 'utf8');
  expect(src).toContain('NON è arrivato su origin');
  expect(src).not.toMatch(/sistema il push/);
});
