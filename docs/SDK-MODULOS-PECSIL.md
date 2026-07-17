# SDK de Módulos — Pecsil Business OS

## Objetivo

Permitir que qualquer IDE ou equipe crie um domínio compatível com o Pecsil Business OS sem reconstruir autenticação, identidade, organização, documentos, notificações, auditoria ou navegação.

## Comando principal

```bash
npm run module:create -- \
  --code manutencao \
  --name "Manutenção" \
  --description "Gestão de ativos, planos e ordens de manutenção." \
  --short MT \
  --icon settings \
  --color orange
```

O comando valida entradas e cria:

```text
modules/manutencao/
├── manifest.ts
├── permissions.ts
├── README.md
├── components/
│   └── manutencao-module.tsx
├── data/
│   └── README.md
└── tests/
    └── contract.test.mjs
```

Também registra o manifesto em `modules/registry.ts` e o componente em `modules/runtime.tsx`.

## Segurança por padrão

Todo módulo nasce com:

- status `Planejado`;
- versão `0.1.0`;
- `enabled: false`;
- `menu.enabled: false`;
- seis permissões padronizadas;
- escopos de empresa, unidade, departamento e equipe;
- serviços centrais declarados;
- eventos básicos de auditoria;
- teste garantindo que não seja ativado acidentalmente.

Gerar ou registrar não libera o módulo para nenhum usuário. A ativação depende de homologação, habilitação da empresa e permissão do usuário.

## Opções

| Opção | Finalidade |
|---|---|
| `--code` | Identificador técnico obrigatório |
| `--name` | Nome exibido obrigatório |
| `--description` | Descrição funcional obrigatória |
| `--short` | Sigla de 2 a 4 caracteres |
| `--icon` | Ícone do Design System |
| `--color` | Cor visual autorizada |
| `--route` | Rota, por padrão `/modules/<code>` |
| `--dry-run` | Valida e mostra o plano sem gravar |
| `--no-register` | Gera arquivos sem alterar registro e runtime |

## Validação obrigatória

```bash
npm run modules:validate
npm run lint
npm test
```

O validador detecta códigos divergentes, rotas duplicadas, ausência de permissões, serviços compartilhados ou eventos de auditoria.

## Fluxo de desenvolvimento

1. Executar o gerador inicialmente com `--dry-run`.
2. Gerar a estrutura definitiva.
3. Implementar regras e telas específicas do domínio.
4. Adicionar migrations próprias sem alterar migrations já aplicadas.
5. Criar testes de regras, acesso e escopo.
6. Validar o contrato central.
7. Homologar com perfis diferentes.
8. Somente então solicitar ativação e inclusão no menu.

## Limites do SDK

O SDK cria e registra a estrutura técnica. Ele não inventa regras de negócio, não cria tabelas automaticamente, não concede permissões e não ativa o módulo. Essas decisões permanecem explícitas e auditáveis.
