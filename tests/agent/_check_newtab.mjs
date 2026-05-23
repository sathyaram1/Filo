import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  // Open a NEW tab directly to an external URL (this uses PAGE_PRELOAD + contextIsolation:true)
  await d.openTab(app, shell, 'https://example.com');
  await d.sleep(4000);
  const view = await d.activeView(app, shell);
  if (view) {
    // With contextIsolation:true, view.evaluate runs in main world,
    // not preload context. SN_MENU won't be visible, but the DOM is shared.
    const result = await view.evaluate(() => {
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 300, clientY: 250, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          const menu = document.querySelector('.sn-menu');
          resolve({
            filoReady: document.documentElement.dataset.filoReady,
            filoModules: document.documentElement.dataset.filoModules,
            snTheme: document.documentElement.dataset.snTheme,
            stylesLoaded: document.querySelectorAll('link[href*="filo://style"]').length,
            menuFound: !!menu,
            menuChildren: menu ? menu.children.length : 0,
          });
        }, 500);
      });
    });
    console.log('NEW-TAB RESULT:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
