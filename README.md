# capsule

Your digital wardrobe. This repository contains the web app and native iPhone app.

| App | Source | Development |
| --- | --- | --- |
| Web | [apps/web](apps/web) | `cd apps/web && npm ci && npm run dev` |
| iPhone | [apps/ios](apps/ios) | Open `apps/ios/CapsuleScan.xcodeproj` in Xcode |
| Browser extension | [apps/web/extension](apps/web/extension) | Load the directory unpacked in Chrome or Brave |

The apps keep independent build tools: npm for Next.js, Xcode/Swift for iOS. There is no root package install or shared dependency lockfile. Run app-specific commands from that app's directory.

## Checks

- Web: in `apps/web`, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- iOS: in `apps/ios`, run `swift test` and `scripts/test-ios.sh` (requires Xcode and an iPhone simulator).
- GitHub Actions runs the relevant checks when an app or its workflow changes.

## Deployment

The existing Vercel project `capsule` deploys `apps/web` from `main` to [capsule.gtfol.dev](https://capsule.gtfol.dev). Keep its Root Directory set to `apps/web`; environment variables and domains remain on that same project. Local web configuration belongs in `apps/web/.env.local` and must not be committed.

The iPhone app uses bundle ID `dev.gtfol.capsule`. Its Xcode target remains `CapsuleScan`; its existing callback scheme is unchanged. Build and upload using the project inside `apps/ios`.

[Web setup and API](apps/web/README.md) · [iPhone setup](apps/ios/README.md) · [Repository migration](docs/repository-migration.md)

[Support](https://gtfol.dev/contact) · [Privacy](https://capsule.gtfol.dev/privacy) · [Terms](https://capsule.gtfol.dev/terms)
