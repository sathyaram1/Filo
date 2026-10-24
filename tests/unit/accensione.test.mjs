// #1498: la fiducia di un biglietto il server la lega anche all'accensione del contenitore. Qui la parte dell'app: il
// sondaggio la apre e la ricorda, ogni richiesta di biglietto la porta, e senza il canale fa il sondaggio da sé, col
// segreto del pacemaker quando l'orchestratore lo passa.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { FILE_ACCENSIONE, VALIDITA_ACCENSIONE_MS, leggiAccensione, scriviAccensione } from '../../scripts/lib/accensione.mjs';

const CANALE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'routine-channel.mjs');
const canale = await import('../../scripts/routine-channel.mjs');
const ACC = 'acc_0123456789abcdefABCDEF';
const ACC2 = 'acc_fedcba9876543210ZYXWVU';
const BIGLIETTO = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function finto(risposte) {
  const corpi = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    corpi.push({ path: String(url).split('/').pop(), body });
    const r = typeof risposte === 'function' ? risposte(body) : risposte;
    return { status: r.status || 200, text: async () => JSON.stringify(r.body || r) };
  };
  return { corpi, opts: { fetchImpl, sleep: async () => {}, misureCrediti: () => ({}) } };
}

test('la richiesta di biglietto porta l\'accensione, e solo una con la forma giusta', async () => {
  const { corpi, opts } = finto({ ok: true, work: false, reason: 'idle' });
  await canale.ticket('parola', { ...opts, accensione: ACC });
  await canale.ticket('parola', opts);
  for (const storta of ['corta', `${ACC} `, 'a/b'.repeat(10), 42, { id: ACC }]) await canale.ticket('parola', { ...opts, accensione: storta });
  assert.equal(corpi[0].body.accensione, ACC);
  assert.equal(corpi[0].body.passphrase, 'parola');
  for (const c of corpi.slice(1)) assert.equal('accensione' in c.body, false, JSON.stringify(c.body));
  assert.ok(corpi.every((c) => c.path === 'routineTicket' && c.body.probe === undefined), 'la richiesta di biglietto non è un sondaggio');
});

test('il sondaggio restituisce l\'accensione del server, anche senza lavoro; un guasto no', async () => {
  assert.deepEqual(await canale.probe('p', finto({ ok: true, work: true, accensione: ACC }).opts), { outcome: 'work', accensione: ACC });
  assert.deepEqual(await canale.probe('p', finto({ ok: true, work: false, reason: 'idle', accensione: ACC }).opts), { outcome: 'nothing', reason: 'idle', accensione: ACC });
  assert.deepEqual(await canale.probe('p', finto({ ok: true, work: true, accensione: '<b>x</b>' }).opts), { outcome: 'work' });
  assert.deepEqual(await canale.probe('p', finto({ ok: true, work: true }).opts), { outcome: 'work' }, 'server vecchio: nessuna accensione');
  const g = await canale.probe('p', { ...finto({ status: 403, body: { ok: false, reason: 'bad_passphrase', accensione: ACC } }).opts, attempts: 1 });
  assert.deepEqual(g, { outcome: 'fault', reason: 'bad_passphrase' });
});

test('il segreto del pacemaker va al sondaggio, anche a quello che il biglietto fa da sé; uno storto no', async () => {
  const SEGRETO = 'Pm_0123456789abcdefghijABCDEFGHIJ-_xyz012345';
  const { corpi, opts } = finto({ ok: true, work: true, accensione: ACC });
  await canale.probe('p', { ...opts, segretoPacemaker: SEGRETO });
  await canale.probe('p', { ...opts, segretoPacemaker: '<script>' });
  await canale.probe('p', opts);
  assert.deepEqual(corpi.map((c) => c.body.segretoPacemaker), [SEGRETO, undefined, undefined]);
  const dir = cartellaTemporanea('filo-accensione-segreto-');
  try {
    const giro = finto({ ok: true, work: true, accensione: ACC });
    assert.equal(await canale.accensioneDelGiro('parola', { ...giro.opts, dirAccensione: dir, segretoPacemaker: SEGRETO }), ACC);
    assert.equal(giro.corpi[0].body.probe, true);
    assert.equal(giro.corpi[0].body.segretoPacemaker, SEGRETO);
    assert.ok(!readFileSync(join(dir, FILE_ACCENSIONE), 'utf8').includes(SEGRETO), 'il segreto non si ricorda');
  } finally { togliCartella(dir); }
});

test('una risposta di biglietto con un\'accensione nuova la porta fuori', () => {
  assert.equal(canale.readTicketReply(200, { ok: true, work: true, ticket: 'b', accensione: ACC2 }).accensione, ACC2);
  assert.equal(canale.readTicketReply(200, { ok: true, work: true, ticket: 'b' }).accensione, undefined);
});

test('l\'accensione del giro: un sondaggio solo per parola d\'ordine, rifatto per un\'altra parola, dopo un giorno o dopo un guasto', async () => {
  const dir = cartellaTemporanea('filo-accensione-');
  try {
    let risposta = { ok: true, work: true, accensione: ACC };
    const { corpi, opts } = finto(() => risposta);
    const o = { ...opts, dirAccensione: dir, attempts: 1 };
    assert.equal(await canale.accensioneDelGiro('parola', o), ACC);
    assert.equal(await canale.accensioneDelGiro('parola', o), ACC);
    assert.equal(corpi.length, 1, 'la seconda volta la legge dal file');
    assert.equal(corpi[0].body.probe, true);
    assert.ok(!readFileSync(join(dir, FILE_ACCENSIONE), 'utf8').includes('parola'), 'mai la parola d\'ordine in chiaro');

    risposta = { ok: true, work: true, accensione: ACC2 };
    assert.equal(await canale.accensioneDelGiro('altra-parola', o), ACC2, 'un\'accensione è legata alla chiave');
    assert.equal(corpi.length, 2);

    scriviAccensione('altra-parola', ACC2, { dir, adesso: Date.now() - VALIDITA_ACCENSIONE_MS - 1000 });
    risposta = { ok: true, work: true, accensione: ACC };
    assert.equal(await canale.accensioneDelGiro('altra-parola', o), ACC, 'quella di ieri non si riusa');
    assert.equal(corpi.length, 3);

    // Un guasto non si ricorda: il biglietto dopo ci riprova invece di partire per un giorno senza accensione.
    writeFileSync(join(dir, FILE_ACCENSIONE), '{rotto');
    risposta = { status: 503, body: { ok: false, reason: 'down' } };
    assert.equal(await canale.accensioneDelGiro('parola', o), '');
    assert.equal(leggiAccensione('parola', { dir }).nota, false);
    risposta = { ok: true, work: false, reason: 'idle' };
    assert.equal(await canale.accensioneDelGiro('parola', o), '', 'un server che non la dà');
    assert.equal(await canale.accensioneDelGiro('parola', o), '');
    assert.equal(corpi.length, 5, 'un server che non la dà non costa un sondaggio a ogni biglietto');
  } finally { togliCartella(dir); }
});

test('da riga di comando: il primo biglietto apre l\'accensione, i successivi la riportano, il server la può cambiare', async () => {
  const utente = cartellaTemporanea('filo-accensione-cli-');
  const ricevute = [];
  let accensioneDelServer = ACC;
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      ricevute.push(body);
      res.setHeader('Content-Type', 'application/json');
      if (body.probe) return res.end(JSON.stringify({ ok: true, work: true, accensione: accensioneDelServer }));
      // La risposta al secondo biglietto (terza richiesta) cambia l'accensione.
      res.end(JSON.stringify({ ok: true, work: true, ticket: BIGLIETTO, role: 'new-work', ...(ricevute.length === 3 ? { accensione: ACC2 } : {}) }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const esegui = (argomenti) => new Promise((ok) => {
    const p = spawn(process.execPath, [CANALE, ...argomenti], {
      env: { ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, CLAUDE_CONFIG_DIR: utente },
    });
    let so = ''; let se = '';
    p.stdout.on('data', (c) => { so += c; });
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => ok({ code, so, se }));
  });
  try {
    const primo = await esegui(['ticket', 'parola-d-ordine', '--json', '--accensione-pacemaker', 'Pm_segreto_del_pacemaker_0123']);
    assert.equal(primo.code, 0, primo.se);
    assert.deepEqual(JSON.parse(primo.so.trim()), { ticket: BIGLIETTO, role: 'new-work' }, 'l\'accensione non esce all\'orchestratore');
    assert.deepEqual(ricevute.map((r) => [r.probe === true, r.accensione]), [[true, undefined], [false, ACC]]);
    assert.equal(ricevute[0].segretoPacemaker, 'Pm_segreto_del_pacemaker_0123', 'il segreto va al sondaggio');
    assert.equal('segretoPacemaker' in ricevute[1], false, 'e solo lì');

    // Il secondo biglietto la riporta senza sondaggio; la sua risposta ne porta una nuova, che vale dal terzo.
    const secondo = await esegui(['ticket', 'parola-d-ordine']);
    assert.equal(secondo.code, 0, secondo.se);
    const terzo = await esegui(['ticket', 'parola-d-ordine']);
    assert.equal(terzo.code, 0, terzo.se);
    assert.deepEqual(ricevute.slice(2).map((r) => [r.probe === true, r.accensione]), [[false, ACC], [false, ACC2]]);

    // Il sondaggio esplicito apre un'accensione nuova, e il biglietto dopo porta quella.
    accensioneDelServer = 'acc_sondaggio_esplicito_01';
    const s = await esegui(['probe', 'parola-d-ordine']);
    assert.equal(s.code, 0, s.se);
    await esegui(['ticket', 'parola-d-ordine']);
    assert.equal(ricevute.at(-1).accensione, 'acc_sondaggio_esplicito_01');
    assert.ok(!readFileSync(join(utente, FILE_ACCENSIONE), 'utf8').includes('parola-d-ordine'));
  } finally {
    await new Promise((ok) => srv.close(ok));
    togliCartella(utente);
  }
});
