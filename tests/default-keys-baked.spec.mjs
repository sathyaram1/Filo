// Le chiavi di default "baked" devono raggiungere gli utenti.
//
// default-keys.js è il modulo del main che fornisce le chiavi predefinite. In
// produzione le chiavi NON stanno nel repo: la CI le scrive in
// src/main/config/default-keys.generated.json (gitignorato, bundlato nel build).
// Questo test verifica la PRECEDENZA che fa funzionare la propagazione:
//   file generato  >  env FILO_DEFAULT_*  >  vuoto
//
// Pre-condizione che senza il fix fallirebbe: prima default-keys leggeva SOLO
// process.env, quindi le chiavi baked nel file generato non venivano mai usate
// a runtime sulla macchina utente (l'env è vuoto lì) → ogni utente restava
// senza chiavi. Ora il file generato vince e le chiavi arrivano davvero.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const GEN_PATH = resolve(ROOT, 'src', 'main', 'config', 'default-keys.generated.json');
const MODULE_PATH = resolve(ROOT, 'src', 'main', 'config', 'default-keys.js');

// Carica default-keys in un processo node pulito (cache modulo fresca ogni volta)
// con un dato set di variabili d'ambiente, e ritorna getBuildKeys().
function loadKeys(env) {
  const code = `console.log(JSON.stringify(require(${JSON.stringify(MODULE_PATH)}).getBuildKeys()))`;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

test.afterEach(() => {
  try { rmSync(GEN_PATH, { force: true }); } catch (_) {}
});

test('default-keys: il file generato ha la precedenza su env', () => {
  writeFileSync(
    GEN_PATH,
    JSON.stringify({ apiKeys: { openrouter: 'or-baked', tavily: '' } }),
    'utf8'
  );

  const keys = loadKeys({
    FILO_DEFAULT_OPENROUTER_KEY: 'or-env',
    FILO_DEFAULT_TAVILY_KEY: 'tav-env',
  });

  // File generato vince dove ha un valore...
  expect(keys.openrouter).toBe('or-baked');
  // ...ma per la chiave vuota nel file si ricade sull'env.
  expect(keys.tavily).toBe('tav-env');
});

test('default-keys: senza file generato usa le env (dev locale)', () => {
  // (afterEach garantisce che il file non esista)
  const keys = loadKeys({
    FILO_DEFAULT_OPENROUTER_KEY: 'or-env',
    FILO_DEFAULT_TAVILY_KEY: '  tav-env  ',
  });
  expect(keys.openrouter).toBe('or-env');
  expect(keys.tavily).toBe('tav-env'); // trim applicato
});

test('default-keys: senza file e senza env, tutte vuote', () => {
  const keys = loadKeys({
    FILO_DEFAULT_OPENROUTER_KEY: '',
    FILO_DEFAULT_TAVILY_KEY: '',
  });
  expect(keys).toEqual({ openrouter: '', tavily: '' });
});
