// #2301 — da dove esce yt-dlp quando salva un video per una scheda: dal proxy della scheda, dal paese già scelto o dalla
// regola del sito, e mai dalla connessione vera quando uno di questi c'è ma non si può usare. Il cammino intero, col
// programma finto, sta in tests/unit/salvaVideoStreaming.test.mjs e in tests/salva-video-streaming.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = require(join(ROOT, 'src', 'main', 'services', 'proxyTab.js'));
const Y = require(join(ROOT, 'src', 'main', 'services', 'ytdlp.js'));

delete process.env.FILO_PROXY_DATACENTER;
delete process.env.FILO_PROXY_RESIDENTIAL;

const conFornitore = (datacenter, residential = '') => async () => ({ proxy: { datacenter, residential } });
const senzaFornitore = async () => ({ proxy: {} });
const regole = (r) => async () => r;

test('il proxy si scrive come lo vuole il programma: socks coi nomi risolti dal proxy, credenziali codificate', () => {
  assert.equal(P.indirizzoPerProgramma('socks5://10.0.0.1:1080'), 'socks5h://10.0.0.1:1080');
  assert.equal(P.indirizzoPerProgramma('socks4://p.test:1080'), 'socks4a://p.test:1080');
  assert.equal(P.indirizzoPerProgramma('http://p.test:8080', { username: 'utente-country-fr', password: 'p@ss:w/rd' }),
    'http://utente-country-fr:p%40ss%3Aw%2Frd@p.test:8080');
  assert.equal(P.indirizzoPerProgramma('https://[::1]:443'), 'https://[::1]:443');
  assert.equal(P.indirizzoPerProgramma('quic://p.test:443'), '', 'uno schema che il programma non sa usare non vale');
  assert.equal(P.indirizzoPerProgramma(''), '');
  assert.equal(P.indirizzoPerProgramma('non un indirizzo'), '');
});

test('la scheda passata da un proxy: il programma esce dallo stesso, credenziali comprese, e il paese resta per «Riprova»', async () => {
  const ses = {};
  const resolved = P.resolve('fr', { settings: { proxy: { datacenter: 'http://utente-{country}:segreto@p.test:8080' } } });
  await P.registraRete('proxy:t-scheda', ses, resolved);
  try {
    const u = await P.uscitaPerProgramma({ ses, url: 'https://video.test/v', regole: regole({}), impostazioni: senzaFornitore });
    assert.deepEqual(u, { proxy: 'http://utente-fr:segreto@p.test:8080', paese: { country: 'fr', tier: 'datacenter' } });
  } finally {
    P.clearPartitionAuth('proxy:t-scheda');
  }
  // Una sessione che esce come il sistema, senza regola: niente cambia.
  assert.deepEqual(await P.uscitaPerProgramma({ ses: {}, url: 'https://video.test/v', regole: regole({}) }), { proxy: '', paese: null });
});

test('la regola del sito decide anche senza la scheda; senza fornitore il programma non parte dalla connessione vera', async () => {
  const r = regole({ 'video.test': { country: 'JP', tier: 'residential' } });
  const url = 'https://www.video.test/watch?v=1';
  assert.deepEqual(await P.uscitaPerProgramma({ url, regole: r, impostazioni: conFornitore('socks5://dc.test:1080', 'socks5://res-{country}.test:1080') }),
    { proxy: 'socks5h://res-jp.test:1080', paese: null }, 'il livello della regola, e il paese non si fissa: la regola si rilegge');
  assert.deepEqual(await P.uscitaPerProgramma({ url, regole: r, impostazioni: senzaFornitore }), { rifiuto: true, paese: null });
  // Il livello residenziale manca: nessun ripiego silenzioso su un altro.
  assert.deepEqual(await P.uscitaPerProgramma({ url, regole: r, impostazioni: conFornitore('socks5://dc.test:1080') }), { rifiuto: true, paese: null });
  assert.deepEqual(await P.uscitaPerProgramma({ url: 'https://altro.test/v', regole: r, impostazioni: senzaFornitore }), { proxy: '', paese: null });
  // Le regole non si leggono: nel dubbio non si esce dalla connessione vera.
  assert.deepEqual(await P.uscitaPerProgramma({ url, regole: async () => { throw new Error('memoria rotta'); } }), { rifiuto: true, paese: null });
});

test('«Riprova» col paese ricordato esce di nuovo da lì, anche senza scheda né regola; se il fornitore manca rifiuta', async () => {
  const paese = { country: 'de', tier: 'datacenter' };
  assert.deepEqual(await P.uscitaPerProgramma({ url: 'https://v.test/1', paese, regole: regole({}), impostazioni: conFornitore('http://{country}.p.test:3128') }),
    { proxy: 'http://de.p.test:3128', paese });
  assert.deepEqual(await P.uscitaPerProgramma({ url: 'https://v.test/1', paese, regole: regole({}), impostazioni: senzaFornitore }),
    { rifiuto: true, paese });
  // Un paese letto da un backup che non è un paese non conta: decide la regola.
  assert.deepEqual(await P.uscitaPerProgramma({ url: 'https://v.test/1', paese: { country: '<x>' }, regole: regole({}) }), { proxy: '', paese: null });
});

test('con un proxy l\'ambiente del programma lo porta per ogni schema, senza eccezioni del sistema; senza resta com\'è', () => {
  const base = { PATH: '/bin', NO_PROXY: '*', no_proxy: 'video.test', HTTP_PROXY: 'http://vecchio:1', Https_Proxy: 'http://vecchio:2' };
  const env = Y.ambiente(base, 'socks5h://p.test:1080');
  assert.equal(env.PATH, '/bin');
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) assert.equal(env[k], 'socks5h://p.test:1080', k);
  assert.equal(env.NO_PROXY, undefined);
  assert.equal(env.no_proxy, undefined);
  assert.equal(env.Https_Proxy, undefined);
  assert.deepEqual(Y.ambiente(base, ''), base);
  assert.ok(!Y.argomenti({ url: 'https://v.test/1', cartella: '/tmp/x' }).some((a) => /proxy|segreto/i.test(a)),
    'le credenziali non vanno sulla riga di comando');
});
