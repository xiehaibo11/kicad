import {ref} from 'vue';

// One preview for the whole chat: composer chips, sent messages and image blocks open it.
export interface PreviewImage {src:string;name:string;size?:number}
export const previewImage=ref<PreviewImage|undefined>();
export function openImagePreview(image:PreviewImage|undefined){if(image?.src)previewImage.value=image;}
export function closeImagePreview(){previewImage.value=undefined;}
/** Attachments keep their bytes in base64, so images preview without the extension host. */
export function attachmentPreview(attachment:{fileName:string;mediaType?:string;data?:string;fileSize?:number}):PreviewImage|undefined{
  if(!attachment?.data||!String(attachment.mediaType||'').toLowerCase().startsWith('image/'))return undefined;
  return {src:`data:${attachment.mediaType};base64,${attachment.data}`,name:attachment.fileName,size:attachment.fileSize||undefined};
}
