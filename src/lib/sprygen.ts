import { SprygenAPI } from "../../shared/types";

declare global {
  interface Window {
    sprygen?: SprygenAPI;
  }
}

/**
 * True when the preload script bridged the IPC API into the renderer.
 *
 * When this is false the app refuses to render normally: there is deliberately
 * **no fallback/mock API** here any more. A silent fallback used to fabricate
 * empty tasks, empty chats and fake "answers", which looked like the app was
 * working while it was actually broken. Missing bridge = blocking error screen.
 */
export function bridgeAvailable(): boolean {
  return typeof window !== "undefined" && !!window.sprygen;
}

/**
 * The renderer's only access to the main process. If the preload bridge is
 * missing this is an empty object, so any call throws a `TypeError` instead of
 * returning fabricated data. Guard with {@link bridgeAvailable} at the root and
 * render `<BridgeError />`.
 */
export const sprygen: SprygenAPI = (bridgeAvailable() ? window.sprygen! : {}) as SprygenAPI;
