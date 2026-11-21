package com.greenarrow.auraschedule;

import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;
import java.io.IOException;
import java.util.Map;

/**
 * AURA-MOBILE-01-AND-ERR-01: cause-specific, recoverable error handling for the
 * remote-URL Capacitor shell.
 *
 * Capacitor 6.2.1's BridgeWebViewClient loads the single `server.errorPath` page for
 * EVERY main-frame load error and EVERY main-frame HTTP error, so an old WebView, a
 * dropped connection and an ordinary 404 all showed the same page, with no way to
 * retry (AND-MIN-01-R4 findings F1/F2). This subclass changes only the failure paths:
 *
 *  - Main-frame network error (offline, server unreachable, timeout) and HTTP 5xx:
 *    load the bundled connection page (CONNECTION_PAGE) instead of errorPath.
 *  - Main-frame HTTP 4xx (incl. 404): do NOT replace the response, so the app's own
 *    not-found page (or the server's error body) is shown.
 *  - The WebView minimum-version guard is untouched: Bridge.loadWebView() still loads
 *    errorPath (unsupported-webview.html) before any remote load when the WebView is
 *    below android.minWebViewVersion. That page is now WebView-specific.
 *  - Retry: the connection page links to RETRY_PATH on the local origin. A tap is
 *    intercepted here (never fetched) and performs exactly one reload of the URL that
 *    failed (or the app URL), after re-checking the WebView floor. No automatic retry
 *    loop: retries happen only on a user tap or when the user returns to the app
 *    (MainActivity.onRestart).
 *
 * Successful loads, sub-resource errors, navigation policy (launchIntent), the local
 * server, cookies and plugins are delegated to Capacitor unchanged.
 */
public class AuraWebViewClient extends BridgeWebViewClient {

    static final String CONNECTION_PAGE = "connection-error.html";
    static final String RETRY_PATH = "/__aura/retry";
    private static final String ASSET_DIR = "public/";
    private static final String TAG = "AuraWebViewClient";

    private final Bridge bridge;
    private String lastFailedUrl;
    private boolean retryPending;
    /** URL of the current main-frame page if it is a kept HTTP 4xx response (e.g. the app's 404). */
    private String keptHttpErrorUrl;

    public AuraWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    /** Local origin that Capacitor's own errorPath uses, e.g. https://localhost. */
    private String localOrigin() {
        return bridge.getScheme() + "://" + bridge.getHost();
    }

    String connectionPageUrl() {
        return localOrigin() + "/" + CONNECTION_PAGE;
    }

    private boolean isLocal(Uri uri) {
        return uri != null && bridge.getScheme().equals(uri.getScheme()) && bridge.getHost().equals(uri.getHost());
    }

    /** True while one of the bundled fallback pages (connection page or WebView-floor page) is shown. */
    boolean isFallbackUrl(String url) {
        if (url == null) return false;
        String errorUrl = bridge.getErrorUrl();
        return url.equals(connectionPageUrl()) || (errorUrl != null && url.equals(errorUrl));
    }

    boolean isConnectionPage(String url) {
        return url != null && url.equals(connectionPageUrl());
    }

    /**
     * True while the main frame shows a kept HTTP 4xx response (e.g. Next's default 404 page).
     * Such pages may mount no back handler while a stale JS backButton listener from the previous
     * page is still registered natively, so MainActivity handles Back for them (review F1).
     */
    boolean isKeptHttpErrorPage(String url) {
        return url != null && url.equals(keptHttpErrorUrl);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        // Capacitor serves only errorPath locally when server.url is set; serve the connection page ourselves.
        if (isLocal(url) && ("/" + CONNECTION_PAGE).equals(url.getPath())) {
            try {
                return new WebResourceResponse("text/html", "utf-8", bridge.getContext().getAssets().open(ASSET_DIR + CONNECTION_PAGE));
            } catch (IOException e) {
                Logger.error(TAG, "connection page asset missing", e);
                return null;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        // "Try again" link: only honoured from the connection page; never fetched.
        if (isLocal(url) && RETRY_PATH.equals(url.getPath())) {
            if (isConnectionPage(view.getUrl())) retry(view);
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }

    @Override
    public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        // A new main-frame load clears the kept-4xx marker, unless this is the very load that
        // just reported the kept 4xx: WebView may deliver onReceivedHttpError (response
        // headers) before onPageStarted for the same navigation.
        if (url == null || !url.equals(keptHttpErrorUrl)) keptHttpErrorUrl = null;
        Uri uri = url == null ? null : Uri.parse(url);
        // Defence in depth: a programmatic navigation to RETRY_PATH (not a user tap, so not
        // seen by shouldOverrideUrlLoading) must never fetch it or reach the app. Show the
        // correct fallback instead: WebView-floor page if the WebView is too old, else the
        // connection page (where the user can tap Try again).
        if (isLocal(uri) && RETRY_PATH.equals(uri.getPath())) {
            view.stopLoading();
            String errorUrl = bridge.getErrorUrl();
            view.loadUrl(!bridge.isMinimumWebViewInstalled() && errorUrl != null ? errorUrl : connectionPageUrl());
        }
    }

    /** One retry of the failed URL (or the app URL). Re-checks the WebView floor first. */
    void retry(WebView view) {
        if (!bridge.isMinimumWebViewInstalled()) {
            String errorUrl = bridge.getErrorUrl();
            if (errorUrl != null) view.loadUrl(errorUrl);
            return;
        }
        String target = lastFailedUrl != null ? lastFailedUrl : bridge.getAppUrl();
        Logger.info(TAG, "retry requested");
        retryPending = true;
        view.loadUrl(target);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        if (isFallbackUrl(url)) {
            // Keep the fallback as the only history entry: earlier entries need the unavailable service.
            view.clearHistory();
        } else if (retryPending && url != null && !isLocal(Uri.parse(url))) {
            // Recovered: drop the fallback page from history so app back-navigation cannot return to it.
            retryPending = false;
            lastFailedUrl = null;
            view.clearHistory();
        }
    }

    /**
     * Same request, reported as a sub-frame request. Passing it to Capacitor's super
     * implementation keeps Capacitor's WebViewListener notifications (its listener list
     * is package-private) while skipping its blanket main-frame errorPath load.
     */
    private static WebResourceRequest asSubFrame(final WebResourceRequest r) {
        return new WebResourceRequest() {
            @Override public Uri getUrl() { return r.getUrl(); }
            @Override public boolean isForMainFrame() { return false; }
            @Override public boolean isRedirect() { return r.isRedirect(); }
            @Override public boolean hasGesture() { return r.hasGesture(); }
            @Override public String getMethod() { return r.getMethod(); }
            @Override public Map<String, String> getRequestHeaders() { return r.getRequestHeaders(); }
        };
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) {
            super.onReceivedError(view, request, error); // sub-resource: Capacitor only notifies listeners
            return;
        }
        super.onReceivedError(view, asSubFrame(request), error); // listeners only
        if (isLocal(request.getUrl())) return; // never loop on a local page
        retryPending = false;
        lastFailedUrl = request.getUrl().toString();
        Logger.info(TAG, "main-frame load error code=" + error.getErrorCode() + " -> connection page");
        view.loadUrl(connectionPageUrl());
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (!request.isForMainFrame()) {
            super.onReceivedHttpError(view, request, errorResponse);
            return;
        }
        super.onReceivedHttpError(view, asSubFrame(request), errorResponse); // listeners only
        int status = errorResponse.getStatusCode();
        if (isLocal(request.getUrl()) || status < 500) {
            // 4xx (incl. 404): keep the server's own response page, e.g. the app's not-found page.
            if (!isLocal(request.getUrl())) keptHttpErrorUrl = request.getUrl().toString();
            Logger.info(TAG, "main-frame HTTP " + status + " -> server response kept");
            return;
        }
        retryPending = false;
        lastFailedUrl = request.getUrl().toString();
        Logger.info(TAG, "main-frame HTTP " + status + " -> connection page");
        view.loadUrl(connectionPageUrl());
    }
}
