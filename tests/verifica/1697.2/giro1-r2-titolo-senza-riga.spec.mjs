// #1697.2 giro 1, rilievo 2: quando il titolo va rifatto e la risposta del modello non porta la riga del titolo,
// il titolo resta quello del vecchio argomento mentre il riassunto parla già del nuovo.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
const KEY = 'filo.editor.collection';

async function stubAI(page) {
  await page.evaluate(() => {
    window.__unica = 'giusta';
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
        if (msg.action === 'editor_title') r = { ok: true, text: `Titolo ${tema}` };
        else if (insieme && window.__unica === 'senzaEtichette') r = { ok: true, text: `Riassunto ${tema}.` };
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

test('r2 titolo da rifare e risposta senza la riga del titolo: il titolo segue comunque il nuovo argomento', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await expect.poll(async () => (await attivo(page)).title, { timeout: 20000 }).toBe('Titolo Mare');
  await page.evaluate(() => { window.__unica = 'senzaEtichette'; });
  await scrivi(page, testo('montagna', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 25000 }).toBe('Riassunto Montagna.');
  await expect.poll(async () => (await attivo(page)).title, { timeout: 15000 }).toBe('Titolo Montagna');
  await expect(page.locator('#docTitle')).toHaveText(/Titolo Montagna/);
});
