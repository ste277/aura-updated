'use client';

import React from 'react';
import { LoginScreen } from '../../../components/LoginScreen';

/** Signs in with the existing LoginScreen, then goes back to the (validated) consent page. */
export function ConnectSignInClient({ returnTo }: { returnTo: string | null }) {
  return (
    <main style={{ maxWidth: 480, margin: '48px auto', padding: '0 16px', fontFamily: 'var(--as-font-body)', color: 'var(--as-text)' }}>
      <h1 style={{ fontSize: 22 }}>Sign in to connect an assistant</h1>
      {returnTo ? (
        <p>After you sign in, you will return to the connection request to allow or deny it.</p>
      ) : (
        <p>This sign-in link is not valid. Return to your assistant and start connecting again.</p>
      )}
      {returnTo ? <LoginScreen onLoggedInCheck={() => window.location.assign(returnTo)} /> : null}
    </main>
  );
}
