package icu.wuhui.voxlink.network;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class PunchProfile {
   private static final Logger LOGGER = LoggerFactory.getLogger("voxlink-punch");
   public final String name;
   public final int punchTimeoutMs;
   public final int firewallDetectCycles;
   public final int portPredictionMaxRange;
   public final int[] progressiveRanges;
   public final int cyclesPerRange;
   public final int easySymDualSocketCount;
   public final int easySymDualPortRange;
   public final int defaultPortRange;
   public final int widePortRange;
   public final int maxPortRange;
   public final int minPortRange;
   public final int easySymPortRange;
   public final int hostMultiSocketCount;
   public final int hostMultiMinSocketCount;
   public final int hostMultiBaseSocketCount;
   public final int hardSymSocketCount;
   public final int birthdaySocketCount;
   public final int joinerSymSocketCount;
   public final int relaySocketCount;
   public final int joinerMultiPortRange;
   public final int easySymMutualSocketCount;
   public final int easySymMutualRetrySocketCount;
   public final int coneBackupPortRange;
   public final PunchProfile.SendParams send;
   public final int socketStunCount;
   public final int socketCreateIntervalMs;
   public final int hostRoundTimeoutMs;
   public final int reverseWindowSec;
   public final int connectionTimeoutSec;
   public final int symmetricConnectionTimeoutSec;
   public final int punchMaxAttempts;
   public final int punchRetryDelayMs;
   public final int maxCycles;
   public final int maxSymCycles;
   public final int fallbackCycles;
   public final SymParams sym;
   // 必须先于所有静态profile实例声明,否则构造时sym读到null
   public static final SymParams RECIPE = new SymParams(25, 20, 100, 5000, 600, 800, 3, 1, 2, 180, 3000);
   private static final PunchProfile.SendParams SEND_DEFAULT = new PunchProfile.SendParams(200, 500, 1000, 2000, 600, 200, 3, 3, 1, 10, 800);
   private static final PunchProfile.SendParams SEND_DEFAULT_FAST = new PunchProfile.SendParams(200, 500, 1000, 2000, 600, 200, 1, 2, 1, 5, 800);
   private static final PunchProfile.SendParams SEND_SPRINT = new PunchProfile.SendParams(100, 300, 600, 1200, 400, 150, 1, 1, 1, 3, 400);
   private static final PunchProfile.SendParams SEND_WIDE = new PunchProfile.SendParams(150, 500, 1000, 2000, 500, 200, 1, 2, 1, 5, 800);
   private static final PunchProfile.SendParams SEND_WEAK = new PunchProfile.SendParams(250, 800, 1500, 3000, 500, 250, 3, 3, 2, 8, 600);
   public static final PunchProfile DEFAULT = new PunchProfile(
      "DEFAULT", 12000, 30, 100, new int[]{10, 25, 50, 75, 100}, 1, 25, 20, 30, 50, 100, 3, 20, 20, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 8000, 40, 45, 75, 3, 800, 8, 6, 3, SEND_DEFAULT
   );
   public static final PunchProfile AGGRESSIVE = new PunchProfile(
      "AGGRESSIVE", 20000, 50, 100, new int[]{10, 25, 50, 75, 100}, 1, 25, 20, 30, 50, 100, 3, 20, 20, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 10000, 45, 50, 85, 4, 600, 10, 8, 3, SEND_DEFAULT_FAST
   );
   public static final PunchProfile HARDSYM = new PunchProfile(
      "HARDSYM", 30000, 60, 500, new int[]{20, 50, 100, 200, 500}, 2, 25, 20, 30, 50, 500, 3, 20, 84, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 12000, 55, 60, 100, 5, 500, 12, 10, 3, SEND_WIDE
   );
   public static final PunchProfile EASY_SYM_DUAL = new PunchProfile(
      "EASY_SYM_DUAL", 12000, 30, 50, new int[]{5, 10, 20, 30, 50}, 2, 25, 50, 20, 50, 50, 3, 20, 25, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 8000, 40, 45, 75, 3, 800, 8, 6, 3, SEND_DEFAULT
   );
   public static final PunchProfile V100 = new PunchProfile(
      "V100", 8000, 38, 100, new int[]{10, 25, 50, 75, 100}, 2, 25, 20, 30, 50, 100, 3, 20, 84, 20, 3, 84, 84, 50, 5, 30, 25, 50, 10, 2, 50, 8000, 35, 40, 70, 4, 600, 10, 8, 3, SEND_DEFAULT
   );
   public static final PunchProfile FAST_LANE = new PunchProfile(
      "FAST_LANE", 6000, 15, 20, new int[]{5, 10, 20}, 1, 25, 20, 30, 50, 100, 3, 20, 20, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 6000, 30, 35, 60, 3, 800, 8, 6, 3, SEND_SPRINT
   );
   public static final PunchProfile RELIABLE_CONE = new PunchProfile(
      "RELIABLE_CONE", 15000, 40, 40, new int[]{5, 10, 20, 40}, 1, 25, 20, 30, 50, 100, 3, 20, 20, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 10000, 40, 50, 80, 4, 700, 10, 8, 3, SEND_WEAK
   );
   public static final PunchProfile WIDE_SWEEP = new PunchProfile(
      "WIDE_SWEEP", 35000, 70, 800, new int[]{100, 200, 400, 800}, 1, 25, 20, 30, 50, 800, 3, 20, 84, 5, 3, 84, 32, 50, 5, 30, 25, 50, 10, 2, 50, 12000, 60, 65, 110, 5, 500, 12, 10, 3, SEND_WIDE
   );
   /**
    * 对称NAT分级配方参数(EasyTier量化值)
    */
   public static final class SymParams {
      public final int easySymBombSockets;
      public final int easySymBombWindow;
      public final int easySymRoundIntervalMs;
      public final int easySymBombDurationMs;
      public final int hardSymSprayPortMin;
      public final int hardSymSprayPortMax;
      public final int hardSymPacketsPerPort;
      public final int hardSymPortIntervalMs;
      public final int hardSymDecayNumerator;
      public final int hardSymDecayFloor;
      public final int maxPps;

      public SymParams(
         int easySymBombSockets,
         int easySymBombWindow,
         int easySymRoundIntervalMs,
         int easySymBombDurationMs,
         int hardSymSprayPortMin,
         int hardSymSprayPortMax,
         int hardSymPacketsPerPort,
         int hardSymPortIntervalMs,
         int hardSymDecayNumerator,
         int hardSymDecayFloor,
         int maxPps
      ) {
         this.easySymBombSockets = easySymBombSockets;
         this.easySymBombWindow = easySymBombWindow;
         this.easySymRoundIntervalMs = easySymRoundIntervalMs;
         this.easySymBombDurationMs = easySymBombDurationMs;
         this.hardSymSprayPortMin = hardSymSprayPortMin;
         this.hardSymSprayPortMax = hardSymSprayPortMax;
         this.hardSymPacketsPerPort = hardSymPacketsPerPort;
         this.hardSymPortIntervalMs = hardSymPortIntervalMs;
         this.hardSymDecayNumerator = hardSymDecayNumerator;
         this.hardSymDecayFloor = hardSymDecayFloor;
         this.maxPps = maxPps;
      }
   }

   private static volatile PunchProfile current = DEFAULT;
   private static volatile String switchReason = "initial";
   private static volatile PunchParams dynamicOverride;

   private PunchProfile(
      String name,
      int punchTimeoutMs,
      int firewallDetectCycles,
      int portPredictionMaxRange,
      int[] progressiveRanges,
      int cyclesPerRange,
      int easySymDualSocketCount,
      int easySymDualPortRange,
      int defaultPortRange,
      int widePortRange,
      int maxPortRange,
      int minPortRange,
      int easySymPortRange,
      int hostMultiSocketCount,
      int hostMultiMinSocketCount,
      int hostMultiBaseSocketCount,
      int hardSymSocketCount,
      int birthdaySocketCount,
      int joinerSymSocketCount,
      int relaySocketCount,
      int joinerMultiPortRange,
      int easySymMutualSocketCount,
      int easySymMutualRetrySocketCount,
      int coneBackupPortRange,
      int socketStunCount,
      int socketCreateIntervalMs,
      int hostRoundTimeoutMs,
      int reverseWindowSec,
      int connectionTimeoutSec,
      int symmetricConnectionTimeoutSec,
      int punchMaxAttempts,
      int punchRetryDelayMs,
      int maxCycles,
      int maxSymCycles,
      int fallbackCycles,
      PunchProfile.SendParams send
   ) {
      this.name = name;
      this.punchTimeoutMs = punchTimeoutMs;
      this.firewallDetectCycles = firewallDetectCycles;
      this.portPredictionMaxRange = portPredictionMaxRange;
      this.progressiveRanges = progressiveRanges;
      this.cyclesPerRange = cyclesPerRange;
      this.easySymDualSocketCount = easySymDualSocketCount;
      this.easySymDualPortRange = easySymDualPortRange;
      this.defaultPortRange = defaultPortRange;
      this.widePortRange = widePortRange;
      this.maxPortRange = maxPortRange;
      this.minPortRange = minPortRange;
      this.easySymPortRange = easySymPortRange;
      this.hostMultiSocketCount = hostMultiSocketCount;
      this.hostMultiMinSocketCount = hostMultiMinSocketCount;
      this.hostMultiBaseSocketCount = hostMultiBaseSocketCount;
      this.hardSymSocketCount = hardSymSocketCount;
      this.birthdaySocketCount = birthdaySocketCount;
      this.joinerSymSocketCount = joinerSymSocketCount;
      this.relaySocketCount = relaySocketCount;
      this.joinerMultiPortRange = joinerMultiPortRange;
      this.easySymMutualSocketCount = easySymMutualSocketCount;
      this.easySymMutualRetrySocketCount = easySymMutualRetrySocketCount;
      this.coneBackupPortRange = coneBackupPortRange;
      this.socketStunCount = socketStunCount;
      this.socketCreateIntervalMs = socketCreateIntervalMs;
      this.hostRoundTimeoutMs = hostRoundTimeoutMs;
      this.reverseWindowSec = reverseWindowSec;
      this.connectionTimeoutSec = connectionTimeoutSec;
      this.symmetricConnectionTimeoutSec = symmetricConnectionTimeoutSec;
      this.punchMaxAttempts = punchMaxAttempts;
      this.punchRetryDelayMs = punchRetryDelayMs;
      this.maxCycles = maxCycles;
      this.maxSymCycles = maxSymCycles;
      this.fallbackCycles = fallbackCycles;
      this.send = send;
      this.sym = RECIPE;
   }

   public static void applyDynamicParams(PunchParams p) {
      dynamicOverride = p;
   }

   public static void clearDynamicParams() {
      dynamicOverride = null;
   }

   public static int effectiveTimeoutMs() {
      PunchParams p = dynamicOverride;
      return p != null && p.timeoutMs > 0 ? p.timeoutMs : current.punchTimeoutMs;
   }

   public static int effectivePortRange() {
      PunchParams p = dynamicOverride;
      return p != null && p.portRange > 0 ? p.portRange : current.portPredictionMaxRange;
   }

   public static int effectiveSendInterval() {
      PunchParams p = dynamicOverride;
      return p != null && p.sendInterval > 0 ? p.sendInterval : current.send.intervalMs;
   }

   public static boolean effectiveSkipDirectPunch() {
      PunchParams p = dynamicOverride;
      return p != null && p.skipDirectPunch;
   }

   public static PunchProfile current() {
      return current;
   }

   public static boolean isAggressive() {
      return current == AGGRESSIVE;
   }

   public static void switchTo(PunchProfile target, String reason) {
      if (target != null && target != current) {
         PunchProfile old = current;
         current = target;
         switchReason = reason;
         LOGGER.info("[PunchProfile] Switch: {} -> {} reason: {}", new Object[]{old.name, target.name, reason});
      }
   }

   public static void switchToAggressive(String reason) {
      switchTo(AGGRESSIVE, reason);
   }

   public static void switchToHardSym(String reason) {
      switchTo(HARDSYM, reason);
   }

   public static void switchToEasySymDual(String reason) {
      switchTo(EASY_SYM_DUAL, reason);
   }

   public static void switchToDefault(String reason) {
      switchTo(DEFAULT, reason);
   }

   public static void switchToV100(String reason) {
      switchTo(V100, reason);
   }

   public static String describe() {
      return current.name
         + "(timeout="
         + current.punchTimeoutMs
         + "ms, cycles="
         + current.firewallDetectCycles
         + ", range="
         + current.portPredictionMaxRange
         + ")";
   }

   // 打洞日志里唯一能看到"本次实际生效参数"的字段（UdpHolePuncher / ConnectionManager 共 10 处调用），
   // 原来只报 timeout/cycles/range 三项，改完模板是否真的换了配方看不出来。
   // 现在列全部与 DEFAULT 不同的字段：与 DEFAULT 完全一致的模板只输出 "=DEFAULT"，
   // 一眼就能看出这次跑的到底是配方不同的模板，还是一个没被拆开的副本。
   public String describeInstance() {
      StringBuilder d = new StringBuilder();
      diff(d, "timeoutMs", this.punchTimeoutMs, DEFAULT.punchTimeoutMs);
      diff(d, "detectCycles", this.firewallDetectCycles, DEFAULT.firewallDetectCycles);
      diff(d, "range", this.portPredictionMaxRange, DEFAULT.portPredictionMaxRange);
      diff(d, "progRanges", java.util.Arrays.toString(this.progressiveRanges), java.util.Arrays.toString(DEFAULT.progressiveRanges));
      diff(d, "cyclesPerRange", this.cyclesPerRange, DEFAULT.cyclesPerRange);
      diff(d, "easySymDualSockets", this.easySymDualSocketCount, DEFAULT.easySymDualSocketCount);
      diff(d, "easySymDualRange", this.easySymDualPortRange, DEFAULT.easySymDualPortRange);
      diff(d, "defaultRange", this.defaultPortRange, DEFAULT.defaultPortRange);
      diff(d, "wideRange", this.widePortRange, DEFAULT.widePortRange);
      diff(d, "maxRange", this.maxPortRange, DEFAULT.maxPortRange);
      diff(d, "minRange", this.minPortRange, DEFAULT.minPortRange);
      diff(d, "easySymRange", this.easySymPortRange, DEFAULT.easySymPortRange);
      diff(d, "hostMultiSockets", this.hostMultiSocketCount, DEFAULT.hostMultiSocketCount);
      diff(d, "hostMultiMinSockets", this.hostMultiMinSocketCount, DEFAULT.hostMultiMinSocketCount);
      diff(d, "hostMultiBaseSockets", this.hostMultiBaseSocketCount, DEFAULT.hostMultiBaseSocketCount);
      diff(d, "hardSymSockets", this.hardSymSocketCount, DEFAULT.hardSymSocketCount);
      diff(d, "birthdaySockets", this.birthdaySocketCount, DEFAULT.birthdaySocketCount);
      diff(d, "joinerSymSockets", this.joinerSymSocketCount, DEFAULT.joinerSymSocketCount);
      diff(d, "relaySockets", this.relaySocketCount, DEFAULT.relaySocketCount);
      diff(d, "joinerMultiRange", this.joinerMultiPortRange, DEFAULT.joinerMultiPortRange);
      diff(d, "easySymMutualSockets", this.easySymMutualSocketCount, DEFAULT.easySymMutualSocketCount);
      diff(d, "easySymMutualRetrySockets", this.easySymMutualRetrySocketCount, DEFAULT.easySymMutualRetrySocketCount);
      diff(d, "coneBackupRange", this.coneBackupPortRange, DEFAULT.coneBackupPortRange);
      diff(d, "stunSockets", this.socketStunCount, DEFAULT.socketStunCount);
      diff(d, "sockCreateGapMs", this.socketCreateIntervalMs, DEFAULT.socketCreateIntervalMs);
      diff(d, "hostRoundTimeoutMs", this.hostRoundTimeoutMs, DEFAULT.hostRoundTimeoutMs);
      diff(d, "reverseWindowSec", this.reverseWindowSec, DEFAULT.reverseWindowSec);
      diff(d, "connTimeoutSec", this.connectionTimeoutSec, DEFAULT.connectionTimeoutSec);
      diff(d, "symConnTimeoutSec", this.symmetricConnectionTimeoutSec, DEFAULT.symmetricConnectionTimeoutSec);
      diff(d, "maxAttempts", this.punchMaxAttempts, DEFAULT.punchMaxAttempts);
      diff(d, "retryDelayMs", this.punchRetryDelayMs, DEFAULT.punchRetryDelayMs);
      diff(d, "maxCycles", this.maxCycles, DEFAULT.maxCycles);
      diff(d, "maxSymCycles", this.maxSymCycles, DEFAULT.maxSymCycles);
      diff(d, "fallbackCycles", this.fallbackCycles, DEFAULT.fallbackCycles);
      diff(d, "send.intervalMs", this.send.intervalMs, DEFAULT.send.intervalMs);
      diff(d, "send.sockTimeoutMs", this.send.socketTimeoutMs, DEFAULT.send.socketTimeoutMs);
      diff(d, "send.extraWaitMs", this.send.extraWaitMs, DEFAULT.send.extraWaitMs);
      diff(d, "send.extraWaitLongMs", this.send.extraWaitLongMs, DEFAULT.send.extraWaitLongMs);
      diff(d, "send.jitterBaseMs", this.send.jitterBaseMs, DEFAULT.send.jitterBaseMs);
      diff(d, "send.jitterRangeMs", this.send.jitterRangeMs, DEFAULT.send.jitterRangeMs);
      diff(d, "send.minRounds", this.send.minRounds, DEFAULT.send.minRounds);
      diff(d, "send.minPass", this.send.minPass, DEFAULT.send.minPass);
      diff(d, "send.sleepShortMs", this.send.sleepShortMs, DEFAULT.send.sleepShortMs);
      diff(d, "send.sleepLongMs", this.send.sleepLongMs, DEFAULT.send.sleepLongMs);
      diff(d, "send.sweepWindow", this.send.sweepWindowSize, DEFAULT.send.sweepWindowSize);
      // 构造函数里每个模板的 sym 都被赋成同一个 RECIPE，所以这一段恒等于 SHARED_RECIPE：
      // 这就是"8 个模板共用一份对称喷洒配方"的现场证据，拆开后这里才会开始出差异。
      if (this.sym == DEFAULT.sym) {
         if (d.length() > 0) d.append(", ");
         d.append("sym=SHARED_RECIPE");
      } else {
         diff(d, "sym.easySymBombSockets", this.sym.easySymBombSockets, DEFAULT.sym.easySymBombSockets);
         diff(d, "sym.easySymBombWindow", this.sym.easySymBombWindow, DEFAULT.sym.easySymBombWindow);
         diff(d, "sym.easySymRoundMs", this.sym.easySymRoundIntervalMs, DEFAULT.sym.easySymRoundIntervalMs);
         diff(d, "sym.easySymBombDurMs", this.sym.easySymBombDurationMs, DEFAULT.sym.easySymBombDurationMs);
         diff(d, "sym.sprayPortMin", this.sym.hardSymSprayPortMin, DEFAULT.sym.hardSymSprayPortMin);
         diff(d, "sym.sprayPortMax", this.sym.hardSymSprayPortMax, DEFAULT.sym.hardSymSprayPortMax);
         diff(d, "sym.packetsPerPort", this.sym.hardSymPacketsPerPort, DEFAULT.sym.hardSymPacketsPerPort);
         diff(d, "sym.portIntervalMs", this.sym.hardSymPortIntervalMs, DEFAULT.sym.hardSymPortIntervalMs);
         diff(d, "sym.decayNumerator", this.sym.hardSymDecayNumerator, DEFAULT.sym.hardSymDecayNumerator);
         diff(d, "sym.decayFloor", this.sym.hardSymDecayFloor, DEFAULT.sym.hardSymDecayFloor);
         diff(d, "sym.maxPps", this.sym.maxPps, DEFAULT.sym.maxPps);
      }
      return this.name + "(" + (d.length() == 0 ? "=DEFAULT" : d.toString()) + ")";
   }

   private static void diff(StringBuilder d, String key, int value, int base) {
      if (value != base) {
         if (d.length() > 0) d.append(", ");
         d.append(key).append('=').append(value);
      }
   }

   private static void diff(StringBuilder d, String key, String value, String base) {
      if (!value.equals(base)) {
         if (d.length() > 0) d.append(", ");
         d.append(key).append('=').append(value);
      }
   }

   public static final class SendParams {
      public final int intervalMs;
      public final int socketTimeoutMs;
      public final int extraWaitMs;
      public final int extraWaitLongMs;
      public final int jitterBaseMs;
      public final int jitterRangeMs;
      public final int minRounds;
      public final int minPass;
      public final int sleepShortMs;
      public final int sleepLongMs;
      public final int sweepWindowSize;

      public SendParams(
         int intervalMs,
         int socketTimeoutMs,
         int extraWaitMs,
         int extraWaitLongMs,
         int jitterBaseMs,
         int jitterRangeMs,
         int minRounds,
         int minPass,
         int sleepShortMs,
         int sleepLongMs,
         int sweepWindowSize
      ) {
         this.intervalMs = intervalMs;
         this.socketTimeoutMs = socketTimeoutMs;
         this.extraWaitMs = extraWaitMs;
         this.extraWaitLongMs = extraWaitLongMs;
         this.jitterBaseMs = jitterBaseMs;
         this.jitterRangeMs = jitterRangeMs;
         this.minRounds = minRounds;
         this.minPass = minPass;
         this.sleepShortMs = sleepShortMs;
         this.sleepLongMs = sleepLongMs;
         this.sweepWindowSize = sweepWindowSize;
      }
   }
}
