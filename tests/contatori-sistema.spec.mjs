// I contatori del sistema (#1466) nell'app vera: i passi dell'avvio, la sessione riaperta, le chiamate sincrone delle
// pagine, il disco, la memoria, un rifiuto senza gestione, e il segno dell'uscita fra un avvio e l'altro (pulita,
// caduta, dopo un aggiornamento, seconda apertura). Forma e prove per misura: tests/unit/contatoriSistema.test.mjs.

import { expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron, test } from '@playwright/test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEGNO = 'contatori-uscita.json';

const envDi = (userData) => ({ ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' });
const lancia = (userData) => electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: envDi(userData) });
const segno = (userData) => { try { return JSON.parse(readFileSync(join(userData, SEGNO), 'utf8')); } catch (_) { return null; } };

// Il sistema di tutte le ore che lo stato tiene, come uscirebbe in un documento: con dentro quello che aspettava.
const sistema = (app) => app.evaluate(() => {
  const M = globalThis.SN_CONTATORI_MAIN;
  const C = globalThis.SN_CONTATORI;
  const stato = Object.values(M.perLaChiusura())[0];
  if (!stato) return null;
  const tot = C.oraVuota();
  for (const o of Object.values(stato.ore || {})) C.unisciSistema(tot, o);
  const doc = C.documento({ pseudonimo: 'a'.repeat(20), chiave: C.oraDi(Date.now()), app: '0.2.249', os: 'linux', dati: tot });
  return { ...C.leggiSistema(doc.sistema), testo: doc.sistema, valido: C.valida(doc).ok };
});
const somma = (o) => Object.values(o || {}).reduce((a, n) => a + n, 0);

test('l’avvio, la sessione, le pagine, il disco e la memoria si contano; il segno dice com’è finita la volta prima', async () => {
  test.setTimeout(240_000);
  const userData = cartellaTemporanea('filo-contatori-sistema-');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Pagina di mario</title><p>Una pagina di prova ${req.url}</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    sn_open_tabs: { tabs: [`${base}/conto-di-mario`, `${base}/seconda`], activeIndex: 0 },
  }));
  let app = null;
  try {
    // ── Il primo avvio: niente segno di prima, quindi niente «com'è finita».
    app = await lancia(userData);
    await expect.poll(() => segno(userData)?.stato, { timeout: 30_000 }).toBe('aperta');
    let s = null;
    await expect.poll(async () => {
      s = await sistema(app);
      return s && Object.keys(s.avvioPasso).sort().join(',');
    }, { timeout: 60_000, message: 'ogni passo dell’avvio ha il suo tempo' })
      .toBe(['adblock', 'finestra_creata', 'fingerprint', 'impostazioni_lette', 'permessi', 'prima_scheda_visibile', 'protocollo_ipc', 'sessione_ripristinata'].join(','));
    expect(s.avvioTipo).toEqual({ freddo: 1 });
    expect(s.uscitaPrecedente).toEqual({});
    // La sessione con le due schede: la scheda in vista caricata e la coda finita, ognuna nella sua fascia.
    await expect.poll(async () => (s = await sistema(app)).sessione.esiti?.ripristinata || 0, { timeout: 60_000 }).toBe(1);
    expect(s.sessione.schede).toEqual({ n5: 1 });
    expect(somma(s.sessione.vista)).toBe(1);
    expect(somma(s.sessione.coda)).toBe(1);
    // Le pagine web hanno chiesto le loro risposte sincrone prima dei loro script.
    expect(somma(s.ipcSincrono['fp-config'])).toBeGreaterThanOrEqual(2);
    expect(somma(s.ipcSincrono['adblock-css'])).toBeGreaterThanOrEqual(2);
    expect(s.storageEsito.lettura_ok).toBe(1);

    // Un rifiuto che nessuno gestisce: il nome della classe, mai il messaggio.
    await app.evaluate(() => { Promise.reject(new RangeError('/home/mario/segreto.txt')); });
    await expect.poll(async () => (await sistema(app)).eccezioneMain.rejection?.RangeError || 0).toBe(1);
    // Il giro dell'ora: memoria, schede e grandezza del file.
    await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.controlla());
    s = await sistema(app);
    expect(somma(s.memoria.totale)).toBe(1);
    expect(s.memoria.vive).toEqual({ n5: 1 });
    expect(somma(Object.fromEntries(Object.entries(s.storageEsito).filter(([k]) => k.startsWith('dimensione_'))))).toBe(1);
    expect(s.valido, 'il documento con il sistema è valido').toBe(true);
    for (const t of ['127.0.0.1', 'mario', 'segreto', 'conto']) expect(s.testo).not.toContain(t);

    // ── Chiusa bene: il segno porta la durata della chiusura.
    await chiudiApp(app, { tetto: 15_000 });
    app = null;
    const chiusa = segno(userData);
    expect(chiusa.stato).toBe('chiusa');
    expect(typeof chiusa.ms).toBe('number');

    // ── Il secondo avvio la conta pulita, con la sua durata; quello che aspettava alla chiusura è arrivato sul disco.
    app = await lancia(userData);
    await expect.poll(async () => (await sistema(app))?.uscitaPrecedente?.pulita || 0, { timeout: 30_000 }).toBe(1);
    s = await sistema(app);
    expect(somma(s.chiusura.durata)).toBe(1);
    expect(s.eccezioneMain.rejection?.RangeError, 'il rifiuto contato prima della chiusura è stato salvato con lei').toBe(1);
    expect(segno(userData).stato).toBe('aperta');

    // ── Caduto di colpo, con una versione diversa nel segno: non pulita, e dopo un aggiornamento.
    app.process().kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 1500));
    app = null;
    expect(segno(userData).stato, 'chi cade non scrive niente').toBe('aperta');
    writeFileSync(join(userData, SEGNO), JSON.stringify({ ...segno(userData), versione: '0.0.1' }));
    app = await lancia(userData);
    await expect.poll(async () => (await sistema(app))?.uscitaPrecedente?.non_pulita || 0, { timeout: 30_000 }).toBe(1);
    expect((await sistema(app)).avvioTipo.dopo_aggiornamento).toBe(1);

    // ── Una seconda apertura mentre Filo è acceso: la seconda copia esce, la prima la conta.
    const r = spawnSync(electronPath, [...argomentiScala, '.'], { cwd: APP_ROOT, env: envDi(userData), timeout: 60_000 });
    expect(r.status, String(r.stderr || '').slice(-500)).toBe(0);
    await expect.poll(async () => (await sistema(app)).avvioTipo.seconda_istanza || 0, { timeout: 20_000 }).toBe(1);
  } finally {
    if (app) await chiudiApp(app);
    server.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('a contatori spenti l’avvio non lascia il segno e non raccoglie niente', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-contatori-sistema-spenti-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { contatori: { attivi: false } } }));
  writeFileSync(join(userData, SEGNO), JSON.stringify({ stato: 'aperta', versione: '0.2.200' }));
  let app = null;
  try {
    app = await lancia(userData);
    await expect.poll(() => segno(userData), { timeout: 30_000, message: 'spenti, il segno di prima se ne va' }).toBe(null);
    await app.evaluate(() => { Promise.reject(new TypeError('x')); });
    await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.controlla());
    expect(await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.perLaChiusura())).toEqual({});
    expect(await app.evaluate(async () => Object.keys((await globalThis.SN_CONTATORI_MAIN.letto()).ore))).toEqual([]);
    await chiudiApp(app, { tetto: 15_000 });
    app = null;
    expect(segno(userData), 'e alla chiusura non se ne scrive uno').toBe(null);
  } finally {
    if (app) await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
