// ============================================================
// Totally Wild AI — Roadmap UI
// Gantt-style timeline view for project issues. Loaded as a
// regular <script> tag after sprints-ui.js, so everything here
// lives on the global scope and freely uses helpers from app.js
// + tasks-ui.js: state, api(), esc(), openIssueDetail(),
// ISSUE_TYPE_ICONS, etc.
// ============================================================

(function () {
  // Initialise state defaults
  if (!('roadmapZoom' in state.ui)) state.ui.roadmapZoom = 'week';
  state.tasks = state.tasks || {};
  if (!state.tasks.roadmapIssues) state.tasks.roadmapIssues = [];
})();

// ── Constants ────────────────────────────────────────────────
const ROADMAP_BAR_COLORS = {
  todo:        '#0065FF',
  in_progress: '#D97706',
  in_review:   '#8B5CF6',
  done:        '#16A34A'
};

const ROADMAP_ZOOM_CONFIG = {
  day:   { colWidth: 36,  label: 'Day' },
  week:  { colWidth: 80,  label: 'Week' },
  month: { colWidth: 100, label: 'Month' }
};

const ROW_HEIGHT   = 40;
const LABEL_WIDTH  = 250;
const MIN_RANGE_MS = 28 * 24 * 60 * 60 * 1000; // 4 weeks
const PAD_MS       = 7  * 24 * 60 * 60 * 1000;  // 1 week

// ── Helpers ──────────────────────────────────────────────────

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d) {
  const r = new Date(d);
  const day = r.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function diffDays(a, b) {
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function formatHeaderDate(d, zoom) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (zoom === 'day') {
    return d.getDate() + ' ' + months[d.getMonth()];
  }
  if (zoom === 'week') {
    return d.getDate() + ' ' + months[d.getMonth()];
  }
  // month
  return months[d.getMonth()] + ' ' + d.getFullYear();
}

// ── Column generation ────────────────────────────────────────

function generateColumns(rangeStart, rangeEnd, zoom) {
  const cols = [];
  if (zoom === 'day') {
    let cur = new Date(rangeStart);
    while (cur <= rangeEnd) {
      cols.push({ start: new Date(cur), end: addDays(cur, 1) });
      cur = addDays(cur, 1);
    }
  } else if (zoom === 'week') {
    let cur = startOfWeek(rangeStart);
    while (cur <= rangeEnd) {
      const end = addDays(cur, 7);
      cols.push({ start: new Date(cur), end: end });
      cur = end;
    }
  } else {
    // month
    let cur = startOfMonth(rangeStart);
    while (cur <= rangeEnd) {
      const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      cols.push({ start: new Date(cur), end: end });
      cur = end;
    }
  }
  return cols;
}

// ── Date range calculation ───────────────────────────────────

function computeRange(issues) {
  const today = startOfDay(new Date());
  let earliest = today;
  let latest = today;

  for (const issue of issues) {
    if (issue.start_at) {
      const s = startOfDay(new Date(issue.start_at));
      if (s < earliest) earliest = s;
      if (s > latest) latest = s;
    }
    if (issue.due_at) {
      const d = startOfDay(new Date(issue.due_at));
      if (d < earliest) earliest = d;
      if (d > latest) latest = d;
    }
  }

  let rangeStart = new Date(earliest.getTime() - PAD_MS);
  let rangeEnd   = new Date(latest.getTime() + PAD_MS);

  // Enforce minimum 4-week range
  if (rangeEnd - rangeStart < MIN_RANGE_MS) {
    const mid = rangeStart.getTime() + (rangeEnd - rangeStart) / 2;
    rangeStart = new Date(mid - MIN_RANGE_MS / 2);
    rangeEnd   = new Date(mid + MIN_RANGE_MS / 2);
  }

  return { rangeStart: startOfDay(rangeStart), rangeEnd: startOfDay(rangeEnd) };
}

// ── Bar position calculation ─────────────────────────────────

function barPosition(issue, rangeStart, columns, zoom) {
  const colWidth = ROADMAP_ZOOM_CONFIG[zoom].colWidth;
  const totalWidth = columns.length * colWidth;
  const rangeMs = columns[columns.length - 1].end.getTime() - rangeStart.getTime();

  const today = startOfDay(new Date());
  let barStart, barEnd;

  if (issue.start_at && issue.due_at) {
    barStart = startOfDay(new Date(issue.start_at));
    barEnd   = startOfDay(new Date(issue.due_at));
  } else if (issue.due_at) {
    barEnd   = startOfDay(new Date(issue.due_at));
    barStart = addDays(barEnd, -1);
  } else if (issue.start_at) {
    barStart = startOfDay(new Date(issue.start_at));
    const sevenDaysOut = addDays(barStart, 7);
    barEnd = today > sevenDaysOut ? today : sevenDaysOut;
  } else {
    return null;
  }

  const leftPct  = (barStart - rangeStart) / rangeMs;
  const rightPct = (barEnd - rangeStart) / rangeMs;

  const left  = Math.max(0, Math.round(leftPct * totalWidth));
  const width = Math.max(4, Math.round((rightPct - leftPct) * totalWidth));

  return { left, width };
}

// ── Today line position ──────────────────────────────────────

function todayPosition(rangeStart, columns, zoom) {
  const colWidth = ROADMAP_ZOOM_CONFIG[zoom].colWidth;
  const totalWidth = columns.length * colWidth;
  const rangeMs = columns[columns.length - 1].end.getTime() - rangeStart.getTime();
  const today = startOfDay(new Date());
  const pct = (today - rangeStart) / rangeMs;
  return Math.round(pct * totalWidth);
}

// ── Main render ──────────────────────────────────────────────

async function renderRoadmapTab() {
  const body = document.getElementById('tasks-tab-body');
  if (!body) return;

  const projectId = state.ui.tasksProjectId;
  if (!projectId) {
    body.innerHTML = '<p style="padding:1rem;color:var(--muted)">No project selected.</p>';
    return;
  }

  body.innerHTML = '<p style="padding:1rem;color:var(--muted)">Loading roadmap…</p>';

  const zoom = state.ui.roadmapZoom || 'week';

  try {
    const res = await api('GET', '/api/projects/' + encodeURIComponent(projectId) + '/roadmap');
    if (!res || !res.issues) {
      body.innerHTML = '<p style="padding:1rem;color:var(--muted)">' + esc((res && res.error) || 'Failed to load roadmap') + '</p>';
      return;
    }
    state.tasks.roadmapIssues = res.issues;
    renderRoadmapContent(body, res.issues, zoom);
  } catch (err) {
    body.innerHTML = '<p style="padding:1rem;color:var(--danger,red)">Error loading roadmap.</p>';
  }
}
window.renderRoadmapTab = renderRoadmapTab;

function renderRoadmapContent(body, issues, zoom) {
  const dated   = issues.filter(function (i) { return i.start_at || i.due_at; });
  const undated = issues.filter(function (i) { return !i.start_at && !i.due_at; });

  const { rangeStart, rangeEnd } = computeRange(issues);
  const columns = generateColumns(rangeStart, rangeEnd, zoom);
  const colWidth = ROADMAP_ZOOM_CONFIG[zoom].colWidth;
  const totalWidth = columns.length * colWidth;
  const todayLeft = todayPosition(rangeStart, columns, zoom);

  // ── Controls ───────────────────────────────────────────
  let controlsHtml = '<div class="roadmap-controls">';
  controlsHtml += '<div class="roadmap-zoom-group">';
  ['day', 'week', 'month'].forEach(function (z) {
    const active = z === zoom ? ' active' : '';
    controlsHtml += '<button class="btn btn-sm' + active + '" onclick="setRoadmapZoom(\'' + z + '\')">'
      + ROADMAP_ZOOM_CONFIG[z].label + '</button>';
  });
  controlsHtml += '</div>';
  controlsHtml += '<button class="btn btn-sm btn-ghost" onclick="scrollRoadmapToToday()">Today</button>';
  controlsHtml += '</div>';

  // ── Header cells ───────────────────────────────────────
  let headerHtml = '<div class="roadmap-header" style="width:' + totalWidth + 'px;">';
  columns.forEach(function (col) {
    const isToday = zoom === 'day' && startOfDay(col.start).getTime() === startOfDay(new Date()).getTime();
    const todayCls = isToday ? ' roadmap-header-today' : '';
    headerHtml += '<div class="roadmap-header-cell' + todayCls + '" style="width:' + colWidth + 'px;">'
      + formatHeaderDate(col.start, zoom) + '</div>';
  });
  headerHtml += '</div>';

  // ── Issue rows (dated) ─────────────────────────────────
  let rowsHtml = '';
  dated.forEach(function (issue) {
    const pos = barPosition(issue, rangeStart, columns, zoom);
    const statusClass = 'roadmap-bar-' + (issue.status || 'todo');
    const color = ROADMAP_BAR_COLORS[issue.status] || ROADMAP_BAR_COLORS.todo;
    const typeIcon = ISSUE_TYPE_ICONS[issue.type] || ISSUE_TYPE_ICONS.task;
    const title = esc(issue.title || '');
    const key = esc(issue.issue_key || '');

    rowsHtml += '<div class="roadmap-row" style="height:' + ROW_HEIGHT + 'px;">';
    // Label
    rowsHtml += '<div class="roadmap-label" style="width:' + LABEL_WIDTH + 'px;" '
      + 'onclick="openIssueDetail(\'' + esc(issue.id) + '\')" title="' + title + '">'
      + typeIcon + ' <span class="roadmap-label-key">' + key + '</span> '
      + '<span class="roadmap-label-title">' + title + '</span></div>';
    // Bar area
    if (pos) {
      rowsHtml += '<div class="roadmap-bar ' + statusClass + '" '
        + 'style="left:' + (LABEL_WIDTH + pos.left) + 'px;width:' + pos.width + 'px;background:' + color + ';" '
        + 'title="' + key + ' — ' + title + '" '
        + 'onclick="openIssueDetail(\'' + esc(issue.id) + '\')">'
        + '</div>';
    }
    rowsHtml += '</div>';
  });

  // ── Undated issues ─────────────────────────────────────
  let undatedHtml = '';
  if (undated.length > 0) {
    undatedHtml = '<div class="roadmap-no-dates">';
    undatedHtml += '<div class="roadmap-no-dates-header">No dates (' + undated.length + ')</div>';
    undated.forEach(function (issue) {
      const typeIcon = ISSUE_TYPE_ICONS[issue.type] || ISSUE_TYPE_ICONS.task;
      const title = esc(issue.title || '');
      const key = esc(issue.issue_key || '');
      undatedHtml += '<div class="roadmap-row roadmap-row-undated" style="height:' + ROW_HEIGHT + 'px;">';
      undatedHtml += '<div class="roadmap-label" style="width:' + LABEL_WIDTH + 'px;" '
        + 'onclick="openIssueDetail(\'' + esc(issue.id) + '\')" title="' + title + '">'
        + typeIcon + ' <span class="roadmap-label-key">' + key + '</span> '
        + '<span class="roadmap-label-title">' + title + '</span></div>';
      undatedHtml += '</div>';
    });
    undatedHtml += '</div>';
  }

  // ── Today line ─────────────────────────────────────────
  const datedRowsHeight = dated.length * ROW_HEIGHT;
  const todayLineHtml = '<div class="roadmap-today-line" style="left:' + (LABEL_WIDTH + todayLeft) + 'px;height:' + Math.max(datedRowsHeight, 200) + 'px;"></div>';

  // ── Grid lines (column separators) ─────────────────────
  let gridLinesHtml = '';
  columns.forEach(function (col, i) {
    const x = LABEL_WIDTH + i * colWidth;
    gridLinesHtml += '<div class="roadmap-grid-line" style="left:' + x + 'px;height:' + Math.max(datedRowsHeight, 200) + 'px;"></div>';
  });

  // ── Assemble ───────────────────────────────────────────
  let html = controlsHtml;
  html += '<div class="roadmap-container">';
  html += '<div class="roadmap-scroll" id="roadmap-scroll">';
  html += '<div class="roadmap-grid" style="width:' + (LABEL_WIDTH + totalWidth) + 'px;position:relative;">';
  // Sticky header area
  html += '<div style="padding-left:' + LABEL_WIDTH + 'px;">' + headerHtml + '</div>';
  // Rows area (relative for bar positioning)
  html += '<div class="roadmap-rows-area" style="position:relative;">';
  html += gridLinesHtml;
  html += todayLineHtml;
  html += rowsHtml;
  html += '</div>';
  html += '</div>'; // grid
  html += '</div>'; // scroll
  html += undatedHtml;
  html += '</div>'; // container

  body.innerHTML = html;

  // Scroll to today
  scrollRoadmapToToday();
}

// ── Zoom control ─────────────────────────────────────────────

function setRoadmapZoom(zoom) {
  if (!ROADMAP_ZOOM_CONFIG[zoom]) zoom = 'week';
  state.ui.roadmapZoom = zoom;
  const body = document.getElementById('tasks-tab-body');
  if (body && state.tasks.roadmapIssues) {
    renderRoadmapContent(body, state.tasks.roadmapIssues, zoom);
  }
}
window.setRoadmapZoom = setRoadmapZoom;

// ── Scroll to today ──────────────────────────────────────────

function scrollRoadmapToToday() {
  var scrollEl = document.getElementById('roadmap-scroll');
  if (!scrollEl) return;
  // Find today line position from its style
  var todayLine = scrollEl.querySelector('.roadmap-today-line');
  if (!todayLine) return;
  var left = parseInt(todayLine.style.left, 10) || 0;
  // Center today in the visible area
  var visibleWidth = scrollEl.clientWidth;
  scrollEl.scrollLeft = Math.max(0, left - LABEL_WIDTH - visibleWidth / 2 + LABEL_WIDTH);
}
window.scrollRoadmapToToday = scrollRoadmapToToday;
