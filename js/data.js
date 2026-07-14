// Pure data: training plans, the exercise-rename table, and calorie categories.
// No logic, no imports.



export const CAL_CATEGORIES = [
  'Fruits',
  'Vegetables',
  'Meat, Fish & Eggs',
  'Dairy',
  'Grains, Pasta & Rice',
  'Nuts & Oils',
  'Protein Supplements',
  'Snacks & Drinks',
  'Restaurant/Canteen',
  'Other'
];




export const DAY_ORDER = ['overview', 'day1', 'day2', 'day3', 'day4', 'day5', 'backcare'];
export const DAY_LABELS_TR = { overview: 'Overview', day1: 'Day 1', day2: 'Day 2', day3: 'Day 3', day4: 'Day 4', day5: 'Day 5', backcare: 'Back care' };

export const PLAN_P1 = {
  dayOrder: ['overview', 'day1', 'day2', 'day3', 'day4', 'day5', 'backcare'],
  overview: {
    goal: 'Upper-body focus while maintaining lower body, muscle maintenance/build + fat loss, better conditioning, compatible with playing tennis on unpredictable days. As of July 2026: layered with a growth specialization — chest, side delts, rear delts, arms (biceps/triceps), and abs are now dosed specifically for size, not just maintenance.',
    rules: [
      'Tennis days vary week to week, so this is a <strong>rotation, not a fixed weekly calendar</strong> — do the 5 days in any order that fits your week.',
      '<strong>Played tennis today or yesterday?</strong> Skip Day 3 (legs) or Day 5 (conditioning) that session — do an upper day instead. Tennis already loads legs and cardio hard.',
      '<strong>Avoid two upper days back-to-back</strong> where possible, so shoulders and elbows get at least a day between sessions.',
      '<strong>Every upper day opens with 5 minutes of rotator cuff / shoulder prehab</strong> — serves and overhead shots load the same joints as pressing.',
      '<strong>Growth-focused isolation work (flyes, lateral raises, curls, extensions, ab work) is meant to be taken close to failure</strong> (0-2 reps in reserve). Compound lifts stay at 2-3 reps in reserve on most sets to protect recovery and joints.'
    ],
    frequency: [
      ['Chest', 'Day 1, Day 4', '2x — now includes a stretch-focused flye, ~13 sets/wk (was 10)'],
      ['Side delts', 'Day 1, Day 4', '2x — upgraded from prehab-heavy to true growth volume, ~11-12 sets/wk (was 6)'],
      ['Rear delts', 'Day 2, Day 4', '2x — upgraded from prehab-only to dedicated hypertrophy work, ~10 sets/wk'],
      ['Back', 'Day 2, Day 4 (+ Day 5)', '2-3x'],
      ['Biceps', 'Day 2, Day 4', '2x direct, ~10 sets/wk (was 6) — arm-size specialization'],
      ['Triceps', 'Day 1, Day 4', '2x direct, ~10 sets/wk (was 6) — arm-size specialization'],
      ['Abs (loaded)', 'Day 3, Day 5', '2x — new direct hypertrophy work, ~6 sets/wk (was 0)'],
      ['Legs', 'Day 3 only (+ light touch Day 5)', '1x direct']
    ],
    notes: [
      '<strong>Fat loss</strong> comes primarily from nutrition — this training preserves/builds muscle and adds conditioning volume, but the calorie deficit is what drives fat loss.',
      '<strong>Progression:</strong> aim to add a little weight or 1-2 reps per exercise every 1-2 weeks. If you stall for 2+ sessions in a row, hold the weight and focus on form/tempo before pushing again.',
      '<strong>Med-ball rotational throws and rotational cable chops</strong> double as tennis-specific power work — they mimic trunk rotation used in groundstrokes and serves.',
      '<strong>Growth-specialization update (July 2026):</strong> chest, side/rear delts, arms, and abs were re-dosed for size. Day 1, Day 2, and Day 4 run roughly 10-15 min longer than before because of it — that\'s expected.'
    ]
  },
  day1: {
    title: 'Upper: push strength + chest/delt growth',
    duration: '55-60 min',
    gym: [
      ['Rotator cuff prehab (external rotation)', '3x15', 'https://www.muscleandstrength.com/exercises/cable-external-rotation'],
      ['Barbell bench press', '4x6-8', 'https://www.muscleandstrength.com/exercises/barbell-bench-press.html'],
      ['Overhead press', '3x8-10', 'https://www.muscleandstrength.com/exercises/military-press.html'],
      ['Incline dumbbell press', '3x10-12', 'https://www.muscleandstrength.com/exercises/incline-dumbbell-bench-press.html'],
      ['Cable or pec-deck fly', '3x12-15', 'https://www.muscleandstrength.com/exercises/cable-crossovers.html'],
      ['Cable lateral raise', '3x15-20', 'https://www.muscleandstrength.com/exercises/two-arm-cable-lateral-raise.html'],
      ['Leaning single-arm cable lateral raise', '3x15-20/side', 'https://www.youtube.com/watch?v=lq7eLC30b9w'],
      ['Triceps rope pushdown', '3x12-15', 'https://www.muscleandstrength.com/exercises/rope-tricep-extension.html']
    ],
    home: [
      ['Dumbbell external rotation', '3x15', 'https://www.muscleandstrength.com/exercises/bench-supported-dumbbell-external-rotation'],
      ['Dumbbell bench press (floor press if no bench)', '4x8-10', 'https://www.muscleandstrength.com/exercises/dumbbell-floor-press.html'],
      ['Dumbbell shoulder press', '3x8-10', 'https://www.muscleandstrength.com/exercises/standing-dumbbell-press.html'],
      ['Dumbbell fly', '3x12-15', 'https://www.muscleandstrength.com/exercises/dumbbell-flys.html'],
      ['Dumbbell close-grip floor press', '3x10-12', 'https://www.muscleandstrength.com/exercises/close-grip-dumbbell-press.html'],
      ['Dumbbell lateral raise', '3x15-20', 'https://www.muscleandstrength.com/exercises/dumbbell-lateral-raise.html'],
      ['Leaning dumbbell lateral raise', '3x15-20/side', 'https://www.youtube.com/watch?v=lq7eLC30b9w'],
      ['Dumbbell overhead triceps extension', '3x12-15', 'https://www.muscleandstrength.com/exercises/two-arm-dumbbell-extension.html']
    ],
  },
  day2: {
    title: 'Upper: pull strength + rear delt/bicep growth',
    duration: '55 min',
    gym: [
      ['Rotator cuff prehab (band pull-apart)', '3x15', 'https://www.muscleandstrength.com/exercises/supinated-90-degree-band-pull-apart'],
      ['Weighted pull-ups / lat pulldown', '4x8-10', 'https://www.muscleandstrength.com/exercises/lat-pull-down.html'],
      ['Seated cable row', '3x10-12', 'https://www.muscleandstrength.com/exercises/seated-row.html'],
      ['Chest-supported dumbbell row', '3x10-12', 'https://www.muscleandstrength.com/exercises/chest-supported-dumbbell-row'],
      ['Reverse pec-deck fly', '3x12-15', 'https://www.muscleandstrength.com/exercises/machine-reverse-fly'],
      ['Face pulls', '3x15', 'https://www.muscleandstrength.com/exercises/cable-face-pull'],
      ['Incline dumbbell curl', '3x10-12', 'https://www.muscleandstrength.com/exercises/incline-dumbbell-curl.html'],
      ['Preacher curl', '3x12', 'https://www.muscleandstrength.com/exercises/preacher-curl.html']
    ],
    home: [
      ['Dumbbell reverse fly (light, slow)', '3x15', 'https://www.muscleandstrength.com/exercises/bent-over-dumbbell-reverse-fly.html'],
      ['Heavy single-arm dumbbell row (main pull movement)', '4x8-10/side', 'https://www.muscleandstrength.com/exercises/one-arm-dumbbell-row.html'],
      ['Two-arm bent-over dumbbell row', '3x10-12', 'https://www.muscleandstrength.com/exercises/bent-over-dumbbell-row.html'],
      ['Chest-supported row lying face-down on a bench', '3x10-12', 'https://www.muscleandstrength.com/exercises/chest-supported-dumbbell-row'],
      ['Dumbbell rear delt fly, wide grip', '3x12-15', 'https://www.muscleandstrength.com/exercises/bent-over-dumbbell-reverse-fly.html'],
      ['Band face pull', '3x15', 'https://www.muscleandstrength.com/exercises/banded-face-pull'],
      ['Incline dumbbell curl', '3x10-12', 'https://www.muscleandstrength.com/exercises/incline-dumbbell-curl.html'],
      ['Dumbbell concentration curl', '3x12', 'https://www.muscleandstrength.com/exercises/concentration-cur.html']
    ],
  },
  day3: {
    title: 'Lower body + rotational core',
    duration: '45 min',
    gym: [
      ['Leg Press', '4x10', 'https://www.muscleandstrength.com/exercises/45-degree-leg-press.html'],
      ['Lying Leg Curl', '3x12', 'https://www.muscleandstrength.com/exercises/leg-curl.html'],
      ['Walking Lunges', '8/side', 'https://www.muscleandstrength.com/exercises/dumbbell-walking-lunge.html'],
      ['Abductor', '3x12', 'https://www.muscleandstrength.com/exercises/hip-abduction-machine.html'],
      ['Adductor', '3x12', 'https://www.muscleandstrength.com/exercises/hip-adduction-machine.html'],
      ['Back extension', '3x15', 'https://www.muscleandstrength.com/exercises/hyperextension.html'],
      ['Cable crunch', '3x12-15', 'https://www.muscleandstrength.com/exercises/cable-crunch.html']
    ],
    home: [
      ['Dumbbell goblet squat', '4x10', 'https://www.muscleandstrength.com/exercises/dumbbell-goblet-squat'],
      ['Dumbbell Romanian deadlift', '3x12', 'https://www.muscleandstrength.com/exercises/romanian-deadlift'],
      ['Dumbbell walking lunges', '8/side', 'https://www.muscleandstrength.com/exercises/dumbbell-walking-lunge.html'],
      ['Side-lying clam (band around knees if you have one)', '3x12/side', 'https://www.muscleandstrength.com/exercises/side-lying-clam'],
      ['Dumbbell sumo squat (inner thigh)', '3x12', 'https://www.muscleandstrength.com/exercises/sumo-squat.html'],
      ['Superman', '3x15', 'https://www.muscleandstrength.com/exercises/superman'],
      ['Weighted crunch', '3x12-15', 'https://www.muscleandstrength.com/exercises/weighted-crunch.html']
    ],
  },
  day4: {
    title: 'Upper: hypertrophy + arm/delt finisher',
    duration: '50-55 min',
    gym: [
      ['Incline dumbbell press', '3x10-12', 'https://www.muscleandstrength.com/exercises/incline-dumbbell-bench-press.html'],
      ['Dumbbell shoulder press', '3x10-12', 'https://www.muscleandstrength.com/exercises/standing-dumbbell-press.html'],
      ['Single-arm lat pulldown', '3x10-12/side', 'https://www.youtube.com/watch?v=eM162KNncD8'],
      ['Lateral raise + rear delt fly (superset)', '4x15 each', 'https://www.muscleandstrength.com/exercises/dumbbell-lateral-raise.html'],
      ['Hammer curl + skull crusher (superset)', '4x12 each', 'https://www.muscleandstrength.com/exercises/standing-hammer-curl.html'],
      ['Interval finisher (bike/row)', '10-12 min', null]
    ],
    home: [
      ['Dumbbell incline press (feet elevated, or bench)', '3x10-12', 'https://www.muscleandstrength.com/exercises/incline-dumbbell-bench-press.html'],
      ['Dumbbell shoulder press', '3x10-12', 'https://www.muscleandstrength.com/exercises/standing-dumbbell-press.html'],
      ['Single-arm dumbbell row, underhand grip', '3x10-12/side', 'https://www.muscleandstrength.com/exercises/one-arm-dumbbell-row.html'],
      ['Lateral raise + rear delt fly (superset)', '4x15 each', 'https://www.muscleandstrength.com/exercises/bent-over-dumbbell-reverse-fly.html'],
      ['Hammer curl + lying dumbbell triceps extension (superset)', '4x12 each', 'https://www.muscleandstrength.com/exercises/lying-dumbbell-extension.html'],
      ['Interval finisher: burpees, jump rope, or stair sprints', '10-12 min', 'https://www.youtube.com/watch?v=qLBImHhCXSw']
    ],
  },
  day5: {
    title: 'Full body metabolic + conditioning + ab growth',
    duration: '40-45 min',
    gym: [
      ['Kettlebell swings', '4x15', 'https://www.muscleandstrength.com/exercises/kettlebell-swing'],
      ['Push press', '3x8', 'https://www.muscleandstrength.com/exercises/push-press'],
      ['Renegade rows', '3x10/side', 'https://www.muscleandstrength.com/exercises/renegade-row'],
      ['Med-ball rotational throws', '3x10/side', 'https://www.muscleandstrength.com/exercises/rotational-med-ball-throw'],
      ['Hanging leg raise', '3x10-15', 'https://www.muscleandstrength.com/exercises/hanging-leg-raise.html'],
      ['Rotational cable chop', '3x12/side', 'https://www.muscleandstrength.com/exercises/wood-chop.html']
    ],
    home: [
      ['Single dumbbell swing (hinge, swing between legs)', '4x15', 'https://www.muscleandstrength.com/exercises/kettlebell-swing'],
      ['Dumbbell push press', '3x8', 'https://www.youtube.com/watch?v=B6EOz_LwRqU'],
      ['Renegade rows', '3x10/side', 'https://www.muscleandstrength.com/exercises/renegade-row'],
      ['Weighted Russian twists', '3x15/side', 'https://www.muscleandstrength.com/exercises/weighted-side-touches.html'],
      ['Hanging or lying leg raise', '3x10-15', 'https://www.muscleandstrength.com/exercises/hanging-leg-raise.html'],
      ['Single dumbbell diagonal woodchop', '3x12/side', 'https://www.muscleandstrength.com/exercises/wood-chop.html']
    ],
  },
  backcare: {
    intro: 'Tennis loads the lower back through rotation, serving (extension), and lateral movement — if it\'s tight or achy afterward, that\'s usually the surrounding muscles (core, glutes, hips) not doing their share. This builds that support without adding more spinal load. This is general supportive work, not treatment — if pain is sharp, radiates down a leg, comes with numbness/tingling, or persists or worsens over a few days, see a doctor or physiotherapist.',
    sections: [
      {
        title: 'Pre-tennis warm-up (5 min, before you play)',
        items: [
          ['Cat-cow', '10 reps', 'https://www.youtube.com/watch?v=y_cKHKi9UaM'],
          ['Kneeling hip flexor stretch', '30s/side', 'https://www.youtube.com/watch?v=Q4Ko275cluo'],
          ['90/90 hip rotations', '8/side', 'https://www.youtube.com/watch?v=f_7qIPxw6nE'],
          ['Glute bridge', '12 reps', 'https://www.muscleandstrength.com/exercises/bodyweight-glute-bridge']
        ]
      },
      {
        title: 'Core stability block (2-3x/week, e.g. after Day 3 or Day 5)',
        items: [
          ['Dead bug', '3x10/side', 'https://www.muscleandstrength.com/exercises/dead-bug'],
          ['Bird dog', '3x8/side', 'https://www.muscleandstrength.com/exercises/contralateral-bird-dog'],
          ['Side plank', '3x20-30s/side', 'https://www.muscleandstrength.com/exercises/side-hover.html'],
          ['Pallof press (band or cable)', '3x10/side', 'https://www.muscleandstrength.com/exercises/pallof-press'],
          ['Single-leg glute bridge', '3x12/side', 'https://www.muscleandstrength.com/exercises/single-leg-glute-bridge']
        ]
      },
      {
        title: 'Post-tennis cool-down stretch (5 min, right after playing)',
        items: [
          ["Child's pose", '30-45s', 'https://www.youtube.com/watch?v=jaCOZJPSy2g'],
          ['Knee-to-chest', '30s/side', 'https://www.youtube.com/watch?v=Yd9wY25koVk'],
          ['Seated spinal twist', '30s/side', 'https://www.youtube.com/watch?v=r5JuFoNzOU8'],
          ['Piriformis stretch (figure-4)', '30s/side', 'https://www.youtube.com/watch?v=-g0nuyTHMrI']
        ]
      }
    ],
    tightNote: 'On days the back feels tight or sore: ease off spinal-loaded moves rather than pushing through them — swap Romanian deadlift / deadlift / kettlebell swings for a goblet squat or leg press pattern that day. Keep the core stability block — it tends to help tightness rather than aggravate it. If it\'s not better within a few days, or gets worse, get it looked at.'
  }
};

export const PLAN_P2 = {
  dayOrder: ['overview', 'day1', 'day2', 'day3', 'day4'],
  overview: {
    goal: 'Build muscle and lean out while directly counteracting desk-job posture (rounded shoulders, weak upper back) — 4 gym sessions (45 min) + 1 separate Hyrox session per week.',
    rules: [
      'Rounded shoulders from desk work come from an imbalance: chest/front-shoulder muscles get tight and overused while the upper back and rear delts get weak and stretched out. The fix is tipping the training ratio toward <strong>pulling movements over pushing movements (roughly 2:1)</strong> so the upper back has the strength to actually hold the shoulders back.',
      '<strong>Every session includes at least one direct posture/upper-back exercise</strong>, not just on a dedicated "back day."',
      '<strong>Day 5 is Hyrox</strong> — a separate dedicated session. Don\'t add extra volume on top of it; this plan is built around it, not competing with it.',
      '<strong>Daily posture habit:</strong> a 30-second doorway chest stretch and a few band pull-aparts at the desk, a couple of times a day, does more for rounded shoulders over time than any single gym session.'
    ],
    frequency: [
      ['Upper back / posture', 'Day 1, Day 2, Day 3 (every session)', '4x'],
      ['Chest', 'Day 3 only', '1x (intentionally low — 2:1 pull:push ratio)'],
      ['Shoulders', 'Day 1, Day 3', '2x'],
      ['Glutes / posterior chain', 'Day 1, Day 2, Day 4', '3x'],
      ['Legs (quads)', 'Day 1, Day 4', '2x'],
      ['Core', 'Day 1, Day 3, Day 4', '3x']
    ],
    notes: [
      '<strong>Progression:</strong> add a little weight or 1-2 reps per exercise every 1-2 weeks where possible. If you stall for 2 sessions in a row, hold the weight and dial in form before pushing again.',
      '<strong>Nutrition:</strong> pairs with a target of ~1,700-1,900 kcal/day and ~115g protein — the protein target matters especially here since muscle building needs the raw material to work with.',
      'This is a different squat and hinge pattern from Day 1 to Day 4 (front/back squat vs. goblet squat, single-leg RDL vs. bilateral RDL) so the legs get real variety instead of repeating the same movement twice a week.'
    ]
  },
  day1: {
    title: 'Full body strength + upper back',
    duration: '45 min',
    gym: [
      ['Band pull-apart', '2x15', 'https://www.muscleandstrength.com/exercises/supinated-90-degree-band-pull-apart'],
      ['Wall slides', '2x10', 'https://www.muscleandstrength.com/exercises/scapular-wall-slide'],
      ['Goblet squat', '3x10-12', 'https://www.muscleandstrength.com/exercises/dumbbell-goblet-squat'],
      ['Chest-supported dumbbell row', '4x10-12', 'https://www.muscleandstrength.com/exercises/chest-supported-dumbbell-row'],
      ['Romanian deadlift', '3x10-12', 'https://www.muscleandstrength.com/exercises/romanian-deadlift'],
      ['Face pulls', '3x15', 'https://www.muscleandstrength.com/exercises/cable-face-pull'],
      ['Plank', '3x30-45s', 'https://www.muscleandstrength.com/exercises/hover.html']
    ]
  },
  day2: {
    title: 'Pull + posterior chain (posture priority day)',
    duration: '45 min',
    gym: [
      ['Band pull-apart', '2x15', 'https://www.muscleandstrength.com/exercises/supinated-90-degree-band-pull-apart'],
      ['Thoracic rotations', '8/side', 'https://www.youtube.com/watch?v=peeW19ofFUg'],
      ['Lat pulldown or assisted pull-up', '4x8-10', 'https://www.muscleandstrength.com/exercises/lat-pull-down.html'],
      ['Single-arm dumbbell row', '3x10-12/side', 'https://www.muscleandstrength.com/exercises/one-arm-dumbbell-row.html'],
      ['Reverse fly (rear delt)', '3x15', 'https://www.muscleandstrength.com/exercises/bent-over-dumbbell-reverse-fly.html'],
      ['Hip thrust', '3x10-12', 'https://www.muscleandstrength.com/exercises/barbell-hip-thrust'],
      ['Dumbbell bicep curl', '3x10-12', 'https://www.muscleandstrength.com/exercises/standing-dumbbell-curl.html']
    ]
  },
  day3: {
    title: 'Push + core stability',
    duration: '45 min',
    gym: [
      ['Doorway chest stretch', '2x30s', 'https://www.youtube.com/watch?v=M850sCj9LHQ'],
      ['Wall slides', '2x10', 'https://www.muscleandstrength.com/exercises/scapular-wall-slide'],
      ['Dumbbell bench press or incline press', '3x10-12', 'https://www.muscleandstrength.com/exercises/dumbbell-bench-press.html'],
      ['Dumbbell shoulder press', '3x10-12', 'https://www.muscleandstrength.com/exercises/standing-dumbbell-press.html'],
      ['Dumbbell lateral raise', '3x12-15', 'https://www.muscleandstrength.com/exercises/dumbbell-lateral-raise.html'],
      ['Face pulls', '3x15', 'https://www.muscleandstrength.com/exercises/cable-face-pull'],
      ['Dips (bench or parallel bar)', '3x10-12', 'https://www.muscleandstrength.com/exercises/tricep-dip.html'],
      ['Side plank', '2x20-30s/side', 'https://www.muscleandstrength.com/exercises/side-hover.html']
    ],
  },
  day4: {
    title: 'Lower body / hip strength',
    duration: '45 min',
    gym: [
      ['Hip flexor stretch', '2x30s/side', 'https://www.youtube.com/watch?v=Q4Ko275cluo'],
      ['Glute bridge', '2x10', 'https://www.muscleandstrength.com/exercises/bodyweight-glute-bridge'],
      ['Squat', '4x8-10', 'https://www.muscleandstrength.com/exercises/squat.html'],
      ['Walking lunges', '3x10/leg', 'https://www.muscleandstrength.com/exercises/dumbbell-walking-lunge.html'],
      ['Lying Leg Curl', '3x12', 'https://www.muscleandstrength.com/exercises/leg-curl.html'],
      ['Hip abduction', '3x15/side', 'https://www.muscleandstrength.com/exercises/hip-abduction-machine.html'],
      ['Hip adduction', '3x15/side', 'https://www.muscleandstrength.com/exercises/hip-adduction-machine.html'],
      ['Back extension', '3x15', 'https://www.muscleandstrength.com/exercises/hyperextension.html'],
      ['Cable crunch', '3x12-15', 'https://www.muscleandstrength.com/exercises/cable-crunch.html']
    ],
  }
};
export const TR_EXTRA_ACTIVITIES = { p1: ['Tennis'], p2: ['Hyrox', 'Runs'] };

// Mechanism for renaming an exercise that already has logged weights: map old name ->
// new name here and trApplyLegacyExerciseRenames() re-keys the logs on next load.
// Currently empty — the 2026-07 renames were verified fully applied to the synced data
// on 2026-07-13 and removed (see git history for the old entries).
export const TR_EXERCISE_RENAMES = {};

// One-time repair of frozen weekly thresholds (same self-healing pattern as
// TR_EXERCISE_RENAMES): on 2026-07-14 a stale client re-froze a past week with its own
// default thresholds, overwriting the original freeze. Each entry is
// [weekKey, knownBadValue, correctValue] — applied only while the stored value still
// exactly matches the bad one, so it's idempotent and can't touch anything else.
// Remove once verified applied to the synced data.
export const WK_FROZEN_FIXES = [
  ['2026-06-29', { nutrition: 5, screen: 5, sport: 5 }, { nutrition: 3, screen: 3, sport: 3 }]
];