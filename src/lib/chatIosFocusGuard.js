// WKWebView can visibly resize/reposition the keyboard accessory area when a
// focused textarea is focused again after an async send completes. Chat keeps
// the same textarea mounted, so a second focus() while it is already active is
// redundant and can be ignored safely.
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.__imboredChatFocusGuard) {
  const nativeFocus = HTMLElement.prototype.focus;

  Object.defineProperty(HTMLElement.prototype, "__imboredChatFocusGuard", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  HTMLElement.prototype.focus = function guardedFocus(...args) {
    if (
      typeof document !== "undefined"
      && document.activeElement === this
      && this instanceof HTMLTextAreaElement
      && this.classList?.contains("chat-input")
    ) {
      return;
    }

    return nativeFocus.apply(this, args);
  };
}
