import {journeyApi,journeyConfig} from './journeyApi.js';
import {formatDistance,formatDuration} from './navigationControl.js';
import {setEditMode,setDeleteMode} from './modes.js';
import {readCurrentLocation} from './currentLocation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => value ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : '—';
const isoDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function createJourneyPlanner(map, renderer, navigation) {
  const panel=document.createElement('section'); panel.className='journey-panel'; panel.hidden=true;
  panel.setAttribute('aria-label','Journey Planner');
  panel.innerHTML=`<div class="journey-heading"><div><small>RDM FIELD OPERATIONS</small><h2>Journey Planner</h2></div><button type="button" id="jp-close" aria-label="Close Journey Planner">×</button></div>
  <div class="journey-tabs"><button type="button" data-tab="plan">Plan a journey</button><button type="button" data-tab="history">Saved journeys</button></div>
  <p id="jp-message" role="status"></p>
  <div id="jp-plan">
    <form id="jp-form">
      <label>Journey name<input name="name" maxlength="160" value="Territory visits" required></label>
      <div class="journey-grid"><label>Journey date<input name="journey_date" type="date" required></label><label>Assigned user<select name="assigned_user_id"></select></label></div>
      <div class="journey-grid"><label>Departure (Uganda)<input name="departure_time" type="time" value="08:00" required></label><label>Finish by (Uganda)<input name="working_end" type="time" value="17:00" required></label></div>
      <label>Starting location<select name="start_mode"><option value="gps">Current GPS location</option><option value="manual">Enter coordinates</option><option value="base">Saved office / base</option><option value="map">Choose on map</option></select></label>
      <div class="journey-buttons"><button type="button" id="jp-locate">Set starting location</button><button type="button" id="jp-savebase">Save as my base</button></div>
      <div class="journey-grid"><label>Start latitude<input name="start_lat" type="number" step="any" min="-90" max="90" required readonly placeholder="Waiting for location…"></label><label>Start longitude<input name="start_lng" type="number" step="any" min="-180" max="180" required readonly placeholder="Waiting for location…"></label></div>
      <p id="jp-location-status" class="journey-help" role="status"></p>
      <label>End journey<select name="end_mode"><option value="none">At the last station</option><option value="return">Return to starting point</option><option value="custom">Separate ending point</option></select></label>
      <div class="journey-grid" id="jp-end" hidden><label>End latitude<input name="end_lat" type="number" step="any" min="-90" max="90"></label><label>End longitude<input name="end_lng" type="number" step="any" min="-180" max="180"></label></div>
      <label class="journey-check"><input name="optimize" type="checkbox" checked> Suggest a visiting order</label>
      <details open><summary>Select stations & prospects</summary>
        <label>Search stations<input id="jp-search" type="search" placeholder="Station name…"></label>
        <div class="journey-grid"><label>Territory / region<select id="jp-territory"><option value="">All</option></select></label><label>District<select id="jp-district"><option value="">All</option></select></label></div>
        <div class="journey-grid"><label>Category<select id="jp-category"><option value="">All</option><option value="rubis">Own stations</option><option value="competitor">Competitors</option><option value="target">Prospects / targets</option></select></label><label>Visit records<select id="jp-visit"><option value="">All</option><option value="visited">Recorded visits</option><option value="no_recorded_visit">No recorded visit</option></select></label></div>
        <div class="journey-buttons"><button type="button" id="jp-mapselect" aria-pressed="false">Select stops on map</button></div>
        <div id="jp-stations" class="journey-station-list"></div>
      </details>
      <h3>Selected stops <span id="jp-count">0 / 20</span></h3>
      <p class="journey-help">Use ↑ / ↓ for fixed order. Required stops stay in generated plans; priority is a manual planning input.</p>
      <ol id="jp-stops" class="journey-stop-list"></ol>
      <details><summary>Generate a feasible journey</summary>
        <div class="journey-grid"><label>Maximum stops<input name="max_stops" type="number" min="1" max="20" value="8"></label><label>Default visit minutes<input name="visit_minutes" type="number" min="1" max="480" value="30"></label></div>
        <p class="journey-help">Uses the filters above and recorded visit dates, then checks road travel and working hours. Priorities and tasks missing from RDM are not assumed.</p>
        <button type="button" id="jp-generate">Generate recommended stops</button>
      </details>
      <div class="journey-buttons"><button type="submit" class="journey-primary" id="jp-preview">Preview road route</button><button type="button" id="jp-draft">Save draft</button><button type="button" id="jp-save">Save planned journey</button><button type="button" id="jp-new">New</button></div>
    </form>
    <div id="jp-summary"></div>
  </div>
  <div id="jp-history" hidden><label>Journey status<select id="jp-history-status"><option value="">All statuses</option><option>draft</option><option>planned</option><option>in_progress</option><option>completed</option><option>cancelled</option></select></label><div id="jp-history-list"></div><div class="journey-buttons"><button id="jp-prev" type="button">Previous</button><button id="jp-next" type="button">Next</button></div></div>
  <div id="jp-execution" hidden></div>`;
  document.getElementById('main-content').appendChild(panel);
  L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
  const $=selector=>panel.querySelector(selector), form=$('#jp-form'), msg=$('#jp-message');
  if (!map.getPane('journeyStops')) map.createPane('journeyStops').style.zIndex=640;
  let catalog=[], selected=[], saved=null, preview=null, config, initialized=false, selecting=false, pickPoint=false, historyPage=1;
  let previewRoute=null, numbered=L.layerGroup().addTo(map), busy=false, selectVersion=0;
  const field=name=>form.elements.namedItem(name);
  let locationRequest=0, autoLocationAttempted=false;
  function syncStartMode() {
    const manual=field('start_mode').value==='manual';
    field('start_lat').readOnly=!manual; field('start_lng').readOnly=!manual;
    $('#jp-locate').textContent=field('start_mode').value==='gps'?'Refresh current location':'Set starting location';
  }
  async function fillCurrentLocation() {
    const token=++locationRequest;
    autoLocationAttempted=true;
    const hint=$('#jp-location-status');
    field('start_lat').value=''; field('start_lng').value=''; invalidate();
    hint.textContent='Getting your current location… Allow location access when your browser asks.';
    $('#jp-locate').disabled=true;
    try {
      const point=await readCurrentLocation(navigator.geolocation);
      if(token!==locationRequest || field('start_mode').value!=='gps' || panel.hidden) return;
      const {latitude,longitude,accuracy}=point;
      field('start_lat').value=latitude.toFixed(6); field('start_lng').value=longitude.toFixed(6);
      hint.textContent=`Current location filled automatically · accuracy ~${Math.round(accuracy)} m.${accuracy>config.max_accuracy_meters?' This reading is approximate; check your starting point before planning.':''}`;
      invalidate();
    } catch(error) {
      if(token===locationRequest) hint.textContent=error.message;
    } finally { if(token===locationRequest) $('#jp-locate').disabled=false; }
  }
  function message(value,error=false) {msg.textContent=value; msg.classList.toggle('journey-error',error);}
  async function run(task) {
    if(busy) return;
    busy=true; panel.classList.add('journey-busy');
    try {await task();} catch(e) {message(e.message,true);}
    finally {busy=false; panel.classList.remove('journey-busy');}
  }
  function clearPreview() {
    preview=null; $('#jp-summary').replaceChildren(); numbered.clearLayers();
    if(previewRoute) map.removeLayer(previewRoute); previewRoute=null;
  }
  function invalidate() {selectVersion++; clearPreview();}
  function filters() {return {search:$('#jp-search').value,territory:$('#jp-territory').value,district:$('#jp-district').value,category:$('#jp-category').value,visit_status:$('#jp-visit').value};}
  function drawCatalog() {
    const f=filters();
    const rows=catalog.filter(s=>(!f.search||s.name.toLowerCase().includes(f.search.toLowerCase())) &&
      (!f.territory||s.region===f.territory) && (!f.district||s.district===f.district) &&
      (!f.category||s.category===f.category) && (!f.visit_status||s.visit_status===f.visit_status));
    $('#jp-stations').innerHTML=rows.slice(0,60).map(s=>`<button type="button" data-add="${s.id}" ${!s.routable||selected.some(t=>t.station_id===s.id)?'disabled':''}><span>${esc(s.name)}<small>${esc(s.category==='target'?'Prospect':s.category)} · ${esc(s.district||s.region||'Territory unassigned')}</small></span><span aria-hidden="true">+</span></button>`).join('') || '<p>No matching stations.</p>';
    if(rows.length>60) $('#jp-stations').insertAdjacentHTML('beforeend','<small>Showing the first 60 matches. Refine your search.</small>');
  }
  function drawStops() {
    $('#jp-count').textContent=`${selected.length} / 20`;
    $('#jp-stops').innerHTML=selected.map((s,i)=>{
      const row=catalog.find(r=>r.id===s.station_id);
      return `<li data-stop="${s.station_id}"><div class="journey-stop-title"><strong>${i+1}. ${esc(row?.name||'Station '+s.station_id)}</strong><div><button type="button" data-move="${i}" data-dir="-1" aria-label="Move stop ${i+1} up" ${i===0?'disabled':''}>↑</button><button type="button" data-move="${i}" data-dir="1" aria-label="Move stop ${i+1} down" ${i===selected.length-1?'disabled':''}>↓</button><button type="button" data-remove="${i}" aria-label="Remove stop ${i+1}">×</button></div></div>
      <small>Last recorded visit: ${row?.last_visit?esc(time(row.last_visit)):'Unavailable'}</small>
      <div class="journey-grid"><label>Visit minutes<input data-minutes="${i}" type="number" min="1" max="480" value="${s.visit_minutes}" required></label><label>Planning priority<select data-priority="${i}">${[0,1,2,3].map(p=>`<option value="${p}" ${p===s.priority?'selected':''}>${['Normal','Low','Medium','High'][p]}</option>`).join('')}</select></label></div>
      <label class="journey-check"><input data-required="${i}" type="checkbox" ${s.required?'checked':''}> Required stop</label></li>`;
    }).join('');
    drawCatalog();
  }
  function add(sid) {
    if(!config?.can_plan) return;
    const row=catalog.find(s=>s.id===sid);
    if(!row?.routable) return message('This station has invalid coordinates.',true);
    if(selected.some(s=>s.station_id===sid)) return;
    if(selected.length>=20) return message('A journey can contain up to 20 stops.',true);
    selected.push({station_id:sid,visit_minutes:Number(field('visit_minutes').value)||30,required:true,priority:0});
    invalidate(); drawStops(); message(`${row.name} added.`);
  }
  function specification() {
    if(!field('start_lat').value || !field('start_lng').value) throw new Error('Set the starting location first.');
    const endMode=field('end_mode').value;
    if(endMode==='custom' && (!field('end_lat').value||!field('end_lng').value)) throw new Error('Enter the ending coordinates.');
    return {name:field('name').value,journey_date:field('journey_date').value,departure_time:field('departure_time').value,
      working_end:field('working_end').value,start:{latitude:Number(field('start_lat').value),longitude:Number(field('start_lng').value)},
      end:endMode==='custom'?{latitude:Number(field('end_lat').value),longitude:Number(field('end_lng').value)}:null,
      return_to_start:endMode==='return',optimize:field('optimize').checked,stops:selected};
  }
  function showSummary(result) {
    clearPreview(); preview=result;
    const p=result.plan;
    previewRoute=L.geoJSON(p.route.geometry,{style:{color:'#087b40',weight:5,opacity:.8}}).addTo(map);
    for(const s of p.stops) {
      const row=catalog.find(r=>r.id===s.station_id); if(!row) continue;
      L.marker([row.latitude,row.longitude],{pane:'journeyStops',icon:L.divIcon({className:'journey-number',html:`<span>${s.sequence}</span>`,iconSize:[28,28],iconAnchor:[14,14]})}).addTo(numbered);
    }
    map.fitBounds(previewRoute.getBounds(),{paddingTopLeft:[60,40],paddingBottomRight:[window.innerWidth>760?panel.offsetWidth+40:40,40],maxZoom:14});
    $('#jp-summary').innerHTML=`<h3>Journey preview</h3><p><strong>${esc(field('name').value)}</strong> · ${esc(field('assigned_user_id').selectedOptions[0]?.textContent)}</p>
      <div class="journey-summary-grid"><span>${formatDistance(p.distance_meters)}<small>Driving distance</small></span><span>${formatDuration(p.driving_seconds)}<small>Driving time</small></span><span>${formatDuration(p.visit_seconds)}<small>Visit time</small></span><span>${formatDuration(p.total_seconds)}<small>Total journey</small></span></div>
      <p>Depart: ${esc(time(p.departure))}<br>Expected finish: ${esc(time(p.completion))}</p>
      ${p.feasible?'':'<p class="journey-error">Exceeds working hours by '+formatDuration(p.overrun_seconds)+'. Adjust before saving as planned.</p>'}
      <ol>${p.stops.map(s=>`<li>${esc(s.name)} · ${esc(time(s.planned_arrival))} · ${s.visit_minutes} min</li>`).join('')}</ol>
      <p class="journey-help">${esc(p.method)}. ${esc(p.warning)}</p><button type="button" id="jp-viewmap">View route on map</button>
      ${result.excluded?.length?'<details><summary>Excluded stations ('+result.excluded.length+')</summary><ul>'+result.excluded.map(s=>`<li>${esc(s.name||catalog.find(r=>r.id===s.station_id)?.name||s.station_id)}: ${esc(s.reason)}</li>`).join('')+'</ul></details>':''}`;
    message(p.feasible?'Preview ready. Review stops and times before saving.':'This schedule exceeds working hours.',!p.feasible);
    $('#jp-summary').scrollIntoView({block:'start',behavior:'smooth'});
  }
  function loadSpec(item) {
    saved=item;
    const spec=item.specification;
    for(const name of ['name','journey_date','departure_time','working_end']) field(name).value=spec[name];
    field('assigned_user_id').value=item.assigned_user_id;
    field('start_mode').value='manual'; field('start_lat').value=spec.start.latitude; field('start_lng').value=spec.start.longitude;
    locationRequest++; $('#jp-locate').disabled=false; $('#jp-location-status').textContent='Saved journey starting point.'; syncStartMode();
    field('end_mode').value=spec.return_to_start?'return':spec.end?'custom':'none';
    $('#jp-end').hidden=!spec.end;
    field('end_lat').value=spec.end?.latitude??''; field('end_lng').value=spec.end?.longitude??'';
    field('optimize').checked=spec.optimize; selected=spec.stops.map(s=>({...s})); drawStops(); clearPreview();
    if(item.plan) showSummary({plan:item.plan,specification:spec});
  }
  function tab(name) {
    $('#jp-plan').hidden=name!=='plan'; $('#jp-history').hidden=name!=='history';
    $('#jp-execution').hidden=name!=='execution';
    panel.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    if(name==='plan') renderer.setStationVisibility('all');
  }
  async function history() {
    const data=await journeyApi(`?page=${historyPage}&status=${encodeURIComponent($('#jp-history-status').value)}`);
    $('#jp-history-list').innerHTML=data.items.map(j=>`<button type="button" class="journey-history-item" data-open="${j.id}"><strong>${esc(j.name)}</strong><span>${esc(j.journey_date)} · ${esc(j.status.replace('_',' '))}${j.paused?' · paused':''}</span><small>${esc(j.assigned_user)} · ${j.stop_count} stops</small></button>`).join('')||'<p>No saved journeys yet.</p>';
    $('#jp-prev').disabled=historyPage<=1; $('#jp-next').disabled=!data.has_more;
  }
  async function openItem(id) {
    navigation.stop(); clearPreview(); selecting=false;
    saved=await journeyApi('/'+id);
    tab('execution'); drawExecution();
    const points=saved.stops.map(s=>[s.latitude,s.longitude]);
    if(points.length) map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[70,50],
      paddingBottomRight:[window.innerWidth>760?panel.offsetWidth+40:40,60],maxZoom:14});
  }
  function drawExecution() {
    const j=saved, next=j.stops.find(s=>['pending','arrived'].includes(s.status));
    const priorScope=renderer.getStationVisibility();
    const pins=priorScope.contextId===j.id?priorScope.mode:'journey';
    const canEdit=config.can_plan&&(config.can_assign||config.user_id===j.creator_id);
    $('#jp-execution').innerHTML=`<h3>${esc(j.name)}</h3><p>${esc(j.journey_date)} · ${esc(j.assigned_user)}<br><strong>${esc(j.status.replace('_',' '))}${j.paused?' · paused':''}</strong></p>
      <label>Station pins<select id="jp-pins"><option value="journey">Journey stops only</option><option value="hidden">Hide all station pins</option><option value="all">All stations</option></select></label>
      ${j.plan?`<p>${formatDistance(j.plan.distance_meters)} · ${formatDuration(j.plan.total_seconds)} planned<br>Departure ${esc(time(j.plan.departure))}<br>Completion ${esc(time(j.plan.completion))}</p>`:''}
      <div class="journey-buttons">
      ${['draft','planned'].includes(j.status)&&canEdit?'<button type="button" id="jp-edit">Edit plan</button>':''}
      ${config.can_plan?'<button type="button" id="jp-duplicate">Duplicate</button>':''}
      ${j.status==='planned'?'<button type="button" data-action="start" class="journey-primary">Start journey</button>':''}
      ${j.status==='in_progress'?`<button type="button" data-action="${j.paused?'resume':'pause'}">${j.paused?'Resume':'Pause'}</button>${!next?'<button type="button" data-action="finish">Finish journey</button>':''}`:''}
      ${j.status==='in_progress'&&!j.paused&&!next&&(j.specification.return_to_start||j.specification.end)?'<button type="button" id="jp-nav-end">Navigate to ending point</button>':''}
      ${['draft','planned','in_progress'].includes(j.status)?'<button type="button" data-action="cancel">Cancel journey</button>':''}
      </div>
      ${j.status==='in_progress'&&next?`<div class="journey-next"><small>NEXT VISIT · ${next.sequence} / ${j.stops.length}</small><h3>${esc(next.name)}</h3><p id="jp-arrival-hint">${j.paused?'Resume to continue.':'Navigate, then confirm check-in when you arrive.'}</p>
      <label>Visit notes<textarea id="jp-notes" maxlength="5000" rows="3">${esc(next.notes)}</textarea></label>
      ${j.paused?'':`<div class="journey-buttons"><button type="button" id="jp-nav-next" class="journey-primary">Navigate to next stop</button><button type="button" data-visit="${next.status==='arrived'?'check_out':'check_in'}">${next.status==='arrived'?'Check out & complete':'Confirm arrival / check in'}</button>${next.status==='pending'?'<button type="button" data-visit="skip">Skip station</button>':''}</div>`}</div>`:''}
      <ol class="journey-records">${j.stops.map(s=>`<li><strong>${esc(s.name)}</strong> · ${esc(s.status)}<small>Planned ${esc(time(s.planned_arrival))}<br>In ${esc(time(s.arrival_at))} · Out ${esc(time(s.departure_at))}</small>${s.notes?'<p>'+esc(s.notes)+'</p>':''}</li>`).join('')}</ol>`;
    $('#jp-pins').value=pins;
    $('#jp-pins').onchange=event=>renderer.setStationVisibility(event.target.value,j.stops.map(s=>s.station_id),j.id);
    renderer.setStationVisibility(pins,j.stops.map(s=>s.station_id),j.id);
  }
  async function save(status) {
    const spec=specification();
    const data={specification:spec,status,assigned_user_id:Number(field('assigned_user_id').value)};
    if(saved) data.version=saved.version;
    const item=await journeyApi(saved?'/'+saved.id:'',saved?'PUT':'POST',data);
    saved=item; clearPreview(); tab('execution'); drawExecution(); message(`${item.status==='draft'?'Draft':'Journey'} saved.`);
  }
  function hide() {locationRequest++; $('#jp-locate').disabled=false; panel.hidden=true; selecting=false; pickPoint=false; map.getContainer().style.cursor=''; clearPreview();}
  async function open() {
    map.fire('snapshot:stop'); setEditMode(false,map); setDeleteMode(false,map);
    panel.hidden=false;
    if(!initialized) await run(async()=>{
      config=await journeyConfig();
      const [stations,users]=await Promise.all([journeyApi('/stations'),journeyApi('/users')]);
      catalog=stations;
      field('assigned_user_id').innerHTML=users.map(u=>`<option value="${u.id}">${esc(u.username)}</option>`).join('');
      field('assigned_user_id').value=config.user_id; field('assigned_user_id').disabled=!config.can_assign;
      field('journey_date').value=isoDay();
      for(const [id,key] of [['#jp-territory','region'],['#jp-district','district']]) {
        const values=[...new Set(catalog.map(s=>s[key]).filter(Boolean))].sort();
        $(id).insertAdjacentHTML('beforeend',values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(''));
      }
      initialized=true; drawCatalog();
      if(!config.can_plan) {tab('history'); await history();}
      if(!config.routing_configured) message('Routing is not configured yet. You can select stops and save drafts; road previews need OSRM_BASE_URL.');
    });
    if(saved?.status==='in_progress') {tab('execution'); drawExecution();}
    syncStartMode();
    if(config?.can_plan && !saved && !panel.hidden && !$('#jp-plan').hidden && field('start_mode').value==='gps' && !autoLocationAttempted) fillCurrentLocation();
  }
  form.onsubmit=e=>{e.preventDefault();run(async()=>{message('Calculating road route…');showSummary(await journeyApi('/preview','POST',specification()));});};
  form.addEventListener('input',event=>{
    const e=event.target;
    if(e.matches('[data-minutes]')) selected[Number(e.dataset.minutes)].visit_minutes=Number(e.value);
    if(e.matches('[data-priority]')) selected[Number(e.dataset.priority)].priority=Number(e.value);
    if(e.matches('[data-required]')) selected[Number(e.dataset.required)].required=e.checked;
    if(e.id==='jp-search') drawCatalog();
    invalidate();
  });
  form.addEventListener('change',e=>{
    if(e.target.name==='start_mode') {
      locationRequest++; $('#jp-locate').disabled=false; pickPoint=false;
      $('#jp-location-status').textContent=''; syncStartMode();
      if(e.target.value==='gps') fillCurrentLocation();
    }
    if(e.target.name==='end_mode') $('#jp-end').hidden=e.target.value!=='custom';
    if(e.target.id.startsWith('jp-')) drawCatalog();
    invalidate();
  });
  panel.addEventListener('click',e=>{
    if(e.target.id==='jp-viewmap') {panel.hidden=true;selecting=false;map.invalidateSize();}
    const b=e.target.closest('button'); if(!b||busy) return;
    if(b.dataset.tab) {tab(b.dataset.tab); if(b.dataset.tab==='history') run(history);}
    if(b.dataset.add) add(Number(b.dataset.add));
    if(b.dataset.remove!==undefined) {selected.splice(Number(b.dataset.remove),1); invalidate();drawStops();}
    if(b.dataset.move!==undefined) {const i=Number(b.dataset.move),j=i+Number(b.dataset.dir); [selected[i],selected[j]]=[selected[j],selected[i]];invalidate();drawStops();}
    if(b.dataset.open) run(()=>openItem(Number(b.dataset.open)));
    if(b.dataset.action) run(async()=>{
      saved=await journeyApi('/'+saved.id+'/action','POST',{version:saved.version,action:b.dataset.action});
      if(['pause','cancel','finish'].includes(b.dataset.action)) navigation.stop();
      drawExecution(); message('Journey updated.');
      if(['start','resume'].includes(b.dataset.action)) {
        const next=saved.stops.find(s=>['pending','arrived'].includes(s.status));
        if(next) await navigation.navigate({id:next.station_id,name:next.name,latitude:next.latitude,longitude:next.longitude},{journeyStops:saved.stops,journeyId:saved.id});
      }
    });
    if(b.dataset.visit) run(async()=>{
      const next=saved.stops.find(s=>['pending','arrived'].includes(s.status));
      saved=await journeyApi(`/${saved.id}/stops/${next.id}`,'POST',{version:saved.version,action:b.dataset.visit,notes:$('#jp-notes').value});
      navigation.stop();drawExecution();message('Visit recorded.');
      const pending=saved.stops.find(s=>s.status==='pending');
      if(pending&&['skip','check_out'].includes(b.dataset.visit)) await navigation.navigate({id:pending.station_id,name:pending.name,latitude:pending.latitude,longitude:pending.longitude},{journeyStops:saved.stops,journeyId:saved.id});
    });
  });
  $('#jp-close').onclick=hide;
  $('#jp-draft').onclick=()=>run(()=>save('draft'));
  $('#jp-save').onclick=()=>run(()=>save('planned'));
  $('#jp-new').onclick=()=>{saved=null;selected=[];form.reset();field('journey_date').value=isoDay();field('assigned_user_id').value=config.user_id;clearPreview();drawStops();syncStartMode();message('New journey.');fillCurrentLocation();};
  $('#jp-generate').onclick=()=>run(async()=>{
    const data={...specification(),filters:filters(),max_stops:Number(field('max_stops').value),visit_minutes:Number(field('visit_minutes').value)};
    message('Checking road travel and working hours…');
    const result=await journeyApi('/generate','POST',data);
    selected=result.specification.stops; field('optimize').checked=false;drawStops();showSummary(result);
  });
  $('#jp-mapselect').onclick=()=>{
    selecting=!selecting; setEditMode(false,map);setDeleteMode(false,map);
    $('#jp-mapselect').setAttribute('aria-pressed',String(selecting));
    message(selecting?'Click station markers on the map to add stops.':'Map selection finished.');
  };
  $('#jp-locate').onclick=()=>{
    if(field('start_mode').value==='gps') {fillCurrentLocation();return;}
    run(async()=>{
    const mode=field('start_mode').value;
    if(mode==='map') {pickPoint=true;message('Click an empty map location to set the starting point.');return;}
    let point;
    if(mode==='base') {point=await journeyApi('/base');if(!point) throw new Error('No saved base. Enter coordinates or pick a point, then Save as my base.');}
    else {message('Enter the starting latitude and longitude below.');return;}
    field('start_lat').value=point.latitude;field('start_lng').value=point.longitude;invalidate();message('Starting point set.');
    });
  };
  $('#jp-savebase').onclick=()=>run(async()=>{
    if(!field('start_lat').value||!field('start_lng').value) throw new Error('Set your starting coordinates first.');
    await journeyApi('/base','PUT',{name:'My office / base',latitude:Number(field('start_lat').value),longitude:Number(field('start_lng').value)});message('Your base location is saved.');
  });
  $('#jp-history-status').onchange=()=>{historyPage=1;run(history);};
  $('#jp-prev').onclick=()=>{historyPage--;run(history);}; $('#jp-next').onclick=()=>{historyPage++;run(history);};
  panel.addEventListener('click',e=>{
    if(e.target.id==='jp-edit') {loadSpec(saved);tab('plan');}
    if(e.target.id==='jp-duplicate') run(async()=>{const item=await journeyApi('/'+saved.id+'/duplicate','POST',{});loadSpec(item);tab('plan');message('Duplicate saved as a draft.');});
    if(e.target.id==='jp-nav-next') run(async()=>{
      const next=saved.stops.find(s=>['pending','arrived'].includes(s.status));
      await navigation.navigate({id:next.station_id,name:next.name,latitude:next.latitude,longitude:next.longitude},{journeyStops:saved.stops,journeyId:saved.id});
    });
    if(e.target.id==='jp-nav-end') run(async()=>{
      const point=saved.specification.return_to_start?saved.specification.start:saved.specification.end;
      await navigation.navigate({...point,name:'Journey ending point'},{journeyStops:saved.stops,journeyId:saved.id});
    });
  });
  map.on('click',e=>{if(!pickPoint) return;pickPoint=false;field('start_lat').value=e.latlng.lat.toFixed(6);field('start_lng').value=e.latlng.lng.toFixed(6);invalidate();message('Starting point set from the map.');});
  map._journeyPickStation=feature=>{if(!selecting||panel.hidden) return false;add(Number(feature.properties.id));return true;};
  map.on('journey:hide',hide);
  map.on('stationpins:changed',event=>{if($('#jp-pins')) $('#jp-pins').value=event.mode;});
  map.on('navigation:arrival',()=>{const hint=$('#jp-arrival-hint');if(hint) hint.textContent='GPS suggests you are nearby. Confirm arrival when you are safely at the station.';});
  map.on('journey:open',open);
  return {open,hide};
}
