"""Apply reviewed coordinate corrections and refresh untouched affected journeys."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
from app import create_app, db
from app.models import Station
from app.journey_models import Journey
from app.services.journeys import plan_journey
from app.services.osrm import coordinate


def main():
    app=create_app()
    with app.app_context():
        if db.engine.dialect.name != 'sqlite':
            raise RuntimeError('Review and back up non-SQLite databases before applying this maintenance script.')
        backup_dir=Path('backups')
        backup_dir.mkdir(exist_ok=True)
        backup=backup_dir / ('before-station-correction-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.db')
        with sqlite3.connect(db.engine.url.database) as source, sqlite3.connect(str(backup)) as dest:
            source.backup(dest)
        changes=json.loads(Path('app/static/data/station_coordinate_corrections.json').read_text(encoding='utf-8'))
        changed_ids=[]
        for name,value in changes.items():
            point=coordinate(value)
            rows=Station.query.filter_by(name=name).all()
            if len(rows)!=1:
                raise RuntimeError(f'Expected one record for {name}; found {len(rows)}.')
            station=rows[0]
            if station.latitude==point['latitude'] and station.longitude==point['longitude']:
                continue
            station.latitude,station.longitude=point['latitude'],point['longitude']
            changed_ids.append(station.id)
        db.session.flush()
        refreshed=[]
        for item in Journey.query.filter(Journey.status.in_(['planned','in_progress'])).all():
            if not changed_ids or not any(s.station_id in changed_ids for s in item.stops):
                continue
            if any(s.status!='pending' for s in item.stops):
                print(f'Journey {item.id}: visit history retained; remaining route will use corrected station coordinates.')
                continue
            plan=plan_journey(item.specification,app.extensions['osrm'])
            by_station={s.station_id:s for s in item.stops}
            # Temporary distinct positions avoid the unique sequence constraint.
            for index,stop in enumerate(item.stops):
                stop.sequence=1000+index
            db.session.flush()
            for index,stop_plan in enumerate(plan['stops']):
                stop=by_station[stop_plan['station_id']]
                stop.sequence=index+1
                stop.planned_arrival=datetime.fromisoformat(stop_plan['planned_arrival'])
            item.specification={**item.specification,'stops':[
                {k:s[k] for k in ('station_id','visit_minutes','required','priority')} for s in plan['stops']]}
            item.plan=plan
            refreshed.append(dict(id=item.id,order=[s['name'] for s in plan['stops']]))
        db.session.commit()
        print(json.dumps(dict(corrected_station_ids=changed_ids,refreshed_journeys=refreshed,backup=str(backup)),indent=2))


if __name__=='__main__':
    main()
