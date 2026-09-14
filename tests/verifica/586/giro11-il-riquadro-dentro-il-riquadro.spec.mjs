// Verifica #586, giro 11 — il riquadro dentro il riquadro.
//
// Il giro 10 ha chiuso i riquadri incorporati creati senza indirizzo: la pagina
// se ne scriveva uno in una riga e da lì saltava tutto. La chiusura arriva nel
// riquadro figlio da chi lo contiene, che ci mette dentro i suoi stampi a mano.
//
// Quello che ci mette dentro però è SOLO il pezzo che avvolge la cattura: non
// anche il pezzo che sa scendere di un altro piano. Quindi il riquadro del
// riquadro — due righe, nessun trucco di tempi — non lo raggiunge nessuno, né
// subito né dopo.
//
// Per chi usa Filo, quello che si prova qui:
//   · una pagina fa morire la propria scheda, e quello che ci stava scrivendo
//     è perso;
//   · un widget che guarda cosa può fare prima di mostrare il bottone legge
//     «negato» su cose che nessuno ha mai negato, e da lì non si esce;
//   · la scelta di cosa si condivide (questa deve reggere: la garanzia sta nel
//     processo principale, non nella pagina).

import { test, expect } from '../../fixtures/electron.mjs';

// Due piani sotto. Il primo riquadro lo si prende per il manico
// (`contentWindow`), che è la strada che la chiusura del giro 10 sorveglia:
// lì dentro la guardia ci arriva. Il SECONDO riquadro nasce dentro il primo, e
// il primo non ha nessuna guardia da dare a nessuno.
const DUE_PIANI = `
  window.__sotto = () => {
    const f = document.createElement('iframe');
    f.style.width = '20px'; f.style.height = '20px';
    document.body.appendChild(f);
    const w = f.contentWindow;            // qui la guardia si installa
    const d = w.document;
    const radice = d.body || d.documentElement;
    const g = d.createElement('iframe');
    radice.appendChild(g);
    return g.contentWindow;               // e qui non c'è più nessuno
  };`;

const PAGINA = `<!doctype html><html><body style="margin:0;padding:16px">
<h1>Una pagina qualunque</h1>
<input id="campo" style="width:70%">
<script>
  window.__vivo = String(Date.now());
  ${DUE_PIANI}
  const piatto = (s) => s.getTracks().map((t) => t.kind + ':' + (t.label || '?'));

  // La forma che Chromium non rifiuta da sé: l'audio del computer chiesto senza
  // l'immagine dello schermo. Scritta nella pagina torna un errore che il sito
  // sa gestire (giro 4). Due piani sotto?
  window.__ammazza = () => {
    const w = window.__sotto();
    if (!w || !w.navigator || !w.navigator.mediaDevices) return Promise.resolve('niente riquadro');
    return w.navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
    }).then(() => 'ottenuto', (e) => 'rifiutato:' + ((e && e.name) || '?'));
  };

  // Cosa legge un widget due piani sotto, prima di chiedere qualunque cosa.
  window.__legge = async () => {
    const w = window.__sotto();
    if (!w || !w.navigator) return { errore: 'niente riquadro' };
    const out = {};
    for (const nome of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { out[nome] = (await w.navigator.permissions.query({ name: nome })).state; }
      catch (e) { out[nome] = 'errore:' + ((e && e.name) || '?'); }
    }
    out.notificationPermission = w.Notification ? w.Notification.permission : 'assente';
    return out;
  };

  // La stessa lettura fatta dalla pagina, per avere il metro accanto.
  window.__leggeQui = async () => {
    const out = {};
    for (const nome of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { out[nome] = (await navigator.permissions.query({ name: nome })).state; }
      catch (e) { out[nome] = 'errore:' + ((e && e.name) || '?'); }
    }
    out.notificationPermission = Notification ? Notification.permission : 'assente';
    return out;
  };

  // La strada vecchia della cattura schermo, due piani sotto.
  window.__schermo = () => {
    const w = window.__sotto();
    if (!w || !w.navigator || !w.navigator.mediaDevices) return Promise.resolve(['niente riquadro']);
    return w.navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop' } },
    }).then((s) => { window.__preso = s; return piatto(s); },
      (e) => ['rifiutato:' + ((e && e.name) || '?')]);
  };

  // Lo stato VERO delle tracce prese, letto dallo stampo originale: è quello che
  // conta, non quello che la pagina dice.
  const veroStato = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get;
  window.__statoPreso = () => (window.__preso
    ? window.__preso.getTracks().map((t) => t.kind + ':' + veroStato.call(t))
    : ['niente']);
</script></body></html>`;

test('la richiesta che ammazza la scheda non deve ammazzarla nemmeno da un riquadro dentro un riquadro', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#campo', 'quello che stavo scrivendo');
  const vivoPrima = await page.evaluate(() => window.__vivo);

  const esito = await page.evaluate(() => window.__ammazza()).catch((e) => 'la scheda è morta: ' + e.message);
  await page.waitForTimeout(2500);

  const campo = await page.evaluate(() => {
    const c = document.getElementById('campo');
    return c ? c.value : '(perso)';
  }).catch(() => '(perso)');
  const vivoDopo = await page.evaluate(() => window.__vivo).catch(() => null);
  console.log('[586 g11] due piani sotto — esito:', esito, 'campo:', JSON.stringify(campo),
    'stessa pagina:', vivoDopo === vivoPrima);

  expect(
    String(esito).includes('è morta') || vivoDopo !== vivoPrima,
    'la scheda è morta con due righe: la pagina ha chiesto l\'audio del computer senza l\'immagine '
    + 'dello schermo da un riquadro nato dentro un altro riquadro, e quello che chi navigava aveva '
    + 'scritto lì è perso. La stessa richiesta scritta nella pagina, e anche un piano più sotto, '
    + 'torna un errore che il sito sa gestire',
  ).toBe(false);
});

test('due piani sotto, i permessi che nessuno ha mai negato si devono leggere «da chiedere»', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);

  const qui = await page.evaluate(() => window.__leggeQui());
  const sotto = await page.evaluate(() => window.__legge());
  console.log('[586 g11] la pagina legge:', JSON.stringify(qui));
  console.log('[586 g11] due piani sotto legge:', JSON.stringify(sotto));

  const negati = Object.entries(sotto)
    .filter(([, v]) => v === 'denied')
    .map(([k]) => k);

  expect(
    negati,
    'dentro un riquadro nato dentro un altro riquadro un widget legge «negato» su cose che nessuno '
    + 'ha mai negato, mentre la pagina che lo ospita legge «da chiedere». Un widget che legge '
    + '«negato» non chiede mai: mostra «sbloccalo dalle impostazioni del browser», e in '
    + 'Impostazioni quel sito non c\'è perché nessuna scelta è stata presa',
  ).toEqual([]);
});

test('la scelta di cosa si condivide non si salta nemmeno due piani sotto', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, PAGINA);

  const corsa = page.evaluate(() => window.__schermo()).catch((e) => ['la scheda è morta: ' + e.message]);
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 25_000 });
  console.log('[586 g11] la domanda dice:', (await shell.locator('.perm-chip').first().innerText()).replace(/\s+/g, ' '));
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  await shell.waitForTimeout(1500);

  const scelta = await shell.locator('.perm-source-picker, .perm-fonti, [class*="source"]').count();
  console.log('[586 g11] è comparso il riquadro della scelta:', scelta > 0);
  const arrivato = await corsa;
  console.log('[586 g11] quello che è arrivato al sito:', JSON.stringify(arrivato));

  expect(
    (arrivato || []).some((t) => /^video|^audio/.test(String(t))),
    'da due piani sotto un «Consenti» solo ha consegnato la cattura senza far scegliere cosa si '
    + 'condivide: al sito è arrivato ' + JSON.stringify(arrivato),
  ).toBe(false);
});
