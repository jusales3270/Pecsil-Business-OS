# Fleetbase da Pecsil (serviço de entregas)

O motor das entregas da Logística ([docs/PLANO-LOGISTICA.md](../../docs/PLANO-LOGISTICA.md)). Roda como **serviço
separado** (AGPL-3.0) e a plataforma fala com ele só pela API. O código é o fork
[`jusales3270/fleetbase-frota`](https://github.com/jusales3270/fleetbase-frota), sem alteração no código dele: o que
é da Pecsil fica aqui, como configuração.

## O que fica neste diretório

| Arquivo | Para quê |
|---|---|
| `vhost.conf` | nginx do Fleetbase com a **consulta pública por número de rastreio fechada** (`/int/v1/fleet-ops/lookup` → 404). Ela mostra o motorista e o endereço a quem tiver o número, e cada abertura gasta 2 consultas pagas no Google, sem guarda. O link do cliente é o da plataforma. |
| `docker-compose.override.example.yml` | O override usado no ambiente local, **sem os segredos**: versão travada, portas, MySQL com senha, rotas pelo Google e o `vhost.conf`. |

## Instalar (local ou no servidor)

1. Clonar o fork e entrar na pasta.
2. Copiar `vhost.conf` para `docker/httpd/vhost-pecsil.conf`.
3. Copiar `docker-compose.override.example.yml` para `docker-compose.override.yml` e preencher os segredos:
   - a senha do MySQL e a `APP_KEY` (`base64:` + 32 bytes aleatórios);
   - a `GOOGLE_MAPS_API_KEY`, restrita à Routes API e ao IP do servidor.
4. `docker compose pull` e `docker compose up -d --no-build`. Depois, `docker compose exec application ./deploy.sh` (cria o banco).
5. Criar a conta da empresa e uma chave de API (a `key` `flb_live_…`; a `secret` não serve para a API pública).
6. Na plataforma, configurar `FLEETBASE_API_URL` (em produção, o endereço da rede interna), `FLEETBASE_API_KEY` e
   `FLEETBASE_AVISO_TOKEN`. Nunca com `NEXT_PUBLIC_`.
7. No Fleetbase, apontar o aviso (webhook) para `https://<plataforma>/api/logistica/aviso?t=<FLEETBASE_AVISO_TOKEN>`.

**Depois de mudar qualquer variável**, rodar `php artisan config:clear && php artisan config:cache` nos contêineres
`application` e `queue`: o Fleetbase guarda a configuração em cache.

## Instalado no servidor (20/10/2026)

- **No Coolify:** a aplicação é `fleetbase-entregas` (`vs6zcbrmmlgrnrouwz4rm02b`), no projeto Pecsil Business OS, e usa
  o compose `docker-compose.coolify.yml` do ramo **`pecsil`** do fork.
- **O que o ramo `pecsil` traz:**
  - o compose (versão travada, nenhuma porta publicada, teto de memória por contêiner, passo `setup` que cria o banco
    a cada deploy);
  - o `docker/httpd/Dockerfile.pecsil`: o nginx com este `vhost.conf` **dentro da imagem**, porque o Coolify não
    copia arquivo do repositório para montar como volume;
  - o próprio `docker/httpd/vhost-pecsil.conf`.
- **O nome interno é `frota.pecsil`, no Traefik.** A plataforma chega por `FLEETBASE_API_URL=http://coolify-proxy`
  com `FLEETBASE_API_HOST=frota.pecsil`, como a Forja.
- **Segredos:** só nas variáveis do Coolify (`FB_APP_KEY`, `FB_DB_PASSWORD`, `FB_GOOGLE_MAPS_API_KEY`).
- **Armadilhas da instalação:**
  - os submódulos do git ficam **desligados** no Coolify (eles apontam para o GitHub por SSH, e o clone falha);
  - o teste de saúde do MySQL é pela rede (`127.0.0.1`), não pelo socket. Na primeira subida, o "pronto" pelo socket
    chega antes de o servidor aceitar conexões.

## No servidor (L-01 em produção), além do local

- **No Coolify:** o MySQL do Fleetbase entra no backup externo (T-02), e o acesso é pela rede interna, como na Forja.
- **De fora** (proxy, porta 443), ficam abertos só os endereços de que o app do motorista precisa. A consulta pública
  já vem fechada pelo `vhost.conf`, mas vale fechar também no proxy, para dar duas camadas.
- **No Google Cloud:** cota diária de 200 no ComputeRoutes e de 100 no ComputeRouteMatrix.
- **Antes de instalar:** dependem do proprietário quem responde pela expedição, a medição do servidor (Cesar) e o OK
  para instalar.
