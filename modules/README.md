# Contrato de Módulos — Pecsil Business OS

Todo módulo é um domínio isolado que consome a Fundação. A plataforma só reconhece módulos declarados por um `ModuleManifest` e adicionados ao `moduleRegistry`.

## Estrutura obrigatória

```text
modules/<codigo>/
├── manifest.ts
├── permissions.ts
├── data/
├── components/
├── tests/
└── README.md
```

O manifesto registra identidade, rota, estado, menu, permissão de entrada, escopos, serviços compartilhados e eventos auditáveis. O SDK cria essa estrutura e conecta o módulo ao registro e ao runtime.

## Gerar um módulo

```bash
npm run module:create -- \
  --code manutencao \
  --name "Manutenção" \
  --short MT \
  --description "Gestão de ativos, planos e ordens de manutenção." \
  --icon settings \
  --color orange
```

Use `--dry-run` para validar sem gravar arquivos e `--no-register` para gerar uma estrutura isolada. O SDK sempre cria o módulo como planejado, desativado e oculto.

## Fluxo para um novo módulo

1. Executar o gerador com código, nome e descrição.
2. Implementar as particularidades do domínio no componente e na pasta `data`.
3. Rodar `npm run modules:validate`, `npm run lint` e `npm test`.
4. Revisar permissões, escopos e eventos auditáveis.
5. Manter `enabled: false` até o módulo estar homologado.
6. Ao ativar, definir `status: "Integrado"`, `enabled: true` e `menu.enabled: true`.

O menu é montado somente com módulos ativos aos quais o usuário possui a permissão de entrada e um escopo compatível. O catálogo administrativo pode exibir também módulos planejados para o Proprietário.

O frontend oculta módulos não autorizados, mas a proteção definitiva permanece no PostgreSQL por RLS. Nenhum módulo deve confiar apenas na visibilidade do menu.
