// #376 — "il video è partito in una tab che ha preso priorità": quando Filo
// mette una canzone non deve strappare l'utente da dove si trova. La scheda che
// apre per farla suonare nasce in SECONDO PIANO, e il riferimento che resta
// nella conversazione ci PORTA (non ne apre un doppione).
//
// Contratto (asserisce il SUCCESSO della feature, non l'assenza di errori):
//   • NAVIGA con background → la scheda si apre DAVVERO e la scheda attiva NON
//     cambia (l'utente resta dov'era);
//   • NAVIGA senza background → continua ad attivare la nuova scheda (il flag
//     deve fare davvero la differenza: è il ramo che senza il fix era l'unico);
//   • il riferimento in chat di un'apertura in secondo piano porta a QUELLA
//     scheda (nessun doppione aperto).
//
// Pre-condizione che senza il fix fallirebbe: prima NAVIGA apriva sempre con
// activate:true → l'assert "la scheda attiva non è cambiata" era rosso.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const execAction = (app, action) =>
  app.evaluate((_electron, { action }) => globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

// Stato del TabManager: id della scheda attiva, suo URL, numero di schede e
// quante puntano a un certo URL (per scoprire i doppioni).
const tabsState = (app, url) =>
  app.evaluate(({ BrowserWindow }, { url }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoTabs.incognito);
    if (!win) return null;
    const tm = win._filoTabs;
    const active = tm.tabs.find((t) => t.id === tm.activeId) || null;
    return {
      activeId: tm.activeId,
      activeUrl: active ? active.url : '',
      count: tm.tabs.length,
      matching: tm.tabs.filter((t) => t.url === url).map((t) => t.id),
    };
  }, { url });

test('#376 — NAVIGA in secondo piano apre la scheda SENZA rubare il primo piano', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Canzone</title><h1>suona</h1>');

  const before = await tabsState(app, url);
  expect(before.matching).toHaveLength(0);

  const r = await execAction(app, { type: 'NAVIGA', url, label: 'Canzone', background: true });
  expect(r.executed).toBe(true);
  expect(r.background).toBe(true);
  // Il client riceve l'id della scheda nata dietro: serve al riferimento in chat.
  expect(r.output && r.output.background).toBe(true);
  expect(typeof (r.output && r.output.tabId)).toBe('string');

  // SUCCESSO 1: la scheda esiste davvero (la canzone è partita lì dentro).
  await expect.poll(async () => (await tabsState(app, url)).matching.length, { timeout: 8_000 }).toBe(1);

  // SUCCESSO 2 (il cuore del feedback): l'utente è rimasto dov'era.
  const after = await tabsState(app, url);
  expect(after.activeId).toBe(before.activeId);
  expect(after.matching).not.toContain(after.activeId);
  expect(after.count).toBe(before.count + 1);
});

test('#376 — senza il flag, NAVIGA continua a portare l’utente sulla pagina aperta', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Da leggere</title><h1>eccomi</h1>');

  const before = await tabsState(app, url);
  const r = await execAction(app, { type: 'NAVIGA', url, label: 'Da leggere' });
  expect(r.executed).toBe(true);
  expect(r.background).toBe(false);

  // La scheda nuova diventa quella attiva: chi chiede di APRIRE vuole arrivarci.
  await expect.poll(async () => (await tabsState(app, url)).activeUrl, { timeout: 8_000 }).toBe(url);
  const after = await tabsState(app, url);
  expect(after.activeId).not.toBe(before.activeId);
});

// Pagina che prova a suonare da sola: un WAV di silenzio generato al volo (non
// serve un file multimediale nel repo) con autoplay. Se il media parte, la
// pagina lo espone in #stato — è la prova che "la canzone suona anche se la
// scheda non è in primo piano", cioè il senso della richiesta.
const AUTOPLAY_PAGE = `<!doctype html><title>Brano</title><div id="stato">fermo</div>
<script>
  // WAV 8 kHz mono, 2 secondi di silenzio: header + campioni a zero.
  const dur = 2, rate = 8000, n = dur * rate;
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const a = new Audio('data:audio/wav;base64,' + btoa(bin));
  a.autoplay = true;
  a.play().then(() => { document.getElementById('stato').textContent = 'suona'; })
          .catch((e) => { document.getElementById('stato').textContent = 'bloccato: ' + e.name; });
  window.__statoAudio = () => ({ testo: document.getElementById('stato').textContent, tempo: a.currentTime, pausa: a.paused });
</script>`;

test('#376 — il brano parte DAVVERO nella scheda aperta in secondo piano', async ({ app, testServer, openTab }) => {
  await openTab(NEWTAB);
  const url = testServer.html(AUTOPLAY_PAGE);

  const before = await tabsState(app, url);
  await execAction(app, { type: 'NAVIGA', url, label: 'Brano', background: true });
  await expect.poll(async () => (await tabsState(app, url)).matching.length, { timeout: 8_000 }).toBe(1);

  // La scheda non è quella attiva…
  const after = await tabsState(app, url);
  expect(after.activeId).toBe(before.activeId);

  // …eppure il media è partito lì dentro (è il punto della richiesta: la musica
  // parte senza che l'utente debba andarci).
  let bgPage = null;
  await expect.poll(() => {
    bgPage = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
    return !!bgPage;
  }, { timeout: 8_000 }).toBe(true);

  await expect.poll(async () => {
    try { return await bgPage.evaluate(() => window.__statoAudio && window.__statoAudio().testo); } catch (_) { return null; }
  }, { timeout: 10_000 }).toBe('suona');

  await expect.poll(async () => {
    try { return await bgPage.evaluate(() => window.__statoAudio().pausa); } catch (_) { return true; }
  }, { timeout: 5_000 }).toBe(false);
});

test('#376 — il riferimento in chat PORTA alla scheda aperta in secondo piano (niente doppione)', async ({ app, testServer, openTab }) => {
  const page = await openTab(NEWTAB);
  const url = testServer.html('<!doctype html><title>Radio</title><h1>radio</h1>');

  const r = await execAction(app, { type: 'NAVIGA', url, label: 'Radio', background: true });
  const tabId = r.output.tabId;
  await expect.poll(async () => (await tabsState(app, url)).matching.length, { timeout: 8_000 }).toBe(1);

  // Il chip che Filo lascia nella bolla, con l'esito dell'apertura in secondo piano.
  await page.evaluate(({ url, tabId }) => {
    const host = document.createElement('div');
    host.id = 'test-bg-chip';
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [{
      type: 'NAVIGA', url, label: 'Radio',
      _output: { background: true, tabId },
    }]);
  }, { url, tabId });

  const chip = page.locator('#test-bg-chip .dash-action-link-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Radio');

  const before = await tabsState(app, url);
  expect(before.activeId).not.toBe(tabId);

  await chip.click();

  // SUCCESSO: siamo ATTERRATI sulla scheda che già suonava, e non ne è nata
  // una seconda sullo stesso indirizzo.
  await expect.poll(async () => (await tabsState(app, url)).activeId, { timeout: 6_000 }).toBe(tabId);
  expect((await tabsState(app, url)).matching).toHaveLength(1);
});

test('#376 — i passi intermedi di Filo non sono bottoni (una sola cosa cliccabile)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);

  // La stessa scena del feedback, dentro bolle vere: Filo cerca sul web e poi
  // apre il risultato in secondo piano.
  await page.evaluate(() => {
    // Vista conversazione (la home lascia il posto alle bolle appena si scrive).
    document.getElementById('homeView').hidden = true;
    document.getElementById('threadView').hidden = false;
    const bubbles = document.getElementById('bubbles');
    const mk = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      if (text) d.textContent = text;
      bubbles.appendChild(d);
      return d;
    };
    mk('dash-bubble dash-bubble-user', 'voglio ascoltarla');
    const step = mk('dash-bubble dash-bubble-filo', 'Cerco una versione audio o video disponibile.');
    step.id = 'test-steps';
    window.__filoDashActions.renderActions(step, [
      { type: 'CERCA_WEB', query: 'Il conformista Gaber audio video YouTube' },
    ]);
    const out = mk('dash-bubble dash-bubble-filo dash-bubble-actions-only');
    out.id = 'test-result';
    window.__filoDashActions.renderActions(out, [
      {
        type: 'NAVIGA', url: 'https://www.youtube.com/watch?v=x',
        label: 'Il conformista - Giorgio Gaber',
        _output: { background: true, tabId: 'tab-finto' },
      },
    ]);
  });

  // Traccia visiva ispezionabile della scena (cartella gitignorata).
  await page.screenshot({ path: 'tests/.shots/376-chat-passi.png' });

  // La traccia del passo intermedio resta LEGGIBILE (trasparenza, #368)…
  const trace = page.locator('#test-steps .dash-action-step');
  await expect(trace).toHaveCount(1);
  await expect(trace).toContainText('Cerco sul web');
  // …ma non ha più la forma di un bottone/pill.
  await expect(page.locator('#test-steps .dash-action-step.dash-action-btn')).toHaveCount(0);

  // SUCCESSO: in tutta la conversazione resta UNA sola cosa cliccabile — il
  // risultato vero (prima erano due pill affiancate: la ricerca e il link).
  await expect(page.locator('#bubbles .dash-action-btn')).toHaveCount(1);
  await expect(page.locator('#bubbles .dash-action-btn')).toContainText('Giorgio Gaber');
});
