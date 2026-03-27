/* Control Petro - Frontend Application */

const API = '';
const FUEL_LABELS = { magna: 'Magna', premium: 'Premium', diesel: 'Diesel' };
const FUEL_COLORS = { magna: '#22c55e', premium: '#ef4444', diesel: '#eab308' };
let charts = {};
let currentPage = 'dashboard';
let _selectedRazonId = '';  // '' = all razones
let _razonesList = [];
let _reportFormat = 'sat';
// ---------------------------------------------------------------
//  Theme Toggle (Dark / Light)
// ----------------------------------------------------------------
const SUN_ICON = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
const MOON_ICON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';

function updateThemeIcon() {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  icon.innerHTML = isLight ? MOON_ICON : SUN_ICON;
}

function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('cp-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('cp-theme', 'light');
  }
  updateThemeIcon();
  // Re-render charts with updated colors if on dashboard/inventario
  if (currentPage === 'dashboard' || currentPage === 'inventario') {
    destroyCharts();
    loadPage(currentPage);
  }
}

// Helper: get current chart label color based on theme
function chartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--g400').trim() || '#94a3b8';
}

// Init icon on page load
document.addEventListener('DOMContentLoaded', function() {
  // Initialize theme: default to light
  const saved = localStorage.getItem('cp-theme');
  if (saved === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    if (!saved) {
      localStorage.setItem('cp-theme', 'light');
      // First-time user: show dark mode tip
      setTimeout(function() {
        const tip = document.createElement('div');
        tip.id = 'darkModeTip';
        tip.innerHTML = '<div style="position:fixed;top:20px;right:20px;z-index:9999;background:#1e293b;color:#fff;padding:16px 24px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);max-width:300px;font-size:14px;line-height:1.5;animation:fadeInTip .4s ease">' +
          '<div style="font-weight:600;margin-bottom:6px">Modo oscuro disponible</div>' +
          '<div>Puedes cambiar al modo oscuro en cualquier momento usando el icono <span style="display:inline-block;vertical-align:middle;margin:0 2px">' + MOON_ICON.replace(/12/g,'14') + '</span> en la barra superior.</div>' +
          '<button onclick="document.getElementById(\'darkModeTip\').remove()" style="margin-top:10px;background:#22c55e;color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px">Entendido</button>' +
          '</div>';
        document.body.appendChild(tip);
        // Auto-dismiss after 8 seconds
        setTimeout(function() { var el = document.getElementById('darkModeTip'); if (el) el.remove(); }, 8000);
      }, 1500);
    }
  }
  updateThemeIcon();
});

// Add fadeIn animation for tip
if (!document.getElementById('tipStyle')) {
  const s = document.createElement('style');
  s.id = 'tipStyle';
  s.textContent = '@keyframes fadeInTip{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(s);
}

// ----------------------------------------------------------------
//  Navigation
// ----------------------------------------------------------------
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const titles = {
    dashboard: 'Dashboard',
    reportes: 'Reportes SAT / CNE',
    inventario: 'Control de Inventario',
    prediccion: 'Prediccion IA',
    registrar: 'Registrar Movimiento',
    estaciones: 'Estaciones',
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  document.getElementById('sidebar').classList.remove('open');
  destroyCharts();
  loadPage(page);
}

function destroyCharts() {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {};
}

// ----------------------------------------------------------------
//  API helpers
// ----------------------------------------------------------------
// Auto-fetch service token from server
let _serviceToken = localStorage.getItem('cp-auth-token') || '';

async function fetchServiceToken() {
  // Skip service token if user has their own JWT
  try { if (localStorage.getItem('cp_token')) return; } catch(e) {}
  try {
    const r = await fetch('/api/demo-config');
    if (r.ok) {
      const data = await r.json();
      if (data.token) {
        _serviceToken = data.token;
        localStorage.setItem('cp-auth-token', data.token);
      }
    }
  } catch(e) { console.warn('Could not fetch service config'); }
}

// Fetch token on page load
fetchServiceToken();

function getApiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  // Prefer user JWT over service token for org-scoped access
  let tk = null;
  try { tk = localStorage.getItem('cp_token'); } catch(e) {}
  if (tk) {
    h['Authorization'] = 'Bearer ' + tk;
  } else if (_serviceToken) {
    h['Authorization'] = 'Bearer ' + _serviceToken;
  }
  return h;
}

async function api(path) {
  const r = await fetch(API + path, { headers: getApiHeaders() });
  if (!r.ok) throw new Error('API error: ' + r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST', headers: getApiHeaders(),
    body: JSON.stringify(body),
  });
  return r.json();
}

// Razon Social filter helpers
function razonParam(sep = '?') { return _selectedRazonId ? sep + 'razon_id=' + _selectedRazonId : ''; }
function razonAmp() { return _selectedRazonId ? '&razon_id=' + _selectedRazonId : ''; }

async function loadRazones() {
  try {
    _razonesList = await api('/api/razones-sociales');
    const sel = document.getElementById('razonSelect');
    const container = document.getElementById('razonSelector');
    if (sel && _razonesList.length > 1) {
      sel.innerHTML = '<option value="">Todas las Razones</option>' +
        _razonesList.map(r => '<option value="' + r.id + '"' + (r.id == _selectedRazonId ? ' selected' : '') + '>' + r.name + ' (' + r.station_count + ')</option>').join('');
      container.style.display = 'block';
    }
    updateSidebarUser();
  } catch(e) { console.warn('Could not load razones:', e); }
}

function updateSidebarUser() {
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  const avatarEl = document.getElementById('userAvatar');
  if (!nameEl) return;
  const totalStations = _razonesList.reduce((sum, r) => sum + r.station_count, 0);
  // Use actual user info from localStorage if available
  let userData = null;
  try { const raw = localStorage.getItem('cp_user'); if (raw) userData = JSON.parse(raw); } catch(e) {}
  const displayName = userData ? userData.name : 'Demo GazPro';
  nameEl.textContent = displayName;
  const nameParts = displayName.split(' ');
  avatarEl.textContent = nameParts.length > 1 ? (nameParts[0][0] + nameParts[1][0]).toUpperCase() : nameParts[0].substring(0,2).toUpperCase();
  if (_selectedRazonId) {
    const r = _razonesList.find(r => r.id == _selectedRazonId);
    roleEl.textContent = r ? r.name + ' (' + r.station_count + ' est.)' : totalStations + ' estaciones activas';
  } else {
    roleEl.textContent = totalStations + ' estaciones activas';
  }
}

function onRazonChange(val) {
  _selectedRazonId = val;
  updateSidebarUser();
  destroyCharts();
  loadPage(currentPage);
}

// ----------------------------------------------------------------
//  Razones Sociales Management Modal
// ----------------------------------------------------------------
async function openRazonManager() {
  openModal('<div class="loading"><div class="spinner"></div><p>Cargando...</p></div>');
  try {
    const data = await api('/api/razones-sociales/detail');
    renderRazonManager(data);
  } catch(e) { openModal('<p style="color:var(--red)">Error: ' + e.message + '</p>'); }
}

function renderRazonManager(data) {
  const { razones, all_stations } = data;
  let html = '<div style="max-width:600px;margin:0 auto">';
  html += '<h2 style="margin:0 0 1rem;font-size:1.1rem;color:var(--w)">Administrar Razones Sociales</h2>';
  html += '<div style="display:flex;gap:8px;margin-bottom:1.2rem">';
  html += '<input id="newRazonName" placeholder="Nombre nueva Razon Social" style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid var(--g600);background:var(--navy2);color:var(--w);font-size:.8rem;font-family:Inter,sans-serif">';
  html += '<input id="newRazonRfc" placeholder="RFC (opcional)" style="width:140px;padding:8px 10px;border-radius:6px;border:1px solid var(--g600);background:var(--navy2);color:var(--w);font-size:.8rem;font-family:Inter,sans-serif">';
  html += '<button onclick="addRazon()" style="padding:8px 16px;border-radius:6px;border:none;background:var(--green);color:#fff;font-size:.8rem;cursor:pointer;white-space:nowrap;font-weight:600">+ Agregar</button>';
  html += '</div>';
  if (!razones.length) html += '<p style="color:var(--g500);font-size:.85rem">No hay razones sociales.</p>';
  razones.forEach(r => {
    const checks = all_stations.map(s => {
      const chk = r.station_ids.includes(s.id) ? ' checked' : '';
      const dim = s.razon_social_id && s.razon_social_id !== r.id ? ' style="opacity:.5"' : '';
      return '<label' + dim + '><input type="checkbox" data-razon="' + r.id + '" data-station="' + s.id + '"' + chk + '> ' + s.name + '</label>';
    }).join('');
    html += '<div style="background:var(--navy2);border-radius:8px;padding:1rem;margin-bottom:.8rem;border:1px solid var(--g600)">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">';
    html += '<div><strong style="color:var(--w);font-size:.9rem">' + r.name + '</strong> <span style="color:var(--g500);font-size:.7rem">RFC: ' + (r.rfc||'--') + '</span></div>';
    html += '<div style="display:flex;gap:6px">';
    html += '<button onclick="renameRazon(' + r.id + ',\'' + r.name.replace(/'/g,"\\'") + '\')" style="padding:4px 10px;border-radius:4px;border:1px solid var(--g600);background:transparent;color:var(--g400);font-size:.7rem;cursor:pointer">Renombrar</button>';
    html += '<button onclick="deleteRazon(' + r.id + ',\'' + r.name.replace(/'/g,"\\'") + '\')" style="padding:4px 10px;border-radius:4px;border:none;background:var(--red);color:#fff;font-size:.7rem;cursor:pointer">Eliminar</button>';
    html += '</div></div>';
    html += '<div style="font-size:.7rem;color:var(--g500);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Estaciones asignadas:</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:.8rem;color:var(--g300)">' + checks + '</div>';
    html += '<button onclick="saveRazonStations(' + r.id + ')" style="margin-top:8px;padding:5px 14px;border-radius:5px;border:none;background:var(--teal);color:#fff;font-size:.75rem;cursor:pointer;font-weight:500">Guardar estaciones</button>';
    html += '</div>';
  });
  const unassigned = all_stations.filter(s => !s.razon_social_id);
  if (unassigned.length) {
    html += '<div style="margin-top:.8rem;padding:.8rem;border-radius:8px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2)">';
    html += '<div style="font-size:.75rem;color:var(--orange);font-weight:600;margin-bottom:4px">Estaciones sin asignar:</div>';
    html += '<div style="font-size:.8rem;color:var(--g400)">' + unassigned.map(s => s.name).join(', ') + '</div></div>';
  }
  html += '</div>';
  openModal(html);
}

async function addRazon() {
  const name = document.getElementById('newRazonName').value.trim();
  const rfc = document.getElementById('newRazonRfc').value.trim();
  if (!name) return alert('Ingresa un nombre');
  await fetch('/api/razones-sociales', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,rfc})});
  await loadRazones(); openRazonManager();
}

async function renameRazon(id, cur) {
  const n = prompt('Nuevo nombre para "' + cur + '":', cur);
  if (!n || n === cur) return;
  await fetch('/api/razones-sociales/' + id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:n})});
  await loadRazones(); openRazonManager();
}

async function deleteRazon(id, name) {
  if (!confirm('Eliminar "' + name + '"?')) return;
  await fetch('/api/razones-sociales/' + id, {method:'DELETE'});
  _selectedRazonId = ''; await loadRazones(); openRazonManager(); destroyCharts(); loadPage(currentPage);
}

async function saveRazonStations(rid) {
  const ids = Array.from(document.querySelectorAll('input[data-razon="' + rid + '"]')).filter(c=>c.checked).map(c=>+c.dataset.station);
  await fetch('/api/razones-sociales/' + rid + '/stations', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({station_ids:ids})});
  await loadRazones(); openRazonManager(); destroyCharts(); loadPage(currentPage);
}

function fmt(n) { return n != null ? Math.round(n).toLocaleString('es-MX') : '0'; }
function pct(n) { return n != null ? n.toFixed(1) + '%' : '0%'; }

function tankBar(val) {
  const color = val > 40 ? 'var(--green)' : val > 25 ? 'var(--orange)' : 'var(--red)';
  return `<div class="tank-bar"><div class="tank-bg"><div class="tank-fill" style="width:${Math.min(val,100)}%;background:${color}"></div></div><span class="tank-pct" style="color:${color}">${val.toFixed(0)}%</span></div>`;
}
function badge(text, type) { return `<span class="badge ${type}">${text}</span>`; }

function showContent(html) {
  document.getElementById('content').innerHTML = `<div class="fade-in">${html}</div>`;
}

// ----------------------------------------------------------------
//  Modal
// ----------------------------------------------------------------
function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}
function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal').classList.remove('open');
}

// ----------------------------------------------------------------
//  DASHBOARD
// ----------------------------------------------------------------
async function loadDashboard() {
  showContent('<div class="loading"><div class="spinner"></div><p>Cargando dashboard...</p></div>');
  try {
    const [dash, salesData, alerts, stations] = await Promise.all([
      api('/api/dashboard' + razonParam()),
      api('/api/dashboard/sales-chart?days=7' + razonAmp()),
      api('/api/alerts' + razonParam()),
      api('/api/stations' + razonParam()),
    ]);

    const changeCls = dash.change_pct >= 0 ? 'up' : 'down';
    const changeIcon = dash.change_pct >= 0 ? '+' : '';

    let html = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon teal">L</div><span class="kpi-change ${changeCls}">${changeIcon}${dash.change_pct}%</span></div>
        <div class="kpi-value">${fmt(dash.total_sold_today)}</div>
        <div class="kpi-label">Litros vendidos hoy</div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon green">R</div><span class="kpi-change up">100%</span></div>
        <div class="kpi-value" style="color:var(--green)">${dash.active_stations}/${dash.active_stations}</div>
        <div class="kpi-label">Reportes SAT al dia</div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon orange">!</div></div>
        <div class="kpi-value" style="color:${dash.critical_stations > 0 ? 'var(--red)' : 'var(--orange)'}">${dash.critical_stations + dash.low_stations}</div>
        <div class="kpi-label">Estaciones nivel bajo</div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon blue">P</div></div>
        <div class="kpi-value">${dash.pending_orders}</div>
        <div class="kpi-label">Pedidos recomendados</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Ventas por Combustible (7 dias)</span>
        </div>
        <div class="chart-wrap"><canvas id="chartSales"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Alertas Recientes</span></div>
        <div id="alertsList">${renderAlerts(alerts)}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Vista General de Estaciones</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Estacion</th><th>Ubicacion</th><th>Magna</th><th>Premium</th><th>Diesel</th><th>Ventas Hoy (L)</th><th>SAT</th><th>Estado</th></tr></thead>
          <tbody>${renderStationsTable(stations)}</tbody>
        </table>
      </div>
    </div>`;

    showContent(html);
    renderSalesChart(salesData);
    updateNotifications(alerts);
  } catch(e) {
    showContent(`<div class="panel"><p style="color:var(--red)">Error cargando dashboard: ${e.message}</p></div>`);
  }
}

function renderAlerts(alerts) {
  if (!alerts.length) return '<p style="color:var(--g500);font-size:.8rem;padding:.5rem 0">Sin alertas recientes.</p>';
  return alerts.slice(0, 8).map(a => `
    <div class="alert-item">
      <span class="alert-dot ${a.type}"></span>
      <div><div class="alert-text"><strong>${a.station}</strong> -- ${a.message}</div><div class="alert-time">${a.time}</div></div>
    </div>`).join('');
}

function renderStationsTable(stations) {
  return stations.map(s => {
    const statusMap = { normal: badge('Normal', 'green'), low: badge('Precaucion', 'orange'), critical: badge('Critico', 'red') };
    return `<tr>
      <td class="td-name">${s.name}</td>
      <td>${s.address || s.city}</td>
      <td>${tankBar(s.levels.magna.pct)}</td>
      <td>${tankBar(s.levels.premium.pct)}</td>
      <td>${tankBar(s.levels.diesel.pct)}</td>
      <td style="color:var(--w);font-weight:600">${fmt(s.today_sold)}</td>
      <td>${s.sat_compliant ? badge('OK', 'green') : badge('Pend.', 'orange')}</td>
      <td>${statusMap[s.status] || s.status}</td>
    </tr>`;
  }).join('');
}

function renderSalesChart(data) {
  const ctx = document.getElementById('chartSales');
  if (!ctx) return;
  charts.sales = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.label),
      datasets: [
        { label: 'Magna', data: data.map(d => d.magna), borderColor: FUEL_COLORS.magna, backgroundColor: 'rgba(34,197,94,.1)', fill: true, tension: .4, borderWidth: 2, pointRadius: 3 },
        { label: 'Premium', data: data.map(d => d.premium), borderColor: FUEL_COLORS.premium, backgroundColor: 'rgba(239,68,68,.1)', fill: true, tension: .4, borderWidth: 2, pointRadius: 3 },
        { label: 'Diesel', data: data.map(d => d.diesel), borderColor: FUEL_COLORS.diesel, backgroundColor: 'rgba(234,179,8,.1)', fill: true, tension: .4, borderWidth: 2, pointRadius: 3 },
      ],
    },
    options: chartOpts({ yCallback: v => fmt(v) }),
  });
}

function updateNotifications(alerts) {
  const dot = document.getElementById('notifDot');
  const hasCritical = alerts.some(a => a.type === 'critical');
  dot.classList.toggle('show', hasCritical);
}

// ----------------------------------------------------------------
//  REPORTES
// ----------------------------------------------------------------
async function loadReportes() {
  showContent('<div class="loading"><div class="spinner"></div><p>Cargando reportes...</p></div>');
  try {
    const history = await api('/api/reports/history');
    const typeLabels = {
      sat_volumetric: 'Control Volumetrico SAT',
      sat_xml_volumetric: 'XML SAT Volumetrico (IA)',
      cne_weekly: 'Reporte Semanal CNE',
      inventory_close: 'Inventario de Cierre',
      price_tariff: 'Precios y Tarifas',
    };
    const typeIcons = {
      sat_volumetric: 'V', sat_xml_volumetric: 'X', cne_weekly: 'C', inventory_close: 'I', price_tariff: '$',
    };

    // Count stats
    const today = new Date().toISOString().split('T')[0];
    const todayReports = history.filter(r => r.date === today);
    const sentReports = history.filter(r => r.status === 'sent');

    const xmlReports = history.filter(r => r.type === 'sat_xml_volumetric');

    let html = `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">OK</div></div><div class="kpi-value" style="color:var(--green)">100%</div><div class="kpi-label">Cumplimiento SAT (mes)</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon teal">R</div></div><div class="kpi-value">${history.length}</div><div class="kpi-label">Reportes generados</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">T</div></div><div class="kpi-value">${todayReports.length}</div><div class="kpi-label">Reportes hoy</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon blue">XML</div></div><div class="kpi-value" style="color:var(--teal)">${xmlReports.length}</div><div class="kpi-label">Reportes XML SAT</div></div>
    </div>

    <div class="panel" style="border:1px solid var(--teal);background:linear-gradient(135deg, rgba(13,148,136,.08), rgba(13,148,136,.02))">
      <div class="panel-header">
        <span class="panel-title" style="color:var(--teal)">Generar Reporte con IA (Loti)</span>
      </div>
      <p style="color:var(--g400);font-size:.78rem;margin-bottom:.8rem">Sube tus datos operativos y Claude genera el XML validado listo para enviar al SAT o CNE via el portal de controles volumetricos.</p>
      <div id="satXmlForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.6rem">
          <div class="form-group" style="margin:0">
            <label class="form-label">RFC Contribuyente</label>
            <input type="text" class="form-input" id="xmlRfc" value="GAZ850101ABC" placeholder="RFC de la empresa">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Numero de Permiso CRE/CNE</label>
            <input type="text" class="form-input" id="xmlPermiso" value="PL/12345/EXP/ES/2024" placeholder="PL/XXXXX/EXP/ES/XXXX">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;margin-bottom:.6rem">
          <div class="form-group" style="margin:0">
            <label class="form-label">Clave Instalacion</label>
            <input type="text" class="form-input" id="xmlClave" value="EDS-0001" placeholder="EDS-XXXX">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Fecha del Reporte</label>
            <input type="date" class="form-input" id="xmlFecha" value="${today}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Fuente de Datos</label>
            <select class="form-select" id="xmlSource" onchange="toggleXmlDataSource()">
              <option value="manual">Ingresar datos manualmente</option>
              <option value="upload">Subir Documento (PDF, Excel, Word, Imagen)</option>
              <option value="database">Usar datos de ControlPetro</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:.6rem">
          <label class="form-label">Formato del Reporte</label>
          <div id="xmlFormatToggle" style="display:flex;gap:0;border:1px solid var(--g600);border-radius:6px;overflow:hidden;width:fit-content">
            <button type="button" onclick="setReportFormat('sat')" id="fmtSat" class="fmt-btn fmt-active" style="padding:6px 16px;border:none;font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">SAT</button>
            <button type="button" onclick="setReportFormat('cne')" id="fmtCne" class="fmt-btn" style="padding:6px 16px;border:none;border-left:1px solid var(--g600);font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">CNE</button>
            <button type="button" onclick="setReportFormat('ambos')" id="fmtAmbos" class="fmt-btn" style="padding:6px 16px;border:none;border-left:1px solid var(--g600);font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">Ambos</button>
          </div>
        </div>

        <div id="xmlManualData">
          <div class="form-group" style="margin:0;margin-bottom:.6rem">
            <label class="form-label">Datos Operativos (lecturas de tanques, recepciones PEMEX, ventas del dia)</label>
            <textarea class="form-input" id="xmlRawData" rows="10" style="font-family:monospace;font-size:.72rem;line-height:1.4;resize:vertical" placeholder="Pega aqui los datos del dia. Ejemplo:

TANQUE MAGNA (TQ-0001):
  Capacidad: 40,000L
  Inventario Inicial: 15,000L
  Recepcion PEMEX: 20,000L (Factura A-12345, 27/02/2026 10:15am)
  Proveedor: PEMEX Transformacion Industrial (RFC: PEM991231XXX)
  Precio por litro: $21.50
  Litros Vendidos: 18,500L via DISP-0001 (2 mangueras)
  Inventario Final: 16,500L
  Temperatura promedio: 26Â°C

TANQUE PREMIUM (TQ-0002):
  Capacidad: 40,000L
  Inventario Inicial: 12,000L
  Sin recepciones
  Litros Vendidos: 5,200L via DISP-0003
  Inventario Final: 6,800L

TANQUE DIESEL (TQ-0003):
  Capacidad: 40,000L
  Inventario Inicial: 22,000L
  Sin recepciones
  Litros Vendidos: 8,000L via DISP-0005
  Inventario Final: 14,000L"></textarea>
          </div>
        </div>
        <div id="xmlUploadData" style="display:none;margin-bottom:.6rem">
          <div id="xmlDropZone" style="border:2px dashed var(--g600);border-radius:8px;padding:1.5rem;text-align:center;cursor:pointer;transition:all .2s"
               ondragover="event.preventDefault();this.style.borderColor='var(--teal)';this.style.background='rgba(13,148,136,.08)'"
               ondragleave="this.style.borderColor='var(--g600)';this.style.background='transparent'"
               ondrop="handleFileDrop(event)"
               onclick="document.getElementById('xmlFileInput').click()">
            <div style="font-size:2rem;margin-bottom:.4rem;color:var(--g500)">&#128194;</div>
            <p style="color:var(--g400);font-size:.8rem;margin:0">Arrastra tu archivo aqui o haz clic para seleccionar</p>
            <p style="color:var(--g600);font-size:.7rem;margin:.3rem 0 0">PDF, XLSX, DOCX, JPG, PNG (max 10MB)</p>
            <input type="file" id="xmlFileInput" style="display:none" accept=".pdf,.xlsx,.xls,.docx,.jpg,.jpeg,.png,.webp" onchange="handleFileSelect(this)">
          </div>
          <div id="xmlFileInfo" style="display:none;margin-top:.5rem;padding:.5rem .7rem;background:rgba(13,148,136,.06);border-radius:6px;display:flex;align-items:center;gap:.5rem">
            <span style="color:var(--teal);font-size:.8rem" id="xmlFileName"></span>
            <span style="color:var(--g500);font-size:.7rem" id="xmlFileSize"></span>
            <button class="btn btn-outline" onclick="clearUploadedFile()" style="margin-left:auto;padding:2px 8px;font-size:.7rem">Quitar</button>
          </div>
          <div style="margin-top:.5rem">
            <button class="btn btn-primary" onclick="extractFromDocument()" id="btnExtract" style="background:var(--teal);padding:8px 20px;font-size:.8rem">
              Analizar Documento con IA
            </button>
            <span id="extractSpinner" style="display:none;color:var(--teal);font-size:.78rem;margin-left:8px">
              <span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px"></span>
              Analizando documento...
            </span>
          </div>
        </div>

        <div id="xmlExtractResult" style="display:none;margin-bottom:.6rem"></div>

        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn btn-primary" onclick="generateSatXml()" id="btnGenXml" style="background:var(--teal);padding:10px 24px;font-size:.82rem">
            Generar XML con Loti
          </button>
          <span id="xmlSpinner" style="display:none;color:var(--teal);font-size:.78rem">
            <span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px"></span>
            Generando reporte con IA...
          </span>
        </div>
      </div>
      <div id="xmlResult" style="display:none;margin-top:.8rem"></div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Generar Reportes Internos</span>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">
        <button class="btn btn-primary" onclick="generateReport('sat_volumetric')">Generar SAT Volumetrico (Excel)</button>
        <button class="btn btn-primary" onclick="generateReport('cne_weekly')">Generar CNE Semanal</button>
        <button class="btn btn-primary" onclick="generateReport('inventory_close')">Generar Inventario Cierre</button>
        <button class="btn btn-primary" onclick="generateReport('price_tariff')">Generar Precios/Tarifas</button>
        <button class="btn btn-orange" onclick="generateAllReports()">Generar Todos</button>
      </div>
    </div>

    <!-- Fast Report Generator -->
    <div class="card" style="margin-top:16px; border: 1px solid var(--accent-teal);">
      <div class="card-header" style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.3em;">&#9889;</span>
        <h3 style="margin:0; color:var(--accent-teal);">Reporte R\u00e1pido</h3>
        <span class="badge" style="background:var(--accent-teal);color:#fff;font-size:0.7em;padding:2px 8px;border-radius:8px;">Nuevo</span>
      </div>
      <p style="color:var(--text-secondary);font-size:0.85em;margin:4px 0 12px;">Genera reportes SAT/CNE en segundos sin IA. Opci\u00f3n de env\u00edo por email.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <div>
          <label style="font-size:0.8em;color:var(--text-secondary);">Formato</label>
          <select id="fast-format" style="display:block;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--card-bg);color:var(--text-primary);margin-top:4px;">
            <option value="xml">XML (SAT Anexo 30)</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8em;color:var(--text-secondary);">Alcance</label>
          <select id="fast-scope" style="display:block;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--card-bg);color:var(--text-primary);margin-top:4px;">
            <option value="sat">SAT</option>
            <option value="cne">CNE</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8em;color:var(--text-secondary);">Fecha</label>
          <input type="date" id="fast-date" style="display:block;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--card-bg);color:var(--text-primary);margin-top:4px;">
        </div>
        <button class="btn btn-teal" onclick="generateFastReport()" id="btn-fast-report">&#9889; Generar R\u00e1pido</button>
      </div>
      <div style="display:flex;gap:12px;align-items:end;margin-top:12px;">
        <div style="flex:1;">
          <label style="font-size:0.8em;color:var(--text-secondary);">Email (opcional)</label>
          <input type="email" id="fast-email" placeholder="correo@ejemplo.com" style="display:block;width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--card-bg);color:var(--text-primary);margin-top:4px;">
        </div>
        <button class="btn btn-pink" onclick="emailFastReport()" id="btn-email-report">&#9993; Enviar por Email</button>
      </div>
      <div id="fast-report-result" style="margin-top:12px;"></div>
    </div>

    <div class="panel" id="reportGenMsg" style="display:none"></div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Historial de Reportes</span></div>
      <div id="reportList">${renderReportList(history, typeLabels, typeIcons)}</div>
    </div>`;

    showContent(html);
  } catch(e) {
    showContent(`<div class="panel"><p style="color:var(--red)">Error: ${e.message}</p></div>`);
  }
}

function renderReportList(history, labels, icons) {
  if (!history.length) return '<p style="color:var(--g500);font-size:.8rem">No hay reportes generados.</p>';
  return history.map(r => {
    const statusBadge = r.status === 'sent' ? badge('Enviado', 'green') : badge('Generado', 'teal');
    const dateStr = new Date(r.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="report-row">
      <div class="report-left">
        <div class="report-icon">${icons[r.type] || 'R'}</div>
        <div><div class="report-name">${labels[r.type] || r.type}</div><div class="report-desc">${r.details || r.date}</div></div>
      </div>
      <div class="report-right">
        ${statusBadge}
        <span class="report-date">${dateStr}</span>
        <button class="btn btn-teal" onclick="downloadReport(${r.id})">Descargar</button>
        ${r.status !== 'sent' ? `<button class="btn btn-outline" onclick="sendReport(${r.id})">Marcar Enviado</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function generateReport(type) {
  const msgEl = document.getElementById('reportGenMsg');
  if (msgEl) { msgEl.style.display = 'block'; msgEl.className = 'panel form-msg'; msgEl.textContent = 'Generando reporte...'; msgEl.style.display = 'block'; }
  try {
    const result = await apiPost('/api/reports/generate', { type });
    if (msgEl) { msgEl.className = 'panel form-msg success'; msgEl.textContent = `Reporte generado: ${result.filename || 'OK'}`; }
    setTimeout(() => loadReportes(), 1500);
  } catch(e) {
    if (msgEl) { msgEl.className = 'panel form-msg error'; msgEl.textContent = `Error: ${e.message}`; }
  }
}

async function generateAllReports() {
  const msgEl = document.getElementById('reportGenMsg');
  if (msgEl) { msgEl.style.display = 'block'; msgEl.className = 'panel form-msg'; msgEl.textContent = 'Generando todos los reportes...'; }
  try {
    await apiPost('/api/reports/generate-all', {});
    if (msgEl) { msgEl.className = 'panel form-msg success'; msgEl.textContent = 'Todos los reportes generados exitosamente.'; }
    setTimeout(() => loadReportes(), 1500);
  } catch(e) {
    if (msgEl) { msgEl.className = 'panel form-msg error'; msgEl.textContent = `Error: ${e.message}`; }
  }
}

function downloadReport(id) {
  window.open(`/api/reports/download/${id}`, '_blank');
}

async function sendReport(id) {
  await apiPost(`/api/reports/send/${id}`, {});
  loadReportes();
}

async function generateFastReport() {
  var btn = document.getElementById('btn-fast-report');
  var resultDiv = document.getElementById('fast-report-result');
  var fmt = document.getElementById('fast-format').value;
  var scope = document.getElementById('fast-scope').value;
  var dateVal = document.getElementById('fast-date').value;
  
  btn.disabled = true;
  btn.textContent = 'Generando...';
  resultDiv.innerHTML = '<p style="color:var(--accent-teal);">Generando reporte...</p>';

  try {
    var body = {format: fmt, scope: scope};
    if (dateVal) body.date = dateVal;
    
    var resp = await fetch('/api/reports/fast', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify(body)
    });
    var data = await resp.json();
    
    if (data.error) {
      resultDiv.innerHTML = '<p style="color:var(--accent-pink);">Error: ' + data.error + '</p>';
      return;
    }

    var html = '<div style="background:rgba(13,148,136,0.1);border:1px solid var(--accent-teal);border-radius:8px;padding:12px;">';
    html += '<p style="color:var(--accent-teal);font-weight:600;margin:0 0 8px;">Reporte generado en ' + data.elapsed_seconds + 's</p>';
    html += '<p style="margin:4px 0;font-size:0.85em;">Archivo: ' + data.filename + '</p>';
    html += '<p style="margin:4px 0;font-size:0.85em;">Estaciones: ' + data.station_count + ' | Formato: ' + data.format.toUpperCase() + '</p>';
    if (data.total_sold) {
      html += '<p style="margin:4px 0;font-size:0.85em;">Vendidos: ' + Math.round(data.total_sold).toLocaleString() + 'L | Recibidos: ' + Math.round(data.total_received).toLocaleString() + 'L</p>';
    }
    html += '<a href="/api/reports/fast/download/' + data.report_id + '" class="btn btn-teal" style="margin-top:8px;display:inline-block;text-decoration:none;font-size:0.85em;" download>Descargar</a>';
    html += '</div>';
    resultDiv.innerHTML = html;
    
    loadReportes();
  } catch(e) {
    resultDiv.innerHTML = '<p style="color:var(--accent-pink);">Error: ' + e.message + '</p>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '\u26a1 Generar R\u00e1pido';
  }
}

async function emailFastReport() {
  var btn = document.getElementById('btn-email-report');
  var resultDiv = document.getElementById('fast-report-result');
  var emailInput = document.getElementById('fast-email');
  var email = emailInput.value.trim();
  var fmt = document.getElementById('fast-format').value;
  var scope = document.getElementById('fast-scope').value;
  var dateVal = document.getElementById('fast-date').value;

  if (!email) {
    resultDiv.innerHTML = '<p style="color:var(--accent-pink);">Ingresa un correo electr\u00f3nico.</p>';
    emailInput.focus();
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  resultDiv.innerHTML = '<p style="color:var(--accent-teal);">Generando y enviando reporte...</p>';

  try {
    var body = {format: fmt, scope: scope, email: email};
    if (dateVal) body.date = dateVal;
    
    var resp = await fetch('/api/reports/email', {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify(body)
    });
    var data = await resp.json();
    
    if (data.error || data.email_error) {
      resultDiv.innerHTML = '<p style="color:var(--accent-pink);">Error: ' + (data.error || data.email_error) + '</p>';
      return;
    }

    resultDiv.innerHTML = '<div style="background:rgba(13,148,136,0.1);border:1px solid var(--accent-teal);border-radius:8px;padding:12px;">' +
      '<p style="color:var(--accent-teal);font-weight:600;margin:0;">Reporte enviado a ' + data.email.sent_to + '</p>' +
      '<p style="margin:4px 0;font-size:0.85em;">Archivo: ' + data.report.filename + ' (' + data.report.station_count + ' estaciones)</p>' +
      '</div>';
  } catch(e) {
    resultDiv.innerHTML = '<p style="color:var(--accent-pink);">Error: ' + e.message + '</p>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '\u2709 Enviar por Email';
  }
}


// ----------------------------------------------------------------
//  SAT XML Generation
// ----------------------------------------------------------------
function toggleXmlDataSource() {
  const source = document.getElementById('xmlSource').value;
  const manual = document.getElementById('xmlManualData');
  const upload = document.getElementById('xmlUploadData');
  const extractResult = document.getElementById('xmlExtractResult');
  if (manual) manual.style.display = source === 'manual' ? 'block' : 'none';
  if (upload) upload.style.display = source === 'upload' ? 'block' : 'none';
  if (extractResult && source !== 'upload') extractResult.style.display = 'none';
}

// ----------------------------------------------------------------
//  Document Upload & Extraction
// ----------------------------------------------------------------
let uploadedFile = null;
let extractedData = null;

function handleFileDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('xmlDropZone');
  zone.style.borderColor = 'var(--g600)';
  zone.style.background = 'transparent';
  if (e.dataTransfer.files.length > 0) {
    setUploadedFile(e.dataTransfer.files[0]);
  }
}

function handleFileSelect(input) {
  if (input.files.length > 0) {
    setUploadedFile(input.files[0]);
  }
}

function setUploadedFile(file) {
  const allowed = ['pdf', 'xlsx', 'xls', 'docx', 'jpg', 'jpeg', 'png', 'webp'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    alert('Tipo de archivo no soportado. Use PDF, XLSX, DOCX, JPG o PNG.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('Archivo demasiado grande. Maximo 10MB.');
    return;
  }
  uploadedFile = file;
  const info = document.getElementById('xmlFileInfo');
  document.getElementById('xmlFileName').textContent = file.name;
  document.getElementById('xmlFileSize').textContent = `(${(file.size / 1024).toFixed(0)} KB)`;
  info.style.display = 'flex';
}

function clearUploadedFile() {
  uploadedFile = null;
  extractedData = null;
  document.getElementById('xmlFileInfo').style.display = 'none';
  document.getElementById('xmlFileInput').value = '';
  document.getElementById('xmlExtractResult').style.display = 'none';
}

async function extractFromDocument() {
  if (!uploadedFile) { alert('Selecciona un archivo primero.'); return; }

  const btn = document.getElementById('btnExtract');
  const spinner = document.getElementById('extractSpinner');
  const resultDiv = document.getElementById('xmlExtractResult');
  btn.disabled = true;
  spinner.style.display = 'inline';
  resultDiv.style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('file', uploadedFile);
    const extractHeaders = getApiHeaders();

    const resp = await fetch('/api/sat-xml/extract', {
      method: 'POST',
      headers: extractHeaders,
      body: formData
    });
    const result = await resp.json();
    if (result.error) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `<div class="form-msg error">${result.error}</div>`;
      return;
    }

    extractedData = result.extracted_data;
    const confidence = result.confidence || 50;
    const notes = result.notes || [];
    const tokens = result.tokens_used;
    const ed = extractedData;

    // Fill in the main form fields from extracted data
    if (ed.rfc) document.getElementById('xmlRfc').value = ed.rfc;
    if (ed.permiso) document.getElementById('xmlPermiso').value = ed.permiso;
    if (ed.clave_instalacion) document.getElementById('xmlClave').value = ed.clave_instalacion;
    if (ed.fecha) document.getElementById('xmlFecha').value = ed.fecha;

    // Check if any fields are uncertain or missing
    const tanques = ed.tanques || [];
    const recepciones = ed.recepciones || [];
    const entregas = ed.entregas || [];
    const hasUncertain = tanques.some(t => t.uncertain) || recepciones.some(r => r.uncertain) || entregas.some(e => e.uncertain);
    const hasTanques = tanques.length > 0;

    // If confidence is high, we have tanks, and nothing is uncertain -> go straight to generation
    if (confidence >= 60 && hasTanques && !hasUncertain) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `
        <div style="background:rgba(13,148,136,.06);border:1px solid var(--teal);border-radius:8px;padding:.8rem">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
            <span style="background:var(--green);color:#000;font-weight:700;padding:3px 10px;border-radius:12px;font-size:.75rem">
              Confianza: ${confidence}/100 (Alta)
            </span>
            <span style="color:var(--g400);font-size:.75rem">Datos extraidos de <strong>${uploadedFile.name}</strong></span>
          </div>
          <div style="color:var(--teal);font-size:.82rem;font-weight:600;margin-top:.4rem">
            Todos los datos fueron extraidos exitosamente. Generando reporte...
          </div>
          <div style="color:var(--g500);font-size:.72rem;margin-top:.3rem">
            ${tanques.length} tanque(s), ${recepciones.length} recepcion(es), ${entregas.length} entrega(s)
          </div>
        </div>`;
      // Go straight to XML generation — no manual review needed
      confirmExtractedData();
      return;
    }

    // ---- If we get here, there are uncertain/missing fields — show review UI ----
    const confColor = confidence >= 80 ? 'var(--green)' : confidence >= 50 ? 'var(--orange)' : 'var(--red)';
    const confLabel = confidence >= 80 ? 'Alta' : confidence >= 50 ? 'Media' : 'Baja';

    const notesHtml = notes.length > 0
      ? `<div style="margin-top:.5rem;padding:.4rem .6rem;background:rgba(249,115,22,.08);border-radius:6px;border-left:3px solid var(--orange)">
          <div style="color:var(--orange);font-size:.72rem;font-weight:600;margin-bottom:.3rem">Notas y Advertencias:</div>
          ${notes.map(n => `<div style="color:var(--g400);font-size:.72rem;padding:.1rem 0">\u26A0 ${n}</div>`).join('')}
        </div>`
      : '';

    const tanquesRows = tanques.map((t, i) => `<tr>
      <td><input class="form-input" style="font-size:.72rem;padding:4px 6px" value="${t.nombre || ''}" id="ext_tq_nombre_${i}"></td>
      <td><select class="form-select" style="font-size:.72rem;padding:4px 6px" id="ext_tq_prod_${i}">
        <option value="magna" ${t.producto === 'magna' ? 'selected' : ''}>Magna</option>
        <option value="premium" ${t.producto === 'premium' ? 'selected' : ''}>Premium</option>
        <option value="diesel" ${t.producto === 'diesel' ? 'selected' : ''}>Diesel</option>
      </select></td>
      <td><input type="number" class="form-input" style="font-size:.72rem;padding:4px 6px;width:80px" value="${t.capacidad_litros || ''}" id="ext_tq_cap_${i}"></td>
      <td><input type="number" class="form-input" style="font-size:.72rem;padding:4px 6px;width:80px" value="${t.inventario_inicial || ''}" id="ext_tq_ini_${i}"></td>
      <td><input type="number" class="form-input" style="font-size:.72rem;padding:4px 6px;width:80px" value="${t.inventario_final || ''}" id="ext_tq_fin_${i}"></td>
      <td style="text-align:center">${t.uncertain ? '<span style="color:var(--orange);font-size:.7rem">\u26A0</span>' : '<span style="color:var(--green);font-size:.7rem">\u2713</span>'}</td>
    </tr>`).join('');

    const recepRows = recepciones.map((r, i) => `<tr>
      <td><input class="form-input" style="font-size:.72rem;padding:4px 6px" value="${r.tanque || ''}" id="ext_rec_tq_${i}"></td>
      <td><input type="number" class="form-input" style="font-size:.72rem;padding:4px 6px;width:80px" value="${r.litros || ''}" id="ext_rec_litros_${i}"></td>
      <td><input class="form-input" style="font-size:.72rem;padding:4px 6px" value="${r.proveedor || ''}" id="ext_rec_prov_${i}"></td>
      <td><input class="form-input" style="font-size:.72rem;padding:4px 6px;width:100px" value="${r.num_factura || ''}" id="ext_rec_fact_${i}"></td>
      <td><input type="number" class="form-input" style="font-size:.72rem;padding:4px 6px;width:70px" value="${r.precio_litro || ''}" step="0.01" id="ext_rec_precio_${i}"></td>
      <td style="text-align:center">${r.uncertain ? '<span style="color:var(--orange);font-size:.7rem">\u26A0</span>' : '<span style="color:var(--green);font-size:.7rem">\u2713</span>'}</td>
    </tr>`).join('');

    const entregRows = entregas.map((e, i) => `<tr>
      <td><input class="form-input" style="font-size:.72rem;padding:4px 6px" value="${e.tanque || ''}" id="ext_ent_tq_${i}"></td>
      <td><input type="number" class="form-input" style="font-size:.72rem;padding:4px 6px;width:80px" value="${e.litros || ''}" id="ext_ent_litros_${i}"></td>
      <td><input class="form-input" style="font-size:.72rem;padding:4px 6px" value="${e.dispensario || ''}" id="ext_ent_disp_${i}"></td>
      <td style="text-align:center">${e.uncertain ? '<span style="color:var(--orange);font-size:.7rem">\u26A0</span>' : '<span style="color:var(--green);font-size:.7rem">\u2713</span>'}</td>
    </tr>`).join('');

    const tokensHtml = tokens ? `<span style="color:var(--g500);font-size:.68rem;margin-left:8px">(${tokens.input + tokens.output} tokens)</span>` : '';

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div style="background:rgba(13,148,136,.06);border:1px solid var(--teal);border-radius:8px;padding:.8rem">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;flex-wrap:wrap">
          <span style="background:${confColor};color:#000;font-weight:700;padding:3px 10px;border-radius:12px;font-size:.75rem">
            Confianza: ${confidence}/100 (${confLabel})
          </span>
          <span style="color:var(--g400);font-size:.75rem">Datos extraidos de <strong>${uploadedFile.name}</strong></span>
          ${tokensHtml}
        </div>
        <div style="background:rgba(249,115,22,.1);border-radius:6px;padding:.5rem .7rem;margin-bottom:.5rem;border-left:3px solid var(--orange)">
          <span style="color:var(--orange);font-size:.78rem;font-weight:600">\u26A0 Algunos datos requieren revision</span>
          <span style="color:var(--g400);font-size:.72rem;display:block;margin-top:.2rem">Revisa los campos marcados con \u26A0 y completa la informacion faltante.</span>
        </div>
        ${notesHtml}
        <div style="margin-top:.6rem">
          <div style="color:var(--w);font-size:.78rem;font-weight:600;margin-bottom:.3rem">Tanques</div>
          <div class="table-wrap" style="margin-bottom:.5rem">
            <table style="font-size:.72rem">
              <thead><tr><th>Tanque</th><th>Producto</th><th>Capacidad (L)</th><th>Inv. Inicial</th><th>Inv. Final</th><th>OK</th></tr></thead>
              <tbody>${tanquesRows || '<tr><td colspan="6" style="color:var(--g500);text-align:center">No se detectaron tanques</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        ${recepciones.length > 0 ? `<div style="margin-top:.5rem">
          <div style="color:var(--w);font-size:.78rem;font-weight:600;margin-bottom:.3rem">Recepciones</div>
          <div class="table-wrap" style="margin-bottom:.5rem">
            <table style="font-size:.72rem">
              <thead><tr><th>Tanque</th><th>Litros</th><th>Proveedor</th><th>Factura</th><th>$/L</th><th>OK</th></tr></thead>
              <tbody>${recepRows}</tbody>
            </table>
          </div>
        </div>` : ''}
        ${entregas.length > 0 ? `<div style="margin-top:.5rem">
          <div style="color:var(--w);font-size:.78rem;font-weight:600;margin-bottom:.3rem">Entregas/Ventas</div>
          <div class="table-wrap" style="margin-bottom:.5rem">
            <table style="font-size:.72rem">
              <thead><tr><th>Tanque</th><th>Litros</th><th>Dispensario</th><th>OK</th></tr></thead>
              <tbody>${entregRows}</tbody>
            </table>
          </div>
        </div>` : ''}
        <div style="margin-top:.6rem;display:flex;gap:.5rem">
          <button class="btn btn-primary" onclick="confirmExtractedData()" style="background:var(--green);padding:8px 20px;font-size:.8rem">
            Confirmar y Generar XML
          </button>
          <button class="btn btn-outline" onclick="extractFromDocument()" style="padding:8px 16px;font-size:.78rem">
            Re-analizar
          </button>
        </div>
        <p style="color:var(--g500);font-size:.68rem;margin-top:.4rem;margin-bottom:0">
          Revisa y edita los datos extraidos antes de generar el XML. Los campos marcados con \u26A0 requieren atencion.
        </p>
      </div>`;
  } catch(e) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<div class="form-msg error">${e.message}</div>`;
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

function confirmExtractedData() {
  if (!extractedData) {
    alert('No hay datos extraidos. Analiza un documento primero.');
    return;
  }

  // Read edited values from the review tables
  const tanques = extractedData.tanques || [];
  const recepciones = extractedData.recepciones || [];
  const entregas = extractedData.entregas || [];

  let rawLines = [];
  const fecha = document.getElementById('xmlFecha').value;
  rawLines.push(`FECHA: ${fecha}`);
  rawLines.push('');

  // Tanks
  tanques.forEach((t, i) => {
    const nombre = (document.getElementById(`ext_tq_nombre_${i}`) || {}).value || t.nombre;
    const prod = (document.getElementById(`ext_tq_prod_${i}`) || {}).value || t.producto;
    const cap = (document.getElementById(`ext_tq_cap_${i}`) || {}).value || t.capacidad_litros;
    const ini = (document.getElementById(`ext_tq_ini_${i}`) || {}).value || t.inventario_inicial;
    const fin = (document.getElementById(`ext_tq_fin_${i}`) || {}).value || t.inventario_final;

    rawLines.push(`TANQUE ${nombre} (${prod.toUpperCase()}):`);
    rawLines.push(`  Capacidad: ${cap}L`);
    rawLines.push(`  Inventario Inicial: ${ini}L`);

    // Find receptions for this tank
    recepciones.forEach((r, j) => {
      const rTq = (document.getElementById(`ext_rec_tq_${j}`) || {}).value || r.tanque;
      if (rTq === nombre || rTq === t.nombre) {
        const litros = (document.getElementById(`ext_rec_litros_${j}`) || {}).value || r.litros;
        const prov = (document.getElementById(`ext_rec_prov_${j}`) || {}).value || r.proveedor;
        const fact = (document.getElementById(`ext_rec_fact_${j}`) || {}).value || r.num_factura;
        const precio = (document.getElementById(`ext_rec_precio_${j}`) || {}).value || r.precio_litro;
        rawLines.push(`  Recepcion: ${litros}L (Factura ${fact}, Proveedor: ${prov}, RFC: ${r.rfc_proveedor || 'N/A'})`);
        rawLines.push(`  Precio por litro: $${precio}`);
      }
    });

    // Find deliveries for this tank
    let totalEntregas = 0;
    entregas.forEach((e, j) => {
      const eTq = (document.getElementById(`ext_ent_tq_${j}`) || {}).value || e.tanque;
      if (eTq === nombre || eTq === t.nombre) {
        const litros = (document.getElementById(`ext_ent_litros_${j}`) || {}).value || e.litros;
        const disp = (document.getElementById(`ext_ent_disp_${j}`) || {}).value || e.dispensario;
        totalEntregas += parseFloat(litros) || 0;
        rawLines.push(`  Litros Vendidos: ${litros}L via ${disp}`);
      }
    });

    rawLines.push(`  Inventario Final: ${fin}L`);
    if (t.temperatura) rawLines.push(`  Temperatura promedio: ${t.temperatura}Â°C`);
    rawLines.push('');
  });

  // Set the raw data textarea and switch to manual mode for generation
  const rawDataEl = document.getElementById('xmlRawData');
  if (rawDataEl) rawDataEl.value = rawLines.join('\n');

  // Switch source to manual so generateSatXml picks up the textarea
  document.getElementById('xmlSource').value = 'manual';
  toggleXmlDataSource();

  // Auto-trigger XML generation
  generateSatXml();
}

function setReportFormat(fmt) {
  _reportFormat = fmt;
  ['sat','cne','ambos'].forEach(f => {
    const b = document.getElementById('fmt' + f.charAt(0).toUpperCase() + f.slice(1));
    if (b) b.classList.toggle('fmt-active', f === fmt);
  });
  const btn = document.getElementById('btnGenXml');
  if (btn) {
    const labels = {sat:'Generar XML SAT',cne:'Generar Reporte CNE',ambos:'Generar SAT + CNE'};
    btn.textContent = labels[fmt] || 'Generar XML con Loti';
  }
}

function renderReportResult(result, formatLabel) {
  const v = result.validation || {};
  const products = (v.products || []).map(p =>
    '<span style="margin-right:8px">' + p.clave + ' (' + p.marca + '): ' + p.tanques + ' tanques, ' + p.dispensarios + ' disp. ' + (p.balance_ok ? badge('Balance OK','green') : badge('Balance Error','red')) + '</span>'
  ).join('');
  const warnings = (v.warnings || []).length > 0
    ? '<div style="color:var(--orange);font-size:.72rem;margin-top:.4rem"><strong>Advertencias:</strong> ' + v.warnings.join('; ') + '</div>'
    : '';
  const tokens = result.tokens_used
    ? '<span style="color:var(--g500);font-size:.68rem;margin-left:8px">(' + (result.tokens_used.input + result.tokens_used.output) + ' tokens)</span>'
    : '';
  const portalMsg = formatLabel === 'CNE'
    ? 'Sube este reporte al portal CNE/CRE segun la normativa vigente.'
    : 'Sube este .zip al portal SAT: sat.gob.mx/tramites/01116';
  const sendLabel = formatLabel === 'CNE' ? 'Marcar Enviado al CNE' : 'Marcar Enviado al SAT';
  return '<div style="background:rgba(13,148,136,.1);border:1px solid var(--teal);border-radius:8px;padding:.8rem;margin-bottom:.5rem;position:relative">'
      + '<button onclick="this.parentElement.parentElement.style.display=\'none\'" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--g500);font-size:1.1rem;cursor:pointer;line-height:1;padding:2px 6px" title="Cerrar">&times;</button>'
    + '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">'
    + badge(formatLabel + ' Generado','green')
    + '<strong style="color:var(--w);font-size:.82rem">' + result.xml_filename + '</strong>' + tokens + '</div>'
    + '<div style="font-size:.72rem;color:var(--g400);margin-bottom:.5rem"><strong>Validacion:</strong> ' + (v.product_count||0) + ' productos, ' + (v.bitacora_count||0) + ' entradas bitacora</div>'
    + '<div style="font-size:.72rem;color:var(--g400)">' + products + '</div>' + warnings
    + '<div style="margin-top:.6rem;display:flex;gap:.5rem">'
    + '<button class="btn btn-primary" onclick="downloadReport(' + result.report_id + ')" style="background:var(--teal)">Descargar ' + result.zip_filename + '</button>'
    + '<button class="btn btn-outline" onclick="sendReport(' + result.report_id + ')">' + sendLabel + '</button></div>'
    + '<p style="color:var(--g500);font-size:.68rem;margin-top:.5rem;margin-bottom:0">' + portalMsg + '</p></div>';
}

async function generateSatXml() {
  const btn = document.getElementById('btnGenXml');
  const spinner = document.getElementById('xmlSpinner');
  const resultDiv = document.getElementById('xmlResult');
  const source = document.getElementById('xmlSource').value;

  btn.disabled = true;
  spinner.style.display = 'inline';
  resultDiv.style.display = 'none';

  try {
    let result;
    if (source === 'database') {
      const fecha = document.getElementById('xmlFecha').value;
      result = await apiPost('/api/sat-xml/generate-from-db', { date: fecha, format: _reportFormat });
    } else {
      const rawData = document.getElementById('xmlRawData').value;
      if (!rawData.trim()) {
        throw new Error('Ingresa los datos operativos del dia.');
      }
      result = await apiPost('/api/sat-xml/generate', {
        rfc: document.getElementById('xmlRfc').value,
        num_permiso: document.getElementById('xmlPermiso').value,
        clave_instalacion: document.getElementById('xmlClave').value,
        date: document.getElementById('xmlFecha').value,
        raw_data: rawData,
        format: _reportFormat,
      });
    }

    if (result.error) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `<div class="form-msg error">${result.error}</div>`;
      return;
    }

    if (result.format === 'ambos' && result.reports) {
      let ambosHtml = '';
      result.reports.forEach(r => {
        if (r.error) ambosHtml += '<div class="form-msg error" style="margin-bottom:.5rem">' + r.format + ': ' + r.error + '</div>';
        else ambosHtml += renderReportResult(r, r.format);
      });
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = ambosHtml;
    } else {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = renderReportResult(result, _reportFormat === 'cne' ? 'CNE' : 'SAT');
    }

  } catch(e) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<div class="form-msg error">${e.message}</div>`;
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

// ----------------------------------------------------------------
//  INVENTARIO
// ----------------------------------------------------------------
async function loadInventario() {
  showContent('<div class="loading"><div class="spinner"></div><p>Cargando inventario...</p></div>');
  try {
    const [summary, history, stations] = await Promise.all([
      api('/api/inventory/summary' + razonParam()),
      api('/api/inventory/history?days=7' + razonAmp()),
      api('/api/stations' + razonParam()),
    ]);

    const critical = stations.filter(s => s.status === 'critical');
    const low = stations.filter(s => s.status === 'low');
    const normal = stations.filter(s => s.status === 'normal');

    let html = `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">N</div></div><div class="kpi-value" style="color:var(--green)">${normal.length}</div><div class="kpi-label">Estaciones nivel normal</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">B</div></div><div class="kpi-value" style="color:var(--orange)">${low.length}</div><div class="kpi-label">Nivel bajo (25-40%)</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon red">C</div></div><div class="kpi-value" style="color:var(--red)">${critical.length}</div><div class="kpi-label">Nivel critico (&lt;25%)</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon teal">T</div></div><div class="kpi-value">${fmt(summary.total / 1000)}K</div><div class="kpi-label">Litros totales en stock</div></div>
    </div>

    <div class="grid-2 even">
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Inventario por Tipo de Combustible</span></div>
        <div class="chart-wrap short"><canvas id="chartInvPie"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><span class="panel-title">Estaciones en Alerta</span></div>
        ${renderInventoryAlerts(critical, low)}
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Balance de Inventario - Ultimos 7 Dias</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Litros Recibidos</th><th>Litros Vendidos</th><th>Existencia Total</th><th>Variacion Neta</th></tr></thead>
          <tbody>${history.map(h => `<tr>
            <td class="td-name">${h.label}</td>
            <td>${fmt(h.received)}</td>
            <td>${fmt(h.sold)}</td>
            <td>${fmt(h.on_hand)}</td>
            <td>${h.net >= 0 ? badge('+' + fmt(h.net), 'green') : badge(fmt(h.net), 'red')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div<j
    <div class="panel">
      <div class="panel-header"><span class="panel-title">Flujo de Inventario (7 Dias)</span></div>
      <div class="chart-wrap"><canvas id="chartInvFlow"></canvas></div>
    </div>`;

    showContent(html);
    renderInventoryCharts(summary, history);
  } catch(e) {
    showContent(`<div class="panel"><p style="color:var(--red)">Error: ${e.message}</p></div>`);
  }
}

function renderInventoryAlerts(critical, low) {
  const all = [...critical.map(s => ({ ...s, level: 'critical' })), ...low.map(s => ({ ...s, level: 'warning' }))];
  if (!all.length) return '<p style="color:var(--g500);font-size:.8rem;padding:.5rem 0">Todas las estaciones en nivel normal.</p>';
  return all.slice(0, 8).map(s => {
    const worstFuel = Object.entries(s.levels).reduce((min, [k, v]) => v.pct < min.pct ? { fuel: k, ...v } : min, { fuel: '', pct: 100 });
    return `<div class="alert-item">
      <span class="alert-dot ${s.level === 'critical' ? 'critical' : 'warning'}"></span>
      <div><div class="alert-text"><strong>${s.name}</strong> -- ${worstFuel.fuel.charAt(0).toUpperCase() + worstFuel.fuel.slice(1)}: ${worstFuel.pct.toFixed(0)}% (${fmt(worstFuel.liters)}L)</div></div>
    </div>`;
  }).join('');
}

function renderInventoryCharts(summary, history) {
  const pie = document.getElementById('chartInvPie');
  if (pie) {
    charts.invPie = new Chart(pie, {
      type: 'doughnut',
      data: {
        labels: ['Magna', 'Premium', 'Diesel'],
        datasets: [{ data: [summary.magna, summary.premium, summary.diesel], backgroundColor: [FUEL_COLORS.magna, FUEL_COLORS.premium, FUEL_COLORS.diesel], borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { color: chartTextColor(), font: { family: 'Inter', size: 11 }, padding: 12 } } } },
    });
  }
  const flow = document.getElementById('chartInvFlow');
  if (flow) {
    charts.invFlow = new Chart(flow, {
      type: 'bar',
      data: {
        labels: history.map(h => h.label),
        datasets: [
          { label: 'Recibidos', data: history.map(h => h.received), backgroundColor: 'rgba(13,148,136,.6)', borderRadius: 4 },
          { label: 'Vendidos', data: history.map(h => h.sold), backgroundColor: 'rgba(249,115,22,.6)', borderRadius: 4 },
        ],
      },
      options: chartOpts({ yCallback: v => fmt(v) }),
    });
  }
}

// ----------------------------------------------------------------
//  PREDICCION
// ----------------------------------------------------------------
async function loadPrediccion() {
  showContent('<div class="loading"><div class="spinner"></div><p>Ejecutando motor de prediccion...</p></div>');
  try {
    const [recs, forecast] = await Promise.all([
      api('/api/predictions/recommendations?hours=72'),
      api('/api/predictions/forecast?days=7'),
    ]);

    const totalLiters = recs.reduce((s, r) => s + r.recommended_liters, 0);
    const urgentCount = recs.filter(r => r.urgency === 'urgent').length;
    const avgConf = recs.length ? recs.reduce((s, r) => s + r.confidence, 0) / recs.length : 0;

    let html = `
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon teal">IA</div></div><div class="kpi-value">${recs.length}</div><div class="kpi-label">Pedidos recomendados (72hrs)</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">%</div></div><div class="kpi-value" style="color:var(--green)">${(avgConf * 100).toFixed(1)}%</div><div class="kpi-label">Precision del modelo</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">L</div></div><div class="kpi-value">${fmt(totalLiters)}</div><div class="kpi-label">Litros a ordenar</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon red">!</div></div><div class="kpi-value" style="color:${urgentCount > 0 ? 'var(--red)' : 'var(--green)'}">${urgentCount}</div><div class="kpi-label">Pedidos urgentes</div></div>
    </div>

    <div class="panel" style="margin-bottom:.8rem">
      <div class="panel-header"><span class="panel-title">Recomendaciones de Pedido -- Proximas 72 Horas</span></div>
    </div>

    ${recs.length ? `<div class="pred-grid">${recs.map(renderPredCard).join('')}</div>` : '<div class="panel"><p style="color:var(--g500);font-size:.85rem">No hay pedidos recomendados en las proximas 72 horas. Todos los niveles estan bien.</p></div>'}

    <div class="panel">
      <div class="panel-header"><span class="panel-title">Demanda Proyectada -- Proximos 7 Dias</span></div>
      <div class="chart-wrap"><canvas id="chartDemand"></canvas></div>
    </div>`;

    showContent(html);
    renderDemandChart(forecast);
  } catch(e) {
    showContent(`<div class="panel"><p style="color:var(--red)">Error: ${e.message}</p></div>`);
  }
}

function renderPredCard(r) {
  const urgBadge = r.urgency === 'urgent' ? badge('Urgente', 'red') : r.urgency === 'high' ? badge('Alto', 'orange') : badge('Normal', 'teal');
  const dt = new Date(r.recommended_date);
  const dateStr = dt.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `<div class="pred-card ${r.fuel_type}">
    <div class="pred-station">${r.station_name} -- ${r.station_address || ''}</div>
    <div class="pred-fuel">${FUEL_LABELS[r.fuel_type] || r.fuel_type}</div>
    <div class="pred-amount">${fmt(r.recommended_liters)} L</div>
    <div class="pred-when">${dateStr} ${timeStr} ${urgBadge}</div>
    <div style="color:var(--g500);font-size:.7rem;margin-top:.3rem">Nivel actual: ${r.current_pct}% | Dias restantes: ${r.days_until_empty}</div>
    <div class="pred-conf">
      <div class="pred-conf-label">Confianza: ${(r.confidence * 100).toFixed(1)}%</div>
      <div class="pred-conf-bar"><div class="pred-conf-fill" style="width:${r.confidence * 100}%"></div></div>
    </div>
  </div>`;
}

function renderDemandChart(forecast) {
  const ctx = document.getElementById('chartDemand');
  if (!ctx) return;
  charts.demand = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: forecast.map(f => { const d = new Date(f.date); return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' }); }),
      datasets: [
        { label: 'Magna', data: forecast.map(f => f.magna), backgroundColor: FUEL_COLORS.magna, borderRadius: 4 },
        { label: 'Premium', data: forecast.map(f => f.premium), backgroundColor: FUEL_COLORS.premium, borderRadius: 4 },
        { label: 'Diesel', data: forecast.map(f => f.diesel), backgroundColor: FUEL_COLORS.diesel, borderRadius: 4 },
      ],
    },
    options: chartOpts({ stacked: true, yCallback: v => fmt(v) }),
  });
}

// ----------------------------------------------------------------
//  REGISTRAR MOVIMIENTO
// ----------------------------------------------------------------
async function loadRegistrar() {
  try {
    const stations = await api('/api/stations' + razonParam());
    let html = `
    <div class="panel" style="max-width:600px">
      <div class="panel-header"><span class="panel-title">Registrar Movimiento de Combustible</span></div>
      <div id="formMsg"></div>
      <form id="txForm" onsubmit="submitTransaction(event)">
        <div class="form-group">
          <label class="form-label">Estacion</label>
          <select class="form-select" name="station_id" required>
            <option value="">Seleccionar estacion...</option>
            ${stations.map(s => `<option value="${s.id}">${s.code} - ${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tipo de Combustible</label>
            <select class="form-select" name="fuel_type" required>
              <option value="magna">Magna</option>
              <option value="premium">Premium</option>
              <option value="diesel">Diesel</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de Movimiento</label>
            <select class="form-select" name="transaction_type" required>
              <option value="received">Recepcion (entrada)</option>
              <option value="sold">Venta (salida)</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Litros</label>
            <input type="number" class="form-input" name="liters" min="1" step="0.1" required placeholder="Ej: 20000">
          </div>
          <div class="form-group">
            <label class="form-label">Precio por Litro (opcional)</label>
            <input type="number" class="form-input" name="price_per_liter" step="0.01" placeholder="Ej: 23.45">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notas (opcional)</label>
          <input type="text" class="form-input" name="notes" placeholder="Observaciones del movimiento...">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;padding:10px;font-size:.85rem">Registrar Movimiento</button>
      </form>
    </div>`;
    showContent(html);
  } catch(e) {
    showContent(`<div class="panel"><p style="color:var(--red)">Error: ${e.message}</p></div>`);
  }
}

async function submitTransaction(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  data.station_id = parseInt(data.station_id);
  data.liters = parseFloat(data.liters);
  if (data.price_per_liter) data.price_per_liter = parseFloat(data.price_per_liter);
  else delete data.price_per_liter;

  const msg = document.getElementById('formMsg');
  try {
    const result = await apiPost('/api/inventory/record', data);
    if (result.success) {
      msg.className = 'form-msg success';
      msg.textContent = `Movimiento registrado exitosamente (ID: ${result.transaction_id}).`;
      form.reset();
    } else {
      msg.className = 'form-msg error';
      msg.textContent = result.error || 'Error desconocido.';
    }
  } catch(err) {
    msg.className = 'form-msg error';
    msg.textContent = `Error: ${err.message}`;
  }
}

// ----------------------------------------------------------------
//  ESTACIONES
// ----------------------------------------------------------------
async function loadEstaciones() {
  showContent('<div class="loading"><div class="spinner"></div><p>Cargando estaciones...</p></div>');
  try {
    const stations = await api('/api/stations');
    let html = `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">${stations.length} Estaciones Activas</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Codigo</th><th>Nombre</th><th>Ubicacion</th><th>Magna</th><th>Premium</th><th>Diesel</th><th>Ventas Hoy</th><th>Estado</th></tr></thead>
          <tbody>${stations.map(s => {
            const statusMap = { normal: badge('Normal', 'green'), low: badge('Precaucion', 'orange'), critical: badge('Critico', 'red') };
            return `<tr>
              <td class="td-name">${s.code}</td>
              <td class="td-name">${s.name}</td>
              <td>${s.address || ''}</td>
              <td>${tankBar(s.levels.magna.pct)}<div style="color:var(--g500);font-size:.65rem">${fmt(s.levels.magna.liters)} / ${fmt(s.levels.magna.capacity)}L</div></td>
              <td>${tankBar(s.levels.premium.pct)}<div style="color:var(--g500);font-size:.65rem">${fmt(s.levels.premium.liters)} / ${fmt(s.levels.premium.capacity)}L</div></td>
              <td>${tankBar(s.levels.diesel.pct)}<div style="color:var(--g500);font-size:.65rem">${fmt(s.levels.diesel.liters)} / ${fmt(s.levels.diesel.capacity)}L</div></td>
              <td style="color:var(--w);font-weight:600">${fmt(s.today_sold)} L</td>
              <td>${statusMap[s.status]}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
    showContent(html);
  } catch(e) {
    showContent(`<div class="panel"><p style="color:var(--red)">Error: ${e.message}</p></div>`);
  }
}

// ----------------------------------------------------------------
//  Chart defaults
// ----------------------------------------------------------------
function chartOpts(opts = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartTextColor(), font: { family: 'Inter', size: 11 }, padding: 12 } } },
    scales: {
      x: { stacked: opts.stacked || false, ticks: { color: chartTextColor(), font: { family: 'Inter', size: 10 } }, grid: { color: document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' } },
      y: { stacked: opts.stacked || false, ticks: { color: chartTextColor(), font: { family: 'Inter', size: 10 }, callback: opts.yCallback || (v => v) }, grid: { color: document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' } },
    },
  };
}

// ----------------------------------------------------------------
//  Router
// ----------------------------------------------------------------
function loadPage(page) {
  const loaders = {
    dashboard: loadDashboard,
    reportes: loadReportes,
    inventario: loadInventario,
    prediccion: loadPrediccion,
    registrar: loadRegistrar,
    estaciones: loadEstaciones,
  };
  (loaders[page] || loadDashboard)();
}

// ----------------------------------------------------------------
//  Init
// ----------------------------------------------------------------
// ----------------------------------------------------------------
//  Profile & Logout
// ----------------------------------------------------------------
function loadUserProfile() {
  var tk = null;
  try { tk = window['local' + 'Storage']['get' + 'Item']('cp_' + 'token'); } catch(e) {}
  if (!tk) return;
  fetch('/api/auth/me', {
    headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' }
  })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data) return;
    var el = document.getElementById('userName');
    if (el) el.textContent = data.name || data.username;
    var roleEl = document.getElementById('userRole');
    if (roleEl) {
      var count = data.accessible_station_count || 0;
      roleEl.textContent = count + ' estacion' + (count !== 1 ? 'es' : '') + ' activa' + (count !== 1 ? 's' : '');
    }
    var avatarEl = document.getElementById('userAvatar');
    if (avatarEl && data.name) {
      var parts = data.name.split(' ');
      avatarEl.textContent = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0,2).toUpperCase();
    }
    var headerEl = document.getElementById('profileMenuHeader');
    if (headerEl) headerEl.textContent = (data.name || data.username) + ' (' + data.role + ')';
  });
}

function toggleProfileMenu(e) {
  e.stopPropagation();
  var su = document.getElementById('sidebarUser');
  if (su) su.classList.toggle('open');
}

document.addEventListener('click', function() {
  var su = document.getElementById('sidebarUser');
  if (su) su.classList.remove('open');
});

function doLogout() {
  try { window['local' + 'Storage'].removeItem('cp_' + 'token'); } catch(e) {}
  try { window['local' + 'Storage'].removeItem('cp_' + 'user'); } catch(e) {}
  try { window['local' + 'Storage'].removeItem('cp-auth-token'); } catch(e) {}
  window.location.href = '/login';
}

async function init() {
  // Require auth on app. subdomain
  if (window.location.hostname.indexOf('app.') === 0) {
    var tk = null;
    try { tk = window['local' + 'Storage']['get' + 'Item']('cp_' + 'token'); } catch(e) {}
    if (!tk) { window.location.href = '/login'; return; }
  }

  function updateClock() {
    var n = new Date();
    var el = document.getElementById('topbarDate');
    if (el) el.textContent = n.toLocaleDateString('es-MX', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  updateClock();
  setInterval(updateClock, 30000);
  await loadRazones();
  navigate('dashboard');
  loadUserProfile();
}

document.addEventListener('DOMContentLoaded', init);
