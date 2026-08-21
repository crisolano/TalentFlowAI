/* ============================================================
   CONFIGURACIÓN — Dashboard TalentFlow
   ------------------------------------------------------------
   👉 PEGA AQUÍ LA URL DEL WEBHOOK GET DE n8n (flujo
      "Flujo 03 - Dashboard (Datos Agregados)", en n8n/flujo-dashboard-datos.json).
      Ejemplo:
      DASHBOARD_WEBHOOK_URL: "https://mi-n8n.com/webhook/dashboard-data"

   Mientras quede el placeholder, el dashboard muestra datos de
   ejemplo (sintéticos, no son candidatos reales) para que puedas
   ver el diseño terminado sin depender de n8n.
   ============================================================ */

const DASHBOARD_CONFIG = {
  /** URL del webhook GET que devuelve los datos agregados. Reemplaza el placeholder. */
  DASHBOARD_WEBHOOK_URL: 'https://shining-marathon-pessimism.ngrok-free.dev/webhook/dashboard-data',

  /** Tiempo máximo de espera de la petición, en milisegundos. */
  REQUEST_TIMEOUT_MS: 15000
};

window.DASHBOARD_CONFIG = DASHBOARD_CONFIG;
