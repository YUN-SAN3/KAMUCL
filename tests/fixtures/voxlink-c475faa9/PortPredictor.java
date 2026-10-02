package icu.wuhui.voxlink.network;

import icu.wuhui.voxlink.VoxLinkMod;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class PortPredictor {
   private static final int SAMPLES_HIGH = 10;
   private static final int RANGE_HIGH = 32;
   private static final int SAMPLES_MID = 5;
   private static final int RANGE_MID = 64;
   private static final int SAMPLES_LOW = 3;
   private static final int RANGE_LOW = 100;
   private static final int RANGE_DEFAULT = 200;
   private static final double EPSILON = 1.0E-9;
   private static final double ALPHA = 0.4;
   private static final double LR_WEIGHT = 0.6;
   private static final double DELTA_WEIGHT = 0.4;
   private static final int MIN_PORT = 1024;
   private static final int MAX_PORT = 65535;

   private PortPredictor() {
   }

   private static int confidenceRange(int sampleCount) {
      if (sampleCount >= 10) {
         return 32;
      } else if (sampleCount >= 5) {
         return 64;
      } else {
         return sampleCount >= 3 ? 100 : 200;
      }
   }

   public static int linearRegressionPredict(List<Integer> ports) {
      if (ports != null && !ports.isEmpty()) {
         int n = ports.size();
         if (n == 1) {
            return ports.get(0);
         }

         double sumX = 0.0;
         double sumY = 0.0;
         double sumXY = 0.0;
         double sumXX = 0.0;

         for (int i = 0; i < n; i++) {
            sumX += i;
            sumY += ports.get(i).intValue();
            sumXY += (double)i * ports.get(i).intValue();
            sumXX += (double)i * i;
         }

         double denom = n * sumXX - sumX * sumX;
         if (Math.abs(denom) < 1.0E-9) {
            return (int)Math.round(sumY / n);
         }

         double slope = (n * sumXY - sumX * sumY) / denom;
         double intercept = (sumY - slope * sumX) / n;
         int predicted = (int)Math.round(slope * n + intercept);
         VoxLinkMod.LOGGER
            .info(
               "[PortPredictor] Linear regression: slope={}, intercept={}, predicted={} (n={})",
               new Object[]{String.format("%.2f", slope), String.format("%.2f", intercept), predicted, n}
            );
         return predicted;
      } else {
         return -1;
      }
   }

   public static int deltaPredict(List<Integer> ports) {
      if (ports != null && ports.size() >= 2) {
         List<Integer> deltas = new ArrayList<>();

         for (int i = 1; i < ports.size(); i++) {
            deltas.add(ports.get(i) - ports.get(i - 1));
         }

         List<Integer> sorted = new ArrayList<>(deltas);
         Collections.sort(sorted);
         int trim = sorted.size() / 4;
         List<Integer> trimmed = sorted.subList(trim, sorted.size() - trim);
         if (trimmed.isEmpty()) {
            trimmed = sorted;
         }

         double ema = trimmed.get(0).intValue();
         double alpha = 0.4;

         for (int i = 1; i < trimmed.size(); i++) {
            ema += alpha * (trimmed.get(i).intValue() - ema);
         }

         int delta = (int)Math.round(ema);
         int lastPort = ports.get(ports.size() - 1);
         int predicted = lastPort + delta;
         VoxLinkMod.LOGGER
            .info("[PortPredictor] Delta prediction: delta={}, lastPort={}, predicted={} (n={})", new Object[]{delta, lastPort, predicted, ports.size()});
         return predicted;
      } else {
         return -1;
      }
   }

   public static PortPredictor.PredictResult predict(List<Integer> ports) {
      if (ports != null && !ports.isEmpty()) {
         if (ports.size() == 1) {
            return new PortPredictor.PredictResult(ports.get(0), 200, "single_sample");
         }

         int lrPredicted = linearRegressionPredict(ports);
         int deltaPredicted = deltaPredict(ports);
         int finalPredicted;
         if (lrPredicted > 0 && deltaPredicted > 0) {
            finalPredicted = (int)Math.round(lrPredicted * 0.6 + deltaPredicted * 0.4);
         } else if (lrPredicted > 0) {
            finalPredicted = lrPredicted;
         } else {
            finalPredicted = deltaPredicted;
         }

         if (finalPredicted < 1024) {
            finalPredicted = 1024;
         }

         if (finalPredicted > 65535) {
            finalPredicted = 65535;
         }

         int range = confidenceRange(ports.size());
         VoxLinkMod.LOGGER
            .info("[PortPredictor] Combined: lr={}, delta={}, final={}, range=±{}", new Object[]{lrPredicted, deltaPredicted, finalPredicted, range});
         return new PortPredictor.PredictResult(finalPredicted, range, "combined");
      } else {
         return new PortPredictor.PredictResult(-1, 200, "no_samples");
      }
   }

   public static List<Integer> generateTargetPorts(int predictedPort, int range) {
      List<Integer> targets = new ArrayList<>();
      int lo = Math.max(1024, predictedPort - range);
      int hi = Math.min(65535, predictedPort + range);
      targets.add(predictedPort);

      for (int offset = 1; offset <= range; offset++) {
         int up = predictedPort + offset;
         int down = predictedPort - offset;
         if (up <= hi) {
            targets.add(up);
         }

         if (down >= lo) {
            targets.add(down);
         }
      }

      return targets;
   }

   public static class PredictResult {
      public final int predictedPort;
      public final int range;
      public final String strategy;

      PredictResult(int predictedPort, int range, String strategy) {
         this.predictedPort = predictedPort;
         this.range = range;
         this.strategy = strategy;
      }
   }
}
