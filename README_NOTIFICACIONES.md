# Notificaciones internas y correo opcional

## 1. Notificación interna en la app

Ejecuta en Supabase SQL Editor:

```sql
SQL_MIGRACION_NOTIFICACIONES.sql
```

Esto crea la tabla `notificaciones` con RLS seguro. Cuando un ticket se transfiere o se reasigna a otro agente, el agente destino verá una notificación dentro del sistema.

## 2. Correo opcional y seguro

El envío de correo no se realiza desde GitHub Pages para no exponer claves privadas. Se incluye una Supabase Edge Function opcional en:

```text
supabase/functions/notify-ticket-transfer/index.ts
```

Para habilitar correo:

```bash
supabase login
supabase link --project-ref nuzhzroufdpbmdomwfaf
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="TU_SERVICE_ROLE_KEY" RESEND_API_KEY="TU_RESEND_API_KEY" FROM_EMAIL="Soporte IT <soporte@cordillera.edu.ec>"
supabase functions deploy notify-ticket-transfer
```

La app intentará invocar `notify-ticket-transfer` después de crear la notificación interna. Si la función no está desplegada, la notificación interna sigue funcionando y no se expone ninguna clave.
