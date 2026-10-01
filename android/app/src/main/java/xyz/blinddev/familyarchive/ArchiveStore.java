package xyz.blinddev.familyarchive;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/** Private archive storage. Never follows names from a ZIP as filesystem paths. */
final class ArchiveStore {
    static final int MAX_JSON = 16 * 1024 * 1024;
    static final long MAX_ENTRY = 512L * 1024 * 1024;
    static final long MAX_TOTAL = 1024L * 1024 * 1024;
    static final int MAX_ENTRIES = 1000;
    private final File base;
    private final File root;

    ArchiveStore(File filesDir) {
        base = filesDir;
        root = new File(base, "family-archive");
    }

    File root() throws IOException {
        if (!root.exists()) {
            File previous = new File(base, "family-archive-backup");
            if (previous.isDirectory() && !previous.renameTo(root))
                throw new IOException("Cannot restore archive after interrupted import");
        }
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create private archive directory");
        File media = new File(root, "media");
        if (!media.isDirectory() && !media.mkdirs()) throw new IOException("Cannot create private media directory");
        return root;
    }

    JSONObject read() throws IOException, JSONException {
        File file = new File(root(), "archive.json");
        if (!file.exists()) {
            File backup = new File(root, "archive.json.bak");
            if (!backup.exists()) return null;
            JSONObject recovered = parse(readBounded(new FileInputStream(backup), MAX_JSON));
            if (!backup.renameTo(file)) throw new IOException("Could not restore interrupted archive save");
            return recovered;
        }
        return parse(readBounded(new FileInputStream(file), MAX_JSON));
    }

    void write(JSONObject archive) throws IOException, JSONException {
        archive = ArchiveValidator.normalize(archive);
        root();
        checkMediaFiles(archive, root);
        atomicJson(root, archive);
    }

    File mediaFile(String path) throws IOException {
        if (!validMediaPath(path)) throw new IOException("Unsafe media path");
        File file = new File(root(), path);
        if (!file.isFile() || !file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("Missing or unsafe media: " + path);
        return file;
    }

    private static void checkMediaFiles(JSONObject archive, File directory) throws IOException, JSONException {
        JSONArray media = archive.getJSONArray("media");
        for (int i=0; i<media.length(); i++) {
            String path = media.getJSONObject(i).getString("path");
            File file = new File(directory, path);
            if (!file.isFile() || !file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("Referenced media missing: " + path);
        }
    }

    File mediaDestination(String filename) throws IOException {
        root();
        String name = safeName(filename);
        String stem = name.substring(0, name.lastIndexOf('.'));
        String ext = name.substring(name.lastIndexOf('.'));
        File media = new File(root, "media");
        for (int i = 0; i < 10000; i++) {
            String candidate = i == 0 ? name : stem + "-" + i + ext;
            File file = new File(media, candidate);
            if (!file.exists()) return file;
        }
        throw new IOException("Too many files with the same name");
    }

    static String safeName(String name) throws IOException {
        if (name == null) throw new IOException("Missing filename");
        String cleaned = name.replaceAll("[^\\p{L}\\p{N}._-]", "-").replaceAll("^-+", "");
        int dot = cleaned.lastIndexOf('.');
        if (cleaned.length() > 120 && dot > 0) {
            String extension = cleaned.substring(dot);
            cleaned = cleaned.substring(0, Math.max(1, 120 - extension.length())) + extension;
        }
        if (cleaned.isEmpty() || cleaned.startsWith(".") || !cleaned.matches("[\\p{L}\\p{N}][\\p{L}\\p{N}._-]*\\.[\\p{L}\\p{N}]{1,12}") || !supportedExtension(cleaned))
            throw new IOException("Unsupported filename");
        return cleaned;
    }

    static boolean validMediaName(String name) {
        return name != null && name.length() <= 160 &&
            name.matches("[\\p{L}\\p{N} _.,()\\-]{1,160}") && !name.startsWith(".") && supportedExtension(name);
    }

    static boolean validMediaPath(String path) {
        if (path == null || !path.startsWith("media/") || path.length() > 1024) return false;
        String[] parts = path.substring(6).split("/", -1);
        if (parts.length == 0 || !validMediaName(parts[parts.length - 1])) return false;
        for (int i = 0; i < parts.length - 1; i++) {
            if (parts[i].isEmpty() || parts[i].equals(".") || parts[i].equals("..") || parts[i].startsWith(".") ||
                !parts[i].matches("[\\p{L}\\p{N} _.,()\\-]{1,160}")) return false;
        }
        return true;
    }

    private static boolean supportedExtension(String name) {
        return name.toLowerCase(java.util.Locale.ROOT).matches(
            ".*\\.(jpg|jpeg|png|gif|webp|avif|bmp|svg|heic|heif|mp3|m4a|wav|ogg|opus|flac|aac|mp4|webm|mov|mkv|m4v|avi|pdf|txt|md|rtf|doc|docx|odt|xls|xlsx|ppt|pptx|csv)");
    }

    void importJson(InputStream input) throws IOException, JSONException {
        JSONObject archive = parse(readBounded(input, MAX_JSON));
        write(archive); // JSON-only import leaves existing media intact.
    }

    void importZip(InputStream input) throws IOException, JSONException {
        File staged = new File(base, "family-archive-stage-" + UUID.randomUUID());
        if (!staged.mkdirs()) throw new IOException("Could not stage archive");
        boolean committed = false;
        try {
            Set<String> seen = new HashSet<>();
            long total = 0;
            int count = 0;
            boolean hasJson = false;
            try (ZipInputStream zip = new ZipInputStream(input)) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    String name = entry.getName();
                    if (++count > MAX_ENTRIES || !seen.add(name)) throw new IOException("Too many or duplicate ZIP entries");
                    if (entry.isDirectory()) {
                        if (!"media/".equals(name) && !validMediaDirectory(name)) throw new IOException("Unknown ZIP directory");
                        zip.closeEntry();
                        continue;
                    }
                    if (!"archive.json".equals(name) && !validMediaPath(name))
                        throw new IOException("Unsafe or unknown ZIP entry");
                    File target = new File(staged, name);
                    if ("archive.json".equals(name)) hasJson = true;
                    File parent = target.getParentFile();
                    if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot stage ZIP entry");
                    long entrySize = 0;
                    byte[] buffer = new byte[32768];
                    try (FileOutputStream out = new FileOutputStream(target)) {
                        int n;
                        while ((n = zip.read(buffer)) != -1) {
                            entrySize += n;
                            total += n;
                            if (entrySize > ("archive.json".equals(name) ? MAX_JSON : MAX_ENTRY) || total > MAX_TOTAL)
                                throw new IOException("Archive exceeds size limit");
                            out.write(buffer, 0, n);
                        }
                        out.getFD().sync();
                    }
                    zip.closeEntry();
                }
            }
            if (!hasJson) throw new IOException("ZIP has no archive.json");
            JSONObject archive = parse(readBounded(new FileInputStream(new File(staged, "archive.json")), MAX_JSON));
            for (int i = 0; i < archive.getJSONArray("media").length(); i++) {
                String path = archive.getJSONArray("media").getJSONObject(i).optString("path", "");
                if (!path.isEmpty() && !new File(staged, path).isFile())
                    throw new IOException("Referenced media missing from ZIP: " + path);
            }
            File media = new File(staged, "media");
            if (!media.isDirectory() && !media.mkdir()) throw new IOException("Cannot stage media folder");
            File backup = new File(base, "family-archive-backup");
            if (backup.exists()) deleteTree(backup);
            if (root.exists() && !root.renameTo(backup)) throw new IOException("Cannot back up existing archive");
            if (!staged.renameTo(root)) {
                if (backup.exists() && !backup.renameTo(root)) throw new IOException("Archive replacement failed; backup retained at " + backup);
                throw new IOException("Archive replacement failed; previous archive restored");
            }
            committed = true;
            // Keep the previous complete archive as a recovery copy until the next successful import.
        } finally {
            if (!committed) deleteTree(staged);
        }
    }

    void exportZip(OutputStream output) throws IOException, JSONException {
        JSONObject archive = read();
        if (archive == null) throw new IOException("No archive to export");
        checkMediaFiles(archive, root);
        java.util.Map<String, File> files = new java.util.LinkedHashMap<>();
        files.put("archive.json", new File(root, "archive.json"));
        collectMedia(new File(root, "media"), "media/", files);
        long total = 0;
        for (java.util.Map.Entry<String,File> entry : files.entrySet()) {
            long size = entry.getValue().length();
            if (size > ("archive.json".equals(entry.getKey()) ? MAX_JSON : MAX_ENTRY) || (total += size) > MAX_TOTAL)
                throw new IOException("Archive exceeds portable size limit");
        }
        // Close ZIP/deflater resources without closing the caller's SAF destination.
        try (ZipOutputStream zip = new ZipOutputStream(new java.io.FilterOutputStream(output) {
            @Override public void close() throws IOException { flush(); }
        })) {
            long written = 0;
            for (java.util.Map.Entry<String, File> entry : files.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                long limit = "archive.json".equals(entry.getKey()) ? MAX_JSON : MAX_ENTRY;
                try (FileInputStream in = new FileInputStream(entry.getValue())) {
                    written += copyBounded(in, zip, Math.min(limit, MAX_TOTAL - written));
                }
                zip.closeEntry();
            }
        }
    }

    private static boolean validMediaDirectory(String path) {
        return path.endsWith("/") && validMediaPath(path + "placeholder.jpg");
    }

    private static void collectMedia(File dir, String prefix, java.util.Map<String,File> files) throws IOException {
        if (!dir.getCanonicalFile().equals(dir.getAbsoluteFile())) throw new IOException("Unsafe media directory");
        File[] children = dir.listFiles();
        if (children == null) throw new IOException("Media directory unavailable");
        for (File file : children) {
            if (!file.getCanonicalFile().equals(file.getAbsoluteFile())) throw new IOException("Unsafe media link");
            if (file.isDirectory()) {
                if (!validMediaDirectory(prefix + file.getName() + "/")) throw new IOException("Unsafe media directory");
                collectMedia(file, prefix + file.getName() + "/", files);
            } else {
                if (!file.isFile() || !validMediaPath(prefix + file.getName())) throw new IOException("Unsafe media file");
                files.put(prefix + file.getName(), file);
                if (files.size() > MAX_ENTRIES) throw new IOException("Too many archive files");
            }
        }
    }

    private static JSONObject parse(byte[] bytes) throws IOException, JSONException {
        return ArchiveValidator.normalize(new JSONObject(new String(bytes, StandardCharsets.UTF_8)));
    }

    static byte[] readBounded(InputStream source, long max) throws IOException {
        try (InputStream in = source; java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[32768];
            int n;
            long total = 0;
            while ((n = in.read(buffer)) != -1) {
                total += n;
                if (total > max) throw new IOException("File exceeds size limit");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    static long copyBounded(InputStream in, OutputStream out, long max) throws IOException {
        byte[] buffer = new byte[32768];
        long total = 0;
        int n;
        while ((n = in.read(buffer)) != -1) {
            total += n;
            if (total > max) throw new IOException("File exceeds size limit");
            out.write(buffer, 0, n);
        }
        return total;
    }

    private static void atomicJson(File dir, JSONObject archive) throws IOException {
        byte[] data = archive.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > MAX_JSON) throw new IOException("Archive JSON exceeds size limit");
        File target = new File(dir, "archive.json");
        File backup = new File(dir, "archive.json.bak");
        File temp = new File(dir, "archive.json.tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (target.exists()) {
            if (backup.exists() && !backup.delete()) throw new IOException("Cannot rotate archive backup");
            if (!target.renameTo(backup)) throw new IOException("Cannot back up archive JSON");
        }
        if (!temp.renameTo(target)) {
            if (backup.exists() && !backup.renameTo(target)) throw new IOException("Save failed; archive backup retained");
            throw new IOException("Save failed; previous archive restored");
        }
    }

    private static void deleteTree(File file) throws IOException {
        if (!file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Cannot list staging directory");
            for (File child : children) deleteTree(child);
        }
        if (!file.delete()) throw new IOException("Cannot clean staging directory");
    }
}
