/* ============================================================
   TalentFlow — Lógica del dashboard
   ------------------------------------------------------------
   Consume el webhook GET de n8n (flujo "Dashboard - Datos
   Agregados") que devuelve SOLO datos anonimizados: vacante,
   score, estado y fecha por candidato — nunca nombre, correo
   ni teléfono. Toda la agregación (por vacante, por fecha,
   distribución de score) se recalcula aquí en el cliente para
   que el filtro de vacante no dependa de otra llamada de red.
   ============================================================ */

(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const PLACEHOLDER = 'PEGAR_AQUI_WEBHOOK_DASHBOARD_N8N';
  const SCORE_BUCKETS = ['0-19', '20-39', '40-59', '60-79', '80-100'];
  const SCORE_COLOR_VAR = {
    '0-19': '--score-0', '20-39': '--score-1', '40-59': '--score-2',
    '60-79': '--score-3', '80-100': '--score-4', sin_score: '--score-none'
  };
  const ESTADOS_PENDIENTES = ['PENDIENTE_REVISION', 'ANALIZADO', 'RECIBIDO'];
  const MAX_FECHAS = 14;

  /** Datos sintéticos (no son candidatos reales) para modo de ejemplo. */
  const SAMPLE_DETALLE = [
    { vacante: 'backend-jr', score: 88, estado: 'PRESELECCIONADO', fecha: '2026-08-01' },
    { vacante: 'backend-jr', score: 62, estado: 'ANALIZADO', fecha: '2026-08-03' },
    { vacante: 'backend-jr', score: 41, estado: 'PENDIENTE_REVISION', fecha: '2026-08-05' },
    { vacante: 'backend-jr', score: null, estado: 'PENDIENTE_REVISION', fecha: '2026-08-06' },
    { vacante: 'backend-jr', score: 81, estado: 'PRESELECCIONADO', fecha: '2026-08-10' },
    { vacante: 'frontend-jr', score: 92, estado: 'ENTREVISTA', fecha: '2026-08-02' },
    { vacante: 'frontend-jr', score: 76, estado: 'ANALIZADO', fecha: '2026-08-03' },
    { vacante: 'frontend-jr', score: 55, estado: 'PENDIENTE_REVISION', fecha: '2026-08-04' },
    { vacante: 'frontend-jr', score: 83, estado: 'PRESELECCIONADO', fecha: '2026-08-07' },
    { vacante: 'frontend-jr', score: 18, estado: 'PENDIENTE_REVISION', fecha: '2026-08-08' },
    { vacante: 'frontend-jr', score: 48, estado: 'PENDIENTE_REVISION', fecha: '2026-08-11' },
    { vacante: 'data-jr', score: 67, estado: 'ANALIZADO', fecha: '2026-08-02' },
    { vacante: 'data-jr', score: 35, estado: 'PENDIENTE_REVISION', fecha: '2026-08-05' },
    { vacante: 'data-jr', score: 90, estado: 'ENTREVISTA', fecha: '2026-08-06' },
    { vacante: 'data-jr', score: 72, estado: 'ANALIZADO', fecha: '2026-08-09' },
    { vacante: 'data-jr', score: null, estado: 'PENDIENTE_REVISION', fecha: '2026-08-10' }
  ];

  const dom = {
    banner: $('#banner'),
    bannerIcon: $('#bannerIcon'),
    bannerText: $('#bannerText'),
    vacanteSelect: $('#vacanteFilter'),
    refreshBtn: $('#refreshBtn'),
    updated: $('#lastUpdated'),
    kpiTotal: $('#kpiTotal'),
    kpiPendientes: $('#kpiPendientes'),
    kpiEntrevista: $('#kpiEntrevista'),
    vacanteChart: $('#vacanteChart'),
    scoreChart: $('#scoreChart'),
    fechaChart: $('#fechaChart'),
    tableBody: $('#tableBody'),
    tableCount: $('#tableCount'),
    tooltip: $('#chartTooltip')
  };

  const state = { detalle: [], vacante: 'todas' };

  /* ── Utilidades ─────────────────────────────────────────── */

  function vacanteLabel(value) {
    const lista = (window.CONFIG && CONFIG.VACANTES) || [];
    const match = lista.find((v) => v.value === value);
    return match ? match.label : value;
  }

  function listaVacantes() {
    const lista = (window.CONFIG && CONFIG.VACANTES) || [];
    if (lista.length) return lista.map((v) => v.value);
    const set = new Set(state.detalle.map((d) => d.vacante));
    return Array.from(set);
  }

  function scoreBucket(score) {
    if (score === null || score === undefined || isNaN(score)) return null;
    if (score < 20) return '0-19';
    if (score < 40) return '20-39';
    if (score < 60) return '40-59';
    if (score < 80) return '60-79';
    return '80-100';
  }

  function pluralCandidatos(n) {
    return `${n} candidato${n === 1 ? '' : 's'}`;
  }

  /* ── Agregación (siempre sobre las filas ya filtradas) ────── */

  function filasFiltradas() {
    if (state.vacante === 'todas') return state.detalle;
    return state.detalle.filter((d) => d.vacante === state.vacante);
  }

  function aggregate(rows) {
    const porVacante = {};
    rows.forEach((d) => { porVacante[d.vacante] = (porVacante[d.vacante] || 0) + 1; });

    const distribucion = { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-100': 0, sin_score: 0 };
    rows.forEach((d) => {
      const b = scoreBucket(d.score);
      if (b) distribucion[b] += 1; else distribucion.sin_score += 1;
    });

    const porFecha = {};
    rows.forEach((d) => {
      const f = d.fecha || 'sin_fecha';
      porFecha[f] = (porFecha[f] || 0) + 1;
    });

    const porEstado = {};
    rows.forEach((d) => { porEstado[d.estado] = (porEstado[d.estado] || 0) + 1; });

    const pendientes = ESTADOS_PENDIENTES.reduce((sum, e) => sum + (porEstado[e] || 0), 0);
    const enEntrevista = porEstado.ENTREVISTA || 0;

    return { total: rows.length, porVacante, distribucion, porFecha, porEstado, pendientes, enEntrevista };
  }

  /* ── Tooltip compartido ────────────────────────────────────── */

  function bindTooltip(container) {
    const marks = () => $$('[data-tooltip]', container);

    const show = (el) => {
      const rect = el.getBoundingClientRect();
      dom.tooltip.textContent = el.dataset.tooltip;
      dom.tooltip.style.left = `${rect.left + rect.width / 2}px`;
      dom.tooltip.style.top = `${rect.top - 8}px`;
      dom.tooltip.classList.add('is-visible');
    };
    const hide = () => dom.tooltip.classList.remove('is-visible');

    container.addEventListener('pointerenter', (e) => {
      const mark = e.target.closest('[data-tooltip]');
      if (mark) show(mark);
    }, true);
    container.addEventListener('pointerleave', (e) => {
      if (e.target.closest('[data-tooltip]')) hide();
    }, true);
    marks; // (evita advertencia de función no usada en algunos linters)

    container.addEventListener('focusin', (e) => {
      const mark = e.target.closest('[data-tooltip]');
      if (mark) show(mark);
    });
    container.addEventListener('focusout', (e) => {
      if (e.target.closest('[data-tooltip]')) hide();
    });
  }

  [dom.vacanteChart, dom.scoreChart, dom.fechaChart].forEach(bindTooltip);

  /* ── Render: KPIs ──────────────────────────────────────────── */

  function renderKpis(agg) {
    dom.kpiTotal.textContent = agg.total.toLocaleString('es-CO');
    dom.kpiPendientes.textContent = agg.pendientes.toLocaleString('es-CO');
    dom.kpiEntrevista.textContent = agg.enEntrevista.toLocaleString('es-CO');
  }

  /* ── Render: candidatos por vacante (barras horizontales) ──── */

  function renderVacante(agg) {
    const claves = listaVacantes();
    const valores = claves.map((v) => agg.porVacante[v] || 0);
    const max = Math.max(1, ...valores);

    if (agg.total === 0) {
      dom.vacanteChart.innerHTML = '<p class="chart-card__empty">No hay candidatos para esta selección.</p>';
      return;
    }

    const filas = claves.map((v, i) => {
      const n = valores[i];
      const pct = Math.round((n / max) * 100);
      return `
        <div class="bar-row">
          <span class="bar-row__label" title="${vacanteLabel(v)}">${vacanteLabel(v)}</span>
          <div class="bar-row__track">
            <div class="bar-row__fill" style="width:${pct}%" tabindex="0"
                 data-tooltip="${vacanteLabel(v)}: ${pluralCandidatos(n)}"></div>
          </div>
          <span class="bar-row__value">${n}</span>
        </div>`;
    }).join('');

    dom.vacanteChart.innerHTML = `<div class="bar-list">${filas}</div>`;
  }

  /* ── Render: distribución de score (columnas, rampa ordinal) ─ */

  function renderScore(agg) {
    if (agg.total === 0) {
      dom.scoreChart.innerHTML = '<p class="chart-card__empty">No hay candidatos para esta selección.</p>';
      return;
    }

    const claves = [...SCORE_BUCKETS, 'sin_score'];
    const valores = claves.map((k) => agg.distribucion[k] || 0);
    const max = Math.max(1, ...valores);

    const cols = claves.map((k, i) => {
      const n = valores[i];
      const pct = Math.max(n > 0 ? 4 : 0, Math.round((n / max) * 100));
      const color = `var(${SCORE_COLOR_VAR[k]})`;
      const etiqueta = k === 'sin_score' ? 'Sin score' : k;
      return `
        <div class="col">
          <span class="col__value">${n || ''}</span>
          <div class="col__track">
            <div class="col__fill" style="height:${pct}%;background:${color}" tabindex="0"
                 data-tooltip="${etiqueta}: ${pluralCandidatos(n)}"></div>
          </div>
          <span class="col__label">${etiqueta}</span>
        </div>`;
    }).join('');

    const leyenda = `
      <div class="ramp-legend">
        <span class="ramp-legend__item"><span class="ramp-legend__swatch" style="background:var(--score-0)"></span>Menor compatibilidad</span>
        <span class="ramp-legend__item"><span class="ramp-legend__swatch" style="background:var(--score-4)"></span>Mayor compatibilidad</span>
        <span class="ramp-legend__item"><span class="ramp-legend__swatch" style="background:var(--score-none)"></span>Sin score (CV no legible)</span>
      </div>`;

    dom.scoreChart.innerHTML = `<div class="col-chart">${cols}</div>${leyenda}`;
  }

  /* ── Render: postulaciones por fecha (columnas cronológicas) ─ */

  function renderFecha(agg) {
    if (agg.total === 0) {
      dom.fechaChart.innerHTML = '<p class="chart-card__empty">No hay candidatos para esta selección.</p>';
      return;
    }

    const fechas = Object.keys(agg.porFecha).filter((f) => f !== 'sin_fecha').sort();
    const recientes = fechas.slice(-MAX_FECHAS);
    const max = Math.max(1, ...recientes.map((f) => agg.porFecha[f]));
    const dense = recientes.length > 8;

    const cols = recientes.map((f) => {
      const n = agg.porFecha[f];
      const pct = Math.max(4, Math.round((n / max) * 100));
      const corta = f.slice(5); // MM-DD
      return `
        <div class="col">
          <span class="col__value">${n}</span>
          <div class="col__track">
            <div class="col__fill" style="height:${pct}%" tabindex="0"
                 data-tooltip="${f}: ${pluralCandidatos(n)}"></div>
          </div>
          <span class="col__label">${corta}</span>
        </div>`;
    }).join('');

    const nota = fechas.length > MAX_FECHAS
      ? `<p class="chart-card__sub" style="margin-top:14px">Mostrando los últimos ${MAX_FECHAS} días con postulaciones de ${fechas.length} en total.</p>`
      : '';
    const sinFecha = agg.porFecha.sin_fecha
      ? `<p class="chart-card__sub" style="margin-top:6px">${pluralCandidatos(agg.porFecha.sin_fecha)} sin fecha registrada.</p>`
      : '';

    dom.fechaChart.innerHTML = `<div class="col-chart${dense ? ' col-chart--dense' : ''}">${cols}</div>${nota}${sinFecha}`;
  }

  /* ── Render: tabla (vista accesible, sin PII) ────────────── */

  function renderTabla(rows) {
    const ordenadas = [...rows].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    dom.tableCount.textContent = ordenadas.length;

    dom.tableBody.innerHTML = '';
    ordenadas.forEach((d) => {
      const tr = document.createElement('tr');
      const celdas = [
        vacanteLabel(d.vacante),
        d.score === null || d.score === undefined ? 'Sin score' : `${d.score}`,
        d.estado || '—',
        d.fecha || '—'
      ];
      celdas.forEach((texto) => {
        const td = document.createElement('td');
        td.textContent = texto; // textContent: los valores vienen de Sheets, nunca innerHTML
        tr.appendChild(td);
      });
      dom.tableBody.appendChild(tr);
    });
  }

  /* ── Orquestación ──────────────────────────────────────────── */

  function renderTodo() {
    const rows = filasFiltradas();
    const agg = aggregate(rows);
    renderKpis(agg);
    renderVacante(agg);
    renderScore(agg);
    renderFecha(agg);
    renderTabla(rows);
  }

  function mostrarBanner(tipo, texto) {
    dom.banner.hidden = false;
    dom.banner.className = `banner banner--${tipo}`;
    dom.bannerText.textContent = texto;
  }

  function ocultarBanner() {
    dom.banner.hidden = true;
  }

  function poblarFiltro() {
    const lista = (window.CONFIG && CONFIG.VACANTES) || [];
    dom.vacanteSelect.innerHTML = '<option value="todas">Todas las vacantes</option>' +
      lista.map((v) => `<option value="${v.value}">${v.label}</option>`).join('');
  }

  async function cargarDatos() {
    const url = window.DASHBOARD_CONFIG && DASHBOARD_CONFIG.DASHBOARD_WEBHOOK_URL;

    if (!url || url === PLACEHOLDER) {
      state.detalle = SAMPLE_DETALLE;
      mostrarBanner('demo', 'Mostrando datos de ejemplo (sintéticos, no son candidatos reales) — configura DASHBOARD_WEBHOOK_URL en js/dashboard-config.js para conectar tu hoja.');
      dom.updated.textContent = 'Datos de ejemplo';
      renderTodo();
      return;
    }

    dom.refreshBtn.disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DASHBOARD_CONFIG.REQUEST_TIMEOUT_MS || 15000);

    try {
      const res = await fetch(url, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const payload = Array.isArray(data) ? data[0] : data;
      state.detalle = Array.isArray(payload.detalle) ? payload.detalle : [];

      ocultarBanner();
      dom.updated.textContent = payload.generado_en
        ? `Actualizado ${new Date(payload.generado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'Actualizado ahora';
      renderTodo();
    } catch (error) {
      state.detalle = [];
      mostrarBanner('error', 'No pudimos cargar los datos del dashboard. Verifica DASHBOARD_WEBHOOK_URL en js/dashboard-config.js y que el workflow "Dashboard - Datos Agregados" esté activo en n8n.');
      dom.updated.textContent = '';
      renderTodo();
      console.error('[TalentFlow Dashboard] Falló la carga:', error);
    } finally {
      clearTimeout(timeout);
      dom.refreshBtn.disabled = false;
    }
  }

  /* ── Eventos ──────────────────────────────────────────────── */

  dom.vacanteSelect.addEventListener('change', (e) => {
    state.vacante = e.target.value;
    renderTodo();
  });

  dom.refreshBtn.addEventListener('click', cargarDatos);

  /* ── Arranque ─────────────────────────────────────────────── */

  poblarFiltro();
  cargarDatos();
})();
