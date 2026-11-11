// Installing the app to the home screen, and the service worker that lets it
// open offline.
//
// Chrome, Edge and Android offer an install prompt that a button can trigger.
// Safari on iPhone and iPad has no such prompt: the person has to use the
// Share menu, so there the app can only show the steps.
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Already running as an installed app. */
  installed: boolean;
  /** The browser has offered an install prompt this page can trigger. */
  canPrompt: boolean;
  /** iPhone or iPad Safari, where installing is done from the Share menu. */
  ios: boolean;
}

let deferred: InstallPromptEvent | null = null;
let state: InstallState = { installed: false, canPrompt: false, ios: false };
const listeners = new Set<() => void>();

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function standalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPads report as a Mac with a touch screen.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Call once at start-up. */
export function setUpInstall() {
  set({ installed: standalone(), ios: isIos() });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // Keep it for our own button instead of the browser's banner.
    deferred = event as InstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ installed: true, canPrompt: false });
  });
  // The service worker is only built into the production app.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    });
  }
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Shows the browser's install prompt. Resolves true if the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  set({ canPrompt: false });
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}
