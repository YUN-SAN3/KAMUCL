package cn.kamucl.bridge;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;

/** Real JVM lifecycle fixture: no System.exit, no Minecraft or player profile. */
public final class BridgeExitFixture {
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[0]);
        ParamRegistry.init(dir);
        DemoModule.register();
        BridgeServer.start(dir, "fixture");
        System.out.println("FIXTURE_READY");
        new BufferedReader(new InputStreamReader(System.in)).readLine();
        Thread save = new Thread(() -> {
            try {
                Thread.sleep(800);
                Files.writeString(dir.resolve("saved.marker"), "save completed");
            } catch (Exception e) { throw new RuntimeException(e); }
        }, "fixture-world-save");
        save.start();
        System.out.println("FIXTURE_MAIN_RETURN");
    }
}
