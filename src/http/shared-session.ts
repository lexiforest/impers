/**
 * Shared session used by standalone request helpers
 */

import { Session } from "./session.js";

let sharedSession: Session | null = null;

/**
 * Get or create a shared session for standalone requests
 */
export function getSharedSession(): Session {
  if (!sharedSession) {
    sharedSession = new Session();
  }
  return sharedSession;
}

/**
 * Close the shared session (call this when your application exits)
 */
export async function closeSharedSession(): Promise<void> {
  if (sharedSession) {
    await sharedSession.close();
    sharedSession = null;
  }
}