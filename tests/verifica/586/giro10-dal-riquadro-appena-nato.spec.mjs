// Verifica #586, giro 10 — il riquadro appena nato, quello a cui Filo non arriva.
//
// Un `<iframe>` creato senza indirizzo resta sul suo documento vuoto iniziale:
// lì il giro di Filo che vive dentro la pagina non viene installato. Da quel
// riquadro, che una pagina si scrive in una riga, tornano aperte tre porte che i
// giri passati avevano chiuso: la strada vecchia della cattura schermo che salta
// la scelta di cosa si condivide, la richiesta che ammazza la scheda, e quello
// che un sito legge sul proprio stato prima di chiedere.
//
// (Un riquadro con srcdoc o con un indirizzo blob:, che invece navigano, la
// guardia ce l'hanno: misurato in giro10-riquadri-senza-guardia.)

import { test, expect } from '../../fixtures/electron.mjs';

// Il riquadro nasce senza indirizzo e la pagina ci scrive dentro: nessuna
// navigazione, quindi nessun giro di Filo.
const PAGINA = `<!doctype html><html><body style="margin:0;padding:16px">
<input id="campo" style="width:70%">
<script>
  window.__vivo = String(Date.now());
  const dentro = () => {
    const f = document.createElement('iframe');
    f.style.width = '20px'; f.style.height = '20px';
    document.body.appendChild(f);
    try {
      f.contentDocument.open();
      f.contentDocument.write('<!doctype html><html><body>r</body></html>');
      f.contentDocument.close();
    } catch (_) {}
    return f.contentWindow;
  };
  const piatto = (s) => s.getTracks().map((t) => t.kind + ':' + (t.label || '?')
    + ':' + (t.getSettings ? (t.getSettings().width || 0) + 'x' + (t.getSettings().height || 0) : ''));

  // La strada vecchia della cattura schermo, dal riquadro appena nato.
  window.__schermo = () => {
    const w = dentro();
    return w.navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop' } },
    }).then((s) => { window.__preso = s; return piatto(s); },
      (e) => ['rifiutato:' + ((e && e.name) || '?')]);
  };

  // La forma che Chromium non rifiuta: chiude il processo della pagina.
  window.__ammazza = () => {
    const w = dentro();
    return w.navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
    }).then(() => 'ottenuto', (e) => 'rifiutato:' + ((e && e.name) || '?'));
  };

  // Cosa legge un widget dentro quel riquadro prima di chiedere.
  window.__legge = async () => {
    const w = dentro();
    const out = {};
    for (const nome of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try {
        const s = await w.navigator.permissions.query({ name: nome });
        out[nome] = s.state;
      } catch (e) { out[nome] = 'errore:' + ((e && e.name) || '?'); }
    }
    out.notificationPermission = w.Notification ? w.Notification.permission : 'assente';
    return out;
  };
</script></body></html>`;

test('la scelta di cosa si condivide non si salta nemmeno da un riquadro appena nato', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, PAGINA);

  const preso = page.evaluate(() => window.__schermo());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  const domanda = ((await shell.locator('.perm-chip').first().textContent()) || '')
    .replace(/\s+/g, ' ').trim();
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  const picker = await shell.locator('.perm-source').first()
    .waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
  // Scelta la fonte, la condivisione deve funzionare: la porta si chiude
  // aggiungendo la scelta, non spegnendo la condivisione.
  if (picker) await shell.locator('.perm-source-item').first().click();
  const arrivato = await preso;
  await shell.waitForTimeout(2500);
  const segno = (await shell.locator('.perm-live').allTextContents()).join(' | ').replace(/\s+/g, ' ');
  console.log('[586 g10] domanda:', JSON.stringify(domanda), '— riquadro della scelta:', picker);
  console.log('[586 g10] quello che è arrivato al sito:', JSON.stringify(arrivato));
  console.log('[586 g10] il segno che resta:', JSON.stringify(segno));

  const ottenuto = Array.isArray(arrivato) && arrivato.some((s) => !String(s).startsWith('rifiutato'));
  expect(
    ottenuto && !picker,
    'dal riquadro appena nato la strada vecchia della cattura schermo consegna lo schermo intero (e '
    + 'l\'audio del computer, se il sito lo chiede) con un «Consenti» solo: il riquadro con le cose '
    + `fra cui scegliere non compare. È arrivato ${JSON.stringify(arrivato)}. La domanda è la stessa `
    + 'parola per parola di quella della strada moderna, quindi chi risponde non può sapere se dopo '
    + 'gli verrà chiesto cosa condividere o se lo schermo intero parte subito',
  ).toBe(false);
});

test('la richiesta che ammazza la scheda non deve ammazzarla nemmeno da un riquadro appena nato', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#campo', 'quello che stavo leggendo').catch(() => {});
  const prima = await page.evaluate(() => window.__vivo);

  const esito = await page.evaluate(() => window.__ammazza()).catch((e) => 'la scheda è morta: ' + e.message);
  await shell.waitForTimeout(2000);
  let dopo = 'scheda morta';
  let campo = '';
  try {
    dopo = await page.evaluate(() => window.__vivo);
    campo = await page.inputValue('#campo');
  } catch (_) {}
  console.log('[586 g10] esito:', JSON.stringify(esito), '— la pagina è ancora quella:', dopo === prima,
    'campo:', JSON.stringify(campo));

  expect(
    dopo === prima,
    'chiedendo l\'audio del computer senza l\'immagine dello schermo da un riquadro appena nato, la '
    + 'scheda muore all\'istante e al suo posto compare la pagina di errore: chi stava leggendo perde '
    + 'quello che aveva aperto lì, senza un avviso e senza aver toccato niente. La stessa richiesta '
    + 'scritta nella pagina torna un errore che il sito sa gestire',
  ).toBe(true);
});

test('dentro un riquadro appena nato i permessi mai negati si leggono «da chiedere»', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const letto = await page.evaluate(() => window.__legge());
  console.log('[586 g10] quello che legge il riquadro appena nato:', JSON.stringify(letto));

  const negati = Object.entries(letto)
    .filter(([, v]) => v === 'denied' || v === 'deny')
    .map(([k]) => k);
  expect(
    negati,
    'un widget dentro un riquadro appena nato legge «negato» su cose che nessuno ha mai negato: non '
    + 'chiederà mai, mostrerà «sbloccalo dalle impostazioni del browser», e nelle Impostazioni di '
    + 'Filo quel sito non c\'è perché nessuna scelta è stata presa. Nella pagina che ospita il '
    + `riquadro la stessa lettura dice «da chiedere» (misurato: ${JSON.stringify(letto)})`,
  ).toEqual([]);
});
