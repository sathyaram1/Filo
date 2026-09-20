// Il cancello che ferma la pubblicazione deve dire QUALE chiave manca e dove
// si mette. Sentinella nata dal #642.
//
// Il caso. Dall'11/09 il cancello conta solo le chiavi che l'applicazione legge
// davvero, e sul server quel documento non ne aveva nessuna: da allora nessuna
// versione è uscita. Il registro diceva «Nessuna chiave di default da nessuna
// fonte» e la mail di GitHub «workflow fallito» — otto giorni per scoprire che
// mancava una riga in un documento. Peggio: la risposta di rifiuto del server
// arriva con HTTP 200 e `ok:false`, quindi una parola d'ordine sbagliata
// diventava un oggetto vuoto senza nemmeno una riga nel registro.
//
// La regola che questa sentinella tiene ferma: chi legge il guasto — nel
// registro della costruzione o nel feedback che l'allarme apre — sa il nome
// della chiave, le fonti da cui è stata cercata e perché il server non l'ha
// data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// La cartella temporanea si chiede sempre a questo aiuto (CLAUDE.md § Run/test).
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { spiegaChiaviMancanti, descriviEsitoServer } from '../../scripts/bake-default-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(__dirname, '..', '..');
const BAKE = join(RADICE, 'scripts', 'bake-default-config.mjs');
const esegui = promisify(execFile);

// Ambiente pulito più quello passato: le chiavi della macchina che fa girare i
// test non devono poter far passare una prova che deve fallire.
async function costruisci(ambiente) {
  const cartella = cartellaTemporanea('filo-bake-642-');
  const env = { ...process.env, FILO_BAKE_OUT: join(cartella, 'generato.json') };
  for (const n of ['FILO_BUILD_PASSPHRASE', 'FILO_DEFAULT_OPENROUTER_KEY', 'FILO_DEFAULT_GEMINI_KEY',
    'FILO_DEFAULT_TAVILY_KEY', 'FILO_DEFAULT_SAFEBROWSING_KEY', 'FILO_ROUTINE_API']) delete env[n];
  // Il server finto sta sul cappio locale: un proxy in mezzo lo renderebbe
  // irraggiungibile e la prova misurerebbe l'ambiente invece del codice.
  env.NO_PROXY = '127.0.0.1,localhost';
  env.no_proxy = '127.0.0.1,localhost';
  Object.assign(env, ambiente);

  let uscita = 0;
  let stdout = '';
  let stderr = '';
  try {
    const r = await esegui(process.execPath, [BAKE], { env });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (e) {
    uscita = typeof e.code === 'number' ? e.code : 1;
    stdout = e.stdout || '';
    stderr = e.stderr || '';
  }
  rmSync(cartella, { recursive: true, force: true });
  return { uscita, registro: `${stdout}\n${stderr}` };
}

// Server finto: risponde quello che gli si dice e tiene le richieste ricevute,
// così si può guardare cosa è finito nel testo dell'allarme.
async function serverFinto(risposte) {
  const ricevute = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(corpo); } catch (_) {}
      ricevute.push({ percorso: req.url, corpo: json });
      const r = risposte[req.url] || { stato: 200, json: { ok: true } };
      res.writeHead(r.stato, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    ricevute,
    chiudi: () => new Promise((ok) => srv.close(ok)),
  };
}

test('la spiegazione nomina la chiave, il campo del server e il segreto del job', () => {
  const righe = spiegaChiaviMancanti(
    [{ nome: 'tavily', env: 'FILO_DEFAULT_TAVILY_KEY', server: 'config/secrets.apiKeys.tavily' }],
    { stato: 'senza-chiavi' }
  ).join(' ');

  assert.match(righe, /tavily/);
  assert.match(righe, /config\/secrets\.apiKeys\.tavily/);
  assert.match(righe, /FILO_DEFAULT_TAVILY_KEY/);
  assert.match(righe, /Modelli predefiniti/,
    'deve dire anche DOVE si mette la chiave, non solo che manca');
});

test('una parola d’ordine rifiutata si legge come tale, non come "non c’era"', () => {
  const rifiuto = descriviEsitoServer({ stato: 'rifiutato', reason: 'bad_passphrase' });
  assert.match(rifiuto, /bad_passphrase/);
  assert.match(rifiuto, /FILO_BUILD_PASSPHRASE/);

  // Le due situazioni non devono raccontarsi con la stessa frase: sono due
  // rimedi diversi (la parola d'ordine da rifare, o la chiave da mettere).
  assert.notEqual(rifiuto, descriviEsitoServer({ stato: 'senza-chiavi' }));
});

test('senza nessuna fonte il cancello dice quale chiave manca e da dove l’ha cercata', async () => {
  const r = await costruisci({});
  assert.notEqual(r.uscita, 0, 'senza nessuna chiave la pubblicazione deve fermarsi');
  assert.match(r.registro, /::error::/);
  assert.match(r.registro, /tavily/, 'il guasto deve nominare la chiave che manca');
  assert.match(r.registro, /config\/secrets\.apiKeys\.tavily/,
    'il guasto deve nominare il campo del documento sul server');
  assert.match(r.registro, /FILO_DEFAULT_TAVILY_KEY/,
    'il guasto deve nominare il segreto di riserva del job');
});

test('una risposta di rifiuto del server non passa in silenzio', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
    '/buildAlarm': { stato: 200, json: { ok: true, num: '#1' } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'sbagliata' });
    assert.notEqual(r.uscita, 0);
    // HTTP 200 con ok:false diventava `{}`, indistinguibile da un documento
    // senza quella chiave: il motivo vero non compariva da nessuna parte.
    assert.match(r.registro, /bad_passphrase/,
      'il motivo del rifiuto deve comparire nel registro della costruzione');
  } finally {
    await srv.chiudi();
  }
});

test('il caso vero: il server risponde, ma con chiavi che l’applicazione non legge', async () => {
  // Il documento dei segreti ha openrouter e gemini, non tavily: è la
  // situazione che dal 10/09 teneva ferma la pubblicazione. Qui il server non
  // ha sbagliato niente — va detto così, perché il rimedio è un altro.
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: true, apiKeys: { openrouter: 'or', gemini: 'gem' } } },
    '/buildAlarm': { stato: 200, json: { ok: true } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
    assert.notEqual(r.uscita, 0);
    assert.match(r.registro, /Manca tavily/);
    assert.match(r.registro, /config\/secrets\.apiKeys\.tavily/);
    assert.doesNotMatch(r.registro, /rifiutato|FILO_BUILD_PASSPHRASE è sbagliata/,
      'la parola d\'ordine ha funzionato: dare la colpa a lei manda chi legge dalla parte sbagliata');
  } finally {
    await srv.chiudi();
  }
});

test('un rifiuto malfatto si spiega lo stesso, senza «[object Object]»', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: false, reason: { codice: 9 }, message: 'parola d\'ordine scaduta' } },
    '/buildAlarm': { stato: 200, json: { ok: true } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'scaduta' });
    assert.match(r.registro, /parola d'ordine scaduta/,
      'se `reason` non è una stringa si ripiega sugli altri campi invece di tacere');
    assert.doesNotMatch(r.registro, /\[object Object\]/);
  } finally {
    await srv.chiudi();
  }
});

test('una risposta che non è JSON non si racconta come "il documento è vuoto"', () => {
  // Due guasti diversi, due rimedi diversi: un indirizzo sbagliato non si cura
  // mettendo una chiave nel documento.
  assert.notEqual(
    descriviEsitoServer({ stato: 'illeggibile' }),
    descriviEsitoServer({ stato: 'senza-chiavi' })
  );
  assert.match(descriviEsitoServer({ stato: 'illeggibile' }), /JSON/);
});

test('le chiavi del server continuano a passare, con o senza il campo ok', async () => {
  // La guardia sul rifiuto non deve mangiare la strada buona: qui il server
  // risponde davvero, ed è la sola strada che porta agli utenti una chiave
  // ruotata dall'owner.
  for (const json of [{ ok: true, apiKeys: { tavily: 'dal-server' } }, { apiKeys: { tavily: 'dal-server' } }]) {
    const srv = await serverFinto({ '/buildKeys': { stato: 200, json } });
    try {
      const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
      assert.equal(r.uscita, 0, `con le chiavi dal server la costruzione deve passare: ${r.registro}`);
      assert.doesNotMatch(r.registro, /::error::/);
      assert.doesNotMatch(r.registro, /Manca tavily/);
    } finally {
      await srv.chiudi();
    }
  }
});

// Le righe in evidenza sono quelle che il registro della costruzione mostra
// come avvisi: una riga qualsiasi in fondo al log non la legge nessuno.
function inEvidenza(registro) {
  return registro.split('\n').filter((r) => r.startsWith('::warning::')).join('\n');
}

test('un rifiuto del server non passa in sordina solo perché i segreti del job reggono', async () => {
  // La pubblicazione esce verde, ma la chiave appena cambiata dall'owner non è
  // arrivata a nessuno: senza un avviso in evidenza lo si scopre settimane dopo.
  const srv = await serverFinto({ '/buildKeys': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } } });
  try {
    const r = await costruisci({
      FILO_ROUTINE_API: srv.base,
      FILO_BUILD_PASSPHRASE: 'sbagliata',
      FILO_DEFAULT_TAVILY_KEY: 'di-riserva',
      FILO_DEFAULT_SAFEBROWSING_KEY: 'di-riserva',
    });
    assert.equal(r.uscita, 0, `coi segreti del job la versione esce: ${r.registro}`);
    const avvisi = inEvidenza(r.registro);
    assert.match(avvisi, /bad_passphrase/,
      'il rifiuto deve stare fra gli avvisi, non solo in coda al registro');
    assert.match(avvisi, /Modelli predefiniti/,
      'chi legge deve capire che una chiave cambiata di recente non è arrivata');
  } finally {
    await srv.chiudi();
  }
});

test('quando il server dà le chiavi non si grida al lupo', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: true, apiKeys: { tavily: 't' }, safeBrowsingKey: 'g' } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
    assert.equal(r.uscita, 0);
    assert.equal(inEvidenza(r.registro), '',
      'un avviso che compare anche quando è tutto a posto smette di significare qualcosa');
  } finally {
    await srv.chiudi();
  }
});

test('se il feedback dell’allarme non viene consegnato, lo si viene a sapere', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
    '/buildAlarm': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'sbagliata' });
    assert.notEqual(r.uscita, 0);
    assert.match(inEvidenza(r.registro), /non consegnato/,
      'una pubblicazione ferma di cui nessun feedback parla non deve restare invisibile');
  } finally {
    await srv.chiudi();
  }
});

test('senza parola d’ordine l’allarme non parte, e il registro lo dice', async () => {
  // È il caso peggiore: la pubblicazione si ferma e il feedback non può nemmeno
  // essere tentato. Tacerlo fa credere che qualcuno sia stato avvisato.
  const r = await costruisci({});
  assert.notEqual(r.uscita, 0);
  assert.match(inEvidenza(r.registro), /Nessun feedback aperto/);
});

test('l’allarme porta le stesse informazioni del registro', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
    '/buildAlarm': { stato: 200, json: { ok: true, num: '#1' } },
  });
  try {
    await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'sbagliata' });

    const allarme = srv.ricevute.find((x) => x.percorso === '/buildAlarm');
    assert.ok(allarme, 'la costruzione fermata deve aprire un feedback');
    const testo = `${allarme.corpo.name}\n${allarme.corpo.text}`;
    assert.match(testo, /tavily/, 'chi apre il feedback deve leggere quale chiave manca');
    assert.match(testo, /config\/secrets\.apiKeys\.tavily/);
    assert.match(testo, /FILO_DEFAULT_TAVILY_KEY/);
    assert.match(testo, /bad_passphrase/,
      'anche il perché il server non l\'ha data deve arrivare nel feedback');
  } finally {
    await srv.chiudi();
  }
});
