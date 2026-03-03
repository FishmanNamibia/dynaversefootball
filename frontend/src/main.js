const appRoot = document.querySelector('#app');

const state = {
  apiBase: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5003/api',
  token: localStorage.getItem('dynaacademy_token') || '',
  user: null,
  activeView: 'dashboard',
  groups: [],
  selectedPlayer: null,
  selectedCollectionGuardianId: null
};

function setToken(token) {
  state.token = token;
  if (token) {
    localStorage.setItem('dynaacademy_token', token);
  } else {
    localStorage.removeItem('dynaacademy_token');
  }
}

function notify(message, type = 'info') {
  const el = document.querySelector('#toast');
  if (!el) {
    return;
  }
  el.className = `toast ${type}`;
  el.textContent = message;
  window.clearTimeout(notify._timer);
  notify._timer = window.setTimeout(() => {
    el.className = 'toast';
    el.textContent = '';
  }, 3500);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (state.token && options.auth !== false) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${state.apiBase}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let json = {};
  try {
    json = await response.json();
  } catch {
    json = {};
  }

  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) {
      setToken('');
      state.user = null;
      render();
    }
    const firstIssue = Array.isArray(json?.issues) && json.issues.length > 0 ? json.issues[0] : null;
    const issueText = firstIssue
      ? `${Array.isArray(firstIssue.path) ? firstIssue.path.join('.') : 'field'}: ${firstIssue.message}`
      : '';
    const message = issueText || json?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return json;
}

async function downloadProtectedFile(path, filename) {
  const response = await fetch(`${state.apiBase}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${state.token}`
    }
  });
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const json = await response.json();
      message = json?.message || message;
    } catch {
      // Keep default message.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function openProtectedPdf(path) {
  const previewWindow = window.open('', '_blank');
  if (!previewWindow) {
    throw new Error('Popup blocked. Allow popups to preview PDF.');
  }
  previewWindow.document.write('<p style="font-family: sans-serif; padding: 12px;">Loading invoice PDF...</p>');

  const response = await fetch(`${state.apiBase}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${state.token}`
    }
  });
  if (!response.ok) {
    let message = `Preview failed (${response.status})`;
    try {
      const json = await response.json();
      message = json?.message || message;
    } catch {
      // Keep default message.
    }
    previewWindow.close();
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  previewWindow.location.replace(url);

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatMoney(value, currency = 'NAD') {
  const amount = Number(value || 0);
  return `${currency} ${amount.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) {
    return '-';
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return value;
  }
  return dt.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function optionalText(formData, key) {
  const value = String(formData.get(key) || '').trim();
  return value.length > 0 ? value : undefined;
}

function optionalNumber(formData, key) {
  const raw = String(formData.get(key) || '').trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function calculateAgeFromDob(dateValue) {
  if (!dateValue) {
    return null;
  }
  const dob = new Date(dateValue);
  if (Number.isNaN(dob.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hasBirthdayPassed) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function predictGroupByAge(age) {
  if (typeof age !== 'number') {
    return '';
  }
  if (age <= 9) return 'U9';
  if (age <= 11) return 'U11';
  if (age <= 13) return 'U13';
  return 'U15';
}

async function bootstrap() {
  if (!state.token) {
    render();
    return;
  }

  try {
    const me = await api('/auth/me');
    state.user = me.data.user;
    const groupsRes = await api('/catalog/training-groups');
    state.groups = groupsRes.data || [];
  } catch {
    state.user = null;
    setToken('');
  }
  render();
}

function render() {
  if (!state.token || !state.user) {
    renderLogin();
    return;
  }
  renderShell();
}

function renderLogin() {
  appRoot.innerHTML = `
    <main class="login-page">
      <div class="sports-scene" aria-hidden="true">
        <div class="silhouette player-one"></div>
        <div class="silhouette player-two"></div>
        <div class="ball"></div>
        <div class="ball-trail"></div>
      </div>
      <section class="login-card">
        <h1>Dynaverse Football Academy</h1>
        <p class="sub">Management system login</p>
        <form id="loginForm" class="stack">
          <label>
            Username
            <input name="username" type="text" required value="admin" />
          </label>
          <label>
            Password
            <input name="password" type="password" required value="admin123" />
          </label>
          <button type="submit">Sign In</button>
        </form>
        <p class="hint">Default local credentials: <code>admin / admin123</code></p>
      </section>
      <div id="toast" class="toast"></div>
    </main>
  `;

  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get('username') || '');
    const password = String(formData.get('password') || '');

    try {
      const login = await api('/auth/login', {
        method: 'POST',
        auth: false,
        body: { username, password }
      });
      setToken(login.data.token);
      state.user = login.data.user;
      const groupsRes = await api('/catalog/training-groups');
      state.groups = groupsRes.data || [];
      state.activeView = 'dashboard';
      render();
      notify('Login successful', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });
}

function renderShell() {
  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <h1 class="brand">Dynaverse FA</h1>
        <p class="role">Football Academy MIS</p>
        <nav>
          <button data-view="dashboard" class="nav-btn ${state.activeView === 'dashboard' ? 'active' : ''}">Dashboard</button>
          <button data-view="registration" class="nav-btn ${state.activeView === 'registration' ? 'active' : ''}">Player Registration</button>
          <button data-view="players" class="nav-btn ${state.activeView === 'players' ? 'active' : ''}">Players</button>
          <button data-view="billing" class="nav-btn ${state.activeView === 'billing' ? 'active' : ''}">Billing</button>
          <button data-view="attendance" class="nav-btn ${state.activeView === 'attendance' ? 'active' : ''}">Attendance</button>
          <button data-view="reminders" class="nav-btn ${state.activeView === 'reminders' ? 'active' : ''}">Reminders</button>
          <button data-view="settings" class="nav-btn ${state.activeView === 'settings' ? 'active' : ''}">Settings</button>
        </nav>
        <div class="sidebar-footer">
          <p class="who">Signed in as <strong>${state.user.username}</strong></p>
          <button id="logoutBtn" class="ghost">Logout</button>
        </div>
      </aside>
      <main class="content">
        <header class="topbar">
          <div>
            <h2>${viewTitle(state.activeView)}</h2>
            <p>${viewSubtitle(state.activeView)}</p>
          </div>
          <label class="api-field">API
            <input id="apiBaseInput" value="${state.apiBase}" />
          </label>
        </header>
        <section id="viewHost" class="view-host"></section>
      </main>
      <div id="toast" class="toast"></div>
    </div>
  `;

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      render();
      void loadView();
    });
  });

  document.querySelector('#logoutBtn').addEventListener('click', () => {
    setToken('');
    state.user = null;
    state.selectedPlayer = null;
    state.selectedCollectionGuardianId = null;
    render();
  });

  document.querySelector('#apiBaseInput').addEventListener('change', (event) => {
    const value = event.currentTarget.value.trim();
    if (value) {
      state.apiBase = value;
      notify('API base URL updated', 'success');
    }
  });

  void loadView();
}

function viewTitle(view) {
  if (view === 'registration') return 'New Player Registration';
  if (view === 'players') return 'Player Directory';
  if (view === 'billing') return 'Fees, Invoices, and Payments';
  if (view === 'attendance') return 'Training Attendance';
  if (view === 'reminders') return 'Payment Reminder Operations';
  if (view === 'settings') return 'System Configuration Center';
  return 'Football Academy Dashboard';
}

function viewSubtitle(view) {
  if (view === 'registration') return 'Capture full player, guardian, medical, and consent data.';
  if (view === 'players') return 'Search players and review profile details.';
  if (view === 'billing') return 'Generate invoices/receipts, send invoice communications, and manage activity contribution fees.';
  if (view === 'attendance') return 'Create sessions and mark player attendance.';
  if (view === 'reminders') return 'Send due reminders and outstanding monthly fee notifications to parents.';
  if (view === 'settings') return 'Manage academy setup, channels, billing defaults, reminder rules, and audit logs.';
  return 'Daily operations overview for Dynaverse Football Academy.';
}

async function loadView() {
  const host = document.querySelector('#viewHost');
  if (!host) {
    return;
  }

  host.innerHTML = `<div class="loader">Loading...</div>`;

  try {
    if (state.activeView === 'registration') {
      renderRegistrationView(host);
      bindRegistrationView();
      return;
    }
    if (state.activeView === 'players') {
      await renderPlayersView(host);
      return;
    }
    if (state.activeView === 'billing') {
      await renderBillingView(host);
      return;
    }
    if (state.activeView === 'attendance') {
      await renderAttendanceView(host);
      return;
    }
    if (state.activeView === 'reminders') {
      await renderRemindersView(host);
      return;
    }
    if (state.activeView === 'settings') {
      await renderSettingsView(host);
      return;
    }
    await renderDashboardView(host);
  } catch (error) {
    host.innerHTML = `<p class="error">Failed to load view: ${error.message}</p>`;
  }
}

async function renderDashboardView(host) {
  const [playersRes, openInvoicesRes, remindersRes, sessionsRes] = await Promise.all([
    api('/players?limit=500'),
    api('/billing/invoices?status=open&limit=500'),
    api('/reminders/pending?limit=500'),
    api('/attendance/sessions?limit=30')
  ]);

  const players = playersRes.data || [];
  const invoices = openInvoicesRes.data || [];
  const reminders = remindersRes.data || [];
  const sessions = sessionsRes.data || [];

  const overdueCount = invoices.filter((i) => i.status === 'overdue').length;
  const openAmount = invoices.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

  host.innerHTML = `
    <div class="cards four">
      <article class="card stat"><h3>${players.length}</h3><p>Active Players</p></article>
      <article class="card stat"><h3>${invoices.length}</h3><p>Open Invoices</p></article>
      <article class="card stat"><h3>${overdueCount}</h3><p>Overdue Invoices</p></article>
      <article class="card stat"><h3>${formatMoney(openAmount)}</h3><p>Open Amount</p></article>
    </div>
    <div class="cards two">
      <article class="card">
        <h3>Recent Players</h3>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Group</th><th>Joined</th></tr></thead>
          <tbody>
            ${
              players
                .slice(0, 8)
                .map(
                  (p) =>
                    `<tr><td>${p.player_code}</td><td>${p.first_name} ${p.last_name}</td><td>${p.training_group_code || '-'}</td><td>${formatDate(p.joined_on)}</td></tr>`
                )
                .join('') || '<tr><td colspan="4">No players yet</td></tr>'
            }
          </tbody>
        </table>
      </article>
      <article class="card">
        <h3>Operational Queue</h3>
        <ul class="queue">
          <li>Pending reminders: <strong>${reminders.length}</strong></li>
          <li>Attendance sessions tracked: <strong>${sessions.length}</strong></li>
          <li>Open invoices: <strong>${invoices.length}</strong></li>
          <li>Next monthly billing run: <strong>1st day of month</strong></li>
        </ul>
      </article>
    </div>
  `;
}

function groupOptions() {
  const options = state.groups.map((g) => `<option value="${g.code}">${g.code} - ${g.display_name}</option>`);
  return options.join('');
}

function playerOptions(players) {
  return players
    .map(
      (player) =>
        `<option value="${player.player_code}">${player.player_code} - ${player.first_name} ${player.last_name}</option>`
    )
    .join('');
}

function renderRegistrationView(host) {
  host.innerHTML = `
    <form id="registrationForm" class="card form-grid">
      <h3>Player Profile</h3>
      <label>First Name<input name="playerFirstName" required /></label>
      <label>Last Name<input name="playerLastName" required /></label>
      <label>Date of Birth<input name="dateOfBirth" type="date" required /></label>
      <label>Gender
        <select name="gender" required>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Preferred Position<input name="preferredPosition" placeholder="Midfielder" /></label>
      <label>Preferred Foot
        <select name="preferredFoot">
          <option value="right">Right</option>
          <option value="left">Left</option>
          <option value="both">Both</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
      <label>Experience (years)<input name="experienceYears" type="number" min="0" step="0.5" /></label>
      <label>Age (auto)<input name="calculatedAge" id="calculatedAge" readonly placeholder="Auto from DOB" /></label>
      <label>Training Group (auto)<input name="autoTrainingGroup" id="autoTrainingGroup" readonly placeholder="Auto from age" /></label>
      <label>Town<input name="playerTown" /></label>
      <label>Region<input name="playerRegion" /></label>

      <h3>Parent/Guardian</h3>
      <label>Guardian First Name<input name="guardianFirstName" required /></label>
      <label>Guardian Last Name<input name="guardianLastName" required /></label>
      <label>Relationship<input name="relationship" required placeholder="Mother/Father/Guardian" /></label>
      <label>Phone/WhatsApp<input name="guardianPhone" required /></label>
      <label>Email<input name="guardianEmail" type="email" /></label>

      <h3>Emergency Contact</h3>
      <label>Full Name<input name="emergencyName" required /></label>
      <label>Relationship<input name="emergencyRelation" required /></label>
      <label>Phone<input name="emergencyPhone" required /></label>

      <h3>Medical and Training</h3>
      <label>Medical Conditions<input name="medicalConditions" /></label>
      <label>Allergies<input name="allergies" /></label>
      <label>Has Asthma
        <select name="hasAsthma">
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
      <label>Uniform Size<input name="uniformSize" placeholder="S/M/L" /></label>
      <label>Due Day of Month<input name="dueDay" type="number" min="1" max="28" value="5" /></label>

      <h3>Consent</h3>
      <label class="checkbox"><input name="academyTerms" type="checkbox" checked required /> Academy terms accepted</label>
      <label class="checkbox"><input name="mediaPermission" type="checkbox" checked /> Media permission granted</label>
      <label class="checkbox"><input name="dataProcessing" type="checkbox" checked required /> Data processing consent</label>
      <label class="checkbox"><input name="emergencyTreatment" type="checkbox" checked /> Emergency treatment consent</label>

      <div class="actions">
        <button type="submit">Register Player</button>
      </div>
    </form>
  `;
}

function bindRegistrationView() {
  const form = document.querySelector('#registrationForm');
  const dobInput = form.querySelector('[name="dateOfBirth"]');
  const ageInput = form.querySelector('#calculatedAge');
  const groupInput = form.querySelector('#autoTrainingGroup');

  const refreshAutoAssignment = () => {
    const age = calculateAgeFromDob(dobInput.value);
    ageInput.value = typeof age === 'number' ? String(age) : '';
    groupInput.value = predictGroupByAge(age);
  };

  dobInput.addEventListener('change', refreshAutoAssignment);
  dobInput.addEventListener('input', refreshAutoAssignment);
  refreshAutoAssignment();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    if (!(formEl instanceof HTMLFormElement)) {
      return;
    }
    const fd = new FormData(formEl);

    const payload = {
      player: {
        firstName: String(fd.get('playerFirstName') || ''),
        lastName: String(fd.get('playerLastName') || ''),
        dateOfBirth: String(fd.get('dateOfBirth') || ''),
        gender: String(fd.get('gender') || 'male'),
        preferredPosition: optionalText(fd, 'preferredPosition'),
        preferredFoot: String(fd.get('preferredFoot') || 'unknown'),
        yearsOfExperience: optionalNumber(fd, 'experienceYears'),
        town: optionalText(fd, 'playerTown'),
        region: optionalText(fd, 'playerRegion')
      },
      guardian: {
        firstName: String(fd.get('guardianFirstName') || ''),
        lastName: String(fd.get('guardianLastName') || ''),
        relationshipToPlayer: String(fd.get('relationship') || ''),
        phoneWhatsapp: String(fd.get('guardianPhone') || ''),
        email: optionalText(fd, 'guardianEmail')
      },
      emergencyContact: {
        fullName: String(fd.get('emergencyName') || ''),
        relationshipToPlayer: String(fd.get('emergencyRelation') || ''),
        phone: String(fd.get('emergencyPhone') || ''),
        priority: 1
      },
      medical: {
        medicalConditions: optionalText(fd, 'medicalConditions'),
        allergies: optionalText(fd, 'allergies'),
        hasAsthma: String(fd.get('hasAsthma')) === 'true',
        emergencyTreatmentConsent: fd.get('emergencyTreatment') === 'on'
      },
      training: {
        uniformSize: optionalText(fd, 'uniformSize')
      },
      billing: {
        dueDayOfMonth: Number(fd.get('dueDay') || 5)
      },
      consents: {
        academyTerms: fd.get('academyTerms') === 'on',
        mediaPermission: fd.get('mediaPermission') === 'on',
        dataProcessing: fd.get('dataProcessing') === 'on'
      }
    };

    try {
      const result = await api('/registrations', {
        method: 'POST',
        body: payload
      });
      const assignedGroup = result?.data?.assignedTrainingGroup || 'N/A';
      const assignedAge = result?.data?.calculatedAge ?? 'N/A';
      notify(
        `Player registered: ${result.data.playerCode} | Group: ${assignedGroup} | Age: ${assignedAge}`,
        'success'
      );
      formEl.reset();
      refreshAutoAssignment();
    } catch (error) {
      notify(error.message, 'error');
    }
  });
}

async function renderPlayersView(host) {
  const playersRes = await api('/players?limit=200');
  const players = playersRes.data || [];

  host.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="playerSearch" placeholder="Search by player code or name..." />
        <button id="searchPlayersBtn">Search</button>
      </div>
      <table id="playersTable">
        <thead><tr><th>Player Code</th><th>Name</th><th>Group</th><th>Guardian</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>
          ${
            players
              .map(
                (p) =>
                  `<tr data-player-id="${p.player_id}">
                    <td>${p.player_code}</td>
                    <td>${p.first_name} ${p.last_name}</td>
                    <td>${p.training_group_code || '-'}</td>
                    <td>${p.guardian_name || '-'}</td>
                    <td>${p.guardian_phone || '-'}</td>
                    <td>${p.status}</td>
                  </tr>`
              )
              .join('') || '<tr><td colspan="6">No players found</td></tr>'
          }
        </tbody>
      </table>
    </div>
    <div class="card" id="playerDetailsCard">
      <h3>Player Details</h3>
      <p>Select a player row to view profile, medical, and guardian details.</p>
    </div>
  `;

  document.querySelectorAll('#playersTable tbody tr[data-player-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      const playerId = row.dataset.playerId;
      if (!playerId) return;
      try {
        const details = await api(`/players/${playerId}`);
        state.selectedPlayer = details.data;
        renderPlayerDetails(details.data);
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });

  document.querySelector('#searchPlayersBtn').addEventListener('click', async () => {
    const term = document.querySelector('#playerSearch').value.trim();
    try {
      const result = await api(`/players?search=${encodeURIComponent(term)}&limit=200`);
      const tableBody = document.querySelector('#playersTable tbody');
      const data = result.data || [];
      tableBody.innerHTML =
        data
          .map(
            (p) =>
              `<tr data-player-id="${p.player_id}">
                <td>${p.player_code}</td>
                <td>${p.first_name} ${p.last_name}</td>
                <td>${p.training_group_code || '-'}</td>
                <td>${p.guardian_name || '-'}</td>
                <td>${p.guardian_phone || '-'}</td>
                <td>${p.status}</td>
              </tr>`
          )
          .join('') || '<tr><td colspan="6">No players found</td></tr>';
      document.querySelectorAll('#playersTable tbody tr[data-player-id]').forEach((row) => {
        row.addEventListener('click', async () => {
          const playerId = row.dataset.playerId;
          if (!playerId) return;
          const details = await api(`/players/${playerId}`);
          renderPlayerDetails(details.data);
        });
      });
    } catch (error) {
      notify(error.message, 'error');
    }
  });
}

function renderPlayerDetails(data) {
  const card = document.querySelector('#playerDetailsCard');
  if (!card) return;

  const player = data.player;
  const guardian = data.guardians?.[0];
  const medical = data.medical || {};
  card.innerHTML = `
    <h3>${player.player_code} - ${player.first_name} ${player.last_name}</h3>
    <div class="details-grid">
      <div>
        <h4>Player</h4>
        <p><strong>Group:</strong> ${player.training_group_code || '-'}</p>
        <p><strong>DOB:</strong> ${formatDate(player.date_of_birth)}</p>
        <p><strong>Position:</strong> ${player.preferred_position || '-'}</p>
        <p><strong>Status:</strong> ${player.status}</p>
      </div>
      <div>
        <h4>Guardian</h4>
        <p><strong>Name:</strong> ${guardian ? `${guardian.first_name} ${guardian.last_name}` : '-'}</p>
        <p><strong>Phone:</strong> ${guardian?.phone_whatsapp || '-'}</p>
        <p><strong>Email:</strong> ${guardian?.email || '-'}</p>
      </div>
      <div>
        <h4>Medical</h4>
        <p><strong>Conditions:</strong> ${medical.medical_conditions || '-'}</p>
        <p><strong>Allergies:</strong> ${medical.allergies || '-'}</p>
        <p><strong>Asthma:</strong> ${medical.has_asthma ? 'Yes' : 'No'}</p>
      </div>
    </div>
  `;
}

async function renderBillingView(host) {
  const [playersRes, invoicesRes, outstandingRes] = await Promise.all([
    api('/players?limit=500'),
    api('/billing/invoices?status=open&limit=200'),
    api('/billing/fees/outstanding-monthly?limit=200')
  ]);
  const players = playersRes.data || [];
  const invoices = invoicesRes.data || [];
  const outstanding = outstandingRes.data || [];
  const hasPlayers = players.length > 0;
  const defaultDueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  host.innerHTML = `
    <div class="cards three">
      <article class="card">
        <h3>Billing Jobs</h3>
        <div class="actions">
          <button id="runMonthlyBtn">Generate Monthly Invoices</button>
          <button id="markOverdueBtn" class="ghost">Mark Overdue</button>
        </div>
      </article>
      <article class="card">
        <h3>Record Payment</h3>
        ${hasPlayers ? '' : '<p class="error">No players found. Register players first before recording payments.</p>'}
        <form id="paymentForm" class="stack">
          <label>Player
            <select name="playerCode" required>
              <option value="">Select player</option>
              ${playerOptions(players)}
            </select>
          </label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Method
            <select name="method">
              <option value="eft">EFT</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Payment Reference<input name="paymentReference" placeholder="Bank ref" /></label>
          <button type="submit" ${hasPlayers ? '' : 'disabled'}>Apply Payment</button>
        </form>
      </article>
      <article class="card">
        <h3>Add Activity Contribution Fee</h3>
        ${hasPlayers ? '' : '<p class="error">No players found. Register players first before creating contribution invoices.</p>'}
        <form id="customFeeForm" class="stack">
          <label>Player
            <select name="playerCode" required>
              <option value="">Select player</option>
              ${playerOptions(players)}
            </select>
          </label>
          <label>Fee Name<input name="feeName" required placeholder="Tournament Contribution" /></label>
          <label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Due Date<input name="dueDate" type="date" value="${defaultDueDate}" required /></label>
          <label>Description<input name="description" placeholder="Optional note" /></label>
          <button type="submit" ${hasPlayers ? '' : 'disabled'}>Create Fee Invoice</button>
        </form>
      </article>
    </div>
    <article class="card" id="billingInvoiceDetail">
      <h3>Invoice Detail</h3>
      <p>Select <strong>Details</strong> on an invoice row to view line items, payment allocations, and guardian contacts.</p>
    </article>
    <article class="card">
      <h3>Open Invoices</h3>
      <table id="billingInvoiceTable">
        <thead><tr><th>Invoice</th><th>Player</th><th>Due</th><th>Status</th><th>Total</th><th>Paid</th><th>Actions</th></tr></thead>
        <tbody>
          ${
            invoices
              .map(
                (inv) =>
                  `<tr>
                    <td>${inv.invoice_number}</td>
                    <td>${inv.player_code} - ${inv.player_name}</td>
                    <td>${formatDate(inv.due_date)}</td>
                    <td>${inv.status}</td>
                    <td>${formatMoney(inv.total_amount, inv.currency)}</td>
                    <td>${formatMoney(inv.paid_amount, inv.currency)}</td>
                    <td class="mini-actions">
                      <button data-action="view" data-id="${inv.invoice_id}" class="ghost">Details</button>
                      <button data-action="download" data-id="${inv.invoice_id}" class="ghost">View PDF</button>
                      <button data-action="email" data-id="${inv.invoice_id}" class="ghost">Email</button>
                      <button data-action="whatsapp" data-id="${inv.invoice_id}" class="ghost">WhatsApp</button>
                    </td>
                  </tr>`
              )
              .join('') || '<tr><td colspan="7">No open invoices</td></tr>'
          }
        </tbody>
      </table>
    </article>
    <article class="card">
      <h3>Outstanding Monthly Fee Snapshot</h3>
      <table>
        <thead><tr><th>Invoice</th><th>Player</th><th>Due</th><th>Outstanding</th><th>Contact</th></tr></thead>
        <tbody>
          ${
            outstanding
              .slice(0, 10)
              .map(
                (row) =>
                  `<tr>
                    <td>${row.invoice_number}</td>
                    <td>${row.player_code} - ${row.player_name}</td>
                    <td>${formatDate(row.due_date)}</td>
                    <td>${formatMoney(row.outstanding_amount, row.currency)}</td>
                    <td>${row.guardian_email || row.guardian_phone || '-'}</td>
                  </tr>`
              )
              .join('') || '<tr><td colspan="5">No outstanding monthly fees</td></tr>'
          }
        </tbody>
      </table>
    </article>
  `;

  document.querySelector('#runMonthlyBtn').addEventListener('click', async () => {
    try {
      const res = await api('/billing/jobs/monthly-invoices', { method: 'POST', body: {} });
      notify(`Monthly invoices created: ${res.data.created}, skipped: ${res.data.skipped}`, 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#markOverdueBtn').addEventListener('click', async () => {
    try {
      const res = await api('/billing/jobs/mark-overdue', { method: 'POST', body: {} });
      notify(`Overdue update complete. Updated: ${res.data.updated}`, 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#paymentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    if (!(formEl instanceof HTMLFormElement)) {
      return;
    }
    const fd = new FormData(formEl);
    const payload = {
      playerCode: String(fd.get('playerCode') || ''),
      amount: Number(fd.get('amount') || 0),
      method: String(fd.get('method') || 'eft'),
      paymentReference: optionalText(fd, 'paymentReference')
    };
    try {
      const res = await api('/billing/payments', { method: 'POST', body: payload });
      notify(`Payment recorded. Allocated: ${res.data.allocatedAmount}`, 'success');
      formEl.reset();
      if (res?.data?.paymentId) {
        await downloadProtectedFile(
          `/billing/payments/${res.data.paymentId}/receipt.pdf`,
          `receipt-${res.data.paymentId}.pdf`
        );
      }
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#customFeeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    if (!(formEl instanceof HTMLFormElement)) {
      return;
    }
    const fd = new FormData(formEl);
    const payload = {
      playerCode: String(fd.get('playerCode') || ''),
      feeName: String(fd.get('feeName') || ''),
      amount: Number(fd.get('amount') || 0),
      dueDate: String(fd.get('dueDate') || ''),
      description: optionalText(fd, 'description'),
      category: 'activity_contribution'
    };
    try {
      const res = await api('/billing/fees/custom-invoice', {
        method: 'POST',
        body: payload
      });
      notify(`Activity fee invoice created: ${res.data.invoiceNumber}`, 'success');
      formEl.reset();
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#billingInvoiceTable').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    const invoiceId = button.dataset.id;
    if (!invoiceId) {
      return;
    }

    try {
      if (action === 'view') {
        const detail = await api(`/billing/invoices/${invoiceId}`);
        const d = detail.data;
        const detailCard = document.querySelector('#billingInvoiceDetail');
        if (!detailCard) {
          notify('Invoice detail panel unavailable. Reload the page.', 'error');
          return;
        }
        detailCard.innerHTML = `
          <h3>Invoice ${d.invoice.invoiceNumber}</h3>
          <p><strong>Player:</strong> ${d.player.code} - ${d.player.name}</p>
          <p><strong>Guardian:</strong> ${d.guardian.name || '-'} | ${d.guardian.email || d.guardian.phone || '-'}</p>
          <p><strong>Due:</strong> ${formatDate(d.invoice.dueDate)} | <strong>Status:</strong> ${d.invoice.status}</p>
          <p><strong>Total:</strong> ${formatMoney(d.invoice.totalAmount, d.invoice.currency)} | <strong>Paid:</strong> ${formatMoney(d.invoice.paidAmount, d.invoice.currency)} | <strong>Outstanding:</strong> ${formatMoney(d.invoice.outstandingAmount, d.invoice.currency)}</p>
          <h4>Line Items</h4>
          <ul class="queue">
            ${
              d.items
                .map(
                  (item) =>
                    `<li>${item.description} - Qty ${item.quantity} - ${formatMoney(item.lineTotal, d.invoice.currency)}</li>`
                )
                .join('') || '<li>No line items.</li>'
            }
          </ul>
          <h4>Payments</h4>
          <ul class="queue">
            ${
              d.payments
                .map(
                  (p) =>
                    `<li>${formatDate(p.receivedOn)} | ${p.method} | ${formatMoney(p.allocatedAmount, d.invoice.currency)}</li>`
                )
                .join('') || '<li>No payments allocated.</li>'
            }
          </ul>
        `;
        detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        notify(`Loaded invoice detail: ${d.invoice.invoiceNumber}`, 'success');
        return;
      }

      if (action === 'download') {
        await openProtectedPdf(`/billing/invoices/${invoiceId}/pdf`);
        notify('Invoice PDF opened in a new tab', 'success');
        return;
      }

      if (action === 'email') {
        const detail = await api(`/billing/invoices/${invoiceId}`);
        const fallbackEmail = (detail?.data?.guardian?.email || '').trim();
        let targetEmail = fallbackEmail;
        if (!targetEmail) {
          const entered = window.prompt('No guardian email found. Enter recipient email:', '');
          targetEmail = entered ? entered.trim() : '';
          if (!targetEmail) {
            notify('Email send cancelled. No recipient provided.', 'info');
            return;
          }
        }
        const res = await api(`/billing/invoices/${invoiceId}/send`, {
          method: 'POST',
          body: { channel: 'email', email: targetEmail }
        });
        if (res.data.simulated) {
          notify('Email is running in simulation mode on the server. Configure SMTP to send real emails.', 'error');
          return;
        }
        notify(`Invoice emailed to ${res.data.recipient}`, 'success');
        return;
      }

      if (action === 'whatsapp') {
        const detail = await api(`/billing/invoices/${invoiceId}`);
        let targetPhone = (detail?.data?.guardian?.phone || '').trim();
        if (!targetPhone) {
          const entered = window.prompt('No guardian WhatsApp found. Enter WhatsApp number:', '');
          targetPhone = entered ? entered.trim() : '';
          if (!targetPhone) {
            notify('WhatsApp send cancelled. No recipient provided.', 'info');
            return;
          }
        }
        const res = await api(`/billing/invoices/${invoiceId}/send`, {
          method: 'POST',
          body: { channel: 'whatsapp', phone: targetPhone }
        });
        if (res.data.simulated) {
          notify('WhatsApp is running in simulation mode on the server. Configure WhatsApp API to send real messages.', 'error');
          return;
        }
        notify(
          `Invoice sent via WhatsApp to ${res.data.recipient}`,
          'success'
        );
      }
    } catch (error) {
      notify(error.message, 'error');
    }
  });
}

async function renderSettingsView(host) {
  const dashboardRes = await api('/settings/dashboard');
  const settings = dashboardRes?.data?.settings || {};
  const health = dashboardRes?.data?.health || {};
  const audit = Array.isArray(dashboardRes?.data?.audit) ? dashboardRes.data.audit : [];

  const academy = settings.academyProfile || {};
  const billing = settings.billingDefaults || {};
  const reminders = settings.reminderDefaults || {};
  const channels = settings.channels || {};

  const smtpBadge = channels.smtpConfigured
    ? '<span class="flag ok">SMTP Configured</span>'
    : '<span class="flag warn">SMTP Missing</span>';
  const waBadge = channels.whatsappConfigured
    ? '<span class="flag ok">WhatsApp Configured</span>'
    : '<span class="flag warn">WhatsApp Missing</span>';

  host.innerHTML = `
    <div class="cards four">
      <article class="card stat"><h3>${health.activePlayers ?? 0}</h3><p>Active Players</p></article>
      <article class="card stat"><h3>${health.openInvoices ?? 0}</h3><p>Open Invoices</p></article>
      <article class="card stat"><h3>${health.pendingReminders ?? 0}</h3><p>Pending Reminders</p></article>
      <article class="card stat"><h3>${health.failedRemindersLast30Days ?? 0}</h3><p>Failed Reminders (30d)</p></article>
    </div>
    <div class="cards two">
      <article class="card">
        <details class="settings-panel" open>
          <summary>Academy Profile</summary>
          <form id="academySettingsForm" class="stack">
          <label>Academy Name<input name="academyName" value="${academy.academyName || ''}" required /></label>
          <label>Division Line<input name="divisionLine" value="${academy.divisionLine || ''}" required /></label>
          <label>Tagline<input name="tagline" value="${academy.tagline || ''}" required /></label>
          <label>Contact Email<input name="contactEmail" type="email" value="${academy.contactEmail || ''}" required /></label>
          <label>Contact Phone<input name="contactPhone" value="${academy.contactPhone || ''}" required /></label>
          <label>Address Line<input name="addressLine" value="${academy.addressLine || ''}" required /></label>
          <label>Currency<input name="currency" value="${academy.currency || 'NAD'}" maxlength="3" required /></label>
          <label>Timezone<input name="timezone" value="${academy.timezone || 'Africa/Windhoek'}" required /></label>
          <label>Bank Name<input name="bankName" value="${academy.bankName || ''}" required /></label>
          <label>Bank Account Name<input name="bankAccountName" value="${academy.bankAccountName || ''}" required /></label>
          <label>Bank Account Number<input name="bankAccountNumber" value="${academy.bankAccountNumber || ''}" required /></label>
          <button type="submit">Save Academy Profile</button>
          </form>
        </details>
      </article>
      <article class="card">
        <details class="settings-panel">
          <summary>Billing Defaults</summary>
          <form id="billingSettingsForm" class="stack">
          <label>Registration Fee
            <input name="registrationFee" type="number" min="0.01" step="0.01" value="${Number(billing.registrationFee || 50)}" required />
          </label>
          <label>Monthly Subscription Fee
            <input name="monthlyFee" type="number" min="0.01" step="0.01" value="${Number(billing.monthlyFee || 250)}" required />
          </label>
          <label>Default Due Day (1-28)
            <input name="dueDayOfMonth" type="number" min="1" max="28" value="${Number(billing.dueDayOfMonth || 5)}" required />
          </label>
          <label>Invoice Grace Days
            <input name="invoiceGraceDays" type="number" min="1" max="60" value="${Number(billing.invoiceGraceDays || 7)}" required />
          </label>
          <label>Default Currency<input name="defaultCurrency" maxlength="3" value="${billing.defaultCurrency || 'NAD'}" required /></label>
          <button type="submit">Save Billing Defaults</button>
          </form>
        </details>
      </article>
    </div>
    <div class="cards two">
      <article class="card">
        <details class="settings-panel">
          <summary>Reminder Rules</summary>
          <form id="reminderSettingsForm" class="stack">
          <label>Days Before Due Reminder
            <input name="beforeDueDays" type="number" min="0" max="30" value="${Number(reminders.beforeDueDays || 3)}" required />
          </label>
          <label>Days After Due (Overdue Reminder)
            <input name="overdueDays" type="number" min="1" max="30" value="${Number(reminders.overdueDays || 3)}" required />
          </label>
          <label class="checkbox"><input type="checkbox" name="enableEmail" ${reminders.enableEmail ? 'checked' : ''} /> Enable email reminders</label>
          <label class="checkbox"><input type="checkbox" name="enableWhatsApp" ${reminders.enableWhatsApp ? 'checked' : ''} /> Enable WhatsApp reminders</label>
          <button type="submit">Save Reminder Rules</button>
          </form>
        </details>
      </article>
      <article class="card">
        <details class="settings-panel">
          <summary>Channel Configuration</summary>
          <p>${smtpBadge} ${waBadge}</p>
          <form id="channelSettingsForm" class="stack">
          <label>SMTP Host<input name="smtpHost" value="${channels.smtpHost || ''}" /></label>
          <label>SMTP Port<input name="smtpPort" type="number" min="1" max="65535" value="${Number(channels.smtpPort || 587)}" /></label>
          <label class="checkbox"><input type="checkbox" name="smtpSecure" ${channels.smtpSecure ? 'checked' : ''} /> SMTP Secure (SSL/TLS)</label>
          <label>SMTP Username<input name="smtpUser" value="${channels.smtpUser || ''}" /></label>
          <label>SMTP Password<input name="smtpPass" type="password" placeholder="${channels.smtpPassSet ? 'Stored (enter to replace)' : 'Set SMTP password'}" /></label>
          <label>Email From<input name="emailFrom" type="email" value="${channels.emailFrom || ''}" /></label>
          <label class="checkbox"><input type="checkbox" name="smtpSimulate" ${channels.smtpSimulate ? 'checked' : ''} /> Simulate SMTP sends</label>
          <label>WhatsApp API URL<input name="whatsappApiUrl" value="${channels.whatsappApiUrl || ''}" /></label>
          <label>WhatsApp API Token<input name="whatsappApiToken" type="password" placeholder="${channels.whatsappApiTokenSet ? 'Stored (enter to replace)' : 'Set WhatsApp token'}" /></label>
          <label>WhatsApp Default Sender<input name="whatsappDefaultSender" value="${channels.whatsappDefaultSender || ''}" /></label>
          <label class="checkbox"><input type="checkbox" name="whatsappSimulate" ${channels.whatsappSimulate ? 'checked' : ''} /> Simulate WhatsApp sends</label>
          <button type="submit">Save Channel Config</button>
          </form>
          <div class="actions">
          <input id="settingsTestEmail" type="email" value="${academy.contactEmail || ''}" placeholder="test email recipient" />
          <button id="testEmailBtn" class="ghost">Test Email</button>
          </div>
          <div class="actions">
          <input id="settingsTestWhatsApp" value="${academy.contactPhone || ''}" placeholder="test WhatsApp number" />
          <button id="testWhatsAppBtn" class="ghost">Test WhatsApp</button>
          </div>
        </details>
      </article>
    </div>
    <article class="card">
      <details class="settings-panel">
        <summary>Audit Trail</summary>
        <table>
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Section</th><th>Details</th></tr></thead>
        <tbody>
          ${
            audit
              .map((entry) => {
                const details = typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details ?? '');
                const shortDetails = details.length > 150 ? `${details.slice(0, 147)}...` : details;
                return `<tr>
                  <td>${formatDate(entry.createdAt)}</td>
                  <td>${entry.actor || '-'}</td>
                  <td>${entry.action || '-'}</td>
                  <td>${entry.section || '-'}</td>
                  <td><code>${shortDetails || '-'}</code></td>
                </tr>`;
              })
              .join('') || '<tr><td colspan="5">No audit activity found.</td></tr>'
          }
        </tbody>
        </table>
      </details>
    </article>
  `;

  document.querySelector('#academySettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const payload = {
      academyName: String(fd.get('academyName') || ''),
      divisionLine: String(fd.get('divisionLine') || ''),
      tagline: String(fd.get('tagline') || ''),
      contactEmail: String(fd.get('contactEmail') || ''),
      contactPhone: String(fd.get('contactPhone') || ''),
      addressLine: String(fd.get('addressLine') || ''),
      currency: String(fd.get('currency') || 'NAD').toUpperCase(),
      timezone: String(fd.get('timezone') || 'Africa/Windhoek'),
      bankName: String(fd.get('bankName') || ''),
      bankAccountName: String(fd.get('bankAccountName') || ''),
      bankAccountNumber: String(fd.get('bankAccountNumber') || '')
    };
    try {
      await api('/settings/academy', { method: 'PUT', body: payload });
      notify('Academy profile saved.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#billingSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const payload = {
      registrationFee: Number(fd.get('registrationFee') || 0),
      monthlyFee: Number(fd.get('monthlyFee') || 0),
      dueDayOfMonth: Number(fd.get('dueDayOfMonth') || 5),
      invoiceGraceDays: Number(fd.get('invoiceGraceDays') || 7),
      defaultCurrency: String(fd.get('defaultCurrency') || 'NAD').toUpperCase()
    };
    try {
      await api('/settings/billing', { method: 'PUT', body: payload });
      notify('Billing defaults saved.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#reminderSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const payload = {
      beforeDueDays: Number(fd.get('beforeDueDays') || 0),
      overdueDays: Number(fd.get('overdueDays') || 3),
      enableEmail: fd.get('enableEmail') === 'on',
      enableWhatsApp: fd.get('enableWhatsApp') === 'on'
    };
    try {
      await api('/settings/reminders', { method: 'PUT', body: payload });
      notify('Reminder rules saved.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#channelSettingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const payload = {
      smtpHost: optionalText(fd, 'smtpHost'),
      smtpPort: optionalNumber(fd, 'smtpPort'),
      smtpSecure: fd.get('smtpSecure') === 'on',
      smtpUser: optionalText(fd, 'smtpUser'),
      smtpPass: optionalText(fd, 'smtpPass'),
      emailFrom: optionalText(fd, 'emailFrom'),
      smtpSimulate: fd.get('smtpSimulate') === 'on',
      whatsappApiUrl: optionalText(fd, 'whatsappApiUrl'),
      whatsappApiToken: optionalText(fd, 'whatsappApiToken'),
      whatsappDefaultSender: optionalText(fd, 'whatsappDefaultSender'),
      whatsappSimulate: fd.get('whatsappSimulate') === 'on'
    };
    try {
      await api('/settings/channels', { method: 'PUT', body: payload });
      notify('Channel configuration saved.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#testEmailBtn').addEventListener('click', async () => {
    const toEmail = String(document.querySelector('#settingsTestEmail')?.value || '').trim();
    if (!toEmail) {
      notify('Enter a test email recipient first.', 'error');
      return;
    }
    try {
      const res = await api('/settings/channels/test-email', {
        method: 'POST',
        body: { toEmail }
      });
      notify(
        `Email test sent to ${res.data.recipient}${res.data.simulated ? ' (simulated)' : ''}.`,
        'success'
      );
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#testWhatsAppBtn').addEventListener('click', async () => {
    const toPhone = String(document.querySelector('#settingsTestWhatsApp')?.value || '').trim();
    if (!toPhone) {
      notify('Enter a test WhatsApp number first.', 'error');
      return;
    }
    try {
      const res = await api('/settings/channels/test-whatsapp', {
        method: 'POST',
        body: { toPhone }
      });
      notify(
        `WhatsApp test sent to ${res.data.recipient}${res.data.simulated ? ' (simulated)' : ''}.`,
        'success'
      );
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });
}

async function renderAttendanceView(host) {
  const sessionsRes = await api('/attendance/sessions?limit=100');
  const sessions = sessionsRes.data || [];

  host.innerHTML = `
    <div class="cards two">
      <article class="card">
        <h3>Create Session</h3>
        <form id="createSessionForm" class="stack">
          <label>Group
            <select name="groupCode">${groupOptions()}</select>
          </label>
          <label>Session Date<input type="date" name="sessionDate" required /></label>
          <label>Start Time<input type="time" name="startTime" /></label>
          <label>End Time<input type="time" name="endTime" /></label>
          <button type="submit">Create Session</button>
        </form>
      </article>
      <article class="card">
        <h3>Record Attendance</h3>
        <form id="attendanceRecordForm" class="stack">
          <label>Session ID<input name="sessionId" required placeholder="Paste session ID" /></label>
          <label>Player Code<input name="playerCode" required placeholder="DYN-2026-XXXXXX" /></label>
          <label>Status
            <select name="status">
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="excused">Excused</option>
            </select>
          </label>
          <label>Arrival Time<input type="time" name="arrivalTime" /></label>
          <button type="submit">Save Record</button>
        </form>
      </article>
    </div>
    <article class="card">
      <h3>Recent Sessions</h3>
      <table>
        <thead><tr><th>Session ID</th><th>Date</th><th>Group</th><th>Present</th><th>Absent</th><th>Total</th></tr></thead>
        <tbody>
          ${
            sessions
              .map(
                (s) =>
                  `<tr>
                    <td><code>${s.session_id}</code></td>
                    <td>${formatDate(s.session_date)}</td>
                    <td>${s.group_code}</td>
                    <td>${s.present_count}</td>
                    <td>${s.absent_count}</td>
                    <td>${s.total_count}</td>
                  </tr>`
              )
              .join('') || '<tr><td colspan="6">No sessions yet</td></tr>'
          }
        </tbody>
      </table>
    </article>
  `;

  document.querySelector('#createSessionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    if (!(formEl instanceof HTMLFormElement)) {
      return;
    }
    const fd = new FormData(formEl);
    const payload = {
      groupCode: String(fd.get('groupCode') || 'U13'),
      sessionDate: String(fd.get('sessionDate') || ''),
      startTime: optionalText(fd, 'startTime'),
      endTime: optionalText(fd, 'endTime')
    };
    try {
      const res = await api('/attendance/sessions', { method: 'POST', body: payload });
      notify(`Session created: ${res.data.sessionId}`, 'success');
      formEl.reset();
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#attendanceRecordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    if (!(formEl instanceof HTMLFormElement)) {
      return;
    }
    const fd = new FormData(formEl);
    const sessionId = String(fd.get('sessionId') || '');
    const payload = {
      records: [
        {
          playerCode: String(fd.get('playerCode') || ''),
          status: String(fd.get('status') || 'present'),
          arrivalTime: optionalText(fd, 'arrivalTime')
        }
      ]
    };
    try {
      const res = await api(`/attendance/sessions/${sessionId}/records`, {
        method: 'POST',
        body: payload
      });
      notify(`Attendance updated: ${res.data.updated}`, 'success');
      formEl.reset();
    } catch (error) {
      notify(error.message, 'error');
    }
  });
}

async function renderRemindersView(host) {
  const stageOptions = [
    { value: 'stage_1', label: 'Stage 1' },
    { value: 'stage_2', label: 'Stage 2' },
    { value: 'stage_3', label: 'Stage 3' },
    { value: 'final', label: 'Final' }
  ];
  const stageLabel = (value) => stageOptions.find((item) => item.value === value)?.label || 'None';

  const dashboardRes = await api('/reminders/collections/dashboard?limit=250');
  const dashboard = dashboardRes?.data || {};
  const metrics = dashboard.metrics || {};
  const overdueAccounts = Array.isArray(dashboard.overdueAccounts) ? dashboard.overdueAccounts : [];
  const dueThisWeekAccounts = Array.isArray(dashboard.dueThisWeekAccounts) ? dashboard.dueThisWeekAccounts : [];
  const fullyPaidAccounts = Array.isArray(dashboard.fullyPaidAccounts) ? dashboard.fullyPaidAccounts : [];

  function renderActionButtons(account) {
    return `
      <div class="mini-actions">
        <button class="ghost" data-collection-action="view" data-guardian-id="${account.guardianId}">View Account</button>
        <button data-collection-action="send" data-guardian-id="${account.guardianId}" data-stage="${account.reminderStage}">Send Reminder</button>
        <button class="ghost" data-collection-action="contact" data-guardian-id="${account.guardianId}">Mark Contacted</button>
      </div>
    `;
  }

  function renderAccountRows(accounts, emptyText, showSendActions = true) {
    if (!accounts.length) {
      return `<tr><td colspan="9">${emptyText}</td></tr>`;
    }
    return accounts
      .map((account) => {
        const players = (account.playerNames || []).join(', ');
        const stageBadgeClass = account.reminderStage === 'final' ? 'danger' : account.reminderStage === 'none' ? 'muted' : 'ok';
        const dueText =
          account.status === 'overdue'
            ? `${account.daysOverdue} day(s)`
            : account.daysUntilDue === null
              ? '-'
              : `In ${account.daysUntilDue} day(s)`;
        return `<tr>
          <td>${escapeHtml(account.guardianName)}</td>
          <td>${escapeHtml(players || '-')}</td>
          <td>${formatMoney(account.totalOutstanding, account.currency)}</td>
          <td>${formatDate(account.oldestDueDate)}</td>
          <td>${dueText}</td>
          <td>${formatDateTime(account.lastReminderSentAt)}</td>
          <td><span class="status-pill ${stageBadgeClass}">${escapeHtml(account.reminderStageLabel || 'None')}</span></td>
          <td><span class="status-pill ${account.status === 'overdue' ? 'danger' : account.status === 'due_this_week' ? 'warn' : 'ok'}">${escapeHtml(account.statusLabel || account.status)}</span></td>
          <td>${showSendActions ? renderActionButtons(account) : `<button class="ghost" data-collection-action="view" data-guardian-id="${account.guardianId}">View Account</button>`}</td>
        </tr>`;
      })
      .join('');
  }

  host.innerHTML = `
    <div class="cards four">
      <article class="card stat"><h3>${metrics.guardiansOverdue ?? 0}</h3><p>Overdue Accounts</p></article>
      <article class="card stat"><h3>${metrics.guardiansDueThisWeek ?? 0}</h3><p>Due This Week</p></article>
      <article class="card stat"><h3>${metrics.guardiansPaid ?? 0}</h3><p>Fully Paid</p></article>
      <article class="card stat"><h3>${formatMoney(metrics.totalOutstanding ?? 0)}</h3><p>Total Outstanding</p></article>
    </div>

    <article class="card">
      <h3>Fee Collection Management</h3>
      <div class="toolbar">
        <label class="inline-field">Single Reminder Channel
          <select id="singleReminderChannel">
            <option value="both">Both</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label class="inline-field">Bulk Channel
          <select id="bulkReminderChannel">
            <option value="both">Both</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <button class="bulk-stage-btn" data-stage="stage_1">Send Stage 1</button>
        <button class="bulk-stage-btn" data-stage="stage_2">Send Stage 2</button>
        <button class="bulk-stage-btn" data-stage="stage_3">Send Stage 3</button>
        <button class="bulk-stage-btn" data-stage="final">Send Final</button>
        <button id="runScheduledDispatchBtn" class="ghost">Run Scheduled Queue</button>
      </div>
      <p>Guardian-first collections workflow with staged reminders and communication tracking.</p>
    </article>

    <article class="card">
      <h3>Overdue Accounts</h3>
      <table>
        <thead><tr><th>Guardian</th><th>Player(s)</th><th>Outstanding</th><th>Oldest Due</th><th>Age</th><th>Last Reminder</th><th>Stage</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${renderAccountRows(overdueAccounts, 'No overdue accounts found.')}</tbody>
      </table>
    </article>

    <article class="card">
      <h3>Due This Week</h3>
      <table>
        <thead><tr><th>Guardian</th><th>Player(s)</th><th>Outstanding</th><th>Oldest Due</th><th>Age</th><th>Last Reminder</th><th>Stage</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${renderAccountRows(dueThisWeekAccounts, 'No due-this-week accounts found.')}</tbody>
      </table>
    </article>

    <article class="card">
      <h3>Fully Paid</h3>
      <table>
        <thead><tr><th>Guardian</th><th>Player(s)</th><th>Outstanding</th><th>Last Reminder</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${
            fullyPaidAccounts.length
              ? fullyPaidAccounts
                  .map(
                    (account) => `<tr>
                <td>${escapeHtml(account.guardianName)}</td>
                <td>${escapeHtml((account.playerNames || []).join(', '))}</td>
                <td>${formatMoney(account.totalOutstanding, account.currency)}</td>
                <td>${formatDateTime(account.lastReminderSentAt)}</td>
                <td><span class="status-pill ok">Fully Paid</span></td>
                <td><button class="ghost" data-collection-action="view" data-guardian-id="${account.guardianId}">View Account</button></td>
              </tr>`
                  )
                  .join('')
              : '<tr><td colspan="6">No fully paid accounts found.</td></tr>'
          }
        </tbody>
      </table>
    </article>

    <article class="card" id="collectionAccountDetail">
      <h3>Guardian Account Overview</h3>
      <p>Select a guardian from any table above to see invoice history, payments, reminders, and notes.</p>
    </article>
  `;

  async function loadGuardianAccount(guardianId) {
    const detailHost = document.querySelector('#collectionAccountDetail');
    if (!detailHost) {
      return;
    }
    detailHost.innerHTML = '<p>Loading guardian account...</p>';
    try {
      const detailRes = await api(`/reminders/collections/accounts/${guardianId}`);
      const detail = detailRes.data;
      const account = detail.account || {};
      const outstandingInvoices = (detail.invoices || []).filter((invoice) => Number(invoice.outstandingAmount || 0) > 0);
      const defaultStage = account.reminderStage && account.reminderStage !== 'none' ? account.reminderStage : 'stage_1';

      detailHost.innerHTML = `
        <h3>Guardian Account: ${escapeHtml(account.guardianName || '-')}</h3>
        <div class="details-grid">
          <div>
            <h4>Account Summary</h4>
            <p><strong>Total Outstanding:</strong> ${formatMoney(account.totalOutstanding || 0, account.currency || 'NAD')}</p>
            <p><strong>Status:</strong> ${escapeHtml(account.statusLabel || '-')}</p>
            <p><strong>Current Stage:</strong> ${escapeHtml(account.reminderStageLabel || '-')}</p>
            <p><strong>Last Reminder:</strong> ${formatDateTime(account.lastReminderSentAt)}</p>
          </div>
          <div>
            <h4>Contact</h4>
            <p><strong>Email:</strong> ${escapeHtml(account.guardianEmail || '-')}</p>
            <p><strong>WhatsApp:</strong> ${escapeHtml(account.guardianPhone || '-')}</p>
            <p><strong>Players:</strong> ${escapeHtml((account.playerNames || []).join(', ') || '-')}</p>
          </div>
        </div>
        <div class="toolbar">
          <label class="inline-field">Stage
            <select id="detailReminderStage">
              ${stageOptions
                .map((option) => `<option value="${option.value}" ${defaultStage === option.value ? 'selected' : ''}>${option.label}</option>`)
                .join('')}
            </select>
          </label>
          <label class="inline-field">Channel
            <select id="detailReminderChannel">
              <option value="both">Both</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <input id="detailContactNote" placeholder="Add contact note" />
          <button id="detailSendReminderBtn">Send Reminder</button>
          <button id="detailMarkContactedBtn" class="ghost">Mark Contacted</button>
        </div>
        <label>Custom Message (optional)
          <textarea id="detailCustomMessage" rows="3" placeholder="Leave blank to use automatic personalized reminder"></textarea>
        </label>
        <h4>Outstanding Invoices</h4>
        <table>
          <thead><tr><th>Invoice</th><th>Player</th><th>Due</th><th>Status</th><th>Outstanding</th><th>Description</th></tr></thead>
          <tbody>
            ${
              outstandingInvoices.length
                ? outstandingInvoices
                    .map(
                      (invoice) => `<tr>
                    <td>${escapeHtml(invoice.invoiceNumber)}</td>
                    <td>${escapeHtml(`${invoice.playerCode} - ${invoice.playerName}`)}</td>
                    <td>${formatDate(invoice.dueDate)}</td>
                    <td>${escapeHtml(invoice.status)}</td>
                    <td>${formatMoney(invoice.outstandingAmount, invoice.currency)}</td>
                    <td>${escapeHtml(invoice.lineSummary || '-')}</td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="6">No outstanding invoices.</td></tr>'
            }
          </tbody>
        </table>
        <h4>Payment History</h4>
        <table>
          <thead><tr><th>Date</th><th>Player</th><th>Method</th><th>Amount</th><th>Reference</th></tr></thead>
          <tbody>
            ${
              detail.payments.length
                ? detail.payments
                    .map(
                      (payment) => `<tr>
                    <td>${formatDate(payment.receivedOn)}</td>
                    <td>${escapeHtml(`${payment.playerCode} - ${payment.playerName}`)}</td>
                    <td>${escapeHtml(payment.method)}</td>
                    <td>${formatMoney(payment.amount, payment.currency)}</td>
                    <td>${escapeHtml(payment.paymentReference || payment.externalReference || '-')}</td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="5">No payments recorded.</td></tr>'
            }
          </tbody>
        </table>
        <h4>Reminder History</h4>
        <table>
          <thead><tr><th>When</th><th>Stage</th><th>Channel</th><th>Status</th><th>Message</th></tr></thead>
          <tbody>
            ${
              detail.reminderHistory.length
                ? detail.reminderHistory
                    .map(
                      (item) => `<tr>
                    <td>${formatDateTime(item.sentAt)}</td>
                    <td>${escapeHtml(stageLabel(item.stage) || item.stage)}</td>
                    <td>${escapeHtml(item.channel)}</td>
                    <td>${escapeHtml(item.status)}</td>
                    <td>${escapeHtml((item.messageSnapshot || '').slice(0, 140))}${(item.messageSnapshot || '').length > 140 ? '...' : ''}</td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="5">No reminder history yet.</td></tr>'
            }
          </tbody>
        </table>
        <h4>Contact Notes</h4>
        <table>
          <thead><tr><th>When</th><th>By</th><th>Note</th></tr></thead>
          <tbody>
            ${
              detail.contactNotes.length
                ? detail.contactNotes
                    .map(
                      (note) => `<tr>
                    <td>${formatDateTime(note.createdAt)}</td>
                    <td>${escapeHtml(note.createdBy)}</td>
                    <td>${escapeHtml(note.note)}</td>
                  </tr>`
                    )
                    .join('')
                : '<tr><td colspan="3">No contact notes yet.</td></tr>'
            }
          </tbody>
        </table>
      `;

      document.querySelector('#detailSendReminderBtn')?.addEventListener('click', async () => {
        const channel = String(document.querySelector('#detailReminderChannel')?.value || 'both');
        const stage = String(document.querySelector('#detailReminderStage')?.value || 'stage_1');
        const customMessage = String(document.querySelector('#detailCustomMessage')?.value || '').trim();
        try {
          const result = await api(`/reminders/collections/accounts/${guardianId}/send`, {
            method: 'POST',
            body: {
              channel,
              stage,
              customMessage: customMessage || undefined
            }
          });
          notify(
            `Reminder sent. Email: ${result.data.sentEmail}, WhatsApp: ${result.data.sentWhatsApp}, Failed: ${result.data.failed}${result.data.simulated ? `, Simulated: ${result.data.simulated}` : ''}`,
            result.data.failed > 0 ? 'info' : 'success'
          );
          await loadView();
        } catch (error) {
          notify(error.message, 'error');
        }
      });

      document.querySelector('#detailMarkContactedBtn')?.addEventListener('click', async () => {
        const note = String(document.querySelector('#detailContactNote')?.value || '').trim();
        if (!note) {
          notify('Please add a contact note first.', 'error');
          return;
        }
        try {
          await api(`/reminders/collections/accounts/${guardianId}/contacted`, {
            method: 'POST',
            body: { note }
          });
          notify('Contact note saved.', 'success');
          await loadView();
        } catch (error) {
          notify(error.message, 'error');
        }
      });
    } catch (error) {
      detailHost.innerHTML = `<p class="error">Failed to load guardian account: ${escapeHtml(error.message)}</p>`;
    }
  }

  document.querySelector('#runScheduledDispatchBtn')?.addEventListener('click', async () => {
    try {
      const res = await api('/reminders/dispatch-due', {
        method: 'POST',
        body: { limit: 200 }
      });
      notify(`Scheduled queue dispatched. Sent: ${res.data.sent}, Failed: ${res.data.failed}`, 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelectorAll('.bulk-stage-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const stage = button.dataset.stage;
      const channel = String(document.querySelector('#bulkReminderChannel')?.value || 'both');
      try {
        const res = await api('/reminders/collections/bulk-send', {
          method: 'POST',
          body: { stage, channel, limit: 200 }
        });
        notify(
          `Bulk ${stageLabel(stage)} complete. Targets: ${res.data.targets}, Email: ${res.data.sentEmail}, WhatsApp: ${res.data.sentWhatsApp}, Failed: ${res.data.failed}${res.data.simulated ? `, Simulated: ${res.data.simulated}` : ''}`,
          res.data.failed > 0 ? 'info' : 'success'
        );
        await loadView();
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-collection-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const guardianId = button.dataset.guardianId;
      if (!guardianId) {
        return;
      }
      state.selectedCollectionGuardianId = guardianId;
      const action = button.dataset.collectionAction;
      if (action === 'view') {
        await loadGuardianAccount(guardianId);
        return;
      }
      if (action === 'send') {
        const channel = String(document.querySelector('#singleReminderChannel')?.value || 'both');
        const stage = String(button.dataset.stage || 'stage_1');
        try {
          const res = await api(`/reminders/collections/accounts/${guardianId}/send`, {
            method: 'POST',
            body: {
              channel,
              stage: stage === 'none' ? 'stage_1' : stage
            }
          });
          notify(
            `Reminder sent. Email: ${res.data.sentEmail}, WhatsApp: ${res.data.sentWhatsApp}, Failed: ${res.data.failed}${res.data.simulated ? `, Simulated: ${res.data.simulated}` : ''}`,
            res.data.failed > 0 ? 'info' : 'success'
          );
          await loadView();
          return;
        } catch (error) {
          notify(error.message, 'error');
          return;
        }
      }
      if (action === 'contact') {
        const note = window.prompt('Enter contact note');
        if (!note || !note.trim()) {
          return;
        }
        try {
          await api(`/reminders/collections/accounts/${guardianId}/contacted`, {
            method: 'POST',
            body: { note: note.trim() }
          });
          notify('Contact note saved.', 'success');
          await loadView();
          return;
        } catch (error) {
          notify(error.message, 'error');
        }
      }
    });
  });

  if (state.selectedCollectionGuardianId) {
    await loadGuardianAccount(state.selectedCollectionGuardianId);
  }
}

void bootstrap();
