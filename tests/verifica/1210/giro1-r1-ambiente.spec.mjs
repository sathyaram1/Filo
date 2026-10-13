// #1210 giro 1: chi deve rimettere la parola della costruzione riceve un posto solo, l'ambiente «rilascio»,
// che fa ombra al segreto omonimo del repo. Rossa finché un messaggio manda al «segreto del repo».

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { messageForBump } from '../../../scripts/release-bump.mjs';

test('r1 parola rifiutata all\'aumento di versione: il messaggio manda all\'ambiente «rilascio»', () => {
  const msg = messageForBump({ kind: 'denied' });
  expect(msg).toContain('rilascio');
  expect(msg).not.toMatch(/segreto FILO_BUILD_PASSPHRASE del repo/);
});

test('r1 parola nuova della costruzione: routine-keys dice di metterla nell\'ambiente «rilascio»', () => {
  const src = readFileSync(new URL('../../../scripts/routine-keys.mjs', import.meta.url), 'utf8');
  const riga = src.split('\n').find((r) => r.includes('come FILO_BUILD_PASSPHRASE'));
  expect(riga).toBeTruthy();
  expect(riga).toContain('rilascio');
});
