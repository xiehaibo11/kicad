import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2],file=path.join(root,'packages/core/src/ripgrep.ts');
const before='const MAX_RECORD_BYTES = 64 * 1024',after='const MAX_RECORD_BYTES = 8 * 1024 * 1024 // KiCad: compact JSON reports can exceed 64 KiB; returned previews remain bounded.';
const s=fs.readFileSync(file,'utf8');if(!s.includes(after)){if(s.split(before).length!==2)throw Error('Ripgrep record-limit anchor changed');fs.writeFileSync(file,s.replace(before,after));}
const test=path.join(root,'packages/core/test/ripgrep.test.ts'),source=fs.readFileSync(test,'utf8');
const anchor='  it.live("does not split surrogate pairs in oversized line previews", () =>';
const regression=`  it.live("searches compact KiCad JSON reports larger than 64 KiB", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "report.json"), JSON.stringify({note:"x".repeat(200000),result:"needle"})))
        const matches = yield* (yield* Ripgrep.Service).grep({cwd:tmp.path,pattern:"needle",limit:10})
        expect(matches.length).toBe(1)
        expect(matches[0]?.text.length).toBeLessThan(3000)
      }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
`;
if(!source.includes('searches compact KiCad JSON')){if(!source.includes(anchor))throw Error('Ripgrep test anchor changed');fs.writeFileSync(test,source.replace(anchor,regression+anchor));}
