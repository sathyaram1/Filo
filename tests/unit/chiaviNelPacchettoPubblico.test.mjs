// Sentinella: l'installer è pubblico e il file generato dal bake ci sta in chiaro, quindi ogni stringa che il bake ci scrive la legge chiunque lo scarichi.
// Tiene l'elenco chiuso delle chiavi ammesse, ognuna con la decisione dell'owner che la ammette, e di quelle uscite, ognuna col compito che ne chiede la revoca.
// Chi toglie una chiave dal bake la sposta fra le uscite, apre nello stesso lavoro la domanda di revoca all'owner e la nomina nel report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Un nome con punti o parentesi va fra virgolette: `{"apiKeys.tavily": …}` in cima non deve passare per la voce ammessa.
function passo(percorso, k, lista) {
  if (lista) return `${percorso}[${k}]`;
  if (!/^[A-Za-z_$][\w$]*$/.test(k)) return `${percorso}[${JSON.stringify(k)}]`;
  return percorso ? `${percorso}.${k}` : k;
}

function stringhe(valore, percorso = '', acc = []) {
  if (typeof valore === 'string') {
    acc.push([percorso, valore]);
  } else if (valore && typeof valore === 'object') {
    for (const [k, v] of Object.entries(valore)) stringhe(v, passo(percorso, k, Array.isArray(valore)), acc);
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

  // Un campo fuori elenco è rosso anche vuoto: vuoto vuol dire solo che la prova non ha acceso la sua fonte.
  const tutte = stringhe(generato);
  const scritte = new Map(tutte.filter(([, v]) => v.trim()));
  for (const [campo, valore] of tutte) {
    if (!valore.trim() && (usc.has(campo) || amm.has(campo))) continue;
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

// Le variabili di comando del bake, non fonti di chiavi: accese, lo manderebbero al server vero o fuori dalla cartella usa e getta.
const VARIABILI_DI_COMANDO = new Set(['FILO_BAKE_OUT', 'FILO_ROUTINE_API', 'FILO_BUILD_PASSPHRASE']);

// Gira prima del bake: registra ogni variabile d'ambiente assente che il codice nella cartella del bake chiede, col nome che ha a runtime.
// Conta solo il chiamante diretto: una lettura interna di Node partita da una chiamata del bake non è una fonte di chiavi.
const REGISTRA_LETTURE = `
const { writeFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const reale = process.env;
const uscita = reale.FILO_SENTINELLA_LETTE;
const cartella = reale.FILO_SENTINELLA_CARTELLA;
const dentro = [cartella, pathToFileURL(cartella).href + '/'];
const lette = new Set();
process.env = new Proxy(reale, {
  get(t, k, r) {
    if (typeof k === 'string' && !(k in t)) {
      const chiamante = (new Error().stack || '').split('\\n')[2] || '';
      if (dentro.some((d) => chiamante.includes(d))) lette.add(k);
    }
    return Reflect.get(t, k, r);
  },
});
process.on('exit', () => { try { writeFileSync(uscita, JSON.stringify([...lette])); } catch (_) {} });
`;

// Le fonti dal server sono quelle che il bake nomina, più quelle delle chiavi uscite; quelle del job le accende il bake stesso, chiedendole (bakeColJob).
function fontiDelBake(sorgente) {
  const variabili = new Set(['FILO_DEFAULT_OPENROUTER_KEY', 'FILO_DEFAULT_GEMINI_KEY']);
  const job = Object.fromEntries([...variabili].map((n) => [n, `job-${n.toLowerCase()}`]));
  const server = { ok: true, apiKeys: { tavily: 'srv-tavily', openrouter: 'srv-openrouter', gemini: 'srv-gemini' }, safeBrowsingKey: 'srv-safebrowsing' };
  for (const [, campo] of sorgente.matchAll(/config\/secrets\.([\w.]+)/g)) {
    const [testa, coda] = campo.split('.');
    if (coda && testa === 'apiKeys') server.apiKeys[coda] = `srv-${coda}`;
    else if (!coda) server[testa] = `srv-${testa}`;
  }
  return { job, server };
}

// Il bake in un ambiente pulito più le sorgenti date, con l'uscita in una cartella usa e getta.
// `lette`: le variabili assenti che il bake ha chiesto.
async function bake(sorgenti, percorsoBake = BAKE) {
  const cartella = cartellaTemporanea('filo-bake-pubblico-');
  const out = join(cartella, 'generato.json');
  const registro = join(cartella, 'registra-letture.cjs');
  const lette = join(cartella, 'lette.json');
  writeFileSync(registro, REGISTRA_LETTURE, 'utf8');
  const env = { ...process.env, FILO_BAKE_OUT: out, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
  for (const n of Object.keys(env)) if (n.startsWith('FILO_DEFAULT_') || n === 'FILO_BUILD_PASSPHRASE' || n === 'FILO_ROUTINE_API') delete env[n];
  Object.assign(env, sorgenti, { FILO_SENTINELLA_LETTE: lette, FILO_SENTINELLA_CARTELLA: dirname(resolve(percorsoBake)) });
  try {
    let uscita = 0;
    try { await esegui(process.execPath, ['--require', registro, percorsoBake], { env }); } catch (e) { uscita = typeof e.code === 'number' ? e.code : 1; }
    return {
      uscita,
      generato: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null,
      lette: existsSync(lette) ? JSON.parse(readFileSync(lette, 'utf8')) : null,
    };
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

// Le stesse prove sul bake vero e su una sua copia ritoccata: `percorsoBake` dice quale.
// Ogni variabile che il bake chiede si accende e si rifà il giro, finché non ne chiede di nuove: una chiave scritta solo
// se la sua fonte è piena, con qualunque nome, anche composto a runtime, arriva così nel file e la prova la vede.
async function bakeColJob(percorsoBake = BAKE) {
  const { job } = fontiDelBake(readFileSync(percorsoBake, 'utf8'));
  for (let giro = 0; giro < 20; giro++) {
    const r = await bake(job, percorsoBake);
    assert.ok(Array.isArray(r.lette), 'il registro delle variabili chieste dal bake non è stato scritto');
    const nuove = r.lette.filter((n) => !VARIABILI_DI_COMANDO.has(n) && !(n in job));
    if (!nuove.length) return r;
    for (const n of nuove) job[n] = `job-${n.toLowerCase()}`;
  }
  assert.fail('il bake chiede variabili nuove a ogni giro');
}

async function bakeColServer(percorsoBake = BAKE) {
  const { job, server } = fontiDelBake(readFileSync(percorsoBake, 'utf8'));
  const soloUscite = { FILO_DEFAULT_OPENROUTER_KEY: job.FILO_DEFAULT_OPENROUTER_KEY, FILO_DEFAULT_GEMINI_KEY: job.FILO_DEFAULT_GEMINI_KEY };
  return conServer(server, (canale) => bake({ ...soloUscite, FILO_ROUTINE_API: canale, FILO_BUILD_PASSPHRASE: 'parola-di-prova' }, percorsoBake));
}

// Copia del bake con i moduli che importa, ritoccata come la ritoccherebbe un lavoro futuro.
async function conBakeRitoccato(ritocco, fn) {
  const cartella = cartellaTemporanea('filo-bake-ritoccato-');
  try {
    const scripts = join(cartella, 'scripts');
    mkdirSync(join(scripts, 'lib'), { recursive: true });
    for (const f of ['build-alarm.mjs', join('lib', 'rete.mjs')]) copyFileSync(join(RADICE, 'scripts', f), join(scripts, f));
    const prima = readFileSync(BAKE, 'utf8');
    const dopo = ritocco(prima);
    assert.notEqual(dopo, prima, 'il ritocco non ha trovato il punto del bake da cambiare');
    const copia = join(scripts, 'bake-default-config.mjs');
    writeFileSync(copia, dopo, 'utf8');
    return await fn(copia);
  } finally {
    togliCartella(cartella);
  }
}

test('il bake, con le chiavi uscite fra i segreti del job, scrive tutte le ammesse e nient\'altro', async () => {
  const r = await bakeColJob();
  assert.equal(r.uscita, 0);
  assert.deepEqual(controllaPacchetto(r.generato), []);
});

test('il bake, con le chiavi uscite anche nella risposta del server, scrive tutte le ammesse e nient\'altro', async () => {
  const r = await bakeColServer();
  assert.equal(r.uscita, 0);
  assert.deepEqual(controllaPacchetto(r.generato), []);
  assert.equal(r.generato.apiKeys.tavily, 'srv-tavily', 'la prova deve passare davvero dal server');
});

const CHIAVE_NUOVA_NEL_PACCHETTO = (s) => s.replace(
  "{ nome: 'tavily', env: 'FILO_DEFAULT_TAVILY_KEY', server: 'config/secrets.apiKeys.tavily' },",
  "$&\n  { nome: 'anthropic', env: 'FILO_DEFAULT_ANTHROPIC_KEY', server: 'config/secrets.apiKeys.anthropic' },",
);
const CHIAVE_NUOVA_FUORI_MAPPA = (s) => s.replace(
  'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
  "JSON.stringify({ apiKeys, safeBrowsingKey, mapsKey: envKey('FILO_DEFAULT_MAPS_KEY'), bakedAt",
);
const CHIAVE_NUOVA_SE_PRESENTE = (s) => s.replace(
  'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
  "JSON.stringify({ apiKeys, safeBrowsingKey, ...(envKey('FILO_DEFAULT_MAPS_KEY') ? { mapsKey: envKey('FILO_DEFAULT_MAPS_KEY') } : {}), bakedAt",
);
const CHIAVE_NUOVA_SE_PRESENTE_NOME_LIBERO = (s) => s.replace(
  'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
  'JSON.stringify({ apiKeys, safeBrowsingKey, ...(process.env.GOOGLE_MAPS_KEY ? { mapsKey: process.env.GOOGLE_MAPS_KEY } : {}), bakedAt',
);
const CHIAVE_NUOVA_SE_PRESENTE_NOME_COMPOSTO = (s) => s.replace(
  'JSON.stringify({ apiKeys, safeBrowsingKey, bakedAt',
  "JSON.stringify({ apiKeys, safeBrowsingKey, ...Object.fromEntries(['MAPS'].map((n) => [`${n.toLowerCase()}Key`, envKey(`FILO_DEFAULT_${n}_KEY`)]).filter(([, v]) => v)), bakedAt",
);

test('una chiave nuova aggiunta al bake con la sua fonte è rossa, dal job e dal server, e nomina la chiave', async () => {
  for (const [ritocco, campo] of [
    [CHIAVE_NUOVA_NEL_PACCHETTO, 'apiKeys.anthropic'],
    [CHIAVE_NUOVA_FUORI_MAPPA, 'mapsKey'],
    [CHIAVE_NUOVA_SE_PRESENTE, 'mapsKey'],
    [CHIAVE_NUOVA_SE_PRESENTE_NOME_LIBERO, 'mapsKey'],
    [CHIAVE_NUOVA_SE_PRESENTE_NOME_COMPOSTO, 'mapsKey'],
  ]) {
    await conBakeRitoccato(ritocco, async (copia) => {
      for (const corsa of [bakeColJob, bakeColServer]) {
        if (ritocco !== CHIAVE_NUOVA_NEL_PACCHETTO && corsa === bakeColServer) continue;
        const r = await corsa(copia);
        assert.equal(r.uscita, 0);
        const errori = controllaPacchetto(r.generato);
        assert.ok(errori.some((e) => e.startsWith(`${campo}: campo fuori elenco`)), `${corsa.name}, ${campo}: ${JSON.stringify(errori)}`);
      }
    });
  }
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

test('le regole: un campo fuori elenco è rosso anche vuoto, una chiave uscita vuota no', () => {
  const errori = controllaPacchetto(con((g) => { g.apiKeys.anthropic = ''; g.mapsKey = '  '; return g; }));
  assert.deepEqual(errori.map((e) => e.split(':')[0]).sort(), ['apiKeys.anthropic', 'mapsKey']);
  assert.deepEqual(controllaPacchetto(con((g) => { g.apiKeys.openrouter = ''; return g; })), []);
});

test('le regole: una chiave fuori dalla mappa apiKeys o dentro una lista è rossa uguale', () => {
  const errori = controllaPacchetto(con((g) => { g.extra = { chiavi: ['k1'] }; g.openrouter = 'or'; return g; }));
  assert.deepEqual(errori.map((e) => e.split(':')[0]).sort(), ['extra.chiavi[0]', 'openrouter']);

  const travestita = controllaPacchetto(con((g) => { g['apiKeys.tavily'] = 'tav-2'; return g; }));
  assert.equal(travestita.length, 1);
  assert.match(travestita[0], /^\["apiKeys\.tavily"\]: campo fuori elenco/);
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
