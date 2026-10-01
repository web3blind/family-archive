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
    public void archiveIdentity(PluginCall call) {
        runIo(call, () -> {
            JSObject result = new JSObject();
            result.put("identity", store().archiveIdentity());
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
            try (InputStream in = requireInput(uri)) {
                File destination = store().addMedia(name, in);
                call.resolve(mediaPickedResponse("media/" + destination.getName(), type, name));
            }
        });
    }

    @PluginMethod
    public void pickMediaBatch(PluginCall call) {
        boolean folder = Boolean.TRUE.equals(call.getBoolean("folder", false));
        Intent intent = folder ? new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE) : picker("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (!folder) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try { startActivityForResult(call, intent, "mediaBatchPicked"); }
        catch (Exception failure) {
            call.reject(folder ? "Выбор папки недоступен. Выберите несколько файлов вместо папки." : "Выбор файлов недоступен.", failure);
        }
    }

    @ActivityCallback
    private void mediaBatchPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            call.resolve(batchCancelledResponse());
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) { call.reject("No documents selected"); return; }
        runIo(call, () -> {
            boolean folder = Boolean.TRUE.equals(call.getBoolean("folder", false));
            java.util.List<MediaBatchImporter.Entry> selected = new java.util.ArrayList<>();
            org.json.JSONArray initialErrors = new org.json.JSONArray();
            if (folder) {
                Uri tree = data.getData();
                if (tree == null || !"content".equals(tree.getScheme()) || tree.getPathSegments().size() < 2 || !"tree".equals(tree.getPathSegments().get(0)))
                    throw new IOException("Выбранная папка недоступна. Выберите несколько файлов вместо папки.");
                Uri root = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, android.provider.DocumentsContract.getTreeDocumentId(tree));
                selected.add(new MediaBatchImporter.Entry(root.toString(), "Selected folder", true));
            } else {
                android.content.ClipData clips = data.getClipData();
                int count = clips == null ? (data.getData() == null ? 0 : 1) : clips.getItemCount();
                if (count == 0) throw new IOException("No documents selected");
                for (int i=0; i<Math.min(count, MediaBatchImporter.MAX_VISITS); i++) {
                    Uri uri = clips == null ? data.getData() : clips.getItemAt(i).getUri();
                    try {
                        if (uri == null || !"content".equals(uri.getScheme())) throw new IOException("Unsupported document URI");
                        selected.add(new MediaBatchImporter.Entry(uri.toString(), displayName(uri), false));
                    } catch (Exception failure) {
                        initialErrors.put(new JSONObject().put("name", "Selected document " + (i+1)).put("message", failure.getMessage() == null ? "Cannot read document name" : failure.getMessage()));
                    }
                }
                if (count > MediaBatchImporter.MAX_VISITS) initialErrors.put(new JSONObject().put("name", "Selection").put("message", "Too many selected documents"));
            }
            MediaBatchImporter importer = new MediaBatchImporter(store(), new MediaBatchImporter.Source() {
                @Override public InputStream open(MediaBatchImporter.Entry entry) throws Exception { return requireInput(Uri.parse(entry.id)); }
                @Override public java.util.List<MediaBatchImporter.Entry> children(MediaBatchImporter.Entry entry, int limit) throws Exception {
                    Uri parent = Uri.parse(entry.id);
                    Uri children = android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(parent, android.provider.DocumentsContract.getDocumentId(parent));
                    String[] columns = {android.provider.DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME, android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE};
                    java.util.List<MediaBatchImporter.Entry> entries = new java.util.ArrayList<>();
                    try (Cursor cursor = getContext().getContentResolver().query(children, columns, null, null, null)) {
                        if (cursor == null) throw new IOException("Cannot read selected folder. Select multiple files instead.");
                        while (cursor.moveToNext()) {
                            if (entries.size() >= limit) throw new IOException("Too many documents in selected folder");
                            String id = cursor.getString(0), name = cursor.getString(1), mime = cursor.getString(2);
                            if (id == null || name == null) throw new IOException("Invalid document provider entry");
                            Uri child = android.provider.DocumentsContract.buildDocumentUriUsingTree(parent, id);
                            entries.add(new MediaBatchImporter.Entry(child.toString(), name,
                                android.provider.DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)));
                        }
                    }
                    return entries;
                }
            });
            JSONObject imported = importer.run(selected);
            org.json.JSONArray errors = imported.getJSONArray("errors");
            for (int i=0; i<initialErrors.length(); i++) errors.put(initialErrors.get(i));
            JSObject response = new JSObject();
            response.put("media", imported.getJSONArray("media"));
            response.put("errors", errors);
            call.resolve(response);
        });
    }

    static JSObject batchCancelledResponse() {
        JSObject response = new JSObject();
        response.put("cancelled", true);
        return response;
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
