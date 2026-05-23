import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(5000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      const cs = {
        filoReady: document.documentElement.dataset.filoReady,
        filoCS: document.documentElement.dataset.filoContentScripts,
        snTheme: document.documentElement.dataset.snTheme,
        stylesCount: document.querySelectorAll('link[href*="filo://style"]').length,
        hasSNMenu: typeof window.SN_MENU !== 'undefined',
        hasSNConst: typeof window.SN_CONST !== 'undefined',
        chromeId: window.chrome?.runtime?.id,
        url: location.href,
      };
      // Try dispatching contextmenu
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 400, clientY: 400, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          const menu = document.querySelector('.sn-menu');
          cs.menuFound = !!menu;
          cs.menuChildren = menu ? menu.children.length : 0;
          // Check for errors in console
          resolve(cs);
        }, 1000);
      });
    });
    console.log('YOUTUBE:', JSON.stringify(result, null, 2));
  }

  // Now test Reddit
  await d.navigate(app, shell, 'https://www.reddit.com');
  await d.sleep(5000);
  const view2 = await d.activeView(app, shell);
  if (view2) {
    const result2 = await view2.evaluate(() => {
      const cs = {
        filoReady: document.documentElement.dataset.filoReady,
        snTheme: document.documentElement.dataset.snTheme,
        stylesCount: document.querySelectorAll('link[href*="filo://style"]').length,
        hasSNMenu: typeof window.SN_MENU !== 'undefined',
        chromeId: window.chrome?.runtime?.id,
      };
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 400, clientY: 400, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          cs.menuFound = !!document.querySelector('.sn-menu');
          resolve(cs);
        }, 1000);
      });
    });
    console.log('REDDIT:', JSON.stringify(result2, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
