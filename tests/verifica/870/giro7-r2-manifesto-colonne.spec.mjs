// Verifica #870 giro 7, rilievo 2: il manifesto non dice che le colonne delle carte si nascondono, se non lo fanno.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('il manifesto dice la verità sulla finestra stretta', () => {
  const css = readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard.css'), 'utf8');
  const cap = readFileSync(join(ROOT, 'src', 'shared', 'capabilities.js'), 'utf8');
  const nasconde = /\.dash-(left|right)\s*\{[^}]*display:\s*none/.test(css);
  if (!nasconde) expect(cap).not.toMatch(/colonne con le carte si nascondono/);
});
