# Fleetbase da PecSil (serviço de entregas)

O motor das entregas da Logística ([docs/PLANO-LOGISTICA.md](../../docs/PLANO-LOGISTICA.md)). Roda como **serviço
separado** (AGPL-3.0) e a plataforma fala com ele só pela API. O código é o fork
[`jusales3270/fleetbase-frota`](https://github.com/jusales3270/fleetbase-frota), sem alteração no código dele: o que
é da PecSil fica aqui, como configuração.

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

## No servidor (L-01 em produção), além do local

- **No Coolify:** o MySQL do Fleetbase entra no backup externo (T-02), e o acesso é pela rede interna, como na Forja.
- **De fora** (proxy, porta 443), ficam abertos só os endereços de que o app do motorista precisa. A consulta pública
  já vem fechada pelo `vhost.conf`, mas vale fechar também no proxy, para dar duas camadas.
- **No Google Cloud:** cota diária de 200 no ComputeRoutes e de 100 no ComputeRouteMatrix.
- **Antes de instalar:** dependem do proprietário quem responde pela expedição, a medição do servidor (Cesar) e o OK
  para instalar.
