# Medidor 3D

Serviço separado que mede as peças de um arquivo STEP para o orçamento do Pecsil Business OS
(ROADMAP C-19). Ele mede volume, área e medidas externas de cada corpo, a área das pontas e das
demais faces (que entram no sobremetal do bruto) e gera a imagem de cada peça destacada na
montagem.

- **Motor:** [SolidCraft](https://github.com/tangency-labs/solidcraft) `solidcraft-cli`, licença
  MIT/Apache. É baixado da release oficial no build do Dockerfile, com o sha256 publicado em
  `SHA256SUMS.txt`. Roda sem tela e desenha as imagens na CPU (`SOLIDCRAFT_GPU=cpu`).
- **Isolamento:** a plataforma não importa nada daqui. Ela fala com o serviço por HTTP
  (`lib/comercial/medidor-3d.ts`, variáveis `MEDIDOR_URL` e `MEDIDOR_SECRET`).
- **Sem estado:** o STEP fica numa pasta temporária só durante a medição e é apagado em seguida.
  O arquivo do cliente não sai do servidor.
- **Uma medição por vez:** o motor usa todos os núcleos. Quem chega depois espera na fila, de no
  máximo 5. Uma montagem com cinco peças leva de 25 s a 2 min.

## Segurança

- Toda chamada, menos `GET /saude`, exige o cabeçalho `x-medidor-secret` igual a `MEDIDOR_SECRET`
  (32 ou mais caracteres, comparação em tempo constante).
- Sem domínio público: o serviço fica só na rede interna do Coolify.

## API

| Rota | O quê |
| --- | --- |
| `GET /saude` | `{ ok, motor, fila }` |
| `POST /v1/medir` | Corpo = bytes do STEP. Resposta `{ ok: true, resultado: { versao_motor, tempo_ms, corpos, imagens } }`. Erro: `{ ok: false, erro: { codigo, mensagem } }` (400 arquivo, 401 segredo, 413 tamanho, 429 fila, 502 motor) |

Cada item de `corpos` traz `nome`, `componente` (nome da peça na montagem), `ocorrencias`,
`volume_mm3`, `area_mm2`, `bbox`, `eixo`, `area_pontas_mm2` e `area_demais_mm2`. O campo
`imagens` traz `{ montagem, <corpo>: PNG em base64 }` dos corpos com 20 cm³ ou mais.

## Coolify

App novo a partir deste repositório, com Base Directory `/services/medidor-3d` (Dockerfile), sem
domínio e na mesma rede da plataforma. Variáveis:

- no medidor: `MEDIDOR_SECRET`;
- na plataforma: `MEDIDOR_URL=http://<nome do serviço>:3200` e o mesmo `MEDIDOR_SECRET`.

Opcionais: `MEDIDOR_LIMITE_MB` (100) e `MEDIDOR_TEMPO_MAX_S` (300 por etapa).

## Testes

`npm test` roda as contas de `geometria.mjs`, sem o motor.
