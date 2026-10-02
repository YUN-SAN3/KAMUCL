export interface VoxTicket { id:string;timeMs:number;deleted:boolean;hasUnread:boolean;replyCount:number;lastTimeMs:number }
export interface VoxTicketAttachment { name:string;size:number }
export interface VoxTicketMessage { id?:string;from:string;timeMs:number;text:string;attachments:VoxTicketAttachment[] }
export interface VoxTicketDetail { id:string;timeMs:number;deleted:boolean;description:string;attachments:VoxTicketAttachment[];messages:VoxTicketMessage[] }
export interface TicketFileGrant extends VoxTicketAttachment { id:string }
export type TicketResult<T>={ok:true;value:T}|{ok:false;code:string;message:string;retryAt?:number}
export const TICKET_DESCRIPTION_MAX=10000,TICKET_MESSAGE_MAX=2000,TICKET_MESSAGE_COUNT_MAX=200,TICKET_FILES_MAX=10,TICKET_BYTES_MAX=500*1024*1024
