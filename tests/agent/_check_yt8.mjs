import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      // Monkey-patch SN_MENU.close to trace who calls it
      const origClose = SN_MENU.close;
      const closeLog = [];
      SN_MENU.close = function() {
        closeLog.push({
          time: Date.now(),
          stack: new Error().stack.split('\n').slice(1, 4).map(s => s.trim()),
        });
        return origClose.apply(this, arguments);
      };

      // Open menu
      SN_MENU.open({ x: 300, y: 300, items: [
        { type: 'item', label: 'Test', onClick: () => {} }
      ]});
      const menuRightAfter = !!document.querySelector('.sn-menu');

      return new Promise(resolve => {
        setTimeout(() => {
          const menuAfter = !!document.querySelector('.sn-menu');
          SN_MENU.close = origClose;
          resolve({
            menuRightAfter,
            menuAfter500ms: menuAfter,
            closeCallCount: closeLog.length,
            closeCalls: closeLog,
          });
        }, 500);
      });
    });
    console.log('YT CLOSE LOG:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
