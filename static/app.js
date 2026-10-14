const root = document.getElementById('app');
const toastRoot = document.getElementById('toast-root');

const state = {
  user: null,
  dashboard: null,
  questions: [],
  view: 'landing',
  authMode: 'signup',
  pendingAction: null,
  filters: { search: '', chapter: '', topic: '', difficulty: '', type: '', status: '', tag: '' },
  questionId: null,
  returnView: 'bank',
  selected: [],
  numeric: '',
  hints: [],
  hintsUsed: 0,
  solution: null,
  solutionViewed: false,
  result: null,
  submitting: false,
  questionStarted: null,
  timerHandle: null,
  history: null,
  sessionId: null,
  sessionQueue: [],
  sessionIndex: 0,
  lastLevel: null
};

const typeNames = {
  single_choice: 'Single correct',
  multiple_choice: 'Multiple correct',
  numerical: 'Numerical answer',
  matching: 'Matching list'
};

const allAchievements = [
  { id: 'first-question', name: 'First Step', description: 'Submit your first question.', icon: '✳' },
  { id: 'streak-3', name: 'Three in a Row', description: 'Practice on three consecutive days.', icon: '🔥' },
  { id: 'streak-7', name: 'Week of Focus', description: 'Practice on seven consecutive days.', icon: '◷' },
  { id: 'solved-10', name: 'Ten Solved', description: 'Solve ten different questions correctly.', icon: '✓' },
  { id: 'correct-10', name: 'Accuracy Builder', description: 'Submit ten correct answers.', icon: '◎' },
  { id: 'session-5', name: 'In the Zone', description: 'Complete five questions in one session.', icon: '↗' },
  { id: 'paper-1', name: 'Paper One Complete', description: 'Attempt every question in this paper.', icon: '▤' }
];

function esc(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function initials(name) {
  return String(name || 'Student').trim().split(/\s+/).slice(0, 2).map(function (part) {
    return part.charAt(0).toUpperCase();
  }).join('');
}

async function api(path, options) {
  const settings = options || {};
  const request = {
    method: settings.method || 'GET',
    credentials: 'same-origin',
    headers: settings.body ? { 'Content-Type': 'application/json' } : {}
  };
  if (settings.body) request.body = JSON.stringify(settings.body);
  const response = await fetch(path, request);
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function showToast(message) {
  toastRoot.innerHTML = '<div class="toast">' + esc(message) + '</div>';
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(function () { toastRoot.innerHTML = ''; }, 3100);
}

function clearTimer() {
  if (state.timerHandle) window.clearInterval(state.timerHandle);
  state.timerHandle = null;
}

function startTimer() {
  clearTimer();
  updateTimer();
  state.timerHandle = window.setInterval(updateTimer, 1000);
}

function updateTimer() {
  const timer = document.getElementById('timer-value');
  if (!timer || !state.questionStarted) return;
  const seconds = Math.max(0, Math.floor((Date.now() - state.questionStarted) / 1000));
  timer.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function currentQuestion() {
  return state.questions.find(function (question) { return question.id === state.questionId; }) || null;
}

function levelProgress(profile) {
  const value = profile || {};
  return Math.max(0, Math.min(100, 100 * (value.xpInLevel || 0) / Math.max(1, value.xpToNextLevel || 100)));
}

function formatType(type) {
  return typeNames[type] || 'Question';
}

function formatDifficulty(difficulty) {
  return String(difficulty || 'medium').charAt(0).toUpperCase() + String(difficulty || 'medium').slice(1);
}

function formatDate(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

function answerLabel(answer) {
  if (Array.isArray(answer)) return answer.join(', ');
  return String(answer == null ? '' : answer);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function brand(caption) {
  return '<a class="brand-lockup" href="#" data-action="go-home" aria-label="Edusnap home">' +
    '<img class="brand-mark" src="/edusnap-learning-badge.png" alt="" aria-hidden="true">' +
    '<span><span class="brand-name">Edusnap</span><span class="brand-caption">' + esc(caption || 'JEE Mathematics') + '</span></span></a>';
}

function navLink(view, icon, label, activeView) {
  const active = activeView === view || (activeView === 'question' && (
    (state.returnView === 'bank' && view === 'bank') ||
    (state.returnView === 'session' && view === 'bank')
  ));
  return '<button class="nav-link ' + (active ? 'active' : '') + '" data-action="navigate" data-view="' + view + '">' +
    '<span class="nav-icon" aria-hidden="true">' + icon + '</span><span>' + label + '</span></button>';
}

function renderShell(content, activeView) {
  const profile = state.dashboard && state.dashboard.profile ? state.dashboard.profile : state.user;
  const name = profile ? profile.name : 'Student';
  const streak = profile ? profile.current_streak || 0 : 0;
  root.innerHTML =
    '<div class="shell">' +
      '<aside class="sidebar">' +
        brand() +
        '<div class="nav-label">Workspace</div>' +
        '<nav class="side-nav" aria-label="Main navigation">' +
          navLink('dashboard', '⌂', 'Overview', activeView) +
          navLink('bank', '⌕', 'Question bank', activeView) +
          navLink('progress', '↗', 'Your progress', activeView) +
          navLink('history', '◷', 'History', activeView) +
        '</nav>' +
        '<div class="sidebar-spacer"></div>' +
        '<div class="daily-note"><div class="daily-note-label">A note to self</div><strong>Small steps, sharp thinking.</strong><p>One good problem can change how you see a whole topic.</p></div>' +
        '<div class="profile-switcher"><span class="avatar">' + esc(initials(name)) + '</span>' +
          '<span class="profile-copy"><strong>' + esc(name) + '</strong><span>Level ' + esc(profile && profile.level || 1) + ' learner</span></span>' +
          '<button class="icon-button" title="Log out" aria-label="Log out" data-action="logout">↗</button>' +
        '</div>' +
      '</aside>' +
      '<main class="main-area">' +
        '<header class="topbar"><div class="crumbs"><span>Edusnap</span><span> / </span><strong>' + esc(pageTitle(activeView)) + '</strong></div>' +
          '<div class="topbar-actions">' +
          '<span class="top-streak"><span>✦</span>' + streak + ' day streak</span>' +
          '<span class="avatar" title="' + esc(name) + '">' + esc(initials(name)) + '</span>' +
          '<button class="icon-button mobile-logout" title="Log out" aria-label="Log out" data-action="logout">↗</button>' +
          '</div>' +
        '</header>' + content +
      '</main>' +
    '</div>';
  if (activeView === 'question') startTimer();
  else clearTimer();
}

function pageTitle(view) {
  if (view === 'dashboard') return 'Overview';
  if (view === 'bank') return 'Question bank';
  if (view === 'progress') return 'Your progress';
  if (view === 'history') return 'Question history';
  if (view === 'session-complete') return 'Practice complete';
  return 'Practice';
}

function renderLanding() {
  clearTimer();
  root.innerHTML =
    '<div class="public-home">' +
      '<header class="public-nav">' + brand('Learn in a Snap.') +
        '<div class="public-nav-actions">' +
          '<button class="button button-quiet" data-action="auth-login">Log in</button>' +
          '<button class="button button-primary button-small" data-action="auth-signup">Create account <span>↗</span></button>' +
        '</div>' +
      '</header>' +
      '<section class="public-hero">' +
        '<div class="eyebrow">Edusnap JEE Mathematics</div>' +
        '<h1>Learn in a<br><em>Snap.</em></h1>' +
        '<p>Practice smarter. Track your progress. Master JEE Mathematics with real questions, thoughtful feedback and clear solutions.</p>' +
        '<div class="public-hero-actions">' +
          '<button class="button button-primary" data-action="start-session">Start Practicing <span>→</span></button>' +
          '<button class="button button-secondary" data-action="navigate" data-view="bank">Explore Questions</button>' +
        '</div>' +
      '</section>' +
      '<div class="public-rule"></div>' +
      '<section class="public-stats" aria-label="Question paper overview">' +
        '<div class="public-stat"><strong>16</strong><span>questions from Paper 1</span></div>' +
        '<div class="public-stat"><strong>4</strong><span>answer formats</span></div>' +
        '<div class="public-stat"><strong>∞</strong><span>room to improve</span></div>' +
        '<div class="public-stat"><strong>01</strong><span>problem at a time</span></div>' +
      '</section>' +
      '<footer class="public-footer"><div class="public-footer-brand"><strong>Edusnap</strong><span>Learn in a Snap.</span></div>' +
        '<span class="public-footer-description">JEE Mathematics Practice Platform</span>' +
        '<span class="public-footnote">JEE Advanced 2026 · Paper 1 · Mathematics</span></footer>' +
    '</div>';
}

function renderAuth() {
  clearTimer();
  const signup = state.authMode === 'signup';
  const nameField = signup
    ? '<label><span class="field-label">Your name</span><input class="field-input" name="name" autocomplete="name" required maxlength="80" placeholder="How should we address you?"></label>'
    : '';
  root.innerHTML =
    '<div class="auth-screen">' +
      '<section class="auth-story">' +
        brand('Learn in a Snap.') +
        '<div class="auth-story-copy"><div class="eyebrow">Make every session count</div>' +
          '<h1>' + (signup ? 'Welcome to Edusnap.' : 'Learn in a Snap.') + '</h1>' +
          '<p>' + (signup ? 'Create your account and start building your JEE Mathematics problem-solving skills.' : 'Build consistency through rigorous questions, considered hints and progress that belongs to you.') + '</p>' +
        '</div>' +
        '<div class="auth-paper-note">JEE ADVANCED 2026 &nbsp;·&nbsp; PAPER 1</div>' +
      '</section>' +
      '<section class="auth-panel"><div class="auth-form-wrap">' +
        '<button class="auth-back" data-action="auth-back">← Back</button>' +
        '<h2>' + (signup ? 'Welcome to Edusnap' : 'Welcome back to Edusnap') + '</h2>' +
        '<p>' + (signup ? 'Your practice history and progress will be saved here.' : 'Pick up where you left off.') + '</p>' +
        '<form id="auth-form" class="auth-fields">' + nameField +
          '<label><span class="field-label">Email address</span><input class="field-input" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>' +
          '<label><span class="field-label">Password</span><input class="field-input" name="password" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" required minlength="8" maxlength="200" placeholder="' + (signup ? 'At least 8 characters' : 'Your password') + '"></label>' +
          '<div id="auth-error" hidden></div>' +
          '<button class="button button-primary auth-submit" type="submit">' + (signup ? 'Create account' : 'Log in') + ' <span>→</span></button>' +
        '</form>' +
        '<p class="auth-switch">' + (signup ? 'Already have an account?' : 'New to Edusnap?') +
          ' <button data-action="' + (signup ? 'auth-login' : 'auth-signup') + '">' + (signup ? 'Log in' : 'Create an account') + '</button></p>' +
      '</div></section>' +
    '</div>';
}

function metricCard(label, value, note, symbol) {
  return '<article class="card metric-card"><span class="metric-symbol">' + symbol + '</span>' +
    '<div class="metric-label">' + label + '</div><div class="metric-value">' + value + '</div>' +
    '<div class="metric-foot">' + note + '</div></article>';
}

function renderGoalCard(dashboard) {
  const profile = dashboard.profile;
  const goal = profile.daily_goal || 5;
  const done = dashboard.todayCompleted || 0;
  const pct = Math.min(100, Math.round(100 * done / Math.max(goal, 1)));
  return '<section class="card panel goal-card">' +
    '<div class="panel-heading"><div><h2>Today’s focus</h2><p>A steady rhythm adds up.</p></div><span class="goal-mark">◎</span></div>' +
    '<div class="goal-top"><div><div class="goal-count">' + done + ' <small>/ ' + goal + ' questions</small></div>' +
      '<div class="goal-caption">' + (dashboard.goalBonusAwarded ? 'Daily goal completed · +20 XP earned' : 'Your daily practice goal') + '</div></div>' +
      '<div class="goal-controls" aria-label="Adjust daily goal"><button title="Reduce daily goal" data-action="goal-down">−</button><button title="Increase daily goal" data-action="goal-up">+</button></div>' +
    '</div>' +
    '<div class="goal-track"><span style="width:' + pct + '%"></span></div>' +
    '<div class="goal-footer"><span>' + (pct >= 100 ? 'Goal complete. Nice work.' : 'Keep your streak moving.') + '</span><span>' + pct + '%</span></div>' +
  '</section>';
}

function renderChapters(chapters, compact) {
  if (!chapters || !chapters.length) return '<p class="weak-empty">Chapter progress will appear as you practice.</p>';
  const sorted = chapters.slice().sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
  const shown = compact ? sorted.slice(0, 5) : sorted;
  return '<div class="chapter-list">' + shown.map(function (item) {
    return '<div class="chapter-row"><div class="chapter-name">' + esc(item.name) +
      '<small>' + item.solved + ' of ' + item.total + ' solved</small></div>' +
      '<div class="progress-track"><span style="width:' + item.progress + '%"></span></div>' +
      '<div class="chapter-percent">' + item.progress + '%</div></div>';
  }).join('') + '</div>';
}

function renderRecent(recent) {
  if (!recent || !recent.length) {
    return '<div class="empty-state">Your attempts will show up here.<br>Choose a question to begin.</div>';
  }
  return '<div class="activity-list">' + recent.map(function (item) {
    const correct = !!item.is_correct;
    const reward = (item.xp_earned || 0) + (item.goal_bonus_xp || 0);
    return '<button class="activity-row" data-action="open-question" data-id="' + esc(item.question_id) + '">' +
      '<span class="activity-check ' + (correct ? 'correct' : 'incorrect') + '">' + (correct ? '✓' : '×') + '</span>' +
      '<span><span class="activity-title">Question ' + esc(item.questionNumber || '—') + ' · ' + esc(item.title || item.topic) + '</span>' +
      '<span class="activity-meta">' + esc(item.chapter) + ' · ' + esc(formatDate(item.attempted_at)) + '</span></span>' +
      '<span class="activity-xp ' + (reward ? '' : 'zero') + '">' + (reward ? '+' + reward + ' XP' : '0 XP') + '</span></button>';
  }).join('') + '</div>';
}

function renderWeakAreas(weakAreas) {
  if (!weakAreas || !weakAreas.length) {
    return '<p class="weak-empty">Try a few questions and your topic-level patterns will take shape here.</p>';
  }
  return '<div class="weak-list">' + weakAreas.map(function (item) {
    return '<div class="weak-row"><strong>' + esc(item.name) + '</strong><span>' + item.accuracy + '% accuracy</span></div>';
  }).join('') + '</div>';
}

function renderDashboard() {
  const dashboard = state.dashboard;
  const profile = dashboard.profile;
  const progress = levelProgress(profile);
  return '<div class="page-wrap">' +
    '<div class="page-heading"><div><div class="eyebrow">Your study space</div><h1>' + greeting() + ', ' + esc(profile.name.split(/\s+/)[0]) + '.</h1>' +
      '<p class="subtitle">A little focused practice goes a long way. Ready for a good problem?</p></div>' +
      '<button class="button button-primary" data-action="start-session">Begin a 5-question session <span>→</span></button></div>' +
    '<div class="dashboard-grid"><div class="dashboard-main">' +
      '<section class="welcome-hero"><div class="hero-content"><div class="hero-kicker">JEE Advanced · Paper 1</div>' +
        '<h2>Clarity comes<br>one question at a time.</h2><p>Work through this year’s Mathematics paper with hints, solutions and progress saved to your account.</p>' +
        '<button class="button hero-action" data-action="start-session">Start quick practice <span>→</span></button></div>' +
        '<div class="hero-side-note">16 QUESTIONS&nbsp; / &nbsp;4 FORMATS</div></section>' +
      '<section class="metric-grid">' +
        metricCard('Questions solved', profile.questions_solved, 'of ' + dashboard.questionCount + ' in the paper', '✓') +
        metricCard('Accuracy', dashboard.accuracy + '<small>%</small>', profile.questions_attempted + ' attempts so far', '◎') +
        metricCard('Total experience', profile.total_xp + '<small>XP</small>', 'Level ' + profile.level + ' learner', '✳') +
        metricCard('Longest streak', profile.longest_streak + '<small>days</small>', 'Current: ' + profile.current_streak + ' days', '◷') +
      '</section>' +
      '<section class="card panel"><div class="panel-heading"><div><h2>Chapter progress</h2><p>Correctly solved questions across the available paper.</p></div>' +
        '<button class="inline-link" data-action="navigate" data-view="progress">See all →</button></div>' +
        renderChapters(dashboard.chapters, true) + '</section>' +
    '</div><aside class="dashboard-aside">' +
      renderGoalCard(dashboard) +
      '<section class="card panel"><div class="panel-heading"><div><h2>Level ' + profile.level + '</h2><p>' + profile.xpInLevel + ' of ' + profile.xpToNextLevel + ' XP to level ' + profile.nextLevel + '</p></div><span class="goal-mark">✳</span></div>' +
        '<div class="progress-track"><span style="width:' + progress + '%"></span></div>' +
        '<div class="goal-footer" style="margin-top:9px"><span>' + profile.total_xp + ' total XP</span><span>Level ' + profile.nextLevel + '</span></div></section>' +
      '<section class="card panel"><div class="panel-heading"><div><h2>Areas to revisit</h2><p>From your concept-level accuracy.</p></div></div>' + renderWeakAreas(dashboard.weakAreas) + '</section>' +
      '<section class="card panel activity-panel"><div class="panel-heading"><div><h2>Recent activity</h2><p>Your latest question attempts.</p></div>' +
        '<button class="inline-link" data-action="navigate" data-view="history">View history →</button></div>' +
        renderRecent(dashboard.recentActivity) + '</section>' +
    '</aside></div></div>';
}

function uniqueValues(field) {
  return Array.from(new Set(state.questions.map(function (question) { return question[field]; }).filter(Boolean))).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function uniqueTopics() {
  const topics = [];
  state.questions.forEach(function (question) {
    (question.topics || [question.topic]).forEach(function (topic) { topics.push(topic); });
  });
  return Array.from(new Set(topics)).sort(function (a, b) { return a.localeCompare(b); });
}

function allTags() {
  const tags = [];
  state.questions.forEach(function (question) {
    (question.conceptTags || []).concat(question.skillTags || []).forEach(function (tag) { tags.push(tag); });
  });
  return Array.from(new Set(tags)).sort(function (a, b) { return a.localeCompare(b); });
}

function filterSelect(label, key, values, placeholder) {
  return '<label><span class="field-label">' + label + '</span><select class="field-select" data-filter="' + key + '">' +
    '<option value="">' + placeholder + '</option>' +
    values.map(function (value) {
      const selected = state.filters[key] === value ? ' selected' : '';
      const display = key === 'type' ? formatType(value) :
        key === 'status' ? (value === 'correct' ? 'Solved' : value === 'incorrect' ? 'Attempted' : 'Unsolved') :
        key === 'difficulty' ? formatDifficulty(value) : value;
      return '<option value="' + esc(value) + '"' + selected + '>' + esc(display) + '</option>';
    }).join('') + '</select></label>';
}

function filteredQuestions() {
  const filters = state.filters;
  return state.questions.filter(function (question) {
    if (filters.chapter && question.chapter !== filters.chapter) return false;
    if (filters.topic && !(question.topics || [question.topic]).includes(filters.topic)) return false;
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false;
    if (filters.type && question.questionType !== filters.type) return false;
    if (filters.status && question.status !== filters.status) return false;
    if (filters.tag && !(question.conceptTags || []).concat(question.skillTags || []).includes(filters.tag)) return false;
    const search = filters.search.trim().toLowerCase();
    if (search && !(question.shortTitle + ' ' + question.questionText + ' ' + question.chapter + ' ' + question.topic).toLowerCase().includes(search)) return false;
    return true;
  }).sort(function (a, b) { return a.questionNumber - b.questionNumber; });
}

function renderQuestionRows(questions) {
  if (!questions.length) return '<div class="empty-state">No questions match these filters.<br>Try changing a filter or search term.</div>';
  return questions.map(function (question) {
    const tags = (question.conceptTags || []).slice(0, 2);
    return '<button class="question-row" data-action="open-question" data-id="' + esc(question.id) + '">' +
      '<span class="question-index">' + String(question.questionNumber).padStart(2, '0') + '</span>' +
      '<span><span class="question-title">' + esc(question.shortTitle) + '</span>' +
        '<span class="question-detail"><span>' + esc(question.chapter) + '</span><i class="detail-dot"></i><span>' + esc(question.topic) + '</span>' +
          '<i class="detail-dot"></i><span class="difficulty-pill ' + esc(question.difficulty) + '">' + esc(formatDifficulty(question.difficulty)) + '</span>' +
          '<span class="type-pill">' + esc(formatType(question.questionType)) + '</span></span>' +
        '<span class="question-tags">' + tags.map(function (tag) { return '<span class="tag">' + esc(tag) + '</span>'; }).join('') + '</span>' +
      '</span><span class="row-status ' + esc(question.status) + '"><i class="status-dot"></i>' +
        (question.status === 'correct' ? 'Solved' : question.status === 'incorrect' ? 'Attempted' : 'Unsolved') + '</span>' +
      '<span class="row-arrow">›</span></button>';
  }).join('');
}

function renderBank() {
  const questions = filteredQuestions();
  const topics = uniqueTopics().filter(function (topic) {
    return !state.filters.chapter || state.questions.some(function (question) {
      return question.chapter === state.filters.chapter && (question.topics || [question.topic]).includes(topic);
    });
  });
  const filtersHtml =
    '<div class="card filter-panel"><div class="filter-grid">' +
      '<label class="search-filter"><span class="field-label">Search</span><input class="field-input" id="question-search" value="' + esc(state.filters.search) + '" placeholder="Try “matrices” or “continuity”" type="search"></label>' +
      filterSelect('Chapter', 'chapter', uniqueValues('chapter'), 'All chapters') +
      filterSelect('Topic', 'topic', topics, 'All topics') +
      filterSelect('Difficulty', 'difficulty', uniqueValues('difficulty'), 'Any level') +
      filterSelect('Question type', 'type', uniqueValues('questionType').map(function (type) { return type; }), 'Any format') +
      filterSelect('Status', 'status', ['unsolved', 'incorrect', 'correct'], 'All questions') +
      filterSelect('Tag', 'tag', allTags(), 'Any tag') +
    '</div></div>';
  return '<div class="page-wrap">' +
    '<div class="page-heading"><div><div class="eyebrow">JEE Advanced · Paper 1</div><h1>Question bank</h1>' +
      '<p class="subtitle">Sixteen Mathematics problems. Four answer formats. Choose a question and take your time.</p></div>' +
      '<button class="button button-primary" data-action="start-session">Quick practice <span>→</span></button></div>' +
    filtersHtml +
    '<div class="result-bar"><span id="result-count">' + questions.length + ' questions</span><span>Sort: paper order</span></div>' +
    '<section class="card question-list" id="question-list">' + renderQuestionRows(questions) + '</section></div>';
}

function renderAnswerArea(question) {
  if (question.questionType === 'numerical') {
    return '<div class="numerical-wrap"><input id="numerical-answer" class="field-input numerical-input" type="number" inputmode="decimal" step="any" placeholder="Enter a numerical value" value="' + esc(state.numeric) + '" ' + (state.result ? 'disabled' : '') + '></div>';
  }
  const multiple = question.questionType === 'multiple_choice';
  const selected = multiple ? state.selected : [state.selected[0] || ''];
  return '<div class="option-list">' + (question.options || []).map(function (option) {
    const active = selected.includes(option.key);
    const right = state.result && state.result.correctAnswer;
    let answerClass = active ? ' selected' : '';
    if (state.result && right) {
      const correctSet = Array.isArray(right) ? right : [right];
      if (correctSet.includes(option.key)) answerClass += ' answer-correct';
    }
    return '<button type="button" class="answer-option' + answerClass + '" data-action="select-answer" data-key="' + esc(option.key) + '" aria-pressed="' + active + '" ' + (state.result ? 'disabled' : '') + '>' +
      '<span class="option-marker">' + esc(option.key) + '</span><span>' + esc(option.text) + '</span></button>';
  }).join('') + '</div>';
}

function renderFeedback() {
  if (!state.result) return '';
  const correct = state.result.correct;
  const earned = state.result.xpEarned + state.result.goalBonusXp;
  const answer = answerLabel(state.result.correctAnswer);
  const message = correct
    ? state.result.xpEarned
      ? 'Correct. That is ' + state.result.xpEarned + ' XP well earned.'
      : 'Correct. XP for this question has already been earned.'
    : 'Not quite. Take a moment to review the reasoning below.';
  return '<div class="feedback-box ' + (correct ? 'correct' : 'incorrect') + '">' +
    '<span class="feedback-icon">' + (correct ? '✓' : '↺') + '</span><span class="feedback-copy"><strong>' +
      (correct ? 'Good reasoning.' : 'Keep working the idea.') + '</strong><span>' + esc(message) +
        (!correct ? ' Correct answer: ' + esc(answer) + '.' : '') +
        (state.result.goalBonusXp ? ' Daily goal complete: +' + state.result.goalBonusXp + ' bonus XP.' : '') +
        (earned > 0 ? ' +' + earned + ' XP added.' : '') + '</span></span></div>';
}

function renderSolution() {
  if (!state.solution) return '';
  const steps = Array.isArray(state.solution) ? state.solution : [String(state.solution)];
  return '<section class="solution-panel"><h3>Worked solution</h3>' +
    steps.map(function (step, index) { return '<div class="solution-step"><strong>' + (index + 1) + '.</strong> ' + esc(step) + '</div>'; }).join('') +
    '</section>';
}

function renderQuestion() {
  const question = currentQuestion();
  if (!question) {
    state.view = 'bank';
    renderApp();
    return;
  }
  const progressIndex = state.returnView === 'session' ? state.sessionIndex + 1 : question.questionNumber;
  const progressTotal = state.returnView === 'session' ? state.sessionQueue.length : state.questions.length;
  const progressPct = Math.round(100 * progressIndex / Math.max(progressTotal, 1));
  const answerTitle = question.questionType === 'multiple_choice' ? 'Select all that apply' :
    question.questionType === 'numerical' ? 'Enter your answer' :
    question.questionType === 'matching' ? 'Choose the matching combination' : 'Choose one answer';
  let nextLabel = 'Next question';
  if (state.returnView === 'session' && state.sessionIndex === state.sessionQueue.length - 1) nextLabel = 'Finish practice';
  const sessionLabel = state.returnView === 'session'
    ? '<span class="session-progress">SESSION ' + (state.sessionIndex + 1) + ' / ' + state.sessionQueue.length +
      '<span class="session-progress-track"><span style="width:' + progressPct + '%"></span></span></span>'
    : '<span class="question-position">Question ' + question.questionNumber + ' / ' + state.questions.length +
      '<span class="mini-track"><span style="width:' + progressPct + '%"></span></span></span>';
  const hintHtml = state.hints.map(function (hint, index) {
    return '<div class="hint-copy"><strong>Hint ' + (index + 1) + '.</strong> ' + esc(hint) + '</div>';
  }).join('');
  const hasMoreHints = state.hintsUsed < question.hintsCount;
  const body =
    '<div class="page-wrap">' +
      '<div class="question-topline"><button class="button button-quiet button-small" data-action="return-from-question">← ' + (state.returnView === 'session' ? 'End session' : state.returnView === 'history' ? 'Back to history' : 'Question bank') + '</button>' +
        sessionLabel + '<span class="question-position" aria-label="Time spent">◷ <span id="timer-value">00:00</span></span></div>' +
      '<div class="question-layout"><div class="question-main">' +
        '<article class="card question-card">' +
          '<div class="eyebrow">' + esc(question.exam) + ' ' + question.year + ' · Paper ' + question.paper + ' · Section ' + question.section + ' · Q.' + question.questionNumber + '</div>' +
          '<h1>' + esc(question.shortTitle) + '</h1>' +
          '<div class="question-meta"><span class="tag">' + esc(question.chapter) + '</span><span class="tag">' + esc(question.topic) + '</span>' +
            '<span class="meta-sep"></span><span class="difficulty-pill ' + esc(question.difficulty) + '">' + esc(formatDifficulty(question.difficulty)) + '</span>' +
            '<span class="type-pill">' + esc(formatType(question.questionType)) + '</span><span class="xp-chip">✳ +' + question.xp + ' XP</span></div>' +
          '<div class="question-body">' + esc(question.questionText) + '</div>' +
          '<div class="answer-title">' + answerTitle + (question.questionType === 'multiple_choice' ? '<span>— more than one may be correct</span>' : '') + '</div>' +
          renderAnswerArea(question) +
          '<div class="answer-actions">' +
            '<span class="submit-help">' + (state.result ? (state.result.attemptNumber > 1 ? 'Attempt ' + state.result.attemptNumber : 'Answer saved to your history') : 'Your answer and progress are saved when you submit.') + '</span>' +
            (state.result ? '<button class="button button-primary" data-action="next-question">' + nextLabel + ' <span>→</span></button>' :
              '<button class="button button-primary" data-action="submit-answer" ' + (state.submitting ? 'disabled' : '') + '>' + (state.submitting ? 'Checking…' : 'Submit answer') + ' <span>→</span></button>') +
          '</div>' +
          renderFeedback() +
          (state.result ? '<div class="answer-actions"><span class="submit-help">Want to understand the method?</span><button class="button button-secondary button-small" data-action="show-solution" ' + (state.solution ? 'disabled' : '') + '>' + (state.solution ? 'Solution opened' : 'View solution') + '</button></div>' : '') +
          renderSolution() +
        '</article>' +
      '</div>' +
      '<aside class="question-aside">' +
        '<section class="card aside-card"><div class="aside-heading"><span class="bulb">✦</span> Build a hint</div>' +
          hintHtml + '<button class="hint-action" data-action="show-hint" ' + (hasMoreHints ? '' : 'disabled') + '><span>' + (hasMoreHints ? 'Reveal hint ' + (state.hintsUsed + 1) : 'All hints viewed') + '</span><span>→</span></button>' +
        '</section>' +
        '<section class="card aside-card aside-stat-card"><div class="aside-heading">Question details</div>' +
          '<div class="aside-stat"><span>Estimated time</span><strong>~' + Math.round(question.estimatedTimeSeconds / 60) + ' min</strong></div>' +
          '<div class="aside-stat"><span>Source</span><strong>JEE Adv. ' + question.year + '</strong></div>' +
          '<div class="aside-stat"><span>Tags</span><strong>' + (question.conceptTags || []).length + ' concepts</strong></div>' +
        '</section>' +
      '</aside></div></div>';
  renderShell(body, 'question');
}

function renderHistory() {
  if (state.history === null) {
    root.innerHTML = '<div class="boot-screen"><span>Loading your history…</span></div>';
    api('/api/history').then(function (data) { state.history = data.history || []; renderApp(); })
      .catch(function (error) { state.history = []; showToast(error.message); renderApp(); });
    return;
  }
  const rows = state.history.map(function (item) {
    const correct = !!item.is_correct;
    const extra = item.goal_bonus_xp || 0;
    const xp = (item.xp_earned || 0) + extra;
    return '<div class="history-row"><span class="activity-check ' + (correct ? 'correct' : 'incorrect') + '">' + (correct ? '✓' : '×') + '</span>' +
      '<button class="inline-link" style="text-align:left" data-action="review-question" data-id="' + esc(item.question_id) + '">' +
        'Q.' + esc(item.questionNumber || '—') + ' · ' + esc(item.shortTitle) +
        '<span class="activity-meta" style="display:block;font-weight:400">' + esc(item.chapter) + ' · ' + esc(item.topic) + '</span></button>' +
      '<span class="history-answer">Answer: ' + esc(answerLabel(item.answer)) + ' · ' + item.time_spent_seconds + 's</span>' +
      '<span class="history-xp">' + (xp ? '+' + xp + ' XP' : '0 XP') + '<span class="history-time" style="display:block;margin-top:5px">' + esc(formatDate(item.attempted_at)) + '</span></span></div>';
  }).join('');
  const content =
    '<div class="page-wrap"><div class="page-heading"><div><div class="eyebrow">Your learning trail</div><h1>Question history</h1>' +
      '<p class="subtitle">Every attempt is a useful signal. Revisit a question whenever you need.</p></div>' +
      '<button class="button button-secondary" data-action="navigate" data-view="bank">Browse questions</button></div>' +
      '<section class="card history-list">' + (rows || '<div class="empty-state">Your question history is waiting for its first entry.<br>Start with one problem today.</div>') + '</section></div>';
  renderShell(content, 'history');
}

function renderAchievements(unlocked) {
  const ids = new Set((unlocked || []).map(function (item) { return item.id; }));
  return '<div class="achievement-grid">' + allAchievements.map(function (item) {
    return '<div class="achievement-item ' + (ids.has(item.id) ? '' : 'locked') + '">' +
      '<span class="achievement-icon">' + item.icon + '</span><span><strong>' + esc(item.name) + '</strong><small>' + esc(item.description) + '</small></span></div>';
  }).join('') + '</div>';
}

function renderProgressPage() {
  const dashboard = state.dashboard;
  const chapters = dashboard.chapters.slice().sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
  const topics = dashboard.topics.slice().sort(function (a, b) {
    return b.total - a.total || b.attempts - a.attempts || a.name.localeCompare(b.name);
  });
  const conceptList = (dashboard.concepts || []).slice()
    .sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); }).slice(0, 12);
  const topicRows = topics.map(function (item) {
    return '<div class="progress-item"><div class="progress-item-copy"><strong>' + esc(item.name) + '</strong><span>' + esc(item.chapter) + ' · ' + item.solved + '/' + item.total + ' solved · ' + (item.accuracy == null ? 'no attempts yet' : item.accuracy + '% accuracy') + '</span></div>' +
      '<div class="progress-track"><span style="width:' + item.progress + '%"></span></div><span class="chapter-percent">' + item.progress + '%</span></div>';
  });
  const topicMarkup = topicRows.slice(0, 12).join('') +
    (topicRows.length > 12
      ? '<details class="progress-more"><summary>Show all ' + topics.length + ' topics</summary><div class="progress-chapter-list">' + topicRows.slice(12).join('') + '</div></details>'
      : '');
  const content =
    '<div class="page-wrap"><div class="page-heading"><div><div class="eyebrow">Progress that is yours</div><h1>Your progress</h1>' +
      '<p class="subtitle">A clear view of what you have solved, what is taking shape and what to revisit next.</p></div>' +
      '<button class="button button-primary" data-action="start-session">Practice five questions <span>→</span></button></div>' +
      '<section class="metric-grid" style="margin-bottom:18px">' +
        metricCard('Attempted', dashboard.profile.questions_attempted, dashboard.uniqueAttempted + ' distinct questions', '↗') +
        metricCard('Solved correctly', dashboard.profile.questions_solved, 'of ' + dashboard.questionCount + ' available', '✓') +
        metricCard('Accuracy', dashboard.accuracy + '<small>%</small>', 'across all attempts', '◎') +
        metricCard('Experience', dashboard.profile.total_xp + '<small>XP</small>', 'Level ' + dashboard.profile.level, '✳') +
      '</section>' +
      '<div class="progress-page-grid">' +
        '<section class="card panel"><div class="panel-heading"><div><h2>By chapter</h2><p>Share of available questions solved correctly.</p></div></div>' +
          '<div class="progress-chapter-list">' + chapters.map(function (item) {
            return '<div class="progress-item"><div class="progress-item-copy"><strong>' + esc(item.name) + '</strong><span>' + item.solved + '/' + item.total + ' solved · ' + (item.accuracy == null ? 'no attempts' : item.accuracy + '% accuracy') + '</span></div>' +
              '<div class="progress-track"><span style="width:' + item.progress + '%"></span></div><span class="chapter-percent">' + item.progress + '%</span></div>';
          }).join('') + '</div></section>' +
        '<section class="card panel"><div class="panel-heading"><div><h2>By topic</h2><p>Accuracy and coverage from your attempts.</p></div></div>' +
          '<div class="progress-chapter-list">' + topicMarkup + '</div></section>' +
        '<section class="card panel"><div class="panel-heading"><div><h2>Concept coverage</h2><p>Tags drawn from the question set.</p></div></div>' +
          '<div class="progress-chapter-list">' + conceptList.map(function (item) {
            return '<div class="progress-item"><div class="progress-item-copy"><strong>' + esc(item.name) + '</strong><span>' + item.solved + ' of ' + item.total + ' tagged questions · ' + (item.accuracy == null ? 'no attempts' : item.accuracy + '% accuracy') + '</span></div>' +
              '<div class="progress-track"><span style="width:' + item.progress + '%"></span></div><span class="chapter-percent">' + item.progress + '%</span></div>';
          }).join('') + '</div></section>' +
        '<section class="card panel"><div class="panel-heading"><div><h2>Achievements</h2><p>' + dashboard.achievements.length + ' of ' + allAchievements.length + ' unlocked.</p></div></div>' +
          renderAchievements(dashboard.achievements) + '</section>' +
      '</div></div>';
  renderShell(content, 'progress');
}

function renderSessionComplete() {
  const solved = state.sessionQueue.filter(function (id) {
    const question = state.questions.find(function (item) { return item.id === id; });
    return question && question.status === 'correct';
  }).length;
  const content =
    '<div class="page-wrap"><div class="page-heading"><div><div class="eyebrow">Quick practice · complete</div><h1>That was good work.</h1>' +
      '<p class="subtitle">You made time for five focused questions. Keep the momentum going at your own pace.</p></div></div>' +
      '<section class="welcome-hero" style="max-width:750px;min-height:210px"><div class="hero-content"><div class="hero-kicker">Session summary</div>' +
        '<h2>' + solved + ' solved from ' + state.sessionQueue.length + ' questions.</h2><p>Your answers, time and hints are saved in your history.</p>' +
        '<button class="button hero-action" data-action="navigate" data-view="dashboard">Back to overview <span>→</span></button></div></section>' +
      '<div style="margin-top:16px;display:flex;gap:9px;flex-wrap:wrap"><button class="button button-secondary" data-action="start-session">Start another session</button>' +
        '<button class="button button-secondary" data-action="navigate" data-view="history">Review your history</button></div></div>';
  renderShell(content, 'session-complete');
}

function renderApp() {
  if (!state.user) {
    if (state.view === 'auth') return renderAuth();
    if (state.view === 'bank') return renderLoggedOutBank();
    return renderLanding();
  }
  if (!state.dashboard) {
    root.innerHTML = '<div class="boot-screen"><span>Loading your progress…</span></div>';
    return;
  }
  if (state.view === 'dashboard') return renderShell(renderDashboard(), 'dashboard');
  if (state.view === 'bank') return renderShell(renderBank(), 'bank');
  if (state.view === 'question') return renderQuestion();
  if (state.view === 'history') return renderHistory();
  if (state.view === 'progress') return renderProgressPage();
  if (state.view === 'session-complete') return renderSessionComplete();
  state.view = 'dashboard';
  renderApp();
}

function renderLoggedOutBank() {
  const list = renderQuestionRows(filteredQuestions());
  root.innerHTML =
    '<div class="public-home"><header class="public-nav">' + brand() +
      '<div class="public-nav-actions"><button class="button button-quiet" data-action="go-home">Home</button><button class="button button-primary button-small" data-action="auth-signup">Sign up</button></div></header>' +
      '<div class="page-wrap"><div class="page-heading"><div><div class="eyebrow">Public preview · JEE Advanced 2026</div><h1>Question bank</h1>' +
        '<p class="subtitle">Explore the Mathematics paper. Sign in when you are ready to save an attempt or start a practice session.</p></div></div>' +
        '<section class="card question-list">' + list + '</section></div></div>';
}

async function refreshQuestions() {
  const data = await api('/api/questions');
  state.questions = data.questions || [];
}

async function refreshDashboard() {
  const data = await api('/api/dashboard');
  state.dashboard = data;
  state.user = data.profile;
}

function setQuestion(id, returnView) {
  const next = state.questions.find(function (question) { return question.id === id; });
  if (!next) return;
  if (returnView !== 'session') {
    state.sessionId = null;
    state.sessionQueue = [];
    state.sessionIndex = 0;
  }
  state.questionId = id;
  state.returnView = returnView || 'bank';
  state.view = 'question';
  state.selected = [];
  state.numeric = '';
  state.hints = [];
  state.hintsUsed = 0;
  state.solution = null;
  state.solutionViewed = false;
  state.result = null;
  state.submitting = false;
  state.questionStarted = Date.now();
  renderApp();
}

function openQuestion(id, returnView) {
  if (!state.user) {
    state.pendingAction = { type: 'question', id: id, returnView: returnView || 'bank' };
    state.authMode = 'signup';
    state.view = 'auth';
    renderApp();
    return;
  }
  setQuestion(id, returnView || 'bank');
}

async function startSession() {
  if (!state.user) {
    state.pendingAction = { type: 'session' };
    state.authMode = 'signup';
    state.view = 'auth';
    renderApp();
    return;
  }
  try {
    const session = await api('/api/sessions', { method: 'POST', body: {} });
    state.sessionId = session.sessionId;
    state.sessionQueue = session.questionIds;
    state.sessionIndex = 0;
    setQuestion(state.sessionQueue[0], 'session');
  } catch (error) { showToast(error.message); }
}

function nextQuestion() {
  if (state.returnView === 'session') {
    if (state.sessionIndex >= state.sessionQueue.length - 1) {
      state.view = 'session-complete';
      state.questionId = null;
      refreshDashboard().catch(function () {});
      renderApp();
      return;
    }
    state.sessionIndex += 1;
    setQuestion(state.sessionQueue[state.sessionIndex], 'session');
    return;
  }
  const currentIndex = state.questions.findIndex(function (question) { return question.id === state.questionId; });
  const next = state.questions[currentIndex + 1] || state.questions[0];
  setQuestion(next.id, state.returnView);
}

function previousQuestion() {
  const currentIndex = state.questions.findIndex(function (question) { return question.id === state.questionId; });
  const previous = state.questions[currentIndex - 1] || state.questions[state.questions.length - 1];
  setQuestion(previous.id, state.returnView);
}

function collectAnswer() {
  const question = currentQuestion();
  if (!question) return null;
  if (question.questionType === 'numerical') {
    const field = document.getElementById('numerical-answer');
    return field ? field.value.trim() : state.numeric.trim();
  }
  if (question.questionType === 'multiple_choice') return state.selected.slice();
  return state.selected[0] || '';
}

async function submitAnswer() {
  const answer = collectAnswer();
  if (answer === null || answer === '' || (Array.isArray(answer) && !answer.length)) {
    showToast('Choose or enter an answer first.');
    return;
  }
  state.submitting = true;
  renderApp();
  try {
    const elapsed = Math.floor((Date.now() - state.questionStarted) / 1000);
    const data = await api('/api/attempt', {
      method: 'POST',
      body: {
        questionId: state.questionId,
        answer: answer,
        timeSpentSeconds: elapsed,
        hintsUsed: state.hintsUsed,
        solutionViewed: state.solutionViewed,
        sessionId: state.sessionId
      }
    });
    state.result = data;
    state.dashboard = data.dashboard;
    state.user = data.dashboard.profile;
    const previousLevel = state.lastLevel;
    state.lastLevel = state.user.level;
    const announcements = [];
    if (previousLevel != null && state.user.level > previousLevel) announcements.push('Level up: level ' + state.user.level);
    (data.unlockedAchievements || []).forEach(function (item) { announcements.push('Achievement unlocked: ' + item.name); });
    if (announcements.length) showToast(announcements.join(' · '));
    await refreshQuestions();
    renderApp();
  } catch (error) {
    state.submitting = false;
    renderApp();
    showToast(error.message);
  }
}

async function showHint() {
  const question = currentQuestion();
  if (!question || state.hintsUsed >= question.hintsCount) return;
  try {
    const data = await api('/api/question/' + encodeURIComponent(question.id) + '/hint?index=' + state.hintsUsed);
    state.hints.push(data.hint);
    state.hintsUsed += 1;
    renderApp();
  } catch (error) { showToast(error.message); }
}

async function showSolution() {
  if (state.solution) return;
  try {
    const data = await api('/api/question/' + encodeURIComponent(state.questionId) + '/solution');
    state.solution = data.solution || [];
    state.solutionViewed = true;
    renderApp();
  } catch (error) { showToast(error.message); }
}

async function adjustGoal(change) {
  const current = state.dashboard.profile.daily_goal || 5;
  try {
    state.dashboard = await api('/api/goal', { method: 'POST', body: { dailyGoal: current + change } });
    state.user = state.dashboard.profile;
    renderApp();
  } catch (error) { showToast(error.message); }
}

function filteredListOnly() {
  const filtered = filteredQuestions();
  const list = document.getElementById('question-list');
  const count = document.getElementById('result-count');
  if (list) list.innerHTML = renderQuestionRows(filtered);
  if (count) count.textContent = filtered.length + ' questions';
}

async function finishAuth(form) {
  const values = new FormData(form);
  const body = {
    email: String(values.get('email') || '').trim(),
    password: String(values.get('password') || '')
  };
  const endpoint = state.authMode === 'signup' ? '/api/register' : '/api/login';
  if (state.authMode === 'signup') body.name = String(values.get('name') || '').trim();
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  const error = document.getElementById('auth-error');
  if (error) { error.hidden = true; error.textContent = ''; }
  try {
    const data = await api(endpoint, { method: 'POST', body: body });
    state.user = data.user;
    state.lastLevel = data.user.level;
    await Promise.all([refreshDashboard(), refreshQuestions()]);
    state.history = null;
    const pending = state.pendingAction;
    state.pendingAction = null;
    if (pending && pending.type === 'session') {
      await startSession();
      return;
    }
    if (pending && pending.type === 'question') {
      setQuestion(pending.id, pending.returnView);
      return;
    }
    state.view = 'dashboard';
    renderApp();
  } catch (exception) {
    if (error) {
      error.textContent = exception.message;
      error.className = 'form-error';
      error.hidden = false;
    }
    if (button) button.disabled = false;
  }
}

function navigate(view) {
  if (view === 'auth-signup' || view === 'auth-login') {
    state.authMode = view === 'auth-signup' ? 'signup' : 'login';
    state.view = 'auth';
    renderApp();
    return;
  }
  if (view === 'bank' && !state.user) {
    state.view = 'bank';
    renderApp();
    return;
  }
  if (view === 'question') return;
  state.view = view;
  if (view === 'history') state.history = null;
  if (view === 'dashboard' || view === 'progress') refreshDashboard().catch(function () {});
  renderApp();
}

async function logout() {
  try { await api('/api/logout', { method: 'POST', body: {} }); } catch (_) {}
  clearTimer();
  state.user = null;
  state.dashboard = null;
  state.sessionId = null;
  state.sessionQueue = [];
  state.history = null;
  state.view = 'landing';
  renderApp();
}

document.addEventListener('click', function (event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'auth-signup' || action === 'auth-login') return navigate(action);
  if (action === 'auth-back') {
    state.pendingAction = null;
    state.view = 'landing';
    return renderApp();
  }
  if (action === 'go-home') {
    event.preventDefault();
    return navigate(state.user ? 'dashboard' : 'landing');
  }
  if (action === 'navigate') return navigate(target.dataset.view);
  if (action === 'logout') return logout();
  if (action === 'start-session') return startSession();
  if (action === 'open-question') return openQuestion(target.dataset.id, 'bank');
  if (action === 'review-question') return openQuestion(target.dataset.id, 'history');
  if (action === 'return-from-question') {
    const destination = state.returnView === 'session' ? 'dashboard' : state.returnView;
    state.view = destination;
    state.questionId = null;
    state.result = null;
    state.solution = null;
    if (destination === 'history') state.history = null;
    if (destination === 'dashboard') refreshDashboard().catch(function () {});
    return renderApp();
  }
  if (action === 'select-answer') {
    if (state.result) return;
    const question = currentQuestion();
    const key = target.dataset.key;
    if (question.questionType === 'multiple_choice') {
      state.selected = state.selected.includes(key)
        ? state.selected.filter(function (item) { return item !== key; })
        : state.selected.concat([key]);
    } else {
      state.selected = [key];
    }
    return renderApp();
  }
  if (action === 'submit-answer') return submitAnswer();
  if (action === 'next-question') return nextQuestion();
  if (action === 'previous-question') return previousQuestion();
  if (action === 'show-hint') return showHint();
  if (action === 'show-solution') return showSolution();
  if (action === 'goal-up') return adjustGoal(1);
  if (action === 'goal-down') return adjustGoal(-1);
});

document.addEventListener('submit', function (event) {
  if (event.target.id === 'auth-form') {
    event.preventDefault();
    finishAuth(event.target);
  }
});

document.addEventListener('input', function (event) {
  if (event.target.id === 'question-search') {
    state.filters.search = event.target.value;
    filteredListOnly();
  }
  if (event.target.id === 'numerical-answer') state.numeric = event.target.value;
});

document.addEventListener('change', function (event) {
  const key = event.target.dataset.filter;
  if (!key) return;
  state.filters[key] = event.target.value;
  if (key === 'chapter') state.filters.topic = '';
  renderApp();
});

async function initialize() {
  try {
    const values = await Promise.all([api('/api/session'), api('/api/questions')]);
    state.questions = values[1].questions || [];
    state.user = values[0].user || null;
    state.dashboard = values[0].dashboard || null;
    state.lastLevel = state.user ? state.user.level : null;
    state.view = state.user ? 'dashboard' : 'landing';
    renderApp();
  } catch (error) {
    root.innerHTML = '<div class="boot-screen"><strong>We could not open Edusnap.</strong><span>' + esc(error.message) + '</span><span>Start the local server with python3 server.py and refresh.</span></div>';
  }
}

initialize();
