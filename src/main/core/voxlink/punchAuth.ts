// Wire-compatible port of AUGUHDAR/VoxLink PunchAuth.java (LGPL-3.0), revision 6b11d93.
// SPDX-License-Identifier: LGPL-3.0-only
// Original authors: AUGUHDAR / VoxLink contributors. TypeScript modifications: KAMUCL contributors.
// See THIRD_PARTY_NOTICES.md and licenses/LGPL-3.0.txt; root MIT does not apply to this adaptation.
import crypto from 'node:crypto'
export function derivePunchKey(code: string, clientId: string): Buffer | null {
  return code && clientId ? crypto.createHash('sha256').update('VOXLINK-PUNCH-AUTH-V1').update(code).update(Buffer.from([0])).update(clientId).digest() : null
}
export function signPunchFrame(frame: Buffer, key?: Buffer | null): Buffer {
  return key ? Buffer.concat([frame, crypto.createHmac('sha256', key).update(frame.subarray(2)).digest().subarray(0,4)]) : frame
}
export function verifyPunchFrame(frame: Buffer, key?: Buffer | null): Buffer | null {
  if (!key) return frame
  if (frame.length < 9) return null
  const body = frame.subarray(0,-4)
  const tag = crypto.createHmac('sha256', key).update(body.subarray(2)).digest().subarray(0,4)
  return crypto.timingSafeEqual(tag, frame.subarray(-4)) ? body : null
}
