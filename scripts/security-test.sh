#!/usr/bin/env bash
# Live, non-destructive penetration test of https://xiangqi.dliu.com (make security-test).
# Every write uses a stale revision or an invalid action, so the shared game is never changed; the last check
# proves it. AWS CLI credentials are used only to look up this stack's function URL, bucket and CloudFront domain.
# Prints a Markdown table (test | expected | actual | result) and exits 1 if any check fails.
set -uo pipefail

SITE="${SITE:-https://xiangqi.dliu.com}"
HOST="${SITE#https://}"
STACK_NAME="${STACK_NAME:-XiangqiSite}"
AWS_REGION="${AWS_REGION:-eu-west-1}"
export AWS_REGION
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
failures=0

row() { printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$4"; }
# check <test> <expected description> <actual> <0|1: passed?>
check() { if [[ "$4" == 1 ]]; then row "$1" "$2" "$3" PASS; else row "$1" "$2" "$3" '**FAIL**'; failures=$((failures + 1)); fi; }
is() { [[ "$1" == "$2" ]] && echo 1 || echo 0; }
matches() { [[ "$1" =~ $2 ]] && echo 1 || echo 0; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
output() { aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
# post <body> [curl args…]: POST /api/game with a correct body hash; prints "status body".
post() {
  local body="$1"; shift
  curl -s -o "$TMP/body" -w '%{http_code}' --max-time 30 -X POST "$SITE/api/game" -H "x-amz-content-sha256: $(sha "$body")" "$@" --data-binary "$body"
  printf ' %s' "$(head -c 300 "$TMP/body" | tr '\n' ' ')"
}
revision() { curl -s --max-time 30 "$SITE/api/game$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).state.revision)}catch{console.log("unreadable")}})'; }
json='content-type: application/json'
CSP="default-src 'self'; script-src 'self'; style-src 'self' https://files.dliu.com/dliu.com/ui/; img-src 'self' https://files.dliu.com/dliu.com/; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

FUNCTION_URL="$(aws lambda get-function-url-config --function-name "$(output GameFunctionName)" --query FunctionUrl --output text)"
BUCKET="$(output SiteBucketName)"
CF_DOMAIN="$(output CloudFrontDomainName)"
START_REVISION="$(revision '')"

echo "Live security test of $SITE, $(date -u +%Y-%m-%dT%H:%MZ). Game revision at start: $START_REVISION"
echo
row Test Expected Actual Result
row --- --- --- ---

# Transport
r="$(curl -s -o /dev/null -D - "http://$HOST/" | tr -d '\r')"
check 'HTTP downgrade' '301 to https://' "$(echo "$r" | head -1 | cut -d' ' -f2) $(echo "$r" | grep -i '^location:' | cut -d' ' -f2)" "$(matches "$r" "^HTTP/1.1 301.*[Ll]ocation: https://$HOST/")"
loc="$(curl -s -o /dev/null -w '%{redirect_url}' "http://$HOST//evil.example/")"
check 'No open redirect (http://host//evil.example)' "Location stays on https://$HOST" "$loc" "$(matches "$loc" "^https://$HOST//")"
for version in tls1 tls1_1; do
  out="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" "-$version" 2>&1)"
  check "Old protocol $version" refused "$(echo "$out" | grep -q 'Cipher is (NONE)\|alert\|no protocols\|errno' && echo refused || echo accepted)" "$(echo "$out" | grep -q 'Cipher is (NONE)\|alert\|no protocols\|errno' && echo 1 || echo 0)"
done
for version in tls1_2 tls1_3; do
  out="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" "-$version" -verify_return_error 2>&1)"
  check "TLS $version with a valid certificate" 'accepted, verify OK' "$(echo "$out" | grep -o 'Verify return code: [0-9]* ([^)]*)' | head -1)" "$(matches "$out" 'Verify return code: 0 \(ok\)')"
done
out="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" -tls1_2 -cipher 'RC4:3DES:NULL:EXPORT:aNULL:MD5' 2>&1)"
check 'Weak ciphers (RC4, 3DES, NULL, EXPORT, MD5)' refused "$(echo "$out" | grep -q 'Cipher is (NONE)\|alert\|no cipher\|errno' && echo refused || echo accepted)" "$(echo "$out" | grep -q 'Cipher is (NONE)\|alert\|no cipher\|errno' && echo 1 || echo 0)"

# Security headers
for path in / /docs /api/game /no-such-page; do
  h="$(curl -s -o /dev/null -D - "$SITE$path" | tr -d '\r')"
  ok=1
  for expected in "content-security-policy: $CSP" 'strict-transport-security: max-age=31536000' 'x-frame-options: DENY' 'x-content-type-options: nosniff' 'referrer-policy: strict-origin-when-cross-origin' 'permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'; do
    grep -qiF "$expected" <<<"$h" || ok=0
  done
  leaks="$(grep -iE '^(server: AmazonS3|x-amz-version-id|x-amz-server-side-encryption|x-powered-by)' <<<"$h" | cut -d: -f1 | tr '\n' ' ')"
  [[ -n "$leaks" ]] && ok=0
  check "Security headers on $path" 'CSP, HSTS, DENY, nosniff, referrer, permissions; no S3 server headers' "$([[ $ok == 1 ]] && echo 'all present, none leaked' || echo "missing or leaked: $leaks")" "$ok"
done

# Hidden files, source maps and path tricks
for path in /.git/config /.git/HEAD /.env /.DS_Store /package.json /cdk.json /cdk/package.json /Makefile /README.md /backend/handler.cjs /backend/game-service.js /tests/api.test.js /app.js.map /docs.js.map /index.html.bak '/..%2f..%2fetc%2fpasswd' '/%2e%2e/%2e%2e/etc/passwd' '/docs/..%2f.env'; do
  c="$(code "$SITE$path")"
  check "Hidden file or traversal $path" 'not 2xx' "$c" "$(matches "$c" '^[^2]')"
done

# HTTP methods
for method in POST PUT DELETE PATCH OPTIONS TRACE; do
  c="$(code -X "$method" "$SITE/")"
  check "$method on a page" 'refused (not 2xx)' "$c" "$(matches "$c" '^[^2]')"
done
for method in PUT DELETE PATCH; do
  c="$(code -X "$method" "$SITE/api/game")"
  check "$method /api/game" 405 "$c" "$(is "$c" 405)"
done
c="$(code -X TRACE "$SITE/api/game")"
check 'TRACE /api/game' 'refused (not 2xx)' "$c" "$(matches "$c" '^[^2]')"
for path in /api/ /api/game/ /api/x /api/..%2fgame '/api/game%00' /api/game.json; do
  c="$(code "$SITE$path")"
  check "Unknown API path $path" 'not 2xx (404, or 400 from CloudFront)' "$c" "$(matches "$c" '^4')"
done

# Bypassing CloudFront
c="$(code "${FUNCTION_URL}api/game")"; check 'Lambda function URL called directly' 403 "$c" "$(is "$c" 403)"
c="$(code -X POST -H "$json" --data '{}' "${FUNCTION_URL}api/game")"; check 'POST to the function URL directly' 403 "$c" "$(is "$c" 403)"
c="$(code "https://$BUCKET.s3.$AWS_REGION.amazonaws.com/index.html")"; check 'S3 object read directly' 403 "$c" "$(is "$c" 403)"
c="$(code "https://$BUCKET.s3.$AWS_REGION.amazonaws.com/?list-type=2")"; check 'S3 bucket listing' 403 "$c" "$(is "$c" 403)"
c="$(code "http://$BUCKET.s3-website-$AWS_REGION.amazonaws.com/")"; check 'S3 website endpoint' 'not 2xx (no website hosting)' "$c" "$(matches "$c" '^[^2]')"
c="$(code -H 'Host: evil.example' "$SITE/")"; check 'Spoofed Host header' 'refused (not 2xx)' "$c" "$(matches "$c" '^[^2]')"
c="$(code "https://$CF_DOMAIN/")"; check '*.cloudfront.net serves the pages (accepted)' 200 "$c" "$(is "$c" 200)"

# Game API: identity, injection, CSRF, signing and validation (never a successful write)
R="$START_REVISION"; STALE=$((R + 100000))
check 'IDOR: ?gameId=other reads the same single game' "revision $R" "revision $(revision '?gameId=other')" "$(is "$(revision '?gameId=other')" "$R")"
r="$(post "{\"expectedRevision\":$STALE,\"gameId\":\"other\",\"action\":{\"type\":\"new\"}}" -H "$json")"
check 'IDOR: gameId in the body is ignored' "409 with revision $R" "${r:0:3}" "$(matches "$r" "^409 .*\"revision\":$R,")"
c="$(code -X POST -H "$json" --data "{\"expectedRevision\":$STALE,\"action\":{\"type\":\"new\"}}" "$SITE/api/game")"
check 'POST without x-amz-content-sha256' 'refused by the Lambda signature check' "$c" "$(matches "$c" '^40[34]$')"
c="$(code -X POST -H "$json" -H "x-amz-content-sha256: $(sha other)" --data "{\"expectedRevision\":$STALE,\"action\":{\"type\":\"new\"}}" "$SITE/api/game")"
check 'POST with a body hash for a different body' 'refused by the Lambda signature check' "$c" "$(matches "$c" '^40[34]$')"
for origin in https://evil.example https://blog.dliu.com "https://$CF_DOMAIN" null "http://$HOST"; do
  r="$(post "{\"expectedRevision\":$STALE,\"action\":{\"type\":\"new\"}}" -H "$json" -H "origin: $origin")"
  check "Cross-site POST, Origin $origin" 'refused (403, shown as the 404 page)' "${r:0:3}" "$(matches "$r" '^40[34] ')"
done
for type in text/plain application/x-www-form-urlencoded multipart/form-data; do
  r="$(post "{\"expectedRevision\":$STALE,\"action\":{\"type\":\"new\"}}" -H "content-type: $type")"
  check "Simple-request content type $type" 415 "${r:0:3}" "$(matches "$r" '^415 ')"
done
h="$(curl -s -o /dev/null -D - -X OPTIONS "$SITE/api/game" -H 'origin: https://evil.example' -H 'access-control-request-method: POST' -H 'access-control-request-headers: content-type,x-amz-content-sha256' | tr -d '\r')"
check 'CORS preflight from evil.example' 'no Access-Control-Allow-* headers' "$(grep -ci '^access-control-allow' <<<"$h") allow headers" "$(grep -qi '^access-control-allow' <<<"$h" && echo 0 || echo 1)"
h="$(curl -s -o /dev/null -D - "$SITE/api/game" -H 'origin: https://evil.example' | tr -d '\r')"
check 'Cross-site GET /api/game' 'no Access-Control-Allow-Origin' "$(grep -ci '^access-control-allow-origin' <<<"$h") ACAO headers" "$(grep -qi '^access-control-allow-origin' <<<"$h" && echo 0 || echo 1)"
pad="$(head -c 3000 /dev/zero | tr '\0' a)"
while IFS='|' read -r name body expected; do
  r="$(post "$body" -H "$json")"
  check "Input: $name" "$expected" "$(cut -c1-110 <<<"$r")" "$(matches "$r" "^$expected ")"
done <<EOF
malformed JSON|{bad|400
JSON null|null|400
JSON array|[1,2]|400
revision as a string|{"expectedRevision":"$R","action":{"type":"draw"}}|400
negative revision|{"expectedRevision":-1,"action":{"type":"draw"}}|400
revision 1e308|{"expectedRevision":1e308,"action":{"type":"draw"}}|400
NoSQL-style operator as the action type|{"expectedRevision":$R,"action":{"type":{"\$ne":null}}}|400
action type __proto__|{"expectedRevision":$R,"action":{"type":"__proto__"}}|400
action type constructor|{"expectedRevision":$R,"action":{"type":"constructor"}}|400
__proto__ pollution in the body|{"expectedRevision":$R,"__proto__":{"type":"new"},"action":{}}|400
fractional and text points|{"expectedRevision":$R,"action":{"type":"move","from":1.5,"to":"2"}}|400
out-of-range points|{"expectedRevision":$R,"action":{"type":"move","from":-1,"to":90}}|400
illegal move (corner to corner)|{"expectedRevision":$R,"action":{"type":"move","from":0,"to":89}}|400
a move from a point to itself|{"expectedRevision":$R,"action":{"type":"move","from":0,"to":0}}|400
stale revision|{"expectedRevision":$STALE,"action":{"type":"new"}}|409
body over 2 KB|{"expectedRevision":$R,"pad":"$pad","action":{"type":"draw"}}|413
EOF
head -c 7000000 /dev/zero | tr '\0' a > "$TMP/huge"
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$SITE/api/game" -H "$json" -H "x-amz-content-sha256: $(shasum -a 256 "$TMP/huge" | cut -d' ' -f1)" --data-binary @"$TMP/huge")"
check 'Input: 7 MB body' 'refused (not 2xx)' "$c" "$(matches "$c" '^[^2]')"

# Injection into responses and caches
h="$(curl -s -D - -o "$TMP/crlf" "$SITE/%0d%0aSet-Cookie:%20pwned=1" | tr -d '\r')"
check 'CRLF in the path' 'no injected Set-Cookie' "$(grep -ci 'pwned' <<<"$h") injected" "$(grep -qi pwned <<<"$h" && echo 0 || echo 1)"
h="$(curl -s -D - -o /dev/null "$SITE/api/game?x=%0d%0aSet-Cookie:%20pwned=1" | tr -d '\r')"
check 'CRLF in the API query string' 'no injected Set-Cookie' "$(grep -ci 'pwned' <<<"$h") injected" "$(grep -qi pwned <<<"$h" && echo 0 || echo 1)"
for url in "$SITE/?q=%3Cscript%3Ealert(1)%3C/script%3E" "$SITE/docs?q=%3Cscript%3Ealert(1)%3C/script%3E" "$SITE/%3Cscript%3Ealert(1)%3C/script%3E" "$SITE/api/x%3Cscript%3Ealert(1)%3C/script%3E"; do
  body="$(curl -s "$url")"
  check "Reflected XSS ${url#"$SITE"}" 'input not reflected' "$(grep -c 'alert(1)' <<<"$body") reflections" "$(grep -q 'alert(1)' <<<"$body" && echo 0 || echo 1)"
done
plain="$(curl -s "$SITE/" | shasum | cut -c1-12)"
cb="cb$RANDOM$RANDOM"
curl -s -o /dev/null "$SITE/?$cb" -H 'X-Forwarded-Host: evil.example' -H 'X-Host: evil.example' -H 'X-Original-URL: /evil' -H 'X-Rewrite-URL: /evil' -H 'X-Forwarded-Scheme: http' -H 'X-HTTP-Method-Override: POST'
after="$(curl -s "$SITE/?$cb" | shasum | cut -c1-12)"
check 'Cache poisoning with unkeyed headers' 'cached page identical to the real one' "$plain vs $after" "$(is "$plain" "$after")"
h="$(curl -s -D - -o /dev/null "$SITE/api/game/x.css" | tr -d '\r')"
check 'Cache deception /api/game/x.css' '404, never cached' "$(head -1 <<<"$h" | cut -d' ' -f2)" "$(matches "$(head -1 <<<"$h")" ' 404')"
curl -s -o /dev/null "$SITE/api/game"; h="$(curl -s -D - -o /dev/null "$SITE/api/game" | tr -d '\r')"
check '/api/game is never served from cache' 'cache-control: no-store, not a Hit' "$(grep -i '^cache-control\|^x-cache' <<<"$h" | tr '\n' ' ')" "$(grep -qi '^cache-control: no-store' <<<"$h" && ! grep -qi '^x-cache: Hit' <<<"$h" && echo 1 || echo 0)"

# Error messages
leak=0
for args in "-X POST -H content-type:application/json --data {bad" "-X DELETE" ""; do
  # shellcheck disable=SC2086
  body="$(curl -s $args "$SITE/api/x")$(curl -s $args "$SITE/api/game")"
  grep -qE 'at [A-Za-z.]+ \(|Error:|arn:aws|/var/task|node_modules|Exception' <<<"$body" && leak=1
done
check 'Error responses' 'no stack traces, ARNs or internal paths' "$([[ $leak == 0 ]] && echo none || echo found)" "$([[ $leak == 0 ]] && echo 1 || echo 0)"

# Cost abuse
statuses="$(seq 40 | xargs -P 40 -I{} curl -s -o /dev/null -w '%{http_code}\n' "$SITE/api/game" | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}')"
check '40 simultaneous API reads (concurrency cap 10)' 'only 200 or 429, no 5xx' "$statuses" "$(matches "$statuses" '^([0-9]+×(200|429) )+$')"

# Cookies
h="$(curl -s -D - -o /dev/null "$SITE/" | tr -d '\r' | grep -i '^set-cookie' | sed 's/=[^;]*;/=…;/')"
check 'Cookies set by the site' 'only dl_vid: Secure; HttpOnly; SameSite=Lax' "$h" "$(matches "$h" '^set-cookie: dl_vid=…; .*Secure; HttpOnly; SameSite=Lax$')"

END_REVISION="$(revision '')"
check 'The shared game was not changed by these tests' "revision $START_REVISION" "revision $END_REVISION" "$(is "$END_REVISION" "$START_REVISION")"

echo
if (( failures )); then echo "$failures check(s) failed."; exit 1; fi
echo 'Every check passed.'
