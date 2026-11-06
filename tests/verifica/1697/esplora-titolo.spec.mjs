// Esplorazione (si cancella): titolo automatico che segue il contenuto, titolo a mano, documenti che non si mescolano.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
const KEY = 'filo.editor.collection';

async function stubAI(page, ritardo = 0) {
  await page.evaluate((ritardo) => {
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__aiCalls = [];
    window.__ritardo = ritardo;
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        const ms = (msg.payload && msg.payload.messages) || [];
        const sys = String((ms[0] && ms[0].content) || '');
        const u = ms.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
        const topic = /montagna/.test(u) ? 'Montagna' : /cucina/.test(u) ? 'Cucina' : /mare/.test(u) ? 'Mare' : 'Ignoto';
        window.__aiCalls.push({ action: msg.action, topic, combinato: /TITOLO:/.test(sys), mare: /mare/.test(u), cucina: /cucina/.test(u) });
        let text;
        if (msg.action === 'editor_title') text = `Titolo ${topic}`;
        else if (/TITOLO:/.test(sys)) text = `TITOLO: Titolo ${topic}\nRIASSUNTO: Riassunto ${topic}.`;
        else text = `Riassunto ${topic}.`;
        r = { ok: true, text };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        const p = new Promise((res) => setTimeout(() => res(r), window.__ritardo));
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
const files = (page) => page.evaluate((k) => {
  const c = JSON.parse(localStorage.getItem(k));
  return c.files.map((f) => ({ id: f.id, title: f.meta.title, summary: f.meta.summary || null, attivo: f.id === c.activeId, txt: JSON.stringify(f.content || '').slice(0, 40) }));
}, KEY);
const attivo = async (page) => (await files(page)).find((f) => f.attivo);

test('T1 cambio di argomento con lunghezza molto diversa', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 120));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 15000 }).toBe('Titolo Mare');
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  const n0 = await page.evaluate(() => window.__aiCalls.length);
  await scrivi(page, testo('montagna', 260));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Montagna.');
  console.log('T1', JSON.stringify(await attivo(page)), JSON.stringify(await page.evaluate((n) => window.__aiCalls.slice(n), n0)));
  await expect(page.locator('#docTitle')).toHaveText('Titolo Montagna');
});

test('T1b cambio di argomento con la stessa lunghezza', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 15000 }).toBe('Titolo Mare');
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Mare.');
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(11000);
  console.log('T1b', JSON.stringify(await attivo(page)), JSON.stringify(await page.evaluate(() => window.__aiCalls)));
});

test('T2 titolo scritto a mano non cambia', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 120));
  await expect.poll(async () => (await attivo(page)).title, { timeout: 15000 }).toBe('Titolo Mare');
  await page.click('#docSwitch');
  await page.click('#docPop .ed-doc-item.active .ed-doc-rename');
  const inp = page.locator('#docPop .ed-doc-item-input');
  await inp.fill('Mio titolo');
  await inp.press('Enter');
  await expect(page.locator('#docTitle')).toHaveText('Mio titolo');
  await page.keyboard.press('Escape');
  await scrivi(page, testo('montagna', 300));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 20000 }).toBe('Riassunto Montagna.');
  await expect(page.locator('#docTitle')).toHaveText('Mio titolo');
  console.log('T2', JSON.stringify(await files(page)));
});

test('T3 documento nuovo mentre il titolo dell altro è in volo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 2500);
  await scrivi(page, testo('mare', 300));
  await page.waitForTimeout(300);
  await page.click('#docSwitch');
  await page.click('#docNew');
  await scrivi(page, testo('cucina', 120));
  await page.waitForTimeout(16000);
  const f = await files(page);
  console.log('T3', JSON.stringify(f), JSON.stringify(await page.evaluate(() => window.__aiCalls)));
  const b = f.find((x) => x.attivo);
  expect(b.title).toBe('Titolo Cucina');
  const a = f.find((x) => !x.attivo);
  expect(a.title).not.toContain('Cucina');
});

test('T4 cambio di documento a riassunto in attesa', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page, 0);
  await scrivi(page, testo('cucina', 30));
  await page.click('#docSwitch');
  await page.click('#docNew');
  await scrivi(page, testo('mare', 300));
  await page.waitForTimeout(1500);
  await page.click('#docSwitch');
  await page.locator('#docPop .ed-doc-item').filter({ hasNotText: 'Mare' }).first().click();
  await page.waitForTimeout(500);
  await scrivi(page, testo('cucina', 90));
  await page.waitForTimeout(12000);
  const f = await files(page);
  console.log('T4', JSON.stringify(f), JSON.stringify(await page.evaluate(() => window.__aiCalls)));
});
