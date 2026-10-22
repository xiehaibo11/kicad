<template>
  <Teleport to="body">
    <div v-if="image" class="image-preview" role="dialog" aria-modal="true" :aria-label="'图片预览：'+image.name" @click.self="closeImagePreview">
      <div class="image-preview-bar">
        <span class="image-preview-name" :title="image.name">{{ image.name }}</span>
        <span v-if="details" class="image-preview-meta">{{ details }}</span>
        <button class="image-preview-button" :title="zoomed?'适应窗口':'原始大小'" :aria-label="zoomed?'适应窗口':'原始大小'" @click="zoomed=!zoomed">
          <span class="codicon" :class="zoomed?'codicon-screen-normal':'codicon-screen-full'" aria-hidden="true" />
        </button>
        <button ref="closeButton" class="image-preview-button" title="关闭（Esc）" aria-label="关闭预览" @click="closeImagePreview">
          <span class="codicon codicon-close" aria-hidden="true" />
        </button>
      </div>
      <div class="image-preview-stage" :class="{zoomed}" @click.self="closeImagePreview">
        <img :src="image.src" :alt="image.name" class="image-preview-img" @load="measure" @click="zoomed=!zoomed" />
      </div>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {previewImage,closeImagePreview} from '../utils/imagePreview';
import {formatFileSize} from '../types/attachment';
const image=previewImage,zoomed=ref(false),size=ref(''),closeButton=ref<HTMLButtonElement>();
let returnFocus:HTMLElement|null=null;
const details=computed(()=>[size.value,image.value?.size?formatFileSize(image.value.size):''].filter(Boolean).join(' · '));
function measure(event:Event){const img=event.target as HTMLImageElement;size.value=img.naturalWidth+' × '+img.naturalHeight;}
function onKey(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeImagePreview();}}
watch(image,async(value,old)=>{
  if(value&&!old){returnFocus=document.activeElement as HTMLElement|null;window.addEventListener('keydown',onKey,true);}
  if(!value&&old){window.removeEventListener('keydown',onKey,true);returnFocus?.focus?.({preventScroll:true});returnFocus=null;}
  zoomed.value=false;size.value='';
  if(value){await nextTick();closeButton.value?.focus();}
});
onBeforeUnmount(()=>window.removeEventListener('keydown',onKey,true));
</script>
<style scoped>
.image-preview{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;background:rgba(0,0,0,.9);}
.image-preview-bar{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 16px;color:#e8e8e8;font-size:12px;flex:none;}
.image-preview-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
.image-preview-meta{flex:none;color:#b0b0b0;}
.image-preview-button{margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:0;border-radius:4px;background:transparent;color:#e8e8e8;cursor:pointer;flex:none;}
.image-preview-button+.image-preview-button{margin-left:0;}
.image-preview-button:hover{background:rgba(255,255,255,.12);}
.image-preview-button:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);}
.image-preview-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 16px 16px;overflow:hidden;}
.image-preview-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;box-shadow:0 6px 24px rgba(0,0,0,.5);cursor:zoom-in;background:#fff1;}
.image-preview-stage.zoomed{overflow:auto;align-items:flex-start;justify-content:flex-start;}
.image-preview-stage.zoomed .image-preview-img{max-width:none;max-height:none;cursor:zoom-out;}
</style>
