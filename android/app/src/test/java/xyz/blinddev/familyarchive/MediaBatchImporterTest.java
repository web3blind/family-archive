package xyz.blinddev.familyarchive;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONObject;
import java.io.*;
import java.nio.file.Files;
import java.util.*;

public class MediaBatchImporterTest {
    private MediaBatchImporter.Entry file(String name) { return new MediaBatchImporter.Entry(name, name, false); }
    private MediaBatchImporter.Source source(Map<String,byte[]> files, Map<String,List<MediaBatchImporter.Entry>> folders) {
        return new MediaBatchImporter.Source() {
            public List<MediaBatchImporter.Entry> children(MediaBatchImporter.Entry entry, int limit) throws Exception {
                List<MediaBatchImporter.Entry> result=folders.get(entry.id);
                if (result == null) throw new IOException("Folder unavailable");
                if (result.size() > limit) throw new IOException("Too many documents");
                return result;
            }
            public InputStream open(MediaBatchImporter.Entry entry) throws Exception {
                if (!files.containsKey(entry.id)) throw new IOException("Cannot read selected document");
                return new ByteArrayInputStream(files.get(entry.id));
            }
        };
    }
    private ArchiveStore store() throws IOException { return new ArchiveStore(Files.createTempDirectory("media-batch-test").toFile()); }
    @Test public void partialSuccessNamesFailuresAndPreservesBytes() throws Exception {
        ArchiveStore store=store();
        Map<String,byte[]> files=new HashMap<>();files.put("portrait.jpg", new byte[]{1,2,3});files.put("letter.pdf",new byte[]{4});
        MediaBatchImporter importer=new MediaBatchImporter(store,source(files,Collections.emptyMap()));
        JSONObject result=importer.run(Arrays.asList(file("portrait.jpg"),file("payload.exe"),file("missing.mp3"),file("letter.pdf")));
        assertEquals(2,result.getJSONArray("media").length());assertEquals(2,result.getJSONArray("errors").length());
        assertEquals("payload.exe",result.getJSONArray("errors").getJSONObject(0).getString("name"));
        assertEquals("missing.mp3",result.getJSONArray("errors").getJSONObject(1).getString("name"));
        File copied=store.mediaFile(result.getJSONArray("media").getJSONObject(0).getString("path"));
        assertArrayEquals(new byte[]{1,2,3},Files.readAllBytes(copied.toPath()));assertEquals(copied.getAbsoluteFile(),copied.getCanonicalFile());
    }
    @Test public void nestedFolderAndCycleAreBounded() throws Exception {
        ArchiveStore store=store();MediaBatchImporter.Entry root=new MediaBatchImporter.Entry("root","album",true);
        MediaBatchImporter.Entry nested=new MediaBatchImporter.Entry("nested","nested",true);
        Map<String,List<MediaBatchImporter.Entry>> folders=new HashMap<>();folders.put("root",Arrays.asList(nested,file("letter.pdf")));folders.put("nested",Arrays.asList(root,file("portrait.jpg")));
        Map<String,byte[]> files=new HashMap<>();files.put("letter.pdf",new byte[]{1});files.put("portrait.jpg",new byte[]{2});
        JSONObject result=new MediaBatchImporter(store,source(files,folders)).run(Collections.singletonList(root));
        assertEquals(2,result.getJSONArray("media").length());assertEquals(1,result.getJSONArray("errors").length());
        assertTrue(result.getJSONArray("errors").getJSONObject(0).getString("message").contains("cyclic"));
    }
    @Test public void fileTotalAndCountLimitsCleanupWithoutOverwrite() throws Exception {
        ArchiveStore store=store();Map<String,byte[]> files=new HashMap<>();files.put("a.txt",new byte[]{1,2,3,4});files.put("big.txt",new byte[9]);files.put("b.txt",new byte[4]);
        JSONObject result=new MediaBatchImporter(store,source(files,Collections.emptyMap()),5,7,3).run(Arrays.asList(file("a.txt"),file("big.txt"),file("b.txt")));
        assertEquals(1,result.getJSONArray("media").length());assertEquals(2,result.getJSONArray("errors").length());
        assertEquals(1,new File(store.root(),"media").listFiles().length);
        result=new MediaBatchImporter(store,source(files,Collections.emptyMap()),5,30,1).run(Collections.singletonList(file("a.txt")));
        assertEquals(0,result.getJSONArray("media").length());assertEquals(1,result.getJSONArray("errors").length());
        try(InputStream input=new ByteArrayInputStream(new byte[]{9})){File copy=store.addMedia("a.txt",input);assertEquals("a-1.txt",copy.getName());}
        assertArrayEquals(new byte[]{1,2,3,4},Files.readAllBytes(store.mediaFile("media/a.txt").toPath()));
    }
    @Test public void emptyBatchAndCancelDoNotCreateStorage() throws Exception {
        File base=Files.createTempDirectory("media-cancel-test").toFile();ArchiveStore store=new ArchiveStore(base);
        JSONObject result=new MediaBatchImporter(store,source(Collections.emptyMap(),Collections.emptyMap())).run(Collections.emptyList());
        assertEquals(0,result.getJSONArray("media").length());assertEquals(0,result.getJSONArray("errors").length());
        assertFalse(new File(base,"family-archive").exists());assertTrue(FamilyArchivePlugin.batchCancelledResponse().getBoolean("cancelled"));
    }
    @Test public void streamFailureAndOversizedFolderLeavePriorMediaIntact() throws Exception {
        ArchiveStore store=store();try(InputStream input=new ByteArrayInputStream(new byte[]{5})){store.addMedia("keep.txt",input);}
        MediaBatchImporter.Source failing=new MediaBatchImporter.Source(){
            public List<MediaBatchImporter.Entry> children(MediaBatchImporter.Entry entry,int limit)throws Exception{throw new IOException("Too many documents");}
            public InputStream open(MediaBatchImporter.Entry entry){return new InputStream(){public int read()throws IOException{throw new IOException("Provider disconnected");}};}
        };
        JSONObject result=new MediaBatchImporter(store,failing).run(Arrays.asList(file("bad.txt"),new MediaBatchImporter.Entry("folder","huge album",true)));
        assertEquals(2,result.getJSONArray("errors").length());assertEquals(0,result.getJSONArray("media").length());
        assertArrayEquals(new byte[]{5},Files.readAllBytes(store.mediaFile("media/keep.txt").toPath()));assertEquals(1,new File(store.root(),"media").listFiles().length);
    }
}
