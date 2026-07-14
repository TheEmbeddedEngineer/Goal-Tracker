import { calNormName, state } from './state.js';
import { calPushToCloud } from './sync.js';
import { calRound2, esc } from '../core.js';
import { CAL_CATEGORIES } from '../data.js';

// Which bank entry (keyed by its "de" name, same key calMergeFoodBank uses) is currently
// showing its inline edit form, if any. Only one at a time.
let calBankEditingKey = null;

function calFoodBankRowHtml(entry) {
  const unit = entry.preferredUnit || 'gram';
  const ref = entry[unit];
  const key = entry.de;
  const unitLabel = unit === 'piece' ? 'piece' : '100g';
  if (calBankEditingKey === key) {
    return `
    <div class="food-item" style="display:block;">
      <div class="manual-grid" style="grid-template-columns: 1fr 1fr; margin-bottom:6px;">
        <div><label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:3px;">English name</label><input type="text" class="fb-edit-en" value="${esc(entry.en)}"></div>
        <div><label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:3px;">German name</label><input type="text" class="fb-edit-de" value="${esc(entry.de)}"></div>
      </div>
      <select class="fb-edit-category" style="width:100%; padding:7px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:13px; margin-bottom:6px;">
        ${CAL_CATEGORIES.map(c => `<option value="${c}" ${entry.category === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <div class="manual-grid macros">
        <div><label>Calories</label><input type="number" class="fb-edit-calories" min="0" value="${ref ? ref.calories : ''}"></div>
        <div><label>Protein (g)</label><input type="number" class="fb-edit-protein" min="0" value="${ref ? ref.protein : ''}"></div>
        <div><label>Carbs (g)</label><input type="number" class="fb-edit-carbs" min="0" value="${ref ? ref.carbs : ''}"></div>
        <div><label>Fat (g)</label><input type="number" class="fb-edit-fat" min="0" value="${ref ? ref.fat : ''}"></div>
      </div>
      <p class="card-sub" style="margin:4px 0 8px;">Per ${unitLabel}</p>
      <label class="core-check-inline" style="margin-bottom:8px;">
        <input type="checkbox" class="fb-edit-locked" ${entry.locked !== false ? 'checked' : ''}>
        <span>Locked (protects it from one-off log edits)</span>
      </label>
      <div style="display:flex; gap:8px;">
        <button class="primary fb-save" data-key="${esc(key)}" style="flex:1;">Save</button>
        <button type="button" class="link-btn fb-cancel">Cancel</button>
      </div>
    </div>`;
  }
  return `<div class="food-item">
    <span class="fi-name">${esc(entry.en)} / ${esc(entry.de)}${entry.locked !== false ? ' &#128274;' : ''}</span>
    <span class="fi-macros">${ref ? `${ref.calories} · ${ref.protein}P · ${ref.carbs}C · ${ref.fat}F` : 'no data'} <span style="color:var(--text-muted)">/ ${unitLabel}</span></span>
    <button class="fi-edit fb-edit" data-key="${esc(key)}" title="Edit">&#9998;</button>
    <button class="fi-del fb-del" data-key="${esc(key)}" title="Delete">&times;</button>
  </div>`;
}

export function calRenderFoodBankList() {
  const el = document.getElementById('foodBankList');
  if (!el) return;
  if (state.calFoodBank.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:8px 0;">No foods saved yet — foods you log get saved here automatically.</div>';
    return;
  }
  const groups = {};
  state.calFoodBank.forEach(entry => {
    const cat = entry.category || 'Other';
    (groups[cat] || (groups[cat] = [])).push(entry);
  });
  const orderedCats = CAL_CATEGORIES.filter(c => groups[c]);
  Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });
  orderedCats.forEach(c => groups[c].sort((a, b) => a.en.localeCompare(b.en)));

  el.innerHTML = orderedCats.map(cat => `
    <div class="food-cat-title">${cat}</div>
    ${groups[cat].map(calFoodBankRowHtml).join('')}
  `).join('');

  el.querySelectorAll('.fb-edit').forEach(btn => {
    btn.addEventListener('click', () => { calBankEditingKey = btn.dataset.key; calRenderFoodBankList(); });
  });
  el.querySelectorAll('.fb-cancel').forEach(btn => {
    btn.addEventListener('click', () => { calBankEditingKey = null; calRenderFoodBankList(); });
  });
  el.querySelectorAll('.fb-save').forEach(btn => {
    btn.addEventListener('click', () => calSaveFoodBankEdit(btn.dataset.key, btn.closest('.food-item')));
  });
  el.querySelectorAll('.fb-del').forEach(btn => {
    btn.addEventListener('click', () => calDeleteFoodBankEntry(btn.dataset.key));
  });
}

function calSaveFoodBankEdit(key, row) {
  const entry = state.calFoodBank.find(f => f.de === key);
  if (!entry || !row) return;
  const newEn = row.querySelector('.fb-edit-en').value.trim();
  const newDe = row.querySelector('.fb-edit-de').value.trim();
  if (!newEn || !newDe) { alert('Enter both an English and a German name.'); return; }
  const dupe = state.calFoodBank.find(f => f !== entry && (calNormName(f.en) === calNormName(newEn) || calNormName(f.de) === calNormName(newDe)));
  if (dupe) { alert(`"${dupe.en} / ${dupe.de}" already uses one of those names.`); return; }
  // Log entries store only the English name at the time they were logged (see calAddItem),
  // so renaming here doesn't relabel history — past days keep showing the old name. That's
  // a display-only side effect, not data loss, and matches how exercise renames are handled
  // in the training tab (see TR_EXERCISE_RENAMES).
  const deChanged = newDe !== entry.de;
  entry.en = newEn;
  entry.de = newDe;
  const unit = entry.preferredUnit || 'gram';
  entry.category = row.querySelector('.fb-edit-category').value;
  entry[unit] = {
    calories: Math.round(parseFloat(row.querySelector('.fb-edit-calories').value) || 0),
    protein: calRound2(parseFloat(row.querySelector('.fb-edit-protein').value) || 0),
    carbs: calRound2(parseFloat(row.querySelector('.fb-edit-carbs').value) || 0),
    fat: calRound2(parseFloat(row.querySelector('.fb-edit-fat').value) || 0)
  };
  entry.locked = row.querySelector('.fb-edit-locked').checked;
  calBankEditingKey = null;
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(state.calFoodBank)); } catch (err) {}
  calRenderFoodBankList();
  // calMergeFoodBank unions by "de" name — if that just changed, a normal merge would
  // leave the stale remote copy sitting under the old key as a duplicate (same class of
  // bug as deleting an entry). Skip the merge so the rename fully replaces it.
  calPushToCloud({ skipMerge: deChanged });
}

function calDeleteFoodBankEntry(key) {
  const entry = state.calFoodBank.find(f => f.de === key);
  if (!entry) return;
  if (!confirm(`Delete "${entry.en} / ${entry.de}" from the food bank? Days you've already logged it on keep their own values — this only removes it as a saved shortcut for next time.`)) return;
  state.calFoodBank = state.calFoodBank.filter(f => f.de !== key);
  calBankEditingKey = null;
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(state.calFoodBank)); } catch (err) {}
  calRenderFoodBankList();
  calPushToCloud({ skipMerge: true });
}

function setFoodBankCollapsed(collapsed) {
  document.getElementById('foodBankBody').classList.toggle('collapsed', collapsed);
  document.getElementById('foodBankArrow').innerHTML = collapsed ? '&#9656;' : '&#9662;';
  try { localStorage.setItem('foodBankCollapsed', collapsed ? '1' : '0'); } catch (err) {}
}
document.getElementById('foodBankToggle').addEventListener('click', () => {
  setFoodBankCollapsed(!document.getElementById('foodBankBody').classList.contains('collapsed'));
});

let initialFoodBankCollapsed = true;
try { initialFoodBankCollapsed = localStorage.getItem('foodBankCollapsed') !== '0'; } catch (err) {}
setFoodBankCollapsed(initialFoodBankCollapsed);
