# 🚀 Solapetxea Calendario - Desarrollo Local

## Inicio rápido

Para probar los cambios **sin servidor Cloudflare**, simplemente abre:

### 📅 Calendario Público
```
Abre: index.html
```

### ⚙️ Panel de Administración
```
Abre: admin/index.html
```

---

## ✅ Características implementadas

### **Mejora 1: Bloquear edición sin autenticación**
- ✅ Campos deshabilitados al cargar la página
- ✅ Se habilitan solo tras introducir contraseña (cualquier valor en modo dev)
- ✅ Si contraseña incorrecta, permanecen bloqueados

### **Mejora 2: Gestión de años desde el panel**
- ✅ Sección "Años disponibles" en panel admin
- ✅ Botón "+ Añadir año" (2000-2100)
- ✅ Eliminar años futuros con confirmación
- ✅ Calendario se actualiza dinámicamente
- ✅ Datos guardados en localStorage

### **Mejora 3: Sistema de ofertas**
- ✅ Sección "Ofertas especiales" en panel admin
- ✅ Crear/editar/eliminar ofertas
- ✅ Configurar: unit, fechas, nombre, tipo (precio fijo o % descuento), valor
- ✅ Activar/desactivar sin borrar
- ✅ En calendario: se muestran con badge "OFERTA"
- ✅ Precios calculados correctamente por noche
- ✅ Ofertas no hacen disponibles fechas bloqueadas

---

## 🔧 Cómo funciona el desarrollo local

Cuando abres `index.html` o `admin/index.html` desde tu navegador:

1. **Se detecta modo development** (file:// protocol)
2. **Carga automáticamente** `mock-api.js`
3. **Intercepta todas las llamadas fetch** a las APIs
4. **Simula respuestas** usando datos en localStorage
5. **Los cambios se guardan** automáticamente en localStorage

### APIs mockeadas:
- `/api/calendar` - Retorna datos de ocupancy + ofertas
- `/api/settings` - Configuración pública
- `/api/admin/config` - CRUD de configuración
- `/api/admin/years` - CRUD de años
- `/api/admin/offers` - CRUD de ofertas

---

## 💡 Contraseña en desarrollo

En modo local (sin servidor real), **cualquier contraseña funciona** para desbloquear el panel admin. Esto es solo para probar.

---

## 🗂️ Estructura de archivos

```
.
├── index.html                  # Calendario público
├── admin/index.html            # Panel de administración
├── functions/
│   ├── api/
│   │   ├── calendar.js        # Endpoint de calendario
│   │   ├── settings.js        # Endpoint de configuración pública
│   │   └── admin/
│   │       ├── config.js      # CRUD de configuración
│   │       ├── years.js       # CRUD de años (NUEVO)
│   │       └── offers.js      # CRUD de ofertas (NUEVO)
│   └── _shared/
│       └── calendar-config.js # Funciones compartidas
├── migrations/
│   ├── 0001_calendar_config.sql    # Tabla inicial
│   ├── 0002_active_years.sql       # Tabla de años (NUEVA)
│   └── 0003_offers.sql             # Tabla de ofertas (NUEVA)
├── mock-api.js                 # Mock para desarrollo local (NUEVO)
└── dev-server.html            # Landing page (NUEVO)
```

---

## 📝 Instrucciones para producción

Cuando estés listo para desplegar:

1. **Ejecuta las migraciones en D1:**
   ```bash
   wrangler d1 execute [DB_NAME] --file ./migrations/0001_calendar_config.sql
   wrangler d1 execute [DB_NAME] --file ./migrations/0002_active_years.sql
   wrangler d1 execute [DB_NAME] --file ./migrations/0003_offers.sql
   ```

2. **Configura variables de entorno:**
   - `ADMIN_PASSWORD` - Tu contraseña de admin

3. **Deploy:**
   ```bash
   wrangler publish
   ```

---

## 🧪 Cómo probar cada mejora

### Prueba 1: Bloqueo de autenticación
1. Abre `/admin/index.html`
2. Verifica que TODOS los campos estén deshabilitados (grises)
3. Escribe una contraseña cualquiera en el campo de "Clave de administración"
4. Pulsa "Cargar datos"
5. ✅ Los campos deben habilitarse

### Prueba 2: Gestión de años
1. En el panel admin, busca la sección "Años disponibles"
2. Verifica que aparezcan 2026 y 2027
3. Pulsa "+ Añadir año"
4. Introduce 2028
5. ✅ Debe aparecer 2028 en la lista
6. Abre el calendario público
7. ✅ Debe haber un botón para año 2028

### Prueba 3: Sistema de ofertas
1. En el panel admin, busca la sección "Ofertas especiales"
2. Pulsa "+ Añadir oferta"
3. Completa los datos:
   - Alojamiento: Oketa
   - Desde: 2026-09-01
   - Hasta: 2026-09-10
   - Nombre: "Oferta septiembre"
   - Tipo: Precio fijo (50 €)
4. Pulsa "Guardar cambios"
5. ✅ La oferta aparece en la tabla
6. Abre el calendario público
7. ✅ Del 1-10 de septiembre aparece badge "OFERTA"
8. ✅ Si seleccionas esas fechas, el precio debería ser 50€/noche

---

## 📱 localStorage - Datos guardados

Los datos de desarrollo se guardan en:
```
localStorage['solapetxea_dev_data']
```

Estructura:
```json
{
  "calendar": { /* configuración */ },
  "years": [2026, 2027, 2028],
  "offers": [
    {
      "id": "offer-...",
      "unit": "oketa",
      "start_date": "2026-09-01",
      "end_date": "2026-09-10",
      "name": "Oferta septiembre",
      "discount_type": "fixed_price",
      "discount_value": 50,
      "enabled": true
    }
  ]
}
```

Para **borrar todos los datos de prueba**:
- Abre DevTools (F12)
- Console → `localStorage.removeItem('solapetxea_dev_data')`
- Recarga la página

---

## ⚠️ Notas importantes

- **Mock solo para desarrollo**: En producción, estos endpoints llaman a Cloudflare Functions + D1
- **Ocupancy simulada**: Las fechas ocupadas en modo dev son ficticias (Oketa bloqueado 15-20 julio)
- **Datos en localStorage**: Se pierden si limpias el caché del navegador
- **Sin autenticación real**: Cualquier contraseña funciona en desarrollo

---

## 🚀 Próximos pasos

1. **Prueba local**: Abre los archivos y verifica todo funciona
2. **Configura Cloudflare**: Crea tu D1 database
3. **Deploy**: `wrangler publish`
4. **Integra iCal real**: Actualiza URLs de Booking/Airbnb en `functions/api/calendar.js`

---

¿Necesitas ayuda? Revisa la consola (F12) para ver logs del mock API.
