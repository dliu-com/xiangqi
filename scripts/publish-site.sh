#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_NAME="${STACK_NAME:-XiangqiSite}"
AWS_REGION="${AWS_REGION:-eu-west-1}"
export AWS_REGION

# Resolve only this application's stack outputs; never write to a shared bucket.
SITE_BUCKET_NAME="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='SiteBucketName'].OutputValue" --output text)"
DISTRIBUTION_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
if [[ -z "$SITE_BUCKET_NAME" || "$SITE_BUCKET_NAME" == "None" || -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "The Xiangqi stack must be deployed before publishing its files." >&2
  exit 1
fi

node "$PROJECT_DIR/scripts/health-md.mjs" >/dev/null
# Publish a build of src/ in which every page loads its scripts, stylesheet and logo with ?v=<content hash>, and
# every module imports the others the same way, so a new page never runs with an older cached script.
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
node "$PROJECT_DIR/scripts/build-site.mjs" "$BUILD" >/dev/null
for script in engine.js i18n.js agent-tools.js diagram.js health-checks.js docs.js docs-health.js app.js; do node --check "$BUILD/$script"; done
# Upload dependencies first and the entrypoint last. Scripts, the stylesheet and the logo are held at the edge for a day
# (the invalidation below refreshes them on publish); HTML pages are always revalidated.
for filename in engine.js i18n.js agent-tools.js diagram.js health-checks.js docs.js docs-health.js app.js styles.css favicon.svg 404.html; do
  cache='public, max-age=300, s-maxage=86400, stale-while-revalidate=86400'
  case "$filename" in
    *.js) mime='text/javascript; charset=utf-8' ;;
    *.css) mime='text/css; charset=utf-8' ;;
    *.svg) mime='image/svg+xml' ;;
    *.html) mime='text/html; charset=utf-8'; cache='public, max-age=0, must-revalidate' ;;
  esac
  aws s3 cp "$BUILD/$filename" "s3://$SITE_BUCKET_NAME/$filename" --content-type "$mime" --cache-control "$cache" --only-show-errors
done
# /docs is the docs page itself, stored under that key, so it needs no URL rewriting at the edge.
aws s3 cp "$BUILD/docs.html" "s3://$SITE_BUCKET_NAME/docs" --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, max-age=0, must-revalidate' --only-show-errors
aws s3 cp "$BUILD/docs-health.md" "s3://$SITE_BUCKET_NAME/docs/health.md" --content-type 'text/markdown; charset=utf-8' --cache-control 'no-cache, max-age=0, must-revalidate' --only-show-errors
aws s3 cp "$BUILD/index.html" "s3://$SITE_BUCKET_NAME/index.html" --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, max-age=0, must-revalidate' --only-show-errors
INVALIDATION_ID="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' --query 'Invalidation.Id' --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION_ID"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" --output text
