/* ============================================================
   TalentFlow — Lógica del formulario de postulación
   ------------------------------------------------------------
   Responsabilidades: recopilar → validar → construir FormData →
   POST al webhook de n8n → mostrar resultado.
   La URL del webhook vive únicamente en js/config.js.
   ============================================================ */

(function () {
  'use strict';

  const TOTAL_STEPS = 4;
  const WEBHOOK_PLACEHOLDER = 'PEGAR_AQUI_WEBHOOK_N8N';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    form: $('#applicationForm'),
    steps: $$('.step'),
    spine: $('#spine'),
    spineItems: $$('.spine__item'),
    spineCaption: $('#spineCaption'),
    panel: $('#panel'),

    vacanteGroup: $('#vacanteGroup'),

    drop: $('#drop'),
    fileInput: $('#cv'),
    fileCard: $('#fileCard'),
    fileName: $('#fileName'),
    fileMeta: $('#fileMeta'),
    removeFile: $('#removeFile'),

    summary: {
      nombre: $('#sumNombre'),
      correo: $('#sumCorreo'),
      telefono: $('#sumTelefono'),
      vacante: $('#sumVacante'),
      cv: $('#sumCv')
    },

    submitBtn: $('#submitBtn'),
    submitLabel: $('#submitLabel'),
    alert: $('#submitAlert'),
    alertTitle: $('#alertTitle'),
    alertText: $('#alertText'),

    successView: $('#successView'),
    doneStamp: $('#doneStamp')
  };

  const state = {
    step: 1,
    file: null,
    submitting: false,
    failed: false,
    sent: false
  };

  const STEP_FIELDS = {
    1: ['nombre', 'correo', 'telefono'],
    2: ['vacante'],
    3: ['cv'],
    4: []
  };

  const STEP_NAMES = ['Información', 'Vacante', 'Hoja de vida', 'Enviar'];

  /* ── Utilidades ─────────────────────────────────────────── */

  const maxBytes = () => CONFIG.MAX_CV_SIZE_MB * 1024 * 1024;

  /** Usa espacio duro para que la cifra y la unidad nunca se separen al ajustar línea. */
  function formatBytes(bytes) {
    const NBSP = '\u00A0';
    if (bytes < 1024) return `${bytes}${NBSP}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}${NBSP}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}${NBSP}MB`;
  }

  function getValue(name) {
    const input = $(`#${name}`);
    return input ? input.value.trim() : '';
  }

  function getVacante() {
    const checked = $('input[name="vacante"]:checked', dom.vacanteGroup);
    return checked ? checked.value : '';
  }

  function vacanteLabel(value) {
    const match = CONFIG.VACANTES.find((v) => v.value === value);
    return match ? match.label : value;
  }

  /* ── Validación ─────────────────────────────────────────── */

  const NAME_PATTERN = /^[\p{L}\p{M}'’.\- ]+$/u;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

  const validators = {
    nombre() {
      const value = getValue('nombre');
      if (!value) return 'Escribe tu nombre completo.';
      if (!NAME_PATTERN.test(value)) return 'Usa solo letras, espacios, guiones o apóstrofos.';
      if (value.split(/\s+/).filter((word) => word.length >= 2).length < 2) {
        return 'Incluye al menos tu nombre y un apellido.';
      }
      return '';
    },

    correo() {
      const value = getValue('correo');
      if (!value) return 'Escribe tu correo electrónico.';
      if (!EMAIL_PATTERN.test(value)) return 'Revisa el formato del correo. Ejemplo: nombre@correo.com';
      return '';
    },

    telefono() {
      const value = getValue('telefono');
      if (!value) return 'Escribe tu número de teléfono.';
      if (/[^\d+()\-.\s]/.test(value)) return 'Usa solo números, espacios y los signos + ( ) -';
      const digits = value.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return 'El teléfono debe tener entre 7 y 15 dígitos.';
      return '';
    },

    vacante() {
      const value = getVacante();
      if (!value) return 'Selecciona la vacante a la que te postulas.';
      if (!CONFIG.VACANTES.some((v) => v.value === value)) return 'Selecciona una vacante válida.';
      return '';
    },

    cv() {
      if (!state.file) return 'Adjunta tu hoja de vida en PDF.';
      return '';
    }
  };

  /** Errores de archivo, evaluados en el momento de la selección. */
  function validateFile(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) return 'El archivo debe ser un PDF. Convierte tu hoja de vida y vuelve a intentarlo.';
    if (file.size === 0) return 'El archivo está vacío. Selecciona otro PDF.';
    if (file.size > maxBytes()) {
      return `El PDF pesa ${formatBytes(file.size)} y el máximo es ${CONFIG.MAX_CV_SIZE_MB} MB. Comprímelo e inténtalo de nuevo.`;
    }
    return '';
  }

  /** Confirma la firma %PDF- del archivo; el navegador puede mentir sobre el MIME. */
  async function hasPdfSignature(file) {
    try {
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      return String.fromCharCode.apply(null, header) === '%PDF-';
    } catch {
      return true; // Si no podemos leerlo, n8n hará la validación definitiva.
    }
  }

  function setError(name, message) {
    const group = $(`[data-field="${name}"]`);
    const slot = $(`#err-${name}`);
    if (!group || !slot) return;

    slot.textContent = message;
    group.classList.toggle('is-invalid', Boolean(message));
    $$('input', group).forEach((input) => {
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    });
  }

  function validateField(name) {
    const message = validators[name] ? validators[name]() : '';
    setError(name, message);
    return !message;
  }

  function validateStep(step) {
    let firstInvalid = null;
    STEP_FIELDS[step].forEach((name) => {
      if (!validateField(name) && !firstInvalid) firstInvalid = name;
    });

    if (firstInvalid) {
      const group = $(`[data-field="${firstInvalid}"]`);
      const focusTarget = $('input', group);
      if (focusTarget) focusTarget.focus();
      return false;
    }
    return true;
  }

  /* ── Navegación entre pasos ─────────────────────────────── */

  function goToStep(step, { validate = true } = {}) {
    if (step === state.step) return;

    if (validate && step > state.step) {
      for (let current = state.step; current < step; current += 1) {
        if (!validateStep(current)) return;
      }
    }

    state.step = step;

    dom.steps.forEach((section) => {
      const isActive = Number(section.dataset.step) === step;
      section.hidden = !isActive;
      section.classList.toggle('is-active', isActive);
    });

    if (step === TOTAL_STEPS) renderSummary();
    renderSpine();

    const heading = $(`.step[data-step="${step}"] .step__title`);
    if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSpine() {
    dom.spine.style.setProperty('--fill', `${((state.step - 1) / (TOTAL_STEPS - 1)) * 100}%`);

    dom.spineItems.forEach((item) => {
      const step = Number(item.dataset.step);
      const button = $('.spine__btn', item);

      item.classList.toggle('is-current', step === state.step);
      item.classList.toggle('is-done', step < state.step);

      button.disabled = step > state.step;
      if (step === state.step) {
        button.setAttribute('aria-current', 'step');
      } else {
        button.removeAttribute('aria-current');
      }
    });

    dom.spineCaption.textContent = `Paso ${state.step} de ${TOTAL_STEPS} · ${STEP_NAMES[state.step - 1]}`;
  }

  function renderSummary() {
    dom.summary.nombre.textContent = getValue('nombre');
    dom.summary.correo.textContent = getValue('correo');
    dom.summary.telefono.textContent = getValue('telefono');
    dom.summary.vacante.textContent = vacanteLabel(getVacante());
    dom.summary.cv.textContent = state.file
      ? `${state.file.name} · ${formatBytes(state.file.size)}`
      : '—';
  }

  /* ── Vacantes ───────────────────────────────────────────── */

  function renderVacantes() {
    const markup = CONFIG.VACANTES.map((vacante) => `
      <label class="choice">
        <input class="choice__input" type="radio" name="vacante" value="${vacante.value}">
        <span class="choice__box">
          <span class="choice__dot" aria-hidden="true"></span>
          <span>
            <span class="choice__label">${vacante.label}</span>
            <span class="choice__hint">${vacante.hint}</span>
          </span>
          <span class="choice__code" aria-hidden="true">${vacante.value}</span>
        </span>
      </label>
    `).join('');

    dom.vacanteGroup.insertAdjacentHTML('beforeend', markup);
  }

  /* ── Archivo (hoja de vida) ─────────────────────────────── */

  async function acceptFile(file) {
    if (!file) return;

    const error = validateFile(file);
    if (error) {
      clearFile();
      setError('cv', error);
      return;
    }

    if (!(await hasPdfSignature(file))) {
      clearFile();
      setError('cv', 'El archivo no parece ser un PDF válido. Vuelve a exportarlo e inténtalo de nuevo.');
      return;
    }

    state.file = file;
    setError('cv', '');
    renderFileCard();
  }

  function renderFileCard() {
    const { name, size, type } = state.file;
    dom.fileName.textContent = name;
    dom.fileName.title = name;
    dom.fileMeta.textContent = `${(type || 'application/pdf')} · ${formatBytes(size)}`;
    dom.fileCard.hidden = false;
    dom.drop.hidden = true;
  }

  function clearFile() {
    state.file = null;
    dom.fileInput.value = '';
    dom.fileCard.hidden = true;
    dom.drop.hidden = false;
  }

  function bindDropzone() {
    dom.fileInput.addEventListener('change', (event) => {
      acceptFile(event.target.files[0]);
    });

    // El input es sr-only: el anillo de foco se refleja en la zona visible,
    // sea el dropzone o la ficha del archivo ya cargado.
    const reflectFocus = (hasFocus) => {
      dom.drop.classList.toggle('is-focus', hasFocus);
      dom.fileCard.classList.toggle('is-focus', hasFocus);
    };
    dom.fileInput.addEventListener('focus', () => reflectFocus(true));
    dom.fileInput.addEventListener('blur', () => reflectFocus(false));

    dom.removeFile.addEventListener('click', () => {
      clearFile();
      setError('cv', '');
      dom.fileInput.focus();
    });

    ['dragenter', 'dragover'].forEach((type) => {
      dom.drop.addEventListener(type, (event) => {
        event.preventDefault();
        dom.drop.classList.add('is-dragging');
      });
    });

    ['dragleave', 'dragend', 'drop'].forEach((type) => {
      dom.drop.addEventListener(type, () => dom.drop.classList.remove('is-dragging'));
    });

    dom.drop.addEventListener('drop', (event) => {
      event.preventDefault();
      acceptFile(event.dataTransfer.files[0]);
    });

    // Evita que soltar un archivo fuera de la zona lo abra en el navegador.
    ['dragover', 'drop'].forEach((type) => {
      window.addEventListener(type, (event) => {
        if (!dom.drop.contains(event.target)) event.preventDefault();
      });
    });
  }

  /* ── Envío al webhook de n8n ────────────────────────────── */

  function buildFormData() {
    const formData = new FormData();
    formData.append('nombre', getValue('nombre'));
    formData.append('correo', getValue('correo'));
    formData.append('telefono', getValue('telefono'));
    formData.append('vacante', getVacante());
    formData.append('cv', state.file, state.file.name);
    return formData;
  }

  function setSubmitting(isSubmitting) {
    state.submitting = isSubmitting;
    dom.submitBtn.disabled = isSubmitting;
    dom.submitBtn.classList.toggle('is-sending', isSubmitting);
    dom.submitBtn.setAttribute('aria-busy', String(isSubmitting));

    if (isSubmitting) {
      dom.submitLabel.textContent = 'Enviando postulación…';
      $$('.spine__btn').forEach((button) => { button.disabled = true; });
    } else {
      dom.submitLabel.textContent = state.failed ? 'Intentar nuevamente' : 'Enviar postulación';
      renderSpine();
    }
  }

  function showAlert(title, text) {
    state.failed = true;
    dom.alertTitle.textContent = title;
    dom.alertText.textContent = text;
    dom.alert.hidden = false;
  }

  function hideAlert() {
    state.failed = false;
    dom.alert.hidden = true;
  }

  function showSuccess() {
    state.sent = true;
    dom.form.hidden = true;
    dom.successView.hidden = false;
    dom.doneStamp.textContent = new Date().toLocaleString('es-CO', {
      dateStyle: 'long',
      timeStyle: 'short'
    });
    dom.successView.focus();
    dom.successView.scrollIntoView({ behavior: 'smooth', block: 'center' });

    dom.spineItems.forEach((item) => {
      item.classList.remove('is-current');
      item.classList.add('is-done');
      $('.spine__btn', item).disabled = true;
    });
    dom.spine.style.setProperty('--fill', '100%');
    dom.spineCaption.textContent = 'Postulación enviada';
  }

  async function submitApplication() {
    if (state.submitting || state.sent) return;

    for (let step = 1; step <= 3; step += 1) {
      if (!validateStep(step)) {
        goToStep(step, { validate: false });
        return;
      }
    }

    if (!CONFIG.N8N_WEBHOOK_URL || CONFIG.N8N_WEBHOOK_URL === WEBHOOK_PLACEHOLDER) {
      showAlert(
        'El formulario aún no está conectado.',
        'Falta configurar la URL del webhook de n8n en js/config.js (N8N_WEBHOOK_URL).'
      );
      setSubmitting(false);
      return;
    }

    hideAlert();
    setSubmitting(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    let delivered = false;

    try {
      const response = await fetch(CONFIG.N8N_WEBHOOK_URL, {
        method: 'POST',
        body: buildFormData(),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      delivered = true;
    } catch (error) {
      if (error.name === 'AbortError') {
        showAlert(
          'El envío tardó demasiado.',
          'La conexión no respondió a tiempo. Tus datos siguen aquí: inténtalo nuevamente.'
        );
      } else {
        showAlert(
          'No pudimos enviar tu postulación.',
          'Verifica tu conexión e inténtalo nuevamente. Tus datos y tu archivo siguen cargados.'
        );
      }
      console.error('[TalentFlow] Falló el envío al webhook:', error);
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }

    // Fuera del try: un fallo al pintar la confirmación no debe
    // presentarse al candidato como un envío fallido.
    if (delivered) showSuccess();
  }

  /* ── Eventos ────────────────────────────────────────────── */

  function bindEvents() {
    dom.form.addEventListener('click', (event) => {
      const next = event.target.closest('[data-next]');
      if (next) goToStep(Number(next.dataset.next));

      const back = event.target.closest('[data-back]');
      if (back) goToStep(Number(back.dataset.back), { validate: false });
    });

    dom.spine.addEventListener('click', (event) => {
      const button = event.target.closest('[data-goto]');
      if (button && !button.disabled) goToStep(Number(button.dataset.goto), { validate: false });
    });

    dom.form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (state.step < TOTAL_STEPS) {
        goToStep(state.step + 1);
        return;
      }
      submitApplication();
    });

    // Validación al salir del campo; corrección en vivo solo si ya hay error.
    ['nombre', 'correo', 'telefono'].forEach((name) => {
      const input = $(`#${name}`);
      input.addEventListener('blur', () => validateField(name));
      input.addEventListener('input', () => {
        if ($(`[data-field="${name}"]`).classList.contains('is-invalid')) validateField(name);
      });
    });

    dom.vacanteGroup.addEventListener('change', () => validateField('vacante'));
  }

  /* ── Arranque ───────────────────────────────────────────── */

  function init() {
    $$('[data-max-size]').forEach((node) => {
      node.textContent = `${CONFIG.MAX_CV_SIZE_MB} MB`;
    });

    renderVacantes();
    bindDropzone();
    bindEvents();
    renderSpine();
  }

  init();
})();
