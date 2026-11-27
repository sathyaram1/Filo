// #2372 — i tasti di «altro» si compongono (si spostano, vanno nel «+» fisso e ne tornano, anche dopo il riavvio e a
// parole), e la ricerca nel filo è un tasto: prende la colonna, mostra al centro il risultato scelto, Esc la chiude e
// il fuoco torna nella chat. Le foto (chiara, scura, col «+» aperto, con la ricerca) vanno in tests/.shots/.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { home, modelloFinto } from './helpers/chatFinta.mjs';
import { homeIntera } from './helpers/tastiHome.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'tests', '.shots');
mkdirSync(SHOTS, { recursive: true });

const inVista = (page) => page.locator('.dash-altro-griglia.vista .dash-altro-app[data-tasto="1"]').evaluateAll((ns) => ns.map((n) => n.dataset.id));
const tasto = (page, id) => page.locator(`#altro .dash-altro-app[data-tasto="1"][data-id="${id}"]`);
const fuori = (page, id) => page.locator(`#altroFuori .dash-altro-app[data-id="${id}"]`);

// La home intera, ricaricata: quella aperta all'avvio era ancora quella del primo incontro.
async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}

async function apriPiu(page) {
  const piu = page.locator('#altroPiu');
  if ((await piu.getAttribute('aria-expanded')) !== 'true') await piu.click();
  await expect(page.locator('#altroFuori')).toBeVisible();
}

test('trascino le Impostazioni nel «+», dopo il riavvio sono ancora lì e le riporto in colonna; il «+» non si sposta', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-tasti-');
  const lancia = () => electron.launch({ args: [...argomentiScala, '.'], cwd: ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  let app = await lancia();
  try {
    let page = await casa(app);
    // Di serie: la ricerca e le impostazioni in vista, il profilo nel «+».
    expect(await inVista(page)).toEqual(['cerca', 'perDopo', 'scaricamenti', 'cronologia', 'bacheca', 'impostazioni']);
    await expect(fuori(page, 'profilo')).toHaveCount(1);
    await expect(page.locator('#altroPiu')).toHaveText(/1/);
    await page.screenshot({ path: join(SHOTS, '2372-tasti-chiara.png') });

    await tasto(page, 'impostazioni').dragTo(page.locator('#altroPiu'));
    await expect.poll(() => inVista(page)).toEqual(['cerca', 'perDopo', 'scaricamenti', 'cronologia', 'bacheca']);
    await apriPiu(page);
    await expect(fuori(page, 'impostazioni')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '2372-piu-aperto.png') });

    // Il «+» non si trascina: lasciato sopra la ricerca non cambia niente, e resta l'ultimo.
    expect(await page.locator('#altroPiu').getAttribute('draggable')).toBe('false');
    await page.locator('#altroPiu').dragTo(tasto(page, 'cerca'));
    expect(await inVista(page)).toEqual(['cerca', 'perDopo', 'scaricamenti', 'cronologia', 'bacheca']);
    await expect(page.locator('.dash-altro-griglia.vista > .dash-altro-cella').last().locator('#altroPiu')).toHaveCount(1);
    await page.locator('#altroPiu').click({ button: 'right' });
    expect(await menuDi(page).haVoce('Metti nel «+»')).toBe(false);
    await expect.poll(async () => { await page.keyboard.press('Escape'); return menuDi(page).pannelli.count(); }).toBe(0);
    await chiudiApp(app);

    app = await lancia();
    page = await home(app);
    await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
    expect(await inVista(page)).toEqual(['cerca', 'perDopo', 'scaricamenti', 'cronologia', 'bacheca']);
    await apriPiu(page);
    // Dal «+» lo riporto in colonna, davanti alla ricerca.
    await fuori(page, 'impostazioni').dragTo(tasto(page, 'cerca'), { targetPosition: { x: 6, y: 20 } });
    await expect.poll(() => inVista(page)).toEqual(['impostazioni', 'cerca', 'perDopo', 'scaricamenti', 'cronologia', 'bacheca']);
    await expect(fuori(page, 'impostazioni')).toHaveCount(0);
    await expect(page.locator('#altroPiu')).toHaveText(/1/);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('tasto destro su un tasto: sposta, metti nel «+», rimetti in vista; e a parole «togli le impostazioni dalla home»', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await casa(app);
  await tasto(page, 'cronologia').click({ button: 'right' });
  // A icone (#2555): le stesse voci, ogni icona seguita dalle varianti del suo verbo.
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  expect(await menu.vociScritte()).toEqual(['Apri Memorie', 'Sposta prima', 'Sposta dopo', 'Metti nel «+»', 'Assegna una lettera']);
  await menu.scegli('Sposta prima');
  await expect.poll(() => inVista(page)).toEqual(['cerca', 'perDopo', 'cronologia', 'scaricamenti', 'bacheca', 'impostazioni']);
  await tasto(page, 'cronologia').click({ button: 'right' });
  await menu.scegli('Metti nel «+»');
  await expect.poll(() => inVista(page)).not.toContain('cronologia');
  await apriPiu(page);
  await fuori(page, 'cronologia').click({ button: 'right' });
  await expect(menu.principale).toBeVisible();
  expect(await menu.vociScritte()).toEqual(['Apri Memorie', 'Rimetti in vista', 'Assegna una lettera']);
  await menu.scegli('Rimetti in vista');
  await expect.poll(() => inVista(page)).toContain('cronologia');

  // A parole, con l'azione della chat: il tasto delle impostazioni va nel «+», le carte non si toccano.
  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"impostazioni"}' }] },
    { text: 'Fatto: le impostazioni sono nel «+».' },
  ]);
  await page.locator('#input').fill('togli le impostazioni dalla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'nel «+»' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => inVista(page)).not.toContain('impostazioni');
  await expect(fuori(page, 'impostazioni')).toHaveCount(1);
  await expect(page.locator('#tieni .dash-carta[data-tipo="rapide"]')).toHaveCount(1);
});

// Un filo di prova: lo scambio sulle orche, e tanti scambi dopo, così il centro deve davvero scorrere per mostrarlo.
async function semina(app) {
  await app.evaluate(async () => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ora = Date.now();
    const iso = (minFa) => new Date(ora - minFa * 60_000).toISOString();
    const ev = [];
    const chat = (id, testi, minFa) => {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: id }, { ts: iso(minFa), dispositivo: qui }));
      testi.forEach(([role, text], i) => ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role, text } }, { ts: iso(minFa - i * 0.1), dispositivo: qui, autore: role === 'user' ? 'utente' : 'filo' })));
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: id }, { ts: iso(minFa - 0.5), dispositivo: qui }));
    };
    chat('orche', [['user', 'come cacciano le orche?'], ['filo', 'In branco, con le onde.']], 300);
    chat('balene', [['user', 'quanto pesano le balene?'], ['filo', 'Fino a 150 tonnellate.']], 280);
    for (let i = 0; i < 40; i++) chat(`x${i}`, [['user', `riempitivo numero ${i}`], ['filo', `risposta ${i}`]], 200 - i * 4);
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
}

test('la ricerca è un tasto: prende la colonna, le frecce mostrano il risultato al centro, Esc rimette il fuoco nella chat', async ({ app }) => {
  test.setTimeout(60_000);
  await semina(app);
  const page = await casa(app);
  const bolla = page.locator('.dash-bubble-user', { hasText: 'come cacciano le orche?' });

  await tasto(page, 'cerca').click();
  await expect(page.locator('#cercaFilo')).toBeVisible();
  await expect(page.locator('#tieni')).toBeHidden();
  await expect(page.locator('#altro')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('cercaInput');

  await page.keyboard.type('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-msg', { hasText: 'come cacciano le orche?' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(bolla).toBeInViewport();
  await expect(bolla).toHaveClass(/dash-trovato/);
  await page.screenshot({ path: join(SHOTS, '2372-ricerca-chiara.png') });

  // Il passaggio del mouse su un altro risultato porta lì il centro.
  await page.locator('#cercaInput').fill('balene');
  const balene = page.locator('#cercaRisultati .dash-cerca-msg', { hasText: 'quanto pesano le balene?' });
  await expect(balene).toBeVisible();
  await balene.hover();
  await expect(page.locator('.dash-bubble-user', { hasText: 'quanto pesano le balene?' })).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(page.locator('#cercaFilo')).toBeHidden();
  await expect(page.locator('#tieni')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('input');

  // Il clic sulla lente, che è il tasto rimasto in cima, la chiude come Esc.
  await tasto(page, 'cerca').click();
  await page.locator('#cercaChiudi').click();
  await expect(page.locator('#cercaFilo')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('input');
});

test('dopo la pausa nello scrivere il centro va da solo sul risultato più probabile; scorso a mano, si ferma', async ({ app }) => {
  test.setTimeout(60_000);
  await semina(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ ricercaFilo: { pausaMs: 300 } }));
  const page = await casa(app);
  const bolla = page.locator('.dash-bubble-user', { hasText: 'come cacciano le orche?' });
  await expect(bolla).not.toBeInViewport();

  await tasto(page, 'cerca').click();
  await page.keyboard.type('orche');
  await expect(bolla).toBeInViewport({ timeout: 5_000 });

  await page.keyboard.press('Escape');
  await page.locator('#bubbles').evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await expect(bolla).not.toBeInViewport();
  await tasto(page, 'cerca').click();
  // L'utente scorre il centro a mano: da lì il centro non segue più la battitura.
  await page.locator('#bubbles').hover();
  await page.mouse.wheel(0, 200);
  await page.locator('#cercaInput').focus();
  await page.keyboard.type('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-msg').first()).toBeVisible();
  await page.waitForTimeout(900);
  await expect(bolla).not.toBeInViewport();
});

test('«cerca nel filo orche» scritto nella chat apre la stessa ricerca, senza chiedere al modello', async ({ app }) => {
  test.setTimeout(45_000);
  await semina(app);
  const page = await casa(app);
  await modelloFinto(app, [{ text: 'NON DOVEVO RISPONDERE' }]);
  await page.locator('#input').fill('cerca nel filo orche');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cercaFilo')).toBeVisible();
  await expect(page.locator('#cercaInput')).toHaveValue('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-msg', { hasText: 'come cacciano le orche?' })).toBeVisible();
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'NON DOVEVO RISPONDERE' })).toHaveCount(0);

  // In tema scuro, la colonna della ricerca.
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: join(SHOTS, '2372-ricerca-scura.png') });
  await page.keyboard.press('Escape');
  await apriPiu(page);
  await page.screenshot({ path: join(SHOTS, '2372-tasti-scura.png') });
});

// #2372.1 — un risultato che è una pagina apre al centro la sua riga di pagine; un altro risultato o la ricerca chiusa
// la richiudono.
test('mouse o frecce su una pagina trovata aprono la sua riga di pagine; un altro risultato o Esc la richiudono', async ({ app }) => {
  test.setTimeout(60_000);
  const NARVALI = 'https://narvali.example/zanna';
  await app.evaluate(async (_e, url) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const iso = (minFa) => new Date(Date.now() - minFa * 60_000).toISOString();
    const ev = [];
    const chat = (id, testo, minFa) => {
      ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat: id }, { ts: iso(minFa), dispositivo: qui }));
      ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role: 'user', text: testo } }, { ts: iso(minFa - 0.1), dispositivo: qui, autore: 'utente' }));
      ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: id }, { ts: iso(minFa - 0.5), dispositivo: qui }));
    };
    chat('primo', 'apro qualche pagina', 120);
    ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url, titolo: 'La zanna dei narvali' }, { ts: iso(110), dispositivo: qui }));
    ev.push(E.crea(E.TIPI.NAVIGAZIONE, { url: 'https://altro.example/', titolo: 'Un altro sito' }, { ts: iso(109), dispositivo: qui }));
    chat('narvali', 'perché i narvali hanno una zanna sola?', 100);
    for (let i = 0; i < 20; i++) chat(`r${i}`, `riempitivo ${i}`, 90 - i * 3);
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, NARVALI);
  const page = await casa(app);
  const rigaAperta = () => page.evaluate((url) => [...document.querySelectorAll('.dash-pagine')]
    .filter((n) => n._gruppo && n._gruppo.pagine.some((p) => p.url === url))
    .some((n) => n.classList.contains('dash-pagine-aperte')), NARVALI);
  expect(await rigaAperta()).toBe(false);

  await tasto(page, 'cerca').click();
  await page.keyboard.type('narvali');
  const pagina = page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'La zanna dei narvali' });
  const messaggio = page.locator('#cercaRisultati .dash-cerca-msg', { hasText: 'perché i narvali' });
  await expect(pagina).toBeVisible();
  await expect(messaggio).toBeVisible();
  await pagina.hover();
  await expect.poll(rigaAperta).toBe(true);
  await expect(page.locator('.dash-pagine.dash-pagine-aperte')).toBeInViewport();
  await page.screenshot({ path: join(SHOTS, '2372-1-ricerca-pagina.png') });
  // Su un messaggio la riga aperta dalla ricerca si richiude.
  await messaggio.hover();
  await expect.poll(rigaAperta).toBe(false);

  // Con le frecce: la pagina scelta la apre, Esc chiude la ricerca e la riga.
  await page.locator('#cercaInput').focus();
  const voci = await page.locator('#cercaRisultati .dash-cerca-voce').evaluateAll((ns) => ns.map((n) => n.classList.contains('dash-cerca-pagina')));
  for (let i = 0; i <= voci.indexOf(true); i++) await page.keyboard.press('ArrowDown');
  await expect.poll(rigaAperta).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#cercaFilo')).toBeHidden();
  await expect.poll(rigaAperta).toBe(false);
});

// #2372.1 — il tasto del Profilo porta la foto dell'account all'apertura della home, nel «+» e in vista, anche dopo
// che i tasti si ridisegnano.
test('col tasto del Profilo nel «+» o in vista c’è la foto dell’account, anche dopo un ridisegno dei tasti', async ({ app }) => {
  test.setTimeout(60_000);
  const foto = await app.evaluate(() => globalThis.__filoCopieIcone.conserva(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC'));
  // Un account entrato con la sua foto già copiata, come dopo un accesso vero; il servizio dei token irraggiungibile,
  // come senza rete, così la sessione finta resta.
  await app.evaluate(async (_e, foto) => {
    const vera = globalThis.fetch;
    globalThis.fetch = function fetch(input, init) {
      const url = String((input && input.url) || input);
      if (/^https:\/\/securetoken\.googleapis\.com\//.test(url)) return Promise.reject(new TypeError('fetch failed'));
      return vera.call(this, input, init);
    };
    const req = process.getBuiltinModule('module').createRequire(`${process.cwd()}/src/main/main.js`);
    const ga = req('./auth/google-auth');
    const remota = 'https://lh3.example/foto-di-prova';
    req('./auth/token-store').save({ refreshToken: 'r-finto', email: 'mario@example.it', name: 'Mario Rossi', picture: remota, foto, fotoDi: remota });
    ga.restore();
    ga.getUid = async () => 'uid-di-prova';
  }, foto);
  const page = await casa(app);
  const avatar = (sel) => sel.locator('img.account-avatar');
  // All'apertura il Profilo sta nel «+», chiuso: la foto c'è già.
  await expect(avatar(fuori(page, 'profilo'))).toHaveAttribute('src', foto);
  await expect(fuori(page, 'profilo')).toHaveAttribute('aria-label', 'Profilo: Mario Rossi');
  await apriPiu(page);
  await expect.poll(() => avatar(fuori(page, 'profilo')).evaluate((i) => i.naturalWidth)).toBe(1);
  // Rimesso in vista, il tasto ridisegnato ha la sua foto.
  await fuori(page, 'profilo').click({ button: 'right' });
  await menuDi(page).scegli('Rimetti in vista');
  await expect(tasto(page, 'profilo')).toBeVisible();
  await expect(page.locator('.dash-altro-griglia.vista .dash-altro-app[data-id="profilo"] img.account-avatar')).toHaveAttribute('src', foto);
  // Un altro ridisegno (il «+» richiuso) non la perde.
  await page.locator('#altroPiu').click();
  await expect(page.locator('#altroPiu')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.dash-altro-griglia.vista .dash-altro-app[data-id="profilo"] img.account-avatar')).toHaveAttribute('src', foto);
  await page.screenshot({ path: join(SHOTS, '2372-1-profilo-foto.png') });
});
