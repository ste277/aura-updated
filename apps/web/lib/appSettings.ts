/**
 * AURA-MOBILE-01-M2-D -- opens this app's own system Settings page (App
 * info -> Permissions) so a user who permanently denied location can turn
 * it back on. Backed by a small local Capacitor plugin in the Android
 * project (android/app/src/main/java/com/greenarrow/auraschedule/
 * AppSettingsPlugin.java) -- no new npm dependency. It never changes a
 * permission itself; the user decides in Settings.
 *
 * Android only for now: iOS has no native implementation registered, so
 * the UI must check isAppSettingsSupported() before offering the action.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface AppSettingsPlugin {
  open(): Promise<void>;
}

const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

export function isAppSettingsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** Resolves true if the Settings page was opened, false otherwise (never throws). */
export async function openAppSettings(): Promise<boolean> {
  if (!isAppSettingsSupported()) return false;
  try {
    await AppSettings.open();
    return true;
  } catch {
    return false;
  }
}
