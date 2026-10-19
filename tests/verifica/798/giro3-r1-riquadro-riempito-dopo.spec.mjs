// Verifica #798 giro 3, r1: un riquadro che cambia documento (riempito dopo l'inserimento con srcdoc o un indirizzo
// della stessa origine, passato a una seconda pagina, tornato vuoto) perde il rumore: le letture dal suo documento,
// dall'elemento e per indice coincidono con Off invece che con la pagina.
import { test, expect } from '../../fixtures/electron.mjs';

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

const IMPRONTA = `
  function fnv(s) { var a = 2166136261; for (var i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; return a.toString(16); }
  function impronta(doc) {
    var c = doc.createElement('canvas'); c.width = 80; c.height = 40;
    var x = c.getContext('2d'); x.fillStyle = '#1e90ff'; x.fillRect(0, 0, 80, 40);
    x.fillStyle = '#000'; x.font = '16px sans-serif'; x.fillText('filo', 4, 24);
    return fnv(c.toDataURL());
  }`;
const INTERNO = `<!doctype html><meta charset="utf-8"><body><script>${IMPRONTA}
  parent.postMessage({ chi: location.hash.slice(1) || 'srcdoc', valore: impronta(document) }, '*');</script></body>`;
const PAGINA = `<!doctype html><meta charset="utf-8"><body><iframe id="pigro"></iframe><script>${IMPRONTA}</script></body>`;

async function letture(interno) {
  /* global impronta */
  const dalDocumento = {};
  window.addEventListener('message', (e) => { if (e.data && e.data.chi) dalDocumento[e.data.chi] = e.data.valore; });
  const carico = (f) => new Promise((r) => { f.addEventListener('load', r, { once: true }); setTimeout(r, 4000); });
  const daFuori = (W) => { try { return impronta(W.document); } catch (e) { return 'errore ' + e.message; } };
  const out = { pagina: impronta(document) };
  const casi = {
    srcDopoAppend: (f) => { f.src = interno + '#srcDopoAppend'; },
    srcdocDopoAppend: (f) => { f.srcdoc = INTERNO_SRCDOC; },
  };
  /* global INTERNO_SRCDOC */
  for (const [nome, riempi] of Object.entries(casi)) {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const i = window.length - 1;
    riempi(f);
    await carico(f);
    await new Promise((r) => setTimeout(r, 300));
    out[nome + ':elemento'] = daFuori(f.contentWindow);
    out[nome + ':indice'] = daFuori(window[i]);
  }
  const p = document.getElementById('pigro');
  p.src = interno + '#pigro';
  await carico(p);
  await new Promise((r) => setTimeout(r, 300));
  out['pigro:elemento'] = daFuori(p.contentWindow);
  // Un riquadro della stessa origine che passa a una seconda pagina, o torna vuoto.
  const n = document.createElement('iframe');
  n.src = interno + '#primaPagina';
  document.body.appendChild(n);
  const j = window.length - 1;
  await carico(n);
  n.src = interno + '?seconda#secondaPagina';
  await carico(n);
  await new Promise((r) => setTimeout(r, 300));
  out['primaPagina:documento'] = dalDocumento.primaPagina;
  out['secondaPagina:documento'] = dalDocumento.secondaPagina;
  out['secondaPagina:elemento'] = daFuori(n.contentWindow);
  n.src = 'about:blank';
  await carico(n);
  out['tornatoVuoto:indice'] = daFuori(window[j]);
  out['tornatoVuoto:elemento'] = daFuori(n.contentWindow);
  out['srcDopoAppend:documento'] = dalDocumento.srcDopoAppend;
  out['srcdocDopoAppend:documento'] = dalDocumento.srcdoc;
  out['pigro:documento'] = dalDocumento.pigro;
  return out;
}

async function leggi(openTab, testServer) {
  const interno = testServer.html(INTERNO);
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10_000 });
  await page.evaluate((s) => { window.INTERNO_SRCDOC = s; }, INTERNO);
  return page.evaluate(letture, interno);
}

test('r1 un riquadro inserito vuoto e riempito dopo con un documento della pagina ha il rumore della pagina', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const on = await leggi(openTab, testServer);
  await setFpMode(openTab, 'off');
  const off = await leggi(openTab, testServer);
  expect(on.pagina).not.toBe(off.pagina);
  for (const k of Object.keys(on)) {
    if (k === 'pagina') continue;
    expect.soft(off[k], `${k}: con Off la lettura riesce`).toBe(off.pagina);
    expect.soft(on[k], `${k}: col rumore della pagina`).toBe(on.pagina);
  }
});
