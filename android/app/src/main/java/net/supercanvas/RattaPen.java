// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Jeff Moore
package net.supercanvas;

import android.os.IBinder;
import android.os.Parcel;

import org.json.JSONArray;

/**
 * Supernote's own real-time pen: the drawing service its notes are written with.
 *
 * A system app (com.ratta.drawpath) reads the pen straight from the digitizer and draws the line onto the
 * e-ink controller in grays, ahead of everything else, wherever it's told it may. It registers a plain binder
 * service, "service_myservice" (interface "android.demo.IMyService"), and the notes app tells it what to do
 * with simple parcels (its HandWriteClient): the interface token, a caller name, then ints —
 *
 *   code 1  areas:  count, then left, top, width, height, flag for each
 *   code 2  pen:    type, width, color
 *   code 6  clear:  255, 0
 *
 * The caller name matters: the service tags each stroke it draws with it, and Supernote's notes app takes in
 * every pending stroke tagged "superNoteNote" — its own name — and skips any other ("app and trail doesn't
 * match. discarding trail"). So Supercanvas names itself, or its strokes turn up in whatever note is open next
 * (they did, 2026-11-23, when this sent "superNoteNote").
 *
 * Reached through the hidden ServiceManager (PenWrite.unlock lifts the hidden-API check).
 */
final class RattaPen {
    /** Who the strokes belong to: anything but "superNoteNote". */
    static final String CALLER = "supercanvas";
    private static IBinder binder;

    static IBinder binder() throws Exception {
        if (binder != null && binder.isBinderAlive()) return binder;
        PenWrite.unlock();
        Class<?> sm = Class.forName("android.os.ServiceManager");
        binder = (IBinder) sm.getMethod("getService", String.class).invoke(null, "service_myservice");
        return binder;
    }

    static String call(int code, String intsJson) throws Exception {
        IBinder b = binder();
        if (b == null) return "no service";
        JSONArray a = new JSONArray(intsJson == null || intsJson.isEmpty() ? "[]" : intsJson);
        Parcel data = Parcel.obtain(), reply = Parcel.obtain();
        try {
            data.writeInterfaceToken("android.demo.IMyService");
            data.writeString(CALLER);
            for (int i = 0; i < a.length(); i++) {
                // A float is written as a string "f<number>" (JSON keeps no difference between 1 and 1.0).
                Object v = a.get(i);
                if (v instanceof String && ((String) v).startsWith("f")) data.writeFloat(Float.parseFloat(((String) v).substring(1)));
                else data.writeInt(a.getInt(i));
            }
            boolean ok = b.transact(code, data, reply, 0);
            String r = null;
            try { r = reply.dataAvail() > 0 ? reply.readString() : ""; } catch (Throwable ignored) { }
            return (ok ? "ok " : "refused ") + r;
        } finally {
            data.recycle();
            reply.recycle();
        }
    }
}
