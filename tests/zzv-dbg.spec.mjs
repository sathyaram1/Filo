import { test } from './fixtures/electron.mjs';

// Sonda: quanto ci mette il caricamento VERO (Firestore + decifratura) della
// pagina feedback a lasciare lo stato "Caricamento…".
for (const n of [1, 2, 3]) {
  test(`sonda caricamento ${n}`, async ({ openTab }) => {
    const page = await openTab('filo://feedback/feedback.html');
    const t0 = Date.now();
    try {
      await page.waitForFunction(() => {
        const e = document.querySelector('.fb-empty');
        return !e || !/Caricamento/.test(e.textContent || '');
      }, null, { timeout: 40000 });
      console.log(`SONDA ${n}: caricamento finito in ${Date.now() - t0} ms`);
    } catch (_) {
      console.log(`SONDA ${n}: ancora "Caricamento…" dopo 40000 ms`);
    }
  });
}
