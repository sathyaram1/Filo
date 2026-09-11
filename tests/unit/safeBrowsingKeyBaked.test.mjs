// #581 — la chiave Google Safe Browsing viaggia col build, come le altre.
//
// Il caso. `config/secrets` era leggibile da qualunque account Google, e la
// chiave Safe Browsing stava lì dentro insieme alle chiavi che pagano le
// chiamate di tutti. Chiudendo il documento agli admin, quella chiave sarebbe
// rimasta senza nessuna strada verso gli utenti: era l'UNICA che non veniva
// incastonata nel build. Il primo stadio del rilevamento siti pericolosi si
// sarebbe spento per tutti, in silenzio, e nessuno se ne sarebbe accorto — un
// rilevamento che non trova niente somiglia molto a un rilevamento che funziona.
//
// Adesso segue la stessa strada di Tavily: l'admin la scrive, la costruzione la
// rilegge e la incastona, l'auto-update la consegna. Effetto collaterale
// desiderato: si accende anche per chi non fa login, che prima restava scoperto.
//
// Senza il fix è ROSSO: `getBuildSafeBrowsingKey` non esisteva, il bake non
// scriveva il campo e `Defaults.get().safeBrowsingKey` era sempre ''.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const MODULO = join(ROOT, 'src', 'main', 'config', 'default-keys.js');
const BAKE = join(ROOT, 'scripts', 'bake-default-config.mjs');

// Carica default-keys in un processo Node pulito (cache dei moduli fresca) con
// un ambiente dato, e ritorna quello che espone.
function caricaChiavi(env) {
  const code = `const m = require(${JSON.stringify(MODULO)});`
    + `console.log(JSON.stringify({ build: m.getBuildKeys(), gsb: m.getBuildSafeBrowsingKey() }))`;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

test('la chiave Safe Browsing arriva dall’ambiente di costruzione', () => {
  const r = caricaChiavi({
    FILO_DEFAULT_SAFEBROWSING_KEY: '  gsb-di-fabbrica  ',
    FILO_DEFAULT_TAVILY_KEY: 'tav',
    FILO_DEFAULT_OPENROUTER_KEY: '',
  });
  assert.equal(r.gsb, 'gsb-di-fabbrica'); // trim applicato
});

test('senza niente da nessuna parte la chiave è vuota, non undefined', () => {
  const r = caricaChiavi({
    FILO_DEFAULT_SAFEBROWSING_KEY: '',
    FILO_DEFAULT_TAVILY_KEY: '',
    FILO_DEFAULT_OPENROUTER_KEY: '',
  });
  assert.equal(r.gsb, '');
});

test('la chiave Safe Browsing NON finisce fra le chiavi dei provider', () => {
  // `apiKeys` viene passata ai provider di modelli: una chiave Google in mezzo
  // sarebbe spedita a un servizio che non c'entra niente.
  const r = caricaChiavi({
    FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-di-fabbrica',
    FILO_DEFAULT_TAVILY_KEY: 'tav',
    FILO_DEFAULT_OPENROUTER_KEY: 'or',
  });
  assert.deepEqual(Object.keys(r.build).sort(), ['openrouter', 'tavily']);
  assert.ok(!JSON.stringify(r.build).includes('gsb-di-fabbrica'));
});

test('la config predefinita effettiva espone la chiave di fabbrica senza nessun login', () => {
  // Nessuna sessione, nessuna rete: solo quello che il build ha incastonato.
  const code = `const D = require(${JSON.stringify(join(ROOT, 'src', 'main', 'services', 'defaultsStore.js'))});`
    + `console.log(JSON.stringify(D.get().safeBrowsingKey))`;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-di-fabbrica' },
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(out.trim()), 'gsb-di-fabbrica');
});

test('il bake scrive la chiave Safe Browsing nel file che finisce nell’eseguibile', () => {
  const dir = cartellaTemporanea('filo-bake-');
  const out = join(dir, 'default-keys.generated.json');
  try {
    execFileSync(process.execPath, [BAKE], {
      env: {
        ...process.env,
        FILO_BAKE_OUT: out,
        // Senza parola d'ordine il bake non chiama il server: usa i secret del
        // job. È il ripiego dichiarato, e qui tiene il test offline.
        FILO_BUILD_PASSPHRASE: '',
        FILO_DEFAULT_TAVILY_KEY: 'tav-di-fabbrica',
        FILO_DEFAULT_GEMINI_KEY: '',
        FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-di-fabbrica',
      },
      encoding: 'utf8',
    });
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.safeBrowsingKey, 'gsb-di-fabbrica');
    assert.equal(j.apiKeys.tavily, 'tav-di-fabbrica');
    // Sta FUORI da apiKeys: non è una chiave di provider.
    assert.ok(!('safeBrowsingKey' in j.apiKeys));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
