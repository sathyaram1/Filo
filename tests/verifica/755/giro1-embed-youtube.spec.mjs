// Verifica #755 giro 1: gli embed YouTube escono verso youtube-nocookie prima di partire, in ogni forma della segnalazione.
// Il registro sta su eventi di rete che Filo non usa (redirect, completata, errore): vede cosa è uscito davvero.

import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function registra(app) {
  await app.evaluate(({ app: a, session }) => {
    globalThis.__reg755 = { usciti: [], deviati: [] };
    const aggancia = (ses) => {
      if (!ses || ses.__reg755) return;
      ses.__reg755 = true;
      const r = ses.webRequest;
      const fine = (d) => { if (d.resourceType === 'subFrame') globalThis.__reg755.usciti.push(d.url); };
      r.onBeforeRedirect((d) => { if (d.resourceType === 'subFrame') globalThis.__reg755.deviati.push([d.url, d.redirectURL]); });
      r.onCompleted(fine);
      r.onErrorOccurred(fine);
    };
    aggancia(session.defaultSession);
    a.on('session-created', aggancia);
  });
}

const leggi = (app) => app.evaluate(() => globalThis.__reg755);

function pagina(testServer) {
  const dentro = testServer.html(`<title>DENTRO</title><iframe src="https://youtube.com/embed/CCC333?start=7&rel=0" allowfullscreen></iframe>`);
  return testServer.html(`<title>EMBED</title>
    <iframe id="a" src="https://www.youtube.com/embed/AAA111?start=30&rel=0#x" allowfullscreen></iframe>
    <div style="height:3000px"></div>
    <iframe id="b" data-src="https://www.youtube.com/embed/BBB222?start=5&autoplay=0" allowfullscreen></iframe>
    <iframe id="c" src="${dentro}"></iframe>
    <script>
      addEventListener('scroll', () => {
        const f = document.getElementById('b');
        if (!f.getAttribute('src') && scrollY > 1000) f.setAttribute('src', f.getAttribute('data-src'));
      });
    </script>`);
}

const embedYT = (u) => /^https?:\/\/(www\.|m\.)?youtube\.com\/embed/i.test(u);
const nocookie = (u) => /^https:\/\/www\.youtube-nocookie\.com\/embed\//i.test(u);

test('Automatico: i tre embed (diretto, pigro, annidato) escono solo verso nocookie, query intatta, una volta sola', async ({ app, openTab, testServer }) => {
  await registra(app);
  const url = pagina(testServer);
  const page = await openTab(url);
  await page.waitForLoadState('load').catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 2500));
  await expect.poll(async () => (await leggi(app)).usciti.filter(nocookie).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await sleep(2500);
  const reg = await leggi(app);
  expect(reg.usciti.filter(embedYT)).toEqual([]);
  const nc = reg.usciti.filter(nocookie).map((u) => u.replace(/#.*/, ''));
  expect(nc.sort()).toEqual([
    'https://www.youtube-nocookie.com/embed/AAA111?start=30&rel=0',
    'https://www.youtube-nocookie.com/embed/BBB222?start=5&autoplay=0',
    'https://www.youtube-nocookie.com/embed/CCC333?start=7&rel=0',
  ]);
  // La pagina non riscrive sopra la rete: gli attributi restano quelli del sito (nessun secondo caricamento).
  expect(await page.evaluate(() => document.getElementById('a').getAttribute('src'))).toContain('www.youtube.com');
  expect(await page.evaluate(() => document.getElementById('a').hasAttribute('allowfullscreen'))).toBe(true);
});

test('Manuale: nessuna riscrittura, gli embed escono verso youtube.com', async ({ app, openTab, testServer }) => {
  await setMode(openTab, 'manual');
  await registra(app);
  const url = pagina(testServer);
  const page = await openTab(url);
  await page.waitForLoadState('load').catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 2500));
  await expect.poll(async () => (await leggi(app)).usciti.filter(embedYT).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await sleep(1500);
  const reg = await leggi(app);
  expect(reg.usciti.filter(nocookie)).toEqual([]);
  expect(reg.deviati).toEqual([]);
});

test('Privacy: anche il jar del sito devia gli embed', async ({ app, openTab, testServer }) => {
  await setMode(openTab, 'privacy');
  await registra(app);
  const url = pagina(testServer);
  const page = await openTab(url);
  await page.waitForLoadState('load').catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 2500));
  await expect.poll(async () => (await leggi(app)).usciti.filter(nocookie).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await sleep(1500);
  const reg = await leggi(app);
  expect(reg.usciti.filter(embedYT)).toEqual([]);
});

test('Ritorno da Manuale ad Automatico: la deviazione riparte senza riavvio', async ({ app, openTab, testServer }) => {
  await setMode(openTab, 'manual');
  await setMode(openTab, 'default');
  await registra(app);
  const page = await openTab(pagina(testServer));
  await page.waitForLoadState('load').catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 2500));
  await expect.poll(async () => (await leggi(app)).usciti.filter(nocookie).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await sleep(1500);
  expect((await leggi(app)).usciti.filter(embedYT)).toEqual([]);
});
