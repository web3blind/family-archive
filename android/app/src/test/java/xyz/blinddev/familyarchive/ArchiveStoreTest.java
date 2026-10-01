package xyz.blinddev.familyarchive;

import static org.junit.Assert.*;
import org.junit.Test;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.zip.ZipOutputStream;
import java.util.zip.ZipEntry;
import org.json.JSONObject;

public class ArchiveStoreTest {
    @Test public void identityPersistsAcrossWritesRestartsAndBackupRecovery() throws Exception {
        File dir = Files.createTempDirectory("archive-identity-test").toFile();
        ArchiveStore store = new ArchiveStore(dir);
        String identity = store.archiveIdentity();
        assertFalse(identity.isEmpty());
        store.write(archive("saved", "[]"));
        assertEquals(identity, store.archiveIdentity());
        assertEquals(identity, new ArchiveStore(dir).archiveIdentity());
        assertNotEquals(identity, new ArchiveStore(Files.createTempDirectory("other-archive").toFile()).archiveIdentity());
        assertTrue(store.root().renameTo(new File(dir, "family-archive-backup")));
        assertEquals(identity, new ArchiveStore(dir).archiveIdentity());
    }

    @Test public void identityChangesOnlyOnSuccessfulImportsAndNeverLeaksInZip() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("archive-generation-test").toFile());
        String old = store.archiveIdentity();
        store.write(archive("before", "[]"));
        File image = new File(store.root(), "media/photo.jpg");
        Files.write(image.toPath(), new byte[] {1,2,3});
        for (byte[] invalid : new byte[][] {
            zip("archive.json", archive("bad", "[]").toString(), ".family-archive-identity", old),
            zip("archive.json", archive("bad", "[{\"id\":\"missing\",\"path\":\"media/missing.jpg\"}]").toString())
        }) {
            try { store.importZip(new ByteArrayInputStream(invalid)); fail("Accepted bad import"); }
            catch (IOException expected) { assertEquals(old, store.archiveIdentity()); }
        }
        try { store.importJson(new ByteArrayInputStream("bad json".getBytes())); fail("Accepted bad JSON"); }
        catch (org.json.JSONException expected) { assertEquals(old, store.archiveIdentity()); }
        store.importJson(new ByteArrayInputStream(archive("new", "[]").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        String jsonGeneration = store.archiveIdentity();
        assertNotEquals(old, jsonGeneration);
        assertArrayEquals(new byte[] {1,2,3}, Files.readAllBytes(image.toPath()));
        assertEquals(jsonGeneration, new ArchiveStore(store.root().getParentFile()).archiveIdentity());
        ByteArrayOutputStream output = new ByteArrayOutputStream(); store.exportZip(output);
        try (java.util.zip.ZipInputStream in = new java.util.zip.ZipInputStream(new ByteArrayInputStream(output.toByteArray()))) {
            ZipEntry entry; while ((entry = in.getNextEntry()) != null) assertFalse(entry.getName().contains("identity"));
        }
        store.importZip(new ByteArrayInputStream(output.toByteArray()));
        String zipGeneration = store.archiveIdentity(); assertNotEquals(jsonGeneration, zipGeneration);
        store.importZip(new ByteArrayInputStream(output.toByteArray())); assertNotEquals(zipGeneration, store.archiveIdentity());
    }

    @Test public void identityFailsClosedForCorruptOrLinkedMarker() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("archive-marker-test").toFile());
        File marker = new File(store.root(), ".family-archive-identity");
        Files.write(marker.toPath(), "broken".getBytes());
        try { store.archiveIdentity(); fail("Accepted corrupt marker"); } catch (IOException expected) { }
        assertTrue(marker.delete());
        File external = new File(store.root().getParentFile(), "external"); Files.write(external.toPath(), "12345678-1234-4123-8123-123456789abc".getBytes());
        Files.createSymbolicLink(marker.toPath(), external.toPath());
        try { store.archiveIdentity(); fail("Accepted linked marker"); } catch (IOException expected) { }
    }
    @Test public void rejectsZipTraversalAndUnknownContents() {
        assertFalse(ArchiveStore.validMediaName("../x.jpg"));
        assertFalse(ArchiveStore.validMediaName("x/y.jpg"));
        assertFalse(ArchiveStore.validMediaName(".hidden.jpg"));
        assertFalse(ArchiveStore.validMediaName("payload.html"));
        assertFalse(ArchiveStore.validMediaName("bad\\name.jpg"));
        assertTrue(ArchiveStore.validMediaName("family photo.jpg"));
        assertTrue(ArchiveStore.validMediaName("письмо.pdf"));
    }

    @Test public void sanitizesImportedNamesAndDoesNotOverwriteExisting() throws Exception {
        File dir = Files.createTempDirectory("archive-store-test").toFile();
        try {
            ArchiveStore store = new ArchiveStore(dir);
            File first = store.mediaDestination("family picture.JPG");
            assertEquals("family-picture.JPG", first.getName());
            assertTrue(first.createNewFile());
            assertEquals("family-picture-1.JPG", store.mediaDestination("family picture.JPG").getName());
        } finally {
            new File(new File(dir, "family-archive"), "media/family-picture.JPG").delete();
            new File(new File(dir, "family-archive"), "media").delete();
            new File(dir, "family-archive").delete();
            dir.delete();
        }
    }

    @Test public void longFileNamePreservesExtension() throws Exception {
        String name = ArchiveStore.safeName(new String(new char[200]).replace("\0", "я") + ".jpg");
        assertTrue(name.endsWith(".jpg")); assertTrue(name.length() <= 120); assertTrue(ArchiveStore.validMediaName(name));
    }

    @Test public void rejectsUnsupportedNames() throws Exception {
        for (String name : new String[] {".hidden.pdf", "", "x", "a/../../x", "a\\b.exe"}) {
            try { ArchiveStore.safeName(name); fail("Accepted " + name); }
            catch (IOException expected) { /* invalid selection */ }
        }
    }

    private static JSONObject archive(String title, String media) throws Exception {
        return new JSONObject("{\"version\":1,\"title\":\"" + title + "\",\"people\":[],\"stories\":[],\"media\":" + media + "}");
    }

    private static byte[] zip(String... entries) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            for (int i = 0; i < entries.length; i += 2) {
                out.putNextEntry(new ZipEntry(entries[i]));
                out.write(entries[i + 1].getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    @Test public void writeAndReadAndExportRoundtrip() throws Exception {
        File dir = Files.createTempDirectory("archive-zip-test").toFile();
        ArchiveStore store = new ArchiveStore(dir);
        store.write(archive("before", "[]"));
        assertEquals("before", store.read().getString("title"));
        assertTrue(new File(store.root(), "archive.json").isFile());
        Files.write(new File(store.root(), "media/family.jpg").toPath(), new byte[] {1, 2, 3});
        store.write(archive("after", "[{\"id\":\"media-1\",\"path\":\"media/family.jpg\"}]"));
        assertEquals("before", new JSONObject(new String(Files.readAllBytes(new File(store.root(), "archive.json.bak").toPath()))).getString("title"));
        ByteArrayOutputStream exported = new ByteArrayOutputStream();
        store.exportZip(exported);
        ArchiveStore replacement = new ArchiveStore(Files.createTempDirectory("archive-import-test").toFile());
        replacement.importZip(new ByteArrayInputStream(exported.toByteArray()));
        assertEquals("after", replacement.read().getString("title"));
        assertArrayEquals(new byte[] {1, 2, 3}, Files.readAllBytes(new File(replacement.root(), "media/family.jpg").toPath()));
    }

    @Test public void invalidZipNeverReplacesPriorArchive() throws Exception {
        File dir = Files.createTempDirectory("archive-invalid-test").toFile();
        ArchiveStore store = new ArchiveStore(dir);
        store.write(archive("keep", "[]"));
        for (byte[] bad : new byte[][] {
            zip("archive.json", archive("replace", "[]").toString(), "media/../evil.pdf", "evil"),
            zip("archive.json", archive("replace", "[{\"id\":\"missing\",\"path\":\"media/missing.jpg\"}]").toString()),
            zip("archive.json", archive("replace", "[]").toString(), "media/payload.html", "hello")
        }) {
            try { store.importZip(new ByteArrayInputStream(bad)); fail("Accepted invalid ZIP"); }
            catch (IOException expected) { assertEquals("keep", store.read().getString("title")); }
        }
    }

    @Test public void recoversInterruptedJsonSaveAndZipSwap() throws Exception {
        File dir = Files.createTempDirectory("archive-recovery-test").toFile();
        ArchiveStore store = new ArchiveStore(dir);
        store.write(archive("prior", "[]"));
        store.write(archive("current", "[]"));
        File root = store.root();
        assertTrue(new File(root, "archive.json").delete());
        assertEquals("prior", store.read().getString("title"));
        File previous = new File(dir, "family-archive-backup");
        assertTrue(root.renameTo(previous));
        assertEquals("prior", store.read().getString("title"));
        assertTrue(root.isDirectory());
    }

    @Test public void jsonImportKeepsPriorMediaFiles() throws Exception {
        File dir = Files.createTempDirectory("archive-json-test").toFile();
        ArchiveStore store = new ArchiveStore(dir);
        store.write(archive("old", "[]"));
        File image = new File(store.root(), "media/family.jpg");
        assertTrue(image.createNewFile());
        store.importJson(new ByteArrayInputStream(archive("new", "[]").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        assertEquals("new", store.read().getString("title"));
        assertTrue(image.isFile());
    }

    @Test public void mediaPickerResponseHasAdapterShape() {
        org.json.JSONObject result = FamilyArchivePlugin.mediaPickedResponse("media/portrait.jpg", "photo", "portrait.jpg");
        assertEquals("media/portrait.jpg", result.optJSONObject("media").optString("path"));
        assertEquals("photo", result.optJSONObject("media").optString("type"));
        assertEquals("portrait.jpg", result.optJSONObject("media").optString("title"));
    }

    @Test public void exportDoesNotCloseCallerOwnedStream() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("archive-export-test").toFile());
        store.write(archive("test", "[]"));
        class Destination extends ByteArrayOutputStream {
            boolean closed;
            @Override public void close() throws IOException { closed = true; super.close(); }
        }
        Destination destination = new Destination();
        store.exportZip(destination);
        assertFalse("The plugin owns the SAF destination", destination.closed);
    }

    @Test public void nestedMediaInPortableZipRoundtrips() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("archive-nested-test").toFile());
        byte[] incoming = zip("archive.json", archive("nested", "[{\"id\":\"photo\",\"type\":\"photo\",\"path\":\"media/reunion/portrait.jpg\"}]").toString(),
            "media/reunion/portrait.jpg", "portrait");
        store.importZip(new ByteArrayInputStream(incoming));
        assertEquals("nested", store.read().getString("title"));
        ByteArrayOutputStream exported = new ByteArrayOutputStream();
        store.exportZip(exported);
        ArchiveStore next = new ArchiveStore(Files.createTempDirectory("archive-nested-next").toFile());
        next.importZip(new ByteArrayInputStream(exported.toByteArray()));
        assertEquals("portrait", new String(Files.readAllBytes(new File(next.root(), "media/reunion/portrait.jpg").toPath())));
    }
}
