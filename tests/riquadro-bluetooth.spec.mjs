// #2394 — il riquadro Bluetooth della home: lo stato di prima di una pausa del lettore non si dice spento, un errore
// dice cosa è successo, l'elenco è già lì al clic, un dispositivo senza nome ha un nome e si collega, niente «Copia».
// Il computer è finto nel main (lettore ed esecutore dei comandi); sopra c'è la strada vera, home, riquadro e main.

import { test, expect } from './fixtures/electron.mjs';
import { home, ripristina } from './helpers/chatFinta.mjs';

const PARTENZA = {
  batteria: { livello: 70, inCarica: false, collegata: false },
  rete: { online: true, tipo: 'wifi', nome: 'Casa' },
  bluetooth: { acceso: true, dispositivi: [] },
  volume: { livello: 25, muto: false },
  wifi: { acceso: true },
};

// `ritardo`: quanto ci mette il sistema a dare l'elenco; `elenco`: una risposta fissa dell'elenco (errore, a metà).
async function computerFinto(app, { stato = PARTENZA, dispositivi = [], ritardo = 0, elenco = null } = {}) {
  await app.evaluate(async (_, a) => {
    globalThis.__pc = JSON.parse(JSON.stringify(a.stato));
    globalThis.__pcChiamate = [];
    const pc = globalThis.__pc;
    const disp = a.dispositivi;
    const traccia = (nome, p) => globalThis.__pcChiamate.push([nome, p || {}, Date.now()]);
    const attesa = () => new Promise((r) => setTimeout(r, a.ritardo));
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer({
      async radio(p) {
        traccia('radio', p);
        pc.bluetooth = { acceso: p.acceso, dispositivi: [] };
        return { ok: true, acceso: p.acceso };
      },
      async btElenco() {
        traccia('btElenco');
        await attesa();
        if (a.elenco) return JSON.parse(JSON.stringify(a.elenco));
        return { ok: true, acceso: pc.bluetooth.acceso, dispositivi: disp.map((d) => ({ ...d })) };
      },
      async btCollega(p) {
        traccia('btCollega', p);
        const d = disp.find((x) => x.indirizzo === p.indirizzo);
        if (!d) return { ok: false, errore: 'nessun-dispositivo' };
        d.collegato = p.collega;
        return { ok: true, collegato: p.collega };
      },
      async wifiElenco() { traccia('wifiElenco'); return { ok: true, acceso: true, reti: [], attuale: null }; },
    });
    await globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(async () => globalThis.__pc);
  }, { stato, dispositivi, ritardo, elenco });
}

const chiamate = (app) => app.evaluate(() => globalThis.__pcChiamate);
const voce = (page, v) => page.locator(`#sistema .dash-sis-voce[data-voce="${v}"]`);
const riquadro = (page) => page.locator('.dash-sis-box');
const opzione = (page, testo) => riquadro(page).locator('.sn-select-option', { hasText: testo });

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_COMANDI_SISTEMA._perProve.usaComputer(null);
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(null);
  }).catch(() => {});
  await ripristina(app).catch(() => {});
});

test('Bluetooth spento, il lettore dorme, lo si accende da fuori: riaperta la home la voce dice «leggo», mai «spento», poi acceso', async ({ app }) => {
  await computerFinto(app, { ritardo: 1500, stato: { ...PARTENZA, bluetooth: { acceso: false, dispositivi: [] } } });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', 'spento', { timeout: 8_000 });
  // L'elenco letto all'apertura della home è finito.
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btElenco').length, { timeout: 8_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1800);
  // Il lettore dorme da minuti; intanto il Bluetooth si accende dal sistema. La lettura che riparte tarda (PC lento).
  await app.evaluate(() => {
    globalThis.__pc.bluetooth = { acceso: true, dispositivi: [] };
    globalThis.__libera = null;
    // Non si aspetta: la lettura resta in volo finché la prova non la libera.
    globalThis.SN_SISTEMA_MAIN._perProve.usaLettore(() => new Promise((r) => { globalThis.__libera = () => r(globalThis.__pc); }));
    globalThis.SN_SISTEMA_MAIN._perProve.invecchia(5 * 60 * 1000);
  });
  await page.evaluate(() => {
    window.__visti = [];
    const el = document.querySelector('#sistema .dash-sis-voce[data-voce="bluetooth"]');
    // Solo i cambi: la voce ridisegnata uguale non è uno stato nuovo mostrato.
    let ultimo = el.dataset.stato;
    new MutationObserver(() => { if (el.dataset.stato !== ultimo) window.__visti.push((ultimo = el.dataset.stato)); })
      .observe(el, { attributes: true, attributeFilter: ['data-stato'] });
    // La home torna davanti: chiede subito lo stato.
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', 'leggendo', { timeout: 5_000 });
  await voce(page, 'bluetooth').click();
  await expect(riquadro(page).locator('.dash-sis-info')).toHaveText('Leggo lo stato del Bluetooth…');
  // Finché non si sa, nessun interruttore che direbbe il contrario del vero.
  await expect(riquadro(page).locator('.dash-sis-comandi > .sn-select-option')).toBeHidden();
  await page.screenshot({ path: 'tests/.shots/2394-bluetooth-leggo.png' }).catch(() => {});
  // L'elenco dei dispositivi legge anche la radio: basta lui, senza aspettare il lettore che tarda.
  // (Il title lo toglie il fumetto di Filo al passaggio del mouse: lo stato si legge da aria-label.)
  await expect(voce(page, 'bluetooth')).toHaveAttribute('aria-label', /^Bluetooth acceso/, { timeout: 8_000 });
  await expect(opzione(page, 'Spegni il Bluetooth')).toBeVisible();
  await expect(riquadro(page).locator('.dash-sis-info')).toHaveText('Bluetooth acceso');
  await page.keyboard.press('Escape');
  await app.evaluate(() => globalThis.__libera());
  await page.waitForTimeout(500);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('aria-label', /^Bluetooth acceso/);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('data-stato', '');
  expect(await page.evaluate(() => window.__visti)).not.toContain('spento');
});

test('un dispositivo che Windows lascia senza nome ha il nome di Windows, si collega dal riquadro e dal tasto destro', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: '', collegato: false, le: true }] });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  const riga = opzione(page, 'Collega Dispositivo Bluetooth LE 00:11:22:33:44:55');
  await expect(riga).toBeVisible({ timeout: 8_000 });
  await expect(riquadro(page).locator('.sn-select-option', { hasText: /^Collega\s*$/ })).toHaveCount(0);
  await riga.click();
  await expect(opzione(page, 'Scollega Dispositivo Bluetooth LE 00:11:22:33:44:55')).toBeVisible({ timeout: 8_000 });
  await expect(riquadro(page).locator('.dash-sis-errore:not([hidden])')).toHaveCount(0);
  const collegati = (await chiamate(app)).filter((c) => c[0] === 'btCollega').map((c) => c[1]);
  expect(collegati).toEqual([{ indirizzo: '00:11:22:33:44:55', collega: true }]);
});

test('il riquadro di sistema non ha più «Copia»: restano Nascondi e, sulla riga, «Copia il nome»', async ({ app }) => {
  await computerFinto(app, { dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] });
  const page = await home(app);
  for (const v of ['batteria', 'rete', 'bluetooth', 'volume']) {
    await expect(voce(page, v)).toBeVisible({ timeout: 8_000 });
    await voce(page, v).click();
    await expect(riquadro(page).locator('.dash-sis-altre .sn-select-option').first()).toBeVisible();
    await expect(riquadro(page).locator('.sn-select-option', { hasText: /^Copia$/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('un elenco che il sistema non finisce in tempo dice cosa è successo; uno arrivato a metà lo dice e si rilegge', async ({ app }) => {
  await computerFinto(app, { elenco: { ok: false, errore: 'tempo-comando' } });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toBeVisible({ timeout: 8_000 });
  await voce(page, 'bluetooth').click();
  const errore = riquadro(page).locator('.dash-sis-elenco .dash-sis-errore');
  await expect(errore).toContainText('Il sistema non ha finito di leggere i dispositivi abbinati in tempo.', { timeout: 8_000 });
  await expect(errore).not.toContainText('Il sistema non ha eseguito il comando.');
  await riquadro(page).screenshot({ path: 'tests/.shots/2394-bluetooth-errore.png' }).catch(() => {});
  await page.keyboard.press('Escape');

  await computerFinto(app, { elenco: { ok: true, acceso: true, parziale: true, dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] } });
  await voce(page, 'bluetooth').click();
  await expect(opzione(page, 'Collega Cuffie')).toBeVisible({ timeout: 8_000 });
  await expect(riquadro(page).locator('.dash-sis-parziale')).toHaveText(/ne può mancare qualcuno/);
  await riquadro(page).screenshot({ path: 'tests/.shots/2394-bluetooth-parziale.png' }).catch(() => {});
  const prima = (await chiamate(app)).filter((c) => c[0] === 'btElenco').length;
  await opzione(page, 'Rileggi l\'elenco').click();
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btElenco').length).toBe(prima + 1);
});

test('l\'elenco si legge quando la home si apre: al clic sul riquadro i dispositivi ci sono già, poi si aggiorna', async ({ app }) => {
  const RITARDO = 1500;
  await computerFinto(app, { ritardo: RITARDO, dispositivi: [{ indirizzo: '00:11:22:33:44:55', nome: 'Cuffie', collegato: false }] });
  const page = await home(app);
  await expect(voce(page, 'bluetooth')).toHaveAttribute('title', 'Bluetooth acceso', { timeout: 8_000 });
  // La lettura parte da sola, senza clic.
  await expect.poll(async () => (await chiamate(app)).filter((c) => c[0] === 'btElenco').length, { timeout: 8_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(RITARDO + 300);
  const t0 = Date.now();
  await voce(page, 'bluetooth').click();
  await expect(opzione(page, 'Collega Cuffie')).toBeVisible();
  const dalClic = Date.now() - t0;
  console.log(`[#2394] clic → elenco: ${dalClic} ms (la lettura del sistema finto ne prende ${RITARDO})`);
  expect(dalClic).toBeLessThan(RITARDO);
  // Mostrato quello di prima, il riquadro dice che sta aggiornando e poi lo toglie.
  await expect(riquadro(page).locator('.dash-sis-aggiorno')).toBeVisible();
  await riquadro(page).screenshot({ path: 'tests/.shots/2394-bluetooth-aggiorno.png' }).catch(() => {});
  await expect(riquadro(page).locator('.dash-sis-aggiorno')).toBeHidden({ timeout: RITARDO + 5_000 });
  await page.screenshot({ path: 'tests/.shots/2394-bluetooth-elenco.png' }).catch(() => {});
});
