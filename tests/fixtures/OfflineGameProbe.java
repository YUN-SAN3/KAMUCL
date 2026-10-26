package kamucltest;

import net.fabricmc.api.ClientModInitializer;
import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;

/** Test-only driver of an unmodified official 26.3 client. Not shipped as a MOD. */
public final class OfflineGameProbe implements ClientModInitializer {
    public void onInitializeClient() {
        String base = System.getProperty("kamucl.gameProof");
        if (base == null) return;
        Thread driver = new Thread(() -> {
            try {
                Class<?> mc = Class.forName("net.minecraft.client.Minecraft");
                Object client = mc.getMethod("getInstance").invoke(null);
                for (int i=0; i<2400; i++) {
                    Path trigger = Path.of(base + ".command");
                    if (Files.exists(trigger)) {
                        String command = Files.readString(trigger).trim(); Files.delete(trigger);
                        mc.getMethod("execute", Runnable.class).invoke(client, (Runnable) () -> {
                            try {
                                if (command.equals("start")) {
                                    Object gui=mc.getField("gui").get(client), screen=gui.getClass().getMethod("screen").invoke(gui);
                                    if (screen==null || !screen.getClass().getName().endsWith(".TitleScreen")) throw new IllegalStateException("TitleScreen not ready");
                                    Class<?> bt=Class.forName("net.minecraft.client.gui.components.Button");
                                    for(Object button:(List<?>)screen.getClass().getMethod("children").invoke(screen)) {
                                        if(!bt.isInstance(button)) continue;
                                        Object msg=bt.getMethod("getMessage").invoke(button), content=msg.getClass().getMethod("getContents").invoke(msg);
                                        if(content.getClass().getName().endsWith(".TranslatableContents") && "menu.playdemo".equals(content.getClass().getMethod("getKey").invoke(content))) {
                                            bt.getMethod("onPress",Class.forName("net.minecraft.client.input.InputWithModifiers")).invoke(button,new Object[]{null});
                                            System.out.println("[offline-game-proof] Actual Play Demo pressed"); return;
                                        }
                                    }
                                    throw new IllegalStateException("Actual demo button missing");
                                } else if(command.equals("front")) {
                                    Object options=mc.getField("options").get(client); Class<?> camera=Class.forName("net.minecraft.client.CameraType");
                                    Object front=Arrays.stream(camera.getEnumConstants()).filter(v->v.toString().equals("THIRD_PERSON_FRONT")).findFirst().orElseThrow();
                                    options.getClass().getMethod("setCameraType",camera).invoke(options,front);
                                    // The real inventory renders the current world player with
                                    // unobstructed framing, independent of spawn terrain/camera collision.
                                    Object gui=mc.getField("gui").get(client), player=mc.getField("player").get(client);
                                    Object inventory=Class.forName("net.minecraft.client.gui.screens.inventory.InventoryScreen").getConstructor(Class.forName("net.minecraft.world.entity.player.Player")).newInstance(player);
                                    gui.getClass().getMethod("setScreen",Class.forName("net.minecraft.client.gui.screens.Screen")).invoke(gui,inventory);
                                } else if(command.equals("capture")) {
                                    Object player=mc.getField("player").get(client); if(player==null)throw new IllegalStateException("Real world player missing");
                                    Object skin=player.getClass().getMethod("getSkin").invoke(player), body=skin.getClass().getMethod("body").invoke(skin);
                                    Object identifier=Class.forName("net.minecraft.core.ClientAsset$Texture").getMethod("texturePath").invoke(body);
                                    Object manager=mc.getMethod("getTextureManager").invoke(client), texture=manager.getClass().getMethod("getTexture",Class.forName("net.minecraft.resources.Identifier")).invoke(manager,identifier);
                                    Object gpu=texture.getClass().getMethod("getTexture").invoke(texture);
                                    Object options=mc.getField("options").get(client);
                                    Properties proof=new Properties(); proof.setProperty("body",identifier.toString());proof.setProperty("model",skin.getClass().getMethod("model").invoke(skin).toString());proof.setProperty("gpuTexture",String.valueOf(gpu!=null));
                                    proof.setProperty("resourcePacks",String.valueOf(options.getClass().getField("resourcePacks").get(options)));
                                    Class.forName("net.minecraft.client.Screenshot").getMethod("grab",mc,boolean.class).invoke(null,client,false);
                                    try(java.io.Writer out=Files.newBufferedWriter(Path.of(base+".receipt"))){proof.store(out,"Actual Minecraft player/GPU texture/options; no fabricated response");}
                                    System.out.println("[offline-game-proof] Actual player texture="+identifier+" model="+proof.getProperty("model"));
                                } else if(command.equals("disable")) {
                                    Object options=mc.getField("options").get(client);
                                    options.getClass().getField("resourcePacks").set(options,new ArrayList<String>(List.of("vanilla")));
                                    options.getClass().getMethod("save").invoke(options);
                                    System.out.println("[offline-game-proof] Actual game options saved vanilla-only choice");
                                } else if(command.equals("stop")) { mc.getMethod("stop").invoke(client); }
                            } catch(Throwable e) { e.printStackTrace(); try{Files.writeString(Path.of(base+".error"),e.toString());}catch(Exception ignored){} }
                        });
                    }
                    Thread.sleep(250);
                }
            } catch(Throwable e) {e.printStackTrace();}
        },"kamucl-owned-game-proof");driver.setDaemon(true);driver.start();
    }
}
