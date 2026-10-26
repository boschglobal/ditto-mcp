# Bundled Ditto OpenAPI spec

`ditto-api-2.yml` is a verbatim copy of Eclipse Ditto's HTTP API spec, used as the
offline fallback when `ditto.openApi` sets none of `path`, `url` or `version`.

- Source: `eclipse-ditto/ditto` → `documentation/src/main/resources/openapi/ditto-api-2.yml`
- Copied from commit `d75e2629bb` (2026-04-30)

Do not edit it by hand. To refresh, copy the file from a Ditto checkout and update the
commit above:

```bash
cp ../ditto/documentation/src/main/resources/openapi/ditto-api-2.yml openapi/ditto-api-2.yml
```

To target a specific Ditto release at runtime instead, set `ditto.openApi.version`.
