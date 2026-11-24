// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
package net.supercanvas;

import android.graphics.Rect;
import android.util.Log;
import android.view.View;

import org.json.JSONArray;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * The Nomad's own pen writing, for the line being drawn.
 *
 * The Supernote's Android (its framework.jar, a vendor's "htfyun" pen-writing
 * layer) can draw the pen's line itself, straight to the e-ink panel, ahead of
 * the app and the screen's usual pipeline: that is how its own notes keep up
 * with the pen. A view gets it as an `android.view.EinkPWInterface`, made by
 * `htfyun.penwrite.ctrl.PWCoreCtrl(View)`.
 *
 * None of it is in Android's SDK, and the constructor is a hidden API, so it
 * is reached by reflection after lifting the hidden-API check for this app
 * (allowed for an app targeting Android 10, as this one does). On any other
 * device every call here quietly does nothing.
 */
final class PenWrite {
    private static final String TAG = "Supercanvas-PW";
    private static boolean unlocked;

    /** Lift the hidden-API check for this process (meta-reflection on VMRuntime). */
    static boolean unlock() {
        if (unlocked) return true;
        try {
            Method forName = Class.class.getDeclaredMethod("forName", String.class);
            Method getDeclaredMethod = Class.class.getDeclaredMethod("getDeclaredMethod", String.class, Class[].class);
            Class<?> vm = (Class<?>) forName.invoke(null, "dalvik.system.VMRuntime");
            Method getRuntime = (Method) getDeclaredMethod.invoke(vm, "getRuntime", (Object) null);
            Method exempt = (Method) getDeclaredMethod.invoke(vm, "setHiddenApiExemptions", (Object) new Class[]{String[].class});
            exempt.invoke(getRuntime.invoke(null), new Object[]{new String[]{"L"}});
            unlocked = true;
        } catch (Throwable t) {
            Log.w(TAG, "unlock failed", t);
        }
        return unlocked;
    }

    /** A pen-writing interface for the view, or null where there is none. */
    static Object create(View host) {
        if (!unlock()) return null;
        try {
            Class<?> c = Class.forName("htfyun.penwrite.ctrl.PWCoreCtrl");
            return c.getConstructor(View.class).newInstance(host);
        } catch (Throwable t) {
            Log.w(TAG, "create failed", t);
            return null;
        }
    }

    /** Every method of the interface's object by name and count of arguments, called with JSON values. */
    static Object call(Object pw, String name, String argsJson) throws Exception {
        JSONArray a = new JSONArray(argsJson == null || argsJson.isEmpty() ? "[]" : argsJson);
        for (Method m : pw.getClass().getMethods()) {
            if (!m.getName().equals(name) || m.getParameterTypes().length != a.length()) continue;
            Class<?>[] types = m.getParameterTypes();
            Object[] args = new Object[types.length];
            boolean fits = true;
            for (int i = 0; i < types.length && fits; i++) {
                Object v = a.isNull(i) ? null : a.get(i);
                Class<?> t = types[i];
                if (t == int.class && v instanceof Number) args[i] = ((Number) v).intValue();
                else if (t == float.class && v instanceof Number) args[i] = ((Number) v).floatValue();
                else if (t == long.class && v instanceof Number) args[i] = ((Number) v).longValue();
                else if (t == boolean.class && v instanceof Boolean) args[i] = v;
                else if (t == Rect.class && v instanceof JSONArray) args[i] = rect((JSONArray) v);
                else if (t == List.class && v instanceof JSONArray) {
                    List<Rect> rs = new ArrayList<>();
                    JSONArray arr = (JSONArray) v;
                    for (int k = 0; k < arr.length(); k++) rs.add(rect(arr.getJSONArray(k)));
                    args[i] = rs;
                } else if (t == String.class && (v == null || v instanceof String)) args[i] = v;
                else if (v == null && !t.isPrimitive()) args[i] = null;
                else fits = false;
            }
            if (!fits) continue;
            m.setAccessible(true);
            return m.invoke(pw, args);
        }
        throw new NoSuchMethodException(name + "/" + a.length());
    }

    private static Rect rect(JSONArray r) throws Exception {
        return new Rect(r.getInt(0), r.getInt(1), r.getInt(2), r.getInt(3));
    }
}
