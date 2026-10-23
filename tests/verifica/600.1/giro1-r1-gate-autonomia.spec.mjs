// Verifica #600.1 giro 1: toccare il punto che applica le regole di autonomia deve far provare lo spec dell'autonomia.
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { specsForChangedFiles } from '../../../scripts/finish-local.mjs';

test('r1 il dispatcher che decide e applica il livello di autonomia porta lo spec dell’autonomia nel controllo prima della fusione', () => {
  const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  expect(tracked).toContain('tests/autonomia.spec.mjs');
  expect(specsForChangedFiles(['src/main/services/handlers.js'], tracked)).toContain('tests/autonomia');
});
