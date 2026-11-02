// #1488 — la logica pura del salvataggio dei video in streaming: argomenti per yt-dlp, lettura dell'avanzamento,
// i perché di un errore, quale programma scaricare per ogni computer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Y = require(join(ROOT, 'src', 'main', 'services', 'ytdlp.js'));

const URL_SEGNALATO = 'https://www.youtube.com/watch?v=AOi9E5_T8Xc&list=RDAOi9E5_T8Xc&start_radio=1';

test('gli argomenti non passano mai l\'account né la configurazione dell\'utente, e l\'indirizzo resta un indirizzo', () => {
  const a = Y.argomenti({ url: URL_SEGNALATO, cartella: '/tmp/lavoro', ffmpeg: '/x/ffmpeg', nodo: '/x/filo' });
  for (const f of ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--newline']) assert.ok(a.includes(f), f);
  assert.ok(!a.some((x) => /cookies/i.test(x)), 'nessun cookie al programma (decisione dell\'owner)');
  assert.equal(a.at(-2), '--', 'l\'indirizzo va dopo «--»');
  assert.equal(a.at(-1), URL_SEGNALATO);
  // Un indirizzo che comincia col trattino resta dopo «--», non diventa un'opzione.
  const b = Y.argomenti({ url: '--exec=rm', cartella: '/tmp/lavoro' });
  assert.equal(b.at(-2), '--');
  assert.equal(b.at(-1), '--exec=rm');
  assert.deepEqual(a.slice(a.indexOf('--js-runtimes'), a.indexOf('--js-runtimes') + 2), ['--js-runtimes', 'node:/x/filo']);
  assert.equal(a[a.indexOf('--ffmpeg-location') + 1], '/x/ffmpeg');
  assert.equal(a[a.indexOf('--match-filter') + 1], '!is_live');
});

test('con ffmpeg il video arriva in MP4 fino a 1080p, senza ffmpeg in un file unico, l\'audio da solo', () => {
  const pieno = Y.argomenti({ url: 'https://x.test/v', cartella: '/c', ffmpeg: '/f' });
  assert.equal(pieno[pieno.indexOf('-f') + 1], 'bv*+ba/b');
  assert.equal(pieno[pieno.indexOf('--merge-output-format') + 1], 'mp4');
  assert.match(pieno[pieno.indexOf('-S') + 1], /res:1080/);
  const senza = Y.argomenti({ url: 'https://x.test/v', cartella: '/c' });
  assert.equal(senza[senza.indexOf('-f') + 1], 'b[ext=mp4]/b');
  assert.ok(!senza.includes('--merge-output-format'));
  const audio = Y.argomenti({ url: 'https://x.test/v', cartella: '/c', ffmpeg: '/f', audio: true });
  assert.equal(audio[audio.indexOf('-f') + 1], 'ba[ext=m4a]/ba/b');
});

test('un «%» nel percorso della cartella non diventa un campo del nome', () => {
  const a = Y.argomenti({ url: 'https://x.test/v', cartella: '/home/a%b' });
  assert.equal(a[a.indexOf('-o') + 1], join('/home/a%%b', 'video.%(ext)s'));
});

test('le righe d\'avanzamento si leggono, video e audio insieme fanno un totale solo', () => {
  const a = Y.argomenti({ url: 'https://x.test/v', cartella: '/c', ffmpeg: '/f' });
  const riempi = (m, campi) => m.replace(/%\(([^)]+)\)([sj])/g, (_, k, c) => (campi[k] === undefined ? 'NA' : (c === 'j' ? JSON.stringify(campi[k]) : String(campi[k]))));
  const modello = a[a.indexOf('--progress-template') + 1].slice('download:'.length);
  // Come il vero: l'elenco dei pezzi non sta nella riga di un pezzo, arriva prima nel file dei pezzi.
  assert.doesNotMatch(modello, /requested_formats/);
  const i = a.indexOf('--print-to-file');
  assert.match(a[i + 1], /^before_dl:/);
  assert.equal(a[i + 2], join('/c', Y.FILE_PEZZI));
  const pezzi = Y.leggiPezzi(`${riempi(a[i + 1].slice('before_dl:'.length), { 'requested_formats.:.format_id': ['137', '140'], 'requested_formats.:.filesize': [9000, 1000] })}\n`);
  assert.deepEqual(pezzi, { pezzi: 2, pesoTutti: 10000 });
  const riga = (campi) => riempi(modello, { 'info.title': 'Canzone\tcon tab', ...campi });
  const av = Y.creaAvanzamento();
  av.pezzi(pezzi);
  const e1 = Y.leggiRiga(riga({ 'progress.status': 'downloading', 'progress.downloaded_bytes': 4500, 'progress.total_bytes': 9000, 'info.format_id': '137' }));
  assert.equal(e1.tipo, 'avanza');
  assert.equal(e1.titolo, 'Canzone\tcon tab');
  av.leggi(e1);
  assert.deepEqual(av.stato(), { ricevuti: 4500, totale: 10000 });
  av.leggi(Y.leggiRiga(riga({ 'progress.status': 'finished', 'progress.downloaded_bytes': 9000, 'progress.total_bytes': 9000, 'info.format_id': '137' })));
  assert.deepEqual(av.stato(), { ricevuti: 9000, totale: 10000 }, 'finito il video la barra non dice 100%');
  av.leggi(Y.leggiRiga(riga({ 'progress.status': 'downloading', 'progress.downloaded_bytes': 500, 'progress.total_bytes': 1000, 'info.format_id': '140' })));
  assert.deepEqual(av.stato(), { ricevuti: 9500, totale: 10000 });
  assert.equal(av.titolo(), 'Canzone\tcon tab');
});

test('senza i pesi dei pezzi la barra non promette una percentuale finché un pezzo manca', () => {
  const av = Y.creaAvanzamento();
  av.pezzi(Y.leggiPezzi('["137", "140"]\t[]\t[]\n'));
  av.leggi({ tipo: 'avanza', stato: 'downloading', scaricati: 100, totale: 200, formato: '137' });
  assert.equal(av.stato().totale, 0, 'col secondo pezzo ancora ignoto il totale non si sa');
  av.leggi({ tipo: 'avanza', stato: 'downloading', scaricati: 10, totale: 50, formato: '140' });
  assert.deepEqual(av.stato(), { ricevuti: 110, totale: 250 });
  // Un formato solo (l'audio, o un file unico): il file dei pezzi dice NA, e il pezzo è uno.
  assert.deepEqual(Y.leggiPezzi('NA\tNA\tNA\n'), { pezzi: 1, pesoTutti: 0 });
  assert.deepEqual(Y.leggiPezzi(''), { pezzi: 1, pesoTutti: 0 });
});

test('senza il file dei pezzi il primo pezzo non promette un 100% che poi torna indietro', () => {
  const av = Y.creaAvanzamento();
  av.leggi({ tipo: 'avanza', stato: 'finished', scaricati: 9000, totale: 9000, formato: '137' });
  assert.equal(av.stato().totale, 0, 'dopo il video può arrivare l\'audio');
  av.leggi({ tipo: 'avanza', stato: 'downloading', scaricati: 500, totale: 1000, formato: '140' });
  assert.deepEqual(av.stato(), { ricevuti: 9500, totale: 10000 });
});

test('un elenco di video (canale, ricerca, home) si ferma alla prima voce, e lo si dice', () => {
  const a = Y.argomenti({ url: 'https://www.youtube.com/@canale', cartella: '/c' });
  assert.equal(a[a.indexOf('--break-match-filters') + 1], '!playlist_id');
  const ev = Y.leggiRiga('[download] entry does not pass filter (!playlist_id), skipping ..');
  assert.equal(ev.tipo, 'errore');
  assert.equal(ev.motivo, 'elenco');
});

test('i perché di un errore di yt-dlp', () => {
  const casi = {
    eta: 'ERROR: [youtube] AOi9E5_T8Xc: Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.',
    robot: 'ERROR: [youtube] AOi9E5_T8Xc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.',
    accesso: 'ERROR: [youtube] AOi9E5_T8Xc: Private video. Sign in if you\'ve been granted access to this video',
    protetto: 'ERROR: [generic] This video is DRM protected',
    sito: 'ERROR: Unsupported URL: https://esempio.test/',
    non_disponibile: 'ERROR: [youtube] AOi9E5_T8Xc: Video unavailable. This video has been removed by the uploader',
    rete: 'ERROR: [youtube] AOi9E5_T8Xc: Unable to download API page: <urlopen error [Errno -3] Temporary failure in name resolution>',
    aggiornare: 'ERROR: [youtube] AOi9E5_T8Xc: Requested format is not available. Use --list-formats for a list of available formats',
    spazio: 'ERROR: unable to write data: [Errno 28] No space left on device',
    generico: 'ERROR: qualcosa di mai visto',
  };
  for (const [atteso, riga] of Object.entries(casi)) {
    const ev = Y.leggiRiga(riga);
    assert.equal(ev.tipo, 'errore', riga);
    assert.equal(ev.motivo, atteso, riga);
  }
  const diretta = Y.leggiRiga('[download] AOi9E5_T8Xc: Canzone does not pass filter (!is_live), skipping ..');
  assert.equal(diretta.motivo, 'diretta');
  assert.deepEqual(Y.leggiRiga('FILO-PP\tstarted\tMerger'), { tipo: 'post', stato: 'started', chi: 'Merger' });
  assert.equal(Y.leggiRiga('[youtube] AOi9E5_T8Xc: Downloading webpage'), null);
});

test('il programma giusto per ogni computer su cui gira Filo', () => {
  assert.equal(Y.assetYtdlp('win32', 'x64'), 'yt-dlp.exe');
  assert.equal(Y.assetYtdlp('win32', 'arm64'), 'yt-dlp_arm64.exe');
  assert.equal(Y.assetYtdlp('darwin', 'arm64'), 'yt-dlp_macos');
  assert.equal(Y.assetYtdlp('darwin', 'x64'), 'yt-dlp_macos');
  assert.equal(Y.assetYtdlp('linux', 'x64'), 'yt-dlp_linux');
  assert.equal(Y.assetYtdlp('linux', 'arm64'), 'yt-dlp_linux_aarch64');
  assert.equal(Y.assetYtdlp('freebsd', 'x64'), null);
  for (const [pl, ar] of [['win32', 'x64'], ['win32', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']]) {
    const f = Y.assetFfmpeg(pl, ar);
    assert.ok(f && /^[0-9a-f]{64}$/.test(Y.FFMPEG_SHA256[f]), `ffmpeg per ${pl}-${ar} con il suo hash fissato`);
  }
});

test('SHA2-256SUMS: un nome con due hash diversi non vale', () => {
  const h1 = 'a'.repeat(64); const h2 = 'b'.repeat(64);
  const m = Y.leggiSomme(`${h1}  yt-dlp\n${h2}  yt-dlp_linux\n${h1}  yt-dlp_linux\nrumore\n`);
  assert.equal(m.get('yt-dlp'), h1);
  assert.equal(m.has('yt-dlp_linux'), false);
});

test('il titolo della pagina diventa il nome proposto', () => {
  assert.equal(Y.titoloDaPagina('(3) Canzone bella - YouTube'), 'Canzone bella');
  assert.equal(Y.titoloDaPagina('Un film qualsiasi'), 'Un film qualsiasi');
});
