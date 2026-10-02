package cn.kamucl.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

/**
 * 桥接 HTTP 服务：仅监听 127.0.0.1 随机端口，启动时生成一次性 token 写入
 * 游戏目录 .kamucl-bridge.json（启动器读取发现）。所有写操作必须携带
 * X-Kamucl-Token 头。启动器关闭或通信断开不影响游戏运行。
 */
public final class BridgeServer {
    public static final int PROTOCOL = 1;
    private static final Gson GSON = new GsonBuilder().create();

    private BridgeServer() {}

    public static void start(Path gameDir, String modVersion) throws IOException {
        String token = newToken();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/kamucl/v1/ping", exchange -> respond(exchange, null, () -> Map.of("ok", true, "protocol", PROTOCOL)));
        server.createContext("/kamucl/v1/manifest", exchange -> respond(exchange, null, BridgeServer::manifest));
        server.createContext("/kamucl/v1/set", exchange -> respond(exchange, token, () -> setParam(exchange)));
        server.createContext("/kamucl/v1/reset", exchange -> respond(exchange, token, () -> resetParam(exchange)));
        // HttpServer's dispatcher inherits daemon status from the thread calling
        // start(). Starting on Fabric's render thread kept the JVM alive after
        // Minecraft returned from main (Client shutdown from post-main watchdog).
        // A shutdown hook alone cannot fix that: the JVM never reaches shutdown.
        ExecutorService requests = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "kamucl-bridge-request");
            thread.setDaemon(true);
            return thread;
        });
        server.setExecutor(requests);
        FutureTask<Void> start = new FutureTask<>(() -> { server.start(); return null; });
        Thread bootstrap = new Thread(start, "kamucl-bridge-start");
        bootstrap.setDaemon(true);
        bootstrap.start();
        try {
            start.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            requests.shutdownNow();
            server.stop(0);
            throw new IOException("Bridge startup interrupted", e);
        } catch (ExecutionException e) {
            requests.shutdownNow();
            server.stop(0);
            throw new IOException("Bridge startup failed", e.getCause());
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            requests.shutdownNow();
            server.stop(0);
        }, "kamucl-bridge-stop"));
        int port = server.getAddress().getPort();
        writeDiscovery(gameDir, port, token, modVersion);
        System.out.println("[KAMUCL Bridge] 桥接服务已就绪，端口 " + port + "（仅本机，需 token）");
    }

    private static String newToken() {
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void writeDiscovery(Path gameDir, int port, String token, String modVersion) {
        Map<String, Object> discovery = new LinkedHashMap<>();
        discovery.put("protocol", PROTOCOL);
        discovery.put("port", port);
        discovery.put("token", token);
        discovery.put("modVersion", modVersion);
        discovery.put("pid", ProcessHandle.current().pid());
        discovery.put("startedAt", System.currentTimeMillis());
        try {
            Files.writeString(gameDir.resolve(".kamucl-bridge.json"), GSON.toJson(discovery), StandardCharsets.UTF_8);
        } catch (IOException ignored) { /* 发现文件写失败时启动器无法接入，不影响游戏 */ }
    }

    /** 参数清单：每个参数带当前值；服务器参数仅返回定义与只读值，修改由 MOD 服务端另行校验。 */
    private static Map<String, Object> manifest() {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Param def : ParamRegistry.params()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", def.id);
            item.put("modId", def.modId);
            item.put("label", def.label);
            item.put("description", def.description);
            item.put("group", def.group);
            item.put("kind", def.kind.name());
            item.put("apply", def.apply.name());
            item.put("scope", def.scope.name());
            item.put("defaultValue", def.defaultValue);
            item.put("value", ParamRegistry.value(def.id));
            if (def.min != null) item.put("min", def.min);
            if (def.max != null) item.put("max", def.max);
            if (def.step != null) item.put("step", def.step);
            if (def.options != null) item.put("options", def.options);
            item.put("visible", def.visibleWhen == null || def.visibleWhen.getAsBoolean());
            items.add(item);
        }
        return Map.of("protocol", PROTOCOL, "params", items);
    }

    private static Map<String, Object> setParam(HttpExchange exchange) throws IOException {
        Map<?, ?> body = readJson(exchange);
        String id = String.valueOf(body.get("id"));
        Object value = body.get("value");
        Param def = ParamRegistry.param(id);
        if (def == null) return Map.of("ok", false, "error", "未知参数：" + id);
        // 服务器参数：本地桥接接口一律拒绝，必须由 MOD 的服务端权限校验路径修改
        if (def.scope == Param.Scope.SERVER) {
            return Map.of("ok", false, "error", def.label + " 是服务器参数，需服务端权限校验，不能通过本地接口修改");
        }
        if (def.visibleWhen != null && !def.visibleWhen.getAsBoolean()) {
            return Map.of("ok", false, "error", "当前条件不满足，参数暂不可修改");
        }
        try {
            String notice = ParamRegistry.set(id, value);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("value", ParamRegistry.value(id));
            if (notice != null) out.put("notice", notice);
            return out;
        } catch (IllegalArgumentException e) {
            return Map.of("ok", false, "error", e.getMessage());
        }
    }

    private static Map<String, Object> resetParam(HttpExchange exchange) throws IOException {
        Map<?, ?> body = readJson(exchange);
        Object id = body.get("id");
        ParamRegistry.reset(id == null ? null : String.valueOf(id));
        return Map.of("ok", true);
    }

    private static Map<?, ?> readJson(HttpExchange exchange) throws IOException {
        String text = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        if (text.isBlank()) return Map.of();
        Object parsed = GSON.fromJson(text, Object.class);
        if (parsed instanceof Map<?, ?>) return (Map<?, ?>) parsed;
        return Map.of();
    }

    private interface Handler { Map<String, Object> handle() throws IOException; }

    private static void respond(HttpExchange exchange, String expectedToken, Handler handler) throws IOException {
        try {
            if (!"127.0.0.1".equals(exchange.getRemoteAddress().getAddress().getHostAddress())) {
                json(exchange, 403, Map.of("ok", false, "error", "仅限本机访问"));
                return;
            }
            if (expectedToken != null && !expectedToken.equals(exchange.getRequestHeaders().getFirst("X-Kamucl-Token"))) {
                json(exchange, 401, Map.of("ok", false, "error", "身份校验失败：缺少或错误的 token"));
                return;
            }
            json(exchange, 200, handler.handle());
        } catch (Exception e) {
            json(exchange, 500, Map.of("ok", false, "error", String.valueOf(e.getMessage())));
        } finally {
            exchange.close();
        }
    }

    private static void json(HttpExchange exchange, int status, Map<String, Object> body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
