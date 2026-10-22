// #1493: nessuna scheda supera la larghezza massima (token `tab.larghezza`, 240px di serie), nemmeno l'attiva che
// stacca dalle schede dietro dai titoli lunghi; il massimo si cambia dalle Preferenze e dalla chat, e il ↺ lo rimette.

import { test, expect } from './fixtures/electron.mjs';
import { captureCompositeElectron } from './agent/driver.mjs';
import { home as homeChat, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';

// Lunghi abbastanza da passare i 240px e da lasciare alla scheda attiva il posto per staccare: era lo scenario
// della segnalazione, la home aperta larga quanto mezza barra accanto a due video dal titolo lungo.
const JAZZ = 'Parisian Café Jazz 🇫🇷 The World Café';
const METEO = 'Previsioni meteo per Milano domani';

const tokensSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).themeTokens || {});
const setTokens = (shell, tokens) =>
  shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { themeTokens: t } }), tokens);

function schede(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => {
    const t = el.querySelector('.title');
    return {
      titolo: t.textContent,
      attiva: el.classList.contains('active'),
      w: Math.round(el.getBoundingClientRect().width * 10) / 10,
      tagliato: t.scrollWidth > t.clientWidth + 0.5,
    };
  }));
}

// Il verdetto si legge dentro un'attesa: la striscia si ridisegna quando arriva lo snapshot delle schede.
async function verdetto(shell, massimo, { lunghiTagliati }) {
  const s = await schede(shell);
  if (s.length < 3 || s.some((x) => !(x.w > 0))) return 'striscia non ancora disegnata';
  const oltre = s.filter((x) => x.w > massimo + 0.5);
  if (oltre.length) return `oltre ${massimo}px: ${oltre.map((x) => `«${x.titolo}» ${x.w}`).join(', ')}`;
  const lunghi = s.filter((x) => x.titolo === JAZZ || x.titolo === METEO);
  if (lunghi.length !== 2) return `schede lunghe trovate: ${lunghi.length}`;
  if (lunghiTagliati && !lunghi.every((x) => x.tagliato)) return `titoli lunghi interi sotto ${massimo}px: ${lunghi.map((x) => x.w).join(' ')}`;
  if (!lunghiTagliati && lunghi.some((x) => x.tagliato)) return `titoli lunghi tagliati sotto ${massimo}px: ${lunghi.map((x) => x.w).join(' ')}`;
  const attiva = s.find((x) => x.attiva);
  if (!attiva || attiva.tagliato) return `l'attiva non mostra il suo nome intero: ${JSON.stringify(attiva)}`;
  return 'ok';
}

async function homeConDueTitoliLunghi(shell, testServer) {
  await shell.evaluate(async (urls) => { for (const u of urls) await window.filoShell.tabs.open(u); },
    [testServer.html(`<title>${JAZZ}</title><body>x</body>`), testServer.html(`<title>${METEO}</title><body>x</body>`)]);
  await expect(shell.locator('#tabs .tab .title', { hasText: 'Parisian Café Jazz' })).toBeVisible({ timeout: 15_000 });
  await expect(shell.locator('#tabs .tab .title', { hasText: 'Previsioni meteo' })).toBeVisible({ timeout: 15_000 });
  const prima = shell.locator('#tabs .tab').first();
  await prima.click();
  await expect(prima).toHaveClass(/\bactive\b/);
  await expect(shell.locator('#tabs .tab.active .title')).not.toHaveText(new RegExp(`${JAZZ}|${METEO}`));
  await shell.mouse.move(600, 500);
}

test('#1493 — accanto a due titoli lunghi né loro né la home aperta passano i 240px, e il titolo intero resta sulla scheda', async ({ app, shell, testServer }) => {
  await homeConDueTitoliLunghi(shell, testServer);
  await expect.poll(() => verdetto(shell, 240, { lunghiTagliati: true }), { timeout: 10_000 }).toBe('ok');
  // Accorciato a schermo, non nei dati: la carta dell'anteprima (o il suggerimento) lo dice intero.
  const jazz = shell.locator('#tabs .tab', { hasText: 'Parisian Café Jazz' });
  await expect(jazz.locator('.title')).toHaveText(JAZZ);
  expect(await jazz.evaluate((el) => Boolean(el.dataset.anteprima) || el.dataset.tip === el.querySelector('.title').textContent)).toBe(true);
  await captureCompositeElectron(app, 'tests/.shots/tab-larghezza-massima.png');

  // Su un'altra scheda attiva vale lo stesso tetto.
  await jazz.click();
  await expect(jazz).toHaveClass(/\bactive\b/);
  await shell.mouse.move(600, 500);
  await expect.poll(async () => (await schede(shell)).every((x) => x.w <= 240.5), { timeout: 10_000 }).toBe(true);
});

test('#1493 — dalle Preferenze il massimo si allarga, un valore fuori misura è rifiutato col numero, e il ↺ lo rimette', async ({ app, shell, openTab, testServer }) => {
  await homeConDueTitoliLunghi(shell, testServer);
  const pref = await openTab('filo://preferences/preferences.html');
  const campo = pref.locator('[id="tok-tab.larghezza"]');
  await expect(campo).toHaveValue('240px');

  await campo.fill('500');
  await expect.poll(() => tokensSalvati(app), { timeout: 8_000 }).toMatchObject({ 'tab.larghezza': '500px' });
  // Con quattro schede la fila può non bastare ai due nomi interi: conta che crescano oltre i 240 senza passare i 500.
  await expect.poll(async () => {
    const s = await schede(shell);
    const lunghi = s.filter((x) => x.titolo === JAZZ || x.titolo === METEO);
    return s.length === 4 && s.every((x) => x.w <= 500.5) && lunghi.length === 2 && lunghi.every((x) => x.w > 240.5);
  }, { timeout: 10_000 }).toBe(true);
  await captureCompositeElectron(app, 'tests/.shots/tab-larghezza-massima-500.png');

  await campo.fill('50');
  await campo.blur();
  const riga = pref.locator('.sn-token-row[data-token="tab.larghezza"]');
  await expect(riga.locator('.sn-token-error')).toHaveText(/fra 110 e 1000/);
  expect((await tokensSalvati(app))['tab.larghezza']).toBe('500px');

  await riga.locator('.sn-token-reset').click();
  await expect.poll(async () => 'tab.larghezza' in (await tokensSalvati(app)), { timeout: 8_000 }).toBe(false);
  await expect(campo).toHaveValue('240px');
  await expect.poll(() => verdetto(shell, 240, { lunghiTagliati: true }), { timeout: 10_000 }).toBe('ok');
});

test('#1493 — «schede più larghe» in chat cambia il massimo, e il controllo sotto la risposta lo regola', async ({ app, shell, testServer }) => {
  const page = await homeChat(app);
  await homeConDueTitoliLunghi(shell, testServer);
  await modelloFinto(app, [
    { text: 'Fatto, schede più larghe.', toolCalls: [{ id: 't1', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"tab.larghezza","valore":320}' }] },
  ]);
  await chiedi(page, 'schede più larghe');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'schede più larghe' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => tokensSalvati(app), { timeout: 8_000 }).toMatchObject({ 'tab.larghezza': '320px' });
  await expect.poll(async () => {
    const s = await schede(shell);
    return s.every((x) => x.w <= 320.5) && s.some((x) => x.w > 240.5);
  }, { timeout: 10_000 }).toBe(true);

  await page.locator('.sn-refine-trigger').click();
  const cursore = page.locator('.sn-refine-overlay input[type="range"]');
  await expect(cursore).toHaveAttribute('min', '110');
  await expect(cursore).toHaveAttribute('max', '1000');
  await expect(cursore).toHaveValue('320');
  await page.locator('.sn-refine-panel').screenshot({ path: 'tests/.shots/tab-larghezza-massima-cursore.png' });
  await cursore.evaluate((el) => { el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => tokensSalvati(app), { timeout: 8_000 }).toMatchObject({ 'tab.larghezza': '500px' });
  await shell.mouse.move(600, 500);
  await expect.poll(() => verdetto(shell, 500, { lunghiTagliati: false }), { timeout: 10_000 }).toBe('ok');

  // Un valore senza senso dalla chat non passa, e dice quale serve.
  const esito = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_ESTETICA', token: 'tab.larghezza', valore: '20%' });
  expect(JSON.stringify(esito)).toMatch(/fra 110 e 1000/);
  await ripristina(app);
  await setTokens(shell, {});
});
