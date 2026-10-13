// Il riquadrino «Ha funzionato?» dell'Aiuto, e la promessa che porta scritta
// (#584, audit pre-alpha).
//
// Rispondere lì non è un parere privato a chi scrive Filo: manda il sito, la
// pagina di partenza e la sequenza dei clic in una raccolta che legge chiunque.
// La pagina che lo spiega esiste, ma chi preme il pollice in su non ci è mai
// stato: la riga deve stare dove si sceglie. Questa spec tiene ferme due cose:
// che la riga ci sia accanto ai pulsanti, e che il percorso parta davvero
// quando si risponde.
//
// Il riquadro compare solo a raccolta accesa (oggi è spenta, #897: la prova sta
// in aiuto-raccolta-spenta.spec.mjs); qui lo si disegna direttamente, perché
// è quello che tornerà il giorno in cui si riaccende.
//
// Senza il fix il primo test è rosso: sotto la domanda non c'era niente.
// Il riquadro sta nel documento del sito: i bottoni sono in un root chiuso e il sì
// alla condivisione si dà nel popup di Filo, che la pagina non tocca (#592.6).

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmState, confermaSopraPagina, nelMondoDiFilo } from './helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';

async function apriRiquadro(page) {
  await page.waitForFunction(
    () => typeof window.__filoSidebarTest?.renderFeedbackPrompt === 'function',
    null, { timeout: 8000 },
  );
  await page.evaluate(() => {
    window.SN_SIDEBAR.open();
    window.__filoSidebarTest.renderFeedbackPrompt();
  });
  await page.waitForSelector('.sn-sidebar-feedback', { timeout: 8000 });
}

// I bottoni della risposta stanno in un root chiuso: un clic vero del mouse sul loro centro.
async function premi(page, quale) {
  const p = await page.evaluate((q) => window.__filoSidebarTest.puntoRisposta(q), quale);
  expect(p, `bottone «${quale}» presente`).toBeTruthy();
  await page.mouse.click(p.x, p.y);
}

test('sotto «Ha funzionato?» c’è scritto che rispondendo si condivide il percorso', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);

  const nota = page.locator('.sn-sidebar-feedback-nota');
  await expect(nota).toBeVisible();
  const testo = (await nota.textContent()) || '';
  expect(testo.toLowerCase()).toContain('condividi');

  // la riga sta PRIMA dei pulsanti: dopo, la si legge a scelta fatta
  const ordine = await page.evaluate(() => {
    const box = document.querySelector('.sn-sidebar-feedback');
    const figli = Array.from(box.children).map((el) => el.className);
    return {
      nota: figli.findIndex((c) => c.includes('feedback-nota')),
      pulsanti: figli.findIndex((c) => c.includes('feedback-row')),
    };
  });
  expect(ordine.nota).toBeGreaterThanOrEqual(0);
  expect(ordine.nota).toBeLessThan(ordine.pulsanti);

  // e si legge: non è testo bianco su bianco né alto zero
  const resa = await page.evaluate(() => {
    const el = document.querySelector('.sn-sidebar-feedback-nota');
    const s = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, colore: s.color, sfondo: getComputedStyle(el.parentElement).backgroundColor };
  });
  expect(resa.h).toBeGreaterThan(8);
  expect(resa.colore).not.toBe(resa.sfondo);

  await page.screenshot({ path: 'tests/.shots/584-nota-percorso-condiviso.png' });
});

// Il messaggio che si ascolta è quello VERO (`save_path`, da SN_MSG). Una prova
// sintonizzata su un nome di comodo resta muta anche il giorno in cui il
// pulsante smette di pubblicare: le sue due domande («nessun invio prima», «al
// massimo uno dopo») sono vere su una lista che non si riempie mai (#584,
// quinto giro).
async function ascolta(page) {
  await page.evaluate(() => {
    window.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'save_path') {
        window.__inviati.push(JSON.parse(JSON.stringify(msg)));
        return Promise.resolve({ ok: true });
      }
      return orig(msg, ...rest);
    };
  });
}

test('il pollice in su chiede il sì nel popup, poi pubblica davvero, una volta sola, e senza dire chi \u00e8 stato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await premi(page, 'up');
  await expect.poll(() => confirmState(page).then((s) => s && s.text)).toContain('dati personali');
  expect(await page.evaluate(() => window.__inviati.length)).toBe(0);
  await clickConfirm(page, 'ok');
  await premi(page, 'up');
  await premi(page, 'up');
  await page.waitForTimeout(150);

  const inviati = await page.evaluate(() => window.__inviati);
  expect(inviati.length).toBe(1);
  expect(inviati[0].payload.session.success).toBe(true);
  expect(typeof inviati[0].payload.session.rawUrl).toBe('string');

  // Nel messaggio che lascia la pagina non c'\u00e8 nessun identificativo del
  // mittente, a nessun livello.
  const piatto = JSON.stringify(inviati[0]).toLowerCase();
  for (const parola of ['useragent', 'user_agent', 'installid', 'deviceid']) {
    expect(piatto).not.toContain(parola);
  }
});

test('il pollice in gi\u00f9 pubblica anche lui, con l\u2019esito negativo', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await premi(page, 'down');
  await clickConfirm(page, 'ok');
  await page.waitForTimeout(150);

  const inviati = await page.evaluate(() => window.__inviati);
  expect(inviati.length).toBe(1);
  expect(inviati[0].payload.session.success).toBe(false);

  // La riga sotto la domanda dice «Rispondendo», non «Rispondendo di s\u00ec»:
  // deve valere per tutti e due i pulsanti, perch\u00e9 tutti e due pubblicano.
  const nota = (await page.locator('.sn-sidebar-feedback-nota').last().textContent()) || '';
  expect(nota.toLowerCase()).toContain('rispondendo');
});

test('«Non condividere» nel popup non pubblica niente e chiude la domanda', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await premi(page, 'up');
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => window.__inviati.length)).toBe(0);
  expect(await page.evaluate(() => window.__filoSidebarTest.puntoRisposta('up').disabled)).toBe(true);
});

test('la X non pubblica niente: chiudere il riquadro \u00e8 la via d\u2019uscita', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriRiquadro(page);
  await ascolta(page);

  await premi(page, 'skip');
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => window.__inviati.length)).toBe(0);
});

// La pagina ostile: appena compare la domanda ne riscrive la riga e cerca un bottone da premere.
const OSTILE = `<!doctype html><html><body><h1>Negozio</h1><script>
  window.__premuto = null;
  setInterval(() => {
    const nota = document.querySelector('.sn-sidebar-feedback-nota');
    if (nota && !nota.dataset.mio) { nota.dataset.mio = '1'; nota.textContent = 'Solo un parere privato per Filo.'; }
    const b = document.querySelector('.sn-sidebar-feedback button, .sn-sidebar-feedback-btn');
    if (b && !b.disabled && !window.__premuto) { window.__premuto = b.textContent; b.click(); }
  }, 50);
</script></body></html>`;

test('su un sito la pagina non risponde da s\u00e9, e chi risponde legge nel popup quello che succede davvero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, OSTILE);
  const host = new URL(page.url()).hostname;
  await nelMondoDiFilo(app, host, `(() => {
    globalThis.__inviati = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => { if (m && m.type === 'save_path') { globalThis.__inviati++; return Promise.resolve({ ok: true }); } return orig(m, ...r); };
    SN_SIDEBAR.open();
    __filoSidebarTest.renderFeedbackPrompt();
    return 1;
  })()`);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__premuto)).toBe(null);
  expect(await nelMondoDiFilo(app, host, 'globalThis.__inviati')).toBe(0);

  const p = await nelMondoDiFilo(app, host, "__filoSidebarTest.puntoRisposta('up')");
  await page.mouse.click(p.x, p.y);
  const vista = await confermaSopraPagina(app);
  const s = await vista.evaluate(() => window.SN_CONFIRM_UI._test.state());
  expect(s.text).toContain('dati personali');
  expect(s.text).not.toContain('parere privato');
  expect(await nelMondoDiFilo(app, host, 'globalThis.__inviati')).toBe(0);
  await page.waitForTimeout(700);
  const ok = await vista.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
  await vista.mouse.click(ok.x, ok.y);
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__inviati')).toBe(1);
});
