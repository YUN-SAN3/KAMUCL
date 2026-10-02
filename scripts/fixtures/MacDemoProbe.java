package kamucltest;

import net.fabricmc.api.ClientModInitializer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Disposable CI-only client driver. Presses the real demo button on the game thread. */
public final class MacDemoProbe implements ClientModInitializer {
    public void onInitializeClient() {
        final String trigger = System.getProperty("kamucl.nativeProofTrigger");
        System.out.println("[native-demo-probe] Client initializer ready; trigger=" + trigger);
        if (trigger == null) return;
        final AtomicBoolean pressed = new AtomicBoolean();
        Thread driver = new Thread(() -> {
            try {
                Class<?> type = Class.forName("net.minecraft.client.Minecraft");
                Object minecraft = type.getMethod("getInstance").invoke(null);
                for (int n = 0; n < 1200 && !pressed.get(); n++) {
                    if (Files.exists(Path.of(trigger))) {
                        type.getMethod("execute", Runnable.class).invoke(minecraft, (Runnable) () -> {
                            if (pressed.get()) return;
                            try {
                                Object gui = type.getField("gui").get(minecraft);
                                Object screen = gui.getClass().getMethod("screen").invoke(gui);
                                if (screen == null || !screen.getClass().getName().endsWith(".TitleScreen")) return;
                                List<?> children = (List<?>) screen.getClass().getMethod("children").invoke(screen);
                                Class<?> buttonType = Class.forName("net.minecraft.client.gui.components.Button");
                                for (Object button : children) {
                                    if (!buttonType.isInstance(button)) continue;
                                    Object message = buttonType.getMethod("getMessage").invoke(button);
                                    Object contents = message.getClass().getMethod("getContents").invoke(message);
                                    if (!contents.getClass().getName().endsWith(".TranslatableContents")) continue;
                                    if (!"menu.playdemo".equals(contents.getClass().getMethod("getKey").invoke(contents))) continue;
                                    buttonType.getMethod("onPress", Class.forName("net.minecraft.client.input.InputWithModifiers")).invoke(button, new Object[]{null});
                                    pressed.set(true);
                                    System.out.println("[native-demo-probe] Pressed actual Play Demo button");
                                    return;
                                }
                            } catch (ReflectiveOperationException error) { pressed.set(true); error.printStackTrace(); }
                        });
                    }
                    Thread.sleep(250);
                }
            } catch (Exception error) { error.printStackTrace(); }
        }, "native-demo-test-driver");
        driver.setDaemon(true);
        driver.start();
    }
}
