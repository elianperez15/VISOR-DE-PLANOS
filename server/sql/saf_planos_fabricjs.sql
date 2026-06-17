-- ═══════════════════════════════════════════════════════════════
-- SAF Planos — Visor con Fabric.js
-- Schema Oracle 19c+
-- ═══════════════════════════════════════════════════════════════

-- Tabla de documentos PDF registrados
CREATE TABLE SAF_PLANO_DOCS (
  DOC_ID         NUMBER         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  DOC_NOMBRE     VARCHAR2(255)  NOT NULL,
  DOC_RUTA       VARCHAR2(2000),               -- ruta o URL del PDF en servidor
  PROYECTO_ID    NUMBER,
  ACTIVO         CHAR(1)        DEFAULT 'S' NOT NULL,
  FECHA_CREACION TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
  CREADO_POR     VARCHAR2(100)  DEFAULT USER
);

COMMENT ON TABLE  SAF_PLANO_DOCS                IS 'Documentos PDF de planos de construcción';
COMMENT ON COLUMN SAF_PLANO_DOCS.DOC_ID         IS 'PK autoincremental';
COMMENT ON COLUMN SAF_PLANO_DOCS.DOC_NOMBRE     IS 'Nombre original del archivo PDF';
COMMENT ON COLUMN SAF_PLANO_DOCS.DOC_RUTA       IS 'Ruta al PDF en el servidor';
COMMENT ON COLUMN SAF_PLANO_DOCS.PROYECTO_ID    IS 'FK al proyecto SAF (opcional)';


-- Tabla de markup por página
CREATE TABLE SAF_PLANO_MARKUP (
  MARKUP_ID      NUMBER         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  DOC_ID         NUMBER         NOT NULL REFERENCES SAF_PLANO_DOCS(DOC_ID),
  PAGINA         NUMBER         NOT NULL,
  OBJETOS_JSON   CLOB,                          -- array de objetos Fabric.js en JSON
  ESCALA_PX      NUMBER,                        -- píxeles por unidad de escala calibrada
  ESCALA_UNIDAD  VARCHAR2(10),                  -- 'm', 'cm', 'mm', 'ft', 'in'
  FECHA_MOD      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
  MODIFICADO_POR VARCHAR2(100)  DEFAULT USER,
  CONSTRAINT CHK_PAGINA CHECK (PAGINA > 0),
  CONSTRAINT UQ_DOC_PAGINA UNIQUE (DOC_ID, PAGINA)
);

COMMENT ON TABLE  SAF_PLANO_MARKUP               IS 'Markup Fabric.js por página de plano';
COMMENT ON COLUMN SAF_PLANO_MARKUP.OBJETOS_JSON  IS 'Serialización JSON de objetos Fabric.js (markup layer)';
COMMENT ON COLUMN SAF_PLANO_MARKUP.ESCALA_PX     IS 'Píxeles por unidad real (calibración de escala)';
COMMENT ON COLUMN SAF_PLANO_MARKUP.ESCALA_UNIDAD IS 'Unidad de medida: m, cm, mm, ft, in';

-- Índice para acceso rápido por documento
CREATE INDEX IDX_PLANO_MARKUP_DOC ON SAF_PLANO_MARKUP(DOC_ID);


-- ── Package PKG_PLANO_MARKUP ────────────────────────────────────
CREATE OR REPLACE PACKAGE PKG_PLANO_MARKUP AS

  -- Guardar o actualizar markup de una página
  PROCEDURE GUARDAR_MARKUP (
    p_doc_id         IN NUMBER,
    p_pagina         IN NUMBER,
    p_objetos_json   IN CLOB,
    p_escala_px      IN NUMBER    DEFAULT NULL,
    p_escala_unidad  IN VARCHAR2  DEFAULT NULL,
    p_usuario        IN VARCHAR2  DEFAULT USER
  );

  -- Obtener markup de una página
  FUNCTION OBTENER_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  ) RETURN CLOB;

  -- Obtener sesión completa de un documento (todas las páginas)
  FUNCTION OBTENER_SESION (
    p_doc_id IN NUMBER
  ) RETURN CLOB;

  -- Limpiar markup de una página
  PROCEDURE LIMPIAR_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  );

  -- Limpiar markup de todo un documento
  PROCEDURE LIMPIAR_DOC (
    p_doc_id IN NUMBER
  );

END PKG_PLANO_MARKUP;
/


CREATE OR REPLACE PACKAGE BODY PKG_PLANO_MARKUP AS

  -- ── GUARDAR_MARKUP ──────────────────────────────────────────
  PROCEDURE GUARDAR_MARKUP (
    p_doc_id         IN NUMBER,
    p_pagina         IN NUMBER,
    p_objetos_json   IN CLOB,
    p_escala_px      IN NUMBER    DEFAULT NULL,
    p_escala_unidad  IN VARCHAR2  DEFAULT NULL,
    p_usuario        IN VARCHAR2  DEFAULT USER
  ) IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count
      FROM SAF_PLANO_MARKUP
     WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;

    IF v_count = 0 THEN
      INSERT INTO SAF_PLANO_MARKUP
        (DOC_ID, PAGINA, OBJETOS_JSON, ESCALA_PX, ESCALA_UNIDAD,
         FECHA_MOD, MODIFICADO_POR)
      VALUES
        (p_doc_id, p_pagina, p_objetos_json, p_escala_px, p_escala_unidad,
         SYSTIMESTAMP, p_usuario);
    ELSE
      UPDATE SAF_PLANO_MARKUP
         SET OBJETOS_JSON   = p_objetos_json,
             ESCALA_PX      = NVL(p_escala_px,     ESCALA_PX),
             ESCALA_UNIDAD  = NVL(p_escala_unidad,  ESCALA_UNIDAD),
             FECHA_MOD      = SYSTIMESTAMP,
             MODIFICADO_POR = p_usuario
       WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;
    END IF;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END GUARDAR_MARKUP;


  -- ── OBTENER_MARKUP ──────────────────────────────────────────
  FUNCTION OBTENER_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  ) RETURN CLOB IS
    v_json CLOB;
  BEGIN
    SELECT OBJETOS_JSON INTO v_json
      FROM SAF_PLANO_MARKUP
     WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;
    RETURN v_json;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END OBTENER_MARKUP;


  -- ── OBTENER_SESION ─────────────────────────────────────────
  -- Retorna JSON con todas las páginas:
  -- { "docId": 5, "pages": { "1": [...], "2": [...] }, "scale": {...} }
  FUNCTION OBTENER_SESION (
    p_doc_id IN NUMBER
  ) RETURN CLOB IS
    v_result CLOB := '{"docId":' || p_doc_id || ',"pages":{';
    v_first  BOOLEAN := TRUE;
    v_escala_px     NUMBER;
    v_escala_unidad VARCHAR2(10);
  BEGIN
    FOR r IN (
      SELECT PAGINA, OBJETOS_JSON, ESCALA_PX, ESCALA_UNIDAD
        FROM SAF_PLANO_MARKUP
       WHERE DOC_ID = p_doc_id
       ORDER BY PAGINA
    ) LOOP
      IF NOT v_first THEN v_result := v_result || ','; END IF;
      v_result := v_result || '"' || r.PAGINA || '":' || NVL(r.OBJETOS_JSON, '[]');
      v_first  := FALSE;

      IF r.ESCALA_PX IS NOT NULL THEN
        v_escala_px     := r.ESCALA_PX;
        v_escala_unidad := r.ESCALA_UNIDAD;
      END IF;
    END LOOP;

    v_result := v_result || '}';

    IF v_escala_px IS NOT NULL THEN
      v_result := v_result || ',"scale":{"pxPerUnit":' || v_escala_px
                            || ',"unit":"' || v_escala_unidad || '"}';
    ELSE
      v_result := v_result || ',"scale":null';
    END IF;

    v_result := v_result || '}';
    RETURN v_result;
  END OBTENER_SESION;


  -- ── LIMPIAR_MARKUP ──────────────────────────────────────────
  PROCEDURE LIMPIAR_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  ) IS
  BEGIN
    DELETE FROM SAF_PLANO_MARKUP
     WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;
    COMMIT;
  END LIMPIAR_MARKUP;


  -- ── LIMPIAR_DOC ─────────────────────────────────────────────
  PROCEDURE LIMPIAR_DOC (
    p_doc_id IN NUMBER
  ) IS
  BEGIN
    DELETE FROM SAF_PLANO_MARKUP WHERE DOC_ID = p_doc_id;
    COMMIT;
  END LIMPIAR_DOC;

END PKG_PLANO_MARKUP;
/

-- ═══════════════════════════════════════════════════════════════
-- SAF Planos — XFDF: almacén de anotaciones portables
-- Complemento al schema anterior (ejecutar después)
-- ═══════════════════════════════════════════════════════════════

-- Tabla XFDF: un registro por documento (todo el archivo XFDF)
CREATE TABLE SAF_PLANO_MARKUP_XFDF (
  DOC_ID         NUMBER         NOT NULL
                   CONSTRAINT FK_XFDF_DOC REFERENCES SAF_PLANO_DOCS(DOC_ID),
  XFDF_CONTENT   CLOB           NOT NULL,   -- XML XFDF completo
  FECHA_MOD      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
  MODIFICADO_POR VARCHAR2(100)  DEFAULT USER,
  CONSTRAINT PK_PLANO_XFDF PRIMARY KEY (DOC_ID)
);

COMMENT ON TABLE  SAF_PLANO_MARKUP_XFDF               IS 'Anotaciones XFDF (XML) portables por documento de plano';
COMMENT ON COLUMN SAF_PLANO_MARKUP_XFDF.DOC_ID        IS 'FK a SAF_PLANO_DOCS';
COMMENT ON COLUMN SAF_PLANO_MARKUP_XFDF.XFDF_CONTENT  IS 'Archivo .xfdf completo (XML); todas las páginas en un único CLOB';
COMMENT ON COLUMN SAF_PLANO_MARKUP_XFDF.FECHA_MOD     IS 'Timestamp de última modificación';
COMMENT ON COLUMN SAF_PLANO_MARKUP_XFDF.MODIFICADO_POR IS 'Usuario que guardó la última versión';


-- ── Extender PKG_PLANO_MARKUP con soporte XFDF ─────────────────
-- Nota: se usa CREATE OR REPLACE para sustituir la especificación
--       completa; agrega GUARDAR_XFDF sin tocar los demás métodos.

CREATE OR REPLACE PACKAGE PKG_PLANO_MARKUP AS

  -- Guardar o actualizar markup Fabric.js de una página
  PROCEDURE GUARDAR_MARKUP (
    p_doc_id         IN NUMBER,
    p_pagina         IN NUMBER,
    p_objetos_json   IN CLOB,
    p_escala_px      IN NUMBER    DEFAULT NULL,
    p_escala_unidad  IN VARCHAR2  DEFAULT NULL,
    p_usuario        IN VARCHAR2  DEFAULT USER
  );

  -- Obtener markup Fabric.js de una página
  FUNCTION OBTENER_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  ) RETURN CLOB;

  -- Obtener sesión completa (todas las páginas) como JSON
  FUNCTION OBTENER_SESION (
    p_doc_id IN NUMBER
  ) RETURN CLOB;

  -- Limpiar markup Fabric.js de una página
  PROCEDURE LIMPIAR_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  );

  -- Limpiar markup de todo un documento
  PROCEDURE LIMPIAR_DOC (
    p_doc_id IN NUMBER
  );

  -- ── XFDF ────────────────────────────────────────────────────
  -- Guardar o actualizar el archivo XFDF completo de un documento
  PROCEDURE GUARDAR_XFDF (
    p_doc_id       IN NUMBER,
    p_xfdf_content IN CLOB,
    p_usuario      IN VARCHAR2  DEFAULT USER
  );

  -- Obtener el XFDF de un documento (retorna NULL si no existe)
  FUNCTION OBTENER_XFDF (
    p_doc_id IN NUMBER
  ) RETURN CLOB;

  -- Eliminar el XFDF de un documento
  PROCEDURE ELIMINAR_XFDF (
    p_doc_id IN NUMBER
  );

END PKG_PLANO_MARKUP;
/


CREATE OR REPLACE PACKAGE BODY PKG_PLANO_MARKUP AS

  -- ── GUARDAR_MARKUP ──────────────────────────────────────────
  PROCEDURE GUARDAR_MARKUP (
    p_doc_id         IN NUMBER,
    p_pagina         IN NUMBER,
    p_objetos_json   IN CLOB,
    p_escala_px      IN NUMBER    DEFAULT NULL,
    p_escala_unidad  IN VARCHAR2  DEFAULT NULL,
    p_usuario        IN VARCHAR2  DEFAULT USER
  ) IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count
      FROM SAF_PLANO_MARKUP
     WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;

    IF v_count = 0 THEN
      INSERT INTO SAF_PLANO_MARKUP
        (DOC_ID, PAGINA, OBJETOS_JSON, ESCALA_PX, ESCALA_UNIDAD,
         FECHA_MOD, MODIFICADO_POR)
      VALUES
        (p_doc_id, p_pagina, p_objetos_json, p_escala_px, p_escala_unidad,
         SYSTIMESTAMP, p_usuario);
    ELSE
      UPDATE SAF_PLANO_MARKUP
         SET OBJETOS_JSON   = p_objetos_json,
             ESCALA_PX      = NVL(p_escala_px,     ESCALA_PX),
             ESCALA_UNIDAD  = NVL(p_escala_unidad,  ESCALA_UNIDAD),
             FECHA_MOD      = SYSTIMESTAMP,
             MODIFICADO_POR = p_usuario
       WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;
    END IF;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END GUARDAR_MARKUP;


  -- ── OBTENER_MARKUP ──────────────────────────────────────────
  FUNCTION OBTENER_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  ) RETURN CLOB IS
    v_json CLOB;
  BEGIN
    SELECT OBJETOS_JSON INTO v_json
      FROM SAF_PLANO_MARKUP
     WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;
    RETURN v_json;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END OBTENER_MARKUP;


  -- ── OBTENER_SESION ─────────────────────────────────────────
  -- Retorna JSON con todas las páginas:
  -- { "docId": 5, "pages": { "1": [...], "2": [...] }, "scale": {...} }
  FUNCTION OBTENER_SESION (
    p_doc_id IN NUMBER
  ) RETURN CLOB IS
    v_result CLOB := '{"docId":' || p_doc_id || ',"pages":{';
    v_first  BOOLEAN := TRUE;
    v_escala_px     NUMBER;
    v_escala_unidad VARCHAR2(10);
  BEGIN
    FOR r IN (
      SELECT PAGINA, OBJETOS_JSON, ESCALA_PX, ESCALA_UNIDAD
        FROM SAF_PLANO_MARKUP
       WHERE DOC_ID = p_doc_id
       ORDER BY PAGINA
    ) LOOP
      IF NOT v_first THEN v_result := v_result || ','; END IF;
      v_result := v_result || '"' || r.PAGINA || '":' || NVL(r.OBJETOS_JSON, '[]');
      v_first  := FALSE;

      IF r.ESCALA_PX IS NOT NULL THEN
        v_escala_px     := r.ESCALA_PX;
        v_escala_unidad := r.ESCALA_UNIDAD;
      END IF;
    END LOOP;

    v_result := v_result || '}';

    IF v_escala_px IS NOT NULL THEN
      v_result := v_result || ',"scale":{"pxPerUnit":' || v_escala_px
                            || ',"unit":"' || v_escala_unidad || '"}';
    ELSE
      v_result := v_result || ',"scale":null';
    END IF;

    v_result := v_result || '}';
    RETURN v_result;
  END OBTENER_SESION;


  -- ── LIMPIAR_MARKUP ──────────────────────────────────────────
  PROCEDURE LIMPIAR_MARKUP (
    p_doc_id IN NUMBER,
    p_pagina IN NUMBER
  ) IS
  BEGIN
    DELETE FROM SAF_PLANO_MARKUP
     WHERE DOC_ID = p_doc_id AND PAGINA = p_pagina;
    COMMIT;
  END LIMPIAR_MARKUP;


  -- ── LIMPIAR_DOC ─────────────────────────────────────────────
  PROCEDURE LIMPIAR_DOC (
    p_doc_id IN NUMBER
  ) IS
  BEGIN
    DELETE FROM SAF_PLANO_MARKUP WHERE DOC_ID = p_doc_id;
    COMMIT;
  END LIMPIAR_DOC;


  -- ── GUARDAR_XFDF ────────────────────────────────────────────
  -- Upsert del archivo XFDF completo para un documento.
  -- Un documento tiene exactamente un registro XFDF (todas las páginas
  -- están dentro del mismo XML).
  PROCEDURE GUARDAR_XFDF (
    p_doc_id       IN NUMBER,
    p_xfdf_content IN CLOB,
    p_usuario      IN VARCHAR2  DEFAULT USER
  ) IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count
      FROM SAF_PLANO_MARKUP_XFDF
     WHERE DOC_ID = p_doc_id;

    IF v_count = 0 THEN
      INSERT INTO SAF_PLANO_MARKUP_XFDF
        (DOC_ID, XFDF_CONTENT, FECHA_MOD, MODIFICADO_POR)
      VALUES
        (p_doc_id, p_xfdf_content, SYSTIMESTAMP, p_usuario);
    ELSE
      UPDATE SAF_PLANO_MARKUP_XFDF
         SET XFDF_CONTENT   = p_xfdf_content,
             FECHA_MOD      = SYSTIMESTAMP,
             MODIFICADO_POR = p_usuario
       WHERE DOC_ID = p_doc_id;
    END IF;

    COMMIT;
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RAISE;
  END GUARDAR_XFDF;


  -- ── OBTENER_XFDF ────────────────────────────────────────────
  FUNCTION OBTENER_XFDF (
    p_doc_id IN NUMBER
  ) RETURN CLOB IS
    v_xfdf CLOB;
  BEGIN
    SELECT XFDF_CONTENT INTO v_xfdf
      FROM SAF_PLANO_MARKUP_XFDF
     WHERE DOC_ID = p_doc_id;
    RETURN v_xfdf;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END OBTENER_XFDF;


  -- ── ELIMINAR_XFDF ───────────────────────────────────────────
  PROCEDURE ELIMINAR_XFDF (
    p_doc_id IN NUMBER
  ) IS
  BEGIN
    DELETE FROM SAF_PLANO_MARKUP_XFDF WHERE DOC_ID = p_doc_id;
    COMMIT;
  END ELIMINAR_XFDF;

END PKG_PLANO_MARKUP;
/


-- ── Verificar compilación ────────────────────────────────────────
SELECT OBJECT_NAME, OBJECT_TYPE, STATUS
  FROM USER_OBJECTS
 WHERE OBJECT_NAME IN ('PKG_PLANO_MARKUP', 'SAF_PLANO_MARKUP_XFDF')
 ORDER BY OBJECT_TYPE, OBJECT_NAME;
