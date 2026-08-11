/* ============================================================
   CONFIGURACIÓN — TalentFlow
   ------------------------------------------------------------
   👉 PEGA AQUÍ LA URL DEL WEBHOOK DE n8n (única ubicación).
      Ejemplo:
      N8N_WEBHOOK_URL: "https://mi-n8n.com/webhook/preseleccion-candidatos"
   ============================================================ */

const CONFIG = {
  /** URL del webhook de producción de n8n. Reemplaza el placeholder. */
  N8N_WEBHOOK_URL: 'PEGAR_AQUI_WEBHOOK_N8N',

  /** Tamaño máximo aceptado para la hoja de vida, en megabytes. */
  MAX_CV_SIZE_MB: 5,

  /** Tiempo máximo de espera del envío antes de cancelarlo, en milisegundos. */
  REQUEST_TIMEOUT_MS: 30000,

  /** Vacantes disponibles. `value` es lo que recibe n8n. */
  VACANTES: [
    {
      value: 'backend-jr',
      label: 'Backend Junior',
      hint: 'APIs REST · Node.js o Python · Bases de datos'
    },
    {
      value: 'frontend-jr',
      label: 'Frontend Junior',
      hint: 'HTML · CSS · JavaScript · Consumo de APIs'
    },
    {
      value: 'data-jr',
      label: 'Data Junior',
      hint: 'SQL · Python · Limpieza y análisis de datos'
    }
  ]
};

window.CONFIG = CONFIG;
