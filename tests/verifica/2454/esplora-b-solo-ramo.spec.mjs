import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('rosso solo dove lo strumento porta lo spec del ramo', () => {
  expect(readFileSync('scripts/spec-su-main.mjs', 'utf8')).not.toContain('portaSpecDelRamo');
});
