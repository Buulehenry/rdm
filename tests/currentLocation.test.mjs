import test from 'node:test';
import assert from 'node:assert/strict';
import {readCurrentLocation} from '../app/static/js/modules/currentLocation.js';

test('planning gets a fresh single location, preserving coordinates and accuracy',async()=>{
  let calls=0;
  const result=await readCurrentLocation({getCurrentPosition(resolve,reject,options){
    calls++;
    assert.equal(options.maximumAge,0);
    assert.equal(options.enableHighAccuracy,true);
    resolve({coords:{latitude:.351234,longitude:32.612345,accuracy:1200}});
  }});
  assert.equal(calls,1);
  assert.deepEqual(result,{latitude:.351234,longitude:32.612345,accuracy:1200});
});
test('permission denial, timeout and unavailable location give actionable errors',async()=>{
  await assert.rejects(readCurrentLocation(null),/unavailable/);
  for(const [code,expected] of [[1,/permission denied/],[3,/timed out/],[2,/unavailable/]]) {
    await assert.rejects(readCurrentLocation({getCurrentPosition(resolve,reject){reject({code});}}),expected);
  }
});
test('invalid coordinates never become a planning starting point',async()=>{
  for(const bad of [NaN,Infinity,91]) {
    await assert.rejects(readCurrentLocation({getCurrentPosition(resolve){
      resolve({coords:{latitude:bad,longitude:32,accuracy:5}});
    }}),/invalid location/);
  }
});
