// GPS processing is independent of the DOM so movement and permission failures can be tested.
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude-a.latitude)*rad, dlng=(b.longitude-a.longitude)*rad;
  const s = Math.sin(dlat/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));
}

export function routeProgress(point, coordinates) {
  if (!coordinates || coordinates.length < 2) return null;
  const latScale = 111195, lngScale = latScale*Math.cos(point.latitude*Math.PI/180);
  let total=0, best=Infinity, traveled=0, index=0, snapped=coordinates[0];
  for(let i=1;i<coordinates.length;i++) {
    const [lng1,lat1]=coordinates[i-1], [lng2,lat2]=coordinates[i];
    const x1=(lng1-point.longitude)*lngScale, y1=(lat1-point.latitude)*latScale;
    const dx=(lng2-lng1)*lngScale, dy=(lat2-lat1)*latScale;
    const length=Math.hypot(dx,dy);
    const t=length ? Math.max(0,Math.min(1,-(x1*dx+y1*dy)/(length*length))) : 0;
    const away=Math.hypot(x1+t*dx,y1+t*dy);
    if(away<best) { best=away; traveled=total+t*length; index=i; snapped=[lng1+t*(lng2-lng1),lat1+t*(lat2-lat1)]; }
    total+=length;
  }
  return {offRoute:best, fraction:total ? traveled/total : 0, index, snapped};
}

export function splitRoute(coordinates, progress) {
  if(!progress) return {traveled:[],remaining:coordinates};
  return {traveled:[...coordinates.slice(0,progress.index),progress.snapped],
    remaining:[progress.snapped,...coordinates.slice(progress.index)]};
}

export function maneuverText(step) {
  if (!step) return 'Continue along the route';
  const m=step.maneuver || {}, road=step.name ? ` onto ${step.name}` : '';
  if(m.type==='arrive') return 'Arrive at your destination';
  if(m.type==='depart') return `Head ${m.modifier || 'along the road'}${road}`;
  if(m.type==='roundabout' || m.type==='rotary') return `Take the roundabout${m.exit ? ', exit '+m.exit : ''}${road}`;
  return `${String(m.type || 'Continue').replaceAll('_',' ')} ${m.modifier || ''}${road}`.trim();
}

export function gpsError(error) {
  if(error.code===1) return 'Location permission denied. Allow location for this site to navigate, or plan using a map point.';
  if(error.code===3) return 'GPS timed out. Move to an open area and try again.';
  return 'GPS is unavailable. Check location services and your connection.';
}

export class NavigationTracker {
  constructor({geolocation, route, onUpdate, onError, onRoute, onArrival, onPosition=()=>{}, config, now=()=>Date.now()}) {
    Object.assign(this,{geolocation,route,onUpdate,onError,onRoute,onArrival,onPosition,config,now});
    this.watch=null; this.epoch=0; this.busy=false; this.currentRoute=null;
  }
  async preview(destination,{live=false}={}) {
    this.stop();
    this.destination=destination;
    const epoch=this.epoch;
    if(!this.geolocation) throw new Error('GPS is unavailable. Use HTTPS and enable device location services.');
    const pos=await new Promise((resolve,reject)=>this.geolocation.getCurrentPosition(resolve,e=>reject(new Error(gpsError(e))),
      {enableHighAccuracy:true,timeout:15000,maximumAge:0}));
    if(epoch!==this.epoch) return;
    if(!this.validPosition(pos)) throw new Error('GPS returned an invalid or stale position. Please retry.');
    this.updatePosition(pos);
    if(live) this.start();
    if(!this.acceptable(pos)) {
      const message='GPS accuracy is low. Your approximate position is shown; road guidance will resume when the signal improves.';
      if(!live) throw new Error(message);
      this.onError(message); return null;
    }
    await this.recalculate(epoch);
    return this.currentRoute;
  }
  validPosition(pos) {
    return Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude) &&
      Math.abs(pos.coords.latitude)<=90 && Math.abs(pos.coords.longitude)<=180 &&
      Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy>=0 &&
      this.now()-pos.timestamp<=30000;
  }
  acceptable(pos) {
    return this.validPosition(pos) && pos.coords.accuracy<=this.config.max_accuracy_meters;
  }
  updatePosition(pos) {
    this.position={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
    this.accuracy=pos.coords.accuracy;
    this.onPosition({position:this.position,accuracy:this.accuracy,heading:pos.coords.heading,
      reliable:this.accuracy<=this.config.max_accuracy_meters});
  }
  start() {
    if(!this.destination || !this.position || this.watch!==null) return;
    this.arrivalPrompted=false;
    const epoch=this.epoch;
    this.watch=this.geolocation.watchPosition(p=>this.process(p,epoch), e=>{
      if(epoch!==this.epoch) return;
      if(e.code===1) this.stop();
      this.onError(gpsError(e));
    },{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  }
  process(pos, epoch=this.epoch) {
    if(epoch!==this.epoch) return;
    if(!this.validPosition(pos)) {this.onError('GPS signal is stale or unavailable. Waiting for a fresh reading.'); return;}
    if(this.lastUpdate && this.now()-this.lastUpdate<1000) return;
    this.lastUpdate=this.now();
    this.updatePosition(pos);
    if(!this.acceptable(pos)) {this.onError('GPS signal is inaccurate. Your approximate position is shown; route progress is paused.'); return;}
    if(!this.currentRoute) {
      if(!this.busy && this.now()-(this.lastRoute||0)>20000) this.recalculate(epoch).catch(e=>{if(epoch===this.epoch) this.onError(e.message);});
      return;
    }
    const progress=routeProgress(this.position,this.currentRoute?.geometry?.coordinates);
    if(!progress) return;
    const off=progress.offRoute>Math.max(this.config.deviation_meters,pos.coords.accuracy*1.5);
    this.deviations=off ? (this.deviations||0)+1 : 0;
    this.onUpdate({position:this.position,accuracy:pos.coords.accuracy,progress,
      distance:this.currentRoute.distance*(1-progress.fraction), duration:this.currentRoute.duration*(1-progress.fraction),
      offRoute:off});
    if(distance(this.position,this.destination)<=this.config.arrival_meters && !this.arrivalPrompted) {
      this.arrivalPrompted=true;
      this.onArrival();
    }
    if(this.deviations>=3 && !this.busy && this.now()-(this.lastRoute||0)>20000) {
      this.recalculate(epoch).catch(e=>{if(epoch===this.epoch) this.onError(e.message);});
    }
  }
  async recalculate(epoch=this.epoch) {
    if(this.busy) return;
    this.busy=true;
    this.lastRoute=this.now();
    try {
      const result=await this.route(this.position,this.destination.id,this.destination);
      if(epoch!==this.epoch) return;
      this.currentRoute=result.route;
      this.deviations=0;
      this.onRoute(result,this.position,this.accuracy);
    } finally {if(epoch===this.epoch) this.busy=false;}
  }
  stop() {
    if(this.watch!==null) this.geolocation?.clearWatch(this.watch);
    this.watch=null; this.epoch++; this.busy=false; this.currentRoute=null;
    this.lastUpdate=0; this.deviations=0;
  }
}
