let editMode = false;
let deleteMode = false;

export function isEditMode() { return editMode; }
export function isDeleteMode() { return deleteMode; }

export function setEditMode(state, map) {
  editMode = state;
  if (editMode) deleteMode = false;
  refreshCursor(map);
}

export function setDeleteMode(state, map) {
  deleteMode = state;
  if (deleteMode) editMode = false;
  refreshCursor(map);
}

function refreshCursor(map) {
  const container = map.getContainer();
  if (editMode) container.style.cursor = 'pointer';
  else if (deleteMode) container.style.cursor = 'not-allowed';
  else container.style.cursor = '';
}
