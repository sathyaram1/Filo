// Verifica #642, giro 1 — il cancello che ferma la pubblicazione deve dire
// quale chiave manca, da quali fonti l'ha cercata e dove si rimedia, nel
// registro della costruzione e nel feedback che l'allarme apre.

import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BAKE = join(RADICE, 'scripts', 'bake-default-config.mjs');
const esegui = promisify(execFile);

// Il server finto sta sul cappio locale: senza toglierlo al proxy la prova
// misurerebbe l'ambiente invece del codice.
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
      if (r.grezzo !== undefined) {
        res.writeHead(r.stato, { 'Content-Type': 'text/plain' });
        res.end(r.grezzo);
        return;
      }
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

// Ambiente pulito più quello passato: le chiavi della macchina che fa girare i
// test non devono poter far passare una prova che deve fermarsi.
async function costruisci(ambiente) {
  const cartella = cartellaTemporanea('filo-verifica-642-');
  const generato = join(cartella, 'generato.json');
  const env = { ...process.env, FILO_BAKE_OUT: generato };
  for (const n of ['FILO_BUILD_PASSPHRASE', 'FILO_DEFAULT_OPENROUTER_KEY', 'FILO_DEFAULT_GEMINI_KEY',
    'FILO_DEFAULT_TAVILY_KEY', 'FILO_DEFAULT_SAFEBROWSING_KEY', 'FILO_ROUTINE_API']) delete env[n];
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
  const scritto = existsSync(generato) ? JSON.parse(readFileSync(generato, 'utf8')) : null;
  rmSync(cartella, { recursive: true, force: true });
  return { uscita, scritto, registro: `${stdout}\n${stderr}` };
}

// La riga di annotazione vale solo se sta su una riga: dalla seconda in poi il
// registro della costruzione non la mostra più come guasto.
function rigaGuasto(registro) {
  return (registro.split('\n').find((r) => r.startsWith('::error::')) || '');
}

test('il caso segnalato: il documento dei segreti non ha la chiave che l’applicazione legge', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: true, apiKeys: { openrouter: 'or', gemini: 'gem' } } },
    '/buildAlarm': { stato: 200, json: { ok: true, num: '#1' } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
    expect(r.uscita, 'senza la chiave che l\'applicazione legge la pubblicazione si ferma').not.toBe(0);

    const riga = rigaGuasto(r.registro);
    expect(riga).toContain('Manca tavily');
    expect(riga).toContain('config/secrets.apiKeys.tavily');
    expect(riga).toContain('FILO_DEFAULT_TAVILY_KEY');
    expect(riga, 'deve dire anche dove si rimedia').toContain('Modelli predefiniti');
    expect(riga, 'la parola d\'ordine ha funzionato: darle la colpa manda dalla parte sbagliata')
      .not.toContain('sbagliata, scaduta o revocata');
  } finally {
    await srv.chiudi();
  }
});

test('il feedback aperto dalla costruzione dice le stesse cose del registro', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
    '/buildAlarm': { stato: 200, json: { ok: true, num: '#1' } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'sbagliata' });
    expect(r.registro, 'il motivo del rifiuto non deve sparire').toContain('bad_passphrase');

    const allarme = srv.ricevute.find((x) => x.percorso === '/buildAlarm');
    expect(allarme, 'la costruzione fermata deve aprire un feedback').toBeTruthy();
    const testo = `${allarme.corpo.name}\n${allarme.corpo.text}`;
    expect(allarme.corpo.name).toContain('tavily');
    expect(testo).toContain('config/secrets.apiKeys.tavily');
    expect(testo).toContain('FILO_DEFAULT_TAVILY_KEY');
    expect(testo).toContain('bad_passphrase');
    expect(testo, 'chi apre il feedback deve sapere dove si mette la chiave').toContain('Modelli predefiniti');
    expect(allarme.corpo.passphrase, 'la parola d\'ordine non finisce nel testo del feedback')
      .not.toBe(undefined);
    expect(testo).not.toContain('sbagliata\n');
  } finally {
    await srv.chiudi();
  }
});

test('ogni modo di non avere la chiave si racconta in modo diverso, e nomina sempre la chiave', async () => {
  const casi = [
    { nome: 'rifiuto', risposta: { stato: 200, json: { ok: false, reason: 'bad_passphrase' } }, atteso: /bad_passphrase/ },
    { nome: 'http', risposta: { stato: 500, json: { error: 'boom' } }, atteso: /HTTP 500/ },
    { nome: 'illeggibile', risposta: { stato: 200, grezzo: '<html>non sono json</html>' }, atteso: /JSON/ },
    { nome: 'vuoto', risposta: { stato: 200, json: { ok: true, apiKeys: {} } }, atteso: /nessuna chiave|senza questa chiave/ },
  ];
  for (const caso of casi) {
    const srv = await serverFinto({ '/buildKeys': caso.risposta, '/buildAlarm': { stato: 200, json: { ok: true } } });
    try {
      const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'p' });
      const riga = rigaGuasto(r.registro);
      expect(r.uscita, caso.nome).not.toBe(0);
      expect(riga, caso.nome).toContain('Manca tavily');
      expect(riga, caso.nome).toContain('FILO_DEFAULT_TAVILY_KEY');
      expect(riga, caso.nome).toMatch(caso.atteso);
    } finally {
      await srv.chiudi();
    }
  }

  const r = await costruisci({ FILO_ROUTINE_API: 'http://127.0.0.1:1', FILO_BUILD_PASSPHRASE: 'p' });
  expect(rigaGuasto(r.registro), 'server irraggiungibile').toContain('Manca tavily');
  expect(r.registro).toMatch(/non era raggiungibile/);

  const senza = await costruisci({});
  expect(rigaGuasto(senza.registro), 'nemmeno la parola d\'ordine').toContain('Manca tavily');
  expect(senza.registro).toMatch(/FILO_BUILD_PASSPHRASE è assente/);
});

test('motivi limite: vuoti, non-stringa, enormi, con emoji e marcatori', async () => {
  const casi = [
    { json: { ok: false }, non: ['undefined', 'reason: '] },
    { json: { ok: false, reason: '   ' }, non: ['reason:    ', '[object Object]'] },
    { json: { ok: false, reason: { codice: 9 }, message: 'parola scaduta' }, si: ['parola scaduta'], non: ['[object Object]'] },
    { json: { ok: false, reason: '🙈<script>alert(1)</script>' }, si: ['🙈<script>alert(1)</script>'], non: ['[object Object]'] },
    { json: { ok: false, reason: 'x'.repeat(30000) }, non: ['[object Object]'] },
  ];
  for (const caso of casi) {
    const srv = await serverFinto({
      '/buildKeys': { stato: 200, json: caso.json },
      '/buildAlarm': { stato: 200, json: { ok: true } },
    });
    try {
      const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'p' });
      const riga = rigaGuasto(r.registro);
      expect(riga, JSON.stringify(caso.json).slice(0, 60)).toContain('Manca tavily');
      for (const s of caso.si || []) expect(r.registro).toContain(s);
      for (const s of caso.non || []) expect(r.registro).not.toContain(s);

      const allarme = srv.ricevute.find((x) => x.percorso === '/buildAlarm');
      expect(allarme.corpo.text.length, 'il testo dell\'allarme resta entro il tetto del server')
        .toBeLessThanOrEqual(10000);
      expect(allarme.corpo.text, 'la chiave che manca sopravvive al taglio').toContain('Manca tavily');
    } finally {
      await srv.chiudi();
    }
  }
});

test('la strada buona non si rompe: la chiave del server arriva nel file', async () => {
  for (const json of [{ ok: true, apiKeys: { tavily: 'dal-server' } }, { apiKeys: { tavily: 'dal-server' } }]) {
    const srv = await serverFinto({ '/buildKeys': { stato: 200, json } });
    try {
      const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
      expect(r.uscita, r.registro).toBe(0);
      expect(r.scritto.apiKeys.tavily).toBe('dal-server');
      expect(r.registro).not.toContain('::error::');
      expect(r.registro, 'il registro non deve mai portare il valore di una chiave')
        .not.toContain('dal-server');
    } finally {
      await srv.chiudi();
    }
  }

  const daEnv = await costruisci({ FILO_DEFAULT_TAVILY_KEY: 'segreto-di-riserva' });
  expect(daEnv.uscita).toBe(0);
  expect(daEnv.scritto.apiKeys.tavily).toBe('segreto-di-riserva');
  expect(daEnv.registro).not.toContain('segreto-di-riserva');
});

test('la chiave dei siti pericolosi non ferma la pubblicazione, ma non sparisce in silenzio', async () => {
  const srv = await serverFinto({ '/buildKeys': { stato: 200, json: { ok: true, apiKeys: { tavily: 't' } } } });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
    expect(r.uscita).toBe(0);
    const avviso = r.registro.split('\n').find((x) => x.startsWith('::warning::')) || '';
    expect(avviso).toContain('safeBrowsing');
    expect(avviso).toContain('config/secrets.safeBrowsingKey');
    expect(avviso).toContain('FILO_DEFAULT_SAFEBROWSING_KEY');
  } finally {
    await srv.chiudi();
  }
});
