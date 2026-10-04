// Verifica #951, giro 2, rilievo 1: quando apri l'Aiuto su una pagina, Filo chiede al suo server i percorsi noti di quel
// sito, nominandone il dominio; il documento sulla privacy dice che la navigazione non arriva al server e non lo cita.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

test('se l\'Aiuto chiede al server i percorsi di un sito, il documento sulla privacy dice che il server riceve il nome del sito', () => {
  const handlers = leggi('src/main/services/handlers.js');
  const chiedeAlServer = /ACTIONS\.HELP[\s\S]{0,600}Paths\.listByDomain\(/.test(handlers);
  test.skip(!chiedeAlServer, 'l\'Aiuto non chiede più al server i percorsi del sito');
  const paragrafi = leggi('transparency/privacy.md').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' '));
  const detto = paragrafi.some((p) => /Aiuto/.test(p) && /(dominio|nome del sito)/.test(p) && /server/.test(p));
  expect(detto, 'nessun paragrafo dice che, aprendo l\'Aiuto, il nome del sito arriva al server').toBe(true);
});
