const TESTS = [
  {
    id: 'fingerTapping',
    name: 'Finger taps',
    video: 'FingerTappingDemo.mp4',
    poster: 'FingerTappingDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.08 },
    steps: [
      'Hold the phone in your other hand, prop it up, or ask someone to point it at the hand you’re recording.',
      'Tap your index finger and thumb together.',
      'Make each tap as big and fast as you can. Repeat 10 times.',
    ],
  },
  {
    id: 'handMovements',
    name: 'Open and close',
    video: 'HandMovementsDemo.mp4',
    poster: 'HandMovementsDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.09 },
    steps: [
      'Hold the phone in your other hand, prop it up, or ask someone to point it at the hand you’re recording.',
      'Make a tight fist with your palm facing the phone.',
      'Open your hand wide and close it, 10 times, as fast as you can.',
    ],
  },
  {
    id: 'pronationSupination',
    name: 'Palm turns',
    video: 'HandTurnsDemo.mp4',
    poster: 'HandTurnsDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.09 },
    steps: [
      'Hold the phone in your other hand, prop it up, or ask someone to point it at the hand you’re recording.',
      'Stretch your arm out in front of you, palm facing down.',
      'Turn your palm up and down, 10 times, as fast as you can.',
    ],
  },
  {
    id: 'toeTapping',
    name: 'Toe taps',
    video: 'ToeTappingDemo.mp4',
    poster: 'ToeTappingDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.13 },
    steps: [
      'Sit in a chair with both feet flat on the floor.',
      'Prop up the phone, or ask someone to point it at the foot you’re recording.',
      'Keep your heel down and tap your toes 10 times, as big and fast as you can.',
    ],
  },
  {
    id: 'legAgility',
    name: 'Foot lifts',
    video: 'LegAgilityDemo.mp4',
    poster: 'LegAgilityDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.14 },
    steps: [
      'Sit in a chair with both feet flat on the floor.',
      'Prop up the phone, or ask someone to point it at the leg and foot you’re recording.',
      'Lift one foot and tap it firmly back down 10 times, as high and fast as you can.',
    ],
  },
  {
    id: 'arisingFromChair',
    name: 'Standing up',
    video: 'ChairDemo.mp4',
    poster: 'ChairDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.29 },
    steps: [
      'Sit back in a firm chair with your feet flat on the floor.',
      'Ask someone to hold the phone so your whole body and the chair stay in view.',
      'Cross your arms over your chest and stand up without using your hands. Repeat 3 times.',
    ],
  },
  {
    id: 'gait',
    name: 'Walking',
    video: 'WalkingDemo.mp4',
    poster: 'WalkingDemo.jpg',
    framing: { scale: 1, x: 0, y: 0 },
    steps: [
      'Ask someone to hold the phone and keep your legs and feet in view.',
      'Walk about 10 steps away from the phone.',
      'Turn around and walk back.',
    ],
  },
  {
    id: 'restTremor',
    name: 'Hands at rest',
    video: 'RestTremorDemo.mp4',
    poster: 'RestTremorDemo.jpg',
    framing: { scale: 1, x: 0, y: -0.15 },
    steps: [
      'Sit in a chair and rest your hands on the arms of the chair.',
      'Prop up the phone, or ask someone to hold it so your hands stay in view.',
      'Keep your hands relaxed and as still as you can for about 15 seconds.',
    ],
  },
];

const STORAGE_KEY = 'luche.video-framing.desktop.v1';
const DEFAULT_FRAMING = Object.freeze({ scale: 1, x: 0, y: 0 });
const MIN_SCALE = 1;
const MAX_SCALE = 2.5;
const MAX_OFFSET = 0.5;

const elements = {
  device: document.querySelector('#device'),
  deviceFit: document.querySelector('#device-fit'),
  video: document.querySelector('#demo-video'),
  mediaPosition: document.querySelector('#media-position'),
  mediaScale: document.querySelector('#media-scale'),
  gestureTarget: document.querySelector('#gesture-target'),
  instructionPanel: document.querySelector('#instruction-panel'),
  steps: document.querySelector('#steps'),
  taskSelect: document.querySelector('#task-select'),
  taskCount: document.querySelector('#task-count'),
  previousTask: document.querySelector('#previous-task'),
  nextTask: document.querySelector('#next-task'),
  scaleSlider: document.querySelector('#scale-slider'),
  xSlider: document.querySelector('#x-slider'),
  ySlider: document.querySelector('#y-slider'),
  scaleOutput: document.querySelector('#scale-output'),
  xOutput: document.querySelector('#x-output'),
  yOutput: document.querySelector('#y-output'),
  currentValue: document.querySelector('#current-value'),
  resetCurrent: document.querySelector('#reset-current'),
  copyCurrent: document.querySelector('#copy-current'),
  copyAll: document.querySelector('#copy-all'),
  downloadJson: document.querySelector('#download-json'),
  overlayToggle: document.querySelector('#overlay-toggle'),
  playToggle: document.querySelector('#play-toggle'),
  toast: document.querySelector('#toast'),
  phoneTime: document.querySelector('#phone-time'),
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function clampFraming(value) {
  const scale = clamp(Number(value.scale) || 1, MIN_SCALE, MAX_SCALE);
  return {
    scale,
    x: clamp(Number(value.x) || 0, -MAX_OFFSET, MAX_OFFSET),
    y: clamp(Number(value.y) || 0, -MAX_OFFSET, MAX_OFFSET),
  };
}

function loadDrafts() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return Object.fromEntries(
      TESTS.map((test) => [test.id, clampFraming(saved[test.id] || test.framing || DEFAULT_FRAMING)]),
    );
  } catch {
    return Object.fromEntries(TESTS.map((test) => [test.id, { ...DEFAULT_FRAMING }]));
  }
}

const state = {
  index: 0,
  drafts: loadDrafts(),
};

const pointers = new Map();
let gesture = null;
let toastTimer = null;
let safariGestureScale = 1;

function currentTest() {
  return TESTS[state.index];
}

function currentFraming() {
  return state.drafts[currentTest().id];
}

function formatFraming(value) {
  const framing = clampFraming(value);
  return `{ scale: ${framing.scale.toFixed(2)}, x: ${framing.x.toFixed(2)}, y: ${framing.y.toFixed(2)} }`;
}

function saveDrafts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drafts));
}

function setFraming(next) {
  state.drafts[currentTest().id] = clampFraming(next);
  saveDrafts();
  renderFraming();
}

function renderFraming() {
  const framing = currentFraming();
  elements.mediaPosition.style.transform = `translate(${framing.x * 402}px, ${framing.y * 874}px)`;
  elements.mediaScale.style.transform = `scale(${framing.scale})`;

  elements.scaleSlider.value = String(framing.scale);
  elements.xSlider.min = String(-MAX_OFFSET);
  elements.xSlider.max = String(MAX_OFFSET);
  elements.ySlider.min = String(-MAX_OFFSET);
  elements.ySlider.max = String(MAX_OFFSET);
  elements.xSlider.value = String(framing.x);
  elements.ySlider.value = String(framing.y);

  elements.scaleOutput.value = `${framing.scale.toFixed(2)}×`;
  elements.xOutput.value = framing.x.toFixed(2);
  elements.yOutput.value = framing.y.toFixed(2);
  elements.currentValue.textContent = `demoFraming: ${formatFraming(framing)},`;
}

function renderTask() {
  const test = currentTest();
  elements.taskSelect.value = test.id;
  elements.taskCount.textContent = `${state.index + 1} of ${TESTS.length} · ${test.id}`;
  elements.video.poster = `../../assets/demos/posters/${test.poster}`;
  elements.video.src = `../../assets/demos/${test.video}`;
  elements.video.load();
  if (elements.playToggle.checked) elements.video.play().catch(() => {});

  elements.steps.replaceChildren(
    ...test.steps.map((text) => {
      const row = document.createElement('div');
      row.className = 'step';
      const mark = document.createElement('span');
      mark.className = 'step-mark';
      mark.textContent = '✣';
      const copy = document.createElement('span');
      copy.textContent = text;
      row.append(mark, copy);
      return row;
    }),
  );
  renderFraming();
}

function selectTask(index) {
  state.index = (index + TESTS.length) % TESTS.length;
  renderTask();
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 1500);
}

async function copyText(text, message) {
  await navigator.clipboard.writeText(text);
  showToast(message);
}

function allValuesText() {
  return TESTS.map((test) => `${test.id}: ${formatFraming(state.drafts[test.id])}`).join(',\n');
}

function resizeDevice() {
  const panel = document.querySelector('.preview-panel');
  const availableWidth = Math.max(280, panel.clientWidth - 52);
  const availableHeight = Math.max(520, panel.clientHeight - 38);
  const scale = Math.min(1, availableWidth / 402, availableHeight / 874);
  elements.deviceFit.style.width = `${402 * scale}px`;
  elements.deviceFit.style.height = `${874 * scale}px`;
  elements.device.style.transform = `scale(${scale})`;
}

function pointerSnapshot() {
  const values = [...pointers.values()];
  if (values.length === 1) return { mode: 'drag', point: values[0], framing: currentFraming() };
  if (values.length >= 2) {
    const [a, b] = values;
    return {
      mode: 'pinch',
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      framing: currentFraming(),
    };
  }
  return null;
}

function updateGesture() {
  const values = [...pointers.values()];
  if (!gesture || values.length === 0) return;
  const rect = elements.gestureTarget.getBoundingClientRect();

  if (values.length >= 2) {
    if (gesture.mode !== 'pinch') gesture = pointerSnapshot();
    const [a, b] = values;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ratio = gesture.distance > 0 ? distance / gesture.distance : 1;
    setFraming({
      scale: gesture.framing.scale * ratio,
      x: gesture.framing.x + (center.x - gesture.center.x) / rect.width,
      y: gesture.framing.y + (center.y - gesture.center.y) / rect.height,
    });
    return;
  }

  if (gesture.mode !== 'drag') gesture = pointerSnapshot();
  const point = values[0];
  setFraming({
    ...gesture.framing,
    x: gesture.framing.x + (point.x - gesture.point.x) / rect.width,
    y: gesture.framing.y + (point.y - gesture.point.y) / rect.height,
  });
}

elements.gestureTarget.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  elements.gestureTarget.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  gesture = pointerSnapshot();
});

elements.gestureTarget.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  updateGesture();
});

function endPointer(event) {
  pointers.delete(event.pointerId);
  gesture = pointerSnapshot();
}

elements.gestureTarget.addEventListener('pointerup', endPointer);
elements.gestureTarget.addEventListener('pointercancel', endPointer);

elements.gestureTarget.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const sensitivity = event.ctrlKey ? 0.012 : 0.0025;
    const nextScale = currentFraming().scale * Math.exp(-event.deltaY * sensitivity);
    setFraming({ ...currentFraming(), scale: nextScale });
  },
  { passive: false },
);

// Safari emits dedicated gesture events for a Mac trackpad pinch.
elements.gestureTarget.addEventListener('gesturestart', (event) => {
  event.preventDefault();
  safariGestureScale = currentFraming().scale;
});
elements.gestureTarget.addEventListener('gesturechange', (event) => {
  event.preventDefault();
  setFraming({ ...currentFraming(), scale: safariGestureScale * event.scale });
});

elements.scaleSlider.addEventListener('input', () =>
  setFraming({ ...currentFraming(), scale: Number(elements.scaleSlider.value) }),
);
elements.xSlider.addEventListener('input', () =>
  setFraming({ ...currentFraming(), x: Number(elements.xSlider.value) }),
);
elements.ySlider.addEventListener('input', () =>
  setFraming({ ...currentFraming(), y: Number(elements.ySlider.value) }),
);

elements.previousTask.addEventListener('click', () => selectTask(state.index - 1));
elements.nextTask.addEventListener('click', () => selectTask(state.index + 1));
elements.taskSelect.addEventListener('change', () =>
  selectTask(TESTS.findIndex((test) => test.id === elements.taskSelect.value)),
);
elements.resetCurrent.addEventListener('click', () => {
  setFraming({ ...(currentTest().framing || DEFAULT_FRAMING) });
  showToast('Current framing reset');
});
elements.copyCurrent.addEventListener('click', () =>
  copyText(elements.currentValue.textContent, 'Current value copied'),
);
elements.copyAll.addEventListener('click', () => copyText(allValuesText(), 'All values copied'));
elements.downloadJson.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.drafts, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'luche-video-framing.json';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('JSON downloaded');
});
elements.overlayToggle.addEventListener('change', () =>
  elements.instructionPanel.classList.toggle('hidden', !elements.overlayToggle.checked),
);
elements.playToggle.addEventListener('change', () => {
  if (elements.playToggle.checked) elements.video.play().catch(() => {});
  else elements.video.pause();
});

window.addEventListener('keydown', (event) => {
  if (['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const framing = currentFraming();
  const panStep = event.shiftKey ? 0.02 : 0.005;
  const scaleStep = event.shiftKey ? 0.1 : 0.02;
  const changes = {
    ArrowLeft: { x: framing.x - panStep },
    ArrowRight: { x: framing.x + panStep },
    ArrowUp: { y: framing.y - panStep },
    ArrowDown: { y: framing.y + panStep },
    '+': { scale: framing.scale + scaleStep },
    '=': { scale: framing.scale + scaleStep },
    '-': { scale: framing.scale - scaleStep },
  }[event.key];
  if (!changes) return;
  event.preventDefault();
  setFraming({ ...framing, ...changes });
});

for (const test of TESTS) {
  const option = document.createElement('option');
  option.value = test.id;
  option.textContent = test.name;
  elements.taskSelect.append(option);
}

const now = new Date();
elements.phoneTime.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
window.addEventListener('resize', resizeDevice);
resizeDevice();
renderTask();
