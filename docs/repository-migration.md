# Repository consolidation

Web source moved from the repository root to `apps/web`. The complete iOS history through `f0ab01f` from `gtfol/capsule-scan` was joined with a merge commit, and its tree imported under `apps/ios`. Both original commit graphs remain reachable; do not squash or rebase this consolidation PR when merging it.

The old iOS repository is retained as a read-only archive after the new repository's checks and web deployment pass. New iOS changes belong here.

## Local checkouts

Pull the merged branch, then open the app directory you work on. Existing ignored files are not moved by Git. If your old web checkout has a local `.env` or `.env.local`, move it yourself into `apps/web`; do not commit it. Install web dependencies with `npm ci` inside `apps/web`. The previous iOS checkout can remain for local drafts, build artifacts, and history, but should no longer receive code changes.

## Vercel cutover

Keep the existing `capsule` project, Git connection, domains, environment variables, and production branch. Change only Root Directory from empty to `apps/web` before validating the consolidation preview. Older branches that still use the root layout cannot build with the new setting; the currently serving production deployment remains live during the cutover.

After preview and CI pass, merge using a merge commit, verify the production deployment, then archive `gtfol/capsule-scan`. A deployment rollback can restore the previous serving deployment without rebuilding it. To build old code again, also restore the old Root Directory.

No database, API, bundle ID, signing, or account migration is part of this change. The browser extension remains inside the web app tree. Marketing assets and the iOS test harness remain inside the iOS tree.
