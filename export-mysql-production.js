/*
 * Exportacion Supabase -> MySQL/PHP Produccion v3
 * Compatible con schema_mysql_produccion_v15_1_paridad_supabase.sql
 * - Solo admin
 * - Usa un puente estable con el frontend principal
 * - Tolera tablas opcionales ausentes
 * - Reintenta consultas cuando la tabla no tiene created_at
 * - Informa el error exacto sin romper la aplicacion
 */
(function(){
  'use strict';

  const MYSQL_DB = 'sistema_incidentes';
  const TEMP_PASSWORD_HASH = '$2y$12$/K.pO3npR3hMMC49HB.deeBvzM3ZcMWJFdYj.WUaNnu6CThnusltO'; // Cambio2026!
  const bridge = () => window.__SQL_EXPORT_APP__ || {};
  const client = () => {
    const c = bridge().getClient?.();
    if(!c) throw new Error('El cliente de Supabase no esta disponible. Cierra sesion, vuelve a ingresar y reintenta.');
    return c;
  };
  const toast = (m,t) => bridge().toast?.(m,t);
  const isAdminSafe = () => !!bridge().isAdmin?.();
  const currentProfileSafe = () => bridge().getCurrentProfile?.() || null;
  const currentUserSafe = () => bridge().getCurrentUser?.() || null;
  const configSafe = () => bridge().getConfig?.() || {};
  const periodsSafe = () => bridge().getPeriods?.() || [];
  const cached = name => {
    try { const v=bridge().getCached?.(name); return Array.isArray(v)?v:[]; } catch(_){ return []; }
  };

  const raw = sql => ({__mysqlRaw:true, sql});
  const escSql = value => String(value ?? '')
    .replace(/\\/g,'\\\\')
    .replace(/\0/g,'\\0')
    .replace(/\n/g,'\\n')
    .replace(/\r/g,'\\r')
    .replace(/'/g,"''");
  const sqlValue = value => {
    if(value && value.__mysqlRaw) return value.sql;
    if(value === null || value === undefined || value === '') return value === '' ? "''" : 'NULL';
    if(typeof value === 'boolean') return value ? '1' : '0';
    if(typeof value === 'number' && Number.isFinite(value)) return String(value);
    if(typeof value === 'object') return `'${escSql(JSON.stringify(value))}'`;
    return `'${escSql(value)}'`;
  };
  const mysqlDate = value => {
    if(!value) return null;
    const d = new Date(value);
    if(Number.isNaN(d.getTime())) return String(value).replace('T',' ').replace(/Z$/,'').slice(0,19);
    const p = n => String(n).padStart(2,'0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  };
  const jsonObj = v => {
    if(v == null) return null;
    if(typeof v === 'string') { try{return JSON.parse(v);}catch(_){return v;} }
    return v;
  };
  const mysqlRole = role => {
    const r=String(role||'agent').toLowerCase();
    if(r==='supervisora') return 'supervisora_secretaria';
    if(r==='admin secretaria' || r==='admin-secretaria') return 'admin_secretaria';
    const allowed=['agent','advanced','coordinator','admin','secretaria','supervisora_secretaria','admin_secretaria'];
    return allowed.includes(r)?r:'agent';
  };
  const secRole = role => {
    const r=String(role||'secretaria').toLowerCase();
    if(r.includes('admin')) return 'admin';
    if(r.includes('super')) return 'supervisora';
    return 'secretaria';
  };
  const normalizePriority = p => ['Baja','Media','Alta','Crítica'].includes(p) ? p : 'Media';
  const normalizeITState = s => ['Requiere Seguimiento','Resuelto','Cancelado'].includes(s) ? s : (String(s||'').toLowerCase().includes('resuel')?'Resuelto':String(s||'').toLowerCase().includes('cancel')?'Cancelado':'Requiere Seguimiento');

  function header(title){
    return `-- ============================================================================\n-- ${title}\n-- Exportado desde Supabase para PHP/MySQL de produccion\n-- Compatible con database/schema_mysql.sql V15.1+\n-- Fecha: ${new Date().toISOString()}\n-- ============================================================================\nSET NAMES utf8mb4;\nSET time_zone = '-05:00';\nSET FOREIGN_KEY_CHECKS = 0;\nUSE ${MYSQL_DB};\nSTART TRANSACTION;\n\n`;
  }
  const footer = () => `\nCOMMIT;\nSET FOREIGN_KEY_CHECKS = 1;\n`;
  function downloadSql(name, sql){
    const blobUrl=URL.createObjectURL(new Blob([sql],{type:'application/sql;charset=utf-8'}));
    const a=document.createElement('a');
    a.href=blobUrl; a.download=name; a.style.display='none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(blobUrl),2000);
  }
  function insertChunks(table, cols, rows, updateCols, chunk=200){
    if(!rows.length) return `-- ${table}: sin registros.\n\n`;
    let out='';
    for(let i=0;i<rows.length;i+=chunk){
      const part=rows.slice(i,i+chunk);
      out += `INSERT INTO \`${table}\` (${cols.map(c=>`\`${c}\``).join(', ')}) VALUES\n`;
      out += part.map(r=>'('+r.map(sqlValue).join(', ')+')').join(',\n');
      if(updateCols?.length) out += `\nON DUPLICATE KEY UPDATE\n  `+updateCols.map(c=>`\`${c}\`=VALUES(\`${c}\`)`).join(',\n  ');
      out += ';\n\n';
    }
    return out;
  }

  function isMissingRelationError(err){
    const m=String(err?.message||err||'').toLowerCase();
    return m.includes('does not exist') || m.includes('could not find the table') || m.includes('relation')&&m.includes('does not exist');
  }
  function isMissingOrderColumnError(err, col){
    const m=String(err?.message||err||'').toLowerCase();
    return m.includes(String(col).toLowerCase()) && (m.includes('column') || m.includes('does not exist'));
  }
  async function pageQuery(table, from, to, orderCol){
    let q=client().from(table).select('*').range(from,to);
    if(orderCol) q=q.order(orderCol,{ascending:true});
    return await q;
  }
  async function fetchAll(table, orderCol='created_at', options={}){
    const {optional=false, allowCache=true} = options;
    const rows=[]; let from=0; const step=1000;
    try{
      while(true){
        let result=await pageQuery(table,from,from+step-1,orderCol);
        if(result.error && orderCol && isMissingOrderColumnError(result.error,orderCol)){
          result=await pageQuery(table,from,from+step-1,null);
        }
        if(result.error) throw result.error;
        const batch=result.data||[]; rows.push(...batch);
        if(batch.length<step) break;
        from += step;
      }
      return rows;
    }catch(e){
      const c=allowCache?cached(table):[];
      if(c.length){
        console.warn(`Export SQL: ${table} se obtuvo desde cache por error de consulta:`,e?.message||e);
        return c;
      }
      if(optional || isMissingRelationError(e)){
        console.warn(`Export SQL: tabla opcional ${table} no disponible:`,e?.message||e);
        return [];
      }
      throw new Error(`${table}: ${e?.message||e}`);
    }
  }
  const tryFetchAll = (table,orderCol='created_at') => fetchAll(table,orderCol,{optional:true});

  function makeMaps(ctx){
    const agents=ctx.agents||[], directory=ctx.directory||[], tickets=ctx.tickets||[], secUsers=ctx.secUsers||[], secTickets=ctx.secTickets||[];
    return {
      agentById:new Map(agents.map(x=>[String(x.id),x])), dirById:new Map(directory.map(x=>[String(x.id),x])), ticketById:new Map(tickets.map(x=>[String(x.id),x])), secUserById:new Map(secUsers.map(x=>[String(x.id),x])), secTicketById:new Map(secTickets.map(x=>[String(x.id),x]))
    };
  }
  const agentIdExpr=(m,id,name)=>{ const a=id?m.agentById.get(String(id)):null; if(a?.email) return raw(`(SELECT id FROM agentes WHERE email=${sqlValue(a.email)} LIMIT 1)`); if(name) return raw(`(SELECT id FROM agentes WHERE nombre_completo=${sqlValue(name)} LIMIT 1)`); return null; };
  const dirIdExpr=(m,id,cedula)=>{ const u=id?m.dirById.get(String(id)):null; const c=cedula||u?.cedula; return c?raw(`(SELECT id FROM directorio WHERE cedula=${sqlValue(c)} LIMIT 1)`):null; };
  const ticketIdExpr=(m,id,idStr)=>{ const t=id?m.ticketById.get(String(id)):null; const code=idStr||t?.id_str; return code?raw(`(SELECT id FROM tickets WHERE id_str=${sqlValue(code)} LIMIT 1)`):null; };
  const secUserIdExpr=(m,id,name)=>{ const u=id?m.secUserById.get(String(id)):null; if(u?.email) return raw(`(SELECT id FROM secretaria_usuarios WHERE email=${sqlValue(u.email)} ORDER BY id LIMIT 1)`); const n=name||u?.nombre; return n?raw(`(SELECT id FROM secretaria_usuarios WHERE nombre=${sqlValue(n)} ORDER BY id LIMIT 1)`):null; };
  const secTicketIdExpr=(m,id,code)=>{ const t=id?m.secTicketById.get(String(id)):null; const c=code||t?.codigo; return c?raw(`(SELECT id FROM secretaria_tickets WHERE codigo=${sqlValue(c)} LIMIT 1)`):null; };

  function agentsSql(rows){
    const cols=['nombre_completo','email','password_hash','rol','permisos','activo','foto_url','created_at','updated_at'];
    const vals=rows.filter(a=>a.email).map(a=>[a.nombre_completo||a.email||'Agente',a.email||'',TEMP_PASSWORD_HASH,mysqlRole(a.rol),jsonObj(a.permisos)||{},a.activo!==false,a.foto_url||null,mysqlDate(a.created_at),mysqlDate(a.updated_at)||mysqlDate(a.created_at)]);
    let out=`-- AGENTES\n-- Para agentes NUEVOS la clave temporal es Cambio2026!; en agentes existentes se conserva la clave MySQL actual.\n`;
    if(!vals.length) return out+'-- Sin registros.\n\n';
    for(let i=0;i<vals.length;i+=100){ const p=vals.slice(i,i+100); out+=`INSERT INTO agentes (${cols.map(c=>`\`${c}\``).join(', ')}) VALUES\n${p.map(r=>'('+r.map(sqlValue).join(', ')+')').join(',\n')}\nON DUPLICATE KEY UPDATE\n  nombre_completo=VALUES(nombre_completo),\n  rol=VALUES(rol),\n  permisos=VALUES(permisos),\n  activo=VALUES(activo),\n  foto_url=VALUES(foto_url),\n  updated_at=VALUES(updated_at);\n\n`; }
    return out;
  }
  function directorySql(rows){
    const cols=['cedula','nombres','correo','correo_personal','celular','whatsapp','carrera','nivel','tipo','periodo','created_at','updated_at'];
    const vals=rows.filter(u=>u.cedula).map(u=>[u.cedula,u.nombres||'',u.correo||null,u.correo_personal||null,u.celular||null,u.whatsapp||null,u.carrera||null,u.nivel||null,['Estudiante','Docente','Administrativo'].includes(u.tipo)?u.tipo:'Estudiante',u.periodo||null,mysqlDate(u.created_at),mysqlDate(u.updated_at)||mysqlDate(u.created_at)]);
    return '-- DIRECTORIO\n'+insertChunks('directorio',cols,vals,['nombres','correo','correo_personal','celular','whatsapp','carrera','nivel','tipo','periodo','updated_at']);
  }
  function periodsSql(){
    const rows=periodsSafe().map(p=>[p.nombre,!!p.activo,p.habilitado!==false]);
    return '-- PERIODOS ACADEMICOS\n'+insertChunks('periodos_academicos',['nombre','activo','habilitado'],rows,['activo','habilitado'],200);
  }
  function configSql(ctx){
    const profile=currentProfileSafe(), user=currentUserSafe();
    const email=ctx.currentEmail||profile?.email||user?.email||null;
    const updated=email?raw(`(SELECT id FROM agentes WHERE email=${sqlValue(email)} LIMIT 1)`):null;
    const cfg=configSafe();
    const vals=[1,cfg.categorias||[],cfg.canales||[],cfg.secretaria_categorias||[],cfg.secretaria_canales||[],updated];
    return `-- CONFIGURACION\nINSERT INTO app_config (id,categorias,canales,secretaria_categorias,secretaria_canales,updated_by) VALUES (${vals.map(sqlValue).join(', ')})\nON DUPLICATE KEY UPDATE categorias=VALUES(categorias), canales=VALUES(canales), secretaria_categorias=VALUES(secretaria_categorias), secretaria_canales=VALUES(secretaria_canales), updated_by=VALUES(updated_by);\n\n`;
  }
  function secUsersSql(rows,m){
    let out='-- USUARIOS DE SECRETARIA\n';
    for(const u of rows){
      const email=u.email||null, name=u.nombre||'';
      const agent=email?raw(`(SELECT id FROM agentes WHERE email=${sqlValue(email)} LIMIT 1)`):agentIdExpr(m,u.agente_id,name);
      const permissions=jsonObj(u.permisos);
      const values=[agent,name,email,secRole(u.rol),u.activo!==false,permissions,mysqlDate(u.created_at)];
      const key=email?`email=${sqlValue(email)}`:`nombre=${sqlValue(name)}`;
      out+=`UPDATE secretaria_usuarios SET agente_id=${sqlValue(agent)}, nombre=${sqlValue(name)}, email=${sqlValue(email)}, rol=${sqlValue(secRole(u.rol))}, activo=${sqlValue(u.activo!==false)}, permisos=${sqlValue(permissions)} WHERE ${key};\n`;
      out+=`INSERT INTO secretaria_usuarios (agente_id,nombre,email,rol,activo,permisos,created_at) SELECT ${values.map(sqlValue).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM secretaria_usuarios WHERE ${key});\n`;
    }
    return out+'\n';
  }
  function ticketsSql(rows,m){
    const cols=['id_str','fecha_texto','usuario_id','secretaria_ticket_id','usuario_cedula','usuario_nombre','agente_id','agente_nombre','assigned_agent_id','assigned_agent_name','asunto','categoria','subcategoria','prioridad','canal','descripcion','estado','rating_token','valoracion_calificacion','valoracion_comentario','valoracion_fecha','assigned_at','resolved_at','resolution_minutes','last_status_change_at','created_at','updated_at'];
    const vals=rows.filter(t=>t.id_str).map(t=>{
      const secT=t.secretaria_ticket_id?m.secTicketById.get(String(t.secretaria_ticket_id)):null;
      return [t.id_str,t.fecha_texto||null,dirIdExpr(m,t.usuario_id,t.usuario_cedula),secT?secTicketIdExpr(m,secT.id,secT.codigo):null,t.usuario_cedula||m.dirById.get(String(t.usuario_id))?.cedula||null,t.usuario_nombre||null,agentIdExpr(m,t.agente_id,t.agente_nombre),t.agente_nombre||null,agentIdExpr(m,t.assigned_agent_id,t.assigned_agent_name),t.assigned_agent_name||null,t.asunto||'Sin asunto',t.categoria||'Soporte Técnico',t.subcategoria||null,normalizePriority(t.prioridad),t.canal||'Portal Web',t.descripcion||null,normalizeITState(t.estado),t.rating_token||null,t.valoracion_calificacion||null,t.valoracion_comentario||null,mysqlDate(t.valoracion_fecha),mysqlDate(t.assigned_at),mysqlDate(t.resolved_at),t.resolution_minutes??null,mysqlDate(t.last_status_change_at),mysqlDate(t.created_at),mysqlDate(t.updated_at)||mysqlDate(t.created_at)];
    });
    return '-- TICKETS IT\n'+insertChunks('tickets',cols,vals,['fecha_texto','usuario_id','secretaria_ticket_id','usuario_cedula','usuario_nombre','agente_id','agente_nombre','assigned_agent_id','assigned_agent_name','asunto','categoria','subcategoria','prioridad','canal','descripcion','estado','rating_token','valoracion_calificacion','valoracion_comentario','valoracion_fecha','assigned_at','resolved_at','resolution_minutes','last_status_change_at','updated_at'],100);
  }
  function followupsSql(rows,m){
    let out='-- SEGUIMIENTOS IT\n';
    for(const s of rows){
      const ticket=ticketIdExpr(m,s.ticket_id,null), created=mysqlDate(s.created_at);
      const vals=[ticket,s.accion||'Seguimiento',s.estado_anterior||null,s.estado_nuevo||null,agentIdExpr(m,s.agente_origen_id,s.agente_origen_nombre),s.agente_origen_nombre||null,agentIdExpr(m,s.agente_destino_id,s.agente_destino_nombre),s.agente_destino_nombre||null,s.comentario||'',agentIdExpr(m,s.created_by,s.created_by_nombre),s.created_by_nombre||null,created];
      const exists=`ticket_id=${sqlValue(vals[0])} AND accion=${sqlValue(vals[1])} AND created_at=${sqlValue(created)} AND COALESCE(comentario,'')=${sqlValue(s.comentario||'')}`;
      out+=`INSERT INTO ticket_seguimientos (ticket_id,accion,estado_anterior,estado_nuevo,agente_origen_id,agente_origen_nombre,agente_destino_id,agente_destino_nombre,comentario,created_by,created_by_nombre,created_at) SELECT ${vals.map(sqlValue).join(', ')} WHERE ${sqlValue(vals[0])} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ticket_seguimientos WHERE ${exists});\n`;
    }
    return out+'\n';
  }
  function notificationsSql(rows,m){
    let out='-- NOTIFICACIONES\n';
    for(const n of rows){
      const agent=agentIdExpr(m,n.agent_id,null), ticket=ticketIdExpr(m,n.ticket_id,null), created=mysqlDate(n.created_at);
      const vals=[agent,ticket,n.tipo||'informacion',n.titulo||'Notificación',n.mensaje||'',jsonObj(n.data),!!(n.leido??n.leida),mysqlDate(n.read_at),agentIdExpr(m,n.created_by,n.created_by_nombre),n.created_by_nombre||null,created];
      const exists=`agent_id=${sqlValue(agent)} AND titulo=${sqlValue(n.titulo||'Notificación')} AND created_at=${sqlValue(created)}`;
      out+=`INSERT INTO notificaciones (agent_id,ticket_id,tipo,titulo,mensaje,data,leida,read_at,created_by,created_by_nombre,created_at) SELECT ${vals.map(sqlValue).join(', ')} WHERE ${sqlValue(agent)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notificaciones WHERE ${exists});\n`;
    }
    return out+'\n';
  }
  function secTicketsSql(rows,m){
    const cols=['codigo','usuario_tipo','estudiante_id','cedula','nombre','correo','correo_personal','celular','whatsapp','canal','asunto','categoria','descripcion','estado','secretaria_id','secretaria_nombre','supervisora_id','transferido_it','it_ticket_id','rating_token','valoracion_calificacion','valoracion_comentario','valoracion_fecha','resolved_at','resolution_minutes','last_status_change_at','created_by','created_at','updated_at'];
    const vals=rows.filter(t=>t.codigo).map(t=>{
      const it=t.it_ticket_id?m.ticketById.get(String(t.it_ticket_id)):null;
      return [t.codigo,t.usuario_tipo||'Estudiante',dirIdExpr(m,t.estudiante_id,t.cedula),t.cedula||null,t.nombre||'Usuario',t.correo||null,t.correo_personal||null,t.celular||null,t.whatsapp||null,t.canal||null,t.asunto||'Atención Secretaría',t.categoria||null,t.descripcion||null,t.estado||'Abierto',secUserIdExpr(m,t.secretaria_id,t.secretaria_nombre),t.secretaria_nombre||null,secUserIdExpr(m,t.supervisora_id,null),!!t.transferido_it,it?ticketIdExpr(m,it.id,it.id_str):null,t.rating_token||null,t.valoracion_calificacion||null,t.valoracion_comentario||null,mysqlDate(t.valoracion_fecha),mysqlDate(t.resolved_at),t.resolution_minutes??null,mysqlDate(t.last_status_change_at),agentIdExpr(m,t.created_by,null),mysqlDate(t.created_at),mysqlDate(t.updated_at)||mysqlDate(t.created_at)];
    });
    return '-- TICKETS SECRETARIA\n'+insertChunks('secretaria_tickets',cols,vals,['usuario_tipo','estudiante_id','cedula','nombre','correo','correo_personal','celular','whatsapp','canal','asunto','categoria','descripcion','estado','secretaria_id','secretaria_nombre','supervisora_id','transferido_it','it_ticket_id','rating_token','valoracion_calificacion','valoracion_comentario','valoracion_fecha','resolved_at','resolution_minutes','last_status_change_at','updated_at'],100);
  }
  function secHistorySql(rows,m){
    let out='-- HISTORIAL SECRETARIA\n';
    for(const h of rows){ const t=h.ticket_id?m.secTicketById.get(String(h.ticket_id)):null; const ticket=secTicketIdExpr(m,h.ticket_id,t?.codigo), created=mysqlDate(h.created_at); const vals=[ticket,h.accion||'',h.estado_anterior||null,h.estado_nuevo||null,h.secretaria_origen||null,h.secretaria_destino||null,h.comentario||'',h.created_by||null,created]; const exists=`ticket_id=${sqlValue(ticket)} AND created_at=${sqlValue(created)} AND COALESCE(accion,'')=${sqlValue(h.accion||'')} AND COALESCE(comentario,'')=${sqlValue(h.comentario||'')}`; out+=`INSERT INTO secretaria_historial (ticket_id,accion,estado_anterior,estado_nuevo,secretaria_origen,secretaria_destino,comentario,created_by,created_at) SELECT ${vals.map(sqlValue).join(', ')} WHERE ${sqlValue(ticket)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM secretaria_historial WHERE ${exists});\n`; }
    return out+'\n';
  }
  function secTransfersSql(rows,m){
    let out='-- TRANSFERENCIAS SECRETARIA\n';
    for(const x of rows){ const ticket=secTicketIdExpr(m,x.ticket_id,x.ticket_codigo), code=x.ticket_codigo||m.secTicketById.get(String(x.ticket_id))?.codigo||''; const origen=secUserIdExpr(m,x.secretaria_origen_id,x.secretaria_origen_nombre), destino=secUserIdExpr(m,x.secretaria_destino_id,x.secretaria_destino_nombre), created=mysqlDate(x.created_at); const creator=x.created_by_nombre?raw(`(SELECT id FROM agentes WHERE nombre_completo=${sqlValue(x.created_by_nombre)} LIMIT 1)`):null; const vals=[ticket,code,origen,x.secretaria_origen_nombre||null,destino,x.secretaria_destino_nombre||'',x.comentario||'',x.estado==='Recibida'?'Recibida':'Pendiente',creator,x.created_by_nombre||null,created,mysqlDate(x.received_at)]; const exists=`ticket_codigo=${sqlValue(code)} AND secretaria_destino_nombre=${sqlValue(x.secretaria_destino_nombre||'')} AND created_at=${sqlValue(created)}`; out+=`INSERT INTO secretaria_transferencias (ticket_id,ticket_codigo,secretaria_origen_id,secretaria_origen_nombre,secretaria_destino_id,secretaria_destino_nombre,comentario,estado,created_by_id,created_by_nombre,created_at,received_at) SELECT ${vals.map(sqlValue).join(', ')} WHERE ${sqlValue(ticket)} IS NOT NULL AND ${sqlValue(destino)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM secretaria_transferencias WHERE ${exists});\n`; }
    return out+'\n';
  }
  function secAuditSql(rows,m){
    let out='-- AUDITORIA SECRETARIA\n';
    for(const a of rows){ const user=secUserIdExpr(m,a.usuario_id,a.usuario_nombre); const created=mysqlDate(a.created_at); const vals=[user,a.usuario_nombre||null,a.accion||'',a.modulo||null,a.registro_id?Number.isFinite(Number(a.registro_id))?Number(a.registro_id):null:null,jsonObj(a.datos_antes),jsonObj(a.datos_despues),a.ip||null,created]; const exists=`COALESCE(usuario_nombre,'')=${sqlValue(a.usuario_nombre||'')} AND COALESCE(accion,'')=${sqlValue(a.accion||'')} AND created_at=${sqlValue(created)}`; out+=`INSERT INTO secretaria_auditoria (usuario_id,usuario_nombre,accion,modulo,registro_id,datos_antes,datos_despues,ip,created_at) SELECT ${vals.map(sqlValue).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM secretaria_auditoria WHERE ${exists});\n`; }
    return out+'\n';
  }
  function invitationsSql(rows,m){ const cols=['token_hash','email','nombre','rol','permisos','expires_at','used_at','created_by','created_by_nombre','created_at']; const vals=rows.filter(x=>x.token_hash).map(x=>[x.token_hash,x.email||'',x.nombre||null,mysqlRole(x.rol),jsonObj(x.permisos),mysqlDate(x.expires_at),mysqlDate(x.used_at),agentIdExpr(m,x.created_by,x.created_by_nombre),x.created_by_nombre||null,mysqlDate(x.created_at)]); return '-- INVITACIONES DE AGENTES\n'+insertChunks('invitaciones_agentes',cols,vals,['email','nombre','rol','permisos','expires_at','used_at','created_by','created_by_nombre'],100); }
  function reportsLogSql(rows,m){ let out='-- HISTORIAL DE INFORMES DOCUMENTALES\n'; for(const r of rows){ const creator=agentIdExpr(m,r.generado_por,r.generado_por_nombre), created=mysqlDate(r.created_at); const vals=[r.titulo||'Informe',creator,r.generado_por_nombre||null,jsonObj(r.filtros),jsonObj(r.indicadores),Number(r.total_tickets)||0,r.formato||'html',created]; const exists=`titulo=${sqlValue(r.titulo||'Informe')} AND formato=${sqlValue(r.formato||'html')} AND created_at=${sqlValue(created)}`; out+=`INSERT INTO informes_documentales (titulo,generado_por,generado_por_nombre,filtros,indicadores,total_tickets,formato,created_at) SELECT ${vals.map(sqlValue).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM informes_documentales WHERE ${exists});\n`; } return out+'\n'; }
  function relationFixSql(ctx,m){ let out='-- RECONSTRUCCION DE RELACIONES CRUZADAS IT <-> SECRETARIA\n'; for(const t of ctx.tickets||[]){ const st=t.secretaria_ticket_id?m.secTicketById.get(String(t.secretaria_ticket_id)):null; if(st?.codigo&&t.id_str) out+=`UPDATE tickets SET secretaria_ticket_id=(SELECT id FROM secretaria_tickets WHERE codigo=${sqlValue(st.codigo)} LIMIT 1) WHERE id_str=${sqlValue(t.id_str)};\n`; } for(const s of ctx.secTickets||[]){ const it=s.it_ticket_id?m.ticketById.get(String(s.it_ticket_id)):null; if(it?.id_str&&s.codigo) out+=`UPDATE secretaria_tickets SET it_ticket_id=(SELECT id FROM tickets WHERE id_str=${sqlValue(it.id_str)} LIMIT 1) WHERE codigo=${sqlValue(s.codigo)};\n`; } return out+'\n'; }

  async function coreContext(){
    const profile=currentProfileSafe(), user=currentUserSafe();
    return {
      agents:await fetchAll('agentes'),
      directory:await fetchAll('directorio'),
      tickets:await fetchAll('tickets'),
      secUsers:await fetchAll('secretaria_usuarios','created_at',{optional:true}),
      secTickets:await fetchAll('secretaria_tickets','created_at',{optional:true}),
      currentEmail:profile?.email||user?.email||null
    };
  }
  function setPanelError(message){
    const status=document.getElementById('sql-mig-status');
    if(status) status.innerHTML=`<span class="text-red-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${String(message||'Error').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>`;
  }
  async function runExport(label,fn){
    if(!isAdminSafe()){ toast('La exportación SQL está disponible únicamente para administradores.','error'); return; }
    try{
      toast(`Preparando SQL: ${label}...`);
      await fn();
      toast(`SQL ${label} generado.`);
    }catch(e){
      console.error('Export SQL PHP/MySQL:',e);
      const msg=e?.message||String(e);
      setPanelError(`No se pudo generar ${label}: ${msg}`);
      toast(`No se pudo generar SQL: ${msg}`,'error');
    }
  }

  window.exportAgentsSQLMySQL=()=>runExport('Agentes',async()=>{const agents=await fetchAll('agentes');downloadSql('01_agentes_mysql_produccion.sql',header('AGENTES')+agentsSql(agents)+footer());});
  window.exportDirectorioSQLMySQL=()=>runExport('Directorio',async()=>{const directory=await fetchAll('directorio');downloadSql('02_directorio_mysql_produccion.sql',header('DIRECTORIO')+directorySql(directory)+footer());});
  window.exportTicketsSQLMySQL=()=>runExport('Tickets IT',async()=>{const ctx=await coreContext();const m=makeMaps(ctx);const follow=await tryFetchAll('ticket_seguimientos');downloadSql('03_tickets_it_mysql_produccion.sql',header('TICKETS IT Y SEGUIMIENTOS')+ticketsSql(ctx.tickets,m)+followupsSql(follow,m)+relationFixSql(ctx,m)+footer());});
  window.exportNotificationsSQLMySQL=()=>runExport('Notificaciones',async()=>{const ctx=await coreContext();const m=makeMaps(ctx);const rows=await fetchAll('notificaciones','created_at',{optional:true});downloadSql('04_notificaciones_mysql_produccion.sql',header('NOTIFICACIONES')+notificationsSql(rows,m)+footer());});
  window.exportPeriodosSQLMySQL=()=>runExport('Periodos',async()=>{downloadSql('05_periodos_mysql_produccion.sql',header('PERIODOS ACADEMICOS')+periodsSql()+footer());});
  window.exportSecretariaSQLMySQL=()=>runExport('Secretaría',async()=>{const ctx=await coreContext();const m=makeMaps(ctx);const hist=await tryFetchAll('secretaria_historial'),trans=await tryFetchAll('secretaria_transferencias'),aud=await tryFetchAll('secretaria_auditoria');downloadSql('06_secretaria_mysql_produccion.sql',header('ATENCION SECRETARIA')+secUsersSql(ctx.secUsers,m)+secTicketsSql(ctx.secTickets,m)+secHistorySql(hist,m)+secTransfersSql(trans,m)+secAuditSql(aud,m)+relationFixSql(ctx,m)+footer());});
  window.exportSecretariaUsersSQLMySQL=()=>runExport('Personal Secretaría',async()=>{const ctx=await coreContext();const m=makeMaps(ctx);downloadSql('06a_secretaria_usuarios_mysql_produccion.sql',header('PERSONAL SECRETARIA')+secUsersSql(ctx.secUsers,m)+footer());});
  window.exportSecretariaTransfersSQLMySQL=()=>runExport('Transferencias Secretaría',async()=>{const ctx=await coreContext();const m=makeMaps(ctx);const trans=await fetchAll('secretaria_transferencias','created_at',{optional:true});downloadSql('06b_secretaria_transferencias_mysql_produccion.sql',header('TRANSFERENCIAS SECRETARIA')+secTransfersSql(trans,m)+footer());});
  window.exportConfigSQLMySQL=()=>runExport('Configuración',async()=>{const profile=currentProfileSafe(),user=currentUserSafe();const ctx={currentEmail:profile?.email||user?.email||null};downloadSql('07_configuracion_mysql_produccion.sql',header('CONFIGURACION')+periodsSql()+configSql(ctx)+footer());});
  window.exportAuditoriaSQLMySQL=()=>runExport('Auditoría Secretaría',async()=>{const ctx=await coreContext();const m=makeMaps(ctx);const aud=await tryFetchAll('secretaria_auditoria');downloadSql('08_auditoria_secretaria_mysql_produccion.sql',header('AUDITORIA SECRETARIA')+secAuditSql(aud,m)+footer());});
  window.exportAllSQLMySQL=()=>runExport('COMPLETO PHP/MySQL',async()=>{
    const ctx=await coreContext(), m=makeMaps(ctx);
    const [follow,notifications,hist,trans,aud,invitations,reports]=await Promise.all([
      tryFetchAll('ticket_seguimientos'),tryFetchAll('notificaciones'),tryFetchAll('secretaria_historial'),tryFetchAll('secretaria_transferencias'),tryFetchAll('secretaria_auditoria'),tryFetchAll('invitaciones_agentes'),tryFetchAll('informes_documentales')
    ]);
    let sql=header('MIGRACION COMPLETA SUPABASE -> PHP/MYSQL');
    sql+='-- IMPORTANTE: ejecutar primero el schema MySQL V15.1 o superior.\n-- Las tablas auxiliares que no existan en Supabase se omiten sin cancelar la exportacion.\n\n';
    sql+=agentsSql(ctx.agents)+directorySql(ctx.directory)+periodsSql()+configSql(ctx)+secUsersSql(ctx.secUsers,m)+ticketsSql(ctx.tickets,m)+secTicketsSql(ctx.secTickets,m)+followupsSql(follow,m)+notificationsSql(notifications,m)+secHistorySql(hist,m)+secTransfersSql(trans,m)+secAuditSql(aud,m)+invitationsSql(invitations,m)+reportsLogSql(reports,m)+relationFixSql(ctx,m);
    sql+='\n-- COMPROBACION RAPIDA\nSELECT COUNT(*) AS agentes FROM agentes;\nSELECT COUNT(*) AS directorio FROM directorio;\nSELECT COUNT(*) AS tickets_it FROM tickets;\nSELECT COUNT(*) AS tickets_secretaria FROM secretaria_tickets;\n';
    sql+=footer();
    downloadSql(`MIGRACION_COMPLETA_SUPABASE_A_PHP_MYSQL_${new Date().toISOString().slice(0,10)}.sql`,sql);
  });

  async function countTable(table){
    try{
      const {count,error}=await client().from(table).select('id',{count:'exact',head:true});
      if(error) throw error;
      return Number(count||0);
    }catch(e){
      console.warn('Resumen SQL PHP:',table,e?.message||e);
      const c=cached(table); return c.length?c.length:null;
    }
  }
  function setCount(id,value){ const el=document.getElementById(id); if(el) el.textContent=value===null?'N/D':Number(value||0).toLocaleString('es-EC'); }
  window.renderMySQLExportAdminPanel=async function(){
    if(!isAdminSafe()) return;
    const status=document.getElementById('sql-mig-status');
    if(status) status.innerHTML='<i class="fa-solid fa-spinner fa-spin mr-1"></i> Consultando registros disponibles en Supabase...';
    try{
      const [agentes,directorio,tickets,sec,notif,trans]=await Promise.all([countTable('agentes'),countTable('directorio'),countTable('tickets'),countTable('secretaria_tickets'),countTable('notificaciones'),countTable('secretaria_transferencias')]);
      setCount('sql-mig-count-agentes',agentes); setCount('sql-mig-count-directorio',directorio); setCount('sql-mig-count-tickets',tickets); setCount('sql-mig-count-sec',sec); setCount('sql-mig-count-notif',notif); setCount('sql-mig-count-trans',trans);
      if(status){ const total=[agentes,directorio,tickets,sec,notif,trans].filter(v=>Number.isFinite(v)).reduce((a,b)=>a+b,0); status.innerHTML=`<i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i> Resumen actualizado. ${total.toLocaleString('es-EC')} registros contabilizados. Tablas no disponibles se muestran como N/D y no bloquean el SQL completo.`; }
    }catch(e){ console.error('Resumen migracion SQL:',e); setPanelError(`No se pudo actualizar el resumen: ${e?.message||e}`); }
  };
})();
