import test from 'node:test';
import assert from 'node:assert/strict';
import {NavigationTracker,routeProgress,splitRoute,gpsError,maneuverText} from '../app/static/js/modules/navigationEngine.js';

function fixture() {
  let clock=100000, watchCallback, cleared=[], calls=0, updates=[], positions=[], arrivals=0, routes=0, errors=[];
  const route={distance:1112,duration:600,geometry:{type:'LineString',coordinates:[[32,.3],[32,.31]]},legs:[{steps:[]}]};
  const position=(latitude=.3,longitude=32,accuracy=5)=>({coords:{latitude,longitude,accuracy},timestamp:clock});
  const geo={getCurrentPosition:resolve=>resolve(position()),watchPosition:callback=>{watchCallback=callback;return 7;},clearWatch:id=>cleared.push(id)};
  const tracker=new NavigationTracker({geolocation:geo,config:{max_accuracy_meters:100,arrival_meters:70,deviation_meters:80},now:()=>clock,
    route:async()=>{calls++;return {route};},onRoute:()=>routes++,onPosition:p=>positions.push(p),onUpdate:u=>updates.push(u),onError:e=>errors.push(e),onArrival:()=>arrivals++});
  return {tracker,geo,position,tick:(...args)=>{clock+=11000;watchCallback(position(...args));},stats:()=>({calls,updates,positions,arrivals,cleared,errors,routes}),advance:()=>clock+=21000};
}

test('GPS permission denial produces a useful message and no route request', async()=>{
  const f=fixture(); f.geo.getCurrentPosition=(_,reject)=>reject({code:1});
  await assert.rejects(f.tracker.preview({id:1,latitude:.31,longitude:32}),/permission denied/);
  assert.equal(f.stats().calls,0);
});
test('preview requests GPS once, start watches, movement updates remaining road distance, stop clears GPS',async()=>{
  const f=fixture();await f.tracker.preview({id:1,latitude:.31,longitude:32});
  assert.equal(f.tracker.watch,null);assert.equal(f.stats().calls,1);
  f.tracker.start();f.tick(.305);
  assert.ok(f.stats().updates[0].distance<600);
  f.tick(.3098);f.tick(.3099);
  assert.equal(f.stats().arrivals,1);
  f.tracker.stop();assert.deepEqual(f.stats().cleared,[7]);
  f.tick(.31);assert.equal(f.stats().arrivals,1);
});
test('inaccurate GPS pauses guidance; sustained deviation triggers only a debounced reroute',async()=>{
  const f=fixture();await f.tracker.preview({id:1,latitude:.31,longitude:32});f.tracker.start();
  f.tick(.3,32,500);assert.equal(f.stats().updates.length,0);assert.match(f.stats().errors[0],/inaccurate/);
  f.tick(.305,32.02);f.tick(.305,32.02);f.tick(.305,32.02);
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.stats().calls,2);
});
test('ending navigation prevents a late route response from restarting guidance',async()=>{
  const f=fixture();let resolve;
  f.tracker.route=()=>new Promise(r=>resolve=r);
  const pending=f.tracker.preview({id:1,latitude:.31,longitude:32});
  await Promise.resolve();await Promise.resolve();f.tracker.stop();
  resolve({route:{geometry:{coordinates:[[32,.3],[32,.31]]}}});await pending;
  assert.equal(f.stats().routes,0);assert.equal(f.tracker.currentRoute,null);
});
test('GPS helpers report route progress and maneuver instructions',()=>{
  const p=routeProgress({latitude:.305,longitude:32},[[32,.3],[32,.31]]);
  assert.ok(Math.abs(p.fraction-.5)<.01);assert.ok(p.offRoute<1);
  assert.match(gpsError({code:3}),/timed out/);
  assert.match(maneuverText({name:'Jinja Road',maneuver:{type:'turn',modifier:'left'}}),/left onto Jinja Road/);
});

test('live navigation watches immediately and exposes each moving GPS position',async()=>{
  const f=fixture();
  await f.tracker.preview({id:1,latitude:.31,longitude:32},{live:true});
  assert.equal(f.tracker.watch,7);
  assert.equal(f.stats().positions.length,1);
  f.tick(.302);f.tick(.304);
  assert.equal(f.stats().positions.length,3);
  assert.equal(f.stats().positions.at(-1).position.latitude,.304);
  assert.ok(f.stats().updates.at(-1).distance<f.stats().updates[0].distance);
});

test('route geometry is consumed at the GPS projection without moving the destination',()=>{
  const coords=[[32,.3],[32,.305],[32,.31]];
  const progress=routeProgress({latitude:.307,longitude:32},coords);
  const parts=splitRoute(coords,progress);
  assert.deepEqual(parts.remaining.at(-1),[32,.31]);
  assert.ok(Math.abs(parts.remaining[0][1]-.307)<.000001);
  assert.deepEqual(parts.traveled.at(-1),parts.remaining[0]);
  assert.equal(parts.remaining.length,2);
  assert.deepEqual(coords,[[32,.3],[32,.305],[32,.31]]);
});

test('inaccurate live GPS stays visible without consuming or rerouting the road line',async()=>{
  const f=fixture();
  f.geo.getCurrentPosition=resolve=>resolve(f.position(.3,32,1500));
  await f.tracker.preview({id:1,latitude:.31,longitude:32},{live:true});
  assert.equal(f.tracker.watch,7);assert.equal(f.stats().calls,0);
  assert.equal(f.stats().positions[0].reliable,false);
  f.tick(.301,32,1200);
  assert.equal(f.stats().positions.length,2);assert.equal(f.stats().updates.length,0);
  f.tick(.302,32,5);
  await Promise.resolve();await Promise.resolve();
  assert.equal(f.stats().calls,1);
});

test('a reroute begins at the latest location and consumption continues on its new geometry',async()=>{
  const f=fixture();
  await f.tracker.preview({id:1,latitude:.31,longitude:32},{live:true});
  f.tracker.route=async origin=>({route:{distance:2000,duration:800,legs:[{steps:[]}],
    geometry:{type:'LineString',coordinates:[[origin.longitude,origin.latitude],[32,.31]]}}});
  f.tick(.305,32.02);f.tick(.305,32.02);f.tick(.305,32.02);
  await Promise.resolve();await Promise.resolve();
  const coords=f.tracker.currentRoute.geometry.coordinates;
  assert.deepEqual(coords[0],[32.02,.305]);
  const atStart=splitRoute(coords,routeProgress(f.tracker.position,coords));
  assert.deepEqual(atStart.remaining[0],[32.02,.305]);
  f.tick(.3075,32.01);
  assert.ok(f.stats().updates.at(-1).progress.fraction>.45);
  assert.ok(f.stats().updates.at(-1).distance<1100);
});
