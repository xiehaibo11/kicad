/** @jsxImportSource @opentui/solid */
import { expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import { createSignal } from 'solid-js'
import { SDKProvider } from '../src/context/sdk'
import { useKiCadComposer } from '../src/component/prompt/kicad-composer'

test('review: an attachment added during optimization must survive late completion', async () => {
  const [draft,setDraft]=createSignal('只检查 U1，不要修改。')
  const [parts,setParts]=createSignal<string[]>([])
  let release: (response: Response) => void = () => {}
  let composer!: ReturnType<typeof useKiCadComposer>
  function Harness() {
    composer=useKiCadComposer({draft,busy:()=>false,session:()=> 's1',model:()=> 'test/current',enabled:()=>false,setEnabled:()=>{},blocked:()=>parts().length>0,history:()=>[],
      setDraft:text=>{setDraft(text);setParts([])} })
    return <text>{draft()}</text>
  }
  const app=await testRender(()=><SDKProvider url="http://fixture" fetch={async()=>new Promise<Response>(resolve=>{release=resolve})} events={{subscribe:async()=>()=>{}}}><Harness/></SDKProvider>,{width:80,height:10})
  try {
    const pending=composer.optimize()
    await Bun.sleep(30)
    setParts(['new-attachment.png'])
    await Bun.sleep(30)
    release(Response.json({text:'请只读检查 U1，不做修改。'}))
    await pending
    console.log(JSON.stringify({draft:draft(),remainingAttachments:parts(),lateOptimizationReplacedDraft:draft()!=='只检查 U1，不要修改。'}))
    expect(parts()).toEqual(['new-attachment.png'])
  } finally {app.renderer.destroy()}
})
