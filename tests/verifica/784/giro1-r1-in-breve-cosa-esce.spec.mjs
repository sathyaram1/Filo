// #784 giro 1: l'«In breve» di SECURITY.md promette di dire cosa esce dal computer, ma l'elenco
// verso i modelli si ferma a memorie, appunti e pagine, e i servizi esterni non compaiono.
// Prova di testo: non apre Filo.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sec = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
const breve = sec.slice(sec.indexOf('## In breve'), sec.indexOf('## 1.'));

test('r1 l\'«In breve» nomina i servizi esterni che ricevono pezzi della navigazione', () => {
  expect(breve).toMatch(/Safe Browsing|altri servizi|servizi esterni/i);
});

test('r1 verso i modelli l\'«In breve» non chiude l\'elenco a memorie, appunti e pagine', () => {
  const voce = breve.slice(breve.indexOf('Memorie, appunti e cronologia'), breve.indexOf('Il server di Filo riceve'));
  expect(voce).toMatch(/document|conversazion|chat|terminale|screenshot|per esempio|fra l'altro/i);
});
