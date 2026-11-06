// #1697 giro 1. r2: il titolo automatico non segue un testo riscritto su un altro argomento con lunghezza simile.
// r3: un documento nuovo che arriva a 100 parole mentre il titolo di un altro è in volo resta senza titolo.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
const KEY = 'filo.editor.collection';

// Il modello finto risponde secondo il testo che riceve.
async function stubAI(page, ritardo = 0) {
  await page.evaluate((ritardo) => {
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        const ms = (msg.payload && msg.payload.messages) || [];
        const sys = String((ms[0] && ms[0].content) || '');
        const u = ms.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
        const tema = /montagna/.test(u) ? 'Montagna' : /cucina/.test(u) ? 'Cucina' : /mare/.test(u) ? 'Mare' : 'Ignoto';
        let text;
        if (msg.action === 'editor_title') text = `Titolo ${tema}`;
        else if (/TITOLO:/.test(sys)) text = `TITOLO: Titolo ${tema}\nRIASSUNTO: Riassunto ${tema}.`;
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
  }, ritardo);
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
const attivo = (page) => page.evaluate((k) => {
  const c = JSON.parse(localStorage.getItem(k));
  const f = c.files.find((x) => x.id === c.activeId);
  return { title: f.meta.title, summary: f.meta.summary || null };
}, KEY);

test('r2 riscritto su un altro argomento con la stessa lunghezza: il titolo automatico cambia', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 15000 }).toBe('Titolo Mare');
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await scrivi(page, testo('montagna', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 25000 }).toBe('Titolo Montagna');
});

test('r3 documento nuovo che arriva a 100 parole mentre il titolo di un altro è in volo: prende il suo titolo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 2500);
  await scrivi(page, testo('mare', 300));
  await page.click('#docSwitch');
  await page.click('#docNew');
  await scrivi(page, testo('cucina', 120));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 25000 }).toBe('Riassunto Cucina.');
  await expect.poll(async () => (await attivo(page)).title, { timeout: 10000 }).toBe('Titolo Cucina');
});
