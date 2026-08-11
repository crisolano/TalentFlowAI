# TalentFlow — Formulario de postulación

Frontend del sistema de preselección de candidatos. Recopila los datos del
candidato y su hoja de vida en PDF, y los envía a un webhook de n8n mediante
`multipart/form-data`.

El frontend **solo** recopila, valida y envía. El procesamiento del PDF, la IA,
el cálculo del score, la detección de duplicados y Google Sheets viven en n8n.

```
Candidato → Formulario web → POST multipart → Webhook n8n → … → Google Sheets
```

## Estructura

```
index.html          Marcado del formulario (4 pasos + pantalla de éxito)
css/styles.css      Estilos, tokens de diseño y responsive
js/config.js        ⚙️  Configuración: URL del webhook, tamaño máximo, vacantes
js/app.js           Validación, manejo del archivo y envío al webhook
```

## 1. Conectar el webhook de n8n

Abre `js/config.js` y reemplaza el placeholder por tu URL real:

```javascript
const CONFIG = {
  N8N_WEBHOOK_URL: 'PEGAR_AQUI_WEBHOOK_N8N',   // ← aquí
  ...
};
```

```javascript
N8N_WEBHOOK_URL: 'https://mi-n8n.com/webhook/preseleccion-candidatos',
```

Es el **único** lugar donde aparece la URL. Mientras siga el placeholder, el
formulario valida todo con normalidad y, al enviar, avisa que falta configurarlo
en lugar de fallar con un error de red confuso.

En el mismo archivo puedes ajustar:

| Clave | Uso |
|---|---|
| `MAX_CV_SIZE_MB` | Tamaño máximo del PDF (por defecto 5 MB) |
| `REQUEST_TIMEOUT_MS` | Tiempo de espera antes de cancelar el envío (30 s) |
| `VACANTES` | Lista de vacantes: `value` es lo que recibe n8n |

Al agregar una vacante en `VACANTES`, la opción aparece en el paso 2
automáticamente; no hay que tocar el HTML.

## 2. Ejecutar en local

Sírvelo por HTTP; no lo abras con doble clic (`file://` rompe las peticiones):

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Luego entra a <http://localhost:8080>.

## 3. Qué envía el frontend

Un `POST` con `FormData` (el navegador fija el `Content-Type` y el `boundary`;
el código no los toca):

| Campo | Tipo | Obligatorio | Ejemplo |
|---|---|---|---|
| `nombre` | texto | sí | `María Fernanda Ríos` |
| `correo` | texto | sí | `maria.rios@correo.com` |
| `telefono` | texto | sí | `+57 300 123 4567` |
| `vacante` | texto (slug) | sí | `frontend-jr` |
| `experiencia` | texto numérico, 0–50 | sí | `3` |
| `tecnologias` | texto libre | no | `JavaScript, React, SQL` |
| `consentimiento` | texto | sí | `si` |
| `cv` | **archivo binario** | sí | `CV_Maria_Rios.pdf` |

El PDF viaja como archivo real en `multipart/form-data`, con su nombre y su MIME
original. No se convierte a Base64 ni a JSON.

`consentimiento` es la autorización de tratamiento de datos personales. El
formulario no permite enviar sin marcarla, y siempre llega con el valor `si`;
guárdala junto con la fecha, es el registro de la aceptación.

La petición incluye el header `ngrok-skip-browser-warning: true` para evitar la
página de advertencia de ngrok. No se fija `Content-Type`: lo arma el navegador
con el boundary del multipart.

Los demás campos de la hoja de cálculo (`ID_Candidato`, `Experiencia`,
`Habilidades`, `Nivel_Educativo`, `Score_Compatibilidad`, `Estado`,
`Fecha_Postulacion`, `Observaciones_IA`, `Revision_RRHH`) los genera n8n.

## 4. Qué configurar en n8n

1. **Nodo Webhook**
   - HTTP Method: `POST`
   - Path: el que uses en `N8N_WEBHOOK_URL`
   - Respond: `Immediately` (o `Using Respond to Webhook`)
   - Binary Property / *Binary File*: activado, para que llegue el PDF
2. **CORS y preflight** — el navegador llama al webhook desde otro origen. En el
   nodo Webhook, en *Options*, agrega `Allowed Origins (CORS)` con el dominio
   donde publiques el formulario (o `*` mientras pruebas). Además, el header
   `ngrok-skip-browser-warning` **no** es de los permitidos por defecto en CORS,
   así que el navegador manda antes una petición `OPTIONS`: n8n debe responderla
   aceptando ese header. Si el preflight falla, la alternativa es quitar el
   header y usar un dominio propio de ngrok (los de pago no muestran el aviso).
3. **URL de prueba vs. producción** — `/webhook-test/...` solo responde mientras
   el editor está en modo escucha; `/webhook/...` requiere el workflow activo.
   El proyecto apunta a la de producción.
4. **Códigos de respuesta** — el frontend los distingue:

   | Código | Campo que lee | Qué hace el formulario |
   |---|---|---|
   | `200` | `json.ticket` | Pantalla de éxito con el ticket. Si el campo no viene, muestra el éxito sin ticket. |
   | `400` | `json.error` | Muestra ese texto como error corregible, conservando los datos. |
   | `409` | `json.error` | Duplicado: muestra ese texto y **retira el botón de envío**. Se reactiva si el candidato cambia de correo o de vacante. |
   | otro | — | Error genérico recuperable. |

   Son los **únicos** nombres que se leen: `id`, `ticketId`, `ticket_id`,
   `mensaje` o `message` se ignoran. Responde en JSON, como objeto o como
   arreglo de un item (formato habitual de n8n). Un cuerpo HTML se descarta,
   para que la página de aviso de ngrok no pase por éxito.
5. **Validación en servidor** — repite en n8n las validaciones de correo,
   teléfono, experiencia, consentimiento, y tipo y tamaño del archivo. Las del
   navegador son de usabilidad y cualquiera puede saltárselas.
6. **Duplicados** — comprueba `correo + vacante` en n8n y responde **409** para
   que el formulario muestre el mensaje correcto en vez de un error genérico.

## 5. Probar la conexión

Sin n8n a mano, apunta `N8N_WEBHOOK_URL` a <https://webhook.site> y revisa que
lleguen los cinco campos y el PDF como adjunto. Con n8n:

1. Abre el workflow y pulsa **Listen for test event**.
2. Copia la *Test URL* en `js/config.js`.
3. Completa el formulario y envía.
4. En n8n verifica que el ítem trae los cuatro campos de texto y una propiedad
   binaria con el PDF.

Para revisar la petición desde el navegador: DevTools → **Network** → la
petición al webhook → pestaña *Payload*.

## Notas de comportamiento

- La validación bloquea el avance entre pasos; se puede retroceder libremente.
- El PDF se verifica por extensión, MIME, tamaño y firma `%PDF-`.
- Durante el envío el botón se deshabilita, así que no hay envíos dobles.
- Si el envío falla, los datos y el archivo se conservan para reintentar.
- El candidato nunca ve score, evaluación de IA ni clasificación.
