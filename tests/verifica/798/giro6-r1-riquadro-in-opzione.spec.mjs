// Verifica #798 giro 6. r1: un riquadro vuoto che entra nella pagina dentro un'opzione, assegnata all'elenco delle
// opzioni di un menu a tendina (o al menu per indice), si legge per indice nella stessa riga senza rumore.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const PAGINA = '<!doctype html><meta charset="utf-8"><title>opzioni</title><body><p>ok</p></body>';

function porte() {
  const fnv = (s) => { let a = 2166136261; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); };
  const c = document.createElement('canvas'); c.width = 80; c.height = 40;
  const x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40); x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
  const leggi = (W) => { try { return fnv(W.HTMLCanvasElement.prototype.toDataURL.call(c)); } catch (e) { return 'errore ' + e.message; } };
  const ultimo = () => window[window.length - 1];
  const opzione = () => { const o = document.createElement('option'); o.appendChild(document.createElement('iframe')); return o; };
  const out = { pagina: fnv(c.toDataURL()) };
  { const s = document.createElement('select'); document.body.appendChild(s); s.options[0] = opzione(); out.elencoOpzioni = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); s[0] = opzione(); out.menuPerIndice = leggi(ultimo()); }
  { const s = document.createElement('select'); document.body.appendChild(s); s.appendChild(document.createElement('option')); s.options[0] = opzione(); out.opzioneSostituita = leggi(ultimo()); }
  return out;
}

test('r1 un riquadro entrato con l\'elenco delle opzioni di un menu, letto per indice subito, ha il rumore della pagina', async ({ openTab }) => {
  test.setTimeout(90_000);
  const srv = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const page = await openTab(url);
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const on = await page.evaluate(porte);
    await setFpMode(openTab, 'off');
    await page.goto(url + '?off');
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
    const off = await page.evaluate(porte);
    expect(on.pagina).not.toBe(off.pagina);
    for (const k of ['elencoOpzioni', 'menuPerIndice', 'opzioneSostituita']) {
      expect.soft(off[k], `${k}: in Off come la pagina`).toBe(off.pagina);
      expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
    }
  } finally { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); }
});
