// Verifica #586, giro 8 — la concessione che Filo si dà per la dettatura, presa
// da un sito a cui il microfono era stato NEGATO.
//
// Per chi usa Filo: su un sito qualunque compare «vuole usare il microfono» e tu
// rispondi «Nega». Da quel momento quel sito il microfono non ce l'ha, e nelle
// Impostazioni la scelta è scritta nero su bianco. Il sito però continua a
// chiederlo, piano, ogni pochi secondi. Più tardi, sulla stessa pagina, fai una
// cosa tua che col sito non c'entra: tasto destro dentro un campo e «Detta».
// Per la dettatura Filo si dà una concessione al volo, buona una volta sola, e
// quella concessione non guarda chi la sta usando: se la prende la prima
// richiesta di microfono che arriva in quella scheda, e la prima può essere
// quella del sito che sta lì ad aspettarla.
//
// È la stessa causa del giro 6 (l'Incolla), chiusa lì spostando la lettura degli
// appunti nel main. Per il microfono la concessione è rimasta, con una guardia:
// non si arma se qualcuno ha chiesto quella cosa nell'ultimo secondo e mezzo, o
// se una domanda è aperta. Un sito NEGATO non fa comparire nessuna domanda, e
// chiedendo a distanza di qualche secondo si fa trovare fuori dalla finestra
// della guardia proprio mentre la concessione si arma.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="60" style="width:90%;height:120px"></textarea>
<script>
  window.__preso = null;
  window.__tentativi = 0;
  window.__ultimo = 0;
  window.__prova = () => {
    window.__ultimo = Date.now();
    window.__tentativi++;
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (s) => {
        const t = s.getTracks().map((x) => x.kind + ':' + x.readyState);
        if (!window.__preso) window.__preso = t;
        return t;
      },
      (e) => 'rifiutato:' + ((e && e.name) || 'errore'),
    );
  };
  window.__avvia = (ms) => { window.__timer = setInterval(() => { window.__prova(); }, ms); };
  window.__daUltimo = () => Date.now() - window.__ultimo;
</script></body></html>`;

// Aspetta di essere appena DOPO una richiesta del sito, così che l'attimo in cui
// Filo arma la concessione cada oltre la finestra della guardia.
async function subitoDopoUnaRichiesta(page) {
  for (let i = 0; i < 120; i++) {
    const d = await page.evaluate(() => window.__daUltimo());
    if (d < 500) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function detta(page) {
  await page.click('#ta');
  await page.click('#ta', { button: 'right' });
  await page.waitForTimeout(700);
  const voce = page.locator('button, .sn-menu-item, .sn-menu-row-btn').filter({ hasText: /🎤/ }).first();
  const c = await voce.count();
  if (c) await voce.click();
  await page.waitForTimeout(2600);
  await page.keyboard.press('Escape').catch(() => {});
  return c;
}

test('un sito a cui il microfono è stato NEGATO non deve prenderselo con la dettatura di Filo', async ({ shell, openTab, testServer }) => {
  test.setTimeout(300_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.waitForTimeout(600);

  // 1. Il sito chiede, l'utente NEGA. Da qui in poi niente più domande per lui.
  const primo = page.evaluate(() => window.__prova());
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-btn').filter({ hasText: 'Nega' }).first().click();
  console.log('[586 g8] esito della prima richiesta, dopo il Nega:', JSON.stringify(await primo));
  await page.evaluate(() => { window.__preso = null; });

  // 2. Il sito insiste piano: ogni cinque secondi, senza fare comparire niente.
  await page.evaluate(() => window.__avvia(5000));

  // 3. L'utente detta. Più volte, come farebbe chi usa la dettatura su una
  //    pagina lunga: basta che una volta cada nel momento giusto.
  for (let giro = 0; giro < 4; giro++) {
    await subitoDopoUnaRichiesta(page);
    await page.waitForTimeout(2000);
    const voci = await detta(page);
    const preso = await page.evaluate(() => window.__preso);
    console.log(`[586 g8] tentativo ${giro + 1} — voce «Detta» trovata: ${voci} — il sito ha in mano:`, JSON.stringify(preso));
    if (preso) break;
  }

  const stato = await page.evaluate(() => ({ preso: window.__preso, tentativi: window.__tentativi }));
  console.log('[586 g8] microfono preso dal sito negato:', JSON.stringify(stato.preso),
    'richieste del sito:', stato.tentativi);
  console.log('[586 g8] cartelli accesi:', JSON.stringify(await shell.locator('.perm-live').allTextContents()));

  expect(
    stato.preso,
    'il microfono era stato NEGATO a questo sito, e il sito se l\'è preso lo stesso nel momento in '
    + 'cui chi naviga ha fatto partire la dettatura di Filo: la concessione che Filo si dà per una '
    + 'richiesta sua vale per la prima richiesta di microfono che arriva in quella scheda, e non '
    + 'guarda chi la sta usando. Non compare niente, e in Impostazioni non resta niente da togliere',
  ).toBeNull();
});
