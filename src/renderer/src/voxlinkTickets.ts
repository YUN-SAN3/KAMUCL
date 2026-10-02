import { computed, ref } from 'vue'
import type { VoxTicket,TicketResult } from '@shared/voxlinkTickets'
export const ticketSummaries=ref<VoxTicket[]>([])
export const unreadTickets=computed(()=>ticketSummaries.value.filter(t=>t.hasUnread&&!t.deleted).length)
export async function loadTickets(){ticketSummaries.value=await window.kamucl.invoke('voxlink:tickets:list') as VoxTicket[]}
let polled=false
export async function pollTickets(){if(polled)return;polled=true;try{const result=await window.kamucl.invoke('voxlink:tickets:poll',{operation:crypto.randomUUID()}) as TicketResult<VoxTicket[]>;if(result.ok)ticketSummaries.value=result.value;else await loadTickets()}catch{}}
