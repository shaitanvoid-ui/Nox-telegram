import {
  init,
  retrieveRawInitData,
  miniApp,
  viewport,
  backButton,
  hapticFeedback,
  themeParams,
} from "@tma.js/sdk-react";
let ready = false;
export function initializeTelegram(): string | undefined {
  try {
    const raw = retrieveRawInitData();
    if (!raw) return;
    if (!ready) {
      init();
      if (miniApp.mount.isAvailable()) miniApp.mount();
      if (themeParams.mount.isAvailable()) themeParams.mount();
      if (themeParams.bindCssVars.isAvailable()) themeParams.bindCssVars();
      const syncChrome = () => {
        if (
          miniApp.setHeaderColor.isAvailable() &&
          miniApp.setHeaderColor.supports("rgb")
        )
          miniApp.setHeaderColor("#090B11");
        if (miniApp.setBgColor.isAvailable()) miniApp.setBgColor("#090B11");
        if (miniApp.setBottomBarColor.isAvailable())
          miniApp.setBottomBarColor("#111520");
      };
      syncChrome();
      themeParams.state.sub(syncChrome);
      miniApp.isActive.sub((active) => {
        document.documentElement.dataset.telegramActive = String(active);
      });
      if (miniApp.ready.isAvailable()) miniApp.ready();
      if (viewport.mount.isAvailable())
        void viewport
          .mount()
          .then(() => {
            if (viewport.bindCssVars.isAvailable()) viewport.bindCssVars();
            if (viewport.expand.isAvailable()) viewport.expand();
          })
          .catch(() => undefined);
      if (backButton.mount.isAvailable()) backButton.mount();
      ready = true;
    }
    return raw;
  } catch {
    return undefined;
  }
}
export function haptic() {
  try {
    if (ready && hapticFeedback.impactOccurred.isAvailable())
      hapticFeedback.impactOccurred("light");
  } catch {
    /* Haptics remain optional on older clients. */
  }
}
export function syncBackButton(show: boolean, back: () => void): () => void {
  if (!ready) return () => undefined;
  try {
    if (show && backButton.show.isAvailable()) backButton.show();
    else if (backButton.hide.isAvailable()) backButton.hide();
    if (backButton.onClick.isAvailable()) return backButton.onClick(back);
  } catch {
    /* Browser and older Telegram clients retain the visible web navigation. */
  }
  return () => undefined;
}

export function trackKeyboardViewport() {
  const visual = window.visualViewport;
  if (!visual) return;
  const update = () => {
    document.documentElement.style.setProperty(
      "--visual-height",
      `${visual.height}px`,
    );
    document.documentElement.dataset.keyboard = String(
      window.innerHeight - visual.height > 150,
    );
  };
  visual.addEventListener("resize", update);
  update();
}
