import {journeyApi,journeyConfig} from './journeyApi.js';
import {NavigationTracker,maneuverText,routeProgress,splitRoute} from './navigationEngine.js';

export const formatDistance = n => n<1000 ? `${Math.round(n)} m` : `${(n/1000).toFixed(1)} km`;
export const formatDuration = n => `${Math.floor(n/3600)}h ${Math.ceil(n%3600/60)}m`;
export function createNavigation(map,{
  geolocation=navigator.geolocation,
  configuration=journeyConfig,
  calculateRoute=(origin,station_id,target)=>journeyApi('/route','POST',station_id?{origin,station_id}:{origin,destination:{latitude:target.latitude,longitude:target.longitude}})
}={}) {
  const panel=document.createElement('section');
  panel.className='navigation-panel'; panel.hidden=true; panel.setAttribute('aria-label','GPS navigation');
  panel.innerHTML=`<div class="journey-heading"><strong class="nav-title">Navigation</strong><button type="button" class="nav-stop">End</button></div>
    <div class="nav-metrics"></div><p class="nav-maneuver"></p>
    <div class="nav-origin">From your live GPS location → next destination</div>
    <label class="nav-pin-control">Station pins <select aria-label="Map station pins"><option value="journey">Journey stops only</option><option value="hidden">Hide all station pins</option><option value="all">All stations</option></select></label>
    <div class="journey-buttons"><button type="button" class="nav-start">Retry GPS</button><button type="button" class="nav-center" aria-pressed="true">Following you</button><button type="button" class="nav-visits">Journey / visits</button></div>
    <details><summary>Driving instructions</summary><ol class="nav-steps"></ol></details>
    <p class="nav-status" role="status"></p><small>Estimates only · GPS and road data may be inaccurate · No live traffic</small>`;
  document.getElementById('main-content').appendChild(panel);
  L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
  let tracker, routeLayer, traveledLayer, gpsMarker, accuracyCircle, targetMarker, generation=0, stepPositions=[], routeCoordinates=[], follow=true, destinationNow, pinIds=[], pinContext=null;
  if(!map.getPane('gpsLocation')) map.createPane('gpsLocation').style.zIndex=680;
  const status=panel.querySelector('.nav-status');
  const start=panel.querySelector('.nav-start');
  function removeLayers() {
    [routeLayer,traveledLayer,gpsMarker,accuracyCircle,targetMarker].forEach(layer=>{if(layer) map.removeLayer(layer);});
    routeLayer=traveledLayer=gpsMarker=accuracyCircle=targetMarker=null; routeCoordinates=[];
  }
  function stop() {
    generation++; tracker?.stop(); removeLayers(); panel.hidden=true;
    document.body.classList.remove('navigating');
  }
  function updateGPS(point,accuracy,heading) {
    const latlng=[point.latitude,point.longitude];
    if(!gpsMarker) gpsMarker=L.marker(latlng,{pane:'gpsLocation',title:'Your current GPS location',
      icon:L.divIcon({className:'gps-location',html:'<span class="gps-location-dot"><span class="gps-heading"></span></span>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(map);
    else gpsMarker.setLatLng(latlng);
    const arrow=gpsMarker.getElement()?.querySelector('.gps-heading');
    if(arrow) {arrow.hidden=!Number.isFinite(heading);if(Number.isFinite(heading)) arrow.style.transform=`rotate(${heading}deg)`;}
    if(!accuracyCircle) accuracyCircle=L.circle(latlng,{radius:accuracy,weight:1,color:'#1479dc',fillOpacity:.08}).addTo(map);
    else accuracyCircle.setLatLng(latlng).setRadius(accuracy);
    if(follow) {
      if(map.getZoom()<15) map.setView(latlng,16,{animate:false});
      else map.panTo(latlng,{animate:true,duration:.7});
    }
  }
  function drawProgress(progress) {
    const parts=splitRoute(routeCoordinates,progress);
    const latlngs=coordinates=>coordinates.map(([lng,lat])=>[lat,lng]);
    traveledLayer?.setLatLngs(latlngs(parts.traveled));
    routeLayer?.setLatLngs(latlngs(parts.remaining));
  }
  function setFollowing(enabled) {
    follow=enabled;
    panel.querySelector('.nav-center').textContent=enabled?'Following you':'Follow me';
    panel.querySelector('.nav-center').setAttribute('aria-pressed',String(enabled));
  }
  function metrics(distance,duration) {
    const eta=new Date(Date.now()+duration*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    panel.querySelector('.nav-metrics').textContent=`${formatDistance(Math.max(0,distance))} · ${formatDuration(Math.max(0,duration))} · ETA ~${eta}`;
  }
  async function navigate(destination,{journeyStops=[],journeyId=null}={}) {
    stop(); map.fire('snapshot:stop'); map.fire('journey:hide');
    pinIds=journeyStops.length?journeyStops.map(s=>s.station_id):destination.id?[destination.id]:[];
    pinContext=journeyId??('station:'+destination.id);
    const previous=map._rendererRef?.getStationVisibility?.();
    const mode=previous?.contextId===pinContext?previous.mode:'journey';
    panel.querySelector('.nav-pin-control select').value=mode;
    map._rendererRef?.setStationVisibility?.(mode,pinIds,pinContext);
    destinationNow=destination; setFollowing(true);
    panel.hidden=false; start.hidden=true; start.disabled=true;
    document.body.classList.add('navigating');
    panel.querySelector('.nav-title').textContent=destination.name;
    panel.querySelector('.nav-metrics').textContent='';
    panel.querySelector('.nav-maneuver').textContent='';
    panel.querySelector('.nav-steps').replaceChildren();
    status.textContent='Requesting your current GPS location…';
    const token=generation;
    try {
      const config=await configuration();
      if(token!==generation) return;
      tracker=new NavigationTracker({geolocation,config,
        route:calculateRoute,
        onError:message=>{status.textContent=message; if(tracker.watch===null) {start.hidden=false;start.disabled=false;}},
        onPosition:state=>updateGPS(state.position,state.accuracy,state.heading),
        onArrival:()=>{
          status.textContent='You appear to be near the destination. Confirm arrival in your journey; GPS does not complete visits.';
          map.fire('navigation:arrival',{stationId:destination.id});
        },
        onRoute:(result,point,accuracy)=>{
          if(routeLayer) map.removeLayer(routeLayer);
          if(traveledLayer) map.removeLayer(traveledLayer);
          routeCoordinates=result.route.geometry.coordinates;
          traveledLayer=L.polyline([],{color:'#74847b',weight:4,opacity:.35,dashArray:'3 8',interactive:false}).addTo(map);
          routeLayer=L.polyline(routeCoordinates.map(([lng,lat])=>[lat,lng]),{color:'#087b40',weight:7,opacity:.95,interactive:false}).addTo(map);
          if(!targetMarker) targetMarker=L.circleMarker([destination.latitude,destination.longitude],{radius:15,color:'#e78a12',weight:4,fillOpacity:0});
          if(panel.querySelector('.nav-pin-control select').value!=='hidden'&&!map.hasLayer(targetMarker)) targetMarker.addTo(map);
          const progress=routeProgress(point,routeCoordinates);
          if(progress?.offRoute<=Math.max(config.deviation_meters,accuracy*1.5)) drawProgress(progress);
          metrics(result.route.distance,result.route.duration);
          const list=panel.querySelector('.nav-steps'); list.replaceChildren(); stepPositions=[];
          const steps=result.route.legs.flatMap(leg=>leg.steps||[]);
          steps.forEach(step=>{
            const li=document.createElement('li'); li.textContent=`${maneuverText(step)} · ${formatDistance(step.distance)}`; list.appendChild(li);
            const loc=step.maneuver?.location;
            if(loc) stepPositions.push({step, fraction:routeProgress({latitude:loc[1],longitude:loc[0]},result.route.geometry.coordinates)?.fraction||0});
          });
          panel.querySelector('.nav-maneuver').textContent=maneuverText(steps[0]);
          status.textContent='Live navigation · green is the remaining route; the traveled section fades behind you.';
        },
        onUpdate:state=>{
          metrics(state.distance,state.duration);
          if(!state.offRoute) drawProgress(state.progress);
          if(state.offRoute) panel.querySelector('.nav-metrics').textContent='Route may be outdated · checking GPS';
          const next=stepPositions.find(s=>s.fraction>state.progress.fraction+.0005);
          panel.querySelector('.nav-maneuver').textContent=maneuverText(next?.step||{maneuver:{type:'arrive'}});
          status.textContent=state.offRoute ? 'You may be off route. Checking before recalculating…' : `GPS accuracy ~${Math.round(state.accuracy)} m. Follow road signs and local conditions.`;
        }});
      await tracker.preview(destination,{live:true});
      if(token!==generation) return;
      start.disabled=false; start.hidden=tracker.watch!==null;
    } catch(error) {if(token===generation) {status.textContent=error.message;start.hidden=tracker?.watch!=null;start.disabled=false;}}
  }
  start.onclick=()=>{if(destinationNow) navigate(destinationNow,{journeyStops:pinIds.map(station_id=>({station_id})),journeyId:pinContext});};
  panel.querySelector('.nav-stop').onclick=stop;
  panel.querySelector('.nav-visits').onclick=()=>map.fire('journey:open');
  panel.querySelector('.nav-center').onclick=()=>{
    setFollowing(true);
    if(tracker?.position) map.setView([tracker.position.latitude,tracker.position.longitude],16);
  };
  map.on('dragstart',()=>{if(!panel.hidden) setFollowing(false);});
  panel.querySelector('.nav-pin-control select').onchange=event=>map._rendererRef?.setStationVisibility?.(event.target.value,pinIds,pinContext);
  map.on('stationpins:changed',event=>{
    if(!panel.hidden) panel.querySelector('.nav-pin-control select').value=event.mode;
    if(targetMarker) {
      if(event.mode==='hidden') map.removeLayer(targetMarker);
      else if(!map.hasLayer(targetMarker)) targetMarker.addTo(map);
    }
  });
  map.on('snapshot:start',stop);
  window.addEventListener('pagehide',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden) stop();});
  return {navigate,stop};
}
