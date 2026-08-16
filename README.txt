SOLAPETXEA · Calendario Cloudflare Pages

Contenido:
- index.html  -> calendario definitivo con selección de fechas, restricciones, precios y WhatsApp.
- functions/api/calendar.js -> función para Cloudflare Pages que lee los iCal de Booking y Airbnb.

Lo que hace:
- combina Booking + Airbnb para Orixol y Oketa
- cachea la respuesta 5 minutos
- aplica restricciones mínimas:
  * Oketa: julio/agosto 5 noches; mayo/junio/septiembre 2 noches
  * Orixol: julio/agosto 2 noches
- calcula precio orientativo:
  * Orixol: 80 baja / 90 alta
  * Oketa: 95 baja / 120 alta
- envía WhatsApp con:
  * alojamiento
  * entrada
  * salida
  * noches
  * tarifa
  * precio orientativo
  * adultos
  * niños
  * nombre
  * teléfono
  * comentario

Subida a Cloudflare Pages:
1. Crear proyecto Pages.
2. Subir esta carpeta entera.
3. Framework preset: None.
4. Build command: vacío.
5. Build output directory: /
6. Publicar.

Después, en tu página de Hostalia, sustituye el iframe viejo por el nuevo dominio pages.dev.


PANEL DE ADMINISTRACIÓN

La ruta /admin permite gestionar sin tocar código:
- tarifas de temporada baja y alta
- periodos de temporada
- noches mínimas
- reservas directas y bloqueos manuales
- descuento para una sola persona

Configuración necesaria en Cloudflare:

1. Crear una base de datos D1.
2. Ejecutar el contenido de migrations/0001_calendar_config.sql en la consola de D1.
3. En Pages > Settings > Bindings, añadir la base D1 con el nombre exacto DB.
4. Añadir el secreto ADMIN_PASSWORD en Settings > Variables and Secrets.
5. Volver a desplegar el proyecto.
6. Abrir https://TU-DOMINIO.pages.dev/admin/ e introducir la clave.

También se puede proteger /admin/* y /api/admin/* mediante Cloudflare Access. Si se
usa Access, no es obligatorio introducir la clave en el formulario.

La configuración pública se obtiene en /api/settings. Las reservas de Booking y
Airbnb siguen llegando mediante iCal; los bloqueos manuales se combinan con ellas.
