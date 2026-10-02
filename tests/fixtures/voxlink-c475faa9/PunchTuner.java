package icu.wuhui.voxlink.network;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class PunchTuner {
   private static final Logger LOGGER = LoggerFactory.getLogger("voxlink-punch");
   private static final int MAX_PORT_RANGE = 500;
   private static final int MAX_TIMEOUT_MS = 30000;
   private static final int MIN_SEND_INTERVAL_MS = 50;
   private static final int LATE_CYCLE_TIMEOUT_MS = 5000;
   private static final int ACK_RETRIES_ON_TIMEOUT = 3;
   private static final int PREDICTION_DELTA_THRESHOLD = 100;
   private static final int PORT_RANGE_MULTIPLIER = 2;
   private static final int TIMEOUT_INCREMENT_MS = 4000;
   private static final int SEND_INTERVAL_DIVISOR = 2;

   private PunchTuner() {
   }

   public static PunchParams nextParams(
      PunchProfile currentProfile,
      NatClass localNat,
      NatClass remoteNat,
      int cycle,
      int maxCycles,
      PunchFailureClassifier.FailureReason lastFailure,
      PunchResult lastResult
   ) {
      PunchParams params = PunchParams.fromProfile(currentProfile);
      if (lastFailure == null) {
         return applyLateCycleLimit(params, cycle, maxCycles);
      }

      switch (lastFailure) {
         case NO_RESPONSE:
            params.portRange = Math.min(params.portRange * 2, 500);
            params.timeoutMs = Math.min(params.timeoutMs + 4000, 30000);
            params.sendMinRounds = 3;
            params.sendMinPass = 3;
            break;
         case PREDICTION_OFF:
            params = PunchParams.fromProfile(PunchProfile.HARDSYM);
            params.portRange = Math.min(params.portRange * 2, 500);
            params.sendMinRounds = 3;
            params.sendMinPass = 3;
            break;
         case RESPONSE_NO_ACK:
            params.sendInterval = Math.max(params.sendInterval / 2, 50);
            params.sendMinPass = 3;
            break;
         case FIREWALL_DETECTED:
            params.skipDirectPunch = true;
            break;
         case PARTIAL_SUCCESS:
            if (lastResult != null && lastResult.predictionDelta > 0) {
               params.reuseSuccessfulSockets = true;
               params.successfulPortRange = new int[]{lastResult.predictionDelta - 5, lastResult.predictionDelta + 5};
            }
            break;
         case ACK_TIMEOUT:
            params.ackRetries = 3;
            params.sendMinPass = 3;
      }

      if (lastResult != null && lastResult.elapsedMs > 0L) {
         if (lastResult.elapsedMs > 10000L) {
            params.timeoutMs = Math.min(params.timeoutMs * 3 / 2, 30000);
         } else if (lastResult.elapsedMs < 3000L && lastFailure == PunchFailureClassifier.FailureReason.NO_RESPONSE) {
            params.portRange = Math.min(params.portRange * 2, 500);
         }
      }

      params = applyLateCycleLimit(params, cycle, maxCycles);
      LOGGER.info(
         "[PunchTuner] cycle={} failure={} -> portRange={} timeout={} sendInterval={} ackRetries={} skipDirect={} reuse={}",
         new Object[]{
            cycle,
            lastFailure,
            params.portRange,
            params.timeoutMs,
            params.sendInterval,
            params.ackRetries,
            params.skipDirectPunch,
            params.reuseSuccessfulSockets
         }
      );
      return params;
   }

   private static PunchParams applyLateCycleLimit(PunchParams params, int cycle, int maxCycles) {
      if (cycle >= maxCycles - 2 && params.timeoutMs > 5000) {
         params.timeoutMs = Math.max(5000, params.timeoutMs * 3 / 4);
      }

      return params;
   }
}
