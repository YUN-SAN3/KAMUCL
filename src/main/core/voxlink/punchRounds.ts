// SPDX-License-Identifier: LGPL-3.0-only
// ConnectionManager.java (924845e): persistent rounds, profile escalation, per-cycle tuner.
import { PROFILES, type PunchProfile } from './punchProfiles'
import { classifyFailure, nextParams, recommendProfile, symmetric, type NatClass, type PunchParams, type PunchResult, type FailureReason } from './punchPolicy'
export const ZERO_RECV_FINAL_ROUND_LIMIT = 20 // ConnectionManager.java: ZERO_RECV_FINAL_ROUND_LIMIT
export const PREDICTION_OFF_CAP = 50 // ConnectionManager.java: PREDICTION_OFF_CAP (not a total round limit)
export const BACKOFF_DELAYS_MS = [1000, 2000, 4000] as const // ConnectionManager.java: BACKOFF_DELAYS_MS
export const PROFILE_SWITCH_COOLDOWN_MS = 20000 // ConnectionManager.java: switchPunchProfile
export class PunchRounds {
  constructor(private log:(message:string)=>void=()=>{}){}
  cycle = 0; round = 0; attempt = 1; receivedEver = false; predictionOffCount = 0
  profile: PunchProfile = PROFILES.DEFAULT
  params: PunchParams | undefined
  local: NatClass = 'UNKNOWN'; remote: NatClass = 'UNKNOWN'; reachable = 0
  private switchedAt = 0; private lastFailure: FailureReason | null = null; private consecutive = 0
  private latestFailure: FailureReason | null = null
  get maxCycles(): number {
    // ConnectionManager.java: getEffectiveMaxCycles.
    return this.reachable ? symmetric(this.local) ? Math.max(2, Math.min(this.reachable, this.profile.maxSymCycles)) : Math.max(1, Math.min(this.reachable, this.profile.maxCycles)) : this.profile.fallbackCycles
  }
  classify(local: NatClass, remote: NatClass, reachable: number): void {
    if (this.local !== local || this.remote !== remote) this.params = undefined
    this.local = local; this.remote = remote; this.reachable = reachable
    if (!this.round) this.switchProfile(recommendProfile(local, remote))
  }
  private switchProfile(next: PunchProfile): void {
    if (next === this.profile) return
    if(this.switchedAt&&Date.now()-this.switchedAt<PROFILE_SWITCH_COOLDOWN_MS){this.log(`模板切换被 20 秒节流：目标 ${next.name}，保留 ${this.profile.name}，剩余 ${PROFILE_SWITCH_COOLDOWN_MS-(Date.now()-this.switchedAt)} ms`);return}
    const differences=Object.fromEntries(Object.entries(next).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(PROFILES.DEFAULT[key as keyof PunchProfile])))
    this.log(`模板切换：${this.profile.name} → ${next.name}；相对 DEFAULT 的全部差异：${JSON.stringify(differences)}`)
    this.profile = next; this.switchedAt = Date.now()
  }
  record(result: PunchResult): FailureReason {
    this.receivedEver ||= result.socketsReceivedPunch > 0 || result.socketsReceivedAck > 0
    const reason = classifyFailure(result)
    if (reason === 'PREDICTION_OFF') this.predictionOffCount++
    this.params = nextParams(this.profile, this.cycle + 1, this.maxCycles, reason, result)
    this.latestFailure = reason
    return reason
  }
  get terminal(): boolean {
    // Source uses session-wide receive evidence, not a resettable timeout budget.
    return !this.receivedEver && (this.round >= ZERO_RECV_FINAL_ROUND_LIMIT || this.predictionOffCount >= PREDICTION_OFF_CAP)
  }
  advance(firewall = false): number {
    // ConnectionManager.java: tryUdpPunch per-attempt retry; exponent is bounded at 4.
    if (!firewall && this.attempt < this.profile.punchMaxAttempts) return this.profile.punchRetryDelayMs * 2 ** Math.min(this.attempt++ - 1, 4)
    this.attempt = 1
    const oldCycle = this.cycle++
    if (this.cycle >= this.maxCycles) {
      this.cycle = 0; this.round++
      if (this.profile !== PROFILES.HARDSYM) this.switchProfile(this.profile === PROFILES.AGGRESSIVE ? PROFILES.HARDSYM : PROFILES.AGGRESSIVE)
      return 0 // ConnectionManager.java: enterContinuousRetryRound immediately starts cycle 0
    }
    // ConnectionManager.java: advanceToNextCycle counts failed cycles, not sockets.
    if (oldCycle === 0 && this.profile === PROFILES.DEFAULT && (symmetric(this.local) || symmetric(this.remote))) this.switchProfile(PROFILES.AGGRESSIVE)
    if (this.latestFailure) {
      if (this.latestFailure === this.lastFailure) this.consecutive++
      else { this.lastFailure = this.latestFailure; this.consecutive = 1 }
      if (this.consecutive >= 3) {
        if (this.latestFailure === 'NO_RESPONSE') this.switchProfile(PROFILES.HARDSYM)
        else if (this.latestFailure !== 'FIREWALL_DETECTED') this.switchProfile(PROFILES.AGGRESSIVE)
        this.consecutive = 0
      }
    }
    return BACKOFF_DELAYS_MS[Math.min(oldCycle, BACKOFF_DELAYS_MS.length - 1)]
  }
}
