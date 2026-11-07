// #1697.2 giro 2, rilievo 2: una risposta vuota del modello al riassunto non frena i tentativi: ogni pausa di sette
// secondi, anche dopo una parola cambiata, rifà una chiamata pagata sullo stesso testo.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(180_000);
const KEY = 'filo.editor.collection';

async function stubAI(page) {
  await page.evaluate(() => {
    window.__modo = 'giusta';
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
        window.__chiamate.push(`${msg.action}:${tema}:${window.__modo}`);
        if (window.__modo === 'vuota') r = { ok: true, text: '' };
        else if (msg.action === 'editor_title') r = { ok: true, text: `Titolo ${tema}` };
        else if (/TITOLO:/.test(sys)) r = { ok: true, text: `TITOLO: Titolo ${tema}\nRIASSUNTO: Riassunto ${tema}.` };
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
  });
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
const attivo = (page) => page.evaluate((k) => {
  const c = JSON.parse(localStorage.getItem(k));
  const f = c.files.find((x) => x.id === c.activeId);
  return { title: f.meta.title, summary: f.meta.summary || null };
}, KEY);

test('r2 risposta vuota dopo un cambio di argomento: tre ritocchi di una parola non rifanno la chiamata', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 25000 }).toBe('Riassunto Mare.');
  await expect.poll(async () => (await attivo(page)).title, { timeout: 25000 }).toBe('Titolo Mare');
  const prima = await page.evaluate(() => window.__chiamate.length);
  await page.evaluate(() => { window.__modo = 'vuota'; });
  const t = testo('montagna', 150);
  await scrivi(page, t);
  await page.waitForTimeout(9000);
  for (let i = 0; i < 3; i++) {
    await scrivi(page, t.replace(/neve/, `neve${i}`));
    await page.waitForTimeout(9000);
  }
  const dopo = await page.evaluate((n) => window.__chiamate.slice(n), prima);
  expect(dopo.length, dopo.join(', ')).toBeLessThanOrEqual(2);
});
