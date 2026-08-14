const ui = {
  root: document.querySelector('#root-chip'),
  videoList: document.querySelector('#video-list'),
  preview: document.querySelector('#source-preview'),
  checkpoint: document.querySelector('#checkpoint'),
  selectAll: document.querySelector('#select-all'),
  name: document.querySelector('#experiment-name'),
  run: document.querySelector('#run'),
  job: document.querySelector('#job-status'),
  experiments: document.querySelector('#experiments'),
  template: document.querySelector('#video-row-template'),
};

let state = null;
let defaults = null;
let selected = new Set();
let currentJob = null;

const clone = (value) => JSON.parse(JSON.stringify(value));

function formatBytes(value) {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function pathValue(object, path) {
  return path.split('.').reduce((value, key) => value[key], object);
}

function setPathValue(object, path, value) {
  const keys = path.split('.');
  const target = keys.slice(0, -1).reduce((result, key) => result[key], object);
  target[keys.at(-1)] = value;
}

function populateSettings(settings) {
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const value = pathValue(settings, input.dataset.setting);
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
    updateOutput(input);
  });
}

function readSettings() {
  const settings = clone(defaults);
  document.querySelectorAll('[data-setting]').forEach((input) => {
    let value;
    if (input.type === 'checkbox') value = input.checked;
    else if (input.type === 'number' || input.type === 'range') value = Number(input.value);
    else value = input.value;
    setPathValue(settings, input.dataset.setting, value);
  });
  return settings;
}

function updateOutput(input) {
  const output = document.querySelector(`[data-output="${input.dataset.setting}"]`);
  if (output) output.value = `${Number(input.value).toFixed(1)}×`;
}

function renderVideos() {
  ui.videoList.innerHTML = '';
  if (!state.videos.length) {
    ui.videoList.innerHTML = '<p class="muted">No videos found in the sample folder.</p>';
    return;
  }
  state.videos.forEach((video) => {
    const row = ui.template.content.firstElementChild.cloneNode(true);
    const checkbox = row.querySelector('input');
    checkbox.checked = selected.has(video.name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(video.name);
      else selected.delete(video.name);
    });
    row.querySelector('strong').textContent = video.name;
    row.querySelector('small').textContent = formatBytes(video.size_bytes);
    row.querySelector('.preview-button').addEventListener('click', (event) => {
      event.preventDefault();
      showSource(video.name);
    });
    ui.videoList.append(row);
  });
  ui.selectAll.textContent = selected.size === state.videos.length ? 'Clear' : 'Select all';
}

function showSource(name) {
  ui.preview.classList.remove('empty');
  ui.preview.innerHTML = `<video controls playsinline preload="metadata" src="/media/source/${encodeURIComponent(name)}"></video><span>${escapeHtml(name)}</span>`;
}

function renderCheckpoints() {
  ui.checkpoint.innerHTML = '';
  if (!state.checkpoints.length) {
    ui.checkpoint.innerHTML = '<option value="">No valid checkpoint folders</option>';
    return;
  }
  state.checkpoints.forEach((checkpoint) => {
    const option = document.createElement('option');
    option.value = checkpoint.id;
    option.textContent = `${checkpoint.id} · ${checkpoint.backend} · ${checkpoint.keypoint_schema}`;
    ui.checkpoint.append(option);
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function percent(value, total) {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function renderExperiments() {
  ui.experiments.innerHTML = '';
  if (!state.experiments.length) {
    ui.experiments.innerHTML = '<div class="empty-results">No experiments yet. Your first run will appear here.</div>';
    return;
  }
  state.experiments.forEach((experiment) => {
    const card = document.createElement('article');
    card.className = `experiment-card ${experiment.status}`;
    const face = experiment.settings?.boxes?.face || {};
    const body = experiment.settings?.boxes?.body || {};
    const results = (experiment.results || []).map((result) => {
      const stats = result.stats || {};
      return `<div class="output-item">
        <video controls playsinline preload="metadata" src="${encodeURI(result.overlay_url)}"></video>
        <div class="output-meta">
          <strong>${escapeHtml(result.video)}</strong>
          <span>${percent(stats.frames_with_face_box, stats.frames_processed)} face · ${percent(stats.frames_with_body_box, stats.frames_processed)} body</span>
          <span class="cache ${result.landmark_cache_hit ? 'hit' : ''}">${result.landmark_cache_hit ? 'cached landmarks' : 'fresh inference'}</span>
        </div>
      </div>`;
    }).join('');
    card.innerHTML = `
      <div class="experiment-topline">
        <div><span class="experiment-id">${escapeHtml(experiment.id)}</span><h3>${escapeHtml(experiment.name)}</h3></div>
        <span class="status ${experiment.status}">${escapeHtml(experiment.status)}</span>
      </div>
      <div class="recipe-strip">
        <span>MODEL <b>${escapeHtml(experiment.checkpoint?.id || 'unknown')}</b></span>
        <span>FACE <b>L${face.pad_left} T${face.pad_top} R${face.pad_right} B${face.pad_bottom} · ${face.height_scale}×</b></span>
        <span>BODY <b>X${body.pad_x} T${body.pad_top} B${body.pad_bottom}</b></span>
        <span>STRIDE <b>${experiment.settings?.inference?.sample_stride_frames}</b></span>
      </div>
      ${experiment.error ? `<p class="error-box">${escapeHtml(experiment.error)}</p>` : ''}
      <div class="output-list">${results || '<p class="muted">Output pending…</p>'}</div>
      <div class="card-footer">
        <span>${escapeHtml(experiment.directory)}</span>
        <button type="button" class="reveal">Show in Finder</button>
      </div>`;
    card.querySelector('.reveal').addEventListener('click', () => reveal(experiment.directory));
    ui.experiments.append(card);
  });
}

async function reveal(directory) {
  await fetch('/api/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory }),
  });
}

const presets = {
  production(settings) {
    return settings;
  },
  'wide-face'(settings) {
    Object.assign(settings.boxes.face, { pad_left: 0.65, pad_top: 1.10, pad_right: 0.65, pad_bottom: 0.80, height_scale: 2.2 });
    return settings;
  },
  'tight-face'(settings) {
    Object.assign(settings.boxes.face, { pad_left: 0.20, pad_top: 0.55, pad_right: 0.20, pad_bottom: 0.35, height_scale: 1.5 });
    return settings;
  },
  'tight-body'(settings) {
    Object.assign(settings.boxes.body, { pad_x: 0.16, pad_top: 0.12, pad_bottom: 0.10, min_pad_x: 0.04, min_pad_top: 0.04, min_pad_bottom: 0.05 });
    return settings;
  },
  dense(settings) {
    settings.inference.sample_stride_frames = 1;
    return settings;
  },
};

const presetNames = {
  production: 'production parity',
  'wide-face': 'wider face coverage',
  'tight-face': 'tighter face box',
  'tight-body': 'tighter body box',
  dense: 'dense every-frame pose scan',
};

document.querySelector('#presets').addEventListener('click', (event) => {
  const button = event.target.closest('[data-preset]');
  if (!button) return;
  const key = button.dataset.preset;
  populateSettings(presets[key](clone(defaults)));
  ui.name.value = presetNames[key];
  document.querySelectorAll('#presets button').forEach((item) => item.classList.toggle('active', item === button));
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-setting]')) updateOutput(event.target);
});

ui.selectAll.addEventListener('click', () => {
  const shouldSelect = selected.size !== state.videos.length;
  selected = shouldSelect ? new Set(state.videos.map((video) => video.name)) : new Set();
  renderVideos();
  ui.selectAll.textContent = shouldSelect ? 'Clear' : 'Select all';
});

ui.run.addEventListener('click', runExperiment);

async function runExperiment() {
  if (!selected.size) {
    showJob({ status: 'failed', message: 'Select at least one source video.' });
    return;
  }
  if (!ui.checkpoint.value) {
    showJob({ status: 'failed', message: 'Add or select a checkpoint folder.' });
    return;
  }
  ui.run.disabled = true;
  showJob({ status: 'queued', message: 'Allocating a new experiment folder…', fraction: 0 });
  try {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ui.name.value,
        videos: [...selected],
        checkpoint: ui.checkpoint.value,
        settings: readSettings(),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not start experiment');
    currentJob = payload.id;
    pollJob();
  } catch (error) {
    ui.run.disabled = false;
    showJob({ status: 'failed', message: error.message });
  }
}

async function pollJob() {
  if (!currentJob) return;
  try {
    const response = await fetch(`/api/jobs/${currentJob}`);
    const job = await response.json();
    showJob(job);
    if (job.status === 'completed' || job.status === 'failed') {
      currentJob = null;
      ui.run.disabled = false;
      await loadState(false);
      return;
    }
  } catch (error) {
    showJob({ status: 'failed', message: error.message });
  }
  setTimeout(pollJob, 700);
}

function showJob(job) {
  ui.job.classList.remove('hidden');
  ui.job.className = `job-status ${job.status || ''}`;
  const fraction = Math.max(0, Math.min(1, Number(job.fraction || 0)));
  ui.job.innerHTML = `<div class="job-copy"><strong>${escapeHtml(job.experiment_id || job.status || 'Experiment')}</strong><span>${escapeHtml(job.message || '')}</span></div><div class="progress"><i style="width:${fraction * 100}%"></i></div>`;
}

async function loadState(initial = true) {
  const response = await fetch('/api/state');
  state = await response.json();
  defaults ||= state.defaults;
  ui.root.textContent = state.root;
  if (initial) {
    populateSettings(defaults);
    selected = new Set(state.videos.map((video) => video.name));
  }
  renderVideos();
  renderCheckpoints();
  renderExperiments();
}

loadState().catch((error) => {
  document.body.innerHTML = `<main class="fatal"><h1>Pose lab could not start</h1><p>${escapeHtml(error.message)}</p></main>`;
});
