# Transmissor de NF-e

Serviço separado que conversa com a SEFAZ para o Pecsil Business OS: emissão, eventos,
distribuição de documentos (notas recebidas) e DANFE.

- **Licença:** GPL-3.0-only (ver `LICENSE`), por usar a biblioteca
  [NFeWizard-io](https://github.com/nfewizard-org/nfewizard-io) (GPL-3.0). O código-fonte deste
  serviço é este diretório.
- **Isolamento:** a plataforma não importa nada daqui. Fala com o serviço por HTTP, pelo
  contrato em `lib/fiscal/transmissor/` da plataforma. Trocar o transmissor (por exemplo, por
  uma API paga) é trocar a implementação desse contrato, sem mexer no resto.
- **Sem estado:** nada fica guardado aqui. Emitente, ambiente e certificado chegam a cada chamada.

## Segurança

- Toda chamada (menos `GET /saude`) exige o cabeçalho `x-transmissor-secret` igual a
  `TRANSMISSOR_SECRET` (32+ caracteres, comparação em tempo constante).
- Sem domínio público: o serviço fica só na rede interna.
- O certificado A1 (`.pfx` em base64 + senha) chega no corpo da chamada e só existe em memória.
  O log da biblioteca, que registraria a configuração com o certificado, é descartado.
- Erros devolvidos nunca trazem o certificado nem a senha.

## API

`POST /v1/<operação>`, corpo JSON. Resposta: `{ ok: true, resultado }` ou
`{ ok: false, erro: { codigo, mensagem } }` (400 = pedido inválido; 502 = falha na SEFAZ ou
na biblioteca; 401 = sem segredo).

Campos comuns às operações que falam com a SEFAZ:
`{ uf: "SP", cnpj: "00000000000000", ambiente: "homologacao" | "producao", certificado: { pfx, senha } }`.
Sem `ambiente`, vale **homologação**.

| Operação       | Campos próprios                                                        |
| -------------- | ---------------------------------------------------------------------- |
| `status`       | (nenhum)                                                               |
| `validar`      | `xml` (sem certificado: esquema oficial 4.00)                          |
| `autorizar`    | `xml` ou `nfe` (objeto no formato da biblioteca)                       |
| `consultar`    | `chave`                                                                |
| `evento`       | `tipo`: `cancelamento` (`chave`, `protocolo`, `justificativa` 15+), `carta` (`chave`, `correcao` 15+, `sequencia`), `ciencia` (`chave`) |
| `inutilizar`   | `ano`, `serie`, `inicio`, `fim`, `justificativa` (15+)                 |
| `distribuicao` | `ultimoNsu` ou `chave`                                                 |
| `cadastro`     | `cnpjConsulta`, `ufConsulta`                                           |
| `danfe`        | `xml` autorizado (sem certificado). Devolve `{ pdf }` em base64        |

## Rodar

```bash
npm install --ignore-scripts && npm rebuild libxmljs2
TRANSMISSOR_SECRET=<32+ caracteres> npm start      # porta 3100 (ou PORT)
node --test teste/servidor.test.mjs
```

Docker: `docker build -t transmissor-nfe .` e
`docker run -e TRANSMISSOR_SECRET=... -p 3100:3100 transmissor-nfe`.
