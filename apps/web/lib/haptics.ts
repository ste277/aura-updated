import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

// In the native shells, use the OS haptic engine — navigator.vibrate is a
// silent no-op in iOS webviews and coarse on Android. On plain web, fall back
// to the Vibration API where it exists.
export function triggerHaptic(type: 'success' | 'warning' | 'light' = 'light') {
  if (typeof window === 'undefined') return;

  if (Capacitor.isNativePlatform()) {
    // Fire-and-forget; haptics failing should never affect the UI.
    switch (type) {
      case 'success':
        Haptics.notification({ type: NotificationType.Success }).catch(() => {});
        break;
      case 'warning':
        Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
        break;
      case 'light':
      default:
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
        break;
    }
    return;
  }

  if (!('navigator' in window) || !navigator.vibrate) return;

  switch (type) {
    case 'success':
      navigator.vibrate([15, 30, 15]); // Soft double-tap
      break;
    case 'warning':
      navigator.vibrate([40, 20, 40]); // Attention pulse
      break;
    case 'light':
    default:
      navigator.vibrate(12); // Single light tap
      break;
  }
}
