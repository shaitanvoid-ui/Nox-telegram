import { afterEach, describe, expect, it, vi } from "vitest";
import {
  haptic,
  initializeTelegram,
  syncBackButton,
  trackKeyboardViewport,
} from "../src/telegram";

describe("ordinary browser and older-client fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.keyboard;
    document.documentElement.style.removeProperty("--visual-height");
  });

  it("does not fabricate Telegram credentials in an ordinary browser", () => {
    expect(initializeTelegram()).toBeUndefined();
    expect(() => haptic()).not.toThrow();
    const navigate = vi.fn();
    expect(() => syncBackButton(true, navigate)()).not.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("adjusts usable height when the keyboard covers the visual viewport", () => {
    const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
    let resize: (() => void) | undefined;
    const viewport = {
      height: 400,
      addEventListener: vi.fn((_name: string, callback: () => void) => {
        resize = callback;
      }),
    };
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
    try {
      trackKeyboardViewport();
      expect(
        document.documentElement.style.getPropertyValue("--visual-height"),
      ).toBe("400px");
      expect(document.documentElement.dataset.keyboard).toBe("true");
      viewport.height = window.innerHeight;
      resize?.();
      expect(document.documentElement.dataset.keyboard).toBe("false");
    } finally {
      if (original) Object.defineProperty(window, "visualViewport", original);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });
});
