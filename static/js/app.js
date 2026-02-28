/* Control Petro - Frontend Application */

const API = '';
const FUEL_LABELS = { magna: 'Magna', premium: 'Premium', diesel: 'Diesel' };
const FUEL_COLORS = { magna: '#22c55e', premium: '#ef4444', diesel: '#eab308' };
let charts = {};
let currentPage = 'dashboard';

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
async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
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
      api('/api/dashboard'),
      api('/api/dashboard/sales-chart?days=7'),
      api('/api/alerts'),
      api('/api/stations'),
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
        <span class="panel-title" style="color:var(--teal)">Generar XML SAT con IA (Opus 4.6)</span>
      </div>
      <p style="color:var(--g400);font-size:.78rem;margin-bottom:.8rem">Sube tus datos operativos y Claude genera el XML validado listo para enviar al SAT via el portal de controles volumetricos.</p>
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
              <option value="database">Usar datos de ControlPetro</option>
            </select>
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
        <div style="display:flex;gap:.5rem;align-items:center">
          <button class="btn btn-primary" onclick="generateSatXml()" id="btnGenXml" style="background:var(--teal);padding:10px 24px;font-size:.82rem">
            Generar XML con Opus 4.6
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

// ----------------------------------------------------------------
//  SAT XML Generation
// ----------------------------------------------------------------
function toggleXmlDataSource() {
  const source = document.getElementById('xmlSource').value;
  const manual = document.getElementById('xmlManualData');
  if (manual) manual.style.display = source === 'manual' ? 'block' : 'none';
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
      result = await apiPost('/api/sat-xml/generate-from-db', { date: fecha });
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
      });
    }

    if (result.error) {
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = `<div class="form-msg error">${result.error}</div>`;
      return;
    }

    const v = result.validation || {};
    const products = (v.products || []).map(p =>
      `<span style="margin-right:8px">${p.clave} (${p.marca}): ${p.tanques} tanques, ${p.dispensarios} disp. ${p.balance_ok ? badge('Balance OK', 'green') : badge('Balance Error', 'red')}</span>`
    ).join('');
    const warnings = (v.warnings || []).length > 0
      ? `<div style="color:var(--orange);font-size:.72rem;margin-top:.4rem"><strong>Advertencias:</strong> ${v.warnings.join('; ')}</div>`
      : '';
    const tokens = result.tokens_used
      ? `<span style="color:var(--g500);font-size:.68rem;margin-left:8px">(${result.tokens_used.input + result.tokens_used.output} tokens)</span>`
      : '';

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div style="background:rgba(13,148,136,.1);border:1px solid var(--teal);border-radius:8px;padding:.8rem">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
          ${badge('XML Generado', 'green')}
          <strong style="color:var(--w);font-size:.82rem">${result.xml_filename}</strong>
          ${tokens}
        </div>
        <div style="font-size:.72rem;color:var(--g400);margin-bottom:.5rem">
          <strong>Validacion:</strong> ${v.product_count || 0} productos, ${v.bitacora_count || 0} entradas bitacora
        </div>
        <div style="font-size:.72rem;color:var(--g400)">${products}</div>
        ${warnings}
        <div style="margin-top:.6rem;display:flex;gap:.5rem">
          <button class="btn btn-primary" onclick="downloadReport(${result.report_id})" style="background:var(--teal)">
            Descargar ${result.zip_filename}
          </button>
          <button class="btn btn-outline" onclick="sendReport(${result.report_id})">Marcar Enviado al SAT</button>
        </div>
        <p style="color:var(--g500);font-size:.68rem;margin-top:.5rem;margin-bottom:0">
          Sube este .zip al portal SAT: sat.gob.mx/tramites/01116 &rarr; Iniciar &rarr; e.firma &rarr; Adjuntar .zip &rarr; Firmar &rarr; Obtener acuse
        </p>
      </div>`;

    // Refresh report list
    setTimeout(() => loadReportes(), 2000);

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
      api('/api/inventory/summary'),
      api('/api/inventory/history?days=7'),
      api('/api/stations'),
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
    </div>

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
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12 } } } },
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
    const stations = await api('/api/stations');
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
    plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12 } } },
    scales: {
      x: { stacked: opts.stacked || false, ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } },
      y: { stacked: opts.stacked || false, ticks: { color: '#64748b', font: { family: 'Inter', size: 10 }, callback: opts.yCallback || (v => v) }, grid: { color: 'rgba(255,255,255,.04)' } },
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
function init() {
  const now = new Date();
  document.getElementById('topbarDate').textContent = now.toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
