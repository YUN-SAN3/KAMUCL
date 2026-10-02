package cn.kamucl.bridge;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Path;

/**
 * KAMUCL 桥接 MOD 入口：启动桥接服务并注册演示参数。
 * 演示 MOD（kamucl-demo）展示参数注册接口用法：声明元数据即出现在启动器控制面板，
 * 支持热修改即时生效（游戏日志可观察）、保存配置与恢复默认。
 */
public final class KamuclBridgeMod implements ModInitializer {
    public static final String MOD_ID = "kamucl-bridge";
    public static final String VERSION = "1.0.1";

    @Override
    public void onInitialize() {
        Path gameDir = FabricLoader.getInstance().getGameDir();
        ParamRegistry.init(gameDir);
        DemoModule.register();
        try {
            BridgeServer.start(gameDir, VERSION);
        } catch (Exception e) {
            System.out.println("[KAMUCL Bridge] 桥接服务启动失败（不影响游戏）：" + e.getMessage());
        }
    }
}
