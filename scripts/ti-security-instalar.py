#!/usr/bin/env python3
"""Generate one atomic, offline SQL installer for the two reviewed security patches."""
import argparse
import hashlib
from pathlib import Path
import re

PATCHES = (
    ('20261103174707', '20261103174707_sara_security.sql', 'b60735b0dc058ca06c9134eb43184bed85fe5d920809977f57b771d7a849f12f'),
    ('20261103174840', '20261103174840_data_security_boundaries.sql', 'f9205f4512c7f409d8aa0853750d711e7a8145b7681e0d2ad5f6404da9889cda'),
)
COLUMNS = {
    'public.organizations': 'id',
    'public.profiles': 'id organization_id status user_id access_expires_at is_owner full_name',
    'public.user_feature_grants': 'organization_id profile_id feature_code',
    'public.sara_conversas': 'id organization_id modulo profile_id profile_name titulo updated_at',
    'public.sara_mensagens': 'organization_id conversa_id papel texto created_at ferramentas modelo tokens_entrada tokens_saida',
    'public.sara_modulos': 'organization_id modulo teto_tokens_mes',
    'public.sara_vigia_rodadas': 'organization_id created_at tokens_entrada tokens_saida',
    'public.sara_relatorios': 'organization_id created_at tokens_entrada tokens_saida',
    'public.sara_documentos': 'id organization_id criado_por caminho paginas bytes',
    'public.sara_acoes': 'id organization_id profile_id',
    'public.whatsapp_canais': 'id organization_id',
    'public.whatsapp_contatos': 'id organization_id canal_id profile_id supplier_id customer_id ativo lista',
    'public.whatsapp_mensagens': 'organization_id canal_id contato_id profile_id',
    'public.whatsapp_enquetes': 'organization_id canal_id contato_id profile_id acao_id',
    'public.whatsapp_agendados': 'organization_id canal_id contato_id documentos',
    'public.sara_vigia_transmissao': 'contato_id organization_id',
    'public.suppliers': 'id organization_id',
    'public.customers': 'id organization_id',
    'storage.objects': 'bucket_id name owner_id owner metadata',
    'storage.buckets': 'id public',
    'public.documents': 'id organization_id module_code storage_bucket object_path classification owner_profile_id',
    'public.employees': 'id organization_id',
    'public.rh_absences': 'organization_id employee_id status requested_by_profile_id requested_at decided_by_profile_id decided_at',
    'public.rh_benefit_requests': 'organization_id employee_id status requested_by_profile_id requested_at decided_by_profile_id decided_at',
    'public.finance_titles': 'id organization_id direction status original_amount is_forecast is_historical created_by_profile_id approved_by_profile_id approved_at',
    'public.finance_installments': 'id organization_id title_id amount settled_amount status',
    'public.finance_approval_rules': 'organization_id active direction min_amount max_amount',
    'public.finance_approval_requests': 'title_id status decided_at reason',
    'public.finance_settlements': 'id organization_id installment_id amount discount reversed_at',
    'public.company_documents': 'id organization_id module_code feature_code title category original_name mime_type size_bytes sha256 storage_path version previous_id superseded_by source file_intake_id entity_type entity_id uploaded_by uploaded_by_name archived_at',
    'public.file_intakes': 'id organization_id document_id',
}
FUNCTIONS = {
    'public.sara_registrar(uuid,text,text,text,jsonb,text,integer,integer)': 'jsonb',
    'public.sara_documento_arquivo(uuid,text,integer,integer)': 'void',
    'public.sara_uso_mes(text)': 'bigint',
    'public.current_profile_id()': 'uuid',
    'public.current_organization_id()': 'uuid',
    'public.has_feature(text,public.access_level)': 'boolean',
    'public.is_owner()': 'boolean',
    'public.coleta_permitida(text)': 'boolean',
    'public.finance_direction_feature(public.finance_title_direction)': 'text',
    'public.finance_title_access(uuid,public.access_level)': 'boolean',
    'public.finance_regras_do_titulo(uuid,public.finance_title_direction,numeric)': 'public.finance_approval_rules',
    'public.emit_module_event(uuid,text,text,text,text,text,jsonb)': 'void',
    'storage.foldername(text)': 'text[]',
    'auth.uid()': 'uuid',
    'public.finance_titulo_protege_aprovacao()': 'trigger',
    'public.finance_titulo_valor_alcada()': 'trigger',
    'public.finance_validate_settlement()': 'trigger',
    'public.company_document_register(text,text,text,text,text,text,bigint,text,text,text,uuid,text,text,uuid)': 'jsonb',
}
NEW_FUNCTIONS = (
    'sara_registrar_servidor', 'sara_audio_reservar', 'sara_documento_arquivo_servidor',
    'whatsapp_contato_tenant_guard', 'whatsapp_relacao_tenant_guard',
    'sara_vigia_transmissao_tenant_guard', 'rh_document_validate_binding',
    'rh_request_protect_decision', 'finance_installment_protect_ledger',
)
TRIGGERS = (
    ('public.whatsapp_contatos', 'whatsapp_contato_tenant_guard', 'public.whatsapp_contato_tenant_guard()', 23),
    ('public.whatsapp_mensagens', 'whatsapp_mensagens_tenant_guard', 'public.whatsapp_relacao_tenant_guard()', 23),
    ('public.whatsapp_enquetes', 'whatsapp_enquetes_tenant_guard', 'public.whatsapp_relacao_tenant_guard()', 23),
    ('public.whatsapp_agendados', 'whatsapp_agendados_tenant_guard', 'public.whatsapp_relacao_tenant_guard()', 23),
    ('public.sara_vigia_transmissao', 'sara_vigia_transmissao_tenant_guard', 'public.sara_vigia_transmissao_tenant_guard()', 23),
    ('public.documents', 'rh_document_validate_binding', 'public.rh_document_validate_binding()', 23),
    ('public.rh_absences', 'rh_absences_protect_decision', 'public.rh_request_protect_decision()', 23),
    ('public.rh_benefit_requests', 'rh_benefit_requests_protect_decision', 'public.rh_request_protect_decision()', 23),
    ('public.finance_installments', 'finance_installment_protect_ledger', 'public.finance_installment_protect_ledger()', 23),
)
SERVER_FUNCTIONS = (
    'public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)',
    'public.sara_audio_reservar(uuid,uuid,text,integer)',
    'public.sara_documento_arquivo_servidor(uuid,uuid,uuid,text,integer,integer)',
)
RLS_TABLES = ('storage.objects', 'public.documents', 'public.rh_absences', 'public.rh_benefit_requests',
              'public.finance_titles', 'public.finance_installments', 'public.finance_settlements')


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def array(values):
    return 'ARRAY[' + ','.join(literal(value) for value in values) + ']'


def values(rows):
    return ',\n'.join('(' + ','.join(literal(value) for value in row) + ')' for row in rows)


def function_body_hashes(sources):
    """Read exact dollar-quoted prosrc; reject unsupported/ambiguous declarations."""
    expected_names = set(NEW_FUNCTIONS) | {
        'sara_uso_mes', 'finance_titulo_protege_aprovacao',
        'finance_titulo_valor_alcada', 'finance_validate_settlement', 'company_document_register',
    }
    pattern = re.compile(
        r"\bcreate\s+(?:or\s+replace\s+)?function\s+public\.([a-z_][a-z_0-9]*)"
        r"\s*\((.*?)\)\s*returns\b.*?\bas\s+(\$[a-z_0-9]*\$)(.*?)\3\s*;",
        re.IGNORECASE | re.DOTALL,
    )
    found = {}
    for source in sources.values():
        for match in pattern.finditer(source):
            name, arguments, _, body = match.groups()
            name = name.lower()
            if name not in expected_names or name in found:
                raise ValueError(f'Declaração de função inesperada/ambígua: {name}')
            types = []
            for argument in arguments.split(',') if arguments.strip() else []:
                parameter = re.split(r'\s+default\s+', argument.strip(), flags=re.IGNORECASE)[0]
                declaration = parameter.split()
                if len(declaration) != 2:
                    raise ValueError(f'Argumento de função não suportado: {name}')
                typ = declaration[1].lower()
                if typ not in {'uuid', 'text', 'jsonb', 'int', 'integer', 'bigint'}:
                    raise ValueError(f'Tipo de argumento não suportado: {name}/{typ}')
                types.append('integer' if typ == 'int' else typ)
            signature = f"public.{name}({','.join(types)})"
            found[name] = (signature, hashlib.sha256(body.encode('utf-8')).hexdigest())
    if set(found) != expected_names:
        raise ValueError('Extração dos corpos incompleta: ' + ', '.join(sorted(expected_names - set(found))))
    return tuple(found[name] for name in sorted(found))


def generate(commit, sources):
    manifest = values(PATCHES)
    columns = values((table, column) for table, names in COLUMNS.items() for column in names.split())
    functions = values(FUNCTIONS.items())
    triggers = values(TRIGGERS)
    body_hashes = values(function_body_hashes(sources))
    parts = [f"""-- Offline security installer. Source commit: {commit}
-- Exactly one atomic DO; no migration baseline is fabricated and no business rows are exported.
-- Execute as the database administrator, through local psql or a verified HTTPS connection.
-- The caller must commit its outer transaction before treating notices as durable receipts.
DO $pecsil_security_install$
DECLARE
  r record; target text; principal text; missing text; receipt_count integer;
  receipts_match boolean; already_applied boolean := false; schema_id oid;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  IF NOT pg_try_advisory_xact_lock(hashtextextended('pecsil-security-patches-20261103',0)) THEN
    RAISE EXCEPTION 'Outra instalação de segurança está em andamento.';
  END IF;
  IF current_user IN ('anon','authenticated','authenticator','service_role') THEN
    RAISE EXCEPTION 'Execute somente como administrador do banco.' USING errcode='42501';
  END IF;
  FOREACH principal IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF to_regrole(principal) IS NULL THEN RAISE EXCEPTION 'Papel exigido ausente: %',principal; END IF;
  END LOOP;
  SELECT string_agg(req.relation||'.'||req.col,', ' ORDER BY req.relation,req.col) INTO missing
  FROM (VALUES {columns}) AS req(relation,col)
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
    WHERE a.attrelid=to_regclass(req.relation) AND a.attname=req.col AND a.attnum>0 AND NOT a.attisdropped);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Dependência de estrutura ausente: %',missing; END IF;
  FOREACH target IN ARRAY ARRAY['public.access_level','public.finance_title_direction','public.finance_title_status','public.finance_installment_status'] LOOP
    IF to_regtype(target) IS NULL THEN RAISE EXCEPTION 'Tipo exigido ausente: %',target; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('public.access_level','ver'),('public.access_level','operar'),('public.access_level','aprovar'),
    ('public.finance_title_direction','payable'),('public.finance_title_direction','receivable'),
    ('public.finance_title_status','draft'),('public.finance_title_status','pending_approval'),
    ('public.finance_title_status','approved'),('public.finance_title_status','partially_settled'),
    ('public.finance_title_status','settled'),('public.finance_title_status','overdue'),('public.finance_title_status','cancelled'),
    ('public.finance_installment_status','pending'),('public.finance_installment_status','overdue'),
    ('public.finance_installment_status','partially_settled'),('public.finance_installment_status','settled'),('public.finance_installment_status','cancelled')
  ) AS expected(typ,label) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid=to_regtype(r.typ) AND enumlabel=r.label) THEN
      RAISE EXCEPTION 'Valor de enum exigido ausente: %/%',r.typ,r.label;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES {functions}) AS expected(signature,result_type) LOOP
    IF to_regprocedure(r.signature) IS NULL THEN RAISE EXCEPTION 'Função exigida ausente: %',r.signature; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature) AND p.prorettype=to_regtype(r.result_type)) THEN
      RAISE EXCEPTION 'Retorno incompatível na função: % (esperado %)',r.signature,r.result_type;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY {array(RLS_TABLES)} LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(target) AND relkind IN ('r','p') AND relrowsecurity) THEN
      RAISE EXCEPTION 'Tabela exigida sem RLS: %',target;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['rh-documents','sara-documentos','empresa-documentos'] LOOP
    IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id=target AND public=false) THEN
      RAISE EXCEPTION 'Bucket privado exigido ausente/inseguro: %',target;
    END IF;
  END LOOP;

  -- A schema with this name is accepted only when it is our compatible, admin-owned ledger.
  SELECT oid INTO schema_id FROM pg_namespace WHERE nspname='pecsil_ops';
  IF schema_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE oid=schema_id AND nspowner=current_user::regrole)
       OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('pecsil_ops.security_patches') AND relkind='r' AND relowner=current_user::regrole)
       OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace=schema_id AND relname NOT IN ('security_patches','security_patches_pkey'))
       OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace=schema_id) THEN
      RAISE EXCEPTION 'Esquema pecsil_ops existente incompatível; nenhuma alteração aplicada.';
    END IF;
    IF (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('pecsil_ops.security_patches') AND attnum>0 AND NOT attisdropped)<>5
       OR EXISTS(SELECT 1 FROM (VALUES ('version','text'),('filename','text'),('sql_sha256','text'),('source_commit','text'),('applied_at','timestamp with time zone')) AS expected(col,typ)
          WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('pecsil_ops.security_patches') AND a.attname=expected.col
            AND a.atttypid=to_regtype(expected.typ) AND a.attnotnull AND a.attnum>0 AND NOT a.attisdropped))
       OR NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('pecsil_ops.security_patches') AND c.contype='p' AND c.convalidated
          AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='version')]::smallint[]) THEN
      RAISE EXCEPTION 'Tabela de recibos pecsil_ops.security_patches incompatível.';
    END IF;
  ELSE
    EXECUTE $pecsil_receipt_schema$
      CREATE SCHEMA pecsil_ops;
      CREATE TABLE pecsil_ops.security_patches(
        version text PRIMARY KEY, filename text NOT NULL,
        sql_sha256 text NOT NULL CHECK(sql_sha256 ~ '^[0-9a-f]{{64}}$'),
        source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{{40}}$'),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    $pecsil_receipt_schema$;
  END IF;
  -- Revoke grants inherited at CREATE TABLE time, including PUBLIC/default grants.
  EXECUTE $pecsil_receipt_acl$
    ALTER TABLE pecsil_ops.security_patches ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON SCHEMA pecsil_ops FROM PUBLIC,anon,authenticated,service_role;
    REVOKE ALL ON TABLE pecsil_ops.security_patches FROM PUBLIC,anon,authenticated,service_role;
  $pecsil_receipt_acl$;
  EXECUTE $pecsil_receipt_lookup$
    WITH expected(version,filename,sql_sha256) AS (VALUES {manifest})
    SELECT count(*),coalesce(bool_and(p.filename=e.filename AND p.sql_sha256=e.sql_sha256
      AND p.source_commit ~ '^[0-9a-f]{{40}}$'),false)
    FROM pecsil_ops.security_patches p JOIN expected e USING(version)
  $pecsil_receipt_lookup$ INTO receipt_count,receipts_match;
  IF receipt_count=2 AND receipts_match THEN already_applied:=true;
  ELSIF receipt_count<>0 THEN
    RAISE EXCEPTION 'Recibos parciais ou SHA256 divergente; aplicação interrompida.';
  END IF;

  IF NOT already_applied THEN
    FOREACH target IN ARRAY ARRAY['public.sara_audio_uso','public.sara_audio_uso_pkey','public.sara_audio_uso_mes','public.sara_audio_uso_pessoa','public.whatsapp_contatos_id_org'] LOOP
      IF to_regclass(target) IS NOT NULL THEN RAISE EXCEPTION 'Artefato novo sem recibo: %',target; END IF;
    END LOOP;
    IF to_regtype('public.sara_audio_uso') IS NOT NULL OR to_regtype('public._sara_audio_uso') IS NOT NULL THEN
      RAISE EXCEPTION 'Tipo da tabela nova de áudio já existe sem recibo.';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname=ANY({array(NEW_FUNCTIONS)})) THEN
      RAISE EXCEPTION 'Função nova de segurança sem recibo; aplicação parcial ou conflito.';
    END IF;
    FOR r IN SELECT * FROM (VALUES {triggers}) AS expected(relation,name,signature,trigger_type) LOOP
      IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(r.relation) AND tgname=r.name AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'Trigger novo sem recibo: %/%',r.relation,r.name;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.sara_vigia_transmissao') AND conname='sara_vigia_transmissao_contato_empresa') THEN
      RAISE EXCEPTION 'Chave de empresa da transmissão já existe sem recibo.';
    END IF;
"""]
    for version, filename, digest in PATCHES:
        tag = f'$pecsil_patch_{version}$'
        if tag in sources[filename] or '$pecsil_security_install$' in sources[filename]:
            raise ValueError('Delimitador SQL em conflito com a fonte')
        parts.append(f'\n-- Apply reviewed patch {filename}; SHA256 {digest}\nEXECUTE {tag}\n{sources[filename]}\n{tag};\n')
    parts.append(f"""
  END IF;

  -- Postconditions also run on a same-hash retry; drift is never hidden by a receipt.
  FOR r IN SELECT * FROM (VALUES {body_hashes}) AS expected(signature,body_sha256) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=r.body_sha256) THEN
      RAISE EXCEPTION 'Pós-condição do corpo da função falhou: %',r.signature;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.sara_audio_uso','pecsil_ops.security_patches'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(target) AND relrowsecurity) THEN
      RAISE EXCEPTION 'Pós-condição RLS falhou: %',target;
    END IF;
  END LOOP;
  FOREACH principal IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(principal,'pecsil_ops','USAGE') OR has_schema_privilege(principal,'pecsil_ops','CREATE') THEN
      RAISE EXCEPTION 'Pós-condição de isolamento do esquema falhou: %',principal;
    END IF;
    FOREACH target IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(principal,'pecsil_ops.security_patches',target)
        OR (principal<>'service_role' AND has_table_privilege(principal,'public.sara_audio_uso',target)) THEN
        RAISE EXCEPTION 'Pós-condição de ACL das tabelas falhou: %/%',principal,target;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='pecsil_ops' AND a.grantee=0)
     OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=to_regclass('pecsil_ops.security_patches') AND a.grantee=0) THEN
    RAISE EXCEPTION 'Pós-condição de ACL PUBLIC dos recibos falhou.';
  END IF;
  FOREACH target IN ARRAY {array(SERVER_FUNCTIONS)} LOOP
    IF to_regprocedure(target) IS NULL OR NOT has_function_privilege('service_role',to_regprocedure(target),'EXECUTE') THEN
      RAISE EXCEPTION 'Pós-condição de função exclusiva do servidor falhou: %',target;
    END IF;
    FOREACH principal IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(principal,to_regprocedure(target),'EXECUTE') THEN
        RAISE EXCEPTION 'Função do servidor acessível pelo cliente: %/%',principal,target;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.sara_registrar(uuid,text,text,text,jsonb,text,integer,integer)','public.sara_documento_arquivo(uuid,text,integer,integer)'] LOOP
    FOREACH principal IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(principal,to_regprocedure(target),'EXECUTE') THEN RAISE EXCEPTION 'RPC antigo ainda executável: %/%',principal,target; END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('authenticated','public.sara_uso_mes(text)','EXECUTE')
     OR has_function_privilege('anon','public.sara_uso_mes(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Pós-condição de leitura do consumo SARA falhou.';
  END IF;
  FOREACH target IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    IF has_table_privilege('authenticated','public.finance_settlements',target) THEN RAISE EXCEPTION 'Baixas ainda aceitam escrita direta: %',target; END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.finance_titulo_protege_aprovacao()','public.finance_installment_protect_ledger()'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(target) AND NOT prosecdef) THEN
      RAISE EXCEPTION 'Guarda financeira não está em contexto invocador: %',target;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES {triggers},
    ('public.finance_titles','finance_titulo_protege_aprovacao','public.finance_titulo_protege_aprovacao()','23'),
    ('public.finance_titles','finance_titulo_valor_alcada','public.finance_titulo_valor_alcada()','19'),
    ('public.finance_settlements','finance_settlement_validate','public.finance_validate_settlement()','23'))
    AS expected(relation,name,signature,trigger_type) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(r.relation) AND tgname=r.name
      AND tgfoid=to_regprocedure(r.signature) AND tgtype=r.trigger_type::smallint AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'Pós-condição de trigger falhou: %/%',r.relation,r.name;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE conrelid=to_regclass('public.sara_vigia_transmissao')
     AND conname='sara_vigia_transmissao_contato_empresa' AND contype='f' AND convalidated
     AND confrelid=to_regclass('public.whatsapp_contatos')
     AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='contato_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='organization_id')]::smallint[]
     AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='id'),(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='organization_id')]::smallint[]) THEN
    RAISE EXCEPTION 'Pós-condição da chave estrangeira de empresa falhou.';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('rh_docs_objects_read','r'),('rh_docs_objects_insert','a'),('rh_docs_objects_update','w'),('rh_docs_objects_delete','d')) AS expected(name,cmd) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('storage.objects') AND p.polname=r.name
      AND p.polcmd::text=r.cmd AND p.polpermissive AND p.polroles=ARRAY[to_regrole('authenticated')::oid]
      AND CASE WHEN r.cmd='a' THEN
        position('owner_id' in pg_get_expr(p.polwithcheck,p.polrelid))>0 AND position('rh.documentos' in pg_get_expr(p.polwithcheck,p.polrelid))>0
      ELSE position('documents' in pg_get_expr(p.polqual,p.polrelid))>0 AND position('object_path' in pg_get_expr(p.polqual,p.polrelid))>0 END) THEN
      RAISE EXCEPTION 'Pós-condição de política de arquivo RH falhou: %',r.name;
    END IF;
  END LOOP;

  IF already_applied THEN
    RAISE NOTICE 'Os dois patches já possuem recibos com os mesmos SHA256; pós-condições verificadas, sem reaplicação.';
  ELSE
    -- Receipts record only these two patches, never an inferred history of earlier migrations.
    EXECUTE $pecsil_receipt_insert$
      INSERT INTO pecsil_ops.security_patches(version,filename,sql_sha256,source_commit)
      SELECT version,filename,sql_sha256,{literal(commit)} FROM (VALUES {manifest}) AS expected(version,filename,sql_sha256)
    $pecsil_receipt_insert$;
    RAISE NOTICE 'Dois patches instalados e recibos registrados nesta transação; confirmar o commit do chamador.';
  END IF;
END $pecsil_security_install$;
""")
    return '\n'.join(parts)


def main():
    parser = argparse.ArgumentParser(description='Gera um único DO SQL atômico para dois patches de segurança; não conecta a nenhum serviço.')
    parser.add_argument('--source-commit', required=True, help='Commit de origem completo, com 40 caracteres hexadecimais.')
    parser.add_argument('--output', type=Path, required=True, help='Arquivo SQL de saída, sem senhas ou tokens.')
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-fA-F]{40}', args.source_commit):
        parser.error('--source-commit deve conter exatamente 40 caracteres hexadecimais.')
    repo = Path(__file__).resolve().parents[1]
    inputs = [repo / 'supabase/migrations' / filename for _, filename, _ in PATCHES]
    output = args.output.resolve()
    if output in [path.resolve() for path in inputs] + [Path(__file__).resolve()]:
        parser.error('O arquivo de saída não pode sobrescrever o gerador nem as migrações de origem.')
    sources = {}
    for (_, filename, expected), path in zip(PATCHES, inputs):
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != expected:
            parser.error(f'SHA256 da fonte revisada divergiu: {filename}. Não foi gerado SQL.')
        sources[filename] = content.decode('utf-8')
    artifact = generate(args.source_commit.lower(), sources)
    output.write_text(artifact, encoding='utf-8')
    print(output)
    print('SHA256', hashlib.sha256(artifact.encode('utf-8')).hexdigest())


if __name__ == '__main__':
    main()
