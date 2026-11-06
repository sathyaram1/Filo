// Il precarico dei link (#1985): al passaggio del mouse (livello 1) e a rete ferma i link a schermo (livello 2).
// Un sito finto conta le richieste: chi ha l'intestazione Sec-Purpose: prefetch è un precarico.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const ALTRO = 'altro-sito.test';
test.use({ hostInPiu: [ALTRO] });

// `lente`: indirizzi che rispondono dopo tanto, per vedere un precarico ancora in corso. `scarico`: un file che scende
// piano finché la prova non lo finisce.
async function sitoCheConta({ lente = [], csp = '' } = {}) {
  const richieste = [];
  let finisciScarico = null;
  const server = createServer((req, res) => {
    const r = { url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || ''), chiusaPrima: false };
    richieste.push(r);
    const html = (body, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...(csp ? { 'Content-Security-Policy': csp } : {}), ...extra });
      res.end(`<!doctype html><meta charset="utf-8"><title>${req.url}</title><body style="margin:0">${body}</body>`);
    };
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/scarico.bin') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="scarico.bin"', 'Content-Length': 2048 });
      res.write(Buffer.alloc(1024));
      finisciScarico = () => res.end(Buffer.alloc(1024));
      return;
    }
    if (req.url.startsWith('/indice')) {
      const porta = server.address().port;
      // In cima i link che non si precaricano mai, poi trenta link dello stesso sito alti 18 px: ne stanno a schermo
      // più del tetto.
      const esclusi = [
        '<a id="q" href="/p/cerca?x=1">query</a>',
        '<a id="logout" href="/account/logout">esci</a>',
        `<a id="altro" href="http://${ALTRO}:${porta}/p/fuori">altro sito</a>`,
        '<a id="mail" href="mailto:qualcuno@example.com">mail</a>',
        '<a id="ancora" href="#sotto">ancora</a>',
        '<a id="nofollow" rel="nofollow" href="/p/nofollow">nofollow</a>',
        '<a id="dl" download href="/p/scarica">scarica</a>',
        '<a id="js" href="javascript:void 0">js</a>',
      ].join(' ');
      const links = Array.from({ length: 30 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/p/${i}">link ${i}</a>`).join('');
      html(`<div style="height:20px">${esclusi}</div>${links}<div style="height:3000px"></div><a id="giu" href="/p/giu">in fondo</a>`);
      return;
    }
    const lenta = lente.includes(req.url);
    res.on('close', () => { if (!res.writableEnded) r.chiusaPrima = true; });
    setTimeout(() => { if (!res.destroyed) html(`<h1 id="arrivato">${req.url}</h1>`); }, lenta ? 15_000 : 0);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    richieste,
    precarichi: () => richieste.filter((r) => r.prefetch).map((r) => r.url),
    finisciScarico: () => finisciScarico && finisciScarico(),
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

async function precaricoVisibili(app, acceso) {
  await app.evaluate(async (_e, v) => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: v } }); }, acceso);
}

const LINK_ESCLUSI = ['/p/cerca?x=1', '/account/logout', '/p/fuori', '/p/nofollow', '/p/scarica', '/indice'];

test('il mouse fermo su un link lo precarica, e il clic usa quel precarico senza chiederlo di nuovo', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    // Spento il livello dei link a schermo, a pagina ferma non parte niente.
    await page.waitForTimeout(2500);
    expect(sito.precarichi()).toEqual([]);

    await page.hover('#l3');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/3']);
    await page.click('#l3');
    await expect(page.locator('#arrivato')).toHaveText('/p/3');
    expect(sito.richieste.filter((r) => r.url === '/p/3').length).toBe(1);
  } finally { await sito.chiudi(); }
});

test('un passaggio di traverso non precarica, la pressione sì anche senza fermarsi', async ({ app, openTab }) => {
  const sito = await sitoCheConta();
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    // Il mouse attraversa dieci link senza fermarsi: nessuno parte.
    const box = await page.locator('#l0').boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + 5, box.y + 18 * 10, { steps: 10 });
    await page.mouse.move(box.x + 5, box.y + 18 * 33);
    await page.waitForTimeout(800);
    expect(sito.precarichi()).toEqual([]);

    // Il link escluso non parte nemmeno premuto.
    await page.dispatchEvent('#logout', 'pointerdown', { button: 0, pointerType: 'mouse' });
    await page.dispatchEvent('#l7', 'pointerdown', { button: 0, pointerType: 'mouse' });
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/7']);
  } finally { await sito.chiudi(); }
});

test('a rete ferma partono i link a schermo dello stesso sito, fino al tetto, mai quelli esclusi', async ({ openTab }) => {
  const sito = await sitoCheConta();
  try {
    const page = await openTab(`${sito.origin}/indice`);
    await expect.poll(() => sito.precarichi().length, { timeout: 30_000, intervals: [500] }).toBe(20);
    await page.waitForTimeout(2500);
    const fatti = sito.precarichi();
    expect(fatti.length).toBe(20);
    // Dal primo in alto, in ordine.
    expect(fatti).toEqual(Array.from({ length: 20 }, (_, i) => `/p/${i}`));
    for (const u of LINK_ESCLUSI) expect(fatti).not.toContain(u);
    // Il link in fondo alla pagina non è a schermo.
    expect(fatti).not.toContain('/p/giu');
    expect(sito.richieste.filter((r) => r.url === '/p/fuori').length).toBe(0);

    // Oltre il tetto il link resta al passaggio del mouse.
    await page.hover('#l25');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toContain('/p/25');
  } finally { await sito.chiudi(); }
});

test('con uno scaricamento in corso i link a schermo aspettano, e partono quando finisce', async ({ openTab }) => {
  const sito = await sitoCheConta();
  try {
    const prima = await openTab(`${sito.origin}/indice?scarico`);
    await prima.evaluate(() => { const a = document.createElement('a'); a.href = '/scarico.bin'; document.body.append(a); a.click(); });
    await expect.poll(() => sito.richieste.some((r) => r.url === '/scarico.bin'), { timeout: 5000 }).toBe(true);
    // La pagina dello scaricamento ha avuto il tempo di precaricare qualcosa prima del clic: si conta da qui.
    const giaFatti = sito.precarichi().length;
    const page = await openTab(`${sito.origin}/indice?dopo`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(4000);
    expect(sito.precarichi().length).toBe(giaFatti);

    sito.finisciScarico();
    await expect.poll(() => sito.precarichi().length, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(giaFatti);
  } finally { await sito.chiudi(); }
});

test('il clic su un altro link ferma i precarichi ancora in corso', async ({ app, openTab }) => {
  const sito = await sitoCheConta({ lente: ['/p/2', '/p/4'] });
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l2');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/2']);
    await page.hover('#l4');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/2', '/p/4']);
    await page.click('#l9');
    await expect(page.locator('#arrivato')).toHaveText('/p/9');
    await expect.poll(() => sito.richieste.filter((r) => r.prefetch && r.chiusaPrima).map((r) => r.url).sort(), { timeout: 5000 })
      .toEqual(['/p/2', '/p/4']);
  } finally { await sito.chiudi(); }
});

test('su una pagina che stringe gli script (CSP) il precarico al passaggio funziona lo stesso', async ({ app, openTab }) => {
  const sito = await sitoCheConta({ csp: "script-src 'none'" });
  try {
    await precaricoVisibili(app, false);
    const page = await openTab(`${sito.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l5');
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toEqual(['/p/5']);
  } finally { await sito.chiudi(); }
});
