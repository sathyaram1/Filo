// Esplorazione 2 (non è una prova): strade equivalenti, errori del server,
// stato vuoto, tema scuro.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo');
const OUT = join(APP_ROOT, 'tests', '.shots', 'owner-esplora2.json');

test('esplora 2', async () => {
  test.setTimeout(300_000);
  const server = await avviaServer();
  const filo = await avviaFilo({ env: server.env });
  const r = {};
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);

    let page = await apriOwner(filo);
    await page.waitForTimeout(2500);

    // Stato vuoto: nessuna persona dentro.
    r.tabellaVuota = await page.evaluate(() => {
      const t = document.getElementById('ownerUsers');
      return { nascosta: t ? t.hidden : null, testo: t ? t.innerText.slice(0, 200) : null, totals: document.getElementById('ownerTotals').innerText };
    });

    // Invio nel campo: è la strada naturale per salvare.
    await page.fill('#knob-rewardFeedbackSent', '42');
    await page.press('#knob-rewardFeedbackSent', 'Enter');
    await page.waitForTimeout(2500);
    r.invioNelCampo = {
      msg: await page.locator('#knob-rewardFeedbackSent-msg').innerText().catch(() => ''),
      config: server.store.docs.config.rewardFeedbackSent ?? null,
    };

    // Il server rifiuta la scrittura (regole non ancora aggiornate).
    server.flags.fsDenied = true;
    await page.fill('#knob-rewardFeedbackClosed', '99');
    await page.click('#knob-rewardFeedbackClosed-salva');
    await page.waitForTimeout(3000);
    r.scritturaRifiutata = {
      msg: await page.locator('#knob-rewardFeedbackClosed-msg').innerText().catch(() => ''),
      classe: await page.locator('#knob-rewardFeedbackClosed-msg').getAttribute('class'),
      config: server.store.docs.config.rewardFeedbackClosed ?? null,
      rimettiVisibile: await page.locator('#knob-rewardFeedbackClosed-rimetti').isVisible(),
    };
    server.flags.fsDenied = false;

    // «Rimetti com'era» dopo un salvataggio riuscito.
    await page.fill('#knob-rewardFeedbackSent', '7');
    await page.click('#knob-rewardFeedbackSent-salva');
    await page.waitForTimeout(2500);
    r.rimettiPrima = { visibile: await page.locator('#knob-rewardFeedbackSent-rimetti').isVisible(), config: server.store.docs.config.rewardFeedbackSent };
    if (r.rimettiPrima.visibile) {
      await page.click('#knob-rewardFeedbackSent-rimetti');
      await page.waitForTimeout(2500);
      r.rimettiDopo = {
        campo: await page.inputValue('#knob-rewardFeedbackSent'),
        config: server.store.docs.config.rewardFeedbackSent,
        msg: await page.locator('#knob-rewardFeedbackSent-msg').innerText().catch(() => ''),
      };
    }

    // Persone per invito: cambio a 1, un codice già in giro deve valere per 1.
    await page.fill('#knob-invitesMaxUses', '1');
    await page.click('#knob-invitesMaxUses-salva');
    await page.waitForTimeout(2500);
    const codes = await server.codiciOwner(2);
    const a = await server.service.redeem('anon-a', codes[0], server.deps);
    const b = await server.service.redeem('anon-b', codes[0], server.deps);
    r.invitoAUnUso = { primo: a.status, secondo: b.status };

    // Tastiera sulla riga della persona.
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20_000 });
    await page.waitForTimeout(2500);
    const riga = page.locator('tr.sn-wallet-user').first();
    await riga.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    r.tastieraInvio = await page.evaluate(() => {
      const d = [...document.querySelectorAll('tr.sn-wallet-user-detail')].filter((x) => !x.hidden);
      return { aperti: d.length, testo: d[0] ? d[0].innerText.slice(0, 120) : '' };
    });
    await page.keyboard.press(' ');
    await page.waitForTimeout(1500);
    r.tastieraSpazio = await page.evaluate(() => [...document.querySelectorAll('tr.sn-wallet-user-detail')].filter((x) => !x.hidden).length);

    // Tasto destro sulla riga: c'è qualcosa?
    await riga.click({ button: 'right' });
    await page.waitForTimeout(1500);
    r.tastoDestro = await page.evaluate(() => Boolean(document.querySelector('.sn-ctx, .sn-context-menu, #snContextMenu')));

    // Tema scuro.
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
    await page.waitForTimeout(800);
    mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true });
    await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'owner-scuro.png'), fullPage: true });
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'owner-chiaro.png'), fullPage: true });
  } finally {
    writeFileSync(OUT, JSON.stringify(r, null, 2));
    try { await filo.app.close(); } catch (_) {}
    await server.chiudi();
  }
});
