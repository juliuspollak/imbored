// iOS WKWebView moves focus from the textarea to a tapped submit button before
// the click/default form submit completes. Because the keyboard resizes the
// WebView, that focus change can move the button out from under the finger: the
// first tap only dismisses the keyboard and the user has to tap Send again.
//
// For touch input, submit the existing React form on pointer-down while the
// textarea is still the active element and cancel only the native focus change.
// The form's normal onSubmit handler remains the single send path.
if (typeof document !== "undefined" && !globalThis.__imboredChatSendFocusGuard) {
  globalThis.__imboredChatSendFocusGuard = true;

  const submittedOnPointerDown = new WeakMap();

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;

    const sendButton = event.target?.closest?.(".chat-send");
    if (!sendButton || sendButton.disabled) return;

    const form = sendButton.closest("form.chat-composer");
    const input = form?.querySelector(".chat-input");
    if (!form || !input || document.activeElement !== input) return;

    // Prevent the button becoming first responder / blurring the textarea.
    // requestSubmit keeps validation and React's existing onSubmit behaviour.
    event.preventDefault();
    submittedOnPointerDown.set(sendButton, performance.now());
    form.requestSubmit(sendButton);
  }, true);

  document.addEventListener("click", (event) => {
    const sendButton = event.target?.closest?.(".chat-send");
    if (!sendButton) return;

    const submittedAt = submittedOnPointerDown.get(sendButton);
    if (submittedAt == null) return;
    submittedOnPointerDown.delete(sendButton);

    // A compatibility click may still follow the cancelled touch pointerdown.
    // Suppress only that duplicate default submit; React's form submit already ran.
    if (performance.now() - submittedAt < 1500) event.preventDefault();
  }, true);
}
