# macos-build-actions

Reusable GitHub Actions workflow for signing, notarizing, and shipping Vendo macOS apps with Sparkle auto-updates.

## Use

```yaml
# .github/workflows/release.yml in your app repo
on:
  push:
    tags: ["v*.*.*"]
jobs:
  release:
    uses: runvendo/macos-build-actions/.github/workflows/release.yml@v1
    with:
      scheme: MyApp
      app-name: "My App"
      bundle-id: run.vendo.myapp
      app-slug: myapp
      appcast-url: https://updates.vendo.run/myapp/appcast.xml
      sparkle-public-key: <your pubkey>
    secrets: inherit
```

## Required secrets

**Shared (Vendo org-level, inherited via `secrets: inherit`):**
- `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_TEAM_ID`
- `ASC_API_KEY_P8_BASE64`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`
- `APPCAST_R2_ACCESS_KEY_ID`, `APPCAST_R2_SECRET_ACCESS_KEY`, `APPCAST_R2_ACCOUNT_ID`

**Per-repo:**
- `SPARKLE_ED_PRIVATE_KEY`

Full operator runbook: <https://github.com/runvendo/vendo/blob/main/docs/infra/macos-app-shipping.md>

## Composite actions

Each step is also exposed as a standalone composite action under `actions/`:
- `runvendo/macos-build-actions/actions/import-cert@v1`
- `runvendo/macos-build-actions/actions/notarize@v1`
- `runvendo/macos-build-actions/actions/sparkle-sign@v1`
- `runvendo/macos-build-actions/actions/appcast-update@v1`

## Versioning

Tag both moving (`v1`) and immutable (`v1.0.0`) tags per release. Consumers default to `@v1`; pin to `@v1.0.0` for strict reproducibility.
