package xyz.blinddev.familyarchive;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FamilyArchivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
