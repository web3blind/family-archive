package xyz.blinddev.familyarchive;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class ArchiveValidatorTest {
    @Test public void commonJavaScriptAndAndroidValidationCorpus() throws Exception {
        byte[] bytes = Files.readAllBytes(new File(System.getProperty("family.archive.fixtures")).toPath());
        JSONArray cases = new JSONArray(new String(bytes, StandardCharsets.UTF_8));
        for (int i = 0; i < cases.length(); i++) {
            JSONObject item = cases.getJSONObject(i);
            try {
                ArchiveValidator.normalize(item.getJSONObject("archive"));
                assertTrue("Unexpected acceptance: " + item.getString("label"), item.getBoolean("valid"));
            } catch (IOException error) {
                assertFalse("Unexpected rejection: " + item.getString("label") + ": " + error.getMessage(), item.getBoolean("valid"));
            }
        }
    }
    @Test public void missingMediaAndInvalidJsonNeverReplaceWorkingArchiveOrBackup() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("family-validation").toFile());
        store.write(new JSONObject("{\"title\":\"prior\"}"));
        store.write(new JSONObject("{\"title\":\"current\"}"));
        byte[] current = Files.readAllBytes(new File(store.root(),"archive.json").toPath());
        byte[] backup = Files.readAllBytes(new File(store.root(),"archive.json.bak").toPath());
        for (String data : new String[]{"{\"people\":[{\"id\":\"p\",\"motherId\":\"missing\"}]}",
            "{\"media\":[{\"id\":\"m\",\"path\":\"media/missing.jpg\"}]}"}) {
            try { store.importJson(new ByteArrayInputStream(data.getBytes(StandardCharsets.UTF_8))); fail("Invalid import accepted"); }
            catch (IOException expected) { /* checked before replacement */ }
            assertArrayEquals(current, Files.readAllBytes(new File(store.root(),"archive.json").toPath()));
            assertArrayEquals(backup, Files.readAllBytes(new File(store.root(),"archive.json.bak").toPath()));
        }
    }
    @Test public void completeExportIncludesUnreferencedFilesAndChecksMissingReferencesBeforeWriting() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("family-all-files").toFile());
        store.write(new JSONObject("{\"title\":\"family\"}"));
        File orphan = new File(store.root(),"media/Альбом/Письмо (1954).pdf");
        assertTrue(orphan.getParentFile().mkdir());
        Files.write(orphan.toPath(), new byte[]{1,2,3});
        ByteArrayOutputStream exported = new ByteArrayOutputStream(); store.exportZip(exported);
        ArchiveStore next = new ArchiveStore(Files.createTempDirectory("family-all-files-copy").toFile());
        next.importZip(new ByteArrayInputStream(exported.toByteArray()));
        assertArrayEquals(new byte[]{1,2,3}, Files.readAllBytes(new File(next.root(),"media/Альбом/Письмо (1954).pdf").toPath()));
        JSONObject broken = store.read(); broken.put("media",new JSONArray("[{\"id\":\"m\",\"path\":\"media/missing.jpg\"}]"));
        Files.write(new File(store.root(),"archive.json").toPath(), broken.toString().getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream untouched = new ByteArrayOutputStream();
        try { store.exportZip(untouched); fail("Missing referenced file exported"); } catch(IOException expected) {}
        assertEquals(0,untouched.size());
    }
    @Test public void largeFileAndTooManyFilesFailExportBeforeOutputIsWritten() throws Exception {
        ArchiveStore store = new ArchiveStore(Files.createTempDirectory("family-budget").toFile());
        store.write(new JSONObject("{}"));
        File huge = new File(store.root(),"media/huge.mp4");
        try (RandomAccessFile file = new RandomAccessFile(huge,"rw")) { file.setLength(ArchiveStore.MAX_ENTRY+1); }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {store.exportZip(output); fail("Oversize accepted");} catch(IOException expected) {}
        assertEquals(0,output.size()); assertTrue(huge.delete());
        for(int i=0;i<ArchiveStore.MAX_ENTRIES;i++) assertTrue(new File(store.root(),"media/f"+i+".jpg").createNewFile());
        try {store.exportZip(output); fail("Too many files accepted");} catch(IOException expected) {}
        assertEquals(0,output.size());
    }
}
