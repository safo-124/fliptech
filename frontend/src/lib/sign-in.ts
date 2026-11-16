/**
 * Ask for a sign-in, here, without leaving the page.
 *
 * Any component calls `openSignIn()` at the moment an account is needed
 * (following a shop, starting a course, messaging a seller). The one
 * SignInSheet in the root layout answers: phone, code, and for someone new,
 * their name and what brought them. The promise resolves true once they are
 * signed in, false if they close the sheet, and the caller carries on with
 * what they were doing.
 *
 * `role: "trainee"` also makes the login a trainee, for anything to do with
 * learning, so a course started next needs no second sign-in.
 */

export type SignInRequest = {
  /** One line on why, e.g. "Sign in to follow this shop." */
  reason?: string;
  role?: "trainee";
  /** Ticked in advance on "What brings you here?" for someone new. */
  interest?: "learn" | "teach" | "buy" | "sell";
};

type Pending = SignInRequest & {resolve: (signedIn: boolean) => void};

let listener: ((request: Pending) => void) | null = null;

/** Used by SignInSheet only. */
export function onSignInRequest(handler: (request: Pending) => void) {
  listener = handler;
  return () => {
    if (listener === handler) listener = null;
  };
}

export function openSignIn(request: SignInRequest = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      // No sheet on this page (should not happen): the full sign-in page.
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/account?next=${next}`;
      resolve(false);
      return;
    }
    listener({...request, resolve});
  });
}

/** Fired whenever someone signs in or out, so the header can catch up. */
export const SESSION_CHANGED = "fliiptech:session-changed";

export function announceSessionChange() {
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

/** Fired by every sign-out. The header forgets the person at once, without
    waiting for the server or the next page. */
export const SIGNED_OUT = "fliiptech:signed-out";

export function announceSignedOut() {
  // Not SESSION_CHANGED: that asks the server who is signed in, and this
  // fires before the sign-out request has reached it. Never in the way of
  // signing out, whatever the page is.
  try {
    window.dispatchEvent(new Event(SIGNED_OUT));
  } catch {
    // No window to tell: nothing is showing a name.
  }
}
