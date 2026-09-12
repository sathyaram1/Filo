// Verifica #586, giro 1 — la pastiglia del permesso deve essere VISIBILE a chi
// naviga, non solo raggiungibile da un test.
//
// La domanda del permesso vive nell'HTML della shell. L'area della pagina è una
// WebContentsView nativa, che il sistema compone SEMPRE sopra l'HTML della
// shell e ignora lo z-index: se la pastiglia cade dentro quell'area, esiste nel
// DOM (e un test che la clicca dal DOM passa) ma l'utente non la vede e non può
// premerci sopra. Col default che nega dopo due minuti, il risultato per chi
// naviga è: fotocamera, microfono, posizione e notifiche non funzionano mai su
// nessun sito, e non compare niente che lo spieghi.
//
// Qui si misura: il rettangolo della pastiglia contro il bordo alto dell'area
// pagina, letto dal processo principale (la verità del layout), più una
// fotografia della finestra vera come traccia.

import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;background:#fff">
<p id="p">pagina di prova</p>
<script>
  window.__chiediFotocamera = () => {
    window.__cam = navigator.mediaDevices.getUserMedia({ video: true })
      .then((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
            (e) => (e && e.name) ? e.name : 'errore');
  };
  window.__stato = async (nome) => {
    try { return (await navigator.permissions.query({ name: nome })).state; }
    catch (_) { return 'non-supportato'; }
  };
</script>
</body></html>`;

// Bordo alto dell'area pagina (y del WebContentsView attivo) letto dal main.
async function cimaAreaPagina(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (!t) continue;
      const b = t.view.getBounds();
      return { y: b.y, height: b.height, chromeCompact: !!tm.chromeCompact };
    }
    return null;
  });
}

test('la pastiglia del permesso non finisce sotto l\'area della pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML);

  await page.evaluate(() => window.__chiediFotocamera());
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 10_000 });

  const area = await cimaAreaPagina(app);
  const box = await chip.boundingBox();
  const scala = await shell.evaluate(() => window.devicePixelRatio || 1);

  // Fotografia della finestra VERA (composita: shell + view native), come
  // traccia di cosa vede chi naviga.
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const img = await w.capturePage();
    return img.toPNG().toString('base64');
  });
  mkdirSync('tests/.shots', { recursive: true });
  writeFileSync('tests/.shots/586-giro1-pastiglia.png', Buffer.from(png, 'base64'));

  // eslint-disable-next-line no-console
  console.log('[586] area pagina', JSON.stringify(area), 'pastiglia', JSON.stringify(box), 'dpr', scala);

  expect(area, 'nessuna scheda attiva').not.toBeNull();
  // La pastiglia sta nell'HTML della shell: le sue coordinate sono in pixel CSS
  // della shell, le bounds della view in pixel CSS della finestra — stesso
  // sistema, perché la shell riempie la finestra.
  expect(
    box.y + box.height,
    `la pastiglia (y ${box.y}..${box.y + box.height}) cade dentro l'area pagina, che parte a y ${area.y}: `
    + 'la view nativa la copre e chi naviga non la vede né può premerci sopra',
  ).toBeLessThanOrEqual(area.y);
});

test('prima di rispondere il sito vede "da chiedere", non "negato"', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, HTML);
  void shell;

  // Molti siti guardano lo stato PRIMA di chiedere e, se lo leggono "denied",
  // non chiedono mai: il bottone "attiva le notifiche" resta lì a non fare
  // niente. Senza una scelta dell'utente lo stato giusto è "prompt".
  const stati = {};
  for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
    stati[n] = await page.evaluate((x) => window.__stato(x), n);
  }
  stati.notificationPermission = await page.evaluate(() => Notification.permission);
  // eslint-disable-next-line no-console
  console.log('[586] stati iniziali', JSON.stringify(stati));

  expect(stati.camera, 'stato della fotocamera mai scelto').toBe('prompt');
  expect(stati.notifications, 'stato delle notifiche mai scelto').toBe('prompt');
  expect(stati.notificationPermission, 'Notification.permission mai scelto').toBe('default');
});
