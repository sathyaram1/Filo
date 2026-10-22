// Sentinella: l'installer è pubblico e il file generato dal bake ci sta in chiaro, quindi ogni stringa che il bake ci scrive la legge chiunque lo scarichi.
// Tiene l'elenco chiuso delle chiavi ammesse, ognuna con la decisione dell'owner che la ammette, e di quelle uscite, ognuna col compito che ne chiede la revoca.
// Chi toglie una chiave dal bake la sposta fra le uscite, apre nello stesso lavoro la domanda di revoca all'owner e la nomina nel report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BAKE = join(RADICE, 'scripts', 'bake-default-config.mjs');
const MODULO = join(RADICE, 'src', 'main', 'config', 'default-keys.js');
const esegui = promisify(execFile);

// L'elenco sta qui e non nel bake: se stesse là, aggiungere una chiave al bake basterebbe a farla passare.
const AMMESSE = [
  { campo: 'apiKeys.tavily', decisione: 'D4 (08/10): la ricerca web resta nel programma, col tetto sul conto Tavily' },
  { campo: 'safeBrowsingKey', decisione: 'D45 (04/10): resta finché #964 non passa a Web Risk dal server; l\'API è gratuita, il rischio è la quota' },
];

// `revoca`: il feedback (#n) o la domanda (D-n) che chiede all'owner di revocarla; `release`: quelle uscite che la portano ancora.
const USCITE = [
  { campo: 'apiKeys.openrouter', revoca: '#598', release: 'fino a v0.2.225', nota: 'revoca chiesta all\'owner in chat il 21/10' },
  { campo: 'apiKeys.gemini', revoca: '#581', release: 'fino a v0.2.228', nota: 'revoca chiesta all\'owner in chat il 21/10' },
];

// Non sono chiavi, ma la forma è stretta: in un campo libero una chiave ci si nasconderebbe.
const NON_CHIAVI = [
  { campo: 'bakedAt', forma: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/ },
];

const RIFERIMENTO_REVOCA = /^(#\d+(\.\d+)?|D-\d+)$/;

function stringhePiene(valore, percorso = '', acc = []) {
  if (typeof valore === 'string') {
    if (valore.trim()) acc.push([percorso, valore]);
  } else if (valore && typeof valore === 'object') {
    for (const [k, v] of Object.entries(valore)) {
      stringhePiene(v, Array.isArray(valore) ? `${percorso}[${k}]` : (percorso ? `${percorso}.${k}` : k), acc);
    }
  }
  return acc;
}

/** Gli errori del file generato rispetto agli elenchi; ognuno comincia col campo che lo causa. PURA. */
function controllaPacchetto(generato, { ammesse = AMMESSE, uscite = USCITE, nonChiavi = NON_CHIAVI } = {}) {
  const errori = [];
  const amm = new Map(ammesse.map((v) => [v.campo, v]));
  const usc = new Map(uscite.map((v) => [v.campo, v]));
  const non = new Map(nonChiavi.map((v) => [v.campo, v]));

  for (const v of ammesse) {
    if (!String(v.decisione || '').trim()) errori.push(`${v.campo}: voce ammessa senza la decisione dell'owner che la ammette.`);
    if (usc.has(v.campo)) errori.push(`${v.campo}: sta sia fra le ammesse sia fra le uscite.`);
  }
  for (const v of uscite) {
    if (!RIFERIMENTO_REVOCA.test(String(v.revoca || '').trim())) {
      errori.push(`${v.campo}: chiave uscita senza il compito di revoca: serve il numero del feedback (#n) o della domanda (D-n) che chiede all'owner di revocarla.`);
    }
  }

  const scritte = new Map(stringhePiene(generato));
  for (const [campo, valore] of scritte) {
    if (usc.has(campo)) {
      errori.push(`${campo}: chiave uscita con ${usc.get(campo).revoca} e tornata nel file generato, che chiunque scarichi l'installer legge. Per rimetterla serve una decisione dell'owner, e la voce torna fra le ammesse.`);
    } else if (non.has(campo)) {
      if (!non.get(campo).forma.test(valore)) errori.push(`${campo}: non ha la forma ${non.get(campo).forma}, e in un campo che non è una chiave una chiave non deve stare.`);
    } else if (!amm.has(campo)) {
      errori.push(`${campo}: campo fuori elenco nel file generato. L'installer è pubblico: per entrare serve una decisione dell'owner, scritta fra le ammesse di questa sentinella.`);
    }
  }
  for (const campo of amm.keys()) {
    if (!scritte.has(campo)) {
      errori.push(`${campo}: voce ammessa che il bake non scrive più. Va spostata fra le uscite col numero del feedback (#n) o della domanda (D-n) che chiede all'owner di revocarla, aperto in questo stesso lavoro e nominato nel report.`);
    }
  }
  return errori;
}

const VALIDO = { apiKeys: { tavily: 'tav' }, safeBrowsingKey: 'gsb', bakedAt: '2026-10-22T10:00:00.000Z' };
const con = (modifica) => modifica(structuredClone(VALIDO));

// Il bake in un ambiente pulito più le sorgenti date, con l'uscita in una cartella usa e getta.
async function bake(sorgenti) {
  const cartella = cartellaTemporanea('filo-bake-pubblico-');
  const out = join(cartella, 'generato.json');
  const env = { ...process.env, FILO_BAKE_OUT: out, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
  for (const n of Object.keys(env)) if (n.startsWith('FILO_DEFAULT_') || n === 'FILO_BUILD_PASSPHRASE' || n === 'FILO_ROUTINE_API') delete env[n];
  Object.assign(env, sorgenti);
  try {
    let uscita = 0;
    try { await esegui(process.execPath, [BAKE], { env }); } catch (e) { uscita = typeof e.code === 'number' ? e.code : 1; }
    return { uscita, generato: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null };
  } finally {
    togliCartella(cartella);
  }
}

async function conServer(risposta, fn) {
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url === '/buildKeys' ? risposta : { ok: true }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}`);
  } finally {
    await new Promise((ok) => srv.close(ok));
  }
}

test('il bake, con le chiavi uscite fra i segreti del job, scrive tutte le ammesse e nient\'altro', async () => {
  const r = await bake({
    FILO_DEFAULT_TAVILY_KEY: 'tav-del-job',
    FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-del-job',
    FILO_DEFAULT_OPENROUTER_KEY: 'or-del-job',
    FILO_DEFAULT_GEMINI_KEY: 'gem-del-job',
  });
  assert.equal(r.uscita, 0);
  assert.deepEqual(controllaPacchetto(r.generato), []);
});

test('il bake, con le chiavi uscite anche nella risposta del server, scrive tutte le ammesse e nient\'altro', async () => {
  const r = await conServer({
    ok: true,
    apiKeys: { tavily: 'tav-dal-server', openrouter: 'or-dal-server', gemini: 'gem-dal-server' },
    safeBrowsingKey: 'gsb-dal-server',
  }, (canale) => bake({
    FILO_ROUTINE_API: canale,
    FILO_BUILD_PASSPHRASE: 'parola-di-prova',
    FILO_DEFAULT_OPENROUTER_KEY: 'or-del-job',
    FILO_DEFAULT_GEMINI_KEY: 'gem-del-job',
  }));
  assert.equal(r.uscita, 0);
  assert.deepEqual(controllaPacchetto(r.generato), []);
  assert.equal(r.generato.apiKeys.tavily, 'tav-dal-server', 'la prova deve passare davvero dal server');
});

test('un file generato che porta solo chiavi uscite non dà niente all\'applicazione', async () => {
  // Una copia identica del modulo vero, accanto al suo file generato: quello vero lo calpesterebbero le altre prove in parallelo.
  const cartella = cartellaTemporanea('filo-chiavi-uscite-');
  try {
    copyFileSync(MODULO, join(cartella, 'default-keys.js'));
    const generato = {};
    for (const { campo } of USCITE) {
      const [testa, coda] = campo.split('.');
      if (coda) (generato[testa] ||= {})[coda] = `uscita-${coda}`;
      else generato[testa] = `uscita-${testa}`;
    }
    writeFileSync(join(cartella, 'default-keys.generated.json'), JSON.stringify(generato), 'utf8');
    const env = { ...process.env };
    for (const n of Object.keys(env)) if (n.startsWith('FILO_DEFAULT_')) delete env[n];
    const codice = `const m = require(${JSON.stringify(join(cartella, 'default-keys.js'))});`
      + 'console.log(JSON.stringify({ build: m.getBuildKeys(), gsb: m.getBuildSafeBrowsingKey(), almenoUna: m.hasAnyBuildKey() }))';
    const { stdout } = await esegui(process.execPath, ['-e', codice], { env });
    const letto = JSON.parse(stdout.trim());
    assert.ok(!JSON.stringify(letto).includes('uscita-'), `una chiave uscita arriva ancora all'applicazione: ${JSON.stringify(letto)}`);
    assert.equal(letto.almenoUna, false);
  } finally {
    togliCartella(cartella);
  }
});

test('le regole: un file con le sole chiavi ammesse e la data del bake passa', () => {
  assert.deepEqual(controllaPacchetto(VALIDO), []);
});

test('le regole: un campo in più è rosso e nomina la chiave', () => {
  const errori = controllaPacchetto(con((g) => { g.apiKeys.anthropic = 'sk-ant'; return g; }));
  assert.equal(errori.length, 1);
  assert.match(errori[0], /^apiKeys\.anthropic: campo fuori elenco/);
});

test('le regole: una chiave fuori dalla mappa apiKeys o dentro una lista è rossa uguale', () => {
  const errori = controllaPacchetto(con((g) => { g.extra = { chiavi: ['k1'] }; g.openrouter = 'or'; return g; }));
  assert.deepEqual(errori.map((e) => e.split(':')[0]).sort(), ['extra.chiavi[0]', 'openrouter']);
});

test('le regole: una voce ammessa sparita senza revoca è rossa e nomina la chiave', () => {
  for (const generato of [
    con((g) => { delete g.safeBrowsingKey; return g; }),
    con((g) => { g.safeBrowsingKey = '   '; return g; }),
  ]) {
    const errori = controllaPacchetto(generato);
    assert.equal(errori.length, 1);
    assert.match(errori[0], /^safeBrowsingKey: voce ammessa che il bake non scrive più/);
  }
});

test('le regole: spostata fra le uscite col compito di revoca, la voce sparita torna verde', () => {
  const senza = con((g) => { delete g.safeBrowsingKey; return g; });
  const ammesse = AMMESSE.filter((v) => v.campo !== 'safeBrowsingKey');
  assert.deepEqual(controllaPacchetto(senza, { ammesse, uscite: [...USCITE, { campo: 'safeBrowsingKey', revoca: '#964' }] }), []);

  const errori = controllaPacchetto(senza, { ammesse, uscite: [...USCITE, { campo: 'safeBrowsingKey', revoca: '' }] });
  assert.equal(errori.length, 1);
  assert.match(errori[0], /^safeBrowsingKey: chiave uscita senza il compito di revoca/);
});

test('le regole: una chiave uscita che ricompare è rossa e nomina la chiave', () => {
  const errori = controllaPacchetto(con((g) => { g.apiKeys.openrouter = 'sk-or'; return g; }));
  assert.equal(errori.length, 1);
  assert.match(errori[0], /^apiKeys\.openrouter: chiave uscita con #598 e tornata/);
});

test('le regole: una chiave nascosta nella data del bake è rossa', () => {
  const errori = controllaPacchetto(con((g) => { g.bakedAt = 'AIzaSyFinta'; return g; }));
  assert.equal(errori.length, 1);
  assert.match(errori[0], /^bakedAt: non ha la forma/);
});

test('gli elenchi: un\'ammessa senza decisione o che sta anche fra le uscite è rossa', () => {
  const errori = controllaPacchetto(VALIDO, {
    ammesse: [...AMMESSE, { campo: 'apiKeys.openrouter', decisione: '' }],
  });
  assert.ok(errori.some((e) => /^apiKeys\.openrouter: voce ammessa senza la decisione/.test(e)));
  assert.ok(errori.some((e) => /^apiKeys\.openrouter: sta sia fra le ammesse sia fra le uscite/.test(e)));
});
