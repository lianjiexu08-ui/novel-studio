import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const candidate = read('data/design-candidates/design76-followup-controls-v7.json');
const original = read('data/design-candidates/design76-identity-v1.json');
const source = candidate.storyBible.arcBeats.find(x => x.id === 'message-north-report');
assert.deepEqual(source, original.storyBible.arcBeats.find(x => x.id === source.id));
assert.ok(source.expectedChange.includes('程301离葬骨、306极焱、310天宝、312–314海程到云梦、318乾都'));
const path = 'data/audit-runtimes/design76-followup-v6-integrated/model-calls/00002.started.json';
const request = JSON.parse(read(path).request.user);
const sent = request.sources.find(s => s.id === 'story/arcBeats/message-north-report');
const fragment = sent.fragments.find(f => f.text.includes('程301离葬骨、306极焱、310天宝、312–314海程到云梦、318乾都'));
assert.ok(fragment);
const worlds = ['design76-followup-v6-integrated','design76-followup-v7-targeted'].map(name => read(`data/audit-runtimes/${name}/world-input.json`));
assert.ok(worlds.every(input => !input.sources.some(s => s.id === sent.id)));
const result = {verified:true,sourceId:sent.id,source,sourceSha256:hash(source),unchangedFromFormalDesign76:true,
  existingCharacterRequest:path,requestId:request.requestId,fragmentId:fragment.id,omittedFromBothWorldRequests:true,
  correction:'人工先前只查卷级里程碑，误把没有在所查材料中定位到路线说成设计缺少跨海承接。完整人物线已有301—318两段海路与陆路锚点；不能据此新增一套替代航程，也不能将318夜收到回执当成程318面报的证据。原模型回答与两次局部评审范围均保留。',
  limitation:'This proves the existing route and corrects an unsupported omission claim. It does not certify later chapter execution or resolve every travel/permission question.',
  modelCalls:0,productionWrites:0,formalAcceptance:false};
fs.writeFileSync('docs/audits/2026-10-18-design76-return-route-scope.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceId:sent.id,existingRoutePreserved:true,newTravelInvented:false}));
