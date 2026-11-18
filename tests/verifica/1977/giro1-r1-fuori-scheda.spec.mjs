// #1977 giro 1, rilievo 1 — un video letto fuori dalla sua scheda (link incollato in chat, scheda chiusa): quando la
// traccia arriva vuota la trascrizione c'è lo stesso nel pannello di YouTube, ma da qui non si chiede. Senza Electron.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'trascrizioneYoutube.js'));

const ID = 'fuoriScheda';
const HTML = `<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaFinta","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.20251101.00.00"}}});</script>
<script>var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
  { baseUrl: `https://www.youtube.com/api/timedtext?v=${ID}&lang=it&kind=asr&exp=xpe`, languageCode: 'it', kind: 'asr' }] } } })};</script>
<script>var ytInitialData = {"x":{"getTranscriptEndpoint":{"params":"CgtwYW5uZWxsbw"}}};</script>`;
const PANNELLO = JSON.stringify({ actions: [{ x: { initialSegments: [
  { transcriptSegmentRenderer: { startMs: '0', snippet: { runs: [{ text: 'il segreto del pane è la pazienza' }] } } }] } }] });

// YouTube che risponde come quello vero senza il gettone del lettore: traccia vuota, pannello pieno.
async function youtubeFinto(url, { metodo = 'GET' } = {}) {
  const u = new URL(url);
  if (u.pathname === '/watch') return { ok: true, stato: 200, testo: HTML };
  if (u.pathname === '/api/timedtext') return { ok: true, stato: 200, testo: '' };
  if (u.pathname === '/youtubei/v1/get_transcript' && metodo === 'POST') return { ok: true, stato: 200, testo: PANNELLO };
  return { ok: false, stato: 404, testo: '' };
}

test('r1 fuori dalla scheda, con la traccia vuota, la trascrizione arriva dal pannello come dalla scheda', async () => {
  T._cache.clear();
  // Dalla scheda (stesso YouTube): c'è.
  const dallaScheda = await T.prendi(youtubeFinto, ID);
  expect(dallaScheda.stato).toBe('ok');
  T._cache.clear();
  // Dalla rete, la strada di un link incollato in chat o di una scheda chiusa: deve esserci lo stesso.
  const e = await T.dallaRete(`https://www.youtube.com/watch?v=${ID}`, youtubeFinto);
  expect(e && e.stato).toBe('ok');
  expect(e.testo).toContain('il segreto del pane è la pazienza');
});
