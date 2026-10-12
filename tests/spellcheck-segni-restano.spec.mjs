// #1111 — chi corregge una parola non perde, nemmeno per un istante, le sottolineature delle altre: né il blu del
// correttore di Filo mentre si ricontrolla, né il rosso del correttore di sistema dopo una correzione dal menu.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px">
<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:900px;height:420px;font:18px monospace"></textarea>
</body>`;

// Il fornitore finto segna come errore ogni parola «xq…» (correzione «y»): nessuna chiamata esce dalla macchina.
async function apri(app, openTab, testServer) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__scan = 0;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      if (t.includes('Analizza il testo qui sotto')) {
        globalThis.__scan += 1;
        const parole = [...new Set(t.match(/xq[a-z]+\d+/g) || [])];
        return { text: JSON.stringify({ annotated: parole.map((w) => `**${w}**`).join(' '), issues: parole.map(() => ({ type: 'grammar', explanation: 'x', correction: 'y' })) }), model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      }
      return { text: '{"misspelled":false,"correction":""}', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const blu = (page) => page.locator('.sn-spell-overlay .sn-semantic-error');
const scan = (app) => app.evaluate(() => globalThis.__scan);

// Per `ms` guarda il riquadro a ogni giro: i segni attesi, sul testo che c'è adesso nella casella.
async function restanoPer(page, attesi, ms) {
  return page.evaluate(async ([attesi, ms]) => {
    const visti = [];
    const fine = performance.now() + ms;
    while (performance.now() < fine) {
      const o = document.querySelector('.sn-spell-overlay');
      const ta = document.getElementById('ta');
      const segni = o ? [...o.querySelectorAll('.sn-semantic-error')].map((s) => s.textContent) : [];
      const allineato = !!o && o.textContent === ta.value;
      if (JSON.stringify(segni) !== JSON.stringify(attesi) || !allineato) visti.push({ segni, allineato });
      await new Promise((r) => setTimeout(r, 30));
    }
    return visti.slice(0, 3);
  }, [attesi, ms]);
}

async function seleziona(page, parola) {
  await page.evaluate((w) => {
    const ta = document.getElementById('ta');
    const i = ta.value.indexOf(w);
    ta.setSelectionRange(i, i + w.length);
  }, parola);
}

test('correggendo a mano una parola, i segni blu delle altre restano al loro posto finché lo scan non li rinnova', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi xqprima1 bella giornata con xqseconda2 e poi xqterza3 fine ');
  await expect(blu(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 6000 });
  const prima = await scan(app);

  await seleziona(page, 'xqseconda2');
  await page.keyboard.type('seconda');
  // Fino allo scan dopo (1,5 s di pausa): la parola corretta non è più segnata, le altre sì, sulla parola giusta.
  expect(await restanoPer(page, ['xqprima1', 'xqterza3'], 1200)).toEqual([]);
  await expect.poll(() => scan(app), { timeout: 6000 }).toBe(prima + 1);
  await expect(blu(page)).toHaveText(['xqprima1', 'xqterza3']);

  // Una parola nuova in mezzo sposta le altre: i segni la seguono.
  await page.evaluate(() => { const ta = document.getElementById('ta'); const i = ta.value.indexOf('bella'); ta.setSelectionRange(i, i); });
  await page.keyboard.type('davvero ');
  expect(await restanoPer(page, ['xqprima1', 'xqterza3'], 600)).toEqual([]);
});

test('con «Risolvi» dal tasto destro sul blu, le altre parole blu restano segnate', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi xqprima1 bella giornata con xqseconda2 e poi xqterza3 fine ');
  await expect(blu(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 6000 });

  const b = await blu(page).nth(1).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const corr = page.locator('.sn-menu-correction:visible').first();
  await expect(corr).toContainText('y');
  await corr.click();
  await expect(page.locator('#ta')).toHaveValue('oggi xqprima1 bella giornata con y e poi xqterza3 fine ');
  expect(await restanoPer(page, ['xqprima1', 'xqterza3'], 1000)).toEqual([]);
});
