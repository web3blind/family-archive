package xyz.blinddev.familyarchive;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Bounded provider-independent importer; only the plugin may obtain SAF grants. */
final class MediaBatchImporter {
    static final int MAX_VISITS = 4000;
    static final int MAX_DEPTH = 32;
    static final class Entry {
        final String id, name;
        final boolean directory;
        Entry(String id, String name, boolean directory) { this.id=id; this.name=name; this.directory=directory; }
    }
    interface Source {
        List<Entry> children(Entry parent, int limit) throws Exception;
        InputStream open(Entry entry) throws Exception;
    }
    private final ArchiveStore store;
    private final Source source;
    private final long fileLimit, totalLimit;
    private final int countLimit;
    private final JSONArray media = new JSONArray(), errors = new JSONArray();
    private final Set<String> seen = new HashSet<>();
    private int visits;
    private long readBytes;

    MediaBatchImporter(ArchiveStore store, Source source) {
        this(store, source, ArchiveStore.MAX_ENTRY, ArchiveStore.MAX_TOTAL, ArchiveStore.MAX_ENTRIES - 1);
    }
    MediaBatchImporter(ArchiveStore store, Source source, long fileLimit, long totalLimit, int countLimit) {
        this.store=store; this.source=source; this.fileLimit=fileLimit; this.totalLimit=totalLimit; this.countLimit=countLimit;
    }
    JSONObject run(List<Entry> entries) throws Exception {
        for (Entry entry : entries) { visit(entry, 0); if (visits > MAX_VISITS) break; }
        return new JSONObject().put("media", media).put("errors", errors);
    }
    private void error(String name, Exception error) throws Exception {
        errors.put(new JSONObject().put("name", name == null ? "document" : name)
            .put("message", error.getMessage() == null ? "Cannot import document" : error.getMessage()));
    }
    private void visit(Entry entry, int depth) throws Exception {
        if (++visits > MAX_VISITS) { if (visits == MAX_VISITS + 1) error(entry.name, new IOException("Too many selected documents")); return; }
        try {
            if (depth > MAX_DEPTH) throw new IOException("Selected folder is too deeply nested");
            if (!seen.add(entry.id)) throw new IOException("Duplicate or cyclic document reference");
            if (entry.directory) {
                for (Entry child : source.children(entry, MAX_VISITS - visits)) {
                    visit(child, depth + 1);
                    if (visits > MAX_VISITS) break;
                }
                return;
            }
            String type = mediaType(entry.name);
            if (readBytes >= totalLimit) throw new IOException("Batch exceeds total read limit");
            try (InputStream input = new FilterInputStream(source.open(entry)) {
                @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                    int n = super.read(bytes, offset, length);
                    if (n > 0 && (readBytes += n) > totalLimit) throw new IOException("Batch exceeds total read limit");
                    return n;
                }
            }) {
                File destination = store.addMedia(entry.name, input, fileLimit, totalLimit, countLimit);
                media.put(new JSONObject().put("path", "media/" + destination.getName()).put("type", type).put("title", entry.name));
            }
        } catch (Exception failure) { error(entry.name, failure); }
    }
    static String mediaType(String name) throws IOException {
        if (name == null) throw new IOException("Document has no display name");
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        if (lower.matches(".*\\.(jpg|jpeg|png|gif|webp|avif|bmp|svg|heic|heif)$")) return "photo";
        if (lower.matches(".*\\.(mp3|wav|m4a|ogg|opus|flac|aac)$")) return "audio";
        if (lower.matches(".*\\.(mp4|mov|webm|mkv|m4v|avi)$")) return "video";
        if (lower.matches(".*\\.(pdf|txt|md|rtf|doc|docx|odt|xls|xlsx|ppt|pptx|csv)$")) return "document";
        throw new IOException("Only images, audio, video and supported documents can be imported");
    }
}
