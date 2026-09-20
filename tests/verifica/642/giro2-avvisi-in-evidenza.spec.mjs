// Verifica #642, giro 2 — le porte chiuse nel giro 1: quando la pubblicazione
// esce lo stesso (segreti di riserva del job) ciò che è andato storto deve
// restare in evidenza nel riepilogo della costruzione, e non in coda al registro.

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
  const cartella = cartellaTemporanea('filo-verifica-642-g2-');
  const generato = join(cartella, 'generato.json');
  const env = { ...process.env, FILO_BAKE_OUT: generato };
  for (const n of ['FILO_BUILD_PASSPHRASE', 'FILO_DEFAULT_TAVILY_KEY',
    'FILO_DEFAULT_SAFEBROWSING_KEY', 'FILO_ROUTINE_API']) delete env[n];
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

// Il riepilogo della costruzione mostra solo le righe annotate: il resto è
// registro grezzo, che si legge quando si sospetta già qualcosa.
function inEvidenza(registro) {
  return registro.split('\n').filter((r) => r.startsWith('::warning::')).join('\n');
}

test('parola d’ordine rifiutata ma segreti di riserva presenti: la versione esce e il riepilogo lo dice', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
  });
  try {
    const r = await costruisci({
      FILO_ROUTINE_API: srv.base,
      FILO_BUILD_PASSPHRASE: 'scaduta',
      FILO_DEFAULT_TAVILY_KEY: 'di-riserva',
      FILO_DEFAULT_SAFEBROWSING_KEY: 'di-riserva',
    });
    expect(r.uscita, `coi segreti del job la versione esce: ${r.registro}`).toBe(0);
    expect(r.scritto.apiKeys.tavily).toBe('di-riserva');

    const avvisi = inEvidenza(r.registro);
    expect(avvisi, 'il rifiuto deve stare fra gli avvisi, non solo in coda al registro')
      .toContain('bad_passphrase');
    expect(avvisi, 'chi legge deve capire che una chiave appena cambiata non è arrivata')
      .toContain('Modelli predefiniti');
    expect(r.registro, 'il registro non porta mai il valore di una chiave')
      .not.toContain('di-riserva');
  } finally {
    await srv.chiudi();
  }
});

test('se il feedback dell’allarme non arriva, il riepilogo non tace', async () => {
  for (const risposta of [
    { stato: 200, json: { ok: false, reason: 'bad_passphrase' } },
    { stato: 500, json: { error: 'boom' } },
  ]) {
    const srv = await serverFinto({
      '/buildKeys': { stato: 200, json: { ok: true, apiKeys: { openrouter: 'or' } } },
      '/buildAlarm': risposta,
    });
    try {
      const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
      expect(r.uscita, 'senza la chiave che l’applicazione legge ci si ferma').not.toBe(0);
      expect(inEvidenza(r.registro), `allarme respinto con ${risposta.stato}`)
        .toContain('non consegnato');
    } finally {
      await srv.chiudi();
    }
  }

  // Server dell'allarme che non risponde proprio.
  const r = await costruisci({ FILO_ROUTINE_API: 'http://127.0.0.1:1', FILO_BUILD_PASSPHRASE: 'p' });
  expect(inEvidenza(r.registro)).toContain('non consegnato');
});

test('senza parola d’ordine l’allarme non può partire, e il riepilogo lo dichiara', async () => {
  const r = await costruisci({});
  expect(r.uscita).not.toBe(0);
  const avvisi = inEvidenza(r.registro);
  expect(avvisi, 'chi legge deve sapere che nessun feedback è stato aperto')
    .toContain('Nessun feedback aperto');
  expect(avvisi).toContain('FILO_BUILD_PASSPHRASE');
});

test('quando è tutto a posto il riepilogo resta vuoto', async () => {
  const srv = await serverFinto({
    '/buildKeys': { stato: 200, json: { ok: true, apiKeys: { tavily: 'dal-server' }, safeBrowsingKey: 'sb' } },
  });
  try {
    const r = await costruisci({ FILO_ROUTINE_API: srv.base, FILO_BUILD_PASSPHRASE: 'giusta' });
    expect(r.uscita).toBe(0);
    expect(inEvidenza(r.registro), 'un avviso che compare sempre smette di significare qualcosa')
      .toBe('');
    expect(r.registro).not.toContain('::error::');
    expect(r.registro).not.toContain('dal-server');
  } finally {
    await srv.chiudi();
  }
});

test('motivi limite sulla strada che pubblica lo stesso: mai «[object Object]», mai la chiave nel registro', async () => {
  const casi = [
    { nome: 'senza motivo', json: { ok: false } },
    { nome: 'soli spazi', json: { ok: false, reason: '   ' } },
    { nome: 'non testuale', json: { ok: false, reason: { codice: 9 }, message: 'parola scaduta' } },
    { nome: 'emoji e marcatori', json: { ok: false, reason: '🙈<script>alert(1)</script>' } },
    { nome: 'enorme', json: { ok: false, reason: 'x'.repeat(30000) } },
  ];
  for (const caso of casi) {
    const srv = await serverFinto({ '/buildKeys': { stato: 200, json: caso.json } });
    try {
      const r = await costruisci({
        FILO_ROUTINE_API: srv.base,
        FILO_BUILD_PASSPHRASE: 'p',
        FILO_DEFAULT_TAVILY_KEY: 'di-riserva',
        FILO_DEFAULT_SAFEBROWSING_KEY: 'di-riserva',
      });
      expect(r.uscita, caso.nome).toBe(0);
      const avvisi = inEvidenza(r.registro);
      expect(avvisi, caso.nome).toContain('Modelli predefiniti');
      expect(avvisi, caso.nome).not.toContain('[object Object]');
      expect(avvisi, caso.nome).not.toContain('undefined');
      expect(r.registro, caso.nome).not.toContain('di-riserva');
    } finally {
      await srv.chiudi();
    }
  }
});
