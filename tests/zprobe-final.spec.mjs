// TEMPORANEO — audit prober: verifiche finali.
import { test, expect } from './fixtures/electron.mjs';

test('feedback alpha senza rete: tempo e stato finale', async ({ openTab }) => {
  test.setTimeout(180_000);
  const t0 = Date.now();
  const page = await openTab('filo://feedback/feedback.html');
  let when = -1;
  for (let i = 0; i < 120; i++) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Caricamento/i.test(txt)) { when = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }
  const st = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  console.log('FEEDBACK loader via dopo ms =', when, '| stato:', st);
  await page.screenshot({ path: 'tests/.shots/audit-offline-empty.png' });
});

test('autocorrect a più parole: accettato ma mai applicato', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const sp = await openTab('filo://spellcheck/spellcheck.html');
  await sp.waitForTimeout(1000);

  // 1) voce a una parola (funzionante)
  await sp.fill('#newWord', 'cmq');
  await sp.fill('#newCorrection', 'comunque');
  await sp.click('#addAutocorrect');
  await sp.waitForTimeout(400);
  // 2) voce a più parole (l'utente se l'aspetta funzionante)
  await sp.fill('#newWord', 'x es');
  await sp.fill('#newCorrection', 'per esempio');
  await sp.click('#addAutocorrect');
  await sp.waitForTimeout(600);

  const shown = await sp.evaluate(() => document.getElementById('autocorrectList').innerText.replace(/\s+/g, ' '));
  const warn = await sp.evaluate(() => {
    const e = document.getElementById('autocorrectConflict');
    return e && !e.hidden ? e.textContent : '(nessun avviso)';
  });
  console.log('LISTA:', shown, '| AVVISO:', warn);
  await sp.screenshot({ path: 'tests/.shots/audit-autocorrect-multiword.png' });

  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body><textarea id="t" rows="4" cols="50"></textarea></body>`);
  await page.click('#t');
  await page.type('#t', 'cmq ', { delay: 60 });
  await page.waitForTimeout(600);
  await page.type('#t', 'x es ', { delay: 60 });
  await page.waitForTimeout(800);
  const val = await page.inputValue('#t');
  console.log('TESTO DIGITATO →', JSON.stringify(val));
  expect(val).toContain('comunque');       // la voce a una parola funziona
  expect(val).toContain('per esempio');    // la voce a due parole DOVREBBE funzionare
});
