// Esplorazione giro 2 #1697: titolo automatico in casi insoliti. Solo log.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(180_000);
const KEY = 'filo.editor.collection';

async function stubAI(page, ritardo = 0, modo = 'giusto') {
  await page.evaluate(({ ritardo, modo }) => {
    window.__chiamate = [];
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        const ms = (msg.payload && msg.payload.messages) || [];
        const sys = String((ms[0] && ms[0].content) || '');
        const u = ms.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
        const tema = /montagna/.test(u) ? 'Montagna' : /cucina/.test(u) ? 'Cucina' : /mare/.test(u) ? 'Mare' : 'Ignoto';
        window.__chiamate.push({ action: msg.action, tema, unico: /TITOLO:/.test(sys) });
        let text;
        if (msg.action === 'editor_title') text = `Titolo ${tema}`;
        else if (/TITOLO:/.test(sys)) text = modo === 'senzaEtichette' ? `Riassunto ${tema}.` : `TITOLO: Titolo ${tema}\nRIASSUNTO: Riassunto ${tema}.`;
        else text = `Riassunto ${tema}.`;
        r = { ok: true, text };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        const p = new Promise((res) => setTimeout(() => res(r), ritardo));
        if (typeof cb === 'function') { p.then(cb); return undefined; }
        return p;
      }
      return orig(msg, cb);
    };
  }, { ritardo, modo });
}

const parole = { mare: ['il', 'mare', 'onde', 'spiaggia', 'sabbia', 'barca'], montagna: ['la', 'montagna', 'neve', 'vetta', 'sentiero', 'rifugio'], cucina: ['la', 'cucina', 'pentola', 'sugo', 'forno', 'ricetta'] };
const testo = (tema, n) => Array.from({ length: n }, (_, i) => parole[tema][i % 6]).join(' ');

async function scrivi(page, t) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + t + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
}
const tutti = (page) => page.evaluate((k) => {
  const c = JSON.parse(localStorage.getItem(k));
  return c.files.map((f) => ({ id: f.id, attivo: f.id === c.activeId, title: f.meta.title, summary: f.meta.summary || null, manual: !!f.meta.titleManual }));
}, KEY);
const attivo = async (page) => (await tutti(page)).find((f) => f.attivo);
function log(...a) { console.log('[ESPLORA]', ...a); }

test('T1 cambio documento mentre titolo e riassunto di A sono in volo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 0);
  await scrivi(page, testo('cucina', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Cucina.');
  const idB = (await attivo(page)).id;
  await page.click('#docSwitch');
  await page.click('#docNew');
  await stubAI(page, 4000);
  await scrivi(page, testo('mare', 150));
  // il primo titolo parte subito; il riassunto dopo 7 s: si torna a B appena parte il titolo
  await page.waitForTimeout(500);
  await page.click('#docSwitch');
  await page.click(`.ed-doc-item[data-id="${idB}"]`);
  await page.waitForTimeout(12000);
  log('T1 documenti', JSON.stringify(await tutti(page)));
  log('T1 chiamate', JSON.stringify(await page.evaluate(() => window.__chiamate)));
});

test('T2 copia di un documento col titolo automatico, riscritta su un altro argomento', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 0);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  log('T2 originale', JSON.stringify(await attivo(page)));
  await page.click('#docTitle', { button: 'right' });
  await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Duplica file")');
  await page.waitForTimeout(300);
  log('T2 copia', JSON.stringify(await attivo(page)));
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(12000);
  log('T2 copia dopo riscrittura', JSON.stringify(await attivo(page)));
});

test('T3 risposta senza etichette: quante chiamate a ogni pausa', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 0, 'senzaEtichette');
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 20000 }).toBe('Titolo Mare');
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(9000);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const d = document.getElementById('doc'); d.querySelector('p').append(' x'); d.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(8000);
  }
  log('T3 stato', JSON.stringify(await attivo(page)));
  log('T3 chiamate', JSON.stringify(await page.evaluate(() => window.__chiamate)));
});

test('T4 testo riscritto corto su altro argomento', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 0);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await scrivi(page, testo('montagna', 70));
  await page.waitForTimeout(10000);
  log('T4 70 parole', JSON.stringify(await attivo(page)));
  await scrivi(page, testo('montagna', 40));
  await page.waitForTimeout(10000);
  log('T4 40 parole', JSON.stringify(await attivo(page)));
});

test('T5 elimina il documento mentre il titolo è in volo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  const errori = [];
  page.on('pageerror', (e) => errori.push(e.message));
  await stubAI(page, 0);
  await scrivi(page, testo('cucina', 20));
  await page.click('#docSwitch');
  await page.click('#docNew');
  await stubAI(page, 3000);
  await scrivi(page, testo('mare', 150));
  await page.waitForTimeout(300);
  await page.click('#docTitle', { button: 'right' });
  await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Elimina file")');
  await page.waitForTimeout(10000);
  log('T5 documenti', JSON.stringify(await tutti(page)), 'errori', JSON.stringify(errori));
});
