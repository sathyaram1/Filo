// SPEC DI VERIFICA ESTERNA (temporaneo, da rimuovere a fine verifica).
// Prova la cosa chiesta usandola come l'owner:
//  1. l'avviso delle fusioni in attesa sta in cima ai Ricevuti della dashboard
//     di gestione (e solo lì: sparisce sulle altre schede);
//  2. la card dice da quale feedback nasce il lavoro ("automazione · feedback
//     #444"), senza doppio cancelletto anche se il server manda "#444";
//  3. cliccando il numero si apre la segnalazione;
//  4. sulla prima schermata (nuova scheda) l'avviso non compare più.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'agent', '.out');

function fakeApprovals(now) {
  return {
    ok: true,
    pending: [
      {
        id: 'req-routine',
        branch: 'claude/lavoro-automazione',
        sha: 'abc1234def5678',
        who: 'worker',
        origin: 'routine',
        num: '#444', // col cancelletto: la pagina deve stamparne UNO solo
        createdAtMs: now - 5 * 60 * 1000,
        expiresAtMs: now + 20 * 60 * 60 * 1000,
        blocks: [{ label: 'Tocca le guardie', items: ['guardia/x'] }],
      },
      {
        id: 'req-local',
        branch: 'claude/lavoro-locale',
        sha: 'fff9999aaa0000',
        who: 'owner@example.com',
        createdAtMs: now - 60 * 1000,
        expiresAtMs: now + 23 * 60 * 60 * 1000,
        blocks: [{ label: 'Regole del database' }],
      },
    ],
    recent: [],
  };
}

test.describe('avviso fusioni in attesa', () => {
  test('vive in cima ai Ricevuti, etichetta #444 apre la segnalazione', async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.evaluate(() => window.__mgTest.whenReady());

    // Stub del canale verso il main: in test non c'è né sessione owner né server.
    await page.evaluate((approvals) => {
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = (msg) => {
        if (msg && msg.type === 'merge_approvals_get') return Promise.resolve(approvals);
        return orig(msg);
      };
    }, fakeApprovals(Date.now()));

    // Owner con un feedback #444 nei Ricevuti.
    await page.evaluate(() => {
      window.__mgTest.setAdmin(true);
      window.__mgTest.setData([{
        _id: 'fb444',
        seq: 444,
        status: 'new',
        message: 'Segnalazione che ha generato il lavoro',
        clientId: 'client-1',
        createdAt: Date.now() - 3600e3,
      }]);
      return window.__mgTest.loadMergeApprovals();
    });

    const avviso = page.locator('#mgMergeApprovals');
    await expect(avviso).toBeVisible();
    await expect(avviso).toContainText('fusioni aspettano il tuo via libera');

    // La card dell'automazione dice da quale feedback nasce il lavoro,
    // con UN solo cancelletto (il server aveva mandato "#444").
    const origine = avviso.locator('.sn-mac-card[data-origin="routine"] .sn-mac-origin');
    await expect(origine).toHaveText('automazione · feedback #444');
    const testo = await avviso.innerText();
    expect(testo).not.toContain('##');

    // "In alto ma dentro la scheda Ricevuti": l'avviso sta sopra la lista.
    const boxAvviso = await avviso.boundingBox();
    const boxLista = await page.locator('#mgListCol').boundingBox();
    expect(boxAvviso.y).toBeLessThan(boxLista.y);

    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, 'verifica-fusioni-ricevuti.png') });

    // Le altre schede non lo mostrano; tornando ai Ricevuti riappare.
    for (const tab of ['queue', 'resolved', 'archived', 'automation']) {
      await page.evaluate((t) => window.__mgTest.setTab(t), tab);
      await expect(avviso).toBeHidden({ timeout: 3000 });
    }
    await page.evaluate(() => window.__mgTest.setTab('inbox'));
    await expect(avviso).toBeVisible();

    // Il numero apre la segnalazione: si arriva al dettaglio del #444.
    await origine.click();
    const dettaglio = page.locator('#mgDetail');
    await expect(dettaglio).toBeVisible();
    await expect(page.locator('#mgDetailHead')).toContainText('#444');
    await page.screenshot({ path: join(OUT, 'verifica-fusioni-dettaglio.png') });
  });

  test('la prima schermata non mostra più l\'avviso', async ({ openTab }) => {
    const page = await openTab('filo://newtab/');
    await page.waitForLoadState('domcontentloaded');
    // Anche se il server avesse fusioni in attesa, la home non deve chiederle
    // né mostrarle: si stubba comunque il canale e si aspetta un giro.
    await page.evaluate((approvals) => {
      if (window.filo && window.filo.message) {
        const orig = window.filo.message.bind(window.filo);
        window.filo.message = (msg) => {
          if (msg && msg.type === 'merge_approvals_get') return Promise.resolve(approvals);
          return orig(msg);
        };
      }
    }, fakeApprovals(Date.now()));
    await page.waitForTimeout(1500);
    expect(await page.locator('.sn-mac').count()).toBe(0);
    const corpo = await page.evaluate(() => document.body.innerText);
    expect(corpo).not.toContain('via libera');
    expect(corpo).not.toContain('fusioni');
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, 'verifica-fusioni-home.png') });
  });
});
