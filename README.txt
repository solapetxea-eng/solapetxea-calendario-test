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
