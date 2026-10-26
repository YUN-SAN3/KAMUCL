import java.net.*;
import java.io.*;
import java.security.*;
import java.util.*;

/** Calls the unmodified official client's authlib, including secure textures. */
public class OfflineAuthlibProbe {
    public static void main(String[] args) throws Exception {
        Object service;
        try {
            Class<?> auth = Class.forName("com.mojang.authlib.yggdrasil.YggdrasilAuthenticationService");
            Object provider;
            try { provider = auth.getConstructor(Proxy.class).newInstance(Proxy.NO_PROXY); }
            catch (NoSuchMethodException old) { provider = auth.getConstructor(Proxy.class, String.class).newInstance(Proxy.NO_PROXY, "test-local"); }
            service = auth.getMethod("createMinecraftSessionService").invoke(provider);
        } catch (ClassNotFoundException current) {
            Class<?> discovery = Class.forName("com.mojang.authlib.services.MinecraftServicesDiscoveryService");
            Object provider = discovery.getMethod("create", Proxy.class).invoke(null, Proxy.NO_PROXY);
            service = discovery.getMethod("createMinecraftSessionService").invoke(provider);
        }
        Class<?> gameProfile = Class.forName("com.mojang.authlib.GameProfile");
        UUID uuid = UUID.fromString(args[0]);
        Object profile, texture, textures;
        try {
            Object result = service.getClass().getMethod("fetchProfile", UUID.class, boolean.class).invoke(service, uuid, true);
            if (result == null) throw new AssertionError("Official authlib returned no profile");
            profile = result.getClass().getMethod("profile").invoke(result);
            Class<?> session;
            try { session = Class.forName("com.mojang.authlib.minecraft.MinecraftSessionService"); }
            catch (ClassNotFoundException modern) { session = Class.forName("com.mojang.authlib.minecraft.SessionService"); }
            textures = session.getMethod("getTextures", gameProfile).invoke(service, profile);
            texture = textures.getClass().getMethod("skin").invoke(textures);
            String state = String.valueOf(textures.getClass().getMethod("signatureState").invoke(textures));
            if (!state.equals("SIGNED")) throw new AssertionError("Official authlib rejected texture signature: " + state);
        } catch (NoSuchMethodException old) {
            profile = gameProfile.getConstructor(UUID.class, String.class).newInstance(uuid, args[1]);
            profile = service.getClass().getMethod("fillProfileProperties", gameProfile, boolean.class).invoke(service, profile, true);
            textures = service.getClass().getMethod("getTextures", gameProfile, boolean.class).invoke(service, profile, true);
            Map<?,?> map = (Map<?,?>) textures; texture = null;
            for (Map.Entry<?,?> entry : map.entrySet()) if (String.valueOf(entry.getKey()).equals("SKIN")) texture = entry.getValue();
        }
        if (texture == null) throw new AssertionError("Official authlib returned no skin texture");
        String url = (String)texture.getClass().getMethod("getUrl").invoke(texture);
        if (!url.startsWith("http://127.0.0.1:")) throw new AssertionError("Texture escaped local provider");
        if (!args[3].equals(String.valueOf(texture.getClass().getMethod("getMetadata", String.class).invoke(texture, "model")))) throw new AssertionError("Skin model mismatch");
        URLConnection connection = new URL(url).openConnection(); connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream in = connection.getInputStream()) { byte[] b = new byte[4096]; for (int n; (n=in.read(b))>=0;) bytes.write(b,0,n); }
        byte[] data = bytes.toByteArray(); StringBuilder hash = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(data)) hash.append(String.format("%02x", b & 255));
        if (!hash.toString().equals(args[2])) throw new AssertionError("Texture SHA256 mismatch");
        if (javax.imageio.ImageIO.read(new ByteArrayInputStream(data)).getWidth() != 64) throw new AssertionError("Texture PNG did not decode");
        System.out.println("OFFICIAL_AUTHLIB_SKIN_OK " + data.length);
        System.exit(0);
    }
}
