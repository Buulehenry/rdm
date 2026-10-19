import { exportCurrentMap } from './exportControl.js';
import { setEditMode, setDeleteMode } from './modes.js';

export function addSnapshotControl(map, renderer) {
  const control = L.control({ position: 'bottomright' });
  let active = false;
  control.onAdd = () => {
    const host = L.DomUtil.create('div', 'snapshot-control');
    host.setAttribute('data-html2canvas-ignore', 'true');
    host.innerHTML = `<button type="button" class="snapshot-start"><i class="fa fa-camera" aria-hidden="true"></i> Snapshot mode</button>
      <div class="snapshot-actions" hidden>
        <strong>Arrange your snapshot</strong>
        <p>Drag markers into place. Saved locations stay unchanged.</p>
        <div><button type="button" class="snapshot-save">Save snapshot</button>
        <button type="button" class="snapshot-reset">Reset</button>
        <button type="button" class="snapshot-done">Done</button></div>
      </div><span class="snapshot-status" role="status"></span>`;
    L.DomEvent.disableClickPropagation(host);
    L.DomEvent.disableScrollPropagation(host);
    const start = host.querySelector('.snapshot-start');
    const actions = host.querySelector('.snapshot-actions');
    const save = host.querySelector('.snapshot-save');
    const status = host.querySelector('.snapshot-status');
    function toggle(enabled) {
      if (enabled) map.fire('snapshot:start');
      active = enabled;
      setEditMode(false, map);
      setDeleteMode(false, map);
      document.getElementById('side-panel')?.classList.remove('open');
      renderer.setSnapshotMode(enabled);
      map.getContainer().classList.toggle('snapshot-mode', enabled);
      start.hidden = enabled;
      actions.hidden = !enabled;
    }
    start.onclick = () => { status.textContent = ''; toggle(true); };
    map.on('snapshot:stop', () => { if (active) toggle(false); });
    host.querySelector('.snapshot-done').onclick = () => { toggle(false); status.textContent = 'Original positions restored.'; };
    host.querySelector('.snapshot-reset').onclick = () => { renderer.setSnapshotMode(false); renderer.setSnapshotMode(true); status.textContent = 'Positions reset.'; };
    save.onclick = async () => {
      save.disabled = true;
      status.textContent = 'Preparing snapshot…';
      try {
        await exportCurrentMap(map, {fileBase: 'RDM_snapshot'});
        toggle(false);
        status.textContent = 'Snapshot downloaded. Original positions restored.';
      } catch (error) {
        status.textContent = 'Could not save. Try again, or choose Done to restore positions.';
        console.error(error);
      } finally { save.disabled = false; }
    };
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && active && !save.disabled) toggle(false);
    });
    return host;
  };
  control.addTo(map);
}
