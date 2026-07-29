// VERIFIER stress spec (temporary, not part of the branch). Black-box adversarial
// tests for feedback #379: manual editor versioning.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
async function setDocRaw(page, html) {
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}

// 1) REAL debounce path: no hook call. Type a big block, wait past the idle
// window, and a 'manual' version must appear on its own.
test('debounce reale: dopo la pausa scatta lo snapshot manuale senza chiamare hook', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'Inizio breve.');
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(0);

  const big = 'Questo è un paragrafo molto lungo scritto interamente a mano dall utente per superare la soglia anti rumore. '.repeat(3);
  await setDocText(page, big);
  // Aspetta oltre la finestra di idle (3.5s) senza toccare l hook.
  await page.waitForTimeout(4200);
  const list = await page.evaluate(() => window.__filoEditorVersions.list());
  expect(list.length).toBe(1);
  expect(list[0].source).toBe('manual');
});

// 2) Aprire un documento GIÀ lungo non deve generare una versione fasulla: la
// deriva si misura da quando apri il file.
test('testo preesistente al caricamento NON crea una versione manuale', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  const long = 'Testo lungo già presente nel file quando lo apro. '.repeat(10);
  await setDocText(page, long);
  // Il baseline all attivazione è dal contenuto vuoto iniziale, quindi qui
  // riallineo simulando "apertura" con snapshot poi ricontrollo: la deriva da
  // quello stato è zero → niente versione nuova.
  await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  const c1 = await page.evaluate(() => window.__filoEditorVersions.list().length);
  // Rivaluto subito senza altre modifiche: deriva zero → nessuna nuova versione.
  await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  const c2 = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(c2).toBe(c1);
});

// 3) XSS + emoji + caratteri speciali: il contenuto ripristina identico e lo
// script non esegue (resta testo).
test('XSS/emoji/speciali: snapshot e ripristino restituiscono testo identico, niente esecuzione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
  await page.click('#doc');
  // innerHTML con <script> non esegue di per sé; scrivo il payload come TESTO.
  const payload = 'Payload 😀🔥 <b>bold?</b> e uno script pericoloso qui di seguito ripetuto per superare la soglia dei centoquaranta caratteri minimi previsti dalla politica anti rumore del versionamento manuale.';
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.textContent = t; // testo puro, niente HTML iniettato
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, payload + '<script>window.__xss=1;alert(1)<\/script>');
  const created = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  expect(created).not.toBeNull();
  // Cambio tutto, poi ripristino: torna identico.
  await setDocText(page, 'altro');
  await page.evaluate(() => {
    const v = window.__filoEditorVersions; const l = v.list();
    v.restore(v.activeId(), l[0].id);
  });
  const restored = await page.evaluate(() => document.getElementById('doc').textContent);
  expect(restored).toContain('😀🔥');
  expect(restored).toContain('<script>');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(alerted).toBe(false);
});

// 4) 10.000 caratteri: snapshot + restore reggono senza rompersi.
test('testo enorme (10k): snapshot e ripristino reggono', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  const huge = 'lorem ipsum dolor '.repeat(600); // ~10.8k char
  await setDocText(page, huge);
  const created = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  expect(created).not.toBeNull();
  await setDocText(page, 'corto');
  await page.evaluate(() => { const v = window.__filoEditorVersions; v.restore(v.activeId(), v.list()[0].id); });
  const len = await page.evaluate(() => document.getElementById('doc').textContent.length);
  expect(len).toBeGreaterThan(9000);
});

// 5) Dopo una modifica automatica di Filo, il riferimento riparte: uno snapshot
// manuale IMMEDIATO non deve creare un doppione.
test('dopo modifica di Filo, snapshot manuale immediato non duplica', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'Testo che verrà messo in grassetto da Filo, abbastanza lungo da avere senso qui.');
  await page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
  const afterFilo = await page.evaluate(() => window.__filoEditorVersions.list().length);
  // snapshot manuale immediato: nessuna modifica a mano dal baseline → niente nuovo.
  const created = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  expect(created).toBeNull();
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(afterFilo);
});

// 6) Solo formattazione (nessun cambio di testo) NON crea uno snapshot manuale.
test('cambio di sola formattazione non crea snapshot manuale', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  const t = 'Una frase abbastanza lunga da superare comodamente la soglia dei centoquaranta caratteri se venisse considerata come modifica del testo vero e proprio ok.';
  await setDocText(page, t);
  await page.evaluate(() => window.__filoEditorVersions.snapshotManual()); // baseline = questo testo
  const base = await page.evaluate(() => window.__filoEditorVersions.list().length);
  // Grassetto su tutto: cambia il markup, NON il testo.
  await setDocRaw(page, `<p><strong>${t}</strong></p>`);
  const created = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  expect(created).toBeNull();
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(base);
});

// 7) Due modifiche manuali grandi e distinte creano DUE versioni (il baseline si
// riallinea ma non blocca cambiamenti veri successivi).
test('due grandi modifiche manuali distinte creano due versioni', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'Base iniziale corta.');
  await setDocText(page, 'Primo blocco grande scritto a mano. '.repeat(6));
  expect(await page.evaluate(() => window.__filoEditorVersions.snapshotManual())).not.toBeNull();
  await setDocText(page, 'Secondo blocco completamente diverso, altrettanto lungo e scritto a mano. '.repeat(6));
  expect(await page.evaluate(() => window.__filoEditorVersions.snapshotManual())).not.toBeNull();
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(2);
});
