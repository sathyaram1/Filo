// La prima finestra di Filo, col suo documento già lì: da Electron 44 Playwright la annuncia appena nasce, ancora vuota,
// e chi la usava subito si trovava in mano una pagina che di lì a poco navigava via («Execution context was destroyed»).
// Ogni lancio sotto tests/ passa di qui, non da `app.firstWindow()`: sentinella in tests/unit/primaFinestra.test.mjs.

export async function primaFinestra(app, { timeout = 30_000 } = {}) {
  const finestra = await app.firstWindow({ timeout });
  const scadenza = Date.now() + timeout;
  for (;;) {
    const url = finestra.url();
    if (url && url !== 'about:blank') break;
    if (finestra.isClosed()) throw new Error('primaFinestra: la finestra si è chiusa prima di avere un documento');
    if (Date.now() > scadenza) throw new Error(`primaFinestra: nessun documento dopo ${timeout} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
  await finestra.waitForLoadState('domcontentloaded', { timeout: Math.max(1, scadenza - Date.now()) });
  return finestra;
}
