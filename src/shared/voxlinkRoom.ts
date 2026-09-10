/** 房间标题与客户端来源标识分开；两端共用默认名称及输入约束。 */
export const DEFAULT_VOXLINK_ROOM_NAME = '我的世界联机'
export const VOXLINK_ROOM_NAME_MAX = 32

export function normalizeVoxlinkRoomName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('请输入房间名')
  if (name.length > VOXLINK_ROOM_NAME_MAX) throw new Error('房间名不能超过 32 个字符')
  return name
}

export function isVoxlinkContentBlocked(error: unknown): boolean {
  return (error as { code?: string })?.code === 'CONTENT_BLOCKED' ||
    /\bCONTENT_BLOCKED\b/.test(error instanceof Error ? error.message : String(error))
}

export const VOXLINK_ROOM_BLOCKED_MESSAGE = '房间信息未通过 VoxLink 服务端审核，请修改房间名后重试。若普通名称仍被拒绝，请联系 VoxLink 服务方核查。'
