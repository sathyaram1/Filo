// La "foto" di una prova che usa un aiuto scritto accanto a lei: la corre giro1-r1-prima-su-main sul ramo e su main.
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FOTO } from './aiuto-foto.mjs';

test('r1 la prova con l\'aiuto salva la sua foto', () => {
  mkdirSync(dirname(FOTO), { recursive: true });
  writeFileSync(FOTO, 'foto');
});
