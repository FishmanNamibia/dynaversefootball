const appRoot = document.querySelector('#app');

const state = {
  apiBase: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5003/api',
  token: localStorage.getItem('dynaacademy_token') || '',
  user: null,
  activeView: 'dashboard',
  groups: [],
  selectedPlayer: null,
  selectedBillingPlayerCode: null,
  selectedCollectionGuardianId: null,
  operationsStage: 'inventory',
  operationsPayrollPeriod: new Date().toISOString().slice(0, 7),
  reportsFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  reportsTo: new Date().toISOString().slice(0, 10)
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
          <button data-view="operations" class="nav-btn ${state.activeView === 'operations' ? 'active' : ''}">Operations</button>
          <button data-view="reports" class="nav-btn ${state.activeView === 'reports' ? 'active' : ''}">Reports</button>
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
    state.selectedBillingPlayerCode = null;
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
  if (view === 'operations') return 'Inventory, Needs, Procurement & Staff Payments';
  if (view === 'reports') return 'Financial Transparency & Accountability';
  if (view === 'settings') return 'System Configuration Center';
  return 'Football Academy Dashboard';
}

function viewSubtitle(view) {
  if (view === 'registration') return 'Capture full player, guardian, medical, and consent data.';
  if (view === 'players') return 'Search players and review profile details.';
  if (view === 'billing') return 'Generate invoices/receipts, send invoice communications, and manage activity contribution fees.';
  if (view === 'attendance') return 'Create sessions and mark player attendance.';
  if (view === 'reminders') return 'Send due reminders and outstanding monthly fee notifications to parents.';
  if (view === 'operations') return 'Control stock readiness, club needs, procurement workflow, funding, and salary payouts.';
  if (view === 'reports') return 'Track every transfer, usage, and proof trail for financial transparency.';
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
    if (state.activeView === 'operations') {
      await renderOperationsView(host);
      return;
    }
    if (state.activeView === 'reports') {
      await renderReportsView(host);
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
  const [playersRes, invoicesRes, remindersRes, sessionsRes, operationsRes, fundingRes, staffPaymentsRes] =
    await Promise.all([
      api('/players?limit=500'),
      api('/billing/invoices?limit=500'),
      api('/reminders/pending?limit=500'),
      api('/attendance/sessions?limit=30'),
      api('/operations/dashboard'),
      api('/operations/funding/sources?limit=500'),
      api('/operations/staff/payments?status=all&limit=500')
    ]);

  const players = playersRes.data || [];
  const allInvoices = invoicesRes.data || [];
  const reminders = remindersRes.data || [];
  const sessions = sessionsRes.data || [];
  const operations = operationsRes.data || {};
  const opMetrics = operations.metrics || {};
  const funding = fundingRes.data || [];
  const staffPayments = staffPaymentsRes.data || [];

  const openInvoices = allInvoices.filter((invoice) => ['sent', 'partially_paid', 'overdue'].includes(invoice.status));
  const overdueInvoices = allInvoices.filter((invoice) => invoice.status === 'overdue');

  const totalInvoiced = allInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
  const totalCollected = allInvoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount || 0), 0);
  const totalOutstanding = allInvoices.reduce(
    (sum, invoice) => sum + Math.max(Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0),
    0
  );
  const overdueOutstanding = overdueInvoices.reduce(
    (sum, invoice) => sum + Math.max(Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0),
    0
  );
  const collectionRate = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const issuedThisMonth = allInvoices
    .filter((invoice) => String(invoice.issue_date || '').startsWith(monthKey))
    .reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);

  const fundingCommitted = funding.reduce((sum, source) => sum + Number(source.committedAmount || 0), 0);
  const fundingReceived = funding.reduce((sum, source) => sum + Number(source.receivedAmount || 0), 0);
  const fundingGap = Math.max(fundingCommitted - fundingReceived, 0);

  const salaryDue = staffPayments.reduce((sum, payment) => sum + Number(payment.amountDue || 0), 0);
  const salaryPaid = staffPayments.reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0);
  const salaryOutstanding = staffPayments.reduce(
    (sum, payment) => sum + Math.max(Number(payment.amountDue || 0) - Number(payment.amountPaid || 0), 0),
    0
  );
  const pendingSalaries = staffPayments.filter((payment) => ['pending', 'part_paid'].includes(payment.status)).length;

  host.innerHTML = `
    <div class="cards four">
      <article class="card stat"><h3>${players.length}</h3><p>Active Players</p></article>
      <article class="card stat"><h3>${openInvoices.length}</h3><p>Open Invoices</p></article>
      <article class="card stat"><h3>${formatMoney(totalOutstanding)}</h3><p>Total Outstanding</p></article>
      <article class="card stat"><h3>${formatMoney(totalCollected)}</h3><p>Total Collected</p></article>
    </div>
    <div class="cards four">
      <article class="card stat"><h3>${formatMoney(overdueOutstanding)}</h3><p>Overdue Amount</p></article>
      <article class="card stat"><h3>${collectionRate.toFixed(1)}%</h3><p>Collection Rate</p></article>
      <article class="card stat"><h3>${formatMoney(salaryOutstanding)}</h3><p>Salary Outstanding</p></article>
      <article class="card stat"><h3>${formatMoney(opMetrics.needsBudgetOpen ?? 0)}</h3><p>Needs Budget Open</p></article>
    </div>
    <div class="cards two">
      <article class="card">
        <h3>Financial Control Snapshot</h3>
        <table>
          <tbody>
            <tr><th>Total Invoiced</th><td>${formatMoney(totalInvoiced)}</td></tr>
            <tr><th>Issued (${monthLabel})</th><td>${formatMoney(issuedThisMonth)}</td></tr>
            <tr><th>Total Collected</th><td>${formatMoney(totalCollected)}</td></tr>
            <tr><th>Outstanding Balance</th><td>${formatMoney(totalOutstanding)}</td></tr>
            <tr><th>Funding Committed</th><td>${formatMoney(fundingCommitted)}</td></tr>
            <tr><th>Funding Received</th><td>${formatMoney(fundingReceived)}</td></tr>
            <tr><th>Funding Gap</th><td>${formatMoney(fundingGap)}</td></tr>
            <tr><th>Payroll Due</th><td>${formatMoney(salaryDue)}</td></tr>
            <tr><th>Payroll Paid</th><td>${formatMoney(salaryPaid)}</td></tr>
            <tr><th>Payroll Outstanding</th><td>${formatMoney(salaryOutstanding)}</td></tr>
          </tbody>
        </table>
      </article>
      <article class="card">
        <h3>Operational Queue</h3>
        <ul class="queue">
          <li>Pending reminders: <strong>${reminders.length}</strong></li>
          <li>Attendance sessions tracked: <strong>${sessions.length}</strong></li>
          <li>Open invoices: <strong>${openInvoices.length}</strong></li>
          <li>Overdue invoices: <strong>${overdueInvoices.length}</strong></li>
          <li>Low stock items: <strong>${opMetrics.lowStockItems ?? 0}</strong></li>
          <li>Open needs: <strong>${opMetrics.openNeeds ?? 0}</strong></li>
          <li>Procurement pipeline: <strong>${opMetrics.procurementPipeline ?? 0}</strong></li>
          <li>Pending salary payments: <strong>${pendingSalaries}</strong></li>
          <li>Next monthly billing run: <strong>1st day of month</strong></li>
        </ul>
      </article>
    </div>
    <article class="card">
      <h3>Recent Players</h3>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Group</th><th>Joined</th></tr></thead>
        <tbody>
          ${
            players
              .slice(0, 10)
              .map(
                (p) =>
                  `<tr><td>${p.player_code}</td><td>${p.first_name} ${p.last_name}</td><td>${p.training_group_code || '-'}</td><td>${formatDate(p.joined_on)}</td></tr>`
              )
              .join('') || '<tr><td colspan="4">No players yet</td></tr>'
          }
        </tbody>
      </table>
    </article>
  `;
}

function groupOptions() {
  const options = state.groups.map((g) => `<option value="${g.code}">${g.code} - ${g.display_name}</option>`);
  return options.join('');
}

function playerOptions(players, selectedCode = '') {
  return players
    .map(
      (player) =>
        `<option value="${player.player_code}" ${selectedCode === player.player_code ? 'selected' : ''}>${player.player_code} - ${player.first_name} ${player.last_name}</option>`
    )
    .join('');
}

function openBillingForPlayer(playerCode) {
  if (!playerCode) {
    return;
  }
  state.selectedBillingPlayerCode = playerCode;
  state.activeView = 'billing';
  render();
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
  const renderRows = (rows) =>
    rows
      .map(
        (p) =>
          `<tr data-player-id="${p.player_id}" data-player-code="${p.player_code}">
            <td>${p.player_code}</td>
            <td>${p.first_name} ${p.last_name}</td>
            <td>${p.training_group_code || '-'}</td>
            <td>${p.guardian_name || '-'}</td>
            <td>${p.guardian_phone || '-'}</td>
            <td>${p.status}</td>
            <td class="mini-actions">
              <button class="ghost" data-player-action="open-billing" data-player-code="${p.player_code}">Billing</button>
            </td>
          </tr>`
      )
      .join('');

  host.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="playerSearch" placeholder="Search by player code or name..." />
        <button id="searchPlayersBtn">Search</button>
      </div>
      <table id="playersTable">
        <thead><tr><th>Player Code</th><th>Name</th><th>Group</th><th>Guardian</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${
            renderRows(players) || '<tr><td colspan="7">No players found</td></tr>'
          }
        </tbody>
      </table>
    </div>
    <div class="card" id="playerDetailsCard">
      <h3>Player Details</h3>
      <p>Select a player row to view profile, medical, and guardian details.</p>
    </div>
  `;

  document.querySelector('#playersTable')?.addEventListener('click', async (event) => {
    const billingBtn = event.target.closest('button[data-player-action="open-billing"]');
    if (billingBtn) {
      const playerCode = billingBtn.dataset.playerCode;
      openBillingForPlayer(playerCode);
      return;
    }

    const row = event.target.closest('tr[data-player-id]');
    if (!row) {
      return;
    }
    const playerId = row.dataset.playerId;
    if (!playerId) {
      return;
    }
    try {
      const details = await api(`/players/${playerId}`);
      state.selectedPlayer = details.data;
      renderPlayerDetails(details.data);
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#searchPlayersBtn').addEventListener('click', async () => {
    const term = document.querySelector('#playerSearch').value.trim();
    try {
      const result = await api(`/players?search=${encodeURIComponent(term)}&limit=200`);
      const tableBody = document.querySelector('#playersTable tbody');
      const data = result.data || [];
      tableBody.innerHTML =
        renderRows(data) || '<tr><td colspan="7">No players found</td></tr>';
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
    <div class="actions">
      <button id="openSelectedPlayerBillingBtn">Open Billing, Payment History & Actions</button>
    </div>
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

  card.querySelector('#openSelectedPlayerBillingBtn')?.addEventListener('click', () => {
    openBillingForPlayer(player.player_code);
  });
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
  const hasFocusedPlayer =
    Boolean(state.selectedBillingPlayerCode) &&
    players.some((player) => player.player_code === state.selectedBillingPlayerCode);
  if (state.selectedBillingPlayerCode && !hasFocusedPlayer) {
    state.selectedBillingPlayerCode = null;
  }
  const focusedPlayerCode = hasFocusedPlayer ? state.selectedBillingPlayerCode : null;
  let focusedPlayerAccount = null;
  if (focusedPlayerCode) {
    try {
      const accountRes = await api(`/billing/players/${encodeURIComponent(focusedPlayerCode)}/account?limit=100`);
      focusedPlayerAccount = accountRes.data || null;
    } catch (error) {
      notify(`Could not load player billing history: ${error.message}`, 'error');
    }
  }
  const defaultDueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const focusedAccountCard = focusedPlayerAccount
    ? `
      <article class="card" id="focusedPlayerBillingCard">
        <div class="section-head">
          <h3>Player Billing Account: ${escapeHtml(focusedPlayerAccount.player.code)} - ${escapeHtml(focusedPlayerAccount.player.name)}</h3>
          <div class="mini-actions">
            <button id="focusPlayerPaymentBtn">Action Payment</button>
            <button id="clearFocusedPlayerBtn" class="ghost">Clear</button>
          </div>
        </div>
        <div class="cards four">
          <article class="card stat"><h3>${formatMoney(focusedPlayerAccount.totals.totalInvoiced)}</h3><p>Total Invoiced</p></article>
          <article class="card stat"><h3>${formatMoney(focusedPlayerAccount.totals.totalPaidToInvoices)}</h3><p>Paid to Invoices</p></article>
          <article class="card stat"><h3>${formatMoney(focusedPlayerAccount.totals.totalOutstanding)}</h3><p>Outstanding</p></article>
          <article class="card stat"><h3>${focusedPlayerAccount.totals.paymentCount}</h3><p>Payments Recorded</p></article>
        </div>
        <div class="details-grid">
          <div>
            <h4>Player</h4>
            <p><strong>Group:</strong> ${escapeHtml(focusedPlayerAccount.player.trainingGroupCode || '-')}</p>
            <p><strong>Status:</strong> ${escapeHtml(focusedPlayerAccount.player.status || '-')}</p>
          </div>
          <div>
            <h4>Guardian</h4>
            <p><strong>Name:</strong> ${escapeHtml(focusedPlayerAccount.guardian.name || '-')}</p>
            <p><strong>Phone:</strong> ${escapeHtml(focusedPlayerAccount.guardian.phone || '-')}</p>
            <p><strong>Email:</strong> ${escapeHtml(focusedPlayerAccount.guardian.email || '-')}</p>
          </div>
        </div>
        <h4>Player Invoices</h4>
        <table id="focusedPlayerInvoiceTable">
          <thead><tr><th>Invoice</th><th>Type</th><th>Issue</th><th>Due</th><th>Status</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Actions</th></tr></thead>
          <tbody>
            ${
              focusedPlayerAccount.invoices.length
                ? focusedPlayerAccount.invoices
                    .map(
                      (invoice) => `<tr>
                        <td>${escapeHtml(invoice.invoiceNumber)}</td>
                        <td>${escapeHtml(invoice.invoiceTypeLabel || invoice.invoiceType || 'Other Fee')}</td>
                        <td>${formatDate(invoice.issueDate)}</td>
                        <td>${formatDate(invoice.dueDate)}</td>
                        <td>${escapeHtml(invoice.status)}</td>
                        <td>${formatMoney(invoice.totalAmount, invoice.currency)}</td>
                        <td>${formatMoney(invoice.paidAmount, invoice.currency)}</td>
                        <td>${formatMoney(invoice.outstandingAmount, invoice.currency)}</td>
                        <td class="mini-actions">
                          ${
                            Number(invoice.outstandingAmount || 0) > 0
                              ? `<button data-action="pay" data-id="${invoice.invoiceId}">Pay</button>`
                              : ''
                          }
                          <button class="ghost" data-action="view" data-id="${invoice.invoiceId}">Details</button>
                          <button class="ghost" data-action="download" data-id="${invoice.invoiceId}">PDF</button>
                        </td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="9">No invoices for this player.</td></tr>'
            }
          </tbody>
        </table>
        <h4>Payment History</h4>
        <table id="focusedPlayerPaymentTable">
          <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Allocated</th><th>Unallocated</th><th>Allocation Type</th><th>Reference</th><th>Receipt</th><th>Reallocate</th></tr></thead>
          <tbody>
            ${
              focusedPlayerAccount.payments.length
                ? focusedPlayerAccount.payments
                    .map(
                      (payment) => `<tr>
                        <td>${formatDate(payment.receivedOn)}</td>
                        <td>${escapeHtml(payment.method)}</td>
                        <td>${formatMoney(payment.amount, payment.currency)}</td>
                        <td>${formatMoney(payment.allocatedAmount, payment.currency)}</td>
                        <td>${formatMoney(payment.unallocatedAmount, payment.currency)}</td>
                        <td>${escapeHtml(
                          payment.allocations?.length
                            ? Array.from(new Set(payment.allocations.map((entry) => entry.invoiceTypeLabel || entry.invoiceType || 'Other Fee'))).join(', ')
                            : payment.unallocatedAmount > 0
                              ? 'Unallocated'
                              : 'Auto'
                        )}</td>
                        <td>${escapeHtml(payment.paymentReference || payment.externalReference || '-')}</td>
                        <td><button class="ghost" data-payment-receipt-id="${payment.paymentId}">Receipt PDF</button></td>
                        <td><button class="ghost" data-payment-reallocate-id="${payment.paymentId}">Reallocate</button></td>
                      </tr>`
                    )
                    .join('')
                : '<tr><td colspan="9">No payments recorded for this player.</td></tr>'
            }
          </tbody>
        </table>
      </article>
    `
    : `
      <article class="card" id="focusedPlayerBillingCard">
        <h3>Player Billing Account</h3>
        <p>Open a player from <strong>Player Directory</strong> and click <strong>Billing</strong> to view payment history and action payments for that player.</p>
      </article>
    `;

  host.innerHTML = `
    ${focusedAccountCard}
    ${
      focusedPlayerAccount
        ? `<article class="card" id="paymentReallocationCard">
            <h3>Payment Reallocation</h3>
            <p>Select <strong>Reallocate</strong> on a payment row to move allocations to the correct invoice(s).</p>
          </article>`
        : ''
    }
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
              ${playerOptions(players, focusedPlayerCode || '')}
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
          <label>Allocate To
            <select name="allocationType">
              <option value="auto">Auto (oldest open invoices)</option>
              <option value="registration">Registration Fee</option>
              <option value="monthly_subscription">Monthly Training Fee</option>
              <option value="activity_contribution">Activity Contribution</option>
              <option value="other">Other Fee</option>
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
              ${playerOptions(players, focusedPlayerCode || '')}
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
    <article class="card" id="invoiceDirectPaymentCard">
      <h3>Pay Invoice Directly</h3>
      <p>Select <strong>Pay</strong> on an invoice row to open a fast, pre-filled payment form for that invoice.</p>
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
                      <button data-action="pay" data-id="${inv.invoice_id}">Pay</button>
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

  document.querySelector('#clearFocusedPlayerBtn')?.addEventListener('click', async () => {
    state.selectedBillingPlayerCode = null;
    await loadView();
  });

  document.querySelector('#focusPlayerPaymentBtn')?.addEventListener('click', () => {
    const paymentForm = document.querySelector('#paymentForm');
    if (!(paymentForm instanceof HTMLFormElement)) {
      return;
    }
    const outstandingAmount = Number(focusedPlayerAccount?.totals?.totalOutstanding || 0);
    const amountInput = paymentForm.querySelector('input[name="amount"]');
    if (amountInput instanceof HTMLInputElement && outstandingAmount > 0) {
      amountInput.value = outstandingAmount.toFixed(2);
    }
    paymentForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.querySelectorAll('[data-payment-receipt-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const paymentId = button.dataset.paymentReceiptId;
      if (!paymentId) {
        return;
      }
      try {
        await downloadProtectedFile(`/billing/payments/${paymentId}/receipt.pdf`, `receipt-${paymentId}.pdf`);
        notify('Receipt downloaded.', 'success');
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });

  function renderPaymentReallocationForm(paymentId) {
    const card = document.querySelector('#paymentReallocationCard');
    if (!card || !focusedPlayerAccount) {
      return;
    }
    const payment = focusedPlayerAccount.payments.find((entry) => entry.paymentId === paymentId);
    if (!payment) {
      card.innerHTML = '<p class="error">Payment not found for reallocation.</p>';
      return;
    }

    const currentAllocations = new Map(
      (payment.allocations || []).map((allocation) => [allocation.invoiceId, Number(allocation.allocatedAmount || 0)])
    );
    const draftAllocations = new Map(currentAllocations);
    const invoiceMeta = focusedPlayerAccount.invoices.map((invoice) => {
      const current = currentAllocations.get(invoice.invoiceId) || 0;
      const maxAlloc = Number(invoice.outstandingAmount || 0) + current;
      const typeCode = invoice.invoiceType || 'other';
      const typeLabel = invoice.invoiceTypeLabel || 'Other Fee';
      return { ...invoice, current, maxAlloc, typeCode, typeLabel };
    });
    const candidateInvoices = invoiceMeta.filter((invoice) => invoice.maxAlloc > 0.00001);
    const typeEntries = Array.from(new Map(candidateInvoices.map((invoice) => [invoice.typeCode, invoice.typeLabel])).entries());

    const resetCard = () => {
      card.innerHTML = `
        <h3>Payment Reallocation</h3>
        <p>Select <strong>Reallocate</strong> on a payment row to move allocations to the correct invoice(s).</p>
      `;
    };

    const renderReallocationForm = (selectedType = 'all') => {
      const filteredInvoices =
        selectedType === 'all' ? candidateInvoices : candidateInvoices.filter((invoice) => invoice.typeCode === selectedType);
      const stagedTotal = Array.from(draftAllocations.values()).reduce((sum, amount) => sum + Number(amount || 0), 0);

      const invoiceRows = filteredInvoices
        .map((invoice) => {
          const staged = draftAllocations.get(invoice.invoiceId) || 0;
          return `<tr>
            <td>${escapeHtml(invoice.invoiceNumber)}</td>
            <td>${escapeHtml(invoice.typeLabel)}</td>
            <td>${escapeHtml(invoice.status)}</td>
            <td>${formatMoney(invoice.outstandingAmount, invoice.currency)}</td>
            <td>${formatMoney(invoice.maxAlloc, invoice.currency)}</td>
            <td>
              <input
                type="number"
                min="0"
                max="${invoice.maxAlloc.toFixed(2)}"
                step="0.01"
                value="${staged > 0 ? staged.toFixed(2) : ''}"
                placeholder="0.00"
                data-invoice-id="${invoice.invoiceId}"
                data-max="${invoice.maxAlloc.toFixed(2)}"
              />
            </td>
          </tr>`;
        })
        .join('');

      card.innerHTML = `
        <h3>Reallocate Payment</h3>
        <p><strong>Payment Date:</strong> ${formatDate(payment.receivedOn)} | <strong>Amount:</strong> ${formatMoney(payment.amount, payment.currency)} | <strong>Current Allocated:</strong> ${formatMoney(payment.allocatedAmount, payment.currency)} | <strong>Unallocated:</strong> ${formatMoney(payment.unallocatedAmount, payment.currency)}</p>
        <div class="toolbar">
          <label class="inline-field">Invoice Type
            <select id="reallocationTypeFilter">
              <option value="all" ${selectedType === 'all' ? 'selected' : ''}>All Types</option>
              ${typeEntries
                .map(([typeCode, typeLabel]) => `<option value="${escapeHtml(typeCode)}" ${selectedType === typeCode ? 'selected' : ''}>${escapeHtml(typeLabel)}</option>`)
                .join('')}
            </select>
          </label>
          <p><strong>Staged Allocation:</strong> ${formatMoney(stagedTotal, payment.currency)} / ${formatMoney(payment.amount, payment.currency)}</p>
        </div>
        <form id="reallocatePaymentForm" class="stack">
          <table>
            <thead><tr><th>Invoice</th><th>Type</th><th>Status</th><th>Outstanding</th><th>Max Allowed</th><th>Allocate Now</th></tr></thead>
            <tbody>
              ${
                invoiceRows ||
                '<tr><td colspan="6">No invoices available for this type. Choose another invoice type.</td></tr>'
              }
            </tbody>
          </table>
          <div class="actions">
            <button type="submit">Apply Reallocation</button>
            <button type="button" class="ghost" id="cancelReallocationBtn">Cancel</button>
          </div>
        </form>
      `;

      card.querySelector('#reallocationTypeFilter')?.addEventListener('change', (event) => {
        const nextType = String(event.currentTarget?.value || 'all');
        renderReallocationForm(nextType);
      });

      card.querySelectorAll('input[data-invoice-id]').forEach((input) => {
        input.addEventListener('input', () => {
          const invoiceId = input.dataset.invoiceId;
          const maxAllowed = Number(input.dataset.max || 0);
          if (!invoiceId) {
            return;
          }
          let value = Number(String(input.value || '').trim());
          if (!Number.isFinite(value) || value < 0) {
            value = 0;
          }
          if (value > maxAllowed) {
            value = maxAllowed;
            input.value = maxAllowed.toFixed(2);
          }
          if (value > 0) {
            draftAllocations.set(invoiceId, Number(value.toFixed(2)));
          } else {
            draftAllocations.delete(invoiceId);
          }
        });
      });

      card.querySelector('#cancelReallocationBtn')?.addEventListener('click', () => {
        resetCard();
      });

      card.querySelector('#reallocatePaymentForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const allocations = Array.from(draftAllocations.entries())
          .map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) }))
          .filter((row) => Number.isFinite(row.amount) && row.amount > 0);

        const totalAllocation = allocations.reduce((sum, row) => sum + row.amount, 0);
        if (totalAllocation - Number(payment.amount || 0) > 0.00001) {
          notify('Total reallocation cannot exceed payment amount.', 'error');
          return;
        }

        try {
          const result = await api(`/billing/payments/${payment.paymentId}/reallocate`, {
            method: 'POST',
            body: { allocations }
          });
          notify(
            `Payment reallocated. Allocated: ${formatMoney(result.data.allocatedAmount, payment.currency)}, Unallocated: ${formatMoney(result.data.unallocatedAmount, payment.currency)}`,
            'success'
          );
          await loadView();
        } catch (error) {
          notify(error.message, 'error');
        }
      });
    };

    if (candidateInvoices.length === 0) {
      card.innerHTML = `
        <h3>Reallocate Payment</h3>
        <p>This payment has no eligible invoices for allocation. Create invoice(s) first, then reallocate.</p>
        <div class="actions">
          <button type="button" class="ghost" id="cancelReallocationBtn">Close</button>
        </div>
      `;
      card.querySelector('#cancelReallocationBtn')?.addEventListener('click', () => {
        resetCard();
      });
      return;
    }

    renderReallocationForm('all');
  }

  document.querySelectorAll('[data-payment-reallocate-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const paymentId = button.dataset.paymentReallocateId;
      if (!paymentId) {
        return;
      }
      renderPaymentReallocationForm(paymentId);
      document.querySelector('#paymentReallocationCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
      allocationType: String(fd.get('allocationType') || 'auto'),
      paymentReference: optionalText(fd, 'paymentReference')
    };
    try {
      const res = await api('/billing/payments', { method: 'POST', body: payload });
      state.selectedBillingPlayerCode = payload.playerCode || state.selectedBillingPlayerCode;
      notify(
        `Payment recorded (${res.data.allocationType}). Allocated: ${res.data.allocatedAmount}, Unallocated: ${res.data.unallocatedAmount}`,
        res.data.unallocatedAmount > 0 ? 'info' : 'success'
      );
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
      state.selectedBillingPlayerCode = payload.playerCode || state.selectedBillingPlayerCode;
      notify(`Activity fee invoice created: ${res.data.invoiceNumber}`, 'success');
      formEl.reset();
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  host.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || !host.contains(button)) {
      return;
    }
    const action = button.dataset.action;
    const invoiceId = button.dataset.id;
    if (!invoiceId) {
      return;
    }

    try {
      if (action === 'pay') {
        const detail = await api(`/billing/invoices/${invoiceId}`);
        const d = detail.data;
        const directPayCard = document.querySelector('#invoiceDirectPaymentCard');
        if (!directPayCard) {
          notify('Direct invoice payment panel unavailable. Reload page.', 'error');
          return;
        }

        const outstandingAmount = Number(d.invoice.outstandingAmount || 0);
        if (outstandingAmount <= 0) {
          notify('This invoice is already fully paid.', 'info');
          return;
        }

        const defaultPaymentRef = d.invoice.invoiceNumber;
        const today = new Date().toISOString().slice(0, 10);

        directPayCard.innerHTML = `
          <h3>Pay Invoice ${escapeHtml(d.invoice.invoiceNumber)}</h3>
          <p><strong>Player:</strong> ${escapeHtml(`${d.player.code} - ${d.player.name}`)}</p>
          <p><strong>Type:</strong> ${escapeHtml(d.items?.[0]?.description || 'Invoice item')}</p>
          <p><strong>Outstanding:</strong> ${formatMoney(outstandingAmount, d.invoice.currency)}</p>
          <form id="directInvoicePaymentForm" class="stack">
            <input type="hidden" name="invoiceId" value="${d.invoice.id}" />
            <label>Amount to Pay
              <input name="amount" type="number" min="0.01" max="${outstandingAmount.toFixed(2)}" step="0.01" value="${outstandingAmount.toFixed(2)}" required />
            </label>
            <label>Method
              <select name="method">
                <option value="eft">EFT</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Payment Date
              <input name="receivedOn" type="date" value="${today}" />
            </label>
            <label>Payment Reference
              <input name="paymentReference" value="${escapeHtml(defaultPaymentRef)}" />
            </label>
            <div class="actions">
              <button type="submit">Pay This Invoice</button>
              <button type="button" id="cancelDirectInvoicePaymentBtn" class="ghost">Cancel</button>
            </div>
          </form>
        `;

        directPayCard.querySelector('#cancelDirectInvoicePaymentBtn')?.addEventListener('click', () => {
          directPayCard.innerHTML = `
            <h3>Pay Invoice Directly</h3>
            <p>Select <strong>Pay</strong> on an invoice row to open a fast, pre-filled payment form for that invoice.</p>
          `;
        });

        directPayCard.querySelector('#directInvoicePaymentForm')?.addEventListener('submit', async (payEvent) => {
          payEvent.preventDefault();
          const formEl = payEvent.currentTarget;
          if (!(formEl instanceof HTMLFormElement)) {
            return;
          }
          const fd = new FormData(formEl);
          const amount = Number(fd.get('amount') || 0);
          const maxAmount = Number(outstandingAmount);
          if (!Number.isFinite(amount) || amount <= 0) {
            notify('Enter a valid payment amount.', 'error');
            return;
          }
          if (amount - maxAmount > 0.00001) {
            notify('Amount cannot exceed invoice outstanding.', 'error');
            return;
          }

          const payload = {
            amount,
            method: String(fd.get('method') || 'eft'),
            receivedOn: optionalText(fd, 'receivedOn'),
            paymentReference: optionalText(fd, 'paymentReference')
          };

          try {
            const payRes = await api(`/billing/invoices/${d.invoice.id}/pay`, {
              method: 'POST',
              body: payload
            });
            state.selectedBillingPlayerCode = d.player.code || state.selectedBillingPlayerCode;
            notify(
              `Invoice paid. Allocated: ${formatMoney(payRes.data.allocatedAmount, d.invoice.currency)} | Remaining: ${formatMoney(payRes.data.outstandingAfter, d.invoice.currency)}`,
              'success'
            );
            if (payRes?.data?.paymentId) {
              await downloadProtectedFile(
                `/billing/payments/${payRes.data.paymentId}/receipt.pdf`,
                `receipt-${payRes.data.paymentId}.pdf`
              );
            }
            await loadView();
          } catch (error) {
            notify(error.message, 'error');
          }
        });

        directPayCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

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

async function renderOperationsView(host) {
  const [dashboardRes, inventoryRes, needsRes, procurementRes, fundingRes, staffRes, staffPaymentsRes] =
    await Promise.all([
      api('/operations/dashboard'),
      api('/operations/inventory/items?limit=300'),
      api('/operations/needs?status=all&limit=300'),
      api('/operations/procurement?status=all&limit=300'),
      api('/operations/funding/sources?limit=300'),
      api('/operations/staff/members?limit=300'),
      api('/operations/staff/payments?status=all&limit=300')
    ]);

  const dashboard = dashboardRes.data || {};
  const metrics = dashboard.metrics || {};
  const lowStock = Array.isArray(dashboard.lowStockItems) ? dashboard.lowStockItems : [];
  const inventory = Array.isArray(inventoryRes.data) ? inventoryRes.data : [];
  const needs = Array.isArray(needsRes.data) ? needsRes.data : [];
  const procurement = Array.isArray(procurementRes.data) ? procurementRes.data : [];
  const funding = Array.isArray(fundingRes.data) ? fundingRes.data : [];
  const staffMembers = Array.isArray(staffRes.data) ? staffRes.data : [];
  const staffPayments = Array.isArray(staffPaymentsRes.data) ? staffPaymentsRes.data : [];

  const inventoryOptions = inventory
    .map((item) => `<option value="${item.id}">${escapeHtml(`${item.itemCode} - ${item.name}`)}</option>`)
    .join('');
  const needsOptions = needs
    .filter((need) => ['open', 'approved', 'sourced', 'ordered'].includes(need.status))
    .map((need) => `<option value="${need.id}">${escapeHtml(`${need.needCode} - ${need.needName}`)}</option>`)
    .join('');
  const fundingOptions = funding
    .map((source) => `<option value="${source.id}">${escapeHtml(`${source.sourceCode} - ${source.name}`)}</option>`)
    .join('');
  const activeStaffMembers = staffMembers.filter((member) => member.isActive !== false);
  const currentPayrollPeriod =
    typeof state.operationsPayrollPeriod === 'string' && /^\d{4}-\d{2}$/.test(state.operationsPayrollPeriod)
      ? state.operationsPayrollPeriod
      : new Date().toISOString().slice(0, 7);
  const staffOptions = staffMembers
    .map(
      (member) =>
        `<option value="${member.id}" data-rate="${Number(member.rateAmount || 0)}">${escapeHtml(`${member.staffCode} - ${member.fullName}`)}</option>`
    )
    .join('');
  const lowStockRows = lowStock.length
    ? lowStock
        .map(
          (item) => `<tr>
      <td>${escapeHtml(`${item.itemCode} - ${item.name}`)}</td>
      <td>${item.stockOnHand}</td>
      <td>${item.minimumStockLevel}</td>
      <td>${item.targetStockLevel}</td>
      <td>${item.recommendedOrderQty}</td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="5">No low-stock alerts.</td></tr>';
  const inventoryRows = inventory.length
    ? inventory
        .map(
          (item) => `<tr>
      <td>${escapeHtml(item.itemCode)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${item.stockOnHand}</td>
      <td>${item.minimumStockLevel}</td>
      <td>${item.targetStockLevel}</td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="6">No inventory items.</td></tr>';
  const needsRows = needs.length
    ? needs
        .map(
          (need) => `<tr>
      <td>${escapeHtml(`${need.needCode} - ${need.needName}`)}</td>
      <td>${escapeHtml(need.priority)}</td>
      <td>${escapeHtml(need.statusLabel || need.status)}</td>
      <td>${escapeHtml(need.fundingStatusLabel || need.fundingStatus)}</td>
      <td>${need.quantityRemaining}</td>
      <td>${formatMoney(need.estimatedCost)}</td>
      <td class="mini-actions">
        <select data-need-stage="${need.id}">
          <option value="open" ${need.status === 'open' ? 'selected' : ''}>Open</option>
          <option value="approved" ${need.status === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="sourced" ${need.status === 'sourced' ? 'selected' : ''}>Sourced</option>
          <option value="ordered" ${need.status === 'ordered' ? 'selected' : ''}>Ordered</option>
          <option value="received" ${need.status === 'received' ? 'selected' : ''}>Received</option>
          <option value="closed" ${need.status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
        <button class="ghost" data-need-action="set" data-need-id="${need.id}">Update</button>
      </td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="7">No needs logged.</td></tr>';
  const procurementRows = procurement.length
    ? procurement
        .map(
          (pr) => `<tr>
      <td>${escapeHtml(pr.prNumber)}</td>
      <td>${escapeHtml(pr.title)}</td>
      <td>${escapeHtml(pr.status)}</td>
      <td>${escapeHtml(pr.supplierName || '-')}</td>
      <td>${escapeHtml((pr.needCodes || []).join(', ') || '-')}</td>
      <td>${formatMoney(pr.totalEstimatedAmount)}</td>
      <td class="mini-actions">
        <button class="ghost" data-proc-action="receive" data-proc-id="${pr.id}">Mark Delivered</button>
      </td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="7">No procurement requests.</td></tr>';
  const fundingRows = funding.length
    ? funding
        .map(
          (source) => `<tr>
      <td>${escapeHtml(`${source.sourceCode} - ${source.name}`)}</td>
      <td>${escapeHtml(source.sourceType)}</td>
      <td>${formatMoney(source.committedAmount, source.currency)}</td>
      <td>${formatMoney(source.receivedAmount, source.currency)}</td>
      <td>${formatMoney(source.balanceToReceive, source.currency)}</td>
      <td class="mini-actions">
        <button class="ghost" data-funding-action="receive" data-source-id="${source.id}">Record Receipt</button>
      </td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="6">No funding sources.</td></tr>';
  const periodPayments = staffPayments.filter((payment) => payment.periodMonth === currentPayrollPeriod);
  const paymentByStaffId = new Map(periodPayments.map((payment) => [payment.staffMemberId, payment]));
  const staffRegisterRows = activeStaffMembers.length
    ? activeStaffMembers
        .map(
          (member) => `<tr>
      <td>${escapeHtml(member.staffCode)}</td>
      <td>${escapeHtml(member.fullName)}</td>
      <td>${escapeHtml(member.roleTitle)}</td>
      <td>${escapeHtml(member.rateType)}</td>
      <td>${formatMoney(member.rateAmount)}</td>
      <td>${escapeHtml(member.paymentMethod || '-')}</td>
      <td><span class="status-pill ok">active</span></td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="7">No active staff members.</td></tr>';
  const payrollMatrixRows = activeStaffMembers.length
    ? activeStaffMembers
        .map((member) => {
          const entry = paymentByStaffId.get(member.id);
          const amountDue = entry ? entry.amountDue : Number(member.rateAmount || 0);
          const amountPaid = entry ? entry.amountPaid : 0;
          const outstanding = Math.max(amountDue - amountPaid, 0);
          const status = entry ? entry.status : 'not_created';
          const statusClass = status === 'paid' ? 'ok' : status === 'part_paid' ? 'warn' : 'danger';
          const statusText = status === 'not_created' ? 'not created' : status.replace('_', ' ');
          const actionHtml = entry
            ? `<button class="ghost" data-staffpay-action="slip" data-payment-id="${entry.id}">Slip PDF</button>
               <button class="ghost" data-staffpay-action="record" data-payment-id="${entry.id}">Record Payment</button>`
            : `<button class="ghost" data-staffpay-action="create" data-staff-id="${member.id}" data-due="${amountDue}">Create Entry</button>`;
          return `<tr>
      <td>${escapeHtml(member.staffCode)}</td>
      <td>${escapeHtml(member.fullName)}</td>
      <td>${escapeHtml(member.roleTitle)}</td>
      <td>${formatMoney(amountDue)}</td>
      <td>${formatMoney(amountPaid)}</td>
      <td>${formatMoney(outstanding)}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusText)}</span></td>
      <td class="mini-actions">${actionHtml}</td>
    </tr>`;
        })
        .join('')
    : '<tr><td colspan="8">No active staff members.</td></tr>';
  const stageCounts = {
    inventory: metrics.lowStockItems ?? 0,
    needs: metrics.openNeeds ?? 0,
    procurement: metrics.procurementPipeline ?? 0,
    funding: funding.length,
    payroll: activeStaffMembers.length
  };
  const availableStages = ['inventory', 'needs', 'procurement', 'funding', 'payroll'];
  const currentOpsStage = availableStages.includes(state.operationsStage) ? state.operationsStage : 'inventory';
  const stageButtons = [
    { key: 'inventory', label: '1. Inventory' },
    { key: 'needs', label: '2. Needs' },
    { key: 'procurement', label: '3. Procurement' },
    { key: 'funding', label: '4. Funding' },
    { key: 'payroll', label: '5. Payroll' }
  ]
    .map(
      (stage) => `<button class="ops-stage-btn ${currentOpsStage === stage.key ? 'active' : ''}" data-ops-stage="${stage.key}">
        <span>${stage.label}</span>
        <strong>${stageCounts[stage.key] ?? 0}</strong>
      </button>`
    )
    .join('');

  host.innerHTML = `
    <div class="cards four">
      <article class="card stat"><h3>${metrics.lowStockItems ?? 0}</h3><p>Low Stock Items</p></article>
      <article class="card stat"><h3>${metrics.openNeeds ?? 0}</h3><p>Open Needs</p></article>
      <article class="card stat"><h3>${metrics.procurementPipeline ?? 0}</h3><p>Procurement Pipeline</p></article>
      <article class="card stat"><h3>${formatMoney(metrics.salaryOutstanding ?? 0)}</h3><p>Salary Outstanding</p></article>
    </div>

    <article class="card">
      <h3>Operations Workflow</h3>
      <p class="ops-note">Work by stage to keep operations clean and avoid mixed forms.</p>
      <div class="ops-stage-nav">${stageButtons}</div>
    </article>

    <section class="ops-panel ${currentOpsStage === 'inventory' ? 'active' : ''}" data-ops-panel="inventory">
      <article class="card operations-readiness">
        <div class="section-head">
          <h3>Readiness & Reorder Signals</h3>
          <button id="autoNeedsBtn">Auto-Create Needs from Stock Gaps</button>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Stock</th><th>Minimum</th><th>Target</th><th>Recommended Order</th></tr></thead>
            <tbody>${lowStockRows}</tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <h3>Inventory Control</h3>
        <div class="operations-dual">
          <section class="operations-pane">
            <h4>Create Inventory Item</h4>
            <form id="createInventoryForm" class="stack">
              <label>Item Name<input name="name" required /></label>
              <label>Category
                <select name="category">
                  <option value="equipment">Equipment</option>
                  <option value="kits">Kits</option>
                  <option value="facilities">Facilities</option>
                  <option value="services">Services</option>
                  <option value="salaries">Salaries</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Unit<input name="unit" value="pcs" /></label>
              <label>Stock On Hand<input name="stockOnHand" type="number" min="0" step="0.01" value="0" /></label>
              <label>Minimum Stock<input name="minimumStockLevel" type="number" min="0" step="0.01" value="0" /></label>
              <label>Target Stock<input name="targetStockLevel" type="number" min="0" step="0.01" value="0" /></label>
              <label>Reorder Qty<input name="reorderQuantity" type="number" min="0" step="0.01" value="0" /></label>
              <button type="submit">Create Item</button>
            </form>
          </section>

          <section class="operations-pane">
            <h4>Record Stock Movement</h4>
            <form id="recordStockMovementForm" class="stack">
              <label>Inventory Item
                <select name="inventoryItemId" required>
                  ${inventoryOptions || '<option value="">No inventory items</option>'}
                </select>
              </label>
              <label>Movement Type
                <select name="movementType">
                  <option value="in">Stock In</option>
                  <option value="out">Stock Out</option>
                  <option value="adjustment">Adjustment (+)</option>
                  <option value="donation">Donation In</option>
                </select>
              </label>
              <label>Quantity<input name="quantity" type="number" min="0.01" step="0.01" required /></label>
              <label>Unit Cost (optional)<input name="unitCost" type="number" min="0" step="0.01" /></label>
              <label>Movement Date<input name="movementDate" type="date" /></label>
              <label>Reference Type<input name="referenceType" placeholder="procurement/donation/manual" /></label>
              <label>Reference ID<input name="referenceId" /></label>
              <label>Notes<input name="notes" /></label>
              <button type="submit">Record Movement</button>
            </form>
          </section>
        </div>

        <section class="operations-table-block">
          <div class="section-head">
            <h4>Inventory Register</h4>
            <small>${inventory.length} item(s)</small>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Stock</th><th>Min</th><th>Target</th></tr></thead>
              <tbody>${inventoryRows}</tbody>
            </table>
          </div>
        </section>
      </article>
    </section>

    <section class="ops-panel ${currentOpsStage === 'needs' ? 'active' : ''}" data-ops-panel="needs">
      <article class="card">
        <h3>Club Needs Register</h3>
        <p class="ops-note">Create and progress needs by stage so procurement can track accurately.</p>
        <div class="operations-dual">
          <section class="operations-pane">
            <h4>Create Need</h4>
            <form id="createNeedForm" class="stack">
              <label>Need Name<input name="needName" required /></label>
              <label>Category
                <select name="category">
                  <option value="equipment">Equipment</option>
                  <option value="kits">Kits</option>
                  <option value="facilities">Facilities</option>
                  <option value="services">Services</option>
                  <option value="salaries">Salaries</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Need Stage
                <select name="status">
                  <option value="open">Open</option>
                  <option value="approved">Approved</option>
                  <option value="sourced">Sourced</option>
                  <option value="ordered">Ordered</option>
                  <option value="received">Received</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label>Funding Stage
                <select name="fundingStatus">
                  <option value="unfunded">Unfunded</option>
                  <option value="partially_funded">Partially Funded</option>
                  <option value="fully_funded">Fully Funded</option>
                </select>
              </label>
              <label>Linked Inventory Item
                <select name="inventoryItemId">
                  <option value="">None</option>
                  ${inventoryOptions}
                </select>
              </label>
              <label>Quantity Needed<input name="quantityNeeded" type="number" min="0.01" step="0.01" value="1" required /></label>
              <label>Priority
                <select name="priority">
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium" selected>Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>Required By<input name="requiredBy" type="date" /></label>
              <label>Estimated Cost<input name="estimatedCost" type="number" min="0" step="0.01" value="0" /></label>
              <label>Owner<input name="ownerName" placeholder="Logistics / Admin" /></label>
              <label>Justification<input name="justification" /></label>
              <button type="submit">Add Need</button>
            </form>
          </section>

          <section class="operations-table-block">
            <div class="section-head">
              <h4>Needs Register</h4>
              <small>${needs.length} record(s)</small>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Need</th><th>Priority</th><th>Status</th><th>Funding</th><th>Qty Remaining</th><th>Estimate</th><th>Actions</th></tr></thead>
                <tbody>${needsRows}</tbody>
              </table>
            </div>
          </section>
        </div>
      </article>
    </section>

    <section class="ops-panel ${currentOpsStage === 'procurement' ? 'active' : ''}" data-ops-panel="procurement">
      <article class="card">
        <h3>Procurement Pipeline</h3>
        <p class="ops-note">Create requests and link one or more needs to move requests through the pipeline.</p>
        <div class="operations-dual">
          <section class="operations-pane">
            <h4>Create Procurement Request</h4>
            <form id="createProcurementForm" class="stack">
              <label>Title<input name="title" required /></label>
              <label>Supplier<input name="supplierName" /></label>
              <label>Estimated Total<input name="totalEstimatedAmount" type="number" min="0" step="0.01" value="0" /></label>
              <label>Expected Delivery<input name="expectedDeliveryDate" type="date" /></label>
              <label>Funding Source
                <select name="fundingSourceId">
                  <option value="">None</option>
                  ${fundingOptions}
                </select>
              </label>
              <label>Procurement Stage
                <select name="status">
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="ordered">Ordered</option>
                </select>
              </label>
              <label>Linked Needs (select one or more)
                <select name="needIds" multiple size="6">${needsOptions || '<option value="" disabled>No open needs</option>'}</select>
              </label>
              <button type="submit">Create Procurement Request</button>
            </form>
          </section>

          <section class="operations-table-block">
            <div class="section-head">
              <h4>Procurement Register</h4>
              <small>${procurement.length} request(s)</small>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>PR</th><th>Title</th><th>Status</th><th>Supplier</th><th>Need(s)</th><th>Total</th><th>Actions</th></tr></thead>
                <tbody>${procurementRows}</tbody>
              </table>
            </div>
          </section>
        </div>
      </article>
    </section>

    <section class="ops-panel ${currentOpsStage === 'funding' ? 'active' : ''}" data-ops-panel="funding">
      <article class="card">
        <h3>Funding Sources</h3>
        <p class="ops-note">Manage donor and sponsor commitments, then record incoming receipts.</p>
        <div class="operations-dual">
          <section class="operations-pane">
            <h4>Create Funding Source</h4>
            <form id="createFundingSourceForm" class="stack">
              <label>Source Name<input name="name" required /></label>
              <label>Type
                <select name="sourceType">
                  <option value="donor">Donor</option>
                  <option value="sponsor">Sponsor</option>
                  <option value="internal">Internal</option>
                  <option value="parent_contribution">Parent Contribution</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>Committed Amount<input name="committedAmount" type="number" min="0" step="0.01" value="0" /></label>
              <label>Received Amount<input name="receivedAmount" type="number" min="0" step="0.01" value="0" /></label>
              <label>Email<input name="email" type="email" /></label>
              <label>Phone<input name="phone" /></label>
              <button type="submit">Create Funding Source</button>
            </form>
          </section>

          <section class="operations-table-block">
            <div class="section-head">
              <h4>Funding Register</h4>
              <small>${funding.length} source(s)</small>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Source</th><th>Type</th><th>Committed</th><th>Received</th><th>Balance</th><th>Actions</th></tr></thead>
                <tbody>${fundingRows}</tbody>
              </table>
            </div>
          </section>
        </div>
      </article>
    </section>

    <section class="ops-panel ${currentOpsStage === 'payroll' ? 'active' : ''}" data-ops-panel="payroll">
      <article class="card">
        <h3>Staff & Payroll</h3>
        <p class="ops-note">Staff are registered once here, then payroll is tracked per month from the same staff list.</p>
        <div class="toolbar">
          <label class="inline-field">Payroll Period
            <input id="opsPayrollPeriod" type="month" value="${currentPayrollPeriod}" />
          </label>
          <button id="reloadPayrollPeriodBtn" class="ghost">Load Period</button>
        </div>
        <div class="operations-dual">
          <section class="operations-pane">
            <h4>Create Staff Member</h4>
            <form id="createStaffMemberForm" class="stack">
              <label>Staff Full Name<input name="fullName" required /></label>
              <label>Role<input name="roleTitle" required /></label>
              <label>Rate Type
                <select name="rateType">
                  <option value="monthly">Monthly</option>
                  <option value="session">Per Session</option>
                  <option value="hourly">Hourly</option>
                </select>
              </label>
              <label>Rate Amount<input name="rateAmount" type="number" min="0" step="0.01" value="0" /></label>
              <button type="submit">Create Staff Member</button>
            </form>
          </section>

          <section class="operations-pane">
            <h4>Create / Update Payroll Entry</h4>
            <form id="createStaffPaymentForm" class="stack">
              <label>Staff Member
                <select name="staffMemberId" required>
                  ${staffOptions || '<option value="">No staff members</option>'}
                </select>
              </label>
              <label>Period Month (YYYY-MM)<input name="periodMonth" value="${currentPayrollPeriod}" placeholder="2026-03" required /></label>
              <label>Amount Due<input name="amountDue" type="number" min="0.01" step="0.01" required /></label>
              <label>Amount Paid<input name="amountPaid" type="number" min="0" step="0.01" value="0" /></label>
              <label>Funding Source
                <select name="fundingSourceId">
                  <option value="">None</option>
                  ${fundingOptions}
                </select>
              </label>
              <button type="submit">Create / Update Payroll Entry</button>
            </form>
          </section>
        </div>

        <section class="operations-table-block">
          <div class="section-head">
            <h4>Staff Register</h4>
            <small>${activeStaffMembers.length} active staff</small>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Rate Type</th><th>Base Rate</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>${staffRegisterRows}</tbody>
            </table>
          </div>
        </section>

        <section class="operations-table-block">
          <div class="section-head">
            <h4>Payroll Tracker (${currentPayrollPeriod})</h4>
            <small>${periodPayments.length} existing payroll record(s)</small>
          </div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Code</th><th>Staff</th><th>Role</th><th>Due</th><th>Paid</th><th>Outstanding</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${payrollMatrixRows}</tbody>
            </table>
          </div>
        </section>
      </article>
    </section>
  `;

  const setOpsStage = (stageKey) => {
    if (!availableStages.includes(stageKey)) {
      return;
    }
    state.operationsStage = stageKey;
    host.querySelectorAll('[data-ops-stage]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-ops-stage') === stageKey);
    });
    host.querySelectorAll('[data-ops-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.getAttribute('data-ops-panel') === stageKey);
    });
  };

  host.querySelectorAll('[data-ops-stage]').forEach((button) => {
    button.addEventListener('click', () => {
      const stageKey = button.getAttribute('data-ops-stage');
      if (stageKey) {
        setOpsStage(stageKey);
      }
    });
  });

  setOpsStage(currentOpsStage);

  const payrollPeriodInput = host.querySelector('#opsPayrollPeriod');
  const reloadPayrollPeriodBtn = host.querySelector('#reloadPayrollPeriodBtn');
  const applyPayrollPeriod = async () => {
    if (!(payrollPeriodInput instanceof HTMLInputElement)) {
      return;
    }
    const periodValue = String(payrollPeriodInput.value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodValue)) {
      notify('Invalid payroll period. Use YYYY-MM.', 'error');
      return;
    }
    state.operationsPayrollPeriod = periodValue;
    state.operationsStage = 'payroll';
    await loadView();
  };
  reloadPayrollPeriodBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    await applyPayrollPeriod();
  });
  payrollPeriodInput?.addEventListener('change', async () => {
    await applyPayrollPeriod();
  });

  document.querySelector('#autoNeedsBtn')?.addEventListener('click', async () => {
    try {
      state.operationsStage = 'inventory';
      const res = await api('/operations/inventory/auto-needs', { method: 'POST', body: {} });
      notify(`Auto need generation complete. Created: ${res.data.created}, Skipped: ${res.data.skipped}`, 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#createInventoryForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    try {
      state.operationsStage = 'inventory';
      await api('/operations/inventory/items', {
        method: 'POST',
        body: {
          name: String(fd.get('name') || ''),
          category: String(fd.get('category') || 'equipment'),
          unit: String(fd.get('unit') || 'units'),
          stockOnHand: Number(fd.get('stockOnHand') || 0),
          minimumStockLevel: Number(fd.get('minimumStockLevel') || 0),
          targetStockLevel: Number(fd.get('targetStockLevel') || 0),
          reorderQuantity: Number(fd.get('reorderQuantity') || 0)
        }
      });
      notify('Inventory item created.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#recordStockMovementForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    try {
      state.operationsStage = 'inventory';
      const res = await api('/operations/inventory/movements', {
        method: 'POST',
        body: {
          inventoryItemId: String(fd.get('inventoryItemId') || ''),
          movementType: String(fd.get('movementType') || 'in'),
          quantity: Number(fd.get('quantity') || 0),
          unitCost: optionalNumber(fd, 'unitCost'),
          movementDate: optionalText(fd, 'movementDate'),
          referenceType: optionalText(fd, 'referenceType'),
          referenceId: optionalText(fd, 'referenceId'),
          notes: optionalText(fd, 'notes')
        }
      });
      notify(`Stock movement recorded. New stock: ${res.data.newStockOnHand}`, 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelector('#createNeedForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    try {
      state.operationsStage = 'needs';
      await api('/operations/needs', {
        method: 'POST',
        body: {
          needName: String(fd.get('needName') || ''),
          category: String(fd.get('category') || 'equipment'),
          status: String(fd.get('status') || 'open'),
          fundingStatus: String(fd.get('fundingStatus') || 'unfunded'),
          inventoryItemId: optionalText(fd, 'inventoryItemId'),
          quantityNeeded: Number(fd.get('quantityNeeded') || 1),
          priority: String(fd.get('priority') || 'medium'),
          requiredBy: optionalText(fd, 'requiredBy'),
          estimatedCost: Number(fd.get('estimatedCost') || 0),
          ownerName: optionalText(fd, 'ownerName'),
          justification: optionalText(fd, 'justification')
        }
      });
      notify('Need created.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelectorAll('[data-need-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const needId = button.dataset.needId;
      const action = button.dataset.needAction;
      if (!needId) return;
      let status = 'open';
      if (action === 'set') {
        const stageSelect = host.querySelector(`[data-need-stage="${needId}"]`);
        status = stageSelect instanceof HTMLSelectElement ? stageSelect.value : 'open';
      }
      try {
        state.operationsStage = 'needs';
        await api(`/operations/needs/${needId}`, {
          method: 'PATCH',
          body: { status }
        });
        notify(`Need moved to ${status}.`, 'success');
        await loadView();
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });

  document.querySelector('#createProcurementForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const selectedNeeds = Array.from(form.querySelectorAll('select[name="needIds"] option:checked')).map(
      (option) => option.value
    );
    try {
      state.operationsStage = 'procurement';
      await api('/operations/procurement', {
        method: 'POST',
        body: {
          title: String(fd.get('title') || ''),
          supplierName: optionalText(fd, 'supplierName'),
          totalEstimatedAmount: Number(fd.get('totalEstimatedAmount') || 0),
          expectedDeliveryDate: optionalText(fd, 'expectedDeliveryDate'),
          fundingSourceId: optionalText(fd, 'fundingSourceId'),
          status: String(fd.get('status') || 'draft'),
          needIds: selectedNeeds
        }
      });
      notify('Procurement request created.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelectorAll('[data-proc-action="receive"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const requestId = button.dataset.procId;
      if (!requestId) return;
      try {
        state.operationsStage = 'procurement';
        const res = await api(`/operations/procurement/${requestId}/receive`, {
          method: 'POST',
          body: {}
        });
        notify(
          `Procurement received. Stock updates: ${res.data.stockMovements}, Needs closed: ${res.data.needsClosed}`,
          'success'
        );
        await loadView();
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });

  document.querySelector('#createFundingSourceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    try {
      state.operationsStage = 'funding';
      await api('/operations/funding/sources', {
        method: 'POST',
        body: {
          name: String(fd.get('name') || ''),
          sourceType: String(fd.get('sourceType') || 'donor'),
          committedAmount: Number(fd.get('committedAmount') || 0),
          receivedAmount: Number(fd.get('receivedAmount') || 0),
          email: optionalText(fd, 'email'),
          phone: optionalText(fd, 'phone')
        }
      });
      notify('Funding source created.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelectorAll('[data-funding-action="receive"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const sourceId = button.dataset.sourceId;
      if (!sourceId) return;
      const amountInput = window.prompt('Amount received');
      const amount = Number(amountInput);
      if (!Number.isFinite(amount) || amount <= 0) {
        notify('Invalid amount.', 'error');
        return;
      }
      const receivedOnInput = window.prompt('Receipt date (YYYY-MM-DD, optional)', new Date().toISOString().slice(0, 10));
      const reference = String(window.prompt('Reference / transaction ID (optional)') || '').trim();
      const proofUrl = String(window.prompt('Proof URL (optional)') || '').trim();
      const notes = String(window.prompt('Notes (optional)') || '').trim();
      try {
        state.operationsStage = 'funding';
        const res = await api(`/operations/funding/sources/${sourceId}/receive`, {
          method: 'POST',
          body: {
            amount,
            receivedOn: receivedOnInput && receivedOnInput.trim() ? receivedOnInput.trim() : undefined,
            reference: reference || undefined,
            proofUrl: proofUrl || undefined,
            notes: notes || undefined
          }
        });
        notify(`Funding receipt recorded (${res?.data?.receiptId || 'receipt'}).`, 'success');
        await loadView();
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });

  document.querySelector('#createStaffMemberForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    try {
      state.operationsStage = 'payroll';
      await api('/operations/staff/members', {
        method: 'POST',
        body: {
          fullName: String(fd.get('fullName') || ''),
          roleTitle: String(fd.get('roleTitle') || ''),
          rateType: String(fd.get('rateType') || 'monthly'),
          rateAmount: Number(fd.get('rateAmount') || 0)
        }
      });
      notify('Staff member created.', 'success');
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  const createPayrollForm = host.querySelector('#createStaffPaymentForm');
  const payrollStaffSelect = createPayrollForm?.querySelector('select[name="staffMemberId"]');
  const payrollDueInput = createPayrollForm?.querySelector('input[name="amountDue"]');
  const syncPayrollDueFromStaff = () => {
    if (!(payrollStaffSelect instanceof HTMLSelectElement) || !(payrollDueInput instanceof HTMLInputElement)) {
      return;
    }
    const selectedOption = payrollStaffSelect.selectedOptions[0];
    const suggestedRate = Number(selectedOption?.getAttribute('data-rate') || 0);
    const currentDue = Number(payrollDueInput.value || 0);
    if (!Number.isFinite(suggestedRate) || suggestedRate <= 0) {
      return;
    }
    if (!currentDue || currentDue <= 0) {
      payrollDueInput.value = suggestedRate.toFixed(2);
    }
  };
  payrollStaffSelect?.addEventListener('change', syncPayrollDueFromStaff);
  syncPayrollDueFromStaff();

  document.querySelector('#createStaffPaymentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const periodMonth = String(fd.get('periodMonth') || '');
    const amountPaid = Number(fd.get('amountPaid') || 0);
    try {
      state.operationsStage = 'payroll';
      if (/^\d{4}-\d{2}$/.test(periodMonth)) {
        state.operationsPayrollPeriod = periodMonth;
      }
      const res = await api('/operations/staff/payments', {
        method: 'POST',
        body: {
          staffMemberId: String(fd.get('staffMemberId') || ''),
          periodMonth,
          amountDue: Number(fd.get('amountDue') || 0),
          amountPaid,
          fundingSourceId: optionalText(fd, 'fundingSourceId')
        }
      });
      if (amountPaid > 0 && res?.data?.id) {
        await downloadProtectedFile(
          `/operations/staff/payments/${res.data.id}/slip.pdf`,
          `salary-slip-${res.data.id}.pdf`
        );
        notify('Payroll entry saved and salary slip downloaded.', 'success');
      } else {
        notify('Payroll entry saved.', 'success');
      }
      await loadView();
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  document.querySelectorAll('[data-staffpay-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.staffpayAction;
      try {
        state.operationsStage = 'payroll';
        if (action === 'create') {
          const staffId = button.dataset.staffId;
          if (!staffId) return;
          const dueDefault = Number(button.dataset.due || 0);
          const dueInput = window.prompt('Amount due', dueDefault > 0 ? dueDefault.toFixed(2) : '');
          const amountDue = Number(dueInput);
          if (!Number.isFinite(amountDue) || amountDue <= 0) {
            notify('Invalid due amount.', 'error');
            return;
          }
          await api('/operations/staff/payments', {
            method: 'POST',
            body: {
              staffMemberId: staffId,
              periodMonth: currentPayrollPeriod,
              amountDue,
              amountPaid: 0
            }
          });
          state.operationsPayrollPeriod = currentPayrollPeriod;
          notify('Payroll entry created.', 'success');
        } else if (action === 'slip') {
          const paymentId = button.dataset.paymentId;
          if (!paymentId) return;
          await downloadProtectedFile(
            `/operations/staff/payments/${paymentId}/slip.pdf`,
            `salary-slip-${paymentId}.pdf`
          );
          notify('Salary slip downloaded.', 'success');
        } else {
          const paymentId = button.dataset.paymentId;
          if (!paymentId) return;
          const amountInput = window.prompt('Payment amount');
          const amount = Number(amountInput);
          if (!Number.isFinite(amount) || amount <= 0) {
            notify('Invalid amount.', 'error');
            return;
          }
          const res = await api(`/operations/staff/payments/${paymentId}/record`, {
            method: 'POST',
            body: { amount }
          });
          const resolvedPaymentId = res?.data?.paymentId || paymentId;
          await downloadProtectedFile(
            `/operations/staff/payments/${resolvedPaymentId}/slip.pdf`,
            `salary-slip-${resolvedPaymentId}.pdf`
          );
          notify('Staff payment recorded and salary slip downloaded.', 'success');
        }
        await loadView();
      } catch (error) {
        notify(error.message, 'error');
      }
    });
  });
}

async function renderReportsView(host) {
  const fromDate = state.reportsFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const toDate = state.reportsTo || new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({ from: fromDate, to: toDate, limit: '500' });
  const reportRes = await api(`/reports/finance/transparency?${params.toString()}`);

  const report = reportRes?.data || {};
  const period = report.period || {};
  const overview = report.overview || {};
  const proof = report.proof || {};
  const incomeRows = Array.isArray(report.incomeBreakdown) ? report.incomeBreakdown : [];
  const coachingRows = report.expenditureBreakdown?.coachingAndStaff?.rows || [];
  const equipmentRows = report.expenditureBreakdown?.trainingEquipment?.rows || [];
  const otherExpenseRows = [
    ...(report.expenditureBreakdown?.administration?.rows || []),
    ...(report.expenditureBreakdown?.facilitiesAndTransport?.rows || []),
    ...(report.expenditureBreakdown?.other?.rows || [])
  ];
  const coachingSubtotal = Number(report.expenditureBreakdown?.coachingAndStaff?.total || 0);
  const equipmentSubtotal = Number(report.expenditureBreakdown?.trainingEquipment?.total || 0);
  const otherSubtotal = Number(
    Number(report.expenditureBreakdown?.administration?.total || 0) +
      Number(report.expenditureBreakdown?.facilitiesAndTransport?.total || 0) +
      Number(report.expenditureBreakdown?.other?.total || 0)
  );
  const budgetRows = Array.isArray(report.budgetAllocation) ? report.budgetAllocation : [];
  const accountabilityRows = Array.isArray(report.accountability) ? report.accountability : [];
  const maxBudget = Math.max(...budgetRows.map((row) => Number(row.amount || 0)), 1);
  const totalIncome = Number(overview.totalIncome || 0);
  const formatPeriodMonth = (value) => {
    const dt = new Date(`${String(value)}-01`);
    if (Number.isNaN(dt.getTime())) {
      return String(value || '-');
    }
    return dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };
  const inferStaffName = (description) => {
    const text = String(description || '').trim();
    if (!text) return '-';
    const salarySplit = text.split(' salary for ');
    if (salarySplit.length > 1) return salarySplit[0];
    return text;
  };
  const inferItemName = (description) => {
    const text = String(description || '').trim();
    const colonIndex = text.indexOf(':');
    if (colonIndex > -1) {
      return text.slice(colonIndex + 1).trim();
    }
    return text || '-';
  };
  const coverageClass = (value) => (value >= 80 ? 'ok' : value >= 50 ? 'warn' : 'danger');

  host.innerHTML = `
    <article class="card">
      <h3>Dynaverse Football Academy - Financial Transparency Report</h3>
      <p class="ops-note">Professional, parent-friendly, and audit-ready financial transparency statement.</p>
      <form id="reportFilterForm" class="toolbar">
        <label class="inline-field">From
          <input type="date" name="from" value="${fromDate}" required />
        </label>
        <label class="inline-field">To
          <input type="date" name="to" value="${toDate}" required />
        </label>
        <button type="submit">Load Report</button>
        <button type="button" id="downloadReportPdfBtn" class="ghost">Download PDF</button>
        <button type="button" id="downloadReportCsvBtn" class="ghost">Download CSV</button>
      </form>
      <small>Reporting period: <strong>${escapeHtml(period.from || fromDate)}</strong> to <strong>${escapeHtml(period.to || toDate)}</strong> (${period.days || 0} day(s))</small>
    </article>

    <article class="card">
      <h3>1) Financial Overview (Executive Summary)</h3>
      <div class="cards two">
        <article class="card">
          <h4>Funds In</h4>
          <table>
            <tbody>
              <tr><th>Opening Balance</th><td>${formatMoney(overview.openingBalance || 0)}</td></tr>
              <tr><th>Player Fees Collected</th><td>${formatMoney(overview.playerFeesCollected || 0)}</td></tr>
              <tr><th>Donations Received</th><td>${formatMoney(overview.donationsReceived || 0)}</td></tr>
              <tr><th>Other Income</th><td>${formatMoney(overview.otherIncome || 0)}</td></tr>
              <tr><th>Total Funds Available</th><td><strong>${formatMoney(overview.totalFundsAvailable || 0)}</strong></td></tr>
            </tbody>
          </table>
        </article>
        <article class="card">
          <h4>Funds Out</h4>
          <table>
            <tbody>
              <tr><th>Coaching Salaries</th><td>${formatMoney(overview.coachingSalaries || 0)}</td></tr>
              <tr><th>Training Equipment</th><td>${formatMoney(overview.trainingEquipment || 0)}</td></tr>
              <tr><th>Administration</th><td>${formatMoney(overview.administration || 0)}</td></tr>
              <tr><th>Facilities & Transport</th><td>${formatMoney(overview.facilitiesAndTransport || 0)}</td></tr>
              <tr><th>Other Expenditure</th><td>${formatMoney(overview.otherExpenditure || 0)}</td></tr>
              <tr><th>Total Expenditure</th><td><strong>${formatMoney(overview.totalExpenditure || 0)}</strong></td></tr>
            </tbody>
          </table>
        </article>
      </div>
      <p><strong>Closing Balance:</strong> ${formatMoney(overview.closingBalance || 0)}</p>
      <p><strong>Explanation:</strong> ${escapeHtml(overview.explanation || '-')}</p>
    </article>

    <article class="card">
      <h3>2) Income Breakdown</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Amount</th></tr></thead>
          <tbody>
            ${
              incomeRows.length
                ? incomeRows
                    .map(
                      (row) => `<tr>
                  <td>${formatDate(row.date)}</td>
                  <td>${escapeHtml(row.source)}</td>
                  <td>${escapeHtml(row.description)}</td>
                  <td>${formatMoney(row.amount, row.currency)}</td>
                </tr>`
                    )
                    .join('')
                : '<tr><td colspan="4">No income entries found for this period.</td></tr>'
            }
          </tbody>
        </table>
      </div>
      <p><strong>Total Income:</strong> ${formatMoney(totalIncome)}</p>
    </article>

    <article class="card">
      <h3>3) Expenditure Breakdown</h3>
      <div class="cards two">
        <article class="card">
          <h4>Coaching & Staff</h4>
          <table>
            <thead><tr><th>Staff</th><th>Month</th><th>Amount</th></tr></thead>
            <tbody>
              ${
                coachingRows.length
                  ? coachingRows
                      .map(
                        (row) => `<tr>
                    <td>${escapeHtml(inferStaffName(row.description))}</td>
                    <td>${escapeHtml(formatPeriodMonth(String(row.date).slice(0, 7)))}</td>
                    <td>${formatMoney(row.amount, row.currency)}</td>
                  </tr>`
                      )
                      .join('')
                  : '<tr><td colspan="3">No coaching/staff expenditure in this period.</td></tr>'
              }
            </tbody>
          </table>
          <p><strong>Subtotal:</strong> ${formatMoney(coachingSubtotal)}</p>
        </article>
        <article class="card">
          <h4>Equipment Procurement</h4>
          <table>
            <thead><tr><th>Item</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              ${
                equipmentRows.length
                  ? equipmentRows
                      .map(
                        (row) => `<tr>
                    <td>${escapeHtml(inferItemName(row.description))}</td>
                    <td>${escapeHtml(row.description)}</td>
                    <td>${formatMoney(row.amount, row.currency)}</td>
                  </tr>`
                      )
                      .join('')
                  : '<tr><td colspan="3">No equipment expenditure in this period.</td></tr>'
              }
            </tbody>
          </table>
          <p><strong>Subtotal:</strong> ${formatMoney(equipmentSubtotal)}</p>
        </article>
      </div>
      ${
        otherExpenseRows.length
          ? `<article class="card">
              <h4>Other Operational Expenditure</h4>
              <table>
                <thead><tr><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
                <tbody>
                  ${otherExpenseRows
                    .map(
                      (row) => `<tr>
                    <td>${escapeHtml((row.category || '').replaceAll('_', ' '))}</td>
                    <td>${escapeHtml(row.description)}</td>
                    <td>${formatMoney(row.amount, row.currency)}</td>
                  </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
              <p><strong>Subtotal:</strong> ${formatMoney(otherSubtotal)}</p>
            </article>`
          : ''
      }
    </article>

    <article class="card">
      <h3>4) Budget Allocation View</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Category</th><th>Amount</th><th>Percentage</th><th>Allocation</th></tr></thead>
          <tbody>
            ${
              budgetRows.length
                ? budgetRows
                    .map(
                      (row) => `<tr>
                  <td>${escapeHtml(row.category)}</td>
                  <td>${formatMoney(row.amount)}</td>
                  <td>${Number(row.percentage || 0).toFixed(1)}%</td>
                  <td><div class="report-bar-track compact"><div class="report-bar-fill allocation" style="width:${((Number(row.amount || 0) / maxBudget) * 100).toFixed(1)}%"></div></div></td>
                </tr>`
                    )
                    .join('')
                : '<tr><td colspan="4">No budget allocation data available.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </article>

    <article class="card">
      <h3>5) Accountability / Proof Section</h3>
      <div class="cards three">
        <article class="card">
          <p><strong>Funding receipts:</strong> ${proof.fundingReceiptsWithProof || 0}/${proof.fundingReceiptsCount || 0}</p>
          <p><span class="status-pill ${coverageClass(Number(proof.fundingProofCoverage || 0))}">${Number(proof.fundingProofCoverage || 0).toFixed(1)}% verified</span></p>
        </article>
        <article class="card">
          <p><strong>Payroll entries:</strong> ${proof.payrollEntriesWithProof || 0}/${proof.payrollEntriesCount || 0}</p>
          <p><span class="status-pill ${coverageClass(Number(proof.payrollProofCoverage || 0))}">${Number(proof.payrollProofCoverage || 0).toFixed(1)}% verified</span></p>
        </article>
        <article class="card">
          <p><strong>Expense rows:</strong> ${proof.expenseEntriesWithProof || 0}/${proof.expenseEntriesCount || 0}</p>
          <p><span class="status-pill ${coverageClass(Number(proof.expenseProofCoverage || 0))}">${Number(proof.expenseProofCoverage || 0).toFixed(1)}% verified</span></p>
        </article>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Transaction</th><th>Proof</th><th>Status</th></tr></thead>
          <tbody>
            ${
              accountabilityRows.length
                ? accountabilityRows
                    .map(
                      (row) => `<tr>
                  <td>${escapeHtml(row.transaction)}</td>
                  <td>${escapeHtml(row.proof || '-')}</td>
                  <td><span class="status-pill ${row.status === 'verified' ? 'ok' : 'warn'}">${escapeHtml(row.status)}</span></td>
                </tr>`
                    )
                    .join('')
                : '<tr><td colspan="3">No accountability entries available.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </article>

    <article class="card">
      <h3>6) Closing Statement</h3>
      <p>${escapeHtml(report.closingStatement || 'This report was generated by the Dynaverse Football Academy MIS to ensure financial transparency in the management of academy funds.')}</p>
    </article>
  `;

  host.querySelector('#reportFilterForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const fd = new FormData(form);
    const from = String(fd.get('from') || '').trim();
    const to = String(fd.get('to') || '').trim();
    if (!from || !to) {
      notify('Both from and to dates are required.', 'error');
      return;
    }
    if (from > to) {
      notify('From date must be before or equal to To date.', 'error');
      return;
    }
    state.reportsFrom = from;
    state.reportsTo = to;
    await loadView();
  });

  host.querySelector('#downloadReportCsvBtn')?.addEventListener('click', async () => {
    try {
      const csvParams = new URLSearchParams({
        from: state.reportsFrom || fromDate,
        to: state.reportsTo || toDate,
        limit: '1000'
      });
      await downloadProtectedFile(
        `/reports/finance/transparency.csv?${csvParams.toString()}`,
        `finance-transparency-${state.reportsFrom || fromDate}-to-${state.reportsTo || toDate}.csv`
      );
      notify('Financial transparency report downloaded.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  });

  host.querySelector('#downloadReportPdfBtn')?.addEventListener('click', async () => {
    try {
      const pdfParams = new URLSearchParams({
        from: state.reportsFrom || fromDate,
        to: state.reportsTo || toDate,
        limit: '1000'
      });
      await downloadProtectedFile(
        `/reports/finance/transparency.pdf?${pdfParams.toString()}`,
        `finance-transparency-${state.reportsFrom || fromDate}-to-${state.reportsTo || toDate}.pdf`
      );
      notify('Financial transparency PDF downloaded.', 'success');
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
