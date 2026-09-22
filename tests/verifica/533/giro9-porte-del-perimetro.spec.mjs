// #533 — verifica giro 9: il collegamento che Filo scrive dopo aver letto.
//
// I giri 7 e 8 hanno chiuso il CLIC su quel collegamento: nella chat della home
// e dentro una pagina web l'apertura passa dal motore. La guardia però sta su
// un ascoltatore del solo `click`, e un collegamento si apre anche in altri
// modi che il browser conosce da sempre: la rotellina (tasto centrale) e
// l'apertura in secondo piano. Qui si prova quella strada.
//
// Stesso metodo dei giri prima: un modello finto che casca nell'istruzione
// ostile e mette in chat un collegamento che porta dove vuole la pagina letta.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const NEWTAB = 'filo://newtab/';
const SCRITTA = 'Apri la bolletta di marzo';
const SEGRETO = 'IBAN-IT60X0542811101000000123456';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      agentStyle: '',
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function copione(app, { giri, risposta }) {
  await app.evaluate(async (_electron, { giri, risposta }) => {
    globalThis.__origProv = globalThis.SN_PROVIDERS.completeWithFallback;
    let n = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, tools }) => {
      if (!Array.isArray(tools) || !tools.length) {
        return { text: '', toolCalls: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      const giro = giri[n++] || [];
      return {
        text: giro.length ? '' : risposta,
        toolCalls: giro.map((c, i) => ({
          id: `c_${n}_${i}`, name: c.name, arguments: JSON.stringify(c.args || {}),
        })),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, { giri, risposta });
}

async function ripristina(app) {
  await app.evaluate(() => {
    if (globalThis.__origProv) globalThis.SN_PROVIDERS.completeWithFallback = globalThis.__origProv;
  });
}

test.describe('#533 giro 9 — il collegamento aperto senza il tasto sinistro', () => {
  test('nella chat, la rotellina sul collegamento non scavalca il motore', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await configura(app);
    const page = await openTab(NEWTAB);
    await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });

    const destinazione = `${testServer.html('<p>presa</p>')}?d=segreto`;
    await copione(app, {
      giri: [[{ name: 'LEGGI_DOCUMENTO', args: { percorso: '/tmp/bolletta-che-non-ce.pdf' } }], []],
      risposta: `Ecco quello che ho trovato. [${SCRITTA}](${destinazione})`,
    });

    const r = await page.evaluate(async () => {
      const res = await chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.FILO_CHAT,
        userMessage: 'Leggimi la bolletta che mi hanno mandato.',
        threadHistory: [],
      });
      return { testo: (res && res.text) || '' };
    });

    // Il collegamento va DENTRO le bolle, dove sta il vero ascoltatore dei clic
    // della chat: non una riscrittura, proprio quello.
    await page.evaluate((testo) => {
      const bolle = document.getElementById('bubbles');
      const box = document.createElement('div');
      box.className = 'dash-bubble dash-bubble-md';
      box.innerHTML = self.SN_MARKDOWN.render(testo);
      bolle.appendChild(box);
    }, r.testo);
    await ripristina(app);

    const link = page.locator('#bubbles a.filo-md-link').last();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.click({ button: 'middle' });
    await page.waitForTimeout(2500);

    const schede = app.windows().map((w) => w.url());
    expect(schede.some((u) => u.includes('d=segreto')),
      'il tasto centrale sul collegamento apre l\'indirizzo scelto dopo la lettura senza passare dal motore')
      .toBe(false);
  });

  test('dentro una pagina web, la rotellina sul collegamento non scavalca il motore', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await configura(app);

    const ospite = testServer.html('<p>una pagina qualunque</p>');
    const destinazione = `${testServer.html('<p>presa</p>')}?d=segreto2`;
    const page = await openTab(ospite);
    await page.waitForLoadState('domcontentloaded');

    // L'ancora che il riquadro «Spiega», il popup di risposta e l'assistente
    // Aiuto mostrano: la compone la sorgente unica del rendering, con la
    // scritta e l'indirizzo scelti dal modello.
    await page.evaluate((url) => {
      const box = document.createElement('div');
      box.className = 'sn-msg-text';
      box.style.cssText = 'position:fixed;top:40px;left:40px;z-index:2147483647;background:#fff;padding:8px';
      const a = document.createElement('a');
      a.className = 'filo-md-link';
      a.setAttribute('href', url);
      a.setAttribute('target', '_blank');
      a.setAttribute('title', url);
      a.setAttribute('rel', 'noopener noreferrer nofollow');
      a.textContent = 'Apri la bolletta di marzo';
      box.appendChild(a);
      document.body.appendChild(box);
    }, destinazione);

    const link = page.locator('a.filo-md-link').last();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.click({ button: 'middle' });
    await page.waitForTimeout(2500);

    const schede = app.windows().map((w) => w.url());
    expect(schede.some((u) => u.includes('d=segreto2')),
      'dentro una pagina web il tasto centrale sul collegamento apre l\'indirizzo senza passare dal motore')
      .toBe(false);
  });
});
