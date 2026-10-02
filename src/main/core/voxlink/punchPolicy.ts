// SPDX-License-Identifier: LGPL-3.0-only
// Direct port of VoxLink network/{PunchParams,PunchTuner,PortPredictor,NatClass,
// PunchStrategySelector,PunchFailureClassifier}.java, revision 924845e.
import { PROFILES, type PunchProfile } from './punchProfiles'

export type NatClass = 'UNKNOWN' | 'CONE' | 'EASY_SYM' | 'HARD_SYM'
export const symmetric = (nat: NatClass) => nat === 'EASY_SYM' || nat === 'HARD_SYM'
export function recommendProfile(local: NatClass, remote: NatClass): PunchProfile {
  // NatClass.java: recommendProfile (ScenarioTier currently does not change the matrix).
  if (local === 'UNKNOWN' || remote === 'UNKNOWN') return PROFILES.AGGRESSIVE
  if (symmetric(local) && symmetric(remote)) return local === 'EASY_SYM' && remote === 'EASY_SYM' ? PROFILES.EASY_SYM_DUAL : PROFILES.HARDSYM
  if (local === 'CONE' && remote === 'CONE') return PROFILES.FAST_LANE
  if (local === 'EASY_SYM' || remote === 'EASY_SYM') return PROFILES.V100
  if (local === 'HARD_SYM' || remote === 'HARD_SYM') return PROFILES.AGGRESSIVE
  return PROFILES.DEFAULT
}
export type PunchStrategy = 'DIRECT_ONLY' | 'DIRECT_WITH_REVERSE_PARALLEL' | 'REVERSE_FIRST' | 'REVERSE_ONLY' | 'REVERSE_THEN_FORWARD' | 'RELAY_FALLBACK_FAST' | 'PARALLEL_FROM_START'
export function selectStrategy(local: NatClass | null, remote: NatClass | null, cycle: number, legacy: boolean): PunchStrategy {
  // PunchStrategySelector.java: select; no launcher-specific NAT shortcuts.
  if (legacy) return 'DIRECT_ONLY'
  if (!local || !remote) return 'DIRECT_WITH_REVERSE_PARALLEL'
  if (local === 'UNKNOWN' || remote === 'UNKNOWN') return symmetric(local === 'UNKNOWN' ? remote : local) ? 'REVERSE_FIRST' : 'DIRECT_WITH_REVERSE_PARALLEL'
  if ((local === 'CONE' && remote === 'HARD_SYM') || (local === 'HARD_SYM' && remote === 'CONE')) return cycle === 0 ? 'REVERSE_ONLY' : 'REVERSE_THEN_FORWARD'
  if (local === remote) return local === 'CONE' ? 'DIRECT_ONLY' : 'DIRECT_WITH_REVERSE_PARALLEL'
  return 'REVERSE_FIRST'
}

export const TUNER = {
  MAX_PORT_RANGE: 500, // PunchTuner.java: MAX_PORT_RANGE
  MAX_TIMEOUT_MS: 30000, // PunchTuner.java: MAX_TIMEOUT_MS
  MIN_SEND_INTERVAL_MS: 50, // PunchTuner.java: MIN_SEND_INTERVAL_MS
  LATE_CYCLE_TIMEOUT_MS: 5000, // PunchTuner.java: LATE_CYCLE_TIMEOUT_MS
  ACK_RETRIES_ON_TIMEOUT: 3, // PunchTuner.java: ACK_RETRIES_ON_TIMEOUT
  PREDICTION_DELTA_THRESHOLD: 100, // PunchTuner.java: PREDICTION_DELTA_THRESHOLD
  PORT_RANGE_MULTIPLIER: 2, // PunchTuner.java: PORT_RANGE_MULTIPLIER
  TIMEOUT_INCREMENT_MS: 4000, // PunchTuner.java: TIMEOUT_INCREMENT_MS
  SEND_INTERVAL_DIVISOR: 2 // PunchTuner.java: SEND_INTERVAL_DIVISOR
} as const
export interface PunchParams {
  portRange: number; timeoutMs: number; sendInterval: number; ackRetries: number
  skipDirectPunch: boolean; reuseSuccessfulSockets: boolean; successfulPortRange: number[] | null
  sendMinRounds: number; sendMinPass: number; hardSymSpray: boolean
  sprayPortCountMin: number; sprayPortCountMax: number; sprayPacketsPerPort: number
  sprayPortIntervalMs: number; sprayDecayNumerator: number; sprayDecayFloor: number
  easySymBomb: boolean; bombWindow: number; bombRoundIntervalMs: number; bombDurationMs: number
}
export function fromProfile(p: PunchProfile): PunchParams {
  // PunchParams.java: fromProfile and constructor defaults.
  return {
    portRange: p.portPredictionMaxRange, timeoutMs: p.punchTimeoutMs, sendInterval: p.send.intervalMs,
    ackRetries: 1, skipDirectPunch: false, reuseSuccessfulSockets: false, successfulPortRange: null,
    sendMinRounds: 0, sendMinPass: 0, hardSymSpray: p === PROFILES.HARDSYM, easySymBomb: p === PROFILES.EASY_SYM_DUAL,
    sprayPortCountMin: p.sym.hardSymSprayPortMin, sprayPortCountMax: p.sym.hardSymSprayPortMax,
    sprayPacketsPerPort: p.sym.hardSymPacketsPerPort, sprayPortIntervalMs: p.sym.hardSymPortIntervalMs,
    sprayDecayNumerator: p.sym.hardSymDecayNumerator, sprayDecayFloor: p.sym.hardSymDecayFloor,
    bombWindow: p.sym.easySymBombWindow, bombRoundIntervalMs: p.sym.easySymRoundIntervalMs, bombDurationMs: p.sym.easySymBombDurationMs
  }
}
export type FailureReason = 'NO_RESPONSE' | 'PREDICTION_OFF' | 'RESPONSE_NO_ACK' | 'FIREWALL_DETECTED' | 'PARTIAL_SUCCESS' | 'ACK_TIMEOUT'
export interface PunchResult {
  socketsTried: number; socketsReceivedPunch: number; socketsReceivedAck: number
  predictionDelta: number; elapsedMs: number; firewallDetected: boolean; portPredictionActive: boolean; success: boolean
}
export function classifyFailure(r: PunchResult | null): FailureReason {
  // PunchFailureClassifier.java: classify, including the ordering of prediction/firewall checks.
  if (!r) return 'NO_RESPONSE'
  if (r.portPredictionActive && r.socketsReceivedPunch === 0 && r.socketsReceivedAck === 0 && !r.firewallDetected) return 'PREDICTION_OFF'
  if (r.predictionDelta > TUNER.PREDICTION_DELTA_THRESHOLD) return 'PREDICTION_OFF'
  if (!r.socketsReceivedPunch && !r.socketsReceivedAck) return r.firewallDetected ? 'FIREWALL_DETECTED' : 'NO_RESPONSE'
  if (r.socketsReceivedPunch > 0 && r.socketsReceivedAck === 0) return 'RESPONSE_NO_ACK'
  if (r.socketsReceivedAck > 0 && !r.success) return 'ACK_TIMEOUT'
  if (r.socketsReceivedPunch > 0 && r.socketsReceivedPunch < r.socketsTried) return 'PARTIAL_SUCCESS'
  return 'NO_RESPONSE'
}
export function nextParams(profile: PunchProfile, cycle: number, maxCycles: number, failure: FailureReason | null, result: PunchResult | null): PunchParams {
  let p = fromProfile(profile)
  if (failure) {
    switch (failure) {
      case 'NO_RESPONSE':
        p.portRange = Math.min(p.portRange * TUNER.PORT_RANGE_MULTIPLIER, TUNER.MAX_PORT_RANGE)
        p.timeoutMs = Math.min(p.timeoutMs + TUNER.TIMEOUT_INCREMENT_MS, TUNER.MAX_TIMEOUT_MS)
        p.sendMinRounds = 3; p.sendMinPass = 3 // PunchTuner.java: NO_RESPONSE
        break
      case 'PREDICTION_OFF':
        p = fromProfile(PROFILES.HARDSYM)
        p.portRange = Math.min(p.portRange * TUNER.PORT_RANGE_MULTIPLIER, TUNER.MAX_PORT_RANGE)
        p.sendMinRounds = 3; p.sendMinPass = 3 // PunchTuner.java: PREDICTION_OFF
        break
      case 'RESPONSE_NO_ACK':
        p.sendInterval = Math.max(Math.trunc(p.sendInterval / TUNER.SEND_INTERVAL_DIVISOR), TUNER.MIN_SEND_INTERVAL_MS)
        p.sendMinPass = 3 // PunchTuner.java: RESPONSE_NO_ACK
        break
      case 'FIREWALL_DETECTED': p.skipDirectPunch = true; break
      case 'PARTIAL_SUCCESS':
        if (result && result.predictionDelta > 0) {
          p.reuseSuccessfulSockets = true
          p.successfulPortRange = [result.predictionDelta - 5, result.predictionDelta + 5] // PunchTuner.java: PARTIAL_SUCCESS
        }
        break
      case 'ACK_TIMEOUT': p.ackRetries = TUNER.ACK_RETRIES_ON_TIMEOUT; p.sendMinPass = 3; break // PunchTuner.java: ACK_TIMEOUT
    }
    if (result && result.elapsedMs > 0) {
      if (result.elapsedMs > 10000) p.timeoutMs = Math.min(Math.trunc(p.timeoutMs * 3 / 2), TUNER.MAX_TIMEOUT_MS) // PunchTuner.java: elapsed adaptation
      else if (result.elapsedMs < 3000 && failure === 'NO_RESPONSE') p.portRange = Math.min(p.portRange * TUNER.PORT_RANGE_MULTIPLIER, TUNER.MAX_PORT_RANGE)
    }
  }
  if (cycle >= maxCycles - 2 && p.timeoutMs > TUNER.LATE_CYCLE_TIMEOUT_MS) p.timeoutMs = Math.max(TUNER.LATE_CYCLE_TIMEOUT_MS, Math.trunc(p.timeoutMs * 3 / 4)) // PunchTuner.java: applyLateCycleLimit
  return p
}

export const PREDICTOR = {
  SAMPLES_HIGH: 10, RANGE_HIGH: 32, // PortPredictor.java: SAMPLES_HIGH, RANGE_HIGH
  SAMPLES_MID: 5, RANGE_MID: 64, // PortPredictor.java: SAMPLES_MID, RANGE_MID
  SAMPLES_LOW: 3, RANGE_LOW: 100, // PortPredictor.java: SAMPLES_LOW, RANGE_LOW
  RANGE_DEFAULT: 200, EPSILON: 1e-9, // PortPredictor.java: RANGE_DEFAULT, EPSILON
  ALPHA: 0.4, LR_WEIGHT: 0.6, DELTA_WEIGHT: 0.4, // PortPredictor.java: ALPHA, LR_WEIGHT, DELTA_WEIGHT
  MIN_PORT: 1024, MAX_PORT: 65535 // PortPredictor.java: MIN_PORT, MAX_PORT
} as const
export function linearRegressionPredict(ports: readonly number[]): number {
  if (!ports.length) return -1
  if (ports.length === 1) return ports[0]
  let x = 0, y = 0, xy = 0, xx = 0
  ports.forEach((p, i) => { x += i; y += p; xy += i * p; xx += i * i })
  const n = ports.length, denom = n * xx - x * x
  if (Math.abs(denom) < PREDICTOR.EPSILON) return Math.round(y / n)
  const slope = (n * xy - x * y) / denom
  return Math.round(slope * n + (y - slope * x) / n)
}
export function deltaPredict(ports: readonly number[]): number {
  if (ports.length < 2) return -1
  const sorted = ports.slice(1).map((p, i) => p - ports[i]).sort((a, b) => a - b)
  const trim = Math.trunc(sorted.length / 4) // PortPredictor.java: deltaPredict quartile trim
  const values = sorted.slice(trim, sorted.length - trim)
  let ema = values[0]
  for (const value of values.slice(1)) ema += PREDICTOR.ALPHA * (value - ema)
  return ports[ports.length - 1] + Math.round(ema)
}
export function predict(ports: readonly number[]) {
  if (ports.length < 2) return { predictedPort: ports[0] ?? -1, range: PREDICTOR.RANGE_DEFAULT, strategy: ports.length ? 'single_sample' : 'no_samples' }
  const lr = linearRegressionPredict(ports), delta = deltaPredict(ports)
  const value = lr > 0 && delta > 0 ? Math.round(lr * PREDICTOR.LR_WEIGHT + delta * PREDICTOR.DELTA_WEIGHT) : lr > 0 ? lr : delta
  const range = ports.length >= PREDICTOR.SAMPLES_HIGH ? PREDICTOR.RANGE_HIGH : ports.length >= PREDICTOR.SAMPLES_MID ? PREDICTOR.RANGE_MID : ports.length >= PREDICTOR.SAMPLES_LOW ? PREDICTOR.RANGE_LOW : PREDICTOR.RANGE_DEFAULT
  return { predictedPort: Math.max(PREDICTOR.MIN_PORT, Math.min(PREDICTOR.MAX_PORT, value)), range, strategy: 'combined' }
}
export function generateTargetPorts(port: number, range: number): number[] {
  const lo = Math.max(PREDICTOR.MIN_PORT, port - range), hi = Math.min(PREDICTOR.MAX_PORT, port + range), out = [port]
  for (let offset = 1; offset <= range; offset++) {
    if (port + offset <= hi) out.push(port + offset)
    if (port - offset >= lo) out.push(port - offset)
  }
  return out
}
