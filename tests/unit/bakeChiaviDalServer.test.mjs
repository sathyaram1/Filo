// Il contratto fra `buildKeys` e la costruzione: il server consegna solo i
// campi dichiarati in CHIAVI_DEL_PACCHETTO e FONTE_SAFE_BROWSING, e la
// costruzione legge esattamente quelli, con precedenza sui segreti del job (#1074).

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { CHIAVI_DEL_PACCHETTO, FONTE_SAFE_BROWSING } from '../../scripts/bake-default-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BAKE = join(resolve(__dirname, '..', '..'), 'scripts', 'bake-default-config.mjs');
const esegui = promisify(execFile);
const PREFISSO = 'config/secrets.';

async function serverFinto(json) {
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url === '/buildKeys' ? json : { ok: true }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    chiudi: () => new Promise((ok) => srv.close(ok)),
  };
}

// Le chiavi della macchina che fa girare la prova non devono poterla far passare.
async function costruisci(rispostaServer, ambiente = {}) {
  const srv = await serverFinto(rispostaServer);
  const cartella = cartellaTemporanea('filo-bake-1074-');
  const out = join(cartella, 'generato.json');
  const env = { ...process.env, FILO_BAKE_OUT: out };
  for (const n of ['FILO_DEFAULT_OPENROUTER_KEY', 'FILO_DEFAULT_GEMINI_KEY',
    'FILO_DEFAULT_TAVILY_KEY', 'FILO_DEFAULT_SAFEBROWSING_KEY']) delete env[n];
  Object.assign(env, {
    FILO_ROUTINE_API: srv.base,
    FILO_BUILD_PASSPHRASE: 'giusta',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  }, ambiente);
  try {
    let uscita = 0;
    let registro = '';
    try {
      const r = await esegui(process.execPath, [BAKE], { env });
      registro = `${r.stdout}\n${r.stderr}`;
    } catch (e) {
      uscita = typeof e.code === 'number' ? e.code : 1;
      registro = `${e.stdout || ''}\n${e.stderr || ''}`;
    }
    const testo = existsSync(out) ? readFileSync(out, 'utf8') : '';
    return { uscita, registro, testo, contenuto: testo ? JSON.parse(testo) : null };
  } finally {
    togliCartella(cartella);
    await srv.chiudi();
  }
}

// Dove l'applicazione trova nel file generato la chiave di una voce.
function nelFile(contenuto, voce) {
  return voce === FONTE_SAFE_BROWSING ? contenuto.safeBrowsingKey : contenuto.apiKeys[voce.nome];
}

test('ogni campo che la costruzione dichiara di chiedere al server è quello che legge', async () => {
  const voci = [...CHIAVI_DEL_PACCHETTO, FONTE_SAFE_BROWSING];
  const risposta = { ok: true };
  for (const voce of voci) {
    assert.ok(voce.server.startsWith(PREFISSO), `${voce.nome}: campo fuori dal documento dei segreti`);
    const passi = voce.server.slice(PREFISSO.length).split('.');
    let nodo = risposta;
    for (const p of passi.slice(0, -1)) nodo = (nodo[p] ||= {});
    nodo[passi.at(-1)] = `dal-server-${voce.nome}`;
  }

  const r = await costruisci(risposta);
  assert.equal(r.uscita, 0, r.registro);
  for (const voce of voci) {
    assert.equal(nelFile(r.contenuto, voce), `dal-server-${voce.nome}`,
      `${voce.nome}: il server la consegna in ${voce.server} ma il pacchetto non la prende da lì`);
  }
});

test('la chiave Safe Browsing ruotata sul server vince sul segreto del job', async () => {
  const r = await costruisci(
    { ok: true, apiKeys: { tavily: 'tav-server' }, safeBrowsingKey: 'gsb-ruotata' },
    { FILO_DEFAULT_TAVILY_KEY: 'tav-job', FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-job' },
  );
  assert.equal(r.uscita, 0, r.registro);
  assert.equal(r.contenuto.safeBrowsingKey, 'gsb-ruotata');
  assert.equal(r.contenuto.apiKeys.tavily, 'tav-server');
  assert.doesNotMatch(r.registro, /::warning::/, 'col server che consegna tutto non c\'è niente da segnalare');
});

test('chiavi in più dal server non finiscono nel pacchetto', async () => {
  // La risposta di oggi: OpenRouter di fabbrica e Gemini, che l'installer non legge.
  const r = await costruisci({
    ok: true,
    apiKeys: { openrouter: 'or-di-fabbrica', gemini: 'gem-di-fabbrica', tavily: 'tav-server' },
    safeBrowsingKey: 'gsb-server',
  });
  assert.equal(r.uscita, 0, r.registro);
  assert.deepEqual(Object.keys(r.contenuto.apiKeys), CHIAVI_DEL_PACCHETTO.map((c) => c.nome));
  assert.doesNotMatch(r.testo, /or-di-fabbrica|gem-di-fabbrica/);
});
