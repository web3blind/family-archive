package xyz.blinddev.familyarchive;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import androidx.activity.result.ActivityResult;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.util.Locale;

@CapacitorPlugin(name = "FamilyArchive")
public class FamilyArchivePlugin extends Plugin {
    private ArchiveStore store() { return new ArchiveStore(getContext().getFilesDir()); }

    private void runIo(PluginCall call, IoAction action) {
        execute(() -> {
            synchronized (ArchiveStore.class) {
                try { action.run(); }
                catch (Exception error) { call.reject(error.getMessage() == null ? "Archive I/O failed" : error.getMessage(), error); }
            }
        });
    }

    private interface IoAction { void run() throws Exception; }

    @PluginMethod
    public void getRootUri(PluginCall call) {
        runIo(call, () -> {
            JSObject result = new JSObject();
            result.put("rootUri", Uri.fromFile(store().root()).toString() + "/");
            call.resolve(result);
        });
    }

    @PluginMethod
    public void readArchive(PluginCall call) {
        runIo(call, () -> {
            JSONObject archive = store().read();
            JSObject result = new JSObject();
            result.put("archive", archive == null ? JSONObject.NULL : archive);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void writeArchive(PluginCall call) {
        runIo(call, () -> {
            JSONObject archive = call.getObject("archive");
            store().write(archive);
            call.resolve();
        });
    }

    @PluginMethod
    public void openMedia(PluginCall call) {
        runIo(call, () -> {
            String path = call.getString("path");
            File file = store().mediaFile(path);
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".files", file);
            String extension = android.webkit.MimeTypeMap.getFileExtensionFromUrl(file.getName());
            String mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(Locale.ROOT));
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime == null ? "application/octet-stream" : mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try { getActivity().startActivity(intent); call.resolve(new JSObject()); }
                catch (Exception error) { call.reject("Не удалось открыть документ. Установите приложение для этого формата.", error); }
            });
        });
    }

    @PluginMethod
    public void pickMedia(PluginCall call) {
        Intent intent = picker("image/*", "audio/*", "video/*", "application/pdf", "text/plain", "text/markdown",
            "application/rtf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.oasis.opendocument.text", "application/octet-stream", "text/csv", "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        startActivityForResult(call, intent, "mediaPicked");
    }

    @ActivityCallback
    private void mediaPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = pickedUri(call, result);
        if (uri == null) return;
        runIo(call, () -> {
            String name = displayName(uri);
            String mime = getContext().getContentResolver().getType(uri);
            String type = mediaType(name, mime);
            File destination = store().mediaDestination(name);
            // Keep incomplete copies outside media/ so a crash cannot poison a later ZIP export.
            File temp = File.createTempFile("family-media-", ".incoming", getContext().getFilesDir());
            try {
                try (InputStream in = requireInput(uri); FileOutputStream out = new FileOutputStream(temp)) {
                    ArchiveStore.copyBounded(in, out, ArchiveStore.MAX_ENTRY);
                    out.getFD().sync();
                }
                // Do not replace existing attachments, even if another pick completed concurrently.
                synchronized (FamilyArchivePlugin.class) {
                    destination = store().mediaDestination(name);
                    if (!temp.renameTo(destination)) throw new IOException("Cannot save selected media");
                }
                call.resolve(mediaPickedResponse("media/" + destination.getName(), type, name));
            } finally { if (temp.exists()) temp.delete(); }
        });
    }

    static JSObject mediaPickedResponse(String path, String type, String title) {
        JSObject media = new JSObject();
        media.put("path", path);
        media.put("type", type);
        media.put("title", title);
        JSObject response = new JSObject();
        response.put("media", media);
        return response;
    }

    @PluginMethod
    public void openArchive(PluginCall call) { chooseArchive(call); }

    @PluginMethod
    public void importArchive(PluginCall call) { chooseArchive(call); }

    private void chooseArchive(PluginCall call) {
        startActivityForResult(call, picker("application/json", "application/zip", "application/x-zip-compressed", "application/octet-stream"), "archivePicked");
    }

    @ActivityCallback
    private void archivePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = pickedUri(call, result);
        if (uri == null) return;
        runIo(call, () -> {
            try (BufferedInputStream in = new BufferedInputStream(requireInput(uri))) {
                in.mark(8);
                int p = in.read(), k = in.read();
                in.reset();
                if (p == 'P' && k == 'K') store().importZip(in);
                else store().importJson(in);
            }
            JSObject response = new JSObject();
            response.put("archive", store().read());
            call.resolve(response);
        });
    }

    @PluginMethod
    public void exportArchive(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        intent.putExtra(Intent.EXTRA_TITLE, "family-archive.zip");
        startActivityForResult(call, intent, "archiveDestination");
    }

    @ActivityCallback
    private void archiveDestination(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri uri = pickedUri(call, result);
        if (uri == null) return;
        runIo(call, () -> {
            File staged = File.createTempFile("family-export-", ".zip", getContext().getCacheDir());
            try {
                try (FileOutputStream local = new FileOutputStream(staged)) {
                    store().exportZip(local);
                    local.getFD().sync();
                }
                try (InputStream in = new java.io.FileInputStream(staged);
                     OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new IOException("Cannot open selected export destination");
                    ArchiveStore.copyBounded(in, out, ArchiveStore.MAX_TOTAL + ArchiveStore.MAX_JSON);
                    out.flush();
                }
                JSObject response = new JSObject();
                response.put("status", "exported");
                call.resolve(response);
            } finally { staged.delete(); }
        });
    }

    private static Intent picker(String... types) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    private static Uri pickedUri(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return null;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("No document selected");
            return null;
        }
        return data.getData();
    }

    private InputStream requireInput(Uri uri) throws IOException {
        InputStream stream = getContext().getContentResolver().openInputStream(uri);
        if (stream == null) throw new IOException("Cannot read selected document");
        return stream;
    }

    private String displayName(Uri uri) throws IOException {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IOException("Document has no display name");
            String name = cursor.getString(0);
            if (name == null || name.isEmpty()) throw new IOException("Document has no display name");
            return name;
        }
    }

    private static String mediaType(String name, String mime) throws IOException {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.matches(".*\\.(jpg|jpeg|png|gif|webp|avif|bmp|svg|heic|heif)$")) return "photo";
        if (lower.matches(".*\\.(mp3|wav|m4a|ogg|opus|flac|aac)$")) return "audio";
        if (lower.matches(".*\\.(mp4|mov|webm|mkv|m4v|avi)$")) return "video";
        if (lower.matches(".*\\.(pdf|txt|md|rtf|doc|docx|odt|xls|xlsx|ppt|pptx|csv)$")) return "document";
        throw new IOException("Only images, audio, video, PDF and text documents are supported");
    }
}
