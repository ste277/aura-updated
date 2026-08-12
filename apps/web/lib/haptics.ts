export function triggerHaptic(type: 'success' | 'warning' | 'light' = 'light') {
  if (typeof window === 'undefined' || !('navigator' in window) || !navigator.vibrate) {
    return;
  }

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