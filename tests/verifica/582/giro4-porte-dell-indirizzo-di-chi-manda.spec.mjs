// Verifica #582, giro 4 — la causa dei giri 1-3, contata su TUTTE le superfici.
//
// La causa: dentro una segnalazione ci sono indirizzi che non li sceglie Filo.
// Li scrive chi manda, e una segnalazione la manda chiunque, anche senza
// account e senza avere Filo installato. Il giro 1 ha chiuso la credenziale
// dell'owner spedita a un deposito altrui; il giro 2 la pillola dell'allegato
// che diventava un collegamento; il giro 3 l'indirizzo della pagina, che si
// leggeva tagliato e portava altrove.
//
// Qui si conta di nuovo, tutto insieme e su tutte e due le superfici che
// mostrano una segnalazione a un essere umano (il riquadro dei feedback e la
// Gestione dell'owner): nessun elemento su cui si clicca può portare in un
// posto che la scritta non nomina.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const RIQUADRO = 'filo://feedback/feedback.html';
const GESTIONE = 'filo://manage/manage.html';
const ESTRANEO = 'sito-di-un-estraneo.invalid';

// Una segnalazione costruita per mentire in ogni campo che porta un indirizzo.
const ESCA = {
  _id: 'esca-giro4-582',
  seq: 9582,
  subSeq: 0,
  number: 9582,
  status: 'open',
  name: 'Aggiornamento obbligatorio per i tester',
  text: `La pagina non si apre. Vedi https://filo.app.${ESTRANEO}/accedi`,
  url: `https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.${ESTRANEO}/accedi`,
  clientId: 'tester@example.com',
  createdAt: '2026-09-11T10:00:00Z',
  images: [`https://${ESTRANEO}/schermata.png`],
  files: [
    { name: 'schermata.png', url: `https://${ESTRANEO}/esca.html`, type: 'text/html' },
    { name: 'log.txt', url: `https://storage.googleapis.com/deposito-di-un-estraneo/x.txt`, type: 'text/plain' },
  ],
};

// Ogni collegamento della pagina che porta fuori: la scritta deve nominare il
// posto vero. `href="#"` non porta da nessuna parte e non entra nel conto.
async function collegamentiCheMentono(page) {
  return page.evaluate(() => {
    const bugie = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!/^https?:/i.test(href)) continue;
      let host = '';
      try { host = new URL(href).host; } catch (_) { host = href; }
      const scritta = (a.textContent || '').trim();
      if (!scritta.includes(host)) bugie.push({ href, host, scritta });
    }
    return bugie;
  });
}

test('riquadro dei feedback: nessun collegamento porta dove la scritta non dice', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate((fb) => {
    window.SN_FEEDBACK.list = async () => [fb];
  }, ESCA);
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/582-giro4-riquadro-chiaro.png', fullPage: true });

  const bugie = await collegamentiCheMentono(page);
  expect(bugie, `collegamenti che portano altrove: ${JSON.stringify(bugie)}`).toEqual([]);

  // La pillola dell'allegato non porta fuori: il nome lo sceglie chi manda.
  const pillole = page.locator('a.fb-file');
  await expect(pillole).toHaveCount(2);
  for (const h of await pillole.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
    expect(h, 'la pillola di un allegato è tornata a essere un collegamento verso fuori').toBe('#');
  }
});

test('riquadro dei feedback: un indirizzo tagliato lo dice', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate((fb) => {
    window.SN_FEEDBACK.list = async () => [fb];
  }, ESCA);
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });

  const link = page.locator('.fb-meta a[href^="http"]').first();
  await expect(link).toHaveCount(1);
  const scritta = ((await link.textContent()) || '').trim();
  // Il posto vero c'è.
  expect(scritta, `la scritta «${scritta}» non nomina ${ESTRANEO}`).toContain(ESTRANEO);
  // E se non ci sta tutto, si vede che continua.
  const href = (await link.getAttribute('href')) || '';
  if (scritta.length < href.replace(/^https?:\/\//, '').length) {
    expect(scritta, `l'indirizzo è tagliato senza dirlo: «${scritta}»`).toMatch(/[…]/);
  }
});

test('Gestione: nessun collegamento porta dove la scritta non dice', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest);
  await page.evaluate((fb) => {
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, ESCA);
  await expect(page.locator('#mgDetail')).toBeVisible();

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/582-giro4-gestione.png', fullPage: true });

  const bugie = await collegamentiCheMentono(page);
  expect(bugie, `collegamenti che portano altrove: ${JSON.stringify(bugie)}`).toEqual([]);
});
