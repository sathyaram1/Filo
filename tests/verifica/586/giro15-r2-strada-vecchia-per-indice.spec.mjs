// Verifica #586 giro 15, rilievo 2 (era il rilievo 2 del giro 14): un riquadro nato senza indirizzo e preso per indice (window[0]) scavalca quello che
// Filo mette nel mondo della pagina: la strada vecchia per lo schermo consegna tutto lo schermo e l'audio del computer
// qualunque cosa si scelga, fa morire la scheda, e lì i permessi mai decisi si leggono «negato».
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Vecchia</title></head><body>
<textarea id="campo"></textarea>
<script>
  const desktop = { mandatory: { chromeMediaSource: 'desktop' } };
  const tracce = (s) => s.getTracks().map((t) => t.kind + ':' + t.label + ':' + (t.getSettings().deviceId || ''));
  // La copia intonsa di getUserMedia: un riquadro vuoto, preso per indice invece che dal suo elemento.
  function intonsa() {
    document.body.appendChild(document.createElement('iframe'));
    return window[window.length - 1];
  }
  window.chiedi = (vincoli) => intonsa().MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, vincoli)
    .then((s) => { window.__s = s; return tracce(s); }, (e) => 'err:' + e.name);
  window.schermoEAudio = () => window.chiedi({ audio: desktop, video: desktop });
  window.soloAudio = () => window.chiedi({ audio: desktop, video: false });
  window.schermoEMic = () => window.chiedi({ audio: true, video: desktop });
  window.stati = async () => {
    const w = intonsa();
    const out = {};
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) out[n] = (await w.navigator.permissions.query({ name: n })).state;
    out.notifica = w.Notification.permission;
    return out;
  };
</script></body></html>`;

for (const [fn, cosa] of [['soloAudio', 'l’audio del computer senza immagine'], ['schermoEMic', 'lo schermo insieme al microfono']]) {
  test(`chiedere ${cosa} dalla copia intonsa non fa morire la scheda`, async ({ openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, PAGINA);
    let morta = false;
    page.on('crash', () => { morta = true; });
    await page.fill('#campo', 'testo che stavo scrivendo');
    await page.evaluate((f) => { window[f]().then((r) => { window.__e = r; }); }, fn).catch(() => {});
    await sleep(2500);
    expect(morta, 'la scheda è morta ed è comparsa la pagina di errore').toBe(false);
    expect(await page.evaluate(() => document.getElementById('campo').value)).toBe('testo che stavo scrivendo');
  });
}

test('nel riquadro preso per indice i permessi mai decisi si leggono «da chiedere»', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const s = await page.evaluate(() => window.stati());
  expect(s).toEqual({ camera: 'prompt', microphone: 'prompt', geolocation: 'prompt', notifications: 'prompt', notifica: 'default' });
});
