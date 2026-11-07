// #1697.2 giro 1: titolo da rifare senza titolo nella risposta, e copia di un documento col titolo automatico.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(180_000);
const KEY = 'filo.editor.collection';

async function stubAI(page, unica = 'giusta') {
  await page.evaluate((unica) => {
    window.__chiamate = [];
    window.__avvisi = 0;
    window.__unica = unica;
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('ed-toast')) window.__avvisi++;
    }).observe(document.body, { childList: true, subtree: true });
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        const unica = window.__unica;
        const ms = (msg.payload && msg.payload.messages) || [];
        const sys = String((ms[0] && ms[0].content) || '');
        const u = ms.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
        const tema = /montagna/.test(u) ? 'Montagna' : /mare/.test(u) ? 'Mare' : /citt/.test(u) ? 'Città' : 'Ignoto';
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

const parole = {
  mare: ['il', 'mare', 'onde', 'spiaggia', 'sabbia', 'barca'],
  montagna: ['la', 'montagna', 'neve', 'vetta', 'sentiero', 'rifugio'],
  citta: ['la', 'città', 'strade', 'piazza', 'traffico', 'palazzi'],
};
const testo = (tema, n) => Array.from({ length: n }, (_, i) => parole[tema][i % 6]).join(' ');
async function scrivi(page, t) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + t + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
}
async function aggiungiParola(page, p = ' neve') {
  await page.evaluate((p) => {
    const doc = document.getElementById('doc');
    doc.querySelector('p').append(p);
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, p);
}
const attivo = (page) => page.evaluate((k) => {
  const c = JSON.parse(localStorage.getItem(k));
  const f = c.files.find((x) => x.id === c.activeId);
  return { title: f.meta.title, summary: f.meta.summary || null, meta: f.meta };
}, KEY);
const insieme = (page) => page.evaluate(() => window.__chiamate.filter((c) => c.insieme).length);
const tutte = (page) => page.evaluate(() => window.__chiamate.length);

for (const [caso, unica] of [['la risposta arriva tagliata', 'tagliata'], ['la risposta non ha la riga del titolo', 'senzaEtichette']]) {
  test(`titolo da rifare e ${caso}: tre ritocchi dopo non richiamano il modello a ogni pausa`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await stubAI(page, 'giusta');
    await scrivi(page, testo('mare', 150));
    await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
    await page.evaluate((u) => { window.__unica = u; }, unica);
    const prima = await tutte(page);
    await scrivi(page, testo('montagna', 150));
    await expect.poll(() => tutte(page), { timeout: 20000 }).toBeGreaterThan(prima);
    await page.waitForTimeout(9000);
    const dopoCambio = await tutte(page);
    for (let i = 0; i < 3; i++) {
      await aggiungiParola(page);
      await page.waitForTimeout(8500);
    }
    const fine = await tutte(page);
    const a = await attivo(page);
    console.log(caso, 'chiamate prima', prima, 'dopo cambio', dopoCambio, 'fine', fine, 'avvisi', await page.evaluate(() => window.__avvisi), 'titolo', a.title, 'riassunto', a.summary);
    expect.soft(fine - dopoCambio, 'chiamate pagate per tre ritocchi di una parola').toBeLessThanOrEqual(1);
    expect.soft(await page.evaluate(() => window.__avvisi || 0), 'avvisi a video').toBeLessThanOrEqual(1);
  });
}

test('titolo da rifare e risposta tagliata, poi il modello torna a rispondere bene e cambio argomento: il titolo si rifà', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 'giusta');
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await page.evaluate(() => { window.__unica = 'tagliata'; });
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(10000);
  await page.evaluate(() => { window.__unica = 'giusta'; });
  await scrivi(page, testo('citta', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 30000 }).toBe('Titolo Città');
});

test('copia di un documento col titolo automatico, riscritta su un altro argomento: il titolo segue il contenuto', async ({ openTab }) => {
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
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 25000 }).toBe('Riassunto Montagna.');
  await expect(page.locator('#docTitle')).toHaveText(/Titolo Montagna/);
});

test('copia di un documento col titolo scritto a mano: resta col titolo a mano anche riscritta', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await page.click('#docSwitch', { button: 'right' });
  await page.locator('.ed-title-ctxmenu').getByText('Rinomina', { exact: true }).click();
  await page.locator('.ed-doc-title-input').fill('Mio titolo');
  await page.locator('.ed-doc-title-input').press('Enter');
  await expect.poll(async () => (await attivo(page)).title).toBe('Mio titolo');
  await page.click('#docTitle', { button: 'right' });
  await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Duplica file")');
  await expect.poll(async () => (await attivo(page)).title).toBe('Mio titolo (copia)');
  await page.click('#doc');
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(12000);
  expect((await attivo(page)).title).toBe('Mio titolo (copia)');
});

test('copia di un documento ancora senza titolo: prende il suo titolo automatico', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, 'poche parole');
  await page.waitForTimeout(500);
  const t0 = (await attivo(page)).title;
  console.log('titolo iniziale', JSON.stringify(t0));
  await page.click('#docTitle', { button: 'right' });
  await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Duplica file")');
  await page.waitForTimeout(500);
  console.log('titolo copia', JSON.stringify((await attivo(page)).title), JSON.stringify((await attivo(page)).meta));
  await scrivi(page, testo('montagna', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 25000 }).toBe('Titolo Montagna');
});
