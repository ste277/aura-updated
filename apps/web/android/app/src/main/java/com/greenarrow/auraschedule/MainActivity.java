package com.greenarrow.auraschedule;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Matches capacitor.config.ts backgroundColor and the web app's themeColor.
    private static final int SYSTEM_BAR_BACKGROUND = Color.parseColor("#090d16");

    private AuraWebViewClient auraWebViewClient;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // AURA-MOBILE-01-M2-D: local plugin for the location "Open Settings"
        // recovery action. Must be registered before super.onCreate().
        registerPlugin(AppSettingsPlugin.class);
        super.onCreate(savedInstanceState);

        // AURA-MOBILE-01-AND-ERR-01: cause-specific, recoverable error pages
        // (see AuraWebViewClient). Installed before any WebView callback can run.
        auraWebViewClient = new AuraWebViewClient(bridge);
        bridge.setWebViewClient(auraWebViewClient);

        // AND-TARGET-01: keep page content clear of the system bars, cutouts and keyboard.
        applyEdgeToEdgeInsets();

        // Back on a bundled fallback page closes this screen instead of being
        // swallowed (the App plugin's callback does nothing there). Reopening the
        // app starts a fresh load. On a kept full-page HTTP 4xx page Back returns to
        // the previous page (or closes the screen if there is none). Everywhere else
        // Back is passed on unchanged to the next callback (Capacitor App plugin ->
        // the app's own handler).
        // Added after super.onCreate(), so it takes priority over the App plugin's callback.
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        String url = bridge.getWebView().getUrl();
                        if (auraWebViewClient.isFallbackUrl(url)) {
                            finish();
                            return;
                        }
                        // Kept full-page HTTP 4xx (e.g. the app's 404 page): a stale JS back
                        // listener from the previous page would swallow Back, so go back natively.
                        if (auraWebViewClient.isKeptHttpErrorPage(url)) {
                            if (bridge.getWebView().canGoBack()) bridge.getWebView().goBack();
                            else finish();
                            return;
                        }
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                }
            );
    }

    /**
     * AURA-ANDROID-AND-TARGET-01: apps targeting API 35+ are always drawn edge-to-edge
     * (no opt-out at API 36), and Capacitor 6 does not handle insets. The same layout is
     * used on API 29-34 so every supported version behaves alike.
     *
     * The WebView gets margins equal to the system bars and display cutout, with the bottom
     * margin raised to the keyboard height while it is open. Margins, not padding: WebView
     * content scrolls underneath its own padding. The insets are then consumed, so the page
     * sees env(safe-area-inset-*) = 0 and its CSS does not pad a second time. The uncovered
     * area behind the bars shows the app's dark background with light bar icons.
     */
    private void applyEdgeToEdgeInsets() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setBackgroundDrawable(new ColorDrawable(SYSTEM_BAR_BACKGROUND));
        if (Build.VERSION.SDK_INT < 35) {
            // No effect from API 35; below it, let the dark window background show through.
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        View webView = bridge.getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            ViewGroup.LayoutParams lp = v.getLayoutParams();
            if (lp instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams m = (ViewGroup.MarginLayoutParams) lp;
                int bottom = Math.max(safe.bottom, ime.bottom);
                if (m.leftMargin != safe.left || m.topMargin != safe.top || m.rightMargin != safe.right || m.bottomMargin != bottom) {
                    m.setMargins(safe.left, safe.top, safe.right, bottom);
                    v.setLayoutParams(m);
                }
            }
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);
    }

    /**
     * AURA-ANDROID-REL-04 (fresh-process session state; IR-04): ask the WebView to persist
     * its cookie store whenever the app leaves the foreground. Chromium writes cookie
     * changes to disk lazily (batched), so a sign-in or sign-out followed quickly by the
     * process being killed could leave the previous cookie on disk. This is BEST-EFFORT
     * persistence, not a durability guarantee: flush() is asynchronous on some WebView
     * versions, a kill during or before onPause (or a delayed logout response that lands
     * after it) is not covered, and nothing here confirms the write. Session safety does
     * not depend on it: the server-side account boundary and the sign-out transition do
     * (lib/accountSession.ts, lib/expectedAccount.ts). Device acceptance D-S2 checks the
     * real behaviour. flush() only writes; it changes no cookie.
     */
    @Override
    public void onPause() {
        super.onPause();
        flushCookies();
    }

    static void flushCookies() {
        try {
            CookieManager.getInstance().flush();
        } catch (RuntimeException e) {
            // No WebView provider (being updated or disabled): nothing to persist.
        }
    }

    @Override
    public void onRestart() {
        super.onRestart();
        // AND-ERR-01: returning to the app while the connection page is shown retries
        // once (user-initiated; no automatic loop).
        if (auraWebViewClient != null && auraWebViewClient.isConnectionPage(bridge.getWebView().getUrl())) {
            auraWebViewClient.retry(bridge.getWebView());
        }
    }
}
