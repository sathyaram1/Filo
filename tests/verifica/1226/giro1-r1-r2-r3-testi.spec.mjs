// #1226 giro 1 — i testi dei ruoli e CLAUDE.md dopo «il giudizio dell'owner si chiede con una domanda».
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\s+/g, ' ');

test("r1 chi verifica non mette le scelte nel file di --segnala: stanno nella domanda", () => {
  expect(leggi('routines/roles/_critica-e-livelli.md')).not.toMatch(/le scelte e i loro costi stanno nel file/);
});

test("r2 nessun ruolo manda il lavoro a una sessione locale con un feedback che aspetta l'owner", () => {
  const locale = leggi('routines/roles/_solo-in-locale.md');
  expect(locale).not.toMatch(/lo prende una sessione sulla sua macchina/);
  expect(locale).not.toMatch(/chi lavora in locale riparte/);
  expect(leggi('routines/roles/_lavoro-server.md')).not.toMatch(/rimanda la pratica in locale/);
  expect(leggi('routines/roles/_critica-e-livelli.md')).not.toMatch(/In un giro locale/);
});

test('r3 CLAUDE.md non porta più la ricetta PowerShell per prove e commit sul PC', () => {
  expect(leggi('CLAUDE.md')).not.toMatch(/PowerShell 5\.1/);
});
