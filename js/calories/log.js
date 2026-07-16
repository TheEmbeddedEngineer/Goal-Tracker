import { calCurrentStreak, calDayItems, calDayTotals, calFindInBank, calGoalsForDay, calMonthKey, calNormName, calSearchBank, calSelectedDate, state, ui } from './state.js';
import { calPushEntriesForMonth, calPushToCloud } from './sync.js';
import { calRound2, esc, feature, todayStr } from '../core.js';
import { CAL_CATEGORIES } from '../data.js';

export function calPopulateCategorySelect() {
  const sel = document.getElementById('foodCategory');
  sel.innerHTML = CAL_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
}

function calRenderStreakBadge() {
  const el = document.getElementById('calStreakBadge');
  if (!el) return;
  const streak = calCurrentStreak(state.calActivePerson);
  el.innerHTML = streak > 0
    ? `<span class="tr-streak-badge" title="Consecutive days with at least one food item logged">&#128293; ${streak}-day logging streak</span>`
    : '';
}

let calActiveBankEntry = null;
let calCurrentMatches = [];
let calDropdownIndex = -1;
let calEditingIndex = -1;

function calClearManualFields() {
  document.getElementById('foodSearchInput').value = '';
  document.getElementById('foodCalories').value = '';
  document.getElementById('foodProtein').value = '';
  document.getElementById('foodCarbs').value = '';
  document.getElementById('foodFat').value = '';
  document.getElementById('foodCategory').value = 'Other';
  document.getElementById('foodLocked').checked = true;
  calActiveBankEntry = null;
  calEditingIndex = -1;
  document.getElementById('addItemBtn').textContent = 'Add to log';
  document.getElementById('cancelEditBtn').style.display = 'none';
  calApplyUnit('gram');
  document.getElementById('bankStatus').textContent = '';
  calCloseDropdown();
}

function calUpdateAmountLabel() {
  const unit = document.getElementById('foodUnit').value;
  document.getElementById('foodAmountLabel').textContent = unit === 'piece' ? 'Quantity (pieces/servings)' : 'Grams';
}

// Sets the unit select + resets the amount field to a sensible default for that unit (1 piece / 100g).
function calApplyUnit(unit) {
  document.getElementById('foodUnit').value = unit;
  const amount = unit === 'piece' ? 1 : 100;
  document.getElementById('foodGrams').value = amount;
  calUpdateAmountLabel();
  return amount;
}

function calCloseDropdown() {
  const dd = document.getElementById('foodNameDropdown');
  dd.classList.remove('open');
  dd.innerHTML = '';
  calCurrentMatches = [];
  calDropdownIndex = -1;
}

function calUpdateDropdownHighlight() {
  const dd = document.getElementById('foodNameDropdown');
  dd.querySelectorAll('.autocomplete-item').forEach((el, i) => {
    el.classList.toggle('active', i === calDropdownIndex);
    if (i === calDropdownIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

// entry.gram / entry.piece hold {calories,protein,carbs,fat} reference values
// for 100g or 1 piece respectively. Either may be missing.
function calFillFromBankEntry(entry, unit, amount) {
  const ref = entry[unit];
  const statusEl = document.getElementById('bankStatus');
  document.getElementById('foodLocked').checked = entry.locked !== false;
  if (!ref) {
    statusEl.textContent = '"' + entry.en + ' / ' + entry.de + '" has no ' + (unit === 'piece' ? 'per-piece' : 'per-gram') + ' data yet — enter values manually and it’ll be saved for next time.';
    return;
  }
  const factor = unit === 'piece' ? (amount || 0) : (amount || 0) / 100;
  document.getElementById('foodCalories').value = Math.round(ref.calories * factor);
  document.getElementById('foodProtein').value = calRound2(ref.protein * factor);
  document.getElementById('foodCarbs').value = calRound2(ref.carbs * factor);
  document.getElementById('foodFat').value = calRound2(ref.fat * factor);
  document.getElementById('foodCategory').value = entry.category || 'Other';
  statusEl.textContent = '✓ Using "' + entry.en + ' / ' + entry.de + '" — auto-filled for ' + amount + (unit === 'piece' ? ' piece(s).' : 'g.');
}

function calSelectBankEntry(entry) {
  document.getElementById('foodSearchInput').value = entry.en + ' / ' + entry.de;
  calActiveBankEntry = entry;
  const amount = calApplyUnit(entry.preferredUnit);
  calFillFromBankEntry(entry, entry.preferredUnit, amount);
  calCloseDropdown();
}

function calRenderDropdown(matches) {
  calCurrentMatches = matches;
  calDropdownIndex = -1;
  const dd = document.getElementById('foodNameDropdown');
  if (matches.length === 0) { calCloseDropdown(); return; }
  dd.innerHTML = matches.map((f, i) => `<div class="autocomplete-item" data-i="${i}">${esc(f.en)} <span class="ai-sub">/ ${esc(f.de)}</span></div>`).join('');
  dd.classList.add('open');
  dd.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); calSelectBankEntry(calCurrentMatches[parseInt(el.dataset.i)]); });
  });
}

function calOnFoodSearchKeydown(e) {
  const dd = document.getElementById('foodNameDropdown');
  const isOpen = dd.classList.contains('open');
  if (e.key === 'ArrowDown') {
    if (!isOpen || calCurrentMatches.length === 0) return;
    e.preventDefault();
    calDropdownIndex = Math.min(calDropdownIndex + 1, calCurrentMatches.length - 1);
    calUpdateDropdownHighlight();
  } else if (e.key === 'ArrowUp') {
    if (!isOpen || calCurrentMatches.length === 0) return;
    e.preventDefault();
    calDropdownIndex = Math.max(calDropdownIndex - 1, 0);
    calUpdateDropdownHighlight();
  } else if (e.key === 'Enter') {
    if (isOpen && calDropdownIndex >= 0 && calCurrentMatches[calDropdownIndex]) {
      e.preventDefault();
      calSelectBankEntry(calCurrentMatches[calDropdownIndex]);
    }
  } else if (e.key === 'Escape') {
    calCloseDropdown();
  }
}

function calOnFoodNameInput() {
  const name = document.getElementById('foodSearchInput').value;
  calActiveBankEntry = null;
  const exact = calFindInBank(name);
  const statusEl = document.getElementById('bankStatus');
  if (exact) {
    calActiveBankEntry = exact;
    const amount = calApplyUnit(exact.preferredUnit);
    calFillFromBankEntry(exact, exact.preferredUnit, amount);
    calCloseDropdown();
  } else {
    statusEl.textContent = name.trim() ? 'Not in your food bank yet — enter values manually or search Google, and it’ll be saved for next time.' : '';
    calRenderDropdown(calSearchBank(name));
  }
}

// User is typing a custom amount — recompute macros but leave their typed number alone.
function calOnGramsFieldInput() {
  if (calActiveBankEntry) {
    const unit = document.getElementById('foodUnit').value;
    const amount = parseFloat(document.getElementById('foodGrams').value) || 0;
    calFillFromBankEntry(calActiveBankEntry, unit, amount);
  }
}

// User manually flipped the unit dropdown — reset the amount to a sensible default for that unit.
function calOnUnitChange() {
  const unit = document.getElementById('foodUnit').value;
  const amount = calApplyUnit(unit);
  if (calActiveBankEntry) calFillFromBankEntry(calActiveBankEntry, unit, amount);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#foodSearchInput') && !e.target.closest('#foodNameDropdown')) calCloseDropdown();
});

function calSearchOnGoogle() {
  const name = document.getElementById('foodSearchInput').value.trim().split('/')[0].trim();
  if (!name) { alert('Enter a food name first.'); return; }
  const amount = document.getElementById('foodGrams').value || '100';
  const unit = document.getElementById('foodUnit').value;
  const q = unit === 'piece' ? `${name} calories and macros per piece` : `${name} calories and macros per ${amount}g`;
  window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank');
}

function calSaveOrUpdateBank(name, unit, amount, calories, protein, carbs, fat, category, locked) {
  if (!amount || amount <= 0) return;
  const factor = unit === 'piece' ? (1 / amount) : (100 / amount);
  const refData = {
    calories: Math.round(calories * factor),
    protein: calRound2(protein * factor),
    carbs: calRound2(carbs * factor),
    fat: calRound2(fat * factor)
  };
  let entry = calFindInBank(name);
  if (entry) {
    entry[unit] = refData;
    entry.preferredUnit = unit;
    entry.category = category;
  } else {
    const parts = name.split('/').map(s => s.trim()).filter(Boolean);
    const en = parts[0] || name;
    const de = parts[1] || parts[0] || name;
    entry = { en, de, preferredUnit: unit, gram: null, piece: null, category, locked: locked !== false };
    entry[unit] = refData;
    state.calFoodBank.push(entry);
  }
  try { localStorage.setItem('calorie_foodBank', JSON.stringify(state.calFoodBank)); } catch (err) {}
}

async function calAddItem() {
  const name = document.getElementById('foodSearchInput').value.trim();
  if (!name) {
    document.getElementById('foodSearchInput').classList.add('input-error');
    document.getElementById('foodNameError').style.display = '';
    document.getElementById('foodSearchInput').focus();
    return;
  }
  document.getElementById('foodSearchInput').classList.remove('input-error');
  document.getElementById('foodNameError').style.display = 'none';
  const nameEn = name.split('/')[0].trim();
  const unit = document.getElementById('foodUnit').value;
  const amount = parseFloat(document.getElementById('foodGrams').value) || 0;
  const calories = Math.round(parseFloat(document.getElementById('foodCalories').value) || 0);
  const protein = calRound2(parseFloat(document.getElementById('foodProtein').value) || 0);
  const carbs = calRound2(parseFloat(document.getElementById('foodCarbs').value) || 0);
  const fat = calRound2(parseFloat(document.getElementById('foodFat').value) || 0);
  const category = document.getElementById('foodCategory').value || 'Other';
  const locked = document.getElementById('foodLocked').checked;
  const ds = calSelectedDate();
  if (!state.calEntries[state.calActivePerson]) state.calEntries[state.calActivePerson] = {};
  if (!state.calEntries[state.calActivePerson][ds]) state.calEntries[state.calActivePerson][ds] = { items: [] };
  const newItem = { name: nameEn, unit, grams: amount, calories, protein, carbs, fat, category };
  const items = state.calEntries[state.calActivePerson][ds].items;
  const wasEditing = calEditingIndex >= 0 && !!items[calEditingIndex];
  let mergedIntoExisting = false;
  if (wasEditing) {
    items[calEditingIndex] = newItem;
  } else {
    // Logging the same food again on the same day tops up the existing row instead of
    // adding a duplicate — amount and macros are summed (same name + same unit only).
    const matchIdx = items.findIndex(it =>
      calNormName(it.name) === calNormName(newItem.name) && it.unit === newItem.unit);
    if (matchIdx >= 0) {
      const ex = items[matchIdx];
      items[matchIdx] = {
        ...ex,
        grams: calRound2((parseFloat(ex.grams) || 0) + newItem.grams),
        calories: (ex.calories || 0) + newItem.calories,
        protein: calRound2((ex.protein || 0) + newItem.protein),
        carbs: calRound2((ex.carbs || 0) + newItem.carbs),
        fat: calRound2((ex.fat || 0) + newItem.fat)
      };
      mergedIntoExisting = true;
    } else {
      items.push(newItem);
    }
  }
  // Locked (the default) means this is a one-off tweak — the bank's saved reference
  // values are left alone. A brand-new food (no bank entry yet) is always saved so
  // first-time logging still seeds the bank for next time, regardless of the checkbox.
  const bankChanged = !calFindInBank(name) || !locked;
  if (bankChanged) {
    calSaveOrUpdateBank(name, unit, amount, calories, protein, carbs, fat, category, locked);
  }
  try { localStorage.setItem('calorie_entries', JSON.stringify(state.calEntries)); } catch (err) {}
  calClearManualFields();
  calRenderLogCard();
  ui.renderMonth();
  ui.renderTrendChart();
  ui.renderDeficitCard();
  // The main calories doc only needs a push when the bank actually changed —
  // skipping it otherwise saves two Firestore round trips per logged item.
  if (bankChanged) calPushToCloud();
  // Editing (or topping up an existing row) replaces an item in place, so trust the
  // local result rather than merging — a stale remote copy could otherwise resurrect
  // the pre-edit/pre-merge version alongside the new one.
  calPushEntriesForMonth(calMonthKey(ds), { skipMerge: wasEditing || mergedIntoExisting });
  // A past day's log may just have crossed (or been edited across) the goal line.
  feature('weekly').refreshAutoChecks();
}

function calDeleteItem(index) {
  const ds = calSelectedDate();
  const items = calDayItems(state.calActivePerson, ds);
  const item = items[index];
  if (!item) return;
  if (!confirm(`Delete "${item.name}" from this day's log?`)) return;
  items.splice(index, 1);
  if (calEditingIndex === index) calClearManualFields();
  // Deleting an item above the one being edited shifts every later index down —
  // without this, "Update log entry" would silently overwrite the wrong row.
  else if (calEditingIndex > index) calEditingIndex--;
  try { localStorage.setItem('calorie_entries', JSON.stringify(state.calEntries)); } catch (err) {}
  calRenderLogCard();
  ui.renderMonth();
  ui.renderTrendChart();
  ui.renderDeficitCard();
  calPushEntriesForMonth(calMonthKey(ds), { skipMerge: true });
}

function calPopulateFormFromItem(item) {
  const bankEntry = calFindInBank(item.name);
  calActiveBankEntry = bankEntry;
  document.getElementById('foodSearchInput').value = bankEntry ? (bankEntry.en + ' / ' + bankEntry.de) : item.name;
  document.getElementById('foodUnit').value = item.unit;
  calUpdateAmountLabel();
  document.getElementById('foodGrams').value = item.grams;
  document.getElementById('foodCalories').value = Math.round(item.calories);
  document.getElementById('foodProtein').value = calRound2(item.protein);
  document.getElementById('foodCarbs').value = calRound2(item.carbs);
  document.getElementById('foodFat').value = calRound2(item.fat);
  document.getElementById('foodCategory').value = item.category || (bankEntry && bankEntry.category) || 'Other';
  document.getElementById('foodLocked').checked = !bankEntry || bankEntry.locked !== false;
  calCloseDropdown();
}

export function calRenderRecentChips() {
  const el = document.getElementById('calRecentChips');
  if (!el) return;
  const ranked = state.calTopFoodsCache[state.calActivePerson] || [];
  if (ranked.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<div style="width:100%; font-size:11px; color:var(--text-muted); margin-bottom:2px;">Most logged</div>' +
    ranked.map((r, i) => `<button type="button" class="recent-chip" data-i="${i}">${esc(r.item.name)} <span style="color:var(--text-muted)">&times;${r.count}</span></button>`).join('');
  el.querySelectorAll('.recent-chip').forEach(btn => {
    const item = ranked[parseInt(btn.dataset.i)].item;
    btn.addEventListener('click', () => {
      calEditingIndex = -1;
      // Prefer the bank's reference values at the default amount: since same-day
      // top-ups merge into one row, the raw logged item may carry a summed amount
      // (e.g. 3 pc / 600 kcal) — not what a fresh add should start from.
      const bankEntry = calFindInBank(item.name);
      if (bankEntry) {
        calSelectBankEntry(bankEntry);
      } else {
        calPopulateFormFromItem(item);
        document.getElementById('bankStatus').textContent = 'Loaded — adjust if needed, then Add.';
      }
      document.getElementById('addItemBtn').textContent = 'Add to log';
      document.getElementById('cancelEditBtn').style.display = 'none';
    });
  });
}

function calEditItem(index) {
  const ds = calSelectedDate();
  const item = calDayItems(state.calActivePerson, ds)[index];
  if (!item) return;
  calPopulateFormFromItem(item);
  calEditingIndex = index;
  document.getElementById('addItemBtn').textContent = 'Update log entry';
  document.getElementById('cancelEditBtn').style.display = 'block';
  document.getElementById('bankStatus').textContent = 'Editing this entry — adjust values, then Update (or Cancel).';
}

// Fill the log form from a barcode-scanned Open Food Facts product (see scan.js).
// If the food already exists in the bank, the bank's own values win — same
// bank-first rule as the "Most logged" chips.
export function calApplyScannedProduct(product) {
  const name = ((product && (product.product_name_de || product.product_name)) || '').trim();
  const statusEl = document.getElementById('bankStatus');
  if (!name) { statusEl.textContent = 'Product found, but it has no name — enter it manually.'; return; }
  const bankEntry = calFindInBank(name);
  if (bankEntry) { calSelectBankEntry(bankEntry); return; }
  const n = product.nutriments || {};
  calEditingIndex = -1;
  calActiveBankEntry = null;
  document.getElementById('foodSearchInput').value = name;
  calApplyUnit('gram');
  document.getElementById('foodCalories').value = n['energy-kcal_100g'] != null ? Math.round(n['energy-kcal_100g']) : '';
  document.getElementById('foodProtein').value = n.proteins_100g != null ? calRound2(n.proteins_100g) : '';
  document.getElementById('foodCarbs').value = n.carbohydrates_100g != null ? calRound2(n.carbohydrates_100g) : '';
  document.getElementById('foodFat').value = n.fat_100g != null ? calRound2(n.fat_100g) : '';
  document.getElementById('addItemBtn').textContent = 'Add to log';
  document.getElementById('cancelEditBtn').style.display = 'none';
  calCloseDropdown();
  statusEl.textContent = '✓ Scanned "' + name + '" — values per 100g from Open Food Facts. Set the amount and category, then Add.';
}

// Reuses the same good/inprogress/bad convention as the month calendar: a metric that's
// not yet met still counts as "in progress" rather than "missed" while the day is today.
function calRingStatus(ds, isMet) {
  if (isMet) return 'good';
  return ds === todayStr() ? 'inprogress' : 'bad';
}

const CAL_RING_COLORS = { good: '--green-text', inprogress: '--amber-text', bad: '--red-text' };

function calProgressRing(title, centerValue, centerLabel, fraction, status) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = c * (1 - clamped);
  return `
    <div class="cal-ring-wrap">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--border)" stroke-width="11"></circle>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(${CAL_RING_COLORS[status]})" stroke-width="11"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          transform="rotate(-90 60 60)"></circle>
        <text x="60" y="57" text-anchor="middle" class="cal-ring-value">${centerValue}</text>
        <text x="60" y="75" text-anchor="middle" class="cal-ring-label">${centerLabel}</text>
      </svg>
      <div class="cal-ring-title">${title}</div>
    </div>
  `;
}

function calFoodItemRowHtml(it, i) {
  return `<div class="food-item">
        <span class="fi-name">${esc(it.name)}${it.grams ? ' <span style="color:var(--text-muted)">(' + it.grams + (it.unit === 'piece' ? ' pc)' : 'g)') + '</span>' : ''}</span>
        <span class="fi-macros">${Math.round(it.calories)} · ${Math.round(it.protein)}P · ${Math.round(it.carbs)}C · ${Math.round(it.fat)}F</span>
        <button class="fi-edit" data-i="${i}">&#9998;</button>
        <button class="fi-del" data-i="${i}">&times;</button>
      </div>`;
}

export function calRenderLogCard() {
  const ds = calSelectedDate();
  const items = calDayItems(state.calActivePerson, ds);
  calRenderStreakBadge();
  calRenderRecentChips();
  const listEl = document.getElementById('foodItemsList');
  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty" style="color:var(--text-muted); font-size:13px; padding:8px 0;">No food logged for this day yet.</div>';
  } else {
    const groups = {};
    items.forEach((it, i) => {
      const cat = it.category || 'Other';
      (groups[cat] || (groups[cat] = [])).push({ it, i });
    });
    const orderedCats = CAL_CATEGORIES.filter(c => groups[c]);
    Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });

    listEl.innerHTML = orderedCats.map(cat => `
      <div class="food-cat-title">${cat}</div>
      ${groups[cat].map(({ it, i }) => calFoodItemRowHtml(it, i)).join('')}
    `).join('');
  }
  listEl.querySelectorAll('.fi-edit').forEach(btn => {
    btn.addEventListener('click', () => calEditItem(parseInt(btn.dataset.i)));
  });
  listEl.querySelectorAll('.fi-del').forEach(btn => {
    btn.addEventListener('click', () => calDeleteItem(parseInt(btn.dataset.i)));
  });

  const totals = calDayTotals(state.calActivePerson, ds);
  const goal = calGoalsForDay(ds)[state.calActivePerson];
  const calMet = totals.calories <= goal.calories;
  const protMet = totals.protein >= goal.protein;
  const calStatus = calRingStatus(ds, calMet);
  const protStatus = calRingStatus(ds, protMet);
  const calLeft = Math.round(goal.calories - totals.calories);
  const protLeft = Math.round(goal.protein - totals.protein);

  const protLabel = protLeft > 0 ? 'g left' : protLeft === 0 ? 'goal met' : 'g extra';

  // Simple 40/30 macro split derived from the calorie goal: max 40% of calories from
  // carbs (4 kcal/g), max 30% from fat (9 kcal/g). Compared unrounded against the exact
  // summed totals; only the displayed "left/over" number is rounded.
  const carbGoal = (0.4 * goal.calories) / 4;
  const fatGoal = (0.3 * goal.calories) / 9;
  const carbLeft = carbGoal - totals.carbs;
  const fatLeft = fatGoal - totals.fat;
  // Same today-is-still-in-progress convention as the calorie/protein rings:
  // going over the cap mid-today shows amber, only a finished day shows red.
  const carbStatus = calRingStatus(ds, carbLeft >= 0);
  const fatStatus = calRingStatus(ds, fatLeft >= 0);

  document.getElementById('calRings').innerHTML =
    calProgressRing('Calories', Math.abs(calLeft), calLeft >= 0 ? 'kcal left' : 'kcal over', goal.calories > 0 ? totals.calories / goal.calories : 0, calStatus) +
    calProgressRing('Protein', Math.abs(protLeft), protLabel, goal.protein > 0 ? totals.protein / goal.protein : 0, protStatus) +
    calProgressRing('Carbs', Math.round(Math.abs(carbLeft)), carbLeft >= 0 ? 'g left' : 'g over', carbGoal > 0 ? totals.carbs / carbGoal : 0, carbStatus) +
    calProgressRing('Fat', Math.round(Math.abs(fatLeft)), fatLeft >= 0 ? 'g left' : 'g over', fatGoal > 0 ? totals.fat / fatGoal : 0, fatStatus);
}

document.getElementById('foodSearchInput').addEventListener('input', calOnFoodNameInput);
document.getElementById('foodSearchInput').addEventListener('input', () => {
  document.getElementById('foodSearchInput').classList.remove('input-error');
  document.getElementById('foodNameError').style.display = 'none';
});
document.getElementById('foodSearchInput').addEventListener('keydown', calOnFoodSearchKeydown);
document.getElementById('foodGrams').addEventListener('input', calOnGramsFieldInput);
document.getElementById('foodUnit').addEventListener('change', calOnUnitChange);
document.getElementById('googleSearchBtn').addEventListener('click', calSearchOnGoogle);
document.getElementById('addItemBtn').addEventListener('click', calAddItem);
document.getElementById('cancelEditBtn').addEventListener('click', calClearManualFields);
document.getElementById('calDatePicker').addEventListener('change', calRenderLogCard);
