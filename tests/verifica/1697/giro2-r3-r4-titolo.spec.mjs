// #1697 giro 2. r3: un titolo da rifare che la risposta non porta fa richiamare il modello a ogni pausa nella scrittura.
// r4: la copia di un documento col titolo automatico non segue più il suo contenuto.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(180_000);
const KEY = 'filo.editor.collection';

// Il modello finto risponde secondo il testo che riceve; `unica` decide la risposta della chiamata titolo+riassunto.
async function stubAI(page, unica = 'giusta') {
  await page.evaluate((unica) => {
    window.__chiamate = [];
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        const ms = (msg.payload && msg.payload.messages) || [];
        const sys = String((ms[0] && ms[0].content) || '');
        const u = ms.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
        const tema = /montagna/.test(u) ? 'Montagna' : /mare/.test(u) ? 'Mare' : 'Ignoto';
        const insieme = /TITOLO:/.test(sys);
        window.__chiamate.push({ action: msg.action, insieme });
        if (msg.action === 'editor_title') r = { ok: true, text: `Titolo ${tema}` };
        else if (insieme && unica === 'tagliata') r = { ok: false, code: 'RISPOSTA_TAGLIATA', finishReason: 'length', error: 'risposta tagliata' };
        else if (insieme && unica === 'senzaEtichette') r = { ok: true, text: `Riassunto ${tema}.` };
        else if (insieme) r = { ok: true, text: `TITOLO: Titolo ${tema}\nRIASSUNTO: Riassunto ${tema}.` };
        else r = { ok: true, text: `Riassunto ${tema}.` };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        const p = Promise.resolve(r);
        if (typeof cb === 'function') { p.then(cb); return undefined; }
        return p;
      }
      return orig(msg, cb);
    };
  }, unica);
}

const parole = { mare: ['il', 'mare', 'onde', 'spiaggia', 'sabbia', 'barca'], montagna: ['la', 'montagna', 'neve', 'vetta', 'sentiero', 'rifugio'] };
const testo = (tema, n) => Array.from({ length: n }, (_, i) => parole[tema][i % 6]).join(' ');
async function scrivi(page, t) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + t + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
}
async function aggiungiParola(page) {
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.querySelector('p').append(' neve');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const attivo = (page) => page.evaluate((k) => {
  const c = JSON.parse(localStorage.getItem(k));
  const f = c.files.find((x) => x.id === c.activeId);
  return { title: f.meta.title, summary: f.meta.summary || null };
}, KEY);
const insieme = (page) => page.evaluate(() => window.__chiamate.filter((c) => c.insieme).length);

for (const [caso, unica] of [['la risposta arriva tagliata', 'tagliata'], ['la risposta non ha la riga del titolo', 'senzaEtichette']]) {
  test(`r3 titolo da rifare e ${caso}: tre ritocchi dopo non richiamano il modello a ogni pausa`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await stubAI(page, unica);
    await scrivi(page, testo('mare', 150));
    await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
    await scrivi(page, testo('montagna', 150));
    await expect.poll(() => insieme(page), { timeout: 20000 }).toBe(1);
    for (let i = 0; i < 3; i++) {
      await aggiungiParola(page);
      await page.waitForTimeout(8500);
    }
    expect.soft(await insieme(page), 'chiamate titolo+riassunto dopo i ritocchi').toBeLessThanOrEqual(2);
    expect.soft(await page.evaluate(() => window.__avvisi || 0), 'avvisi a video').toBeLessThanOrEqual(1);
  });
}

test('r4 copia di un documento col titolo automatico, riscritta su un altro argomento: il titolo segue il contenuto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await page.click('#docTitle', { button: 'right' });
  await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Duplica file")');
  await expect.poll(async () => (await attivo(page)).title).toBe('Titolo Mare (copia)');
  await scrivi(page, testo('montagna', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 25000 }).toBe('Titolo Montagna');
});
