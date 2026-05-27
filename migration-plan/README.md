# Migration-plan — di chuyen module tu MSSQL sang framework

Thu muc nay chua manifest mo ta tung **module nghiep vu** dang duoc migrate
tu ung dung MSSQL cu sang ERP framework. Moi manifest la single source of
truth cho dot port module do.

## Workflow

```
1. Phat hien   →  pnpm migrate discover --name <module> --seed-tables T1,T2
                  → sinh modules/<module>.yaml
2. Review      →  Chinh tier proc / ten entity / cross-module edge trong YAML
3. Capture     →  pnpm migrate capture-golden --module <module>
                  → e2e/golden/<module>/<proc>.json
4. Generate    →  pnpm migrate generate --module <module>
                  → seed-modules/<module>.ts, plugins/module-<name>/, page mau
5. Human fill  →  Viet tay tier B (procedure JS) + tier D (plugin TS)
6. ETL data    →  pnpm migrate data --module <module>
7. Verify      →  pnpm test --golden <module> + pnpm e2e:full --module <module>
8. Cutover     →  Doi route FE; rename proc MSSQL → DEPRECATED; theo doi 7 ngay
```

## Cau truc thu muc

```
migration-plan/
├── README.md                       (file nay)
└── modules/
    ├── _example.yaml               (template + chu thich tung field)
    ├── <module-1>.yaml             (manifest module 1 — vi du: sales.yaml)
    ├── <module-2>.yaml
    └── ...
```

## File lien quan trong repo

- `packages/mssql-client/` — driver wrapper + parse-proc heuristic
- `tooling/migration-cli/` — CLI `pnpm migrate`
- `packages/plugins/mssql-bridge/` — runtime MCP-connector goi MSSQL tu procedure-JS
- `packages/server/src/seed-modules/<module>.ts` — seed entity + page sinh ra
- `packages/plugins/module-<name>/` — code tier D cua module (plugin TS)
- `e2e/golden/<module>/*.json` — baseline output MSSQL de diff

## Env can dat

- `MSSQL_CONNECTION_STRING` — connection string MSSQL legacy (read-only)
- `MSSQL_ALLOW_WRITE=1` — chi bat khi can `execProc` capture golden (luon tat
  o production)
