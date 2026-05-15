# Registro de Incidentes con Supabase + GitHub Pages

Este paquete reemplaza Firebase por Supabase y mantiene la aplicación como sitio estático compatible con GitHub Pages.

## 1. Crear tablas

1. Entra a Supabase > SQL Editor.
2. Copia y ejecuta `schema.sql`.
3. Verifica que existan estas tablas:
   - `agentes`
   - `directorio`
   - `tickets`
   - `app_config`

## 2. Autenticación

En Supabase > Authentication > Providers:

- Habilita Email.
- Configura si deseas exigir confirmación de correo.
- En URL Configuration agrega tu URL de GitHub Pages:

```text
https://TU_USUARIO.github.io/TU_REPOSITORIO/
```

Y si pruebas localmente:

```text
http://localhost:8000
```

La app usa:

- Registro de agente con correo y contraseña.
- Inicio de sesión con correo y contraseña.
- Recuperación de contraseña vía correo.
- Tabla `agentes` para perfil, rol y estado operativo.

## 3. Publicar en GitHub Pages

Sube como mínimo:

```text
index.html
.nojekyll
```

Luego habilita GitHub Pages desde Settings > Pages.

## 4. Valoración pública

Cuando un ticket está en estado `Resuelto`, el sistema genera un enlace así:

```text
https://TU_USUARIO.github.io/TU_REPOSITORIO/#rate_ticket=UUID&token=TOKEN
```

Ese enlace abre solo la pantalla de valoración. No muestra ni permite regresar al panel administrativo.

Al enviar la valoración:

- Guarda estrellas y comentario en `tickets`.
- Borra el `rating_token` para que el enlace quede usado.
- Oculta la pantalla y muestra un mensaje para cerrar la pestaña.

## 5. Importación masiva de tickets

En el módulo Registros se agregó `Importar CSV`.

Debe usar el mismo formato exportado desde Reportes:

```text
ID,Fecha,Agente,Cedula_Usuario,Nombre_Usuario,Asunto,Categoria,Subcategoria,Prioridad,Canal,Estado,Valoracion_Estrellas,Comentario_Valoracion
```

La importación usa `id_str` como clave única. Si el ID ya existe, actualiza el registro.

## 6. Dashboard

Incluye filtros dinámicos por:

- Fecha desde
- Fecha hasta
- Estado
- Categoría
- Agente

Incluye KPIs:

- Total de tickets
- Resueltos
- Seguimiento
- Promedio de valoración
- Porcentaje de resolución

Incluye gráficos:

- Pastel por estado
- Barras por categoría
- Línea de tendencia diaria
- Barras por agente

## 7. Notas de seguridad

La publishable key de Supabase puede estar en frontend, pero las reglas RLS son obligatorias. El archivo `schema.sql` activa RLS y define políticas para agentes autenticados y valoración pública con token.

Para producción institucional se recomienda:

- Revisar dominios permitidos en Supabase Auth.
- Desactivar registro público de agentes si solo un administrador debe crearlos.
- Promover manualmente a `admin` desde SQL cuando corresponda.
- Revisar logs y políticas antes de cargar datos reales.

## Módulo Informe Documental

Esta versión incluye el módulo **Informe Documental**, diseñado para generar evidencia institucional con el estilo de la Plantilla Documental Cordillera.

Funciones incluidas:

- filtros por fecha, estado, categoría y agente;
- vista previa de KPIs antes de exportar;
- exportación a DOCX institucional, PDF y HTML;
- anexo opcional con detalle completo de tickets;
- descarga de `PlantillaDocumentosCordilleraGeneral2024.docx` como plantilla base;
- registro de metadatos en la tabla `informes_documentales`.

Para habilitar el registro histórico de informes, ejecuta de nuevo el archivo `schema.sql` en Supabase SQL Editor. El script es seguro para re-ejecución porque usa `create table if not exists` y `drop policy if exists`.

## Solución si la pantalla queda en "Conectando con Supabase"

Esta versión incluye un arranque protegido. Si Supabase, una tabla, una política RLS o una librería externa falla, la app ya no queda cargando indefinidamente: mostrará una tarjeta con el error y botones para reintentar o limpiar sesión.

Verifica en este orden:

1. Ejecuta `schema.sql` completo en Supabase > SQL Editor.
2. Confirma que existen las tablas `agentes`, `directorio`, `tickets`, `app_config` e `informes_documentales`.
3. Revisa que Authentication > URL Configuration tenga:
   - `https://asesorvirtualcordillera2023-jpg.github.io/sistema-incidentes/`
   - `https://asesorvirtualcordillera2023-jpg.github.io/sistema-incidentes/**`
4. Abre la consola del navegador con F12 > Console si aparece una tarjeta de error.
5. Si el problema aparece después de iniciar sesión, usa el botón **Limpiar sesión** y vuelve a entrar.


## Actualización: Informe documental - Anexos y formato Cordillera

Esta versión agrega en el anexo del informe documental el campo **Tipo** antes del campo **Usuario**. El valor se obtiene desde el directorio institucional cuando el ticket conserva `usuario_id` o `usuario_cedula`.

También se reforzó el diseño del informe generado para que use imagen institucional embebida, paleta Cordillera, tipografía Arial y secciones documentales más cercanas a la plantilla institucional.

No requiere cambios adicionales en la base de datos para esta mejora.

## Mejora v - Administración de agentes sin cambios de schema

El módulo **Agentes** ahora permite a usuarios con rol `admin`:

- consultar agentes registrados;
- modificar nombre, correo operativo, rol y estado activo/inactivo;
- inactivar o eliminar lógicamente un agente sin borrar el usuario de Supabase Auth;
- generar una URL directa de ingreso para un agente con correo prellenado.

La URL generada abre el sistema en modo login. Si el agente todavía no tiene cuenta de Supabase Auth, puede usar la opción de registro con el correo y rol prellenados desde la invitación.

> Nota: por seguridad, desde GitHub Pages no se debe usar `service_role`. Por eso esta mejora no crea ni borra usuarios directamente en Supabase Auth desde el navegador. La eliminación realizada en la app es lógica: cambia el perfil operativo a inactivo.


## Carga completa del directorio

La versión actual consulta la tabla `directorio` por bloques de 1000 registros usando `.range()` hasta completar todos los registros disponibles. En la pantalla del módulo Directorio se agregó un filtro local y el contador muestra `filtrados / total`. No requiere cambios en `schema.sql`.

## Ajuste de Informe Documental - Anexos horizontales

La exportación del Informe Documental fue ajustada para que la sección **ANEXOS** use una tabla optimizada en orientación horizontal, con columnas fijas, tipografía Arial reducida, encabezados en verde institucional `#006068` y bordes visibles. En PDF la exportación usa orientación horizontal para evitar superposición de datos en tablas extensas.
