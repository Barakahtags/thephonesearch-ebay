const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('external writes remain locked unless master, live mode and capability agree',()=>{
  const keys=['TPS_LIVE_MASTER','SYNC_MODE','TPS_LIVE_LISTINGS'];
  const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    for(const key of keys)delete process.env[key];
    delete require.cache[require.resolve('../api/_lib/live-control')];
    const control=require('../api/_lib/live-control');
    assert.equal(control.snapshot().mode,'SAFE');
    assert.throws(()=>control.assertCapability('listingWrites'),/No external write was performed/);

    process.env.TPS_LIVE_LISTINGS='true';
    assert.equal(control.snapshot().capabilities.listingWrites.enabled,false);

    process.env.TPS_LIVE_MASTER='true';
    process.env.SYNC_MODE='live';
    assert.equal(control.snapshot().capabilities.listingWrites.enabled,true);
  }finally{
    for(const key of keys){
      if(original[key]===undefined)delete process.env[key];
      else process.env[key]=original[key];
    }
  }
});

test('readiness does not call safe preview a full launch',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','api','launch-readiness.js'),'utf8');
  assert.match(source,/readyForSafePreview=blockers\.length===0&&syncMode!=='live'&&!publish/);
  assert.match(source,/readyForFullDELaunch=blockers\.length===0&&syncMode==='live'&&publish/);
});
