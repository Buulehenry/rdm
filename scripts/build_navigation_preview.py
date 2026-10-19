"""Build an isolated browser replay using synthetic GPS and real private OSRM roads."""
import json
import shutil
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
from app import create_app


def main():
    app=create_app()
    router=app.extensions['osrm']
    end=dict(latitude=.3547,longitude=32.6138)
    route=router.route([dict(latitude=.3476,longitude=32.5825),end])
    detour=router.route([dict(latitude=.369,longitude=32.58),end])
    root=Path('artifacts/live-navigation-test')
    (root/'modules').mkdir(parents=True,exist_ok=True)
    for name in ('navigationControl.js','navigationEngine.js','journeyApi.js'):
        shutil.copyfile(Path('app/static/js/modules')/name,root/'modules'/name)
    shutil.copyfile('app/static/css/styles.css',root/'styles.css')
    (root/'routes.json').write_text(json.dumps(dict(route=route,detour=detour,end=end)),encoding='utf-8')
    (root/'index.html').write_text('''<!doctype html><html><head><meta charset="utf-8"><title>Navigation validation — synthetic GPS</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.3/dist/leaflet.css"><link rel="stylesheet" href="styles.css">
<style>.test-controls{position:absolute;top:12px;left:12px;z-index:2000;background:white;padding:12px;border-radius:10px;font:14px system-ui}.test-controls button{padding:10px}#map{position:absolute;inset:0}#main-content{position:absolute;inset:0}</style></head>
<body><main id="main-content"><div id="map"></div><div class="test-controls"><strong>SYNTHETIC GPS · UI validation only</strong><p id="stats">Ready</p><button id="begin">Start replay</button><button id="advance">Advance along road</button><button id="detour">Simulate detour</button></div></main>
<script src="https://unpkg.com/leaflet@1.9.3/dist/leaflet.js"></script><script type="module">
import {createNavigation} from './modules/navigationControl.js';
const fixtures=await (await fetch('routes.json')).json();
const map=L.map('map',{center:[.35,32.59],zoom:15});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);
let index=0,mode='route',watch,timer,requests=0,updates=0,waiting=false;
function position(){const c=fixtures[mode].geometry.coordinates[Math.min(index,fixtures[mode].geometry.coordinates.length-1)];return {coords:{longitude:c[0],latitude:c[1],accuracy:5,heading:70},timestamp:Date.now()};}
function emit(){updates++;watch?.(position());document.getElementById('stats').textContent=`Road routes: ${requests} · GPS updates: ${updates} · ${mode}`;}
const geo={getCurrentPosition:resolve=>resolve(position()),watchPosition:callback=>{watch=callback;timer=setInterval(()=>{if(!waiting)index++;emit();},1100);return 1;},clearWatch:()=>{clearInterval(timer);watch=null;}};
const navigation=createNavigation(map,{geolocation:geo,configuration:async()=>({arrival_meters:30,deviation_meters:80,max_accuracy_meters:100}),calculateRoute:async()=>{
requests++;if(waiting){waiting=false;index=0;mode='detour';}return {route:fixtures[mode]};}});
document.getElementById('begin').onclick=()=>navigation.navigate({...fixtures.end,id:999,name:'Synthetic destination — Kampala road replay'});
document.getElementById('advance').onclick=()=>{index=Math.floor(fixtures[mode].geometry.coordinates.length*.6);emit();};
document.getElementById('detour').onclick=()=>{mode='detour';index=0;waiting=true;emit();};
</script></body></html>''',encoding='utf-8')
    print('Preview generated in',root)


if __name__=='__main__':
    main()
