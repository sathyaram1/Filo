// #2236 giro 1: la regola del ramo vuoto, come la legge chi riallinea o verifica un lavoro server, e dove sta nel
// testo di chi riallinea.
import { test, expect } from '@playwright/test';
import { readRoleInstructions, testoLavoroServer } from '../../../scripts/dispatch.mjs';

function sezioneRamoVuoto(t) {
  const i = t.indexOf('## Un ramo che non porta niente');
  expect(i, 'la sezione del ramo vuoto manca').toBeGreaterThanOrEqual(0);
  const j = t.indexOf('Chi verifica non cerca un diff', i);
  return t.slice(i, t.indexOf('\n\n', j));
}

test('r1 per un lavoro server la regola del ramo vuoto non vale sul solo diff dell\'app', () => {
  for (const [ruolo, opz] of [['fixer', {}], ['verifier', { scope: 'pieno' }]]) {
    const t = `${readRoleInstructions(ruolo, opz)}\n\n${testoLavoroServer({ clone: '/tmp/clone-server' })}`;
    expect(t, ruolo).toContain('## Lavoro server');
    // Un lavoro solo del server ha il diff dell'app vuoto: «consegna subito» o «non cerca un diff» lo salterebbero.
    expect(sezioneRamoVuoto(t), ruolo).toMatch(/server/i);
  }
});

test('r2 i passi del rebase non stanno sotto il titolo del ramo vuoto', () => {
  const t = readRoleInstructions('fixer', {});
  const passi = t.indexOf('1. Due comandi');
  expect(passi).toBeGreaterThan(0);
  const titoli = [...t.slice(0, passi).matchAll(/^## .*$/gm)].map((m) => m[0]);
  expect(titoli.at(-1)).not.toBe('## Un ramo che non porta niente');
});
