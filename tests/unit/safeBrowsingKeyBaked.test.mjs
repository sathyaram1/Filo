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
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { CHIAVI_DEL_PACCHETTO, FONTE_SAFE_BROWSING } from '../../scripts/bake-default-config.mjs';

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
    togliCartella(dir);
  }
});

// #1074: la chiave ruotata dall'admin sta nel campo di primo livello `safeBrowsingKey`
// del documento dei segreti; la costruzione la prende dal server prima del segreto del job.
test('il bake prende dal server la chiave Safe Browsing ruotata, e ignora le chiavi che non incastona', async () => {
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // La forma che il server consegnava prima del #1074: anche openrouter e gemini.
      res.end(JSON.stringify({
        ok: true,
        apiKeys: { tavily: 'tav-dal-server', openrouter: 'or-di-fabbrica', gemini: 'gem-di-fabbrica' },
        safeBrowsingKey: 'gsb-ruotata',
      }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const dir = cartellaTemporanea('filo-bake-1074-');
  const out = join(dir, 'default-keys.generated.json');
  const env = { ...process.env, FILO_BAKE_OUT: out };
  for (const n of ['FILO_DEFAULT_OPENROUTER_KEY', 'FILO_DEFAULT_GEMINI_KEY']) delete env[n];
  Object.assign(env, {
    FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`,
    FILO_BUILD_PASSPHRASE: 'giusta',
    FILO_DEFAULT_TAVILY_KEY: 'tav-di-riserva',
    FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-vecchia',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  });
  try {
    await promisify(execFile)(process.execPath, [BAKE], { env });
    const testo = readFileSync(out, 'utf8');
    const j = JSON.parse(testo);
    assert.equal(j.safeBrowsingKey, 'gsb-ruotata', 'la rotazione dell’admin deve arrivare alla versione');
    assert.equal(j.apiKeys.tavily, 'tav-dal-server');
    assert.deepEqual(Object.keys(j.apiKeys), CHIAVI_DEL_PACCHETTO.map((c) => c.nome));
    assert.doesNotMatch(testo, /or-di-fabbrica|gem-di-fabbrica/);
  } finally {
    togliCartella(dir);
    await new Promise((ok) => srv.close(ok));
  }
});

test('i campi che la costruzione chiede al server sono quelli dichiarati', () => {
  // L'elenco che il server consegna a `buildKeys` va confrontato con questo: chiavi in più
  // viaggiano verso chi ha la parola d'ordine di build senza servire a niente.
  assert.deepEqual(
    [...CHIAVI_DEL_PACCHETTO, FONTE_SAFE_BROWSING].map((c) => c.server).sort(),
    ['config/secrets.apiKeys.tavily', 'config/secrets.safeBrowsingKey'],
    'cambiato qui, va cambiato anche l’elenco che il server consegna a buildKeys',
  );
});
