// esplorazione #1697.2 giro 3: titolo da rifare con risposta guasta, e copia di un documento col titolo automatico.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);
const KEY = 'filo.editor.collection';

async function stubAI(page) {
  await page.evaluate(() => {
    window.__modo = 'giusta';
    window.__chiamate = [];
    window.__avvisi = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        const t = (n.textContent || '');
        if (/Non sono riuscito/.test(t)) window.__avvisi.push(t.slice(0, 120));
      }
    }).observe(document.body, { childList: true, subtree: true });
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
        window.__chiamate.push(`${msg.action}${insieme ? '+titolo' : ''}:${tema}:${window.__modo}`);
        const modo = window.__modo;
        if (modo === 'tagliata') r = { ok: false, code: 'RISPOSTA_TAGLIATA', finishReason: 'length', error: 'risposta tagliata' };
        else if (modo === 'vuota') r = { ok: true, text: '' };
        else if (msg.action === 'editor_title') r = { ok: true, text: modo === 'senzaTitoloMai' ? '' : `Titolo ${tema}` };
        else if (insieme && /senzaTitolo/.test(modo)) r = { ok: true, text: `Riassunto ${tema}.` };
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
  return { n: c.files.length, title: f.meta.title, summary: f.meta.summary || null, meta: JSON.stringify(f.meta).slice(0, 400) };
}, KEY);
const conti = (page) => page.evaluate(() => ({ chiamate: window.__chiamate.slice(), avvisi: window.__avvisi.slice() }));

async function base(page) {
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 150));
  await expect.poll(async () => (await attivo(page)).summary, { timeout: 25000 }).toBe('Riassunto Mare.');
  await expect.poll(async () => (await attivo(page)).title, { timeout: 25000 }).toBe('Titolo Mare');
}

for (const modo of ['tagliata', 'senzaTitolo', 'senzaTitoloMai', 'vuota']) {
  test(`ritocchi dopo cambio argomento, risposta ${modo}`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await base(page);
    const prima = (await conti(page)).chiamate.length;
    await page.evaluate((m) => { window.__modo = m; }, modo);
    const t = testo('montagna', 150);
    await scrivi(page, t);
    await page.waitForTimeout(9000);
    for (let i = 0; i < 3; i++) {
      await scrivi(page, t.replace(/neve/, `neve${i}`).replace(/vetta/, i % 2 ? 'cima' : 'vetta'));
      await page.waitForTimeout(9000);
    }
    const c = await conti(page);
    console.log(modo, 'chiamate dopo cambio', c.chiamate.slice(prima), 'avvisi', c.avvisi, JSON.stringify(await attivo(page)));
  });
}

test('copia di un documento col titolo automatico riscritta su altro argomento', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await base(page);
  await page.click('#docTitle', { button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Duplica file' }).click();
  console.log('copia', JSON.stringify(await attivo(page)));
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(12000);
  console.log('copia riscritta', JSON.stringify(await attivo(page)), (await conti(page)).chiamate);
});

test('copia di un documento corto senza titolo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await stubAI(page);
  await scrivi(page, testo('mare', 30));
  await page.waitForTimeout(1500);
  await page.click('#docTitle', { button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Duplica file' }).click();
  console.log('copia corta', JSON.stringify(await attivo(page)));
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(12000);
  console.log('copia corta riscritta', JSON.stringify(await attivo(page)), (await conti(page)).chiamate);
});

test('copia di un documento col titolo a mano', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await base(page);
  await page.click('#docTitle', { button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type('Le mie vacanze');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.click('#docTitle', { button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Duplica file' }).click();
  console.log('copia a mano', JSON.stringify(await attivo(page)));
  await scrivi(page, testo('montagna', 150));
  await page.waitForTimeout(12000);
  console.log('copia a mano riscritta', JSON.stringify(await attivo(page)));
});
