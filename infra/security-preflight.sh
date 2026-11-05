#!/usr/bin/env bash
# Inventário somente leitura. Não aplica firewall, migrações ou alterações de serviço.
set -uo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf '%s\n' 'Uso: bash security-preflight.sh' \
    'Somente no host Linux como root, com systemd. Coleta rede/Docker/firewall e metadados/contagens do banco.' \
    'Não coleta credenciais, ambiente, conteúdo de arquivos, mensagens ou dados pessoais.'
  exit 0
fi
if (( $# != 0 )); then
  printf '%s\n' 'ERRO: este inventário não aceita argumentos.' >&2
  exit 2
fi

init_process=''
if [[ -r /proc/1/comm ]]; then
  IFS= read -r init_process < /proc/1/comm
fi
if [[ "$(uname -s)" != Linux || "$EUID" != 0 || "$init_process" != systemd || -e /.dockerenv || -e /run/.containerenv ]]; then
  printf '%s\n' 'ERRO: execute somente no terminal do servidor Linux principal, como root, com systemd; contêineres da aplicação são recusados.' >&2
  exit 2
fi

collection_failures=0
report_failure() {
  printf 'FALHA DE COLETA: %s (código %s). Não foi possível verificar essa parte.\n' "$1" "$2" >&2
  collection_failures=$((collection_failures + 1))
}
read_section() {
  local title="$1" status
  shift
  printf '\n%s\n' "$title"
  if "$@"; then
    return 0
  else
    status=$?
    report_failure "$title" "$status"
  fi
}

printf '%s\n' 'PECSIL — inventário de segurança somente leitura' \
  'Nenhuma regra, serviço, migração ou configuração será alterada.' \
  'Este relatório reúne os dados necessários para revisar a aplicação das correções.'

read_section 'Interfaces e endereços locais' ip -br address
read_section 'Rotas IPv4' ip -4 route show
read_section 'Rotas IPv6' ip -6 route show
read_section 'Contêineres: nomes, estado e portas publicadas' docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

printf '\nRedes Docker: somente sub-redes e gateways\n'
if network_output=$(docker network ls -q); then
  network_ids=()
  while IFS= read -r network_id; do
    if [[ -n "$network_id" ]]; then
      network_ids+=("$network_id")
    fi
  done <<< "$network_output"
  if (( ${#network_ids[@]} )); then
    read_section 'Redes Docker' docker network inspect --format '{{.Name}} driver={{.Driver}} IPv6={{.EnableIPv6}} {{range .IPAM.Config}}subrede={{.Subnet}} gateway={{.Gateway}} {{end}}' "${network_ids[@]}"
  else
    printf '%s\n' 'Nenhuma rede Docker retornada; não inferir a topologia.'
  fi
else
  report_failure 'listar redes Docker' "$?"
fi

for firewall_tool in iptables ip6tables; do
  read_section "Backend $firewall_tool" "$firewall_tool" --version
  for firewall_chain in INPUT FORWARD DOCKER-USER; do
    read_section "$firewall_tool: $firewall_chain" "$firewall_tool" -w 5 -t filter -S "$firewall_chain"
  done
done
read_section 'Tabelas nftables: nomes apenas' nft list tables

printf '\nEstado do firewalld\n'
if firewalld_state=$(systemctl is-active firewalld); then
  printf 'firewalld=%s — ATENÇÃO: o runner recusa firewalld ativo.\n' "$firewalld_state"
else
  firewalld_status=$?
  printf 'firewalld=%s (código %s)\n' "${firewalld_state:-sem resultado}" "$firewalld_status"
  if [[ "$firewalld_status" != 3 && "$firewalld_status" != 4 ]]; then
    report_failure 'consultar firewalld' "$firewalld_status"
  fi
fi

printf '\nBanco: catálogo e contagens agregadas, em transação somente leitura\n'
if docker exec -i -u postgres supabase-db psql -X -w -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -P footer=off <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SELECT current_database() AS banco, current_setting('server_version') AS postgres,
       current_setting('transaction_read_only') AS somente_leitura;

\echo Historico esperado: 179 migracoes-base ate 202611030003; novas 20261103174707 e 20261103174840.
-- O historico pode estar ausente; nunca referenciar a tabela antes do teste de catalogo.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_catalog.pg_attribute
  WHERE attrelid=to_regclass('supabase_migrations.schema_migrations')
    AND attname='version' AND attnum>0 AND NOT attisdropped
) THEN $query$
  SELECT version::text AS versao, to_jsonb(m)->>'name' AS nome
  FROM supabase_migrations.schema_migrations m ORDER BY version::text DESC LIMIT 12;
  SELECT count(*) FILTER (WHERE version::text <= '202611030003') AS historico_base_esperado_179,
         count(*) FILTER (WHERE version::text IN ('20261103174707','20261103174840')) AS novas_registradas,
         count(*) FILTER (WHERE version::text > '202611030003'
           AND version::text NOT IN ('20261103174707','20261103174840')) AS outras_posteriores
  FROM supabase_migrations.schema_migrations;
  SELECT coalesce(string_agg(v, ', ' ORDER BY v), 'nenhuma') AS versoes_base_recentes_ausentes
  FROM unnest(ARRAY['202611030001','202611030002','202611030003']) AS v
  WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version::text=v);
$query$ ELSE $query$
  SELECT 'SEM_HISTORICO: tabela/coluna de versao ausente; nao inferir nem registrar migracoes automaticamente.' AS atencao;
$query$ END
\gexec

SELECT coalesce(string_agg(objeto, ', ' ORDER BY objeto), 'nenhuma') AS tabelas_base_ausentes
FROM unnest(ARRAY[
  'public.organizations','public.profiles','public.user_feature_grants',
  'public.sara_conversas','public.sara_mensagens','public.sara_modulos',
  'public.sara_vigia_rodadas','public.sara_relatorios','public.sara_documentos','public.sara_acoes',
  'public.whatsapp_canais','public.whatsapp_contatos','public.whatsapp_mensagens',
  'public.whatsapp_enquetes','public.whatsapp_agendados','public.sara_vigia_transmissao',
  'public.suppliers','public.customers','storage.objects','public.documents','public.employees',
  'public.rh_absences','public.rh_benefit_requests','public.finance_titles',
  'public.finance_installments','public.finance_settlements','public.finance_approval_rules',
  'public.finance_approval_requests','public.company_documents','public.file_intakes'
]) AS objeto WHERE to_regclass(objeto) IS NULL;

WITH required(relation, columns) AS (VALUES
  ('public.profiles', ARRAY['id','organization_id','status','user_id','access_expires_at','is_owner','full_name']),
  ('public.sara_vigia_transmissao', ARRAY['contato_id','organization_id']),
  ('storage.objects', ARRAY['bucket_id','name','owner_id','owner','metadata']),
  ('public.documents', ARRAY['id','organization_id','module_code','storage_bucket','object_path','classification','owner_profile_id']),
  ('public.employees', ARRAY['id','organization_id']),
  ('public.rh_absences', ARRAY['organization_id','employee_id','status','requested_by_profile_id','requested_at','decided_by_profile_id','decided_at']),
  ('public.rh_benefit_requests', ARRAY['organization_id','employee_id','status','requested_by_profile_id','requested_at','decided_by_profile_id','decided_at']),
  ('public.finance_titles', ARRAY['id','organization_id','direction','status','original_amount','is_forecast','is_historical','created_by_profile_id','approved_by_profile_id','approved_at']),
  ('public.finance_installments', ARRAY['id','organization_id','title_id','amount','settled_amount','status']),
  ('public.finance_approval_rules', ARRAY['organization_id','active','direction','min_amount','max_amount']),
  ('public.finance_approval_requests', ARRAY['title_id','status','decided_at','reason']),
  ('public.finance_settlements', ARRAY['id','organization_id','installment_id','amount','discount','reversed_at']),
  ('public.company_documents', ARRAY['id','organization_id','module_code','feature_code','title','category','original_name','mime_type','size_bytes','sha256','storage_path','version','previous_id','superseded_by','source','file_intake_id','entity_type','entity_id','uploaded_by','uploaded_by_name','archived_at']),
  ('public.file_intakes', ARRAY['id','organization_id','document_id'])
)
SELECT coalesce(string_agg(relation||'.'||column_name, ', ' ORDER BY relation,column_name), 'nenhuma') AS colunas_exigidas_ausentes
FROM required CROSS JOIN LATERAL unnest(columns) AS column_name
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_attribute a
  WHERE a.attrelid=to_regclass(relation) AND a.attname=column_name AND a.attnum>0 AND NOT a.attisdropped
);

SELECT to_regprocedure('public.sara_registrar(uuid,text,text,text,jsonb,text,integer,integer)') IS NOT NULL AS registrar_antigo_existe,
       to_regprocedure('public.sara_documento_arquivo(uuid,text,integer,integer)') IS NOT NULL AS arquivo_antigo_existe,
       to_regclass('public.sara_audio_uso') IS NOT NULL AS tabela_nova_audio_existe;

WITH objects(kind, object_name, present) AS (
  SELECT 'relacao', name, to_regclass(name) IS NOT NULL
  FROM unnest(ARRAY['public.sara_audio_uso','public.sara_audio_uso_pkey','public.sara_audio_uso_mes','public.sara_audio_uso_pessoa','public.whatsapp_contatos_id_org']) AS name
  UNION ALL
  SELECT 'funcao', name, to_regprocedure(name) IS NOT NULL
  FROM unnest(ARRAY[
    'public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)',
    'public.sara_audio_reservar(uuid,uuid,text,integer)',
    'public.sara_documento_arquivo_servidor(uuid,uuid,uuid,text,integer,integer)',
    'public.whatsapp_contato_tenant_guard()','public.whatsapp_relacao_tenant_guard()',
    'public.sara_vigia_transmissao_tenant_guard()',
    'public.rh_document_validate_binding()','public.rh_request_protect_decision()',
    'public.finance_installment_protect_ledger()'
  ]) AS name
  UNION ALL
  SELECT 'trigger', relation||'/'||trigger_name, EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=to_regclass(relation) AND t.tgname=trigger_name AND NOT t.tgisinternal
  ) FROM (VALUES
    ('public.whatsapp_contatos','whatsapp_contato_tenant_guard'),
    ('public.whatsapp_mensagens','whatsapp_mensagens_tenant_guard'),
    ('public.whatsapp_enquetes','whatsapp_enquetes_tenant_guard'),
    ('public.whatsapp_agendados','whatsapp_agendados_tenant_guard'),
    ('public.sara_vigia_transmissao','sara_vigia_transmissao_tenant_guard')
  ) AS expected(relation,trigger_name)
  UNION ALL
  SELECT 'constraint', 'public.sara_vigia_transmissao/sara_vigia_transmissao_contato_empresa', EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid=to_regclass('public.sara_vigia_transmissao') AND conname='sara_vigia_transmissao_contato_empresa'
  )
)
SELECT coalesce(string_agg(kind||':'||object_name, ', ' ORDER BY kind,object_name), 'nenhum') AS objetos_das_novas_ja_presentes
FROM objects WHERE present;
\echo Objetos novos presentes SEM a respectiva migracao registrada exigem investigar aplicacao parcial; nao reaplicar automaticamente.

SELECT n.nspname||'.'||c.relname AS tabela_sem_rls
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.oid IN (
  to_regclass('storage.objects'),to_regclass('public.documents'),
  to_regclass('public.rh_absences'),to_regclass('public.rh_benefit_requests'),
  to_regclass('public.finance_titles'),to_regclass('public.finance_installments'),
  to_regclass('public.finance_settlements')
) AND NOT c.relrowsecurity ORDER BY 1;

-- Cada consulta de dados so e enviada ao servidor se TODAS as suas tabelas/colunas existirem.
WITH required(scope, relation, columns) AS (VALUES
  ('contatos','public.whatsapp_contatos',ARRAY['canal_id','organization_id','profile_id','supplier_id','customer_id','ativo']),
  ('contatos','public.whatsapp_canais',ARRAY['id','organization_id']),
  ('contatos','public.profiles',ARRAY['id','organization_id']),
  ('contatos','public.suppliers',ARRAY['id','organization_id']),
  ('contatos','public.customers',ARRAY['id','organization_id']),
  ('transmissao','public.sara_vigia_transmissao',ARRAY['contato_id','organization_id']),
  ('transmissao','public.whatsapp_contatos',ARRAY['id','organization_id','canal_id','profile_id','lista']),
  ('transmissao','public.whatsapp_canais',ARRAY['id','organization_id']),
  ('transmissao','public.profiles',ARRAY['id','organization_id']),
  ('rh','storage.objects',ARRAY['bucket_id','name']),
  ('rh','public.documents',ARRAY['storage_bucket','module_code','object_path','organization_id']),
  ('buckets','storage.buckets',ARRAY['id','public'])
), ready AS (
  SELECT scope, bool_and(to_regclass(relation) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM unnest(columns) AS column_name WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=to_regclass(relation) AND a.attname=column_name AND a.attnum>0 AND NOT a.attisdropped
    )
  )) AS available FROM required GROUP BY scope
), queries(scope, query) AS (VALUES
  ('contatos', $query$
    SELECT count(*) AS contatos_invalidos, count(*) FILTER (WHERE c.ativo) AS contatos_ativos_a_desativar
    FROM public.whatsapp_contatos c
    WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_canais k WHERE k.id=c.canal_id AND k.organization_id=c.organization_id)
      OR (c.profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=c.profile_id AND p.organization_id=c.organization_id))
      OR (c.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.suppliers p WHERE p.id=c.supplier_id AND p.organization_id=c.organization_id))
      OR (c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers p WHERE p.id=c.customer_id AND p.organization_id=c.organization_id));
  $query$),
  ('transmissao', $query$
    SELECT count(*) AS vinculos_transmissao_a_remover FROM public.sara_vigia_transmissao t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.whatsapp_contatos c
      JOIN public.whatsapp_canais k ON k.id=c.canal_id AND k.organization_id=c.organization_id
      JOIN public.profiles p ON p.id=c.profile_id AND p.organization_id=c.organization_id
      WHERE c.id=t.contato_id AND c.organization_id=t.organization_id AND c.lista='interna'
    );
  $query$),
  ('rh', $query$
    SELECT count(*) AS arquivos_rh_sem_metadados_validos FROM storage.objects o
    WHERE o.bucket_id='rh-documents' AND NOT EXISTS (
      SELECT 1 FROM public.documents d WHERE d.storage_bucket='rh-documents' AND d.module_code='rh'
        AND d.object_path=o.name AND d.organization_id::text=split_part(o.name,'/',1)
    );
    SELECT count(*) AS metadados_rh_inconsistentes FROM public.documents d
    WHERE d.storage_bucket='rh-documents' AND (
      d.module_code IS DISTINCT FROM 'rh' OR split_part(d.object_path,'/',1) IS DISTINCT FROM d.organization_id::text
      OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='rh-documents' AND o.name=d.object_path)
    );
  $query$),
  ('buckets', $query$
    SELECT expected.id AS bucket, b.id IS NOT NULL AS existe, b.public AS publico
    FROM unnest(ARRAY['rh-documents','sara-documentos','empresa-documentos']) AS expected(id)
    LEFT JOIN storage.buckets b ON b.id=expected.id ORDER BY expected.id;
  $query$)
)
SELECT CASE WHEN r.available THEN q.query ELSE format(
  'SELECT %L AS diagnostico_nao_verificado;', q.scope||': tabelas/colunas ausentes; contagem nao executada.'
) END FROM queries q JOIN ready r USING (scope) ORDER BY q.scope
\gexec

ROLLBACK;
SQL
then
  printf '%s\n' 'Consulta do banco concluída; nenhuma migração foi aplicada.'
else
  database_status=$?
  report_failure 'consulta somente leitura do banco (erro acima; diagnóstico pode estar incompleto)' "$database_status"
fi

printf '\n%s\n' 'Fim do inventário. CIDRs permitidos e acesso de recuperação ainda precisam de confirmação humana.'
if (( collection_failures )); then
  printf 'Resultado: %s parte(s) não verificada(s); corrigir a coleta antes de gerar um plano de aplicação.\n' "$collection_failures" >&2
  exit 1
fi
printf '%s\n' 'Resultado: coleta concluída. Ausências, colisões ou alertas acima precisam ser analisados; isto não autoriza aplicar mudanças.'
