# Pendência de infraestrutura — Supabase Pecsil

Status: pausada até haver acesso presencial à rede/servidor da empresa.

## Situação atual

- Supabase está auto-hospedado em servidor interno da Pecsil.
- Existem acessos por IP interno e externo.
- Ainda não existe domínio HTTPS para o API Gateway.
- O Pecsil Business OS está hospedado externamente no ChatGPT Sites e, por
  isso, não consegue consumir diretamente um endereço privado da LAN.

## Próxima ação no servidor

Executar e registrar o resultado:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

O resultado definirá se o gateway atual é Kong ou Envoy e qual porta deverá
receber o tráfego do reverse proxy.

## Arquitetura aprovada

1. Criar `supabase.pecsil.com.br` no DNS apontando para o IP público da empresa.
2. Encaminhar somente as portas 80/443 para o reverse proxy no servidor.
3. Usar Caddy com certificado Let's Encrypt e proxy para o API Gateway interno.
4. Habilitar WebSocket e cabeçalhos `X-Forwarded`.
5. Ajustar `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL` e `SITE_URL` no `.env`.
6. Não expor PostgreSQL 5432/6543, Studio, Docker, SSH ou MCP.
7. Configurar no Sites apenas a URL HTTPS, a chave pública e a chave de serviço
   como segredo exclusivo do servidor.

## Trabalho que pode avançar sem o servidor

- Schema PostgreSQL e RLS versionados.
- Clientes Supabase browser/server.
- Tela de login e callback de sessão.
- Script de provisionamento inicial da organização e proprietário.
