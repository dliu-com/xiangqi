AWS_REGION ?= eu-west-1
STACK_NAME ?= XiangqiSite

.PHONY: install serve test synth diff deploy-infra publish deploy security-test guest-check health-md build

install:
	cd cdk && npm ci

serve:
	npm start

test:
	npm test
	cd cdk && npm test -- --runInBand

synth:
	cd cdk && AWS_REGION=$(AWS_REGION) npm run synth

diff:
	cd cdk && AWS_REGION=$(AWS_REGION) npm run diff

deploy-infra:
	cd cdk && AWS_REGION=$(AWS_REGION) npm run deploy

publish:
	AWS_REGION=$(AWS_REGION) STACK_NAME=$(STACK_NAME) scripts/publish-site.sh

deploy: test deploy-infra publish

# Live, non-destructive penetration test of the deployed site (needs curl, openssl, node and AWS CLI read access).
security-test:
	AWS_REGION=$(AWS_REGION) STACK_NAME=$(STACK_NAME) scripts/security-test.sh

# The guest checks status.dliu.com runs (src/health-checks.js), against the live site.
guest-check:
	node scripts/guest-checks.mjs

# Regenerate src/docs-health.md (/docs/health.md) after changing src/health-checks.js.
health-md:
	node scripts/health-md.mjs

# The publishable site with ?v=<content hash> on every script, stylesheet and import, in dist/.
build:
	node scripts/build-site.mjs
