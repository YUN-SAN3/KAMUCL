// SPDX-License-Identifier: LGPL-3.0-only
// NatLabels.java, VoxLink c475faa9. Display names never determine the punch strategy.
export const NAT_RAW_LABELS:Record<string,string>={unknown:'未知',full_cone:'完全锥形 NAT',restricted_cone:'受限锥形 NAT',port_restricted_cone:'端口受限锥形 NAT',symmetric_easy_inc:'易打洞对称 NAT（端口递增）',symmetric_easy_dec:'易打洞对称 NAT（端口递减）',symmetric:'对称 NAT',open:'开放',moderate:'中等限制',strict:'严格限制'}
export const NAT_CLASS_LABELS:Record<string,string>={CONE:'锥形 NAT',EASY_SYM:'易打洞对称 NAT',HARD_SYM:'困难对称 NAT',UNKNOWN:'未知'}
export const natLabel=(natClass:string|undefined,raw:unknown):string=>natClass&&natClass!=='UNKNOWN'?NAT_CLASS_LABELS[natClass]??'未知':NAT_RAW_LABELS[typeof raw==='string'?raw.trim().toLowerCase():'unknown']??'未知'
