'use client';

import React, { useEffect, useState } from 'react';

interface WindowShiftToastProps {
  activeWindowName: string;
}

export function WindowShiftToast({ activeWindowName }: WindowShiftToastProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [prevWindow, setPrevWindow] = useState<string>(activeWindowName);

  useEffect(() => {
    if (activeWindowName && activeWindowName !== prevWindow) {
      const cleanName = activeWindowName.replace('_', ' ').toUpperCase();
      setToastMessage(`Solar Shift: Entered ${cleanName} Window`);
      setPrevWindow(activeWindowName);

      // Trigger browser native push notification if permission granted
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Solar Phase Shift', {
          body: `Now entering ${cleanName} window. Check optimal activities in your timeline.`,
          icon: '/favicon.ico',
        });
      }

      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [activeWindowName, prevWindow]);

  if (!toastMessage) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(74, 222, 128, 0.5)',
        boxShadow: '0 0 20px rgba(74, 222, 128, 0.25)',
        borderRadius: 24,
        padding: '10px 20px',
        color: '#4ade80',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: 'sans-serif',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backdropFilter: 'blur(12px)',
      }}
    >
      <span>⚡</span>
      <span>{toastMessage}</span>
    </div>
  );
}