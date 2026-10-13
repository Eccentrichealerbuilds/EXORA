// Credential Manager temporarily hides the WebView while EXORA is still in
// its own authentication flow. Keep that lifecycle transition out of app lock.
let activePrompts = 0;

export const systemPromptActive = () => activePrompts > 0;

export async function withSystemPrompt<T>(operation: () => Promise<T>): Promise<T> {
  activePrompts += 1;
  try {
    return await operation();
  } finally {
    // Android can deliver the credential result before the WebView is visible.
    // Release on its first rendered frame, after the return transition, on
    // success, cancellation, or error. No timed window bypasses future locks.
    requestAnimationFrame(() => { activePrompts -= 1; if (activePrompts === 0) window.dispatchEvent(new Event("exora-system-prompt-finished")); });
  }
}
