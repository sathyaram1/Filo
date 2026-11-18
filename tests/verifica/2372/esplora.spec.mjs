// Esplorazione del giro 3 (#2372): si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { home, modelloFinto } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });
const tasto = (page, id) => page.locator(`#altro .dash-altro-app[data-tasto="1"][data-id="${id}"]`);
async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}
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
    chat('orcheb', [['user', 'orche bianche esistono?'], ['filo', 'Rare.']], 250);
    for (let i = 0; i < 20; i++) chat(`x${i}`, [['user', `riempitivo numero ${i}`], ['filo', `risposta ${i}`]], 200 - i * 4);
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  });
}
const attivo = (page) => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));

test('E1 ricerca aperta, clic al centro, continuo a scrivere', async ({ app }) => {
  await semina(app);
  const page = await casa(app);
  await tasto(page, 'cerca').click();
  await page.keyboard.type('orc');
  await expect(page.locator('#cercaRisultati .dash-cerca-msg').first()).toBeVisible();
  const box = await page.locator('#bubbles').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  console.log('E1 attivo dopo clic al centro:', await attivo(page));
  await page.keyboard.type('he');
  console.log('E1 cerca=', await page.locator('#cercaInput').inputValue(), 'chat=', await page.locator('#input').inputValue());
});

test('E2 cerca nel «+»', async ({ app }) => {
  const page = await casa(app);
  await tasto(page, 'cerca').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Metti nel «+»' }).click();
  await page.locator('#altroPiu').click();
  await page.locator('#altroFuori .dash-altro-app[data-id="cerca"]').click();
  console.log('E2 ricerca visibile', await page.locator('#cercaFilo').isVisible(), 'attivo', await attivo(page));
  await page.screenshot({ path: `${SHOTS}/esplora-e2.png` });
  await page.locator('#cercaChiudi').click();
  console.log('E2 dopo lente: visibile', await page.locator('#cercaFilo').isVisible(), 'attivo', await attivo(page), 'piu aperto', await page.locator('#altroPiu').getAttribute('aria-expanded'));
  await page.screenshot({ path: `${SHOTS}/esplora-e2b.png` });
});

test('E4 preferenze: lettere strane', async ({ app, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  for (const [l, dove] of [['y', 'javascript:alert(1)'], ['y', '<img src=x onerror=alert(1)>'], ['1', 'example.com'], ['y', '   '], ['😀', 'example.com'], ['k', 'Cerca nel filo'], ['p', 'Profilo'], ['e', 'Editor'], ['z', 'localhost:3000']]) {
    await pref.locator('#doppioToccoNuova').fill(l);
    await pref.locator('#doppioToccoDove').fill(dove);
    await pref.locator('#doppioToccoAggiungi').click();
    await pref.waitForTimeout(300);
    console.log('E4', JSON.stringify([l, dove]), '→ hint=', JSON.stringify(await pref.locator('#doppioToccoHint').textContent()), 'righe=', JSON.stringify(await pref.locator('#doppioToccoLettere .mem-riga').allTextContents()));
  }
  await pref.locator('#doppioToccoLettere').scrollIntoViewIfNeeded();
  await pref.screenshot({ path: `${SHOTS}/esplora-e4.png` });
  await pref.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await pref.screenshot({ path: `${SHOTS}/esplora-e4-scura.png` });
});

test('E8 cerca nel filo senza parole, e frase lunga', async ({ app }) => {
  const page = await casa(app);
  await modelloFinto(app, [{ text: 'RISPOSTA DEL MODELLO' }, { text: 'RISPOSTA DEL MODELLO 2' }]);
  await page.locator('#input').fill('cerca nel filo');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  console.log('E8a ricerca', await page.locator('#cercaFilo').isVisible(), 'valore', await page.locator('#cercaInput').inputValue(), 'modello', await page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA DEL MODELLO' }).count());
  await page.keyboard.press('Escape');
  await page.locator('#input').fill('Cerca nel filo cosa mi aveva detto Marco sulle orche e fammi un riassunto');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  console.log('E8b ricerca', await page.locator('#cercaFilo').isVisible(), 'valore', await page.locator('#cercaInput').inputValue(), 'modello', await page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA DEL MODELLO' }).count());
});

test('E12 tasti tutti in vista, finestra bassa', async ({ app }) => {
  const page = await casa(app);
  await page.locator('#altroPiu').click();
  const prof = page.locator('#altroFuori .dash-altro-app[data-id="profilo"]');
  await prof.click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Rimetti in vista' }).click();
  for (const [w, h] of [[1280, 800], [900, 560], [700, 480]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => { const x = BrowserWindow.getAllWindows().find((b) => b._filoTabs); x.setSize(w, h); }, [w, h]);
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      return [...document.querySelectorAll('#altro .dash-altro-griglia.vista .dash-altro-app, #altroPiu')].map((n) => { const b = n.getBoundingClientRect(); return `${n.dataset.id || n.id}:${Math.round(b.right)}x${Math.round(b.bottom)}${b.bottom > vh || b.right > vw || b.width === 0 ? '!FUORI' : ''}`; }).join(' ') + ` vp=${vw}x${vh}`;
    });
    console.log('E12', w, h, r);
    await page.screenshot({ path: `${SHOTS}/esplora-e12-${w}.png` });
  }
});
