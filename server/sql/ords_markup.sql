--------------------------------------------------------------------------------
-- ORDS — Persistencia de marcas del visor de planos
-- Tabla: DRW_REVISIONES_PLANO_ANOTACION
--
-- Modelo: UNA fila por (ID_EN_REPOSITORIO, USUARIO_GRABACION).
--   · Cada usuario es dueño de SU capa; se guarda toda su "sesión" (todas las
--     páginas) en ANOTACION_JSON como {usuario, usuario_id, id_revision, sesion}.
--   · ANOTACION_JSON guarda el cuerpo COMPLETO que envía el visor, así el GET
--     devuelve tal cual {usuario, usuario_id, sesion} sin reconstruir nada.
--
-- Contrato con el frontend (API_MARKUP = .../Reportes/planos-hub/markup):
--   POST  planos-hub/markup   header id: <id>   body: { usuario, usuario_id, id_revision, sesion }
--   GET   planos-hub/markup   header id: <id> → { capas: [ { usuario, usuario_id, sesion }, ... ] }
--   (header `id` = ID_EN_REPOSITORIO, el id del PDF en el gestor documental; se
--    bindea a :id. YA NO viaja en la URL — llega como HTTP HEADER.)
--
-- USUARIO_GRABACION (NUMBER) = usuario_id, que el visor toma de
-- localStorage.codigo_usuario. El NOMBRE viaja en "usuario" (para mostrar/atribuir).
--
-- ▸ POR QUÉ "la columna JSON quedaba vacía":
--   El handler debe leer el cuerpo con :body_text UNA sola vez y NO sobrescribir
--   si llega vacío. Aquí se asigna l_body := :body_text y, si viene vacío, el
--   handler responde 400 y NO toca la fila (nunca borra lo ya guardado).
--------------------------------------------------------------------------------


--==============================================================================
-- OPCIÓN A — Pegar los cuerpos PL/SQL en la UI de ORDS (RESTful Services)
--   Módulo: Reportes   ·   Plantilla URI: planos-hub/markup
--==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- HANDLER  POST  planos-hub/markup   (Source Type: PL/SQL)
-- ─────────────────────────────────────────────────────────────────────────────
/*
declare
  l_body    clob := :body_text;          -- cuerpo JSON crudo (leer UNA sola vez)
  l_usuario varchar2(200 char);
  l_uid     number;
  l_rev     number;
  l_px      number;
  l_unidad  varchar2(10 char);
begin
  -- Guardia: si el cuerpo viene vacío, NO tocar la fila (evita dejar el JSON vacío)
  if l_body is null or dbms_lob.getlength(l_body) = 0 then
    :status := 400;
    htp.p('{"ok":false,"error":"cuerpo vacio"}');
    return;
  end if;

  l_usuario := json_value(l_body, '$.usuario');
  l_uid     := json_value(l_body, '$.usuario_id'  returning number);
  l_rev     := json_value(l_body, '$.id_revision' returning number);
  l_px      := json_value(l_body, '$.sesion.scale.pxPerUnit' returning number);
  l_unidad  := json_value(l_body, '$.sesion.scale.unit');

  if l_uid is null then
    l_uid := to_number(regexp_substr(nvl(:current_user, '0'), '\d+'));
  end if;
  l_uid := nvl(l_uid, 0);

  merge into drw_revisiones_plano_anotacion d
  using (select :id as id_repo, l_uid as usr from dual) s
     on (d.id_en_repositorio = s.id_repo and d.usuario_grabacion = s.usr)
  when matched then update set
        d.anotacion_json        = l_body,
        d.id_revisiones_plano   = nvl(l_rev, d.id_revisiones_plano),
        d.escala_pixeles        = nvl(l_px, d.escala_pixeles),
        d.escala_distancia_real = case when l_px is not null then 1 else d.escala_distancia_real end,
        d.escala_unidad_medida  = nvl(l_unidad, d.escala_unidad_medida),
        d.usuario_modificacion  = s.usr,
        d.fecha_modificacion    = sysdate
  when not matched then insert
        (id_en_repositorio, id_revisiones_plano, anotacion_json,
         escala_pixeles, escala_distancia_real, escala_unidad_medida,
         usuario_grabacion, fecha_grabacion)
      values
        (s.id_repo, l_rev, l_body,
         nvl(l_px, 0), case when l_px is not null then 1 else 0 end, l_unidad,
         s.usr, sysdate);

  :status := 200;
  htp.p('{"ok":true}');
exception
  when others then
    :status := 500;
    htp.p('{"ok":false,"error":' || apex_json.stringify(sqlerrm) || '}');
end;
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- HANDLER  GET  planos-hub/markup   (Source Type: PL/SQL)
-- Devuelve { capas: [ {usuario, usuario_id, sesion}, ... ] }
-- ─────────────────────────────────────────────────────────────────────────────
/*
declare
  l_out   clob;
  l_first boolean := true;
  l_len   pls_integer;
  l_off   pls_integer := 1;
  c_amt   constant pls_integer := 8000;
begin
  -- Armamos el arreglo JSON manualmente (compatible con cualquier versión de
  -- Oracle; evita JSON_ARRAYAGG ... ORDER BY ... RETURNING CLOB → ORA-00907).
  dbms_lob.createtemporary(l_out, true);
  dbms_lob.append(l_out, to_clob('{"capas":['));

  for r in (
    select anotacion_json aj
      from drw_revisiones_plano_anotacion
     where id_en_repositorio = :id
     order by nvl(fecha_modificacion, fecha_grabacion)
  ) loop
    if not l_first then dbms_lob.append(l_out, to_clob(',')); end if;
    l_first := false;
    if r.aj is not null and dbms_lob.getlength(r.aj) > 0 then
      dbms_lob.append(l_out, r.aj);          -- ya es JSON válido (CHECK is json)
    else
      dbms_lob.append(l_out, to_clob('null'));
    end if;
  end loop;

  dbms_lob.append(l_out, to_clob(']}'));

  owa_util.mime_header('application/json', false);
  owa_util.http_header_close;

  l_len := dbms_lob.getlength(l_out);
  while l_off <= l_len loop
    htp.prn(dbms_lob.substr(l_out, c_amt, l_off));
    l_off := l_off + c_amt;
  end loop;
  :status := 200;
end;
*/


--==============================================================================
-- OPCIÓN B — Crear todo por script (ORDS PL/SQL API)
--   Ejecutar conectado al schema REST-enabled (el mismo de ORDS_BASE/safws).
--==============================================================================
begin
  ords.define_template(
    p_module_name => 'Reportes',
    p_pattern     => 'planos-hub/markup'
  );

  ords.define_handler(
    p_module_name => 'Reportes',
    p_pattern     => 'planos-hub/markup',
    p_method      => 'POST',
    p_source_type => ords.source_type_plsql,
    p_source      => q'[
declare
  l_body    clob := :body_text;
  l_usuario varchar2(200 char);
  l_uid     number;
  l_rev     number;
  l_px      number;
  l_unidad  varchar2(10 char);
begin
  if l_body is null or dbms_lob.getlength(l_body) = 0 then
    :status := 400;
    htp.p('{"ok":false,"error":"cuerpo vacio"}');
    return;
  end if;

  l_usuario := json_value(l_body, '$.usuario');
  l_uid     := json_value(l_body, '$.usuario_id'  returning number);
  l_rev     := json_value(l_body, '$.id_revision' returning number);
  l_px      := json_value(l_body, '$.sesion.scale.pxPerUnit' returning number);
  l_unidad  := json_value(l_body, '$.sesion.scale.unit');

  if l_uid is null then
    l_uid := to_number(regexp_substr(nvl(:current_user, '0'), '\d+'));
  end if;
  l_uid := nvl(l_uid, 0);

  merge into drw_revisiones_plano_anotacion d
  using (select :id as id_repo, l_uid as usr from dual) s
     on (d.id_en_repositorio = s.id_repo and d.usuario_grabacion = s.usr)
  when matched then update set
        d.anotacion_json        = l_body,
        d.id_revisiones_plano   = nvl(l_rev, d.id_revisiones_plano),
        d.escala_pixeles        = nvl(l_px, d.escala_pixeles),
        d.escala_distancia_real = case when l_px is not null then 1 else d.escala_distancia_real end,
        d.escala_unidad_medida  = nvl(l_unidad, d.escala_unidad_medida),
        d.usuario_modificacion  = s.usr,
        d.fecha_modificacion    = sysdate
  when not matched then insert
        (id_en_repositorio, id_revisiones_plano, anotacion_json,
         escala_pixeles, escala_distancia_real, escala_unidad_medida,
         usuario_grabacion, fecha_grabacion)
      values
        (s.id_repo, l_rev, l_body,
         nvl(l_px, 0), case when l_px is not null then 1 else 0 end, l_unidad,
         s.usr, sysdate);

  :status := 200;
  htp.p('{"ok":true}');
exception
  when others then
    :status := 500;
    htp.p('{"ok":false,"error":' || apex_json.stringify(sqlerrm) || '}');
end;
]'
  );

  ords.define_handler(
    p_module_name => 'Reportes',
    p_pattern     => 'planos-hub/markup',
    p_method      => 'GET',
    p_source_type => ords.source_type_plsql,
    p_source      => q'[
declare
  l_out   clob;
  l_first boolean := true;
  l_len   pls_integer;
  l_off   pls_integer := 1;
  c_amt   constant pls_integer := 8000;
begin
  -- Armamos el arreglo JSON manualmente (compatible con cualquier versión de
  -- Oracle; evita JSON_ARRAYAGG ... ORDER BY ... RETURNING CLOB → ORA-00907).
  dbms_lob.createtemporary(l_out, true);
  dbms_lob.append(l_out, to_clob('{"capas":['));

  for r in (
    select anotacion_json aj
      from drw_revisiones_plano_anotacion
     where id_en_repositorio = :id
     order by nvl(fecha_modificacion, fecha_grabacion)
  ) loop
    if not l_first then dbms_lob.append(l_out, to_clob(',')); end if;
    l_first := false;
    if r.aj is not null and dbms_lob.getlength(r.aj) > 0 then
      dbms_lob.append(l_out, r.aj);          -- ya es JSON válido (CHECK is json)
    else
      dbms_lob.append(l_out, to_clob('null'));
    end if;
  end loop;

  dbms_lob.append(l_out, to_clob(']}'));

  owa_util.mime_header('application/json', false);
  owa_util.http_header_close;

  l_len := dbms_lob.getlength(l_out);
  while l_off <= l_len loop
    htp.prn(dbms_lob.substr(l_out, c_amt, l_off));
    l_off := l_off + c_amt;
  end loop;
  :status := 200;
end;
]'
  );

  -- El id_en_repositorio llega como HEADER `id` y se bindea a :id en ambos
  -- handlers (igual que el endpoint 'documento'). NO va en la URL.
  ords.define_parameter(
    p_module_name        => 'Reportes',
    p_pattern            => 'planos-hub/markup',
    p_method             => 'POST',
    p_name               => 'id',
    p_bind_variable_name => 'id',
    p_source_type        => 'HEADER',
    p_param_type         => 'STRING',
    p_access_method      => 'IN'
  );

  ords.define_parameter(
    p_module_name        => 'Reportes',
    p_pattern            => 'planos-hub/markup',
    p_method             => 'GET',
    p_name               => 'id',
    p_bind_variable_name => 'id',
    p_source_type        => 'HEADER',
    p_param_type         => 'STRING',
    p_access_method      => 'IN'
  );

  commit;
end;
/
