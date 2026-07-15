--------------------------------------------------------------------------------
-- ORDS — Listado de planos (LOV) para el hipervínculo "ir a otro plano"
--
-- El visor llama este endpoint enviando el id_en_repositorio del plano ACTUAL,
-- para que puedas EXCLUIRLO de la lista (no enlazar a sí mismo) o filtrar como
-- prefieras. Al elegir, el visor guarda repoId = id_en_repositorio en la figura.
--
-- Endpoint:  GET  {ORDS_BASE}/Reportes/planos-hub/planos-listado
--   · Sin header                  → todos los planos
--   · header id: 98765            → todos MENOS el plano actual (98765)
--   (el id va como HTTP HEADER `id` → bind :id_en_repositorio; NO en la URL.)
--
-- Respuesta (formato estándar de ORDS):
--   { "items": [ { "display": "...", "id_en_repositorio": "...", "nombre_archivo": "..." }, ... ] }
--
-- NOTA: los alias en MINÚSCULA (id_en_repositorio, nombre_archivo) son obligatorios:
--       el visor lee exactamente esas claves.
--------------------------------------------------------------------------------


--==============================================================================
-- OPCIÓN A — UI de ORDS (RESTful Services)
--   Módulo: Reportes · Plantilla: planos-hub/planos-listado · Handler GET
--   Source Type: "Consulta" (Query)  →  pega SOLO este SELECT.
--   En "Parameters" define: Name `id` · Bind `id_en_repositorio` · Source HTTP HEADER.
--==============================================================================
/*
select
       to_char(drp.fecha_revision, 'DD-MM-YYYY')
         || ' | ' || drp.numero || ' - ' || drp.descripcion   as display,
       gdc.id_en_repositorio   as id_en_repositorio,
       gdc.nombre_archivo       as nombre_archivo
  from drw_revisiones_plano drp
  left join gestion_documental_corporativa gdc
         on gdc.table_name    = 'DRW_REVISIONES_PLANO'
        and gdc.id_referencia = drp.id
 where gdc.id_en_repositorio is not null                 -- un hipervínculo necesita archivo
   and (:id_en_repositorio is null                       -- sin filtro → todos
        or gdc.id_en_repositorio <> :id_en_repositorio)  -- con filtro → excluye el plano actual
 order by drp.id desc
*/


--==============================================================================
-- OPCIÓN B — Crear todo por script (ORDS PL/SQL API)
--   Ejecutar conectado al schema REST-enabled (el mismo de ORDS_BASE/safws).
--==============================================================================
begin
  ords.define_template(
    p_module_name => 'Reportes',
    p_pattern     => 'planos-hub/planos-listado'
  );

  ords.define_handler(
    p_module_name => 'Reportes',
    p_pattern     => 'planos-hub/planos-listado',
    p_method      => 'GET',
    p_source_type => ords.source_type_query,
    p_source      => q'[
select
       to_char(drp.fecha_revision, 'DD-MM-YYYY')
         || ' | ' || drp.numero || ' - ' || drp.descripcion   as display,
       gdc.id_en_repositorio   as id_en_repositorio,
       gdc.nombre_archivo       as nombre_archivo
  from drw_revisiones_plano drp
  left join gestion_documental_corporativa gdc
         on gdc.table_name    = 'DRW_REVISIONES_PLANO'
        and gdc.id_referencia = drp.id
 where gdc.id_en_repositorio is not null
   and (:id_en_repositorio is null
        or gdc.id_en_repositorio <> :id_en_repositorio)
 order by drp.id desc
]'
  );

  -- Parámetro de filtro: header `id` (→ bind :id_en_repositorio). Sin header → todos.
  ords.define_parameter(
    p_module_name        => 'Reportes',
    p_pattern            => 'planos-hub/planos-listado',
    p_method             => 'GET',
    p_name               => 'id',
    p_bind_variable_name => 'id_en_repositorio',
    p_source_type        => 'HEADER',
    p_param_type         => 'STRING',     -- id_en_repositorio es VARCHAR2(100)
    p_access_method      => 'IN'
  );

  commit;
end;
/
