// Aprire una scheda di Gestione da spec: le schede di un'altra sezione sono nascoste, si passa dalla sezione.
// Un clic in più su una scheda già aperta rifarebbe il suo caricamento pigro: chi conta le chiamate lo vedrebbe.

export async function apriScheda(page, tab) {
  const scheda = page.locator(`.mg-tab[data-tab="${tab}"]`);
  if (!(await scheda.isVisible())) {
    const sezione = await page.evaluate((t) => window.SN_MANAGE_REVIEW.sezioneDiScheda(t), tab);
    await page.locator(`.mg-sezione[data-sezione="${sezione}"]`).click();
    if (await scheda.evaluate((b) => b.classList.contains('mg-tab--active'))) return;
  }
  await scheda.click();
}
