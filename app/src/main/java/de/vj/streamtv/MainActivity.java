package de.vj.streamtv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Full-screen, remote-friendly shell that only opens JioHotstar.
 * All pages are JioHotstar's own website; this app just adds TV remote
 * navigation, a focus highlight and high-quality playback defaults.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "https://www.jiohotstar.com/";

    // Navigation is only allowed to these sites (and their sub-domains).
    private static final String[] ALLOWED_HOSTS = {
            "jiohotstar.com", "hotstar.com", "jio.com", "jiocinema.com"
    };

    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private String tvScript;
    private long lastBackAtRoot;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tvScript = readAsset("tv.js");
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        createWebView();
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(START_URL);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(desktopUserAgent(s.getUserAgentString()));

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "TVNative");
        web.setWebViewClient(new ShellClient());
        web.setWebChromeClient(new ShellChromeClient());
        web.requestFocus();
    }

    /**
     * The desktop site gets the full player with the highest quality ladder,
     * so the shell identifies itself as desktop Chrome (same engine version).
     */
    private static String desktopUserAgent(String original) {
        String version = "124.0.0.0";
        int i = original.indexOf("Chrome/");
        if (i >= 0) {
            int end = original.indexOf(' ', i);
            version = original.substring(i + 7, end > 0 ? end : original.length());
        }
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/" + version + " Safari/537.36";
    }

    private static boolean isAllowed(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme)) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase();
        for (String h : ALLOWED_HOSTS) {
            if (host.equals(h) || host.endsWith("." + h)) return true;
        }
        return false;
    }

    private void injectTvScript() {
        if (tvScript != null && web != null) {
            web.evaluateJavascript(tvScript, null);
        }
    }

    private void sendToPage(String js) {
        if (web != null) web.evaluateJavascript("window.__tv&&" + js, null);
    }

    // ---------------------------------------------------------------- keys

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;

        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (down && event.getRepeatCount() == 0) handleBack();
            return true;
        }

        String media = null;
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                media = "playpause"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: media = "play"; break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP: media = "pause"; break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD:
                media = "ff"; break;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD:
                media = "rw"; break;
            default: break;
        }
        if (media != null) {
            if (down) sendToPage("__tv.media('" + media + "')");
            return true;
        }

        // Make sure arrows / OK always reach the page.
        if (customView == null && web != null && !web.hasFocus()) web.requestFocus();
        return super.dispatchKeyEvent(event);
    }

    private void handleBack() {
        if (customView != null) {
            // Leave full-screen video first.
            web.evaluateJavascript("document.fullscreenElement&&document.exitFullscreen()", null);
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            return;
        }
        web.evaluateJavascript("window.__tv?__tv.back():false", value -> {
            if ("true".equals(value)) return;          // page handled it
            goBackOrExit();
        });
    }

    private void goBackOrExit() {
        if (web == null) return;
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (now - lastBackAtRoot < 2500) {
            finish();
        } else {
            lastBackAtRoot = now;
            Toast.makeText(this, "Press BACK again to exit", Toast.LENGTH_SHORT).show();
        }
    }

    // -------------------------------------------------------------- bridge

    private class Bridge {
        @JavascriptInterface
        public void goBack() {
            runOnUiThread(MainActivity.this::goBackOrExit);
        }

        @JavascriptInterface
        public void setPlaying(final boolean playing) {
            runOnUiThread(() -> {
                if (playing) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }

    // ------------------------------------------------------------- clients

    private class ShellClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (isAllowed(request.getUrl())) return false;
            if (request.isForMainFrame()) {
                Toast.makeText(MainActivity.this, "Only JioHotstar can be opened here",
                        Toast.LENGTH_SHORT).show();
                return true;
            }
            return false; // sub-frames (e.g. login widgets) load normally
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            injectTvScript();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            injectTvScript();
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            injectTvScript();
            sendToPage("__tv.onRoute()");
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String html = "<html><body style='background:#000;color:#fff;font-family:sans-serif;"
                    + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh'>"
                    + "<h2>Can't reach JioHotstar</h2><p>Check the internet connection.</p>"
                    + "<button autofocus style='font-size:22px;padding:12px 32px;border-radius:10px'"
                    + " onclick=\"location.href='" + START_URL + "'\">Retry</button></body></html>";
            view.loadDataWithBaseURL(START_URL, html, "text/html", "utf-8", null);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Rebuild the WebView instead of crashing the app.
            root.removeView(web);
            web.destroy();
            web = null;
            createWebView();
            web.loadUrl(START_URL);
            return true;
        }
    }

    private class ShellChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // Allow DRM (Widevine) for JioHotstar only; deny everything else.
            if (isAllowed(request.getOrigin())) {
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID});
                        return;
                    }
                }
            }
            request.deny();
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.INVISIBLE);
            view.setFocusable(true);
            view.requestFocus();
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            customViewCallback = null;
            web.setVisibility(View.VISIBLE);
            web.requestFocus();
        }
    }

    // ----------------------------------------------------------- lifecycle

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
            web.requestFocus();
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            sendToPage("__tv.media('pause')");
            web.onPause();
            web.pauseTimers();
        }
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return null;
        }
    }
}
