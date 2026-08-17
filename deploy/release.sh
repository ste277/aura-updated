#!/usr/bin/env bash
# Cut a release: tag main and publish a GitHub Release. Run LOCALLY:
#   bash deploy/release.sh v1.2.0 "Short description"
#
# Then deploy it on the server:
#   ssh vf-1 'cd /srv/aura/src && bash deploy/deploy.sh v1.2.0'
#
# Releases are always cut from origin/main so a release is a specific,
# reviewed, CI-passed commit — production never tracks a moving branch.
set -euo pipefail

VERSION="${1:-}"
NOTES="${2:-}"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 vX.Y.Z [notes]"; exit 1; }

git fetch --quiet origin main --tags
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  echo "!!  $VERSION already exists"; exit 1
fi

SHA="$(git rev-parse origin/main)"
echo "==> tagging origin/main ($(git rev-parse --short "$SHA")) as $VERSION"
git tag -a "$VERSION" "$SHA" -m "${NOTES:-Release $VERSION}"
git push origin "$VERSION"

echo "==> publishing GitHub release"
gh release create "$VERSION" --title "$VERSION" --notes "${NOTES:-Release $VERSION}" --generate-notes --target "$SHA"
echo "==> done. Deploy with:  ssh vf-1 'cd /srv/aura/src && bash deploy/deploy.sh $VERSION'"
