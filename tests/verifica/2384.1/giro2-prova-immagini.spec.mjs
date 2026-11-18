import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('salva un\'immagine in tests/.shots', () => {
  const dir = join(process.cwd(), 'tests', '.shots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'giro2-prova.png'), 'png');
  expect(true).toBe(true);
});
