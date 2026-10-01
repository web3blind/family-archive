package xyz.blinddev.familyarchive;
import java.io.*;
/** CLI integration harness: uses the same storage code compiled into the APK. */
public class PortableRoundtrip {
 public static void main(String[] args) throws Exception {
  ArchiveStore store = new ArchiveStore(new File(args[0]));
  try(InputStream in = new FileInputStream(args[1])) {store.importZip(in);}
  try(OutputStream out = new FileOutputStream(args[2])) {store.exportZip(out);}
  System.out.println("Android storage imported desktop ZIP and exported: " + store.read().getString("title"));
 }
}
