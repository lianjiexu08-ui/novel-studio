// Freeze a fresh tested runtime, including the chunked historical repository.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const runtimePath=path.resolve('data/audit-runtimes/design76-runtime'),bindingPath='data/audit-runtimes/design76-runtime-bound.json';
assert.ok(!fs.existsSync(runtimePath)&&!fs.existsSync(bindingPath),'Never replace a frozen runtime');
const status=execFileSync('git',['status','--porcelain','--','packages','novel-service-core','apps/api','package.json','package-lock.json'],{encoding:'utf8'}).trim();assert.equal(status,'','Commit tested runtime source before freezing');
const names=execFileSync('git',['ls-files','-z','--','packages','novel-service-core','apps/api','package.json','package-lock.json'],{encoding:'utf8'}).split('\0').filter(Boolean);
assert.ok(names.includes('packages/persistence/src/project-history.ts'));
const sourceHashes={};for(const name of names){const target=path.join(runtimePath,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(name,target);sourceHashes[name]=fileHash(target);}
fs.mkdirSync(path.join(runtimePath,'node_modules'));
for(const name of fs.readdirSync('node_modules')){const source=fs.realpathSync(path.resolve('node_modules',name));const local=path.join(runtimePath,path.relative(process.cwd(),source));fs.symlinkSync(fs.existsSync(path.join(local,'package.json'))?local:source,path.join(runtimePath,'node_modules',name));}
const dependencyHashes=Object.fromEntries(['node_modules/.prisma/client/index.js','node_modules/.prisma/client/schema.prisma','node_modules/@prisma/client/package.json'].map(name=>[path.resolve(name),fileHash(name)]));
const binding={runtimePath,frozenAt:new Date().toISOString(),scheduleVersion:34,rubricVersion:17,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nodeVersion:process.version,sourceHashes,dependencyHashes};
fs.writeFileSync(bindingPath,JSON.stringify(binding,null,2)+'\n',{flag:'wx',flush:true});
console.log(JSON.stringify({runtimePath,sourceFiles:names.length,scheduleVersion:34,productionWrites:0}));
