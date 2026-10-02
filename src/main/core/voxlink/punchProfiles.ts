// SPDX-License-Identifier: LGPL-3.0-only
// VoxLink 924845e897d8fb36dca2474ade30e675278559d0; generated from unmodified PunchProfile.java.
export interface SendParams {
  readonly intervalMs: number
  readonly socketTimeoutMs: number
  readonly extraWaitMs: number
  readonly extraWaitLongMs: number
  readonly jitterBaseMs: number
  readonly jitterRangeMs: number
  readonly minRounds: number
  readonly minPass: number
  readonly sleepShortMs: number
  readonly sleepLongMs: number
  readonly sweepWindowSize: number
}
export interface SymParams {
  readonly easySymBombSockets: number
  readonly easySymBombWindow: number
  readonly easySymRoundIntervalMs: number
  readonly easySymBombDurationMs: number
  readonly hardSymSprayPortMin: number
  readonly hardSymSprayPortMax: number
  readonly hardSymPacketsPerPort: number
  readonly hardSymPortIntervalMs: number
  readonly hardSymDecayNumerator: number
  readonly hardSymDecayFloor: number
  readonly maxPps: number
}
export interface PunchProfile {
  readonly name: string
  readonly punchTimeoutMs: number
  readonly firewallDetectCycles: number
  readonly portPredictionMaxRange: number
  readonly progressiveRanges: readonly number[]
  readonly cyclesPerRange: number
  readonly easySymDualSocketCount: number
  readonly easySymDualPortRange: number
  readonly defaultPortRange: number
  readonly widePortRange: number
  readonly maxPortRange: number
  readonly minPortRange: number
  readonly easySymPortRange: number
  readonly hostMultiSocketCount: number
  readonly hostMultiMinSocketCount: number
  readonly hostMultiBaseSocketCount: number
  readonly hardSymSocketCount: number
  readonly birthdaySocketCount: number
  readonly joinerSymSocketCount: number
  readonly relaySocketCount: number
  readonly joinerMultiPortRange: number
  readonly easySymMutualSocketCount: number
  readonly easySymMutualRetrySocketCount: number
  readonly coneBackupPortRange: number
  readonly socketStunCount: number
  readonly socketCreateIntervalMs: number
  readonly hostRoundTimeoutMs: number
  readonly reverseWindowSec: number
  readonly connectionTimeoutSec: number
  readonly symmetricConnectionTimeoutSec: number
  readonly punchMaxAttempts: number
  readonly punchRetryDelayMs: number
  readonly maxCycles: number
  readonly maxSymCycles: number
  readonly fallbackCycles: number
  readonly send: SendParams
  readonly sym: SymParams
}
export const SEND_DEFAULT: SendParams = Object.freeze({
  intervalMs: 200, // PunchProfile.java: SEND_DEFAULT.intervalMs
  socketTimeoutMs: 500, // PunchProfile.java: SEND_DEFAULT.socketTimeoutMs
  extraWaitMs: 1000, // PunchProfile.java: SEND_DEFAULT.extraWaitMs
  extraWaitLongMs: 2000, // PunchProfile.java: SEND_DEFAULT.extraWaitLongMs
  jitterBaseMs: 600, // PunchProfile.java: SEND_DEFAULT.jitterBaseMs
  jitterRangeMs: 200, // PunchProfile.java: SEND_DEFAULT.jitterRangeMs
  minRounds: 3, // PunchProfile.java: SEND_DEFAULT.minRounds
  minPass: 3, // PunchProfile.java: SEND_DEFAULT.minPass
  sleepShortMs: 1, // PunchProfile.java: SEND_DEFAULT.sleepShortMs
  sleepLongMs: 10, // PunchProfile.java: SEND_DEFAULT.sleepLongMs
  sweepWindowSize: 800, // PunchProfile.java: SEND_DEFAULT.sweepWindowSize
})
export const SEND_DEFAULT_FAST: SendParams = Object.freeze({
  intervalMs: 200, // PunchProfile.java: SEND_DEFAULT_FAST.intervalMs
  socketTimeoutMs: 500, // PunchProfile.java: SEND_DEFAULT_FAST.socketTimeoutMs
  extraWaitMs: 1000, // PunchProfile.java: SEND_DEFAULT_FAST.extraWaitMs
  extraWaitLongMs: 2000, // PunchProfile.java: SEND_DEFAULT_FAST.extraWaitLongMs
  jitterBaseMs: 600, // PunchProfile.java: SEND_DEFAULT_FAST.jitterBaseMs
  jitterRangeMs: 200, // PunchProfile.java: SEND_DEFAULT_FAST.jitterRangeMs
  minRounds: 1, // PunchProfile.java: SEND_DEFAULT_FAST.minRounds
  minPass: 2, // PunchProfile.java: SEND_DEFAULT_FAST.minPass
  sleepShortMs: 1, // PunchProfile.java: SEND_DEFAULT_FAST.sleepShortMs
  sleepLongMs: 5, // PunchProfile.java: SEND_DEFAULT_FAST.sleepLongMs
  sweepWindowSize: 800, // PunchProfile.java: SEND_DEFAULT_FAST.sweepWindowSize
})
export const SEND_SPRINT: SendParams = Object.freeze({
  intervalMs: 100, // PunchProfile.java: SEND_SPRINT.intervalMs
  socketTimeoutMs: 300, // PunchProfile.java: SEND_SPRINT.socketTimeoutMs
  extraWaitMs: 600, // PunchProfile.java: SEND_SPRINT.extraWaitMs
  extraWaitLongMs: 1200, // PunchProfile.java: SEND_SPRINT.extraWaitLongMs
  jitterBaseMs: 400, // PunchProfile.java: SEND_SPRINT.jitterBaseMs
  jitterRangeMs: 150, // PunchProfile.java: SEND_SPRINT.jitterRangeMs
  minRounds: 1, // PunchProfile.java: SEND_SPRINT.minRounds
  minPass: 1, // PunchProfile.java: SEND_SPRINT.minPass
  sleepShortMs: 1, // PunchProfile.java: SEND_SPRINT.sleepShortMs
  sleepLongMs: 3, // PunchProfile.java: SEND_SPRINT.sleepLongMs
  sweepWindowSize: 400, // PunchProfile.java: SEND_SPRINT.sweepWindowSize
})
export const SEND_WIDE: SendParams = Object.freeze({
  intervalMs: 150, // PunchProfile.java: SEND_WIDE.intervalMs
  socketTimeoutMs: 500, // PunchProfile.java: SEND_WIDE.socketTimeoutMs
  extraWaitMs: 1000, // PunchProfile.java: SEND_WIDE.extraWaitMs
  extraWaitLongMs: 2000, // PunchProfile.java: SEND_WIDE.extraWaitLongMs
  jitterBaseMs: 500, // PunchProfile.java: SEND_WIDE.jitterBaseMs
  jitterRangeMs: 200, // PunchProfile.java: SEND_WIDE.jitterRangeMs
  minRounds: 1, // PunchProfile.java: SEND_WIDE.minRounds
  minPass: 2, // PunchProfile.java: SEND_WIDE.minPass
  sleepShortMs: 1, // PunchProfile.java: SEND_WIDE.sleepShortMs
  sleepLongMs: 5, // PunchProfile.java: SEND_WIDE.sleepLongMs
  sweepWindowSize: 800, // PunchProfile.java: SEND_WIDE.sweepWindowSize
})
export const SEND_WEAK: SendParams = Object.freeze({
  intervalMs: 250, // PunchProfile.java: SEND_WEAK.intervalMs
  socketTimeoutMs: 800, // PunchProfile.java: SEND_WEAK.socketTimeoutMs
  extraWaitMs: 1500, // PunchProfile.java: SEND_WEAK.extraWaitMs
  extraWaitLongMs: 3000, // PunchProfile.java: SEND_WEAK.extraWaitLongMs
  jitterBaseMs: 500, // PunchProfile.java: SEND_WEAK.jitterBaseMs
  jitterRangeMs: 250, // PunchProfile.java: SEND_WEAK.jitterRangeMs
  minRounds: 3, // PunchProfile.java: SEND_WEAK.minRounds
  minPass: 3, // PunchProfile.java: SEND_WEAK.minPass
  sleepShortMs: 2, // PunchProfile.java: SEND_WEAK.sleepShortMs
  sleepLongMs: 8, // PunchProfile.java: SEND_WEAK.sleepLongMs
  sweepWindowSize: 600, // PunchProfile.java: SEND_WEAK.sweepWindowSize
})
export const RECIPE: SymParams = Object.freeze({
  easySymBombSockets: 25, // PunchProfile.java: RECIPE.easySymBombSockets
  easySymBombWindow: 20, // PunchProfile.java: RECIPE.easySymBombWindow
  easySymRoundIntervalMs: 100, // PunchProfile.java: RECIPE.easySymRoundIntervalMs
  easySymBombDurationMs: 5000, // PunchProfile.java: RECIPE.easySymBombDurationMs
  hardSymSprayPortMin: 600, // PunchProfile.java: RECIPE.hardSymSprayPortMin
  hardSymSprayPortMax: 800, // PunchProfile.java: RECIPE.hardSymSprayPortMax
  hardSymPacketsPerPort: 3, // PunchProfile.java: RECIPE.hardSymPacketsPerPort
  hardSymPortIntervalMs: 1, // PunchProfile.java: RECIPE.hardSymPortIntervalMs
  hardSymDecayNumerator: 2, // PunchProfile.java: RECIPE.hardSymDecayNumerator
  hardSymDecayFloor: 180, // PunchProfile.java: RECIPE.hardSymDecayFloor
  maxPps: 3000, // PunchProfile.java: RECIPE.maxPps
})
export const DEFAULT: PunchProfile = Object.freeze({
  name: "DEFAULT", // PunchProfile.java: DEFAULT.name
  punchTimeoutMs: 12000, // PunchProfile.java: DEFAULT.punchTimeoutMs
  firewallDetectCycles: 30, // PunchProfile.java: DEFAULT.firewallDetectCycles
  portPredictionMaxRange: 100, // PunchProfile.java: DEFAULT.portPredictionMaxRange
  progressiveRanges: [10, 25, 50, 75, 100], // PunchProfile.java: DEFAULT.progressiveRanges
  cyclesPerRange: 1, // PunchProfile.java: DEFAULT.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: DEFAULT.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: DEFAULT.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: DEFAULT.defaultPortRange
  widePortRange: 50, // PunchProfile.java: DEFAULT.widePortRange
  maxPortRange: 100, // PunchProfile.java: DEFAULT.maxPortRange
  minPortRange: 3, // PunchProfile.java: DEFAULT.minPortRange
  easySymPortRange: 20, // PunchProfile.java: DEFAULT.easySymPortRange
  hostMultiSocketCount: 20, // PunchProfile.java: DEFAULT.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: DEFAULT.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: DEFAULT.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: DEFAULT.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: DEFAULT.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: DEFAULT.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: DEFAULT.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: DEFAULT.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: DEFAULT.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: DEFAULT.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: DEFAULT.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: DEFAULT.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: DEFAULT.socketCreateIntervalMs
  hostRoundTimeoutMs: 8000, // PunchProfile.java: DEFAULT.hostRoundTimeoutMs
  reverseWindowSec: 40, // PunchProfile.java: DEFAULT.reverseWindowSec
  connectionTimeoutSec: 45, // PunchProfile.java: DEFAULT.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 75, // PunchProfile.java: DEFAULT.symmetricConnectionTimeoutSec
  punchMaxAttempts: 3, // PunchProfile.java: DEFAULT.punchMaxAttempts
  punchRetryDelayMs: 800, // PunchProfile.java: DEFAULT.punchRetryDelayMs
  maxCycles: 8, // PunchProfile.java: DEFAULT.maxCycles
  maxSymCycles: 6, // PunchProfile.java: DEFAULT.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: DEFAULT.fallbackCycles
  send: SEND_DEFAULT, // PunchProfile.java: DEFAULT.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const AGGRESSIVE: PunchProfile = Object.freeze({
  name: "AGGRESSIVE", // PunchProfile.java: AGGRESSIVE.name
  punchTimeoutMs: 20000, // PunchProfile.java: AGGRESSIVE.punchTimeoutMs
  firewallDetectCycles: 50, // PunchProfile.java: AGGRESSIVE.firewallDetectCycles
  portPredictionMaxRange: 100, // PunchProfile.java: AGGRESSIVE.portPredictionMaxRange
  progressiveRanges: [10, 25, 50, 75, 100], // PunchProfile.java: AGGRESSIVE.progressiveRanges
  cyclesPerRange: 1, // PunchProfile.java: AGGRESSIVE.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: AGGRESSIVE.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: AGGRESSIVE.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: AGGRESSIVE.defaultPortRange
  widePortRange: 50, // PunchProfile.java: AGGRESSIVE.widePortRange
  maxPortRange: 100, // PunchProfile.java: AGGRESSIVE.maxPortRange
  minPortRange: 3, // PunchProfile.java: AGGRESSIVE.minPortRange
  easySymPortRange: 20, // PunchProfile.java: AGGRESSIVE.easySymPortRange
  hostMultiSocketCount: 20, // PunchProfile.java: AGGRESSIVE.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: AGGRESSIVE.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: AGGRESSIVE.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: AGGRESSIVE.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: AGGRESSIVE.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: AGGRESSIVE.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: AGGRESSIVE.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: AGGRESSIVE.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: AGGRESSIVE.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: AGGRESSIVE.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: AGGRESSIVE.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: AGGRESSIVE.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: AGGRESSIVE.socketCreateIntervalMs
  hostRoundTimeoutMs: 10000, // PunchProfile.java: AGGRESSIVE.hostRoundTimeoutMs
  reverseWindowSec: 45, // PunchProfile.java: AGGRESSIVE.reverseWindowSec
  connectionTimeoutSec: 50, // PunchProfile.java: AGGRESSIVE.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 85, // PunchProfile.java: AGGRESSIVE.symmetricConnectionTimeoutSec
  punchMaxAttempts: 4, // PunchProfile.java: AGGRESSIVE.punchMaxAttempts
  punchRetryDelayMs: 600, // PunchProfile.java: AGGRESSIVE.punchRetryDelayMs
  maxCycles: 10, // PunchProfile.java: AGGRESSIVE.maxCycles
  maxSymCycles: 8, // PunchProfile.java: AGGRESSIVE.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: AGGRESSIVE.fallbackCycles
  send: SEND_DEFAULT_FAST, // PunchProfile.java: AGGRESSIVE.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const HARDSYM: PunchProfile = Object.freeze({
  name: "HARDSYM", // PunchProfile.java: HARDSYM.name
  punchTimeoutMs: 30000, // PunchProfile.java: HARDSYM.punchTimeoutMs
  firewallDetectCycles: 60, // PunchProfile.java: HARDSYM.firewallDetectCycles
  portPredictionMaxRange: 500, // PunchProfile.java: HARDSYM.portPredictionMaxRange
  progressiveRanges: [20, 50, 100, 200, 500], // PunchProfile.java: HARDSYM.progressiveRanges
  cyclesPerRange: 2, // PunchProfile.java: HARDSYM.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: HARDSYM.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: HARDSYM.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: HARDSYM.defaultPortRange
  widePortRange: 50, // PunchProfile.java: HARDSYM.widePortRange
  maxPortRange: 500, // PunchProfile.java: HARDSYM.maxPortRange
  minPortRange: 3, // PunchProfile.java: HARDSYM.minPortRange
  easySymPortRange: 20, // PunchProfile.java: HARDSYM.easySymPortRange
  hostMultiSocketCount: 84, // PunchProfile.java: HARDSYM.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: HARDSYM.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: HARDSYM.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: HARDSYM.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: HARDSYM.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: HARDSYM.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: HARDSYM.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: HARDSYM.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: HARDSYM.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: HARDSYM.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: HARDSYM.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: HARDSYM.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: HARDSYM.socketCreateIntervalMs
  hostRoundTimeoutMs: 12000, // PunchProfile.java: HARDSYM.hostRoundTimeoutMs
  reverseWindowSec: 55, // PunchProfile.java: HARDSYM.reverseWindowSec
  connectionTimeoutSec: 60, // PunchProfile.java: HARDSYM.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 100, // PunchProfile.java: HARDSYM.symmetricConnectionTimeoutSec
  punchMaxAttempts: 5, // PunchProfile.java: HARDSYM.punchMaxAttempts
  punchRetryDelayMs: 500, // PunchProfile.java: HARDSYM.punchRetryDelayMs
  maxCycles: 12, // PunchProfile.java: HARDSYM.maxCycles
  maxSymCycles: 10, // PunchProfile.java: HARDSYM.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: HARDSYM.fallbackCycles
  send: SEND_WIDE, // PunchProfile.java: HARDSYM.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const EASY_SYM_DUAL: PunchProfile = Object.freeze({
  name: "EASY_SYM_DUAL", // PunchProfile.java: EASY_SYM_DUAL.name
  punchTimeoutMs: 12000, // PunchProfile.java: EASY_SYM_DUAL.punchTimeoutMs
  firewallDetectCycles: 30, // PunchProfile.java: EASY_SYM_DUAL.firewallDetectCycles
  portPredictionMaxRange: 50, // PunchProfile.java: EASY_SYM_DUAL.portPredictionMaxRange
  progressiveRanges: [5, 10, 20, 30, 50], // PunchProfile.java: EASY_SYM_DUAL.progressiveRanges
  cyclesPerRange: 2, // PunchProfile.java: EASY_SYM_DUAL.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: EASY_SYM_DUAL.easySymDualSocketCount
  easySymDualPortRange: 50, // PunchProfile.java: EASY_SYM_DUAL.easySymDualPortRange
  defaultPortRange: 20, // PunchProfile.java: EASY_SYM_DUAL.defaultPortRange
  widePortRange: 50, // PunchProfile.java: EASY_SYM_DUAL.widePortRange
  maxPortRange: 50, // PunchProfile.java: EASY_SYM_DUAL.maxPortRange
  minPortRange: 3, // PunchProfile.java: EASY_SYM_DUAL.minPortRange
  easySymPortRange: 20, // PunchProfile.java: EASY_SYM_DUAL.easySymPortRange
  hostMultiSocketCount: 25, // PunchProfile.java: EASY_SYM_DUAL.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: EASY_SYM_DUAL.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: EASY_SYM_DUAL.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: EASY_SYM_DUAL.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: EASY_SYM_DUAL.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: EASY_SYM_DUAL.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: EASY_SYM_DUAL.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: EASY_SYM_DUAL.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: EASY_SYM_DUAL.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: EASY_SYM_DUAL.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: EASY_SYM_DUAL.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: EASY_SYM_DUAL.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: EASY_SYM_DUAL.socketCreateIntervalMs
  hostRoundTimeoutMs: 8000, // PunchProfile.java: EASY_SYM_DUAL.hostRoundTimeoutMs
  reverseWindowSec: 40, // PunchProfile.java: EASY_SYM_DUAL.reverseWindowSec
  connectionTimeoutSec: 45, // PunchProfile.java: EASY_SYM_DUAL.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 75, // PunchProfile.java: EASY_SYM_DUAL.symmetricConnectionTimeoutSec
  punchMaxAttempts: 3, // PunchProfile.java: EASY_SYM_DUAL.punchMaxAttempts
  punchRetryDelayMs: 800, // PunchProfile.java: EASY_SYM_DUAL.punchRetryDelayMs
  maxCycles: 8, // PunchProfile.java: EASY_SYM_DUAL.maxCycles
  maxSymCycles: 6, // PunchProfile.java: EASY_SYM_DUAL.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: EASY_SYM_DUAL.fallbackCycles
  send: SEND_DEFAULT, // PunchProfile.java: EASY_SYM_DUAL.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const V100: PunchProfile = Object.freeze({
  name: "V100", // PunchProfile.java: V100.name
  punchTimeoutMs: 8000, // PunchProfile.java: V100.punchTimeoutMs
  firewallDetectCycles: 38, // PunchProfile.java: V100.firewallDetectCycles
  portPredictionMaxRange: 100, // PunchProfile.java: V100.portPredictionMaxRange
  progressiveRanges: [10, 25, 50, 75, 100], // PunchProfile.java: V100.progressiveRanges
  cyclesPerRange: 2, // PunchProfile.java: V100.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: V100.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: V100.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: V100.defaultPortRange
  widePortRange: 50, // PunchProfile.java: V100.widePortRange
  maxPortRange: 100, // PunchProfile.java: V100.maxPortRange
  minPortRange: 3, // PunchProfile.java: V100.minPortRange
  easySymPortRange: 20, // PunchProfile.java: V100.easySymPortRange
  hostMultiSocketCount: 84, // PunchProfile.java: V100.hostMultiSocketCount
  hostMultiMinSocketCount: 20, // PunchProfile.java: V100.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: V100.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: V100.hardSymSocketCount
  birthdaySocketCount: 84, // PunchProfile.java: V100.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: V100.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: V100.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: V100.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: V100.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: V100.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: V100.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: V100.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: V100.socketCreateIntervalMs
  hostRoundTimeoutMs: 8000, // PunchProfile.java: V100.hostRoundTimeoutMs
  reverseWindowSec: 35, // PunchProfile.java: V100.reverseWindowSec
  connectionTimeoutSec: 40, // PunchProfile.java: V100.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 70, // PunchProfile.java: V100.symmetricConnectionTimeoutSec
  punchMaxAttempts: 4, // PunchProfile.java: V100.punchMaxAttempts
  punchRetryDelayMs: 600, // PunchProfile.java: V100.punchRetryDelayMs
  maxCycles: 10, // PunchProfile.java: V100.maxCycles
  maxSymCycles: 8, // PunchProfile.java: V100.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: V100.fallbackCycles
  send: SEND_DEFAULT, // PunchProfile.java: V100.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const FAST_LANE: PunchProfile = Object.freeze({
  name: "FAST_LANE", // PunchProfile.java: FAST_LANE.name
  punchTimeoutMs: 6000, // PunchProfile.java: FAST_LANE.punchTimeoutMs
  firewallDetectCycles: 15, // PunchProfile.java: FAST_LANE.firewallDetectCycles
  portPredictionMaxRange: 20, // PunchProfile.java: FAST_LANE.portPredictionMaxRange
  progressiveRanges: [5, 10, 20], // PunchProfile.java: FAST_LANE.progressiveRanges
  cyclesPerRange: 1, // PunchProfile.java: FAST_LANE.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: FAST_LANE.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: FAST_LANE.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: FAST_LANE.defaultPortRange
  widePortRange: 50, // PunchProfile.java: FAST_LANE.widePortRange
  maxPortRange: 100, // PunchProfile.java: FAST_LANE.maxPortRange
  minPortRange: 3, // PunchProfile.java: FAST_LANE.minPortRange
  easySymPortRange: 20, // PunchProfile.java: FAST_LANE.easySymPortRange
  hostMultiSocketCount: 20, // PunchProfile.java: FAST_LANE.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: FAST_LANE.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: FAST_LANE.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: FAST_LANE.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: FAST_LANE.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: FAST_LANE.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: FAST_LANE.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: FAST_LANE.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: FAST_LANE.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: FAST_LANE.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: FAST_LANE.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: FAST_LANE.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: FAST_LANE.socketCreateIntervalMs
  hostRoundTimeoutMs: 6000, // PunchProfile.java: FAST_LANE.hostRoundTimeoutMs
  reverseWindowSec: 30, // PunchProfile.java: FAST_LANE.reverseWindowSec
  connectionTimeoutSec: 35, // PunchProfile.java: FAST_LANE.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 60, // PunchProfile.java: FAST_LANE.symmetricConnectionTimeoutSec
  punchMaxAttempts: 3, // PunchProfile.java: FAST_LANE.punchMaxAttempts
  punchRetryDelayMs: 800, // PunchProfile.java: FAST_LANE.punchRetryDelayMs
  maxCycles: 8, // PunchProfile.java: FAST_LANE.maxCycles
  maxSymCycles: 6, // PunchProfile.java: FAST_LANE.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: FAST_LANE.fallbackCycles
  send: SEND_SPRINT, // PunchProfile.java: FAST_LANE.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const RELIABLE_CONE: PunchProfile = Object.freeze({
  name: "RELIABLE_CONE", // PunchProfile.java: RELIABLE_CONE.name
  punchTimeoutMs: 15000, // PunchProfile.java: RELIABLE_CONE.punchTimeoutMs
  firewallDetectCycles: 40, // PunchProfile.java: RELIABLE_CONE.firewallDetectCycles
  portPredictionMaxRange: 40, // PunchProfile.java: RELIABLE_CONE.portPredictionMaxRange
  progressiveRanges: [5, 10, 20, 40], // PunchProfile.java: RELIABLE_CONE.progressiveRanges
  cyclesPerRange: 1, // PunchProfile.java: RELIABLE_CONE.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: RELIABLE_CONE.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: RELIABLE_CONE.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: RELIABLE_CONE.defaultPortRange
  widePortRange: 50, // PunchProfile.java: RELIABLE_CONE.widePortRange
  maxPortRange: 100, // PunchProfile.java: RELIABLE_CONE.maxPortRange
  minPortRange: 3, // PunchProfile.java: RELIABLE_CONE.minPortRange
  easySymPortRange: 20, // PunchProfile.java: RELIABLE_CONE.easySymPortRange
  hostMultiSocketCount: 20, // PunchProfile.java: RELIABLE_CONE.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: RELIABLE_CONE.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: RELIABLE_CONE.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: RELIABLE_CONE.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: RELIABLE_CONE.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: RELIABLE_CONE.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: RELIABLE_CONE.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: RELIABLE_CONE.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: RELIABLE_CONE.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: RELIABLE_CONE.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: RELIABLE_CONE.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: RELIABLE_CONE.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: RELIABLE_CONE.socketCreateIntervalMs
  hostRoundTimeoutMs: 10000, // PunchProfile.java: RELIABLE_CONE.hostRoundTimeoutMs
  reverseWindowSec: 40, // PunchProfile.java: RELIABLE_CONE.reverseWindowSec
  connectionTimeoutSec: 50, // PunchProfile.java: RELIABLE_CONE.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 80, // PunchProfile.java: RELIABLE_CONE.symmetricConnectionTimeoutSec
  punchMaxAttempts: 4, // PunchProfile.java: RELIABLE_CONE.punchMaxAttempts
  punchRetryDelayMs: 700, // PunchProfile.java: RELIABLE_CONE.punchRetryDelayMs
  maxCycles: 10, // PunchProfile.java: RELIABLE_CONE.maxCycles
  maxSymCycles: 8, // PunchProfile.java: RELIABLE_CONE.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: RELIABLE_CONE.fallbackCycles
  send: SEND_WEAK, // PunchProfile.java: RELIABLE_CONE.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const WIDE_SWEEP: PunchProfile = Object.freeze({
  name: "WIDE_SWEEP", // PunchProfile.java: WIDE_SWEEP.name
  punchTimeoutMs: 35000, // PunchProfile.java: WIDE_SWEEP.punchTimeoutMs
  firewallDetectCycles: 70, // PunchProfile.java: WIDE_SWEEP.firewallDetectCycles
  portPredictionMaxRange: 800, // PunchProfile.java: WIDE_SWEEP.portPredictionMaxRange
  progressiveRanges: [100, 200, 400, 800], // PunchProfile.java: WIDE_SWEEP.progressiveRanges
  cyclesPerRange: 1, // PunchProfile.java: WIDE_SWEEP.cyclesPerRange
  easySymDualSocketCount: 25, // PunchProfile.java: WIDE_SWEEP.easySymDualSocketCount
  easySymDualPortRange: 20, // PunchProfile.java: WIDE_SWEEP.easySymDualPortRange
  defaultPortRange: 30, // PunchProfile.java: WIDE_SWEEP.defaultPortRange
  widePortRange: 50, // PunchProfile.java: WIDE_SWEEP.widePortRange
  maxPortRange: 800, // PunchProfile.java: WIDE_SWEEP.maxPortRange
  minPortRange: 3, // PunchProfile.java: WIDE_SWEEP.minPortRange
  easySymPortRange: 20, // PunchProfile.java: WIDE_SWEEP.easySymPortRange
  hostMultiSocketCount: 84, // PunchProfile.java: WIDE_SWEEP.hostMultiSocketCount
  hostMultiMinSocketCount: 5, // PunchProfile.java: WIDE_SWEEP.hostMultiMinSocketCount
  hostMultiBaseSocketCount: 3, // PunchProfile.java: WIDE_SWEEP.hostMultiBaseSocketCount
  hardSymSocketCount: 84, // PunchProfile.java: WIDE_SWEEP.hardSymSocketCount
  birthdaySocketCount: 32, // PunchProfile.java: WIDE_SWEEP.birthdaySocketCount
  joinerSymSocketCount: 50, // PunchProfile.java: WIDE_SWEEP.joinerSymSocketCount
  relaySocketCount: 5, // PunchProfile.java: WIDE_SWEEP.relaySocketCount
  joinerMultiPortRange: 30, // PunchProfile.java: WIDE_SWEEP.joinerMultiPortRange
  easySymMutualSocketCount: 25, // PunchProfile.java: WIDE_SWEEP.easySymMutualSocketCount
  easySymMutualRetrySocketCount: 50, // PunchProfile.java: WIDE_SWEEP.easySymMutualRetrySocketCount
  coneBackupPortRange: 10, // PunchProfile.java: WIDE_SWEEP.coneBackupPortRange
  socketStunCount: 2, // PunchProfile.java: WIDE_SWEEP.socketStunCount
  socketCreateIntervalMs: 50, // PunchProfile.java: WIDE_SWEEP.socketCreateIntervalMs
  hostRoundTimeoutMs: 12000, // PunchProfile.java: WIDE_SWEEP.hostRoundTimeoutMs
  reverseWindowSec: 60, // PunchProfile.java: WIDE_SWEEP.reverseWindowSec
  connectionTimeoutSec: 65, // PunchProfile.java: WIDE_SWEEP.connectionTimeoutSec
  symmetricConnectionTimeoutSec: 110, // PunchProfile.java: WIDE_SWEEP.symmetricConnectionTimeoutSec
  punchMaxAttempts: 5, // PunchProfile.java: WIDE_SWEEP.punchMaxAttempts
  punchRetryDelayMs: 500, // PunchProfile.java: WIDE_SWEEP.punchRetryDelayMs
  maxCycles: 12, // PunchProfile.java: WIDE_SWEEP.maxCycles
  maxSymCycles: 10, // PunchProfile.java: WIDE_SWEEP.maxSymCycles
  fallbackCycles: 3, // PunchProfile.java: WIDE_SWEEP.fallbackCycles
  send: SEND_WIDE, // PunchProfile.java: WIDE_SWEEP.send
  sym: RECIPE, // PunchProfile.java: constructor assigns RECIPE
})
export const PROFILES = { DEFAULT, AGGRESSIVE, HARDSYM, EASY_SYM_DUAL, V100, FAST_LANE, RELIABLE_CONE, WIDE_SWEEP } as const
