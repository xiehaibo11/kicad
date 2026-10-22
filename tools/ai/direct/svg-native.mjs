// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import { bad,number,nm,positive } from './utils.mjs';
import { point,layerEnum } from './board-common.mjs';
// SVG is data, never executed. Unsupported layout/text/effects fail explicitly.
export function svgShapes(p){
  const source=p.svg??fs.readFileSync(p.file,'utf8');if(source.length>4*1024*1024||/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<use\b|<image\b|<text\b|\btransform\s*=|<style\b|\bstyle\s*=/i.test(source))bad('SVG must contain explicit untransformed vector primitives, without scripts, CSS, text or external references');
  const attrs=text=>Object.fromEntries([...text.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],m[2]]));
  const root=/<svg\b([^>]*)>/i.exec(source);if(!root)bad('Missing SVG root');const a=attrs(root[1]);
  const view=a.viewBox?.trim().split(/[\s,]+/).map(Number);if(view&&(view.length!==4||view.some(v=>!Number.isFinite(v))||view[2]<=0||view[3]<=0))bad('Invalid SVG viewBox');
  const length=s=>{if(s===undefined)return undefined;const m=/^([\d.eE+\-]+)(mm|cm|in|px)?$/.exec(s);if(!m)bad('Use explicit SVG physical units');return positive(m[1])*({mm:1,cm:10,in:25.4,px:25.4/96}[m[2]??'px']);};
  const width=p.widthMm??length(a.width),height=length(a.height);let sx=width&&view?positive(width)/view[2]:25.4/96,sy=height&&view?height/view[3]:sx;
  if(p.widthMm!==undefined)sy=sx;const origin=p.position?point(p.position):{xNm:0,yNm:0};
  const pos=(x,y)=>({xNm:Math.round(Number(origin.xNm)+nm((number(x)- (view?.[0]??0))*sx)),yNm:Math.round(Number(origin.yNm)+nm((number(y)-(view?.[1]??0))*sy))});
  const shapes=[],layer=layerEnum(p.layer??'F.SilkS');if(!['BL_F_SilkS','BL_B_SilkS'].includes(layer))bad('Silkscreen import requires F.SilkS or B.SilkS');
  const add=(geometry,at)=>{const stroke=positive(p.widthMmStroke??(at['stroke-width']!==undefined?Number(at['stroke-width'])*sx:0.15));shapes.push({'@type':'kiapi.board.types.BoardGraphicShape',layer,shape:{...geometry,attributes:{stroke:{width:{valueNm:nm(stroke)}},fill:{fillType:'GFT_UNFILLED'}}}});if(shapes.length>10000)bad('SVG primitive limit');};
  for(const tag of source.matchAll(/<([\w:]+)\b([^>]*?)\/?\s*>/g)){
    const type=tag[1],at=attrs(tag[2]);if(['svg','g','title','desc','metadata'].includes(type))continue;
    if(at.fill&&at.fill!=='none')bad('Filled SVG shapes must be converted to outlines before import');
    if(type==='line')add({segment:{start:pos(at.x1??0,at.y1??0),end:pos(at.x2??0,at.y2??0)}},at);
    else if(type==='rect'){
      if(at.rx||at.ry)bad('Rounded SVG rectangles must be converted to paths');add({rectangle:{topLeft:pos(at.x??0,at.y??0),bottomRight:pos(number(at.x,0)+positive(at.width),number(at.y,0)+positive(at.height))}},at);
    }else if(type==='circle'){
      if(Math.abs(sx-sy)>1e-9)bad('Nonuniform SVG circles must be converted to paths');const x=number(at.cx,0),y=number(at.cy,0),r=positive(at.r);add({circle:{center:pos(x,y),radiusPoint:pos(x+r,y)}},at);
    }else if(type==='polyline'||type==='polygon'){
      const points=(at.points??'').trim().split(/[\s,]+/).map(Number);if(points.length<4||points.length%2||points.some(v=>!Number.isFinite(v)))bad('Invalid SVG polygon');const pairs=[];for(let i=0;i<points.length;i+=2)pairs.push(pos(points[i],points[i+1]));if(type==='polygon')pairs.push(pairs[0]);for(let i=1;i<pairs.length;i++)add({segment:{start:pairs[i-1],end:pairs[i]}},at);
    }else if(type==='path'){
      const tokens=(at.d??'').match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[];let i=0,command,x=0,y=0,first=[0,0];
      const read=()=>{const t=tokens[i++];if(t===undefined||/^[A-Za-z]$/.test(t))bad('Invalid SVG path');return number(t);};
      while(i<tokens.length){if(/^[A-Za-z]$/.test(tokens[i]))command=tokens[i++];if(!command)bad('Path command missing');const op=command.toUpperCase(),rel=command!==op,coordinate=()=>{const xx=read(),yy=read();return [xx+(rel?x:0),yy+(rel?y:0)];};
        if(op==='Z'){add({segment:{start:pos(x,y),end:pos(...first)}},at);[x,y]=first;command=undefined;continue;}
        if(op==='M'||op==='L'){const next=coordinate();if(op==='L')add({segment:{start:pos(x,y),end:pos(...next)}},at);else {first=next;command=rel?'l':'L';}[x,y]=next;}
        else if(op==='H'||op==='V'){const v=read();const next=op==='H'?[v+(rel?x:0),y]:[x,v+(rel?y:0)];add({segment:{start:pos(x,y),end:pos(...next)}},at);[x,y]=next;}
        else if(op==='C'){const c1=coordinate(),c2=coordinate(),next=coordinate();add({bezier:{start:pos(x,y),control1:pos(...c1),control2:pos(...c2),end:pos(...next)}},at);[x,y]=next;}
        else bad('Unsupported SVG path command '+command+'; convert to M/L/H/V/C/Z');
      }
    }else bad('Unsupported SVG element '+type);
  }
  if(!shapes.length)bad('SVG contains no vector geometry');return shapes;
}
