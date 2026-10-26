// SPDX-License-Identifier: GPL-3.0-or-later
package cn.kamucl.skin;

import java.io.*;
import java.lang.instrument.Instrumentation;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.spec.*;
import java.util.*;
import java.util.concurrent.*;

/** A per-game, loopback-only texture provider. No login, server authentication,
 * filesystem routes or launcher lifetime dependency are provided. */
public final class OfflineSkinAgent {
    private static final int MAX_CONFIG = 2 * 1024 * 1024;
    private OfflineSkinAgent() {}

    public static void premain(String argument, Instrumentation instrumentation) throws Exception {
        Path config = Paths.get(new String(Base64.getUrlDecoder().decode(argument), StandardCharsets.UTF_8));
        if (Files.size(config) > MAX_CONFIG) throw new IOException("Offline skin configuration is too large");
        Properties p = new Properties();
        try (Reader reader = Files.newBufferedReader(config, StandardCharsets.UTF_8)) { p.load(reader); }
        final Provider provider = new Provider(p);
        provider.start();
        Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
            public void run() { provider.close(); }
        }, "KAMUCL-offline-skin-stop"));
        // Only delete this accepted launch's generated configuration after all
        // keys and immutable PNG bytes have been consumed by its game JVM.
        Files.deleteIfExists(config);
        System.out.println("[KAMUCL] Offline skin provider ready (local game only)");
    }

    static final class Provider {
        final int port;
        final String prefix, uuid, username, hash, metadata, identity;
        final Map<String, String> profiles = new HashMap<String, String>();
        final byte[] png;
        final ServerSocket server;
        final ThreadPoolExecutor workers;

        Provider(Properties p) throws Exception {
            port = Integer.parseInt(required(p, "port"));
            if (port < 1024 || port > 65535) throw new IOException("Invalid local skin port");
            String nonce = required(p, "nonce");
            uuid = required(p, "uuid").toLowerCase(Locale.ROOT);
            username = new String(Base64.getDecoder().decode(required(p, "username64")), StandardCharsets.UTF_8);
            hash = required(p, "sha256");
            String variant = required(p, "variant");
            if (!nonce.matches("[a-f0-9]{64}") || !uuid.matches("[a-f0-9]{32}") ||
                username.isEmpty() || username.length() > 64 || username.matches("(?s).*[\\x00-\\x1f\\x7f].*") || !hash.matches("[a-f0-9]{64}") ||
                !(variant.equals("classic") || variant.equals("slim"))) throw new IOException("Invalid offline skin identity");
            prefix = "/" + nonce + "/";
            png = Base64.getDecoder().decode(required(p, "png"));
            if (png.length < 24 || png.length > 1024 * 1024 || png[0] != (byte)137 || png[1] != 80 || png[2] != 78 || png[3] != 71 ||
                readInt(png, 16) != 64 || readInt(png, 20) != 64 || !hex(MessageDigest.getInstance("SHA-256").digest(png)).equals(hash)) {
                throw new IOException("Offline skin PNG integrity check failed");
            }
            KeyFactory factory = KeyFactory.getInstance("RSA");
            PrivateKey key = factory.generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(required(p, "privateKey"))));
            PublicKey pub = factory.generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(required(p, "publicKey"))));
            String publicPem = "-----BEGIN PUBLIC KEY-----\n" + Base64.getEncoder().encodeToString(pub.getEncoded()) + "\n-----END PUBLIC KEY-----";
            metadata = "{\"meta\":{\"serverName\":\"KAMUCL Offline Appearance\",\"feature.no_mojang_namespace\":true,\"feature.username_check\":true},\"skinDomains\":[\"127.0.0.1\"],\"signaturePublickey\":" + quote(publicPem) + "}";
            identity = "{\"id\":" + quote(uuid) + ",\"name\":" + quote(username) + "}";
            String serverUuid = required(p, "serverUuid");
            if (!serverUuid.matches("[a-f0-9]{32}")) throw new IOException("Invalid local player alias");
            for (String profileUuid : new HashSet<String>(Arrays.asList(uuid, serverUuid))) {
            String texture = "{\"timestamp\":" + System.currentTimeMillis() + ",\"profileId\":" + quote(profileUuid) + ",\"profileName\":" + quote(username) +
                ",\"textures\":{\"SKIN\":{\"url\":" + quote("http://127.0.0.1:" + port + prefix + "textures/" + hash + ".png") +
                (variant.equals("slim") ? ",\"metadata\":{\"model\":\"slim\"}" : "") + "}}}";
            String value = Base64.getEncoder().encodeToString(texture.getBytes(StandardCharsets.UTF_8));
            Signature signer = Signature.getInstance("SHA1withRSA"); signer.initSign(key); signer.update(value.getBytes(StandardCharsets.UTF_8));
            byte[] signature = signer.sign();
            signer.initVerify(pub); signer.update(value.getBytes(StandardCharsets.UTF_8));
            if (!signer.verify(signature)) throw new IOException("Offline skin signing key mismatch");
            profiles.put(profileUuid, "{\"id\":" + quote(profileUuid) + ",\"name\":" + quote(username) + ",\"properties\":[{\"name\":\"textures\",\"value\":" + quote(value) + ",\"signature\":" + quote(Base64.getEncoder().encodeToString(signature)) + "}]}");
            }
            server = new ServerSocket();
            server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 8);
            workers = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<Runnable>(8), new ThreadFactory() {
                public Thread newThread(Runnable r) { Thread t = new Thread(r, "KAMUCL-offline-skin-request"); t.setDaemon(true); return t; }
            });
        }

        void start() {
            Thread accept = new Thread(new Runnable() {
                public void run() {
                    while (!server.isClosed()) {
                        try {
                            final Socket socket = server.accept(); socket.setSoTimeout(3000);
                            try { workers.execute(new Runnable() { public void run() { respond(socket); } }); }
                            catch (RejectedExecutionException rejected) { socket.close(); }
                        } catch (IOException error) { if (!server.isClosed()) close(); }
                    }
                }
            }, "KAMUCL-offline-skin-listen");
            accept.setDaemon(true); accept.start();
        }

        void close() { try { server.close(); } catch (IOException ignored) {} workers.shutdownNow(); }

        void respond(Socket socket) {
            try (Socket owned = socket) {
                InputStream in = owned.getInputStream(); OutputStream out = owned.getOutputStream();
                int[] count = {0};
                String request = line(in, count);
                String[] head = request.split(" ");
                if (head.length != 3 || !head[2].matches("HTTP/1\\.[01]")) { reply(out, 400, "text/plain", new byte[0]); return; }
                String host = null; int length = 0; boolean transfer = false, hasLength = false;
                for (String header; !(header = line(in, count)).isEmpty();) {
                    int colon = header.indexOf(':'); if (colon <= 0) throw new IOException("Malformed header");
                    String name = header.substring(0, colon).toLowerCase(Locale.ROOT), value = header.substring(colon + 1).trim();
                    if (name.equals("host")) { if (host != null) throw new IOException("Duplicate host"); host = value; }
                    if (name.equals("content-length")) { if (hasLength) throw new IOException("Duplicate length"); hasLength = true; length = Integer.parseInt(value); }
                    if (name.equals("transfer-encoding")) transfer = true;
                }
                if (!("127.0.0.1:" + port).equals(host) || length < 0 || length > 16384 || transfer) { reply(out, 400, "text/plain", new byte[0]); return; }
                String route = head[1].split("\\?", 2)[0];
                if (!route.startsWith(prefix)) { reply(out, 404, "text/plain", new byte[0]); return; }
                route = route.substring(prefix.length());
                boolean get = head[0].equals("GET"), post = head[0].equals("POST");
                byte[] body = new byte[length]; int read = 0;
                while (read < length) { int n = in.read(body, read, length - read); if (n < 0) throw new EOFException(); read += n; }
                if (get && route.isEmpty()) json(out, metadata);
                else if (get && route.equals("textures/" + hash + ".png")) reply(out, 200, "image/png", png);
                else if (get && route.startsWith("sessionserver/session/minecraft/profile/")) {
                    String profile = profiles.get(route.substring("sessionserver/session/minecraft/profile/".length()));
                    if (profile != null) json(out, profile); else reply(out, 204, "application/json", new byte[0]);
                }
                else if (get && (URLDecoder.decode(route, "UTF-8").equalsIgnoreCase("api/users/profiles/minecraft/" + username) || URLDecoder.decode(route, "UTF-8").equalsIgnoreCase("api/profiles/minecraft/" + username))) json(out, identity);
                else if (post && route.equals("api/profiles/minecraft")) {
                    String names = new String(body, StandardCharsets.UTF_8).trim();
                    try { json(out, namesContain(names, username) ? "[" + identity + "]" : "[]"); }
                    catch (IOException invalid) { reply(out, 400, "application/json", new byte[0]); }
                } else if (post && route.equals("sessionserver/session/minecraft/join")) {
                    reply(out, 403, "application/json", "{\"error\":\"ForbiddenOperationException\",\"errorMessage\":\"Local appearance does not authenticate multiplayer\"}".getBytes(StandardCharsets.UTF_8));
                } else reply(out, 404, "text/plain", new byte[0]);
            } catch (Exception ignored) { /* malformed/abandoned local requests cannot affect the game */ }
        }
    }

    static String required(Properties p, String key) throws IOException {
        String value = p.getProperty(key); if (value == null || value.isEmpty()) throw new IOException("Missing offline skin " + key); return value;
    }
    static int readInt(byte[] data, int offset) { return (data[offset] & 255) << 24 | (data[offset+1] & 255) << 16 | (data[offset+2] & 255) << 8 | data[offset+3] & 255; }
    static String hex(byte[] data) { StringBuilder out = new StringBuilder(); for (byte b : data) out.append(String.format("%02x", b & 255)); return out.toString(); }
    static String quote(String text) { return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""; }
    static boolean namesContain(String json, String username) throws IOException {
        if (!json.startsWith("[") || !json.endsWith("]")) throw new IOException("Invalid profile names");
        int i = 1, count = 0; boolean found = false, wantName = true;
        while (i < json.length() - 1) {
            char c = json.charAt(i); if (Character.isWhitespace(c)) { i++; continue; }
            if (!wantName || c != '"' || ++count > 100) throw new IOException("Invalid profile names");
            StringBuilder name = new StringBuilder(); i++; boolean ended = false;
            while (i < json.length() - 1) {
                c = json.charAt(i++); if (c == '"') { ended = true; break; }
                if (c == '\\') {
                    if (i >= json.length() - 1) throw new IOException("Invalid string escape");
                    c = json.charAt(i++);
                    if (c == 'u') { if (i + 4 > json.length() - 1) throw new IOException("Invalid unicode escape"); try { c = (char)Integer.parseInt(json.substring(i, i+4), 16); } catch (NumberFormatException e) { throw new IOException("Invalid unicode escape"); } i += 4; }
                    else if (c == 'b') c = '\b'; else if (c == 'f') c = '\f'; else if (c == 'n') c = '\n'; else if (c == 'r') c = '\r'; else if (c == 't') c = '\t';
                    else if (c != '"' && c != '\\' && c != '/') throw new IOException("Invalid string escape");
                } else if (c < 32) throw new IOException("Invalid control character");
                name.append(c);
            }
            if (!ended) throw new IOException("Unterminated name");
            found |= name.toString().equalsIgnoreCase(username);
            while (i < json.length() - 1 && Character.isWhitespace(json.charAt(i))) i++;
            if (i < json.length() - 1) { if (json.charAt(i++) != ',') throw new IOException("Invalid separator"); wantName = true; }
            else wantName = false;
        }
        if (count > 0 && wantName) throw new IOException("Trailing comma");
        return found;
    }
    static String line(InputStream in, int[] count) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (;;) { int c = in.read(); if (c < 0) throw new EOFException(); if (++count[0] > 8192) throw new IOException("Headers too large"); if (c == '\n') break; if (c != '\r') bytes.write(c); }
        return new String(bytes.toByteArray(), StandardCharsets.US_ASCII);
    }
    static void json(OutputStream out, String text) throws IOException { reply(out, 200, "application/json; charset=utf-8", text.getBytes(StandardCharsets.UTF_8)); }
    static void reply(OutputStream out, int status, String type, byte[] bytes) throws IOException {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : "Bad Request";
        out.write(("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        out.write(bytes); out.flush();
    }
}
