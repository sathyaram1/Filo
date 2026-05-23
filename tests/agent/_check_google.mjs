import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.google.com');
  await d.sleep(4000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      // Check content script state
      const cs = {
        filoReady: document.documentElement.dataset.filoReady,
        hasSNMenu: typeof window.SN_MENU !== 'undefined',
        hasChrome: typeof window.chrome !== 'undefined',
        chromeId: window.chrome?.runtime?.id,
        stylesLoaded: document.querySelectorAll('link[href*="filo://style"]').length,
        snTheme: document.documentElement.dataset.snTheme,
      };
      // Dispatch contextmenu
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 400, clientY: 300, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          const menu = document.querySelector('.sn-menu');
          cs.menuFound = !!menu;
          cs.menuVisible = menu ? getComputedStyle(menu).display !== 'none' : false;
          cs.menuBg = menu ? getComputedStyle(menu).backgroundColor : null;
          resolve(cs);
        }, 500);
      });
    });
    console.log('GOOGLE RESULT:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
