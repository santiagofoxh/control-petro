/* Control Petro - Frontend Application */

const API = '';
const FUEL_LABELS = { magna: 'Magna', premium: 'Premium', diesel: 'Diesel' };
const FUEL_COLORS = { magna: '#22c55e', premium: '#ef4444', diesel: '#eab308' };
let charts = {};
let currentPage = 'dashboard';
let _selectedRazonId = '';  // '' = all razones
let _razonesList = [];
let _reportFormat = 'sat';
let _outputFormat = 'xml';
let _periodType = 'diario';
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
    comercializadora: 'Comercializadora',
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
      <p style="color:var(--g400);font-size:.78rem;margin-bottom:.8rem">Sube tus datos operativos y Loti genera el reporte en XML o JSON (según Anexo 21 del SAT) validado y listo para enviar al SAT o CNE vía el portal de controles volumétricos.</p>
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

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.6rem">
          <div class="form-group" style="margin:0">
            <label class="form-label">Formato de Salida</label>
            <div id="xmlOutputFormatToggle" style="display:flex;gap:0;border:1px solid var(--g600);border-radius:6px;overflow:hidden;width:fit-content">
              <button type="button" onclick="setOutputFormat('xml')" id="outFmtXml" class="fmt-btn fmt-active" style="padding:6px 16px;border:none;font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">XML</button>
              <button type="button" onclick="setOutputFormat('json')" id="outFmtJson" class="fmt-btn" style="padding:6px 16px;border:none;border-left:1px solid var(--g600);font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">JSON</button>
            </div>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Periodo</label>
            <div id="xmlPeriodToggle" style="display:flex;gap:0;border:1px solid var(--g600);border-radius:6px;overflow:hidden;width:fit-content">
              <button type="button" onclick="setPeriodType('diario')" id="perDiario" class="fmt-btn fmt-active" style="padding:6px 16px;border:none;font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">Diario</button>
              <button type="button" onclick="setPeriodType('mensual')" id="perMensual" class="fmt-btn" style="padding:6px 16px;border:none;border-left:1px solid var(--g600);font-size:.75rem;cursor:pointer;font-weight:600;font-family:Inter,sans-serif;transition:all .15s">Mensual</button>
            </div>
          </div>
        </div>

        <div id="xmlMonthlySelector" style="display:none;margin-bottom:.6rem;padding:.6rem;background:rgba(13,148,136,.06);border-radius:8px;border:1px solid rgba(13,148,136,.15)">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem">
            <div class="form-group" style="margin:0">
              <label class="form-label">Mes</label>
              <select class="form-select" id="xmlReportMonth">
                <option value="1">Enero</option><option value="2">Febrero</option><option value="3">Marzo</option>
                <option value="4">Abril</option><option value="5">Mayo</option><option value="6">Junio</option>
                <option value="7">Julio</option><option value="8">Agosto</option><option value="9">Septiembre</option>
                <option value="10">Octubre</option><option value="11">Noviembre</option><option value="12">Diciembre</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Ano</label>
              <select class="form-select" id="xmlReportYear">
                <option value="2025">2025</option><option value="2026" selected>2026</option><option value="2027">2027</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Estacion</label>
              <select class="form-select" id="xmlMonthlyStation"></select>
            </div>
          </div>
          <p style="color:var(--g400);font-size:.7rem;margin:.4rem 0 0">Genera el reporte mensual agregando los datos diarios almacenados en la base de datos.</p>
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
            Generar SAT (XML)
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
  showDownloadModal(id);
}

function showDownloadModal(id, filename) {
  var overlay = document.createElement('div');
  overlay.id = 'downloadModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);animation:fadeIn .2s ease';
  overlay.innerHTML = '<div style="background:var(--g900,#1a1a2e);border:1px solid var(--teal,#0D9488);border-radius:12px;padding:2rem;max-width:420px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
    '<div style="width:56px;height:56px;border-radius:50%;background:rgba(13,148,136,.15);display:flex;align-items:center;justify-content:center;margin:0 auto .8rem"><svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#0D9488" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div>' +
    '<h3 style="color:var(--w,#fff);margin:0 0 .4rem;font-size:1.1rem">Reporte Listo</h3>' +
    '<p style="color:var(--g400,#9ca3af);font-size:.82rem;margin:0 0 1.2rem">Tu reporte ha sido generado exitosamente y está listo para descargar.</p>' +
    '<div style="display:flex;gap:.6rem;justify-content:center">' +
    '<a href="/api/reports/download/' + id + '" download class="btn btn-primary" style="background:var(--teal,#0D9488);padding:10px 28px;text-decoration:none;font-size:.85rem;border-radius:8px;display:inline-flex;align-items:center;gap:6px"><svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Descargar</a>' +
    '<button class="btn btn-outline" onclick="dismissDownloadModal()" style="padding:10px 20px;font-size:.85rem;border-radius:8px">Cerrar</button>' +
    '</div></div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismissDownloadModal(); });
  document.body.appendChild(overlay);
}

function dismissDownloadModal() {
  var m = document.getElementById('downloadModal');
  if (m) m.remove();
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
    // Fetch stations list for the station selector
    const stationsList = await api('/api/stations');

    const formData = new FormData();
    formData.append('file', uploadedFile);
    const allHeaders = getApiHeaders();
    const extractHeaders = {};
    // Only pass Authorization for file uploads — Content-Type must be auto-set for multipart
    if (allHeaders['Authorization']) extractHeaders['Authorization'] = allHeaders['Authorization'];

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

    // Always show visual review UI for user confirmation
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

    // Calculate summary stats
    const fechaVal = ed.fecha || new Date().toISOString().split('T')[0];
    const totalRecibidos = recepciones.reduce((sum, r) => sum + (parseFloat(r.litros) || 0), 0);
    const totalVendidos = entregas.reduce((sum, e) => sum + (parseFloat(e.litros) || 0), 0);
    const fuelBreakdown = {};
    tanques.forEach(t => {
      const prod = (t.producto || 'magna').toLowerCase();
      if (!fuelBreakdown[prod]) fuelBreakdown[prod] = { recibidos: 0, vendidos: 0, invFinal: 0 };
      fuelBreakdown[prod].invFinal += parseFloat(t.inventario_final) || 0;
    });
    recepciones.forEach(r => {
      const tank = tanques.find(t => t.nombre === r.tanque);
      const prod = tank ? (tank.producto || 'magna').toLowerCase() : 'magna';
      if (!fuelBreakdown[prod]) fuelBreakdown[prod] = { recibidos: 0, vendidos: 0, invFinal: 0 };
      fuelBreakdown[prod].recibidos += parseFloat(r.litros) || 0;
    });
    entregas.forEach(e => {
      const tank = tanques.find(t => t.nombre === e.tanque);
      const prod = tank ? (tank.producto || 'magna').toLowerCase() : 'magna';
      if (!fuelBreakdown[prod]) fuelBreakdown[prod] = { recibidos: 0, vendidos: 0, invFinal: 0 };
      fuelBreakdown[prod].vendidos += parseFloat(e.litros) || 0;
    });

    // Build stations options for selector
    const stationsOpts = stationsList.map(s => `<option value="${s.id}">${s.code} - ${s.name}</option>`).join('');

    // Fuel breakdown mini-cards
    const fuelColors = { magna: '#22c55e', premium: '#ef4444', diesel: '#eab308' };
    const fuelLabels = { magna: 'Magna', premium: 'Premium', diesel: 'Diesel' };
    const fuelCardsHtml = Object.keys(fuelBreakdown).map(fuel => {
      const fb = fuelBreakdown[fuel];
      return `<div style="flex:1;min-width:120px;background:rgba(${fuel === 'magna' ? '34,197,94' : fuel === 'premium' ? '239,68,68' : '234,179,8'},.08);border:1px solid ${fuelColors[fuel]}30;border-radius:8px;padding:.5rem .6rem">
        <div style="font-size:.68rem;font-weight:700;color:${fuelColors[fuel]};text-transform:uppercase;letter-spacing:.5px;margin-bottom:.3rem">${fuelLabels[fuel] || fuel}</div>
        <div style="display:flex;flex-direction:column;gap:.15rem">
          ${fb.recibidos > 0 ? `<div style="font-size:.72rem;color:var(--g300)"><span style="color:var(--green)">&#9650;</span> ${fb.recibidos.toLocaleString()}L recibidos</div>` : ''}
          ${fb.vendidos > 0 ? `<div style="font-size:.72rem;color:var(--g300)"><span style="color:var(--orange)">&#9660;</span> ${fb.vendidos.toLocaleString()}L vendidos</div>` : ''}
          ${fb.invFinal > 0 ? `<div style="font-size:.72rem;color:var(--g300)">&#9632; ${fb.invFinal.toLocaleString()}L inv. final</div>` : ''}
        </div>
      </div>`;
    }).join('');

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div style="border-radius:12px;overflow:hidden;border:1px solid var(--teal)">

        <!-- HEADER: Source + Confidence -->
        <div style="background:linear-gradient(135deg, rgba(13,148,136,.15), rgba(13,148,136,.05));padding:.7rem .9rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.4rem;border-bottom:1px solid rgba(13,148,136,.2)">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <span style="font-size:1.1rem">&#128196;</span>
            <span style="color:var(--w);font-size:.82rem;font-weight:600">Datos Extraidos</span>
            <span style="color:var(--g400);font-size:.73rem">de <strong>${uploadedFile.name}</strong></span>
          </div>
          <div style="display:flex;align-items:center;gap:.4rem">
            <span style="background:${confColor};color:#000;font-weight:700;padding:3px 12px;border-radius:12px;font-size:.72rem">
              ${confidence}/100
            </span>
            <span style="color:var(--g400);font-size:.7rem">Confianza ${confLabel}</span>
            ${tokensHtml}
          </div>
        </div>

        <!-- SUMMARY CARDS ROW -->
        <div style="padding:.7rem .9rem;background:rgba(0,0,0,.15);border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="display:flex;gap:.5rem;margin-bottom:.5rem">
            <div style="flex:1;background:rgba(13,148,136,.1);border:1px solid rgba(13,148,136,.25);border-radius:8px;padding:.5rem .6rem;text-align:center">
              <div style="font-size:1.3rem;font-weight:700;color:var(--teal)">${tanques.length}</div>
              <div style="font-size:.68rem;color:var(--g400);font-weight:500">Tanques</div>
            </div>
            <div style="flex:1;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);border-radius:8px;padding:.5rem .6rem;text-align:center">
              <div style="font-size:1.3rem;font-weight:700;color:var(--green)">${totalRecibidos.toLocaleString()}L</div>
              <div style="font-size:.68rem;color:var(--g400);font-weight:500">Total Recibido</div>
            </div>
            <div style="flex:1;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.25);border-radius:8px;padding:.5rem .6rem;text-align:center">
              <div style="font-size:1.3rem;font-weight:700;color:var(--orange)">${totalVendidos.toLocaleString()}L</div>
              <div style="font-size:.68rem;color:var(--g400);font-weight:500">Total Vendido</div>
            </div>
            <div style="flex:1;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.25);border-radius:8px;padding:.5rem .6rem;text-align:center">
              <div style="font-size:1.3rem;font-weight:700;color:#818cf8">${fechaVal}</div>
              <div style="font-size:.68rem;color:var(--g400);font-weight:500">Fecha Operacion</div>
            </div>
          </div>
          <!-- Fuel breakdown mini-cards -->
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">${fuelCardsHtml}</div>
        </div>

        ${notesHtml ? `<div style="padding:.5rem .9rem;border-bottom:1px solid rgba(255,255,255,.05)">${notesHtml}</div>` : ''}

        <!-- EDITABLE DATA TABLES -->
        <div style="padding:.7rem .9rem">
          <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.4rem">
            <span style="font-size:.85rem">&#128203;</span>
            <span style="color:var(--w);font-size:.78rem;font-weight:600">Detalle de Datos (editable)</span>
            <span style="color:var(--g500);font-size:.68rem;margin-left:auto">Haz clic en cualquier campo para editar</span>
          </div>

          <div style="color:var(--teal);font-size:.74rem;font-weight:600;margin-bottom:.3rem;margin-top:.3rem">Tanques</div>
          <div class="table-wrap" style="margin-bottom:.5rem">
            <table style="font-size:.72rem">
              <thead><tr><th>Tanque</th><th>Producto</th><th>Capacidad (L)</th><th>Inv. Inicial</th><th>Inv. Final</th><th>OK</th></tr></thead>
              <tbody>${tanquesRows || '<tr><td colspan="6" style="color:var(--g500);text-align:center">No se detectaron tanques</td></tr>'}</tbody>
            </table>
          </div>

          ${recepciones.length > 0 ? `<div style="color:var(--green);font-size:.74rem;font-weight:600;margin-bottom:.3rem">&#9650; Recepciones</div>
          <div class="table-wrap" style="margin-bottom:.5rem">
            <table style="font-size:.72rem">
              <thead><tr><th>Tanque</th><th>Litros</th><th>Proveedor</th><th>Factura</th><th>$/L</th><th>OK</th></tr></thead>
              <tbody>${recepRows}</tbody>
            </table>
          </div>` : ''}

          ${entregas.length > 0 ? `<div style="color:var(--orange);font-size:.74rem;font-weight:600;margin-bottom:.3rem">&#9660; Entregas / Ventas</div>
          <div class="table-wrap" style="margin-bottom:.5rem">
            <table style="font-size:.72rem">
              <thead><tr><th>Tanque</th><th>Litros</th><th>Dispensario</th><th>OK</th></tr></thead>
              <tbody>${entregRows}</tbody>
            </table>
          </div>` : ''}
        </div>

        <!-- DATA DESTINATION SECTION -->
        <div style="padding:.7rem .9rem;background:rgba(0,0,0,.15);border-top:1px solid rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.05)">
          <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem">
            <span style="font-size:.85rem">&#127919;</span>
            <span style="color:var(--w);font-size:.78rem;font-weight:600">Destino de los Datos</span>
          </div>
          <div style="display:flex;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap">
            <div style="flex:1;min-width:140px;background:rgba(13,148,136,.08);border:1px solid rgba(13,148,136,.2);border-radius:8px;padding:.5rem;display:flex;align-items:flex-start;gap:.4rem">
              <span style="font-size:1rem;line-height:1">&#128202;</span>
              <div>
                <div style="font-size:.73rem;font-weight:600;color:var(--teal)">Reporte XML SAT/CNE</div>
                <div style="font-size:.66rem;color:var(--g400)">Se generara automaticamente el XML validado listo para subir al portal del SAT</div>
              </div>
            </div>
            <div style="flex:1;min-width:140px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:8px;padding:.5rem;display:flex;align-items:flex-start;gap:.4rem">
              <span style="font-size:1rem;line-height:1">&#128200;</span>
              <div>
                <div style="font-size:.73rem;font-weight:600;color:var(--green)">Dashboard</div>
                <div style="font-size:.66rem;color:var(--g400)">Los KPIs de litros vendidos y recibidos se actualizaran en tiempo real</div>
              </div>
            </div>
            <div style="flex:1;min-width:140px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);border-radius:8px;padding:.5rem;display:flex;align-items:flex-start;gap:.4rem">
              <span style="font-size:1rem;line-height:1">&#128230;</span>
              <div>
                <div style="font-size:.73rem;font-weight:600;color:#818cf8">Inventario</div>
                <div style="font-size:.66rem;color:var(--g400)">Los niveles de tanques se actualizaran con los inventarios finales extraidos</div>
              </div>
            </div>
            <div style="flex:1;min-width:140px;background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.15);border-radius:8px;padding:.5rem;display:flex;align-items:flex-start;gap:.4rem">
              <span style="font-size:1rem;line-height:1">&#129504;</span>
              <div>
                <div style="font-size:.73rem;font-weight:600;color:var(--orange)">Prediccion IA</div>
                <div style="font-size:.66rem;color:var(--g400)">Las recomendaciones de pedido se recalcularan con estos nuevos datos</div>
              </div>
            </div>
          </div>

          <!-- Station selector -->
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:.5rem .6rem">
            <label style="font-size:.73rem;font-weight:600;color:var(--w);display:block;margin-bottom:.3rem">Selecciona la Estacion</label>
            <select class="form-select" id="ext_station_id" style="font-size:.78rem;padding:6px 10px;width:100%">
              <option value="">-- Solo generar reporte XML (no guardar en base de datos) --</option>
              ${stationsOpts}
            </select>
            <p style="color:var(--g500);font-size:.66rem;margin:.3rem 0 0">Si seleccionas una estacion, los datos se guardaran en el dashboard, inventario y predicciones automaticamente.</p>
          </div>
        </div>

        <!-- CONFIRMATION FOOTER -->
        <div style="padding:.7rem .9rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="confirmExtractedData()" style="background:var(--green);padding:10px 28px;font-size:.82rem;font-weight:600;border-radius:8px;display:flex;align-items:center;gap:.4rem">
            <span style="font-size:1rem">&#10003;</span> Confirmar y Procesar
          </button>
          <button class="btn btn-outline" onclick="extractFromDocument()" style="padding:8px 16px;font-size:.78rem;border-radius:8px">
            &#8635; Re-analizar
          </button>
          <span style="color:var(--g500);font-size:.68rem;margin-left:auto">Los campos marcados con &#x26A0; pueden requerir revision manual</span>
        </div>
      </div>`;
  } catch(e) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<div class="form-msg error">${e.message}</div>`;
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
  }
}

async function confirmExtractedData() {
  if (!extractedData) {
    alert('No hay datos extraidos. Analiza un documento primero.');
    return;
  }

  // Read edited values from the review tables
  const tanques = extractedData.tanques || [];
  const recepciones = extractedData.recepciones || [];
  const entregas = extractedData.entregas || [];

  const fecha = document.getElementById('xmlFecha').value;
  const stationSelect = document.getElementById('ext_station_id');
  const stationId = stationSelect ? parseInt(stationSelect.value) : null;
  const stationLabel = stationSelect && stationId ? stationSelect.options[stationSelect.selectedIndex].text : null;

  // Show processing overlay in the result area
  const resultDiv = document.getElementById('xmlExtractResult');
  const confirmBtn = resultDiv.querySelector('.btn-primary');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;margin-right:6px"></span> Procesando...';
  }

  // Build status tracker HTML
  const statusTracker = document.createElement('div');
  statusTracker.id = 'confirmStatusTracker';
  statusTracker.style.cssText = 'margin-top:.6rem;padding:.6rem .8rem;background:rgba(0,0,0,.2);border-radius:8px;border:1px solid rgba(255,255,255,.06)';
  statusTracker.innerHTML = `
    <div style="font-size:.76rem;font-weight:600;color:var(--w);margin-bottom:.4rem">Procesando datos...</div>
    <div id="status_rawdata" style="display:flex;align-items:center;gap:.4rem;padding:.2rem 0;font-size:.72rem;color:var(--g400)">
      <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block"></span>
      Preparando datos operativos...
    </div>
    ${stationId ? `
    <div id="status_transactions" style="display:flex;align-items:center;gap:.4rem;padding:.2rem 0;font-size:.72rem;color:var(--g500)">
      <span style="font-size:.8rem">&#9711;</span>
      Guardando transacciones en Dashboard...
    </div>
    <div id="status_inventory" style="display:flex;align-items:center;gap:.4rem;padding:.2rem 0;font-size:.72rem;color:var(--g500)">
      <span style="font-size:.8rem">&#9711;</span>
      Actualizando niveles de Inventario...
    </div>
    <div id="status_predictions" style="display:flex;align-items:center;gap:.4rem;padding:.2rem 0;font-size:.72rem;color:var(--g500)">
      <span style="font-size:.8rem">&#9711;</span>
      Recalculando Predicciones IA...
    </div>
    ` : ''}
    <div id="status_xml" style="display:flex;align-items:center;gap:.4rem;padding:.2rem 0;font-size:.72rem;color:var(--g500)">
      <span style="font-size:.8rem">&#9711;</span>
      Generando reporte SAT/CNE...
    </div>
  `;
  const footer = resultDiv.querySelector('div:last-child');
  if (footer) footer.parentNode.insertBefore(statusTracker, footer);

  function updateStatus(id, state, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (state === 'working') {
      el.style.color = 'var(--g300)';
      el.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block"></span> ${msg || el.textContent}`;
    } else if (state === 'done') {
      el.style.color = 'var(--green)';
      el.innerHTML = `<span style="font-size:.8rem">&#10004;</span> ${msg || el.textContent}`;
    } else if (state === 'error') {
      el.style.color = 'var(--red)';
      el.innerHTML = `<span style="font-size:.8rem">&#10008;</span> ${msg || el.textContent}`;
    }
  }

  // STEP 1: Build raw data text
  let rawLines = [];
  rawLines.push(`FECHA: ${fecha}`);
  rawLines.push('');

  const dbTransactions = [];
  const dbInventoryReadings = [];

  tanques.forEach((t, i) => {
    const nombre = (document.getElementById(`ext_tq_nombre_${i}`) || {}).value || t.nombre;
    const prod = (document.getElementById(`ext_tq_prod_${i}`) || {}).value || t.producto;
    const cap = (document.getElementById(`ext_tq_cap_${i}`) || {}).value || t.capacidad_litros;
    const ini = (document.getElementById(`ext_tq_ini_${i}`) || {}).value || t.inventario_inicial;
    const fin = (document.getElementById(`ext_tq_fin_${i}`) || {}).value || t.inventario_final;

    rawLines.push(`TANQUE ${nombre} (${prod.toUpperCase()}):`);
    rawLines.push(`  Capacidad: ${cap}L`);
    rawLines.push(`  Inventario Inicial: ${ini}L`);

    if (fin && prod) {
      dbInventoryReadings.push({
        fuel_type: prod.toLowerCase(),
        liters_on_hand: parseFloat(fin) || 0
      });
    }

    recepciones.forEach((r, j) => {
      const rTq = (document.getElementById(`ext_rec_tq_${j}`) || {}).value || r.tanque;
      if (rTq === nombre || rTq === t.nombre) {
        const litros = (document.getElementById(`ext_rec_litros_${j}`) || {}).value || r.litros;
        const prov = (document.getElementById(`ext_rec_prov_${j}`) || {}).value || r.proveedor;
        const fact = (document.getElementById(`ext_rec_fact_${j}`) || {}).value || r.num_factura;
        const precio = (document.getElementById(`ext_rec_precio_${j}`) || {}).value || r.precio_litro;
        rawLines.push(`  Recepcion: ${litros}L (Factura ${fact}, Proveedor: ${prov}, RFC: ${r.rfc_proveedor || 'N/A'})`);
        rawLines.push(`  Precio por litro: $${precio}`);
        dbTransactions.push({
          fuel_type: prod.toLowerCase(),
          transaction_type: 'received',
          liters: parseFloat(litros) || 0,
          price_per_liter: parseFloat(precio) || null,
          timestamp: fecha + 'T08:00:00',
          notes: `Factura ${fact}, Proveedor: ${prov}`
        });
      }
    });

    let totalEntregas = 0;
    entregas.forEach((e, j) => {
      const eTq = (document.getElementById(`ext_ent_tq_${j}`) || {}).value || e.tanque;
      if (eTq === nombre || eTq === t.nombre) {
        const litros = (document.getElementById(`ext_ent_litros_${j}`) || {}).value || e.litros;
        const disp = (document.getElementById(`ext_ent_disp_${j}`) || {}).value || e.dispensario;
        totalEntregas += parseFloat(litros) || 0;
        rawLines.push(`  Litros Vendidos: ${litros}L via ${disp}`);
        dbTransactions.push({
          fuel_type: prod.toLowerCase(),
          transaction_type: 'sold',
          liters: parseFloat(litros) || 0,
          timestamp: fecha + 'T18:00:00',
          notes: `Dispensario: ${disp}`
        });
      }
    });

    rawLines.push(`  Inventario Final: ${fin}L`);
    if (t.temperatura) rawLines.push(`  Temperatura promedio: ${t.temperatura}°C`);
    rawLines.push('');
  });

  // Set raw data
  const rawDataEl = document.getElementById('xmlRawData');
  if (rawDataEl) rawDataEl.value = rawLines.join('\n');
  document.getElementById('xmlSource').value = 'manual';
  toggleXmlDataSource();

  updateStatus('status_rawdata', 'done', 'Datos operativos preparados');

  // STEP 2: Save to database if station selected
  if (stationId && dbTransactions.length > 0) {
    try {
      updateStatus('status_transactions', 'working', `Guardando ${dbTransactions.length} transacciones en Dashboard...`);
      const txnResult = await apiPost('/api/ingest/transactions', {
        station_id: stationId,
        transactions: dbTransactions
      });
      updateStatus('status_transactions', 'done', `${txnResult.created_count || dbTransactions.length} transacciones guardadas en Dashboard`);

      if (dbInventoryReadings.length > 0) {
        updateStatus('status_inventory', 'working', 'Actualizando niveles de Inventario...');
        await apiPost('/api/ingest/inventory', {
          station_id: stationId,
          readings: dbInventoryReadings,
          snapshot_date: fecha
        });
        updateStatus('status_inventory', 'done', `${dbInventoryReadings.length} lecturas de inventario actualizadas`);
      } else {
        updateStatus('status_inventory', 'done', 'Sin lecturas de inventario para actualizar');
      }

      updateStatus('status_predictions', 'done', 'Predicciones se recalcularan automaticamente');

    } catch (dbErr) {
      console.warn('DB save error:', dbErr);
      updateStatus('status_transactions', 'error', `Error guardando: ${dbErr.message}`);
      updateStatus('status_inventory', 'error', 'Omitido por error previo');
      updateStatus('status_predictions', 'error', 'Omitido por error previo');
    }
  }

  // STEP 3: Generate XML
  updateStatus('status_xml', 'working', 'Generando reporte XML SAT/CNE con IA...');
  try {
    await generateSatXml();
    updateStatus('status_xml', 'done', 'Reporte XML generado exitosamente');
  } catch (xmlErr) {
    updateStatus('status_xml', 'error', `Error generando XML: ${xmlErr.message}`);
  }

  // Show final success summary
  const tracker = document.getElementById('confirmStatusTracker');
  if (tracker) {
    const successBanner = document.createElement('div');
    successBanner.style.cssText = 'margin-top:.5rem;padding:.5rem .6rem;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:6px;display:flex;align-items:center;gap:.4rem';
    successBanner.innerHTML = `
      <span style="font-size:1.2rem">&#10004;</span>
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--green)">Procesamiento completado</div>
        <div style="font-size:.68rem;color:var(--g400)">${stationId ? `Datos guardados para ${stationLabel}. ` : ''}Revisa el resultado del reporte XML arriba.</div>
      </div>
    `;
    tracker.appendChild(successBanner);
  }

  // Re-enable button
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<span style="font-size:1rem">&#10003;</span> Confirmar y Procesar';
  }
}
function setReportFormat(fmt) {
  _reportFormat = fmt;
  ['sat','cne','ambos'].forEach(f => {
    const b = document.getElementById('fmt' + f.charAt(0).toUpperCase() + f.slice(1));
    if (b) b.classList.toggle('fmt-active', f === fmt);
  });
  const btn = document.getElementById('btnGenXml');
  if (btn) {
    updateGenerateButtonLabel();
  }
}
function setOutputFormat(fmt) {
  _outputFormat = fmt;
  ['xml','json'].forEach(f => {
    const b = document.getElementById('outFmt' + f.charAt(0).toUpperCase() + f.slice(1));
    if (b) b.classList.toggle('fmt-active', f === fmt);
  });
  const btn = document.getElementById('btnGenXml');
  if (btn) updateGenerateButtonLabel();
}
function setPeriodType(period) {
  _periodType = period;
  ['diario','mensual'].forEach(p => {
    const b = document.getElementById('per' + p.charAt(0).toUpperCase() + p.slice(1));
    if (b) b.classList.toggle('fmt-active', p === period);
  });
  const monthlyDiv = document.getElementById('xmlMonthlySelector');
  const manualDiv = document.getElementById('xmlManualData');
  const uploadDiv = document.getElementById('xmlUploadData');
  const btnGen = document.getElementById('btnGenXml');
  const btnExtract = document.getElementById('btnExtract');
  if (period === 'mensual') {
    if (monthlyDiv) monthlyDiv.style.display = 'block';
    if (manualDiv) manualDiv.style.display = 'none';
    if (uploadDiv) uploadDiv.style.display = 'none';
    if (btnExtract) btnExtract.style.display = 'none';
    loadMonthlyStations();
  } else {
    if (monthlyDiv) monthlyDiv.style.display = 'none';
    toggleXmlDataSource();
    if (btnExtract) btnExtract.style.display = '';
  }
  updateGenerateButtonLabel();
}
function updateGenerateButtonLabel() {
  const btn = document.getElementById('btnGenXml');
  if (!btn) return;
  if (_periodType === 'mensual') {
    btn.textContent = 'Generar Reporte Mensual (' + _outputFormat.toUpperCase() + ')';
  } else {
    const fmtLabels = {sat:'SAT',cne:'CNE',ambos:'SAT + CNE'};
    btn.textContent = 'Generar ' + (fmtLabels[_reportFormat]||'Reporte') + ' (' + _outputFormat.toUpperCase() + ')';
  }
}
async function loadMonthlyStations() {
  const sel = document.getElementById('xmlMonthlyStation');
  if (!sel || sel.options.length > 1) return;
  try {
    const stations = await apiGet('/api/stations');
    sel.innerHTML = '';
    (stations || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
  } catch(e) { console.warn('Could not load stations:', e); }
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
    : 'Sube este .zip (XML o JSON según Anexo 21) al portal SAT: sat.gob.mx/tramites/01116';
  const sendLabel = formatLabel === 'CNE' ? 'Marcar Enviado al CNE' : 'Marcar Enviado al SAT';
  return '<div style="background:rgba(13,148,136,.1);border:1px solid var(--teal);border-radius:8px;padding:.8rem;margin-bottom:.5rem;position:relative">'
      + '<button onclick="this.parentElement.parentElement.style.display=\'none\'" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--g500);font-size:1.1rem;cursor:pointer;line-height:1;padding:2px 6px" title="Cerrar">&times;</button>'
    + '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">'
    + badge(formatLabel + ' Generado','green')
    + '<strong style="color:var(--w);font-size:.82rem">' + result.xml_filename + '</strong>' + tokens + '</div>'
    + '<div style="font-size:.72rem;color:var(--g400);margin-bottom:.5rem"><strong>Validacion:</strong> ' + (v.product_count||0) + ' productos, ' + (v.bitacora_count||0) + ' entradas bitacora</div>'
    + '<div style="font-size:.72rem;color:var(--g400)">' + products + '</div>' + warnings
    + '<div style="margin-top:.6rem;display:flex;gap:.5rem">'
    + '<a href="/api/reports/download/' + result.report_id + '" download class="btn btn-primary" style="background:var(--teal);text-decoration:none;display:inline-flex;align-items:center;gap:6px"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Descargar ' + result.zip_filename + '</a>'
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
    if (_periodType === 'mensual') {
      const stationId = document.getElementById('xmlMonthlyStation').value;
      const month = document.getElementById('xmlReportMonth').value;
      const year = document.getElementById('xmlReportYear').value;
      if (!stationId) throw new Error('Selecciona una estacion para el reporte mensual.');
      result = await apiPost('/api/sat-xml/generate-monthly', {
        station_id: stationId, month: month, year: year,
        format: _reportFormat, output_format: _outputFormat
      });
    } else if (source === 'database') {
      const fecha = document.getElementById('xmlFecha').value;
      result = await apiPost('/api/sat-xml/generate-from-db', { date: fecha, format: _reportFormat, period: _periodType, output_format: _outputFormat });
    } else {
      let rawData = document.getElementById('xmlRawData').value;

      // If source is upload and file exists but no raw data yet, auto-extract first
      if (!rawData.trim() && source === 'upload' && uploadedFile) {
        spinner.style.display = 'none';
        btn.disabled = false;
        await extractFromDocument();
        return; // extractFromDocument shows confirmation UI; user clicks "Confirmar y Procesar"
      }

      if (!rawData.trim()) {
        throw new Error(source === 'upload'
          ? 'Sube un documento primero y haz clic en "Analizar Documento con IA".'
          : 'Ingresa los datos operativos del dia.');
      }
      result = await apiPost('/api/sat-xml/generate', {
        rfc: document.getElementById('xmlRfc').value,
        num_permiso: document.getElementById('xmlPermiso').value,
        clave_instalacion: document.getElementById('xmlClave').value,
        date: document.getElementById('xmlFecha').value,
        raw_data: rawData,
        format: _reportFormat,
        period: _periodType,
        output_format: _outputFormat,
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
//  Comercializadora - Fuel Distribution Management
// ----------------------------------------------------------------
let _comercializadoraOrders = [];
let _comercializadoraSlots = [];

function loadComercializadora() {
  fetchComercializadoraData().then(() => renderComercializadora());
}

async function fetchComercializadoraData() {
  try {
    const headers = getApiHeaders();
    const [ordersResp, slotsResp] = await Promise.all([
      fetch('/api/comercializadora/orders', { headers }).then(r => r.ok ? r.json() : { orders: [] }),
      fetch('/api/comercializadora/slots', { headers }).then(r => r.ok ? r.json() : { slots: [] })
    ]);
    _comercializadoraOrders = ordersResp.orders || getDemoOrders();
    _comercializadoraSlots = slotsResp.slots || getDemoSlots();
  } catch(e) {
    _comercializadoraOrders = getDemoOrders();
    _comercializadoraSlots = getDemoSlots();
  }
}

function getDemoOrders() {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  return [
    { id: 'OC-001', client: 'Gasolinera El Sol', fuel_type: 'magna', liters: 20000, status: 'confirmed', delivery_date: fmt(addDays(today, 1)), source: 'whatsapp', pemex_slot: '07:00-09:00', priority: 'high', created: fmt(addDays(today, -1)) },
    { id: 'OC-002', client: 'Estacion Norte', fuel_type: 'diesel', liters: 15000, status: 'pending', delivery_date: fmt(addDays(today, 2)), source: 'email', pemex_slot: null, priority: 'medium', created: fmt(today) },
    { id: 'OC-003', client: 'Combustibles Juarez', fuel_type: 'premium', liters: 10000, status: 'confirmed', delivery_date: fmt(addDays(today, 1)), source: 'whatsapp', pemex_slot: '10:00-12:00', priority: 'medium', created: fmt(addDays(today, -2)) },
    { id: 'OC-004', client: 'GasExpress Chihuahua', fuel_type: 'magna', liters: 25000, status: 'in_transit', delivery_date: fmt(today), source: 'email', pemex_slot: '06:00-08:00', priority: 'high', created: fmt(addDays(today, -3)) },
    { id: 'OC-005', client: 'Red de Gasolineras MX', fuel_type: 'diesel', liters: 30000, status: 'delivered', delivery_date: fmt(addDays(today, -1)), source: 'whatsapp', pemex_slot: '14:00-16:00', priority: 'low', created: fmt(addDays(today, -4)) },
    { id: 'OC-006', client: 'Petro Frontera', fuel_type: 'magna', liters: 18000, status: 'pending', delivery_date: fmt(addDays(today, 3)), source: 'whatsapp', pemex_slot: null, priority: 'high', created: fmt(today) },
    { id: 'OC-007', client: 'Import Fuel TX', fuel_type: 'premium', liters: 12000, status: 'confirmed', delivery_date: fmt(addDays(today, 2)), source: 'import_us', pemex_slot: '09:00-11:00', priority: 'medium', created: fmt(addDays(today, -1)) },
  ];
}
function getDemoSlots() {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  return [
    { date: fmt(today), time: '06:00-08:00', terminal: 'PEMEX TAR Juarez', status: 'occupied', order_id: 'OC-004' },
    { date: fmt(addDays(today, 1)), time: '07:00-09:00', terminal: 'PEMEX TAR Juarez', status: 'reserved', order_id: 'OC-001' },
    { date: fmt(addDays(today, 1)), time: '10:00-12:00', terminal: 'PEMEX TAR Juarez', status: 'reserved', order_id: 'OC-003' },
    { date: fmt(addDays(today, 1)), time: '14:00-16:00', terminal: 'PEMEX TAR Juarez', status: 'available', order_id: null },
    { date: fmt(addDays(today, 2)), time: '07:00-09:00', terminal: 'PEMEX TAR Juarez', status: 'available', order_id: null },
    { date: fmt(addDays(today, 2)), time: '09:00-11:00', terminal: 'Import Terminal El Paso', status: 'reserved', order_id: 'OC-007' },
    { date: fmt(addDays(today, 2)), time: '10:00-12:00', terminal: 'PEMEX TAR Juarez', status: 'available', order_id: null },
    { date: fmt(addDays(today, 2)), time: '14:00-16:00', terminal: 'PEMEX TAR Juarez', status: 'available', order_id: null },
    { date: fmt(addDays(today, 3)), time: '07:00-09:00', terminal: 'PEMEX TAR Juarez', status: 'available', order_id: null },
    { date: fmt(addDays(today, 3)), time: '10:00-12:00', terminal: 'PEMEX TAR Juarez', status: 'available', order_id: null },
  ];
}
function renderComercializadora() {
  const orders = _comercializadoraOrders;
  const slots = _comercializadoraSlots;
  const pending = orders.filter(o => o.status === 'pending').length;
  const confirmed = orders.filter(o => o.status === 'confirmed').length;
  const inTransit = orders.filter(o => o.status === 'in_transit').length;
  const totalLiters = orders.filter(o => o.status !== 'delivered').reduce((s, o) => s + o.liters, 0);
  const availableSlots = slots.filter(s => s.status === 'available').length;
  const statusColors = { pending: 'var(--orange)', confirmed: 'var(--green)', in_transit: 'var(--teal)', delivered: 'var(--g500)' };
  const statusLabels = { pending: 'Pendiente', confirmed: 'Confirmada', in_transit: 'En Transito', delivered: 'Entregada' };
  const sourceLabels = { whatsapp: 'WhatsApp', email: 'Email', import_us: 'Import USA' };
  const priorityColors = { high: 'var(--red)', medium: 'var(--orange)', low: 'var(--g500)' };

  // Build calendar view - next 7 days
  const today = new Date();
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  let calendarHtml = '';
  for (let d = 0; d < 7; d++) {
    const date = new Date(today); date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    const daySlots = slots.filter(s => s.date === dateStr);
    const dayOrders = orders.filter(o => o.delivery_date === dateStr && o.status !== 'delivered');
    const isToday = d === 0;
    let slotsHtml = '';
    if (daySlots.length > 0) {
      daySlots.forEach(s => {
        const order = s.order_id ? orders.find(o => o.id === s.order_id) : null;
        const slotColor = s.status === 'available' ? 'rgba(13,148,136,.15)' : s.status === 'reserved' ? 'rgba(249,115,22,.15)' : 'rgba(239,68,68,.15)';
        const slotBorder = s.status === 'available' ? 'var(--teal)' : s.status === 'reserved' ? 'var(--orange)' : 'var(--red)';
        const slotLabel = s.status === 'available' ? 'Disponible' : s.status === 'reserved' ? (order ? order.client : 'Reservado') : (order ? order.client : 'Ocupado');
        const fuelBadge = order ? '<span style="background:' + (order.fuel_type === 'magna' ? '#22c55e' : order.fuel_type === 'premium' ? '#ef4444' : '#eab308') + ';color:#000;padding:1px 6px;border-radius:8px;font-size:.6rem;font-weight:700;margin-left:4px">' + FUEL_LABELS[order.fuel_type] + '</span>' : '';
        const litersInfo = order ? '<div style="color:var(--g400);font-size:.65rem;margin-top:2px">' + order.liters.toLocaleString() + ' L' + fuelBadge + '</div>' : '';
        slotsHtml += '<div style="background:' + slotColor + ';border-left:3px solid ' + slotBorder + ';border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:.7rem"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:600;color:var(--w)">' + s.time + '</span><span style="color:' + slotBorder + ';font-size:.65rem">' + slotLabel + '</span></div>' + litersInfo + '<div style="color:var(--g500);font-size:.6rem;margin-top:1px">' + s.terminal + '</div></div>';
      });
    }
    dayOrders.filter(o => !daySlots.some(s => s.order_id === o.id)).forEach(o => {
      slotsHtml += '<div style="background:rgba(249,115,22,.08);border-left:3px solid var(--orange);border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:.7rem"><div style="color:var(--orange);font-weight:600">Sin slot</div><div style="color:var(--w);font-size:.68rem">' + o.client + ' - ' + o.liters.toLocaleString() + ' L ' + FUEL_LABELS[o.fuel_type] + '</div></div>';
    });
    if (!slotsHtml) slotsHtml = '<div style="color:var(--g600);font-size:.7rem;text-align:center;padding:8px">Sin actividad</div>';
    calendarHtml += '<div style="flex:1;min-width:160px;background:var(--card);border:1px solid ' + (isToday ? 'var(--teal)' : 'var(--g700)') + ';border-radius:8px;padding:8px;' + (isToday ? 'box-shadow:0 0 0 1px var(--teal)' : '') + '"><div style="text-align:center;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--g700)"><div style="font-size:.7rem;color:' + (isToday ? 'var(--teal)' : 'var(--g400)') + ';font-weight:600">' + dayNames[date.getDay()] + (isToday ? ' (Hoy)' : '') + '</div><div style="font-size:.85rem;font-weight:700;color:var(--w)">' + date.getDate() + ' ' + date.toLocaleDateString('es-MX', {month: 'short'}) + '</div></div>' + slotsHtml + '</div>';
  }
  // Build orders table rows
  let ordersHtml = '';
  orders.sort((a, b) => { const p = {high:0,medium:1,low:2}; return p[a.priority] - p[b.priority]; });
  orders.forEach(o => {
    const fuelColor = o.fuel_type === 'magna' ? '#22c55e' : o.fuel_type === 'premium' ? '#ef4444' : '#eab308';
    ordersHtml += '<tr><td><span style="font-weight:600;color:var(--teal)">' + o.id + '</span></td><td>' + o.client + '</td><td><span style="background:' + fuelColor + ';color:#000;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">' + FUEL_LABELS[o.fuel_type] + '</span></td><td style="font-weight:600">' + o.liters.toLocaleString() + ' L</td><td><span style="color:' + (statusColors[o.status] || 'var(--g400)') + ';font-weight:600;font-size:.75rem">' + (statusLabels[o.status] || o.status) + '</span></td><td>' + new Date(o.delivery_date + 'T00:00:00').toLocaleDateString('es-MX', {day:'numeric',month:'short'}) + '</td><td>' + (o.pemex_slot || '<span style="color:var(--orange)">Pendiente</span>') + '</td><td style="font-size:.75rem">' + (sourceLabels[o.source] || o.source) + '</td><td style="text-align:center"><span style="color:' + (priorityColors[o.priority] || 'var(--g400)') + '">&#9679;</span></td></tr>';
  });

  const html = '<div class="kpi-grid">' +
    '<div class="kpi"><div class="kpi-icon" style="background:var(--orange)">OC</div><div class="kpi-value" style="color:var(--orange)">' + pending + '</div><div class="kpi-label">Ordenes Pendientes</div></div>' +
    '<div class="kpi"><div class="kpi-icon" style="background:var(--green)">OK</div><div class="kpi-value" style="color:var(--green)">' + confirmed + '</div><div class="kpi-label">Confirmadas</div></div>' +
    '<div class="kpi"><div class="kpi-icon" style="background:var(--teal)">TR</div><div class="kpi-value" style="color:var(--teal)">' + inTransit + '</div><div class="kpi-label">En Transito</div></div>' +
    '<div class="kpi"><div class="kpi-icon" style="background:var(--blue)">L</div><div class="kpi-value" style="color:var(--blue)">' + totalLiters.toLocaleString() + '<span style="font-size:.5em;color:var(--g400)"> L</span></div><div class="kpi-label">Litros por Entregar</div></div>' +
  '</div>' +

  '<div class="panel" style="margin-top:1rem"><div class="panel-header"><h3>Calendario de Entregas &mdash; Proximos 7 Dias</h3><div style="display:flex;gap:12px;align-items:center;font-size:.72rem"><span style="color:var(--teal)">&#9632; Disponible</span><span style="color:var(--orange)">&#9632; Reservado</span><span style="color:var(--red)">&#9632; Ocupado</span></div></div><div style="display:flex;gap:8px;overflow-x:auto;padding:4px 0">' + calendarHtml + '</div></div>' +

  '<div class="panel" style="margin-top:1rem"><div class="panel-header"><h3>Nueva Orden de Compra</h3></div>' +
  '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;margin-bottom:.8rem">' +
  '<div class="form-group"><label class="form-label">Cliente</label><input class="form-input" id="cmrzClient" placeholder="Nombre del cliente"></div>' +
  '<div class="form-group"><label class="form-label">Combustible</label><select class="form-select" id="cmrzFuel"><option value="magna">Magna</option><option value="premium">Premium</option><option value="diesel">Diesel</option></select></div>' +
  '<div class="form-group"><label class="form-label">Litros</label><input type="number" class="form-input" id="cmrzLiters" placeholder="20000"></div>' +
  '<div class="form-group"><label class="form-label">Fecha Entrega</label><input type="date" class="form-input" id="cmrzDate"></div>' +
  '<div class="form-group"><label class="form-label">Fuente</label><select class="form-select" id="cmrzSource"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="import_us">Importacion USA</option></select></div>' +
  '<div class="form-group"><label class="form-label">Prioridad</label><select class="form-select" id="cmrzPriority"><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></div>' +
  '</div><div style="display:flex;gap:.5rem"><button class="btn btn-primary" onclick="addComercializadoraOrder()" style="padding:8px 20px;font-size:.8rem">Registrar Orden</button><button class="btn btn-outline" onclick="requestPemexSlot()" style="padding:8px 16px;font-size:.78rem">Solicitar Slot PEMEX</button></div></div>' +

  '<div class="panel" style="margin-top:1rem"><div class="panel-header"><h3>Ordenes de Compra</h3><span style="color:var(--g400);font-size:.75rem">' + orders.length + ' ordenes</span></div><div class="table-wrap"><table><thead><tr><th>Orden</th><th>Cliente</th><th>Producto</th><th>Volumen</th><th>Estado</th><th>Entrega</th><th>Slot</th><th>Canal</th><th>P</th></tr></thead><tbody>' + ordersHtml + '</tbody></table></div></div>';

  showContent(html);
}
function addComercializadoraOrder() {
  const client = document.getElementById('cmrzClient').value;
  const fuel = document.getElementById('cmrzFuel').value;
  const liters = parseInt(document.getElementById('cmrzLiters').value);
  const date = document.getElementById('cmrzDate').value;
  const source = document.getElementById('cmrzSource').value;
  const priority = document.getElementById('cmrzPriority').value;
  if (!client || !liters || !date) { alert('Completa todos los campos: Cliente, Litros y Fecha.'); return; }
  const newOrder = { id: 'OC-' + String(_comercializadoraOrders.length + 1).padStart(3, '0'), client, fuel_type: fuel, liters, status: 'pending', delivery_date: date, source, pemex_slot: null, priority, created: new Date().toISOString().split('T')[0] };
  _comercializadoraOrders.push(newOrder);
  const headers = getApiHeaders();
  fetch('/api/comercializadora/orders', { method: 'POST', headers, body: JSON.stringify(newOrder) }).catch(() => {});
  renderComercializadora();
}

function requestPemexSlot() {
  const pendingNoSlot = _comercializadoraOrders.filter(o => o.status === 'pending' && !o.pemex_slot);
  if (pendingNoSlot.length === 0) { alert('No hay ordenes pendientes sin slot asignado.'); return; }
  const available = _comercializadoraSlots.filter(s => s.status === 'available');
  if (available.length === 0) { alert('No hay slots disponibles. Intenta mas tarde.'); return; }
  const order = pendingNoSlot[0];
  const slot = available[0];
  slot.status = 'reserved';
  slot.order_id = order.id;
  order.pemex_slot = slot.time;
  order.status = 'confirmed';
  order.delivery_date = slot.date;
  renderComercializadora();
}

// ----------------------------------------------------------------
//  ERP Comercializadora - Integrated Pemex TAR + Orders
// ----------------------------------------------------------------
let _erpTarTerminals = [];
let _erpPrices = [];
let _erpAlerts = [];
let _erpSchedules = [];
let _erpOrders = [];
let _erpSlots = [];
let _erpScrapeStatus = null;

function loadErpComercializadora() {
  fetchErpData().then(() => renderErpComercializadora());
}

async function fetchErpData() {
  const headers = getApiHeaders();
  try {
    const [tarResp, pricesResp, alertsResp, schedulesResp, ordersResp, slotsResp, scrapeResp] = await Promise.all([
      fetch('/api/pemex/tar', { headers }).then(r => r.ok ? r.json() : { terminals: [] }),
      fetch('/api/pemex/prices', { headers }).then(r => r.ok ? r.json() : { prices: [] }),
      fetch('/api/pemex/alerts', { headers }).then(r => r.ok ? r.json() : { alerts: [] }),
      fetch('/api/pemex/schedules', { headers }).then(r => r.ok ? r.json() : { schedules: [] }),
      fetch('/api/comercializadora/orders', { headers }).then(r => r.ok ? r.json() : { orders: [] }),
      fetch('/api/comercializadora/slots', { headers }).then(r => r.ok ? r.json() : { slots: [] }),
      fetch('/api/pemex/scrape-status', { headers }).then(r => r.ok ? r.json() : null),
    ]);
    _erpTarTerminals = tarResp.terminals || getErpDemoTerminals();
    _erpPrices = pricesResp.prices || getErpDemoPrices();
    _erpAlerts = alertsResp.alerts || getErpDemoAlerts();
    _erpSchedules = schedulesResp.schedules || getErpDemoSchedules();
    _erpOrders = ordersResp.orders || getDemoOrders();
    _erpSlots = slotsResp.slots || getDemoSlots();
    _erpScrapeStatus = scrapeResp;
  } catch(e) {
    _erpTarTerminals = getErpDemoTerminals();
    _erpPrices = getErpDemoPrices();
    _erpAlerts = getErpDemoAlerts();
    _erpSchedules = getErpDemoSchedules();
    _erpOrders = getDemoOrders();
    _erpSlots = getDemoSlots();
    _erpScrapeStatus = null;
  }
}

function getErpDemoTerminals() {
  return [
    { id: 1, name: 'TAR Ciudad Juarez', code: 'TAR-JRZ', region: 'Norte', state: 'Chihuahua', status: 'operational', level_percent: 72, estimated_liters: 2160000, wait_time_minutes: 35, fuels: ['magna', 'premium', 'diesel'], lat: 31.6904, lng: -106.4245 },
    { id: 2, name: 'TAR Chihuahua', code: 'TAR-CHI', region: 'Norte', state: 'Chihuahua', status: 'operational', level_percent: 58, estimated_liters: 1740000, wait_time_minutes: 20, fuels: ['magna', 'premium', 'diesel'], lat: 28.6353, lng: -106.0889 },
    { id: 3, name: 'TAR Cadereyta', code: 'TAR-CAD', region: 'Noreste', state: 'Nuevo Leon', status: 'operational', level_percent: 85, estimated_liters: 4250000, wait_time_minutes: 45, fuels: ['magna', 'premium', 'diesel'], lat: 25.5933, lng: -99.9833 },
    { id: 4, name: 'TAR Monterrey', code: 'TAR-MTY', region: 'Noreste', state: 'Nuevo Leon', status: 'limited', level_percent: 34, estimated_liters: 1020000, wait_time_minutes: 90, fuels: ['magna', 'diesel'], lat: 25.6866, lng: -100.3161 },
    { id: 5, name: 'TAR Guadalajara', code: 'TAR-GDL', region: 'Occidente', state: 'Jalisco', status: 'operational', level_percent: 91, estimated_liters: 5460000, wait_time_minutes: 15, fuels: ['magna', 'premium', 'diesel'], lat: 20.6597, lng: -103.3496 },
    { id: 6, name: 'TAR Azcapotzalco', code: 'TAR-AZC', region: 'Centro', state: 'CDMX', status: 'maintenance', level_percent: 12, estimated_liters: 360000, wait_time_minutes: null, fuels: ['magna'], lat: 19.4869, lng: -99.1847 },
    { id: 7, name: 'TAR Salamanca', code: 'TAR-SAL', region: 'Bajio', state: 'Guanajuato', status: 'operational', level_percent: 67, estimated_liters: 2010000, wait_time_minutes: 25, fuels: ['magna', 'premium', 'diesel'], lat: 20.5739, lng: -101.1953 },
    { id: 8, name: 'TAR Tula', code: 'TAR-TUL', region: 'Centro', state: 'Hidalgo', status: 'operational', level_percent: 79, estimated_liters: 3160000, wait_time_minutes: 30, fuels: ['magna', 'premium', 'diesel'], lat: 20.0545, lng: -99.3407 },
  ];
}

function getErpDemoPrices() {
  return [
    { terminal: 'TAR Ciudad Juarez', fuel_type: 'magna', price_per_liter: 22.45, effective_date: new Date().toISOString().split('T')[0], change: 0.12 },
    { terminal: 'TAR Ciudad Juarez', fuel_type: 'premium', price_per_liter: 24.89, effective_date: new Date().toISOString().split('T')[0], change: -0.05 },
    { terminal: 'TAR Ciudad Juarez', fuel_type: 'diesel', price_per_liter: 23.67, effective_date: new Date().toISOString().split('T')[0], change: 0.08 },
    { terminal: 'TAR Chihuahua', fuel_type: 'magna', price_per_liter: 22.38, effective_date: new Date().toISOString().split('T')[0], change: 0.10 },
    { terminal: 'TAR Chihuahua', fuel_type: 'premium', price_per_liter: 24.75, effective_date: new Date().toISOString().split('T')[0], change: -0.03 },
    { terminal: 'TAR Chihuahua', fuel_type: 'diesel', price_per_liter: 23.52, effective_date: new Date().toISOString().split('T')[0], change: 0.15 },
    { terminal: 'TAR Cadereyta', fuel_type: 'magna', price_per_liter: 22.10, effective_date: new Date().toISOString().split('T')[0], change: -0.02 },
    { terminal: 'TAR Monterrey', fuel_type: 'magna', price_per_liter: 22.55, effective_date: new Date().toISOString().split('T')[0], change: 0.20 },
  ];
}

function getErpDemoAlerts() {
  const today = new Date().toISOString();
  return [
    { id: 1, type: 'warning', title: 'TAR Monterrey - Nivel Bajo', message: 'Nivel de magna al 34%. Posible desabasto en 48 horas.', terminal: 'TAR Monterrey', severity: 'high', created_at: today, active: true },
    { id: 2, type: 'maintenance', title: 'TAR Azcapotzalco - Mantenimiento', message: 'Mantenimiento programado hasta el viernes. Solo magna disponible.', terminal: 'TAR Azcapotzalco', severity: 'medium', created_at: today, active: true },
    { id: 3, type: 'info', title: 'Nuevos Precios Vigentes', message: 'Actualizacion de precios de Pemex vigente a partir de hoy.', terminal: null, severity: 'low', created_at: today, active: true },
  ];
}

function getErpDemoSchedules() {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  return [
    { id: 1, terminal: 'TAR Ciudad Juarez', date: fmt(addDays(today, 1)), shift: 'T1', time: '06:00-10:00', available_liters: 60000, fuel_type: 'magna', status: 'open' },
    { id: 2, terminal: 'TAR Ciudad Juarez', date: fmt(addDays(today, 1)), shift: 'T2', time: '10:00-14:00', available_liters: 45000, fuel_type: 'magna', status: 'open' },
    { id: 3, terminal: 'TAR Ciudad Juarez', date: fmt(addDays(today, 1)), shift: 'T1', time: '06:00-10:00', available_liters: 30000, fuel_type: 'diesel', status: 'open' },
    { id: 4, terminal: 'TAR Ciudad Juarez', date: fmt(addDays(today, 2)), shift: 'T1', time: '06:00-10:00', available_liters: 60000, fuel_type: 'magna', status: 'open' },
    { id: 5, terminal: 'TAR Chihuahua', date: fmt(addDays(today, 1)), shift: 'T1', time: '07:00-11:00', available_liters: 40000, fuel_type: 'magna', status: 'open' },
    { id: 6, terminal: 'TAR Chihuahua', date: fmt(addDays(today, 2)), shift: 'T2', time: '11:00-15:00', available_liters: 35000, fuel_type: 'premium', status: 'open' },
  ];
}

function renderErpComercializadora() {
  const terminals = _erpTarTerminals;
  const prices = _erpPrices;
  const alerts = _erpAlerts;
  const schedules = _erpSchedules;
  const orders = _erpOrders;
  const slots = _erpSlots;

  // --- KPIs from TAR data ---
  const operational = terminals.filter(t => t.status === 'operational').length;
  const limited = terminals.filter(t => t.status === 'limited').length;
  const maintenance = terminals.filter(t => t.status === 'maintenance').length;
  const avgLevel = terminals.length ? Math.round(terminals.reduce((s, t) => s + (t.level_percent || 0), 0) / terminals.length) : 0;
  const activeAlerts = alerts.filter(a => a.active && a.severity === 'high').length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const openSchedules = schedules.filter(s => s.status === 'open').length;

  // --- Scrape status badge ---
  const scrapeHtml = _erpScrapeStatus ?
    '<div style="display:flex;align-items:center;gap:6px;font-size:.7rem;color:var(--g400)"><span style="width:8px;height:8px;border-radius:50%;background:' + (_erpScrapeStatus.enabled ? 'var(--green)' : 'var(--orange)') + ';display:inline-block"></span>' + (_erpScrapeStatus.enabled ? 'Bot activo' : 'Bot inactivo') + (_erpScrapeStatus.next_run ? ' &middot; Prox: ' + new Date(_erpScrapeStatus.next_run).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '') + '</div>' :
    '<div style="display:flex;align-items:center;gap:6px;font-size:.7rem;color:var(--orange)"><span style="width:8px;height:8px;border-radius:50%;background:var(--orange);display:inline-block"></span>Datos demo &mdash; conectar bot Pemex</div>';

  // --- Alerts banner ---
  let alertsHtml = '';
  const activeAlertsAll = alerts.filter(a => a.active);
  if (activeAlertsAll.length > 0) {
    const severityIcon = { high: '&#9888;', medium: '&#9432;', low: '&#9432;' };
    const severityColor = { high: 'var(--red)', medium: 'var(--orange)', low: 'var(--teal)' };
    const severityBg = { high: 'rgba(239,68,68,.1)', medium: 'rgba(249,115,22,.1)', low: 'rgba(13,148,136,.08)' };
    alertsHtml = '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:1rem">';
    activeAlertsAll.forEach(a => {
      alertsHtml += '<div style="background:' + (severityBg[a.severity] || severityBg.low) + ';border:1px solid ' + (severityColor[a.severity] || severityColor.low) + ';border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem;color:' + (severityColor[a.severity] || severityColor.low) + '">' + (severityIcon[a.severity] || '&#9432;') + '</span><div><div style="font-weight:600;font-size:.78rem;color:var(--w)">' + a.title + '</div><div style="font-size:.7rem;color:var(--g400)">' + a.message + '</div></div></div>';
    });
    alertsHtml += '</div>';
  }

  // --- TAR Terminal Status Table ---
  const statusColor = { operational: 'var(--green)', limited: 'var(--orange)', maintenance: 'var(--red)', offline: 'var(--g600)' };
  const statusLabel = { operational: 'Operativo', limited: 'Limitado', maintenance: 'Mantenimiento', offline: 'Fuera de Linea' };
  let terminalRows = '';
  terminals.sort((a, b) => (a.level_percent || 0) - (b.level_percent || 0)); // lowest levels first
  terminals.forEach(t => {
    const levelColor = t.level_percent >= 70 ? 'var(--green)' : t.level_percent >= 40 ? 'var(--orange)' : 'var(--red)';
    const barWidth = Math.max(t.level_percent || 0, 2);
    const fuelsHtml = (t.fuels || []).map(f => {
      const fc = f === 'magna' ? '#22c55e' : f === 'premium' ? '#ef4444' : '#eab308';
      return '<span style="background:' + fc + ';color:#000;padding:1px 5px;border-radius:6px;font-size:.58rem;font-weight:700">' + f.charAt(0).toUpperCase() + f.slice(1) + '</span>';
    }).join(' ');
    const waitStr = t.wait_time_minutes != null ? t.wait_time_minutes + ' min' : '&mdash;';
    terminalRows += '<tr>' +
      '<td><span style="font-weight:600;color:var(--teal)">' + (t.code || '') + '</span></td>' +
      '<td>' + t.name + '</td>' +
      '<td>' + (t.region || '') + '</td>' +
      '<td><span style="color:' + (statusColor[t.status] || 'var(--g400)') + ';font-weight:600;font-size:.75rem">' + (statusLabel[t.status] || t.status) + '</span></td>' +
      '<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:var(--g800);border-radius:4px;height:8px;min-width:60px"><div style="width:' + barWidth + '%;height:100%;border-radius:4px;background:' + levelColor + '"></div></div><span style="font-size:.72rem;font-weight:600;color:' + levelColor + '">' + (t.level_percent || 0) + '%</span></div></td>' +
      '<td style="font-size:.75rem">' + (t.estimated_liters ? (t.estimated_liters / 1000).toLocaleString() + 'k L' : '&mdash;') + '</td>' +
      '<td style="font-size:.75rem">' + waitStr + '</td>' +
      '<td>' + fuelsHtml + '</td>' +
      '</tr>';
  });

  // --- Prices mini-table ---
  let pricesHtml = '';
  if (prices.length > 0) {
    const uniqueTerminals = [...new Set(prices.map(p => p.terminal))];
    uniqueTerminals.forEach(term => {
      const tp = prices.filter(p => p.terminal === term);
      pricesHtml += '<div style="margin-bottom:8px"><div style="font-weight:600;font-size:.75rem;color:var(--w);margin-bottom:4px">' + term + '</div><div style="display:flex;gap:8px;flex-wrap:wrap">';
      tp.forEach(p => {
        const fc = p.fuel_type === 'magna' ? '#22c55e' : p.fuel_type === 'premium' ? '#ef4444' : '#eab308';
        const changeIcon = p.change > 0 ? '&#9650;' : p.change < 0 ? '&#9660;' : '&#9644;';
        const changeColor = p.change > 0 ? 'var(--red)' : p.change < 0 ? 'var(--green)' : 'var(--g400)';
        pricesHtml += '<div style="background:var(--g800);border-radius:6px;padding:4px 10px;display:flex;align-items:center;gap:6px"><span style="background:' + fc + ';color:#000;padding:1px 5px;border-radius:6px;font-size:.6rem;font-weight:700">' + p.fuel_type.charAt(0).toUpperCase() + p.fuel_type.slice(1) + '</span><span style="font-weight:700;font-size:.82rem;color:var(--w)">$' + p.price_per_liter.toFixed(2) + '</span><span style="font-size:.65rem;color:' + changeColor + '">' + changeIcon + ' ' + Math.abs(p.change).toFixed(2) + '</span></div>';
      });
      pricesHtml += '</div></div>';
    });
  }

  // --- Delivery Schedules Calendar ---
  const today = new Date();
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  let schedCalHtml = '';
  for (let d = 0; d < 5; d++) {
    const date = new Date(today); date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    const daySched = schedules.filter(s => s.date === dateStr);
    const daySlots = slots.filter(s => s.date === dateStr);
    const dayOrders = orders.filter(o => o.delivery_date === dateStr && o.status !== 'delivered');
    const isToday = d === 0;

    let dayContent = '';
    // Show Pemex delivery schedules
    if (daySched.length > 0) {
      daySched.forEach(s => {
        const fc = s.fuel_type === 'magna' ? '#22c55e' : s.fuel_type === 'premium' ? '#ef4444' : '#eab308';
        dayContent += '<div style="background:rgba(13,148,136,.12);border-left:3px solid var(--teal);border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:.68rem">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:600;color:var(--w)">' + s.shift + ' ' + s.time + '</span><span style="background:' + fc + ';color:#000;padding:1px 5px;border-radius:6px;font-size:.55rem;font-weight:700">' + s.fuel_type.charAt(0).toUpperCase() + s.fuel_type.slice(1) + '</span></div>' +
          '<div style="color:var(--g400);font-size:.62rem;margin-top:2px">' + s.terminal + ' &middot; ' + (s.available_liters / 1000).toLocaleString() + 'k L disp.</div></div>';
      });
    }
    // Show existing order slots
    if (daySlots.length > 0) {
      daySlots.forEach(s => {
        const order = s.order_id ? orders.find(o => o.id === s.order_id) : null;
        const slotColor = s.status === 'available' ? 'rgba(13,148,136,.15)' : s.status === 'reserved' ? 'rgba(249,115,22,.15)' : 'rgba(239,68,68,.15)';
        const slotBorder = s.status === 'available' ? 'var(--teal)' : s.status === 'reserved' ? 'var(--orange)' : 'var(--red)';
        const slotLabel = s.status === 'available' ? 'Slot Disponible' : s.status === 'reserved' ? (order ? order.client : 'Reservado') : (order ? order.client : 'Ocupado');
        dayContent += '<div style="background:' + slotColor + ';border-left:3px solid ' + slotBorder + ';border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:.68rem"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:600;color:var(--w)">' + s.time + '</span><span style="color:' + slotBorder + ';font-size:.62rem">' + slotLabel + '</span></div><div style="color:var(--g500);font-size:.58rem;margin-top:1px">' + s.terminal + '</div></div>';
      });
    }
    // Unscheduled orders
    dayOrders.filter(o => !daySlots.some(s => s.order_id === o.id)).forEach(o => {
      dayContent += '<div style="background:rgba(249,115,22,.08);border-left:3px solid var(--orange);border-radius:4px;padding:4px 8px;margin-bottom:4px;font-size:.68rem"><div style="color:var(--orange);font-weight:600;font-size:.62rem">OC sin slot</div><div style="color:var(--w);font-size:.65rem">' + o.client + ' - ' + o.liters.toLocaleString() + ' L</div></div>';
    });

    if (!dayContent) dayContent = '<div style="color:var(--g600);font-size:.68rem;text-align:center;padding:8px">Sin actividad</div>';
    schedCalHtml += '<div style="flex:1;min-width:180px;background:var(--card);border:1px solid ' + (isToday ? 'var(--teal)' : 'var(--g700)') + ';border-radius:8px;padding:8px;' + (isToday ? 'box-shadow:0 0 0 1px var(--teal)' : '') + '"><div style="text-align:center;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--g700)"><div style="font-size:.68rem;color:' + (isToday ? 'var(--teal)' : 'var(--g400)') + ';font-weight:600">' + dayNames[date.getDay()] + (isToday ? ' (Hoy)' : '') + '</div><div style="font-size:.85rem;font-weight:700;color:var(--w)">' + date.getDate() + ' ' + date.toLocaleDateString('es-MX', {month: 'short'}) + '</div></div>' + dayContent + '</div>';
  }

  // --- Integrated Order Form ---
  let terminalOptions = '<option value="">Seleccionar TAR...</option>';
  terminals.filter(t => t.status !== 'offline').forEach(t => {
    const badge = t.status === 'operational' ? '&#9679; ' : t.status === 'limited' ? '&#9888; ' : '&#9881; ';
    terminalOptions += '<option value="' + t.name + '">' + badge + t.name + ' (' + (t.level_percent || 0) + '%)</option>';
  });

  // --- Build page ---
  const html =
    // Header with scrape status
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">' +
      '<div><h2 style="margin:0;font-size:1.2rem;color:var(--w)">ERP Comercializadora</h2><div style="color:var(--g400);font-size:.72rem;margin-top:2px">Sistema integrado de pedidos + disponibilidad Pemex TAR</div></div>' +
      scrapeHtml +
    '</div>' +

    // Alerts
    alertsHtml +

    // KPI Row
    '<div class="kpi-grid">' +
      '<div class="kpi"><div class="kpi-icon" style="background:var(--green)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div><div class="kpi-value" style="color:var(--green)">' + operational + '</div><div class="kpi-label">TARs Operativas</div></div>' +
      '<div class="kpi"><div class="kpi-icon" style="background:var(--orange)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="kpi-value" style="color:var(--orange)">' + (limited + maintenance) + '</div><div class="kpi-label">TARs Limitadas</div></div>' +
      '<div class="kpi"><div class="kpi-icon" style="background:var(--teal)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="16" height="16"><path d="M12 2v20M2 12h20"/></svg></div><div class="kpi-value" style="color:var(--teal)">' + avgLevel + '<span style="font-size:.5em;color:var(--g400)">%</span></div><div class="kpi-label">Nivel Promedio</div></div>' +
      '<div class="kpi"><div class="kpi-icon" style="background:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg></div><div class="kpi-value" style="color:var(--red)">' + activeAlerts + '</div><div class="kpi-label">Alertas Criticas</div></div>' +
      '<div class="kpi"><div class="kpi-icon" style="background:var(--blue)">OC</div><div class="kpi-value" style="color:var(--blue)">' + pendingOrders + '</div><div class="kpi-label">Ordenes Pendientes</div></div>' +
      '<div class="kpi"><div class="kpi-icon" style="background:#22c55e">PE</div><div class="kpi-value" style="color:#22c55e">' + openSchedules + '</div><div class="kpi-label">Turnos Disponibles</div></div>' +
    '</div>' +

    // Two-column layout: TAR Status + Prices/Alerts
    '<div style="display:grid;grid-template-columns:1fr 340px;gap:1rem;margin-top:1rem">' +

      // LEFT: TAR Terminal Status
      '<div class="panel"><div class="panel-header"><h3>Estado TAR en Tiempo Real</h3><button class="btn btn-outline" onclick="loadErpComercializadora()" style="padding:4px 10px;font-size:.7rem">&#8635; Actualizar</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Codigo</th><th>Terminal</th><th>Region</th><th>Estado</th><th>Nivel</th><th>Volumen</th><th>Espera</th><th>Combustibles</th></tr></thead><tbody>' + terminalRows + '</tbody></table></div></div>' +

      // RIGHT: Prices + Alerts sidebar
      '<div>' +
        '<div class="panel" style="margin-bottom:1rem"><div class="panel-header"><h3>Precios Pemex Hoy</h3></div><div style="padding:0 4px">' + (pricesHtml || '<div style="color:var(--g500);font-size:.72rem;text-align:center;padding:12px">Sin datos de precios</div>') + '</div></div>' +
      '</div>' +

    '</div>' +

    // Delivery Schedule Calendar
    '<div class="panel" style="margin-top:1rem"><div class="panel-header"><h3>Calendario de Entregas + Turnos Pemex</h3><div style="display:flex;gap:12px;align-items:center;font-size:.68rem"><span style="color:var(--teal)">&#9632; Turno Pemex</span><span style="color:var(--orange)">&#9632; Reservado</span><span style="color:var(--red)">&#9632; Ocupado</span></div></div><div style="display:flex;gap:8px;overflow-x:auto;padding:4px 0">' + schedCalHtml + '</div></div>' +

    // New Order Form - TAR-aware
    '<div class="panel" style="margin-top:1rem"><div class="panel-header"><h3>Nueva Orden de Compra (ERP)</h3></div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.6rem;margin-bottom:.8rem">' +
    '<div class="form-group"><label class="form-label">Cliente</label><input class="form-input" id="erpClient" placeholder="Nombre del cliente"></div>' +
    '<div class="form-group"><label class="form-label">TAR Terminal</label><select class="form-select" id="erpTerminal">' + terminalOptions + '</select></div>' +
    '<div class="form-group"><label class="form-label">Combustible</label><select class="form-select" id="erpFuel"><option value="magna">Magna</option><option value="premium">Premium</option><option value="diesel">Diesel</option></select></div>' +
    '<div class="form-group"><label class="form-label">Litros</label><input type="number" class="form-input" id="erpLiters" placeholder="20000"></div>' +
    '<div class="form-group"><label class="form-label">Fecha Entrega</label><input type="date" class="form-input" id="erpDate"></div>' +
    '<div class="form-group"><label class="form-label">Turno</label><select class="form-select" id="erpShift"><option value="">Auto-asignar</option><option value="T1">T1 (06:00-10:00)</option><option value="T2">T2 (10:00-14:00)</option><option value="T3">T3 (14:00-18:00)</option></select></div>' +
    '<div class="form-group"><label class="form-label">Fuente</label><select class="form-select" id="erpSource"><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="import_us">Importacion USA</option></select></div>' +
    '<div class="form-group"><label class="form-label">Prioridad</label><select class="form-select" id="erpPriority"><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></div>' +
    '</div>' +
    '<div style="display:flex;gap:.5rem">' +
    '<button class="btn btn-primary" onclick="addErpOrder()" style="padding:8px 20px;font-size:.8rem">Registrar Orden ERP</button>' +
    '<button class="btn btn-outline" onclick="autoAssignErpSlot()" style="padding:8px 16px;font-size:.78rem">Auto-Asignar Slot TAR</button>' +
    '</div></div>' +

    // Orders table
    '<div class="panel" style="margin-top:1rem"><div class="panel-header"><h3>Ordenes ERP</h3><span style="color:var(--g400);font-size:.75rem">' + orders.length + ' ordenes</span></div><div class="table-wrap"><table><thead><tr><th>Orden</th><th>Cliente</th><th>Terminal</th><th>Producto</th><th>Volumen</th><th>Estado</th><th>Entrega</th><th>Turno</th><th>Canal</th><th>P</th></tr></thead><tbody>' + buildErpOrderRows(orders) + '</tbody></table></div></div>';

  showContent(html);
}

function buildErpOrderRows(orders) {
  const statusColors = { pending: 'var(--orange)', confirmed: 'var(--green)', in_transit: 'var(--teal)', delivered: 'var(--g500)' };
  const statusLabels = { pending: 'Pendiente', confirmed: 'Confirmada', in_transit: 'En Transito', delivered: 'Entregada' };
  const sourceLabels = { whatsapp: 'WhatsApp', email: 'Email', import_us: 'Import USA' };
  const priorityColors = { high: 'var(--red)', medium: 'var(--orange)', low: 'var(--g500)' };
  let html = '';
  orders.sort((a, b) => { const p = {high:0,medium:1,low:2}; return p[a.priority] - p[b.priority]; });
  orders.forEach(o => {
    const fuelColor = o.fuel_type === 'magna' ? '#22c55e' : o.fuel_type === 'premium' ? '#ef4444' : '#eab308';
    const terminal = o.terminal || o.pemex_slot ? (o.terminal || 'TAR Asignado') : '<span style="color:var(--g500)">Sin asignar</span>';
    html += '<tr><td><span style="font-weight:600;color:var(--teal)">' + o.id + '</span></td><td>' + o.client + '</td><td style="font-size:.72rem">' + terminal + '</td><td><span style="background:' + fuelColor + ';color:#000;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">' + FUEL_LABELS[o.fuel_type] + '</span></td><td style="font-weight:600">' + o.liters.toLocaleString() + ' L</td><td><span style="color:' + (statusColors[o.status] || 'var(--g400)') + ';font-weight:600;font-size:.75rem">' + (statusLabels[o.status] || o.status) + '</span></td><td>' + new Date(o.delivery_date + 'T00:00:00').toLocaleDateString('es-MX', {day:'numeric',month:'short'}) + '</td><td>' + (o.pemex_slot || '<span style="color:var(--orange)">Pendiente</span>') + '</td><td style="font-size:.75rem">' + (sourceLabels[o.source] || o.source) + '</td><td style="text-align:center"><span style="color:' + (priorityColors[o.priority] || 'var(--g400)') + '">&#9679;</span></td></tr>';
  });
  return html;
}

function addErpOrder() {
  const client = document.getElementById('erpClient').value;
  const terminal = document.getElementById('erpTerminal').value;
  const fuel = document.getElementById('erpFuel').value;
  const liters = parseInt(document.getElementById('erpLiters').value);
  const date = document.getElementById('erpDate').value;
  const shift = document.getElementById('erpShift').value;
  const source = document.getElementById('erpSource').value;
  const priority = document.getElementById('erpPriority').value;
  if (!client || !liters || !date) { alert('Completa los campos obligatorios: Cliente, Litros y Fecha.'); return; }

  // Validate against TAR capacity
  if (terminal) {
    const tar = _erpTarTerminals.find(t => t.name === terminal);
    if (tar) {
      if (tar.status === 'maintenance') { alert('La terminal ' + tar.name + ' esta en mantenimiento. Selecciona otra.'); return; }
      if (tar.status === 'offline') { alert('La terminal ' + tar.name + ' esta fuera de linea.'); return; }
      if (tar.level_percent < 20) {
        if (!confirm('Atencion: ' + tar.name + ' tiene nivel critico (' + tar.level_percent + '%). Continuar?')) return;
      }
      // Check fuel availability
      if (tar.fuels && !tar.fuels.includes(fuel)) {
        alert(tar.name + ' no tiene ' + fuel + ' disponible. Combustibles: ' + tar.fuels.join(', ')); return;
      }
    }
  }

  const newOrder = {
    id: 'ERP-' + String(_erpOrders.length + 1).padStart(3, '0'),
    client, fuel_type: fuel, liters, status: shift ? 'confirmed' : 'pending',
    delivery_date: date, source, pemex_slot: shift || null, priority,
    terminal: terminal || null,
    created: new Date().toISOString().split('T')[0]
  };
  _erpOrders.push(newOrder);

  const headers = getApiHeaders();
  fetch('/api/comercializadora/orders', { method: 'POST', headers, body: JSON.stringify(newOrder) }).catch(() => {});
  renderErpComercializadora();
}

function autoAssignErpSlot() {
  const pendingNoSlot = _erpOrders.filter(o => o.status === 'pending' && !o.pemex_slot);
  if (pendingNoSlot.length === 0) { alert('No hay ordenes pendientes sin slot asignado.'); return; }

  // Try to match with available schedules first (real TAR data)
  let assigned = 0;
  pendingNoSlot.forEach(order => {
    // Find matching schedule by fuel type and terminal
    const matchingSched = _erpSchedules.find(s =>
      s.status === 'open' &&
      s.fuel_type === order.fuel_type &&
      s.available_liters >= order.liters &&
      (!order.terminal || s.terminal === order.terminal)
    );
    if (matchingSched) {
      order.pemex_slot = matchingSched.shift + ' ' + matchingSched.time;
      order.terminal = matchingSched.terminal;
      order.delivery_date = matchingSched.date;
      order.status = 'confirmed';
      matchingSched.status = 'assigned';
      assigned++;
      return;
    }
    // Fallback to existing slot system
    const available = _erpSlots.find(s => s.status === 'available');
    if (available) {
      available.status = 'reserved';
      available.order_id = order.id;
      order.pemex_slot = available.time;
      order.terminal = available.terminal;
      order.status = 'confirmed';
      order.delivery_date = available.date;
      assigned++;
    }
  });

  if (assigned > 0) {
    alert(assigned + ' orden(es) asignada(s) a slots TAR exitosamente.');
    renderErpComercializadora();
  } else {
    alert('No hay slots/turnos disponibles que coincidan. Intenta mas tarde.');
  }
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
    comercializadora: loadComercializadora,
    erp_comercializadora: loadErpComercializadora,
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
