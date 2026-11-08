// #2299 — i segni del correttore dicevano al sito quali parole sono nel dizionario personale: lo script scriveva da sé
// una lista di candidati nel suo campo e guardava quali restavano senza segno. Su un sito gli strati stanno in un'ombra
// chiusa, e si controlla solo il testo dell'utente: quello che batte o fa scrivere a Filo, e quello trovato entrando.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDelMenu, menuDi } from './helpers/menuContestuale.mjs';
import { segniDi, riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="sonda" lang="it" style="display:block;width:600px;height:80px;font:20px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:600px;min-height:60px;font:20px monospace;border:1px solid #999;margin-top:12px"></div>
  <textarea id="ta" lang="it" style="display:block;width:600px;height:80px;font:20px monospace;margin-top:12px"></textarea>
<script>
  // Quello che può vedere lo script del sito: i nodi del documento e le ombre che può aprire.
  window.visto = () => {
    return {
      segni: document.querySelectorAll('.sn-spell-overlay, .sn-spell-valori, .sn-errore, .sn-suggerimento').length,
      ombreAperte: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
      testoDiFilo: [...document.querySelectorAll('[data-sn-ui]')].map((e) => e.textContent).join(''),
    };
  };
  // La sonda: una parola del dizionario personale e una sbagliata, scritte da script con un input finto.
  window.sonda = () => {
    const ta = document.getElementById('sonda');
    ta.focus();
    ta.value = 'oggi zanzottera e quseta ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const ce = document.getElementById('ce');
    ce.focus();
    ce.textContent = 'oggi zanzottera e quseta ';
    ce.dispatchEvent(new Event('input', { bubbles: true }));
  };
</script>
</body>`;

async function apri(app, openTab, testServer) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: false },
    });
    await globalThis.chrome.storage.local.set({ sn_personal_dict: ['Zanzottera'] });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

test('lo script del sito che scrive da sé parole nei suoi campi non vede quali Filo conosce', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => window.sonda());
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.visto())).toEqual({ segni: 0, ombreAperte: 0, testoDiFilo: '' });
  // Nemmeno dentro l'ombra: un testo che l'utente non ha scritto non si controlla.
  expect(await segniDi(page, '.sn-errore, .sn-suggerimento').count()).toBe(0);
});

test('chi scrive vede i suoi segni, e il sito no', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi zanzottera e quseta ');
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  const b = await riquadroDelSegno(errore);
  const ta = await page.locator('#ta').boundingBox();
  expect(b.x).toBeGreaterThan(ta.x);
  expect(b.y + b.height).toBeLessThan(ta.y + ta.height);
  expect(await page.evaluate(() => window.visto())).toEqual({ segni: 0, ombreAperte: 0, testoDiFilo: '' });
  await page.screenshot({ path: 'tests/.shots/correttore-segni-fuori-dalla-pagina.png', clip: { x: 0, y: 0, width: 660, height: 320 } });

  // Il testo che il sito ci rimette da sé non si controlla, nemmeno dopo un altro clic o un tasto che non scrive: ogni
  // gesto sarebbe una misura. Quello che l'utente scrive dopo sì, nell'ombra.
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'ancora quseta e zanzottera ';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  expect(await errore.count()).toBe(0);
  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(600);
  expect(await errore.count()).toBe(0);
  // Il segno va sulla «quseta» battuta adesso, in fondo: quella del sito resta senza.
  await page.keyboard.type('poi quseta ');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  expect((await riquadroDelSegno(errore)).x).toBeGreaterThan(ta.x + 300);
  expect((await page.evaluate(() => window.visto())).segni).toBe(0);
});

test('chi arriva col Tab in una casella che il sito ha già riempito ritrova subito i segni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => { document.getElementById('ta').value = 'la bozza di ieri con quseta '; });
  await page.locator('#ce').click();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ta');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});

test('il sito che rifà la pagina senza ricaricarla butta lo strato dei segni, e i segni tornano nella casella nuova', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi quseta ');
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  await page.evaluate(() => {
    document.body.innerHTML = '<textarea id="nuova" lang="it" style="display:block;width:600px;height:80px;font:20px monospace"></textarea>';
  });
  await expect(errore).toHaveCount(0, { timeout: 3000 });
  await page.locator('#nuova').click();
  await page.keyboard.type('domani quseta ');
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
  const b = await riquadroDelSegno(errore);
  const ta = await page.locator('#nuova').boundingBox();
  expect(b.y + b.height).toBeLessThan(ta.y + ta.height);
  expect((await page.evaluate(() => window.visto())).segni).toBe(0);
});

const SONDA_DEI_TEMPI = `<!doctype html><meta charset="utf-8">
<body style="margin:0"><textarea id="t" lang="it" style="position:fixed;inset:0;width:100vw;height:100vh;opacity:0;font:20px monospace"></textarea>
<script>
  // Quanti giri fa un ciclo di messaggi dopo la scrittura: meno giri, più lavoro di Filo nella pagina.
  const giri = (ms) => new Promise((ok) => {
    const c = new MessageChannel();
    let n = 0;
    const fine = performance.now() + ms;
    c.port1.onmessage = () => { n++; if (performance.now() < fine) c.port2.postMessage(0); else ok(n); };
    c.port2.postMessage(0);
  });
  async function prova(parola) {
    const t = document.getElementById('t');
    t.value = (parola + ' ').repeat(1500);
    const t0 = performance.now();
    t.dispatchEvent(new Event('input', { bubbles: true }));
    const sincrono = performance.now() - t0;
    const liberi = await giri(450);
    t.value = '';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await giri(150);
    return { sincrono, liberi };
  }
  window.sonda = async () => {
    const a = [], b = [];
    for (let i = 0; i < 7; i++) { a.push(await prova('zanzottera')); b.push(await prova('quseta')); }
    const med = (x, k) => x.map((v) => v[k]).sort((p, q) => p - q)[3];
    return { nota: { sincrono: med(a, 'sincrono'), liberi: med(a, 'liberi') }, ignota: { sincrono: med(b, 'sincrono'), liberi: med(b, 'liberi') } };
  };
</script></body>`;

// Dopo un clic vero, anche su una casella invisibile grande quanto la pagina, lo script scriveva da sé una parola
// ripetuta e misurava quanto lavorava la pagina: una parola segnata costava molto più di una del dizionario.
test('dopo un clic nella pagina, lo script del sito non distingue dai tempi le parole del dizionario', async ({ app, openTab, testServer }) => {
  await apri(app, openTab, testServer);
  const page = await testServer.openReady(openTab, SONDA_DEI_TEMPI, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.mouse.click(300, 300);
  await page.waitForTimeout(500);
  const esito = await page.evaluate(() => window.sonda());
  expect(esito.ignota.sincrono).toBeLessThan(esito.nota.sincrono * 1.5 + 3);
  expect(esito.ignota.liberi).toBeGreaterThan(esito.nota.liberi * 0.85);
});

test('chi rientra col clic in una casella già scritta, che aveva il fuoco da script, ritrova i segni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'la bozza di ieri con quseta ';
    ta.focus();
  });
  await page.waitForTimeout(600);
  const errore = segniDi(page, '.sn-spell-overlay .sn-errore');
  expect(await errore.count()).toBe(0);
  await page.locator('#ta').click();
  await expect(errore).toHaveText(['quseta'], { timeout: 5000 });
});

// A ogni tasto vero dell'utente lo script, prima di Filo, metteva nella casella una parola ripetuta, misurava il lavoro
// di Filo e rimetteva il testo dell'utente; allo spazio ci metteva un cognome in minuscolo e rileggeva se Filo l'aveva
// rimesso con la maiuscola (o un'abbreviazione insegnata a Filo, sciolta).
const SONDA_AI_TASTI = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:200px;font:16px sans-serif"></textarea>
<script>
  window.durate = [];
  window.letti = [];
  window.sonde = [];
  let t0 = 0, vero = '', sonda = null;
  window.addEventListener('input', (e) => {
    if (!e.isTrusted || !window.sonde.length) return;
    sonda = window.sonde.shift();
    vero = e.target.value;
    e.target.value = sonda.spazio ? sonda.parola + ' ' : (sonda.parola + ' ').repeat(1500);
    e.target.setSelectionRange(e.target.value.length, e.target.value.length);
    t0 = performance.now();
  }, true);
  window.addEventListener('input', (e) => {
    if (!e.isTrusted || !sonda) return;
    if (sonda.spazio) window.letti.push(e.target.value); else window.durate.push({ parola: sonda.parola, ms: performance.now() - t0 });
    e.target.value = vero;
    sonda = null;
  });
</script>
</body>`;

test('a ogni tasto dell\'utente lo script del sito non legge il dizionario dai tempi né dalla parola che Filo riscrive', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
    await globalThis.chrome.storage.local.set({ sn_personal_dict: ['Zanzottera'], sn_autocorrect: { qst: 'questo' } });
  });
  const page = await testServer.openReady(openTab, SONDA_AI_TASTI, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.click('#ta');
  await page.keyboard.type('ciao ', { delay: 80 });
  await page.waitForTimeout(400);

  await page.evaluate(() => { for (let i = 0; i < 7; i++) window.sonde.push({ parola: 'zanzottera' }, { parola: 'quseta' }); });
  for (const c of 'come stai oggi') { await page.keyboard.type(c); await page.waitForTimeout(120); }
  const durate = await page.evaluate(() => window.durate);
  const med = (p) => { const x = durate.filter((d) => d.parola === p).map((d) => d.ms).sort((a, b) => a - b); return x[Math.floor(x.length / 2)]; };
  expect(durate).toHaveLength(14);
  expect(med('quseta')).toBeLessThan(med('zanzottera') * 1.5 + 3);

  await page.evaluate(() => { for (const parola of ['zanzottera', 'brambillasca', 'qst']) window.sonde.push({ parola, spazio: true }); });
  for (const w of [' va', ' tutto', ' bene']) await page.keyboard.type(w, { delay: 120 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.letti)).toEqual(['zanzottera ', 'brambillasca ', 'qst ']);
  await expect(page.locator('#ta')).toHaveValue('ciao come stai oggi va tutto bene');
});

test('il testo incollato dal tasto destro di Filo riceve subito i segni, anche scelto dopo qualche secondo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await app.evaluate(({ clipboard }) => clipboard.writeText('oggi quseta e domani '));
  await page.locator('#ta').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu-paste-main').first()).toBeVisible();
  await page.waitForTimeout(2000);
  await menuDi(page).locator('.sn-menu-paste-main').first().click();
  await expect(page.locator('#ta')).toHaveValue('oggi quseta e domani ');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});

// Le altre strade da cui Filo scrive in una casella del sito: quello che scrive resta dell'utente, e si controlla.
test('il testo scritto da Modifica in un campo modificabile e dalla compilazione di Filo riceve i segni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('oggi ');
  await nelMondoDelMenu(app, page, () => {
    const el = document.getElementById('ce');
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    globalThis.SN_EDITBOX.sostituisci({ kind: 'ce', el, range: r }, 'domani quseta ');
  });
  await expect(page.locator('#ce')).toHaveText(/oggi domani quseta/);
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });

  await page.locator('#ta').click();
  await nelMondoDelMenu(app, page, () => { globalThis.SN_HIGHLIGHT.fillElement(document.getElementById('ta'), 'ieri quseta e oggi '); });
  await expect(page.locator('#ta')).toHaveValue('ieri quseta e oggi ');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});

test('il suggerimento del dizionario del browser scelto dal tasto destro è testo dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('oggi ciiao ');
  await page.waitForTimeout(400);
  const box = await page.locator('#ce').boundingBox();
  await page.mouse.dblclick(box.x + 70, box.y + 14);
  await page.mouse.click(box.x + 70, box.y + 14, { button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
  const corr = menuDi(page).locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  const host = new URL(page.url()).host;
  // Dopo quello vero, un suggerimento che Filo segna: così si vede se il testo scritto si controlla.
  await app.evaluate(({ webContents }, h) => {
    for (const w of webContents.getAllWebContents()) {
      try { if (new URL(w.getURL()).host === h) w.send('filo:broadcast', { type: '_spell:native', word: 'ciiao', suggestions: ['quseta'] }); } catch (_) {}
    }
  }, host);
  await expect(corr.first()).toContainText('quseta', { timeout: 4000 });
  await corr.first().click();
  await expect(page.locator('#ce')).toHaveText(/oggi quseta/);
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});

// Un annulla o un rifai riporta un testo coi proprietari che aveva; un'immagine incollata non porta testo dell'utente.
const SONDA_DELL_ANNULLA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:200px;font:16px sans-serif"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:600px;min-height:120px;font:16px sans-serif;border:1px solid #999"></div>
  <div id="altro" style="height:40px">altro</div>
<script>
  const ta = document.getElementById('ta');
  const cmd = (c, v) => document.execCommand(c, false, v);
  window.prepara = () => {
    const vero = ta.value;
    ta.focus();
    cmd('selectAll'); cmd('insertText', 'zanzottera '.repeat(1500));
    cmd('selectAll'); cmd('insertText', 'quseta '.repeat(1500));
    cmd('selectAll'); cmd('insertText', vero);
  };
  window.durate = [];
  window.sonda = () => {
    ta.focus();
    let t0 = performance.now(); cmd('undo'); const q = performance.now() - t0;
    t0 = performance.now(); cmd('undo'); const z = performance.now() - t0;
    cmd('redo'); cmd('redo');
    window.durate.push({ q, z });
  };
  window.allaScorciatoia = false;
  document.addEventListener('keydown', (e) => { if (window.allaScorciatoia && e.ctrlKey && e.key === 'a') window.sonda(); });
  window.sondeImmagine = [];
  let t0 = 0, sonda = null, vero = '';
  window.addEventListener('input', (e) => {
    if (!e.isTrusted || e.inputType !== 'insertFromPaste' || !window.sondeImmagine.length) return;
    sonda = window.sondeImmagine.shift();
    vero = e.target.innerHTML;
    e.target.textContent = (sonda + ' ').repeat(1500);
    t0 = performance.now();
  }, true);
  window.addEventListener('input', (e) => {
    if (!sonda) return;
    window.durate.push(sonda === 'quseta' ? { q: performance.now() - t0 } : { z: performance.now() - t0 });
    e.target.innerHTML = vero;
    sonda = null;
  });
  window.mediane = () => {
    const med = (k) => { const x = window.durate.map((d) => d[k]).filter((v) => v != null).sort((a, b) => a - b); return x[Math.floor(x.length / 2)]; };
    const out = { conosciuta: med('z'), ignota: med('q'), prove: window.durate.length };
    window.durate = [];
    return out;
  };
</script>
</body>`;

test('annulla e rifai dello script del sito, e un\'immagine incollata, non gli fanno leggere il dizionario dai tempi', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: false },
    });
    await globalThis.chrome.storage.local.set({ sn_personal_dict: ['Zanzottera'] });
  });
  const page = await testServer.openReady(openTab, SONDA_DELL_ANNULLA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  const pari = (m) => { expect(m.prove).toBeGreaterThan(3); expect(m.ignota).toBeLessThan(m.conosciuta * 1.5 + 3); };

  // A ogni Ctrl+A nella casella lo script annulla, misura e rifà.
  await page.click('#ta');
  await page.keyboard.type('ciao come stai ', { delay: 40 });
  await page.evaluate(() => window.prepara());
  await page.evaluate(() => { window.allaScorciatoia = true; });
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Control+a'); await page.keyboard.press('End'); }
  pari(await page.evaluate(() => window.mediane()));
  await expect(page.locator('#ta')).toHaveValue('ciao come stai ');
  await page.evaluate(() => { window.allaScorciatoia = false; });

  // Dopo un Ctrl+clic fuori dalla casella il rilascio del Ctrl non arriva lì: lo script misura quando vuole.
  await page.click('#altro', { modifiers: ['Control'] });
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.sonda());
  pari(await page.evaluate(() => window.mediane()));

  // Un'immagine incollata in un campo modificabile: lo script mette la sua sonda nello stesso evento.
  await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const px = Buffer.alloc(48 * 32 * 4);
    for (let i = 0; i < 48 * 32; i++) px.set([30, 60, 200, 255], i * 4);
    const png = nativeImage.createFromBitmap(px, { width: 48, height: 32 }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
  await page.click('#ce');
  await page.keyboard.type('ciao ', { delay: 40 });
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.sondeImmagine.push('zanzottera', 'quseta'); });
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Control+v'); await page.waitForTimeout(100); }
  pari(await page.evaluate(() => window.mediane()));
});

test('l\'annulla dell\'utente riporta il suo testo coi suoi segni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi quseta ', { delay: 30 });
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveCount(0, { timeout: 5000 });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ta')).toHaveValue('oggi quseta ');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});
