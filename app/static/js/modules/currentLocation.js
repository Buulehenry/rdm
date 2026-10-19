import {gpsError} from './navigationEngine.js';

// A fresh one-time reading for planning; this never starts background tracking.
export async function readCurrentLocation(geolocation) {
  if(!geolocation) throw new Error('Location is unavailable. Enable device location services, or choose a map point.');
  const p=await new Promise((resolve,reject)=>geolocation.getCurrentPosition(resolve,
    error=>reject(new Error(gpsError(error))),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
  const {latitude,longitude,accuracy}=p.coords || {};
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0)
    throw new Error('Your device returned an invalid location. Retry or choose a map point.');
  return {latitude,longitude,accuracy};
}
