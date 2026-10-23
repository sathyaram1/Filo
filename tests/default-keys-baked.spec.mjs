// Le chiavi di default incastonate dal bake raggiungono gli utenti: precedenza file generato > env FILO_DEFAULT_* > vuoto.
// Eccezione: OpenRouter si legge solo dall'env, perché è uscita dall'installer pubblico (#598) e una copia nel file non deve arrivare a nessuno.
// Quali chiavi possono stare nel file lo decide tests/unit/chiaviNelPacchettoPubblico.test.mjs.

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

// Come sopra, ma per la chiave Google Safe Browsing (#581): sta nel file
// generato FUORI da `apiKeys`, perché non è una chiave di provider.
function loadSafeBrowsing(env) {
  const code = `console.log(JSON.stringify(require(${JSON.stringify(MODULE_PATH)}).getBuildSafeBrowsingKey()))`;
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
  writeFileSync(GEN_PATH, JSON.stringify({ apiKeys: { tavily: 'tav-baked' } }), 'utf8');
  expect(loadKeys({ FILO_DEFAULT_TAVILY_KEY: 'tav-env' }).tavily).toBe('tav-baked');

  // Per la chiave vuota nel file si ricade sull'env.
  writeFileSync(GEN_PATH, JSON.stringify({ apiKeys: { tavily: '' } }), 'utf8');
  expect(loadKeys({ FILO_DEFAULT_TAVILY_KEY: 'tav-env' }).tavily).toBe('tav-env');
});

test('default-keys: OpenRouter non si legge dal file generato, solo dall’env', () => {
  writeFileSync(
    GEN_PATH,
    JSON.stringify({ apiKeys: { openrouter: 'or-baked', tavily: 'tav-baked' } }),
    'utf8'
  );
  expect(loadKeys({ FILO_DEFAULT_OPENROUTER_KEY: '', FILO_DEFAULT_TAVILY_KEY: '' }))
    .toEqual({ openrouter: '', tavily: 'tav-baked' });
  expect(loadKeys({ FILO_DEFAULT_OPENROUTER_KEY: 'or-env' }).openrouter).toBe('or-env');
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

// #581 — la chiave Google Safe Browsing fa la stessa strada. Prima la leggeva a
// runtime chi era loggato, dal documento Firestore dei segreti: e per tenerlo
// leggibile bastava un account Google qualsiasi, quindi le chiavi che pagano le
// chiamate di tutti erano scaricabili con una GET. Ora il documento è admin-only
// e questa è l'unica strada verso gli utenti: se si rompe, il primo stadio del
// rilevamento siti pericolosi si spegne senza che nessuno se ne accorga.
test('default-keys: la chiave Safe Browsing del file generato vince sull’env', () => {
  writeFileSync(
    GEN_PATH,
    JSON.stringify({ apiKeys: { tavily: 'tav-baked' }, safeBrowsingKey: 'gsb-baked' }),
    'utf8'
  );
  expect(loadSafeBrowsing({ FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-env' })).toBe('gsb-baked');
  // E non si intrufola fra le chiavi passate ai provider di modelli.
  expect(loadKeys({ FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-env' })).toEqual({
    openrouter: '', tavily: 'tav-baked',
  });
});

test('default-keys: chiave Safe Browsing assente dal file generato → si ricade sull’env', () => {
  writeFileSync(GEN_PATH, JSON.stringify({ apiKeys: { tavily: 'tav-baked' } }), 'utf8');
  expect(loadSafeBrowsing({ FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-env' })).toBe('gsb-env');
});
