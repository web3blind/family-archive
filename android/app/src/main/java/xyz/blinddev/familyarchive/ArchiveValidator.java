package xyz.blinddev.familyarchive;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Validates references before an imported archive can replace the working copy. */
final class ArchiveValidator {
    private static boolean absent(Object value) { return value == null || value == JSONObject.NULL; }
    private static String text(JSONObject object, String key, String fallback) throws IOException, JSONException {
        Object value = object.opt(key);
        if (absent(value)) { object.put(key, fallback); return fallback; }
        if (!(value instanceof String)) throw new IOException(key + ": expected text");
        return (String)value;
    }
    private static String id(Object value) throws IOException {
        if (!(value instanceof String) || ((String)value).trim().isEmpty() || ((String)value).length() > 200)
            throw new IOException("Invalid record ID");
        return (String)value;
    }
    private static String optionalId(JSONObject object, String key) throws IOException, JSONException {
        Object value = object.opt(key);
        if (absent(value) || "".equals(value)) { object.put(key, JSONObject.NULL); return null; }
        return id(value);
    }
    private static JSONArray array(JSONObject object, String key) throws IOException, JSONException {
        Object value = object.opt(key);
        if (absent(value)) { JSONArray result = new JSONArray(); object.put(key, result); return result; }
        if (!(value instanceof JSONArray)) throw new IOException(key + ": expected a list");
        return (JSONArray)value;
    }
    private static void idList(JSONObject object, String key) throws IOException, JSONException {
        JSONArray values = array(object, key); Set<String> seen = new HashSet<>();
        for (int i = 0; i < values.length(); i++) if (!seen.add(id(values.opt(i)))) throw new IOException("Duplicate link in " + key);
    }
    private static Map<String, JSONObject> records(JSONObject archive, String key) throws IOException, JSONException {
        JSONArray values = array(archive, key); Map<String, JSONObject> result = new LinkedHashMap<>();
        if (values.length() > 100000) throw new IOException("Too many records");
        for (int i = 0; i < values.length(); i++) {
            JSONObject record = values.optJSONObject(i); if (record == null) throw new IOException("Invalid " + key + " record");
            if (result.put(id(record.opt("id")), record) != null) throw new IOException("Duplicate ID in " + key);
        }
        return result;
    }
    private static void reference(String value, Map<String, JSONObject> records) throws IOException {
        if (value != null && !value.isEmpty() && !records.containsKey(value)) throw new IOException("Unknown referenced ID: " + value);
    }
    private static void references(JSONObject object, String key, Map<String, JSONObject> records) throws IOException, JSONException {
        JSONArray values = object.getJSONArray(key); for (int i = 0; i < values.length(); i++) reference(values.getString(i), records);
    }
    static JSONObject normalize(JSONObject source) throws IOException, JSONException {
        if (source == null) throw new IOException("Missing archive");
        JSONObject a = new JSONObject(source.toString());
        Object version = a.opt("version");
        if (!absent(version) && (!(version instanceof Number) || ((Number)version).doubleValue() != 1)) throw new IOException("Unsupported archive version");
        a.put("version", 1); text(a, "title", "Семейное древо"); optionalId(a, "rootPersonId");
        Map<String, JSONObject> people = records(a, "people"), stories = records(a, "stories"), media = records(a, "media");
        for (JSONObject p : people.values()) {
            for (String key : new String[]{"fullName","birthDate","deathDate","country","place","primaryMediaId","rememberFor","bio"}) text(p,key,"");
            optionalId(p,"motherId"); optionalId(p,"fatherId"); idList(p,"storyIds"); idList(p,"mediaIds");
        }
        for (JSONObject s : stories.values()) {
            for (String key : new String[]{"title","text","date","author"}) text(s,key,"");
            idList(s,"personIds"); idList(s,"mediaIds");
        }
        for (JSONObject m : media.values()) {
            String type = text(m,"type","photo"); text(m,"title",""); String path = text(m,"path","");
            if (!java.util.Arrays.asList("photo","audio","video","document").contains(type) || !ArchiveStore.validMediaPath(path)) throw new IOException("Invalid media type or path");
            idList(m,"personIds"); idList(m,"storyIds");
        }
        if (a.isNull("rootPersonId") && !people.isEmpty()) a.put("rootPersonId", people.keySet().iterator().next());
        reference(a.isNull("rootPersonId") ? null : a.getString("rootPersonId"), people);
        Map<String,Integer> remaining = new HashMap<>(); Map<String,ArrayList<String>> children = new HashMap<>();
        for (Map.Entry<String,JSONObject> entry : people.entrySet()) {
            JSONObject p = entry.getValue(); Set<String> parents = new HashSet<>();
            for (String key : new String[]{"motherId","fatherId"}) {
                String parent = p.isNull(key) ? null : p.getString(key); reference(parent,people); if (parent != null) parents.add(parent);
            }
            remaining.put(entry.getKey(), parents.size());
            for (String parent : parents) {
                if (!children.containsKey(parent)) children.put(parent, new ArrayList<>());
                children.get(parent).add(entry.getKey());
            }
            String photo = p.getString("primaryMediaId"); reference(photo, media);
            if (!photo.isEmpty() && !"photo".equals(media.get(photo).getString("type"))) throw new IOException("Primary media must be a photo");
            references(p,"storyIds",stories); references(p,"mediaIds",media);
        }
        ArrayDeque<String> ready = new ArrayDeque<>(); for (String key : people.keySet()) if (remaining.get(key) == 0) ready.add(key);
        int visited = 0;
        while (!ready.isEmpty()) {
            String key = ready.remove(); visited++;
            if (!children.containsKey(key)) continue;
            for (String child : children.get(key)) {
                int n = remaining.get(child)-1; remaining.put(child,n); if (n==0) ready.add(child);
            }
        }
        if (visited != people.size()) throw new IOException("Cycle in family relationships");
        for (JSONObject s : stories.values()) { references(s,"personIds",people); references(s,"mediaIds",media); }
        for (JSONObject m : media.values()) { references(m,"personIds",people); references(m,"storyIds",stories); }
        return a;
    }
}
