// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
package net.supercanvas;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.Manifest;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * A full-screen WebView hosting the canvas (assets/index.html), with a small
 * JavaScript bridge ("SC") for reading and writing .supercanvas files.
 *
 * Storage: a folder the user picks through the system folder picker (Storage
 * Access Framework). If the device has no folder picker, it falls back to
 * Documents/Supercanvas on shared storage, then to the app's own files folder.
 *
 * Adapted from Writerdeck's MainActivity.
 */
public class MainActivity extends Activity {
    private static final int PICK_FOLDER = 1;
    private static final int PICK_FILE = 2;
    private static final int PICK_IMAGE = 3;
    private static final int ASK_STORAGE = 4;
    private static final String EXT = ".supercanvas";

    private WebView web;
    /**
     * A clear view over the page, drawing nothing, for e-ink refreshes of a patch (einkRefresh): the WebView
     * composites itself, and a refresh mode asked of it may go nowhere, where Supernote's notes ask theirs of
     * a plain view over the page.
     */
    private View refresher;
    /** The Nomad's pen writing for the web view (PenWrite), once asked for. */
    private Object pw;
    /** What the page asked of the device's pen writing (pwOn), and whether the pen's eraser end is the one near. */
    private boolean pwWanted, eraserNear;
    private SharedPreferences prefs;
    private Uri tree;          // SAF tree, when chosen
    private File dir;          // plain-file fallback
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("supercanvas", MODE_PRIVATE);
        restoreFolder();
        applyOrientation(prefs.getString("orient", "system"));

        Window w = getWindow();
        w.getDecorView().setBackgroundColor(Color.WHITE);

        // Inspectable from desktop Chrome (chrome://inspect) over USB debugging: a personal app, and how its
        // behaviour on the device itself gets looked into.
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            // A link in a note opens in the device's browser, never in place of the canvas.
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // <input type=file> (a picture for the canvas): Android's own picker.
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Picture"), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        // The canvas opens its own menus on a long-press (longpress.ts); Android's text
        // selection popup would fight it.
        web.setOnLongClickListener(v -> true);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.addJavascriptInterface(new Bridge(), "SC");
        // Edge to edge, so the on-screen keyboard does not resize the page by itself:
        // pad the bottom by its height instead.
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        refresher = new View(this);
        refresher.setClickable(false);
        refresher.setFocusable(false);
        root.addView(refresher, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int bottom = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsets.Type.ime()).bottom : 0;
            if (v.getPaddingBottom() != bottom) v.setPadding(0, 0, 0, bottom);
            return insets;
        });
        setContentView(root);
        web.loadUrl("file:///android_asset/index.html");
        if (!hasStorage()) askStorage();
        web.requestFocus();
        goFullscreen();
    }

    /* ------------------------------------------------------------ full screen */

    @SuppressWarnings("deprecation")
    private void goFullscreen() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goFullscreen();
    }

    private void applyOrientation(String o) {
        int v;
        switch (o == null ? "" : o) {
            case "auto": v = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR; break;
            case "portrait": v = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT; break;
            case "landscape": v = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE; break;
            default: v = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        if (getRequestedOrientation() != v) setRequestedOrientation(v);
    }

    /* -------------------------------------------------------------- lifecycle */

    @Override
    protected void onPause() {
        // Whatever is waiting to be written goes now.
        if (web != null) web.evaluateJavascript("window.sc && sc.flush()", null);
        // Supernote's pen (RattaPen) draws wherever it was last told it may, whatever app is in front:
        // nowhere, now, until the page asks again on coming back.
        try { RattaPen.call(1, "[1,0,0,19999,19999,0]"); } catch (Throwable ignored) { }
        super.onPause();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.sc ? sc.back() : false", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    /* ----------------------------------------------------------------- folder */

    private boolean hasStorage() {
        return checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void askStorage() {
        requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE}, ASK_STORAGE);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req != ASK_STORAGE) return;
        restoreFolder();
        notifyFolder();
    }

    @SuppressWarnings("deprecation")
    private static File storageRoot() { return Environment.getExternalStorageDirectory(); }

    /** Inside the device's storage, and nowhere else. */
    private static File within(String abs) {
        if (abs == null) return null;
        try {
            File root = storageRoot().getCanonicalFile();
            File f = new File(abs).getCanonicalFile();
            if (f.equals(root) || f.getPath().startsWith(root.getPath() + "/")) return f;
        } catch (Exception ignored) { }
        return null;
    }

    /**
     * A folder picked through Android's picker on the device's own storage
     * ("primary:Document/Canvases"), as the plain folder it is: with file access
     * granted, the app reads it directly and needs the picker no more.
     */
    private File treeAsFile(Uri u) {
        try {
            String id = DocumentsContract.getTreeDocumentId(u);
            if (!id.startsWith("primary:")) return null;
            File f = new File(storageRoot(), id.substring("primary:".length()));
            return f.isDirectory() && f.canWrite() ? f : null;
        } catch (Exception e) { return null; }
    }

    private void restoreFolder() {
        if (hasStorage()) {
            String t0 = prefs.getString("tree", null);
            File asFile = t0 == null ? null : treeAsFile(Uri.parse(t0));
            if (asFile != null) {
                prefs.edit().putString("dir", asFile.getAbsolutePath()).remove("tree").apply();
                dir = asFile;
                tree = null;
                return;
            }
        }
        String t = prefs.getString("tree", null);
        if (t != null) {
            Uri u = Uri.parse(t);
            for (UriPermission p : getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().equals(u) && p.isWritePermission()) { tree = u; return; }
            }
        }
        String d = prefs.getString("dir", null);
        if (d != null) {
            File f = new File(d);
            if (f.isDirectory() && f.canWrite()) dir = f;
        }
    }

    private void pickFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(i, PICK_FOLDER);
        } catch (ActivityNotFoundException e) {
            useFallbackDir();
        }
    }

    @SuppressWarnings("deprecation")
    private void useFallbackDir() {
        File d = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "Supercanvas");
        if (!(d.isDirectory() || d.mkdirs()) || !d.canWrite()) {
            d = new File(getExternalFilesDir(null), "Supercanvas");
            d.mkdirs();
        }
        dir = d;
        tree = null;
        prefs.edit().putString("dir", d.getAbsolutePath()).remove("tree").apply();
        notifyFolder();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PICK_FILE) {
            if (fileCallback != null) {
                Uri u = (res == RESULT_OK && data != null) ? data.getData() : null;
                fileCallback.onReceiveValue(u == null ? null : new Uri[]{u});
                fileCallback = null;
            }
            goFullscreen();
            return;
        }
        if (req == PICK_IMAGE) {
            String out = null;
            if (res == RESULT_OK && data != null && data.getData() != null) {
                try { out = scaled(getContentResolver().openInputStream(data.getData()), getContentResolver().openInputStream(data.getData()), 1600); }
                catch (Exception ignored) { }
            }
            web.evaluateJavascript("window.sc && sc.picked(" + (out == null ? "null" : JSONObject.quote(out)) + ")", null);
            goFullscreen();
            return;
        }
        if (req != PICK_FOLDER) return;
        if (res == RESULT_OK && data != null && data.getData() != null) {
            Uri u = data.getData();
            getContentResolver().takePersistableUriPermission(u,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            tree = u;
            dir = null;
            prefs.edit().putString("tree", u.toString()).remove("dir").apply();
        } else if (tree == null && dir == null) {
            // Cancelled with no folder at all: use the fallback rather than leave nothing.
            useFallbackDir();
            return;
        }
        notifyFolder();
    }

    private void notifyFolder() {
        web.evaluateJavascript("window.sc && sc.onFolder()", null);
        goFullscreen();
    }

    private String folderLabel() {
        if (dir != null) return dir.getName();
        if (tree == null) return null;
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = getContentResolver().query(doc, new String[]{Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return "folder";
    }

    /* ------------------------------------------------------------ path helpers */
    // Paths are relative to the canvas folder, "/"-separated: "Garden/Beds.supercanvas".

    private static boolean isCanvas(String name) { return name.toLowerCase().endsWith(EXT); }

    private static boolean safeName(String name) {
        return name != null && !name.isEmpty() && !name.contains("/") && !name.contains("\\")
                && !name.startsWith(".") && !name.equals("..");
    }

    /** "" is the root; otherwise every segment must be a safe name. */
    private static boolean safePath(String path, boolean allowRoot) {
        if (path == null) return false;
        if (path.isEmpty()) return allowRoot;
        for (String seg : path.split("/", -1)) if (!safeName(seg)) return false;
        return true;
    }

    private static String parentOf(String p) { int i = p.lastIndexOf('/'); return i < 0 ? "" : p.substring(0, i); }
    private static String nameOf(String p) { return p.substring(p.lastIndexOf('/') + 1); }

    private String rootId() { return DocumentsContract.getTreeDocumentId(tree); }
    private Uri docUri(String id) { return DocumentsContract.buildDocumentUriUsingTree(tree, id); }

    private String childId(String parentId, String name) {
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        try (Cursor c = getContentResolver().query(kids, new String[]{Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            while (c != null && c.moveToNext()) if (name.equals(c.getString(1))) return c.getString(0);
        }
        return null;
    }

    private String resolve(String path) {
        String id = rootId();
        if (path.isEmpty()) return id;
        for (String seg : path.split("/")) {
            id = childId(id, seg);
            if (id == null) return null;
        }
        return id;
    }

    private static byte[] readBytes(InputStream in) throws Exception {
        try (InputStream i = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = i.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private byte[] readPath(String path) throws Exception {
        if (dir != null) return readBytes(new FileInputStream(new File(dir, path)));
        if (tree != null) {
            String id = resolve(path);
            return id == null ? null : readBytes(getContentResolver().openInputStream(docUri(id)));
        }
        return null;
    }

    private boolean writePath(String path, byte[] bytes) throws Exception {
        if (dir != null) {
            // Written beside, then moved into place: a save cut short never leaves half a canvas.
            File target = new File(dir, path);
            File tmp = new File(target.getParentFile(), "." + target.getName() + ".tmp");
            try (OutputStream o = new FileOutputStream(tmp)) { o.write(bytes); }
            return tmp.renameTo(target);
        }
        if (tree != null) {
            String id = resolve(path);
            Uri u;
            if (id != null) u = docUri(id);
            else {
                String parentId = resolve(parentOf(path));
                if (parentId == null) return false;
                // octet-stream so the provider keeps our ".supercanvas" name as-is
                u = DocumentsContract.createDocument(getContentResolver(), docUri(parentId), "application/octet-stream", nameOf(path));
            }
            if (u == null) return false;
            try (OutputStream o = getContentResolver().openOutputStream(u, "wt")) {
                if (o == null) return false;
                o.write(bytes);
            }
            return true;
        }
        return false;
    }

    /**
     * A picture as a data URL, its long edge no more than `edge` pixels: read
     * once for its size and again to decode at a fraction of it, so a phone
     * photograph never has to fit in memory whole.
     */
    private static String scaled(InputStream sizeIn, InputStream dataIn, int edge) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream i = sizeIn) { BitmapFactory.decodeStream(i, null, o); }
        if (o.outWidth <= 0 || o.outHeight <= 0) return null;
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= edge) sample *= 2;
        BitmapFactory.Options d = new BitmapFactory.Options();
        d.inSampleSize = sample;
        Bitmap b;
        try (InputStream i = dataIn) { b = BitmapFactory.decodeStream(i, null, d); }
        if (b == null) return null;
        float k = Math.min(1f, (float) edge / Math.max(b.getWidth(), b.getHeight()));
        if (k < 1f) {
            Bitmap s = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * k)), Math.max(1, Math.round(b.getHeight() * k)), true);
            if (s != b) b.recycle();
            b = s;
        }
        boolean png = "image/png".equals(o.outMimeType) || "image/gif".equals(o.outMimeType);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 85, out);
        b.recycle();
        return "data:" + (png ? "image/png" : "image/jpeg") + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    private static boolean isImage(String n) {
        String l = n.toLowerCase();
        return l.endsWith(".png") || l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".gif")
                || l.endsWith(".webp") || l.endsWith(".bmp");
    }

    /* ------------------------------------------------------------------ bridge */

    private class Bridge {
        @JavascriptInterface public boolean hasFolder() { return tree != null || dir != null; }

        @JavascriptInterface public String folderName() { String n = folderLabel(); return n == null ? "" : n; }

        /** Android's own folder picker; the app's own (browse + useFolder) comes first. */
        @JavascriptInterface public void pickFolder() { runOnUiThread(MainActivity.this::pickFolder); }

        /**
         * The keyboard up for the field the page has just focused. A focus made by script (a note opened by a
         * double-tap, a new note) doesn't raise it on its own, as a tap straight on the field would.
         */
        @JavascriptInterface public void showKeyboard() {
            runOnUiThread(() -> {
                web.requestFocus();
                InputMethodManager im = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (im != null) im.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
            });
        }

        /*
         * The Nomad's e-ink refresh, for this app's view. Its Android adds View.setEinkUpdateMode(dataMode,
         * showMode) (hidden; found in its framework.jar): by default a view is drawn with the slow, full
         * grayscale update, which made the pen's line trail far behind it. While a stroke is being drawn the
         * page asks for a fast black-and-white one (DU, A2), and for the default back as the pen lifts.
         * Called by reflection, so the app still runs on any other Android, where these do nothing.
         */
        @JavascriptInterface public boolean einkMode(int dataMode, int showMode) {
            final boolean[] ok = { false };
            try {
                java.lang.reflect.Method m = View.class.getMethod("setEinkUpdateMode", int.class, int.class);
                runOnUiThread(() -> { try { m.invoke(web, dataMode, showMode); } catch (Exception ignored) { } });
                ok[0] = true;
            } catch (Exception e) { /* not an e-ink Android */ }
            return ok[0];
        }
        @JavascriptInterface public void einkReset() {
            runOnUiThread(() -> {
                try { View.class.getMethod("resetEinkUpdateMode").invoke(web); } catch (Exception ignored) { }
            });
        }

        /**
         * The Nomad's native pen writing (PenWrite) on or off for the web view, in the ink chosen: an ARGB color,
         * a width in screen pixels (the system's own 1-10), and the screen rectangles it mustn't write over (the
         * toolbars), as JSON [[l,t,r,b], ...]. The page still hears the pen and keeps the stroke; this only draws
         * the line as it is written, straight to the panel. False where there is no such thing.
         */
        @JavascriptInterface public boolean pwOn(boolean on, int color, int width, String unwritable) {
            final boolean[] ok = { false }, done = { false };
            final Object lock = new Object();
            runOnUiThread(() -> {
                try {
                    if (pw == null) pw = PenWrite.create(web);
                    if (pw == null) return;
                    if (on) {
                        PenWrite.call(pw, "setPenType", "[2]");                 // PENTYPE_PEN_1: pressure-sensitive
                        PenWrite.call(pw, "setDrawObjectPaintAntiAlias", "[1]"); // ANTIALIAS_TYPE_ANTIFAUTO: smoothest while writing
                        PenWrite.call(pw, "setPenColor", "[" + color + "]");
                        PenWrite.call(pw, "setPenSettingWidth", "[" + Math.max(1, Math.min(10, width)) + "]");
                        PenWrite.call(pw, "enableTouchDispatch", "[2]");         // DISPATH_TOUCH_HOST_LATER: the page hears it too
                        PenWrite.call(pw, "clearUnWriteRectList", "[]");
                        org.json.JSONArray rs = new org.json.JSONArray(unwritable == null ? "[]" : unwritable);
                        for (int i = 0; i < rs.length(); i++)
                            PenWrite.call(pw, "addUnWriteRect", "[" + rs.getJSONArray(i) + "]");
                    }
                    pwWanted = on;
                    // Off is the whole screen made unwritable: setPWEnabled alone only marks a flag, and the
                    // device's pen went on drawing (with the eraser chosen, the pen put down...).
                    if (!on) {
                        PenWrite.call(pw, "clearUnWriteRectList", "[]");
                        PenWrite.call(pw, "addUnWriteRect", "[[0,0,100000,100000]]");
                    }
                    PenWrite.call(pw, "setPWEnabled", "[" + (on && !eraserNear) + "]");
                    ok[0] = true;
                } catch (Throwable t) {
                    android.util.Log.w("Supercanvas-PW", "pwOn", t);
                } finally {
                    synchronized (lock) { done[0] = true; lock.notifyAll(); }
                }
            });
            synchronized (lock) { try { if (!done[0]) lock.wait(2000); } catch (InterruptedException ignored) { } }
            return ok[0];
        }

        /**
         * The device's own copy of what was written, wiped: the page has drawn the kept strokes by now, and the
         * device's would otherwise stay put on the screen as the canvas pans or zooms under them.
         */
        @JavascriptInterface public void pwClear() {
            runOnUiThread(() -> {
                if (pw == null) return;
                try { /* the last false: keep nothing */ PenWrite.call(pw, "clearContent", "[null,true,true,false]"); }
                catch (Throwable t) { android.util.Log.w("Supercanvas-PW", "pwClear", t); }
            });
        }

        /**
         * Supernote's own real-time pen (RattaPen.java): one message to its drawing service, as JSON ints after the
         * code. Its answer as text, or why not. (For working it out; the page uses the named calls once known.)
         */
        @JavascriptInterface public String snCall(int code, String intsJson) {
            try { return RattaPen.call(code, intsJson); }
            catch (Throwable t) { return "error " + t; }
        }

        /**
         * A command to the e-ink controller (the system's "eink" service, android.os.EinkManager.sendHwcCmd), as
         * Supernote's notes send them: 1020 with [9, 1] / [9, 0] turns its Regal waveform (less ghosting) on / off.
         */
        @JavascriptInterface public String hwcCmd(int cmd, String intsJson) {
            try {
                PenWrite.unlock();
                Object em = getSystemService("eink");
                if (em == null) return "no eink";
                org.json.JSONArray a = new org.json.JSONArray(intsJson);
                int[] v = new int[a.length()];
                for (int i = 0; i < v.length; i++) v[i] = a.getInt(i);
                em.getClass().getMethod("sendHwcCmd", int.class, int[].class).invoke(em, cmd, v);
                return "ok";
            } catch (Throwable t) { return "error " + (t.getCause() != null ? t.getCause() : t); }
        }

        /** The e-ink service's whole-screen refresh, as Supernote's notes ask it once writing pauses: screenRefresh(false, 1). */
        @JavascriptInterface public String einkScreenRefresh(boolean full, int mode) {
            try {
                PenWrite.unlock();
                Object em = getSystemService("eink");
                if (em == null) return "no eink";
                em.getClass().getMethod("screenRefresh", boolean.class, int.class).invoke(em, full, mode);
                android.util.Log.d("Supercanvas-PW", "screenRefresh " + full + " " + mode);
                return "ok";
            } catch (Throwable t) { return "error " + (t.getCause() != null ? t.getCause() : t); }
        }

        /** A yes/no setting of the e-ink service by name (enableFullUiAuto, as Supernote's notes turn it off to write). */
        @JavascriptInterface public String einkSet(String name, boolean on) {
            try {
                PenWrite.unlock();
                Object em = getSystemService("eink");
                if (em == null) return "no eink";
                Object r = em.getClass().getMethod(name, boolean.class).invoke(em, on);
                return "ok " + r;
            } catch (Throwable t) { return "error " + (t.getCause() != null ? t.getCause() : t); }
        }

        /**
         * A patch of the screen (device pixels) refreshed in a given e-ink mode (the Nomad's View.postInvalidate
         * with a mode; 2 is a clean grayscale refresh): where Supernote's pen drew and the page then drew the kept
         * stroke, the panel otherwise leaves a gray box.
         */
        @JavascriptInterface public String einkRefresh(int l, int t, int r, int b, int mode) {
            try {
                java.lang.reflect.Method m = View.class.getMethod("postInvalidate", int.class, int.class, int.class, int.class, int.class);
                m.invoke(refresher, l, t, r, b, mode);
                android.util.Log.d("Supercanvas-PW", "einkRefresh " + l + "," + t + "," + r + "," + b + " mode " + mode);
                return "ok";
            } catch (Throwable e) { return "error " + e; }
        }

        /** Any of the pen-writing interface's methods, by name, with JSON arguments; its answer as text. */
        @JavascriptInterface public String pwCall(String name, String argsJson) {
            if (pw == null) return "no pw";
            final String[] out = { null };
            final Object lock = new Object();
            runOnUiThread(() -> {
                try { out[0] = "ok " + PenWrite.call(pw, name, argsJson); }
                catch (java.lang.reflect.InvocationTargetException t) { out[0] = "error " + t.getCause(); }
                catch (Throwable t) { out[0] = "error " + t; }
                finally { synchronized (lock) { lock.notifyAll(); } }
            });
            synchronized (lock) { try { if (out[0] == null) lock.wait(3000); } catch (InterruptedException ignored) { } }
            return out[0];
        }

        @JavascriptInterface public boolean hasStorage() { return MainActivity.this.hasStorage(); }
        @JavascriptInterface public void askStorage() { runOnUiThread(MainActivity.this::askStorage); }
        @JavascriptInterface public String storageRoot() { return MainActivity.storageRoot().getAbsolutePath(); }
        @JavascriptInterface public String folderPath() { return dir == null ? "" : dir.getAbsolutePath(); }

        /** What is in a folder on the device: {path, dirs: [name], images: [{name, mtime}]}. */
        @JavascriptInterface public String browse(String abs) {
            JSONObject out = new JSONObject();
            try {
                File f = within(abs);
                if (f == null || !f.isDirectory()) f = MainActivity.storageRoot();
                out.put("path", f.getAbsolutePath());
                JSONArray dirs = new JSONArray(), images = new JSONArray();
                File[] kids = f.listFiles();
                if (kids != null) {
                    java.util.Arrays.sort(kids, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                    for (File k : kids) {
                        String n = k.getName();
                        if (n.startsWith(".")) continue;
                        if (k.isDirectory()) dirs.put(n);
                        else if (isImage(n)) images.put(new JSONObject().put("name", n).put("mtime", k.lastModified()));
                    }
                }
                out.put("dirs", dirs).put("images", images);
            } catch (Exception ignored) { }
            return out.toString();
        }

        /** Keep canvases in this folder from now on. */
        @JavascriptInterface public boolean useFolder(String abs) {
            File f = within(abs);
            if (f == null || !f.isDirectory() || !f.canWrite()) return false;
            dir = f;
            tree = null;
            prefs.edit().putString("dir", f.getAbsolutePath()).remove("tree").apply();
            return true;
        }

        /** A new folder inside `abs`, on the device. */
        @JavascriptInterface public boolean makeFolder(String abs, String name) {
            File f = within(abs);
            return f != null && safeName(name) && new File(f, name).mkdir();
        }

        /** A picture on the device as a data URL, its long edge at most `edge` pixels. */
        @JavascriptInterface public String picture(String abs, int edge) {
            File f = within(abs);
            if (f == null || !f.isFile()) return null;
            try { return scaled(new FileInputStream(f), new FileInputStream(f), Math.max(16, Math.min(edge, 2400))); }
            catch (Exception e) { return null; }
        }

        /** Android's own picture picker, for pictures in other apps; answered by `sc.picked`. */
        @JavascriptInterface public void systemPicture() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/*");
                try { startActivityForResult(i, PICK_IMAGE); }
                catch (ActivityNotFoundException e) { web.evaluateJavascript("window.sc && sc.picked(null)", null); }
            });
        }

        /** The screen orientation chosen (setOrientation), "system" until one is. */
        @JavascriptInterface public String orientation() { return prefs.getString("orient", "system"); }

        @JavascriptInterface public void setOrientation(String o) {
            prefs.edit().putString("orient", o).apply();
            runOnUiThread(() -> applyOrientation(o));
        }

        /** Folders and canvases directly inside `path`: [{name, dir, mtime}]. */
        @JavascriptInterface public String list(String path) {
            JSONArray arr = new JSONArray();
            if (!safePath(path, true)) return arr.toString();
            try {
                if (dir != null) {
                    File[] files = new File(dir, path).listFiles();
                    if (files != null) for (File f : files) {
                        String n = f.getName();
                        if (n.startsWith(".")) continue;
                        if (f.isDirectory()) arr.put(new JSONObject().put("name", n).put("dir", true).put("mtime", f.lastModified()));
                        else if (isCanvas(n)) arr.put(new JSONObject().put("name", n).put("dir", false).put("mtime", f.lastModified()));
                    }
                } else if (tree != null) {
                    String id = resolve(path);
                    if (id == null) return arr.toString();
                    Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
                    try (Cursor c = getContentResolver().query(kids, new String[]{
                            Document.COLUMN_DISPLAY_NAME, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_MIME_TYPE}, null, null, null)) {
                        while (c != null && c.moveToNext()) {
                            String n = c.getString(0);
                            if (n == null || n.startsWith(".")) continue;
                            boolean isDir = Document.MIME_TYPE_DIR.equals(c.getString(2));
                            if (!isDir && !isCanvas(n)) continue;
                            arr.put(new JSONObject().put("name", n).put("dir", isDir).put("mtime", c.getLong(1)));
                        }
                    }
                }
            } catch (Exception ignored) { }
            return arr.toString();
        }

        @JavascriptInterface public String read(String path) {
            if (!safePath(path, false)) return null;
            try {
                byte[] b = readPath(path);
                return b == null ? null : new String(b, StandardCharsets.UTF_8);
            } catch (Exception ignored) { }
            return null;
        }

        /**
         * The page as a picture, saved beside the canvases: a PNG, or a PDF of one page. The page has already
         * laid the whole canvas out to fit `w` by `h` pixels (export.ts); the WebView is made that size for a
         * moment, drawn into a bitmap, and put back. Then `sc.exported(ok)`.
         */
        @JavascriptInterface public void exportPicture(String kind, int w, int h, String path) {
            runOnUiThread(() -> {
                if (!safePath(path, false) || w < 16 || h < 16 || (long) w * h > 24_000_000L) {
                    web.evaluateJavascript("window.sc && sc.exported && sc.exported(false)", null);
                    return;
                }
                ViewGroup.LayoutParams was = web.getLayoutParams();
                web.setLayoutParams(new FrameLayout.LayoutParams(w, h));
                // Long enough for the page to lay itself out again and draw at the new size.
                web.postDelayed(() -> {
                    boolean ok = false;
                    Bitmap bmp = null;
                    try {
                        bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                        android.graphics.Canvas c = new android.graphics.Canvas(bmp);
                        c.drawColor(Color.WHITE);
                        web.draw(c);
                        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                        if ("pdf".equals(kind)) {
                            // One page the canvas's own shape, a CSS pixel to a point.
                            float density = getResources().getDisplayMetrics().density;
                            int pw = Math.max(1, Math.round(w / density)), ph = Math.max(1, Math.round(h / density));
                            android.graphics.pdf.PdfDocument doc = new android.graphics.pdf.PdfDocument();
                            android.graphics.pdf.PdfDocument.Page page = doc.startPage(
                                new android.graphics.pdf.PdfDocument.PageInfo.Builder(pw, ph, 1).create());
                            android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG);
                            page.getCanvas().drawBitmap(bmp, null, new android.graphics.Rect(0, 0, pw, ph), paint);
                            doc.finishPage(page);
                            doc.writeTo(out);
                            doc.close();
                        } else {
                            bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                        }
                        ok = writePath(path, out.toByteArray());
                    } catch (Throwable t) {
                        android.util.Log.w("Supercanvas", "export", t);
                    } finally {
                        if (bmp != null) bmp.recycle();
                        web.setLayoutParams(was);
                    }
                    web.evaluateJavascript("window.sc && sc.exported && sc.exported(" + ok + ")", null);
                }, 1500);
            });
        }

        @JavascriptInterface public boolean write(String path, String text) {
            if (!safePath(path, false)) return false;
            try { return writePath(path, text.getBytes(StandardCharsets.UTF_8)); } catch (Exception ignored) { }
            return false;
        }

        @JavascriptInterface public boolean mkdir(String path) {
            if (!safePath(path, false)) return false;
            try {
                if (dir != null) return new File(dir, path).mkdir();
                if (tree != null) {
                    if (resolve(path) != null) return false;
                    String parentId = resolve(parentOf(path));
                    return parentId != null && DocumentsContract.createDocument(getContentResolver(),
                            docUri(parentId), Document.MIME_TYPE_DIR, nameOf(path)) != null;
                }
            } catch (Exception ignored) { }
            return false;
        }

        /** Deletes a file, or a folder only if it is empty. */
        @JavascriptInterface public boolean remove(String path) {
            if (!safePath(path, false)) return false;
            try {
                if (dir != null) {
                    File f = new File(dir, path);
                    String[] kids = f.list();
                    if (f.isDirectory() && kids != null && kids.length > 0) return false;
                    return f.delete();
                }
                if (tree != null) {
                    String id = resolve(path);
                    if (id == null) return false;
                    Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
                    try (Cursor c = getContentResolver().query(docUri(id), new String[]{Document.COLUMN_MIME_TYPE}, null, null, null)) {
                        if (c != null && c.moveToFirst() && Document.MIME_TYPE_DIR.equals(c.getString(0))) {
                            try (Cursor k = getContentResolver().query(kids, new String[]{Document.COLUMN_DOCUMENT_ID}, null, null, null)) {
                                if (k != null && k.getCount() > 0) return false;
                            }
                        }
                    }
                    return DocumentsContract.deleteDocument(getContentResolver(), docUri(id));
                }
            } catch (Exception ignored) { }
            return false;
        }

        /**
         * Moved to a hidden ".trash" folder in the canvas folder, named
         * "<time>__<original path with / as %2F>": nothing is erased.
         */
        @JavascriptInterface public String trash(String path) {
            if (!safePath(path, false)) return null;
            String name = System.currentTimeMillis() + "__" + path.replace("/", "%2F");
            try {
                byte[] bytes = readPath(path);
                if (bytes == null) return null;
                if (dir != null) {
                    File t = new File(dir, ".trash");
                    t.mkdirs();
                    try (OutputStream o = new FileOutputStream(new File(t, name))) { o.write(bytes); }
                } else if (tree != null) {
                    String tid = childId(rootId(), ".trash");
                    if (tid == null) {
                        Uri tu = DocumentsContract.createDocument(getContentResolver(), docUri(rootId()), Document.MIME_TYPE_DIR, ".trash");
                        if (tu == null) return null;
                        tid = DocumentsContract.getDocumentId(tu);
                    }
                    Uri u = DocumentsContract.createDocument(getContentResolver(), docUri(tid), "application/octet-stream", name);
                    if (u == null) return null;
                    try (OutputStream o = getContentResolver().openOutputStream(u, "wt")) {
                        if (o == null) return null;
                        o.write(bytes);
                    }
                } else return null;
            } catch (Exception e) { return null; }
            // Only remove the original once the copy is safely in the trash.
            return remove(path) ? name : null;
        }

        /** Renames a file or folder in place (same parent folder). */
        @JavascriptInterface public boolean rename(String path, String newName) {
            if (!safePath(path, false) || !safeName(newName)) return false;
            try {
                if (dir != null) {
                    File f = new File(dir, path);
                    File to = new File(f.getParentFile(), newName);
                    return !to.exists() && f.renameTo(to);
                }
                if (tree != null) {
                    String id = resolve(path);
                    if (id == null || resolve(parentOf(path).isEmpty() ? newName : parentOf(path) + "/" + newName) != null) return false;
                    return DocumentsContract.renameDocument(getContentResolver(), docUri(id), newName) != null;
                }
            } catch (Exception ignored) { }
            return false;
        }
    }

    /*
     * The pen's eraser end. The Nomad's pen says which end is near (TOOL_TYPE_ERASER, from its BTN_TOOL_RUBBER),
     * but the WebView passes the eraser on as a plain pen. So it is watched here, as the pen hovers, before it
     * touches: the device's own writing is turned off for the eraser end (else it draws with it), and the page is
     * told, so its eraser takes the stroke.
     */
    @Override public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        watchPenEnd(ev);
        return super.dispatchGenericMotionEvent(ev);
    }

    @Override public boolean dispatchTouchEvent(MotionEvent ev) {
        watchPenEnd(ev);
        return super.dispatchTouchEvent(ev);
    }

    private void watchPenEnd(MotionEvent ev) {
        if (ev.getPointerCount() < 1) return;
        int tool = ev.getToolType(0);
        if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return;
        boolean eraser = tool == MotionEvent.TOOL_TYPE_ERASER;
        if (eraser == eraserNear) return;
        eraserNear = eraser;
        if (pw != null && pwWanted) {
            try { PenWrite.call(pw, "setPWEnabled", "[" + !eraser + "]"); }
            catch (Throwable t) { android.util.Log.w("Supercanvas-PW", "eraser end", t); }
        }
        web.evaluateJavascript("window.sc && sc.penEnd && sc.penEnd('" + (eraser ? "eraser" : "pen") + "')", null);
    }

}
