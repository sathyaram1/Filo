import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('caso rosso anche su main', () => { expect(1).toBe(2); });

test('caso rosso solo sul ramo', () => {
  expect(readFileSync('scripts/spec-su-main.mjs', 'utf8')).not.toContain('portaSpecDelRamo');
});
