#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$root_dir/outputs"
app_path="$output_dir/炉石记牌器.app"
zip_path="$output_dir/炉石记牌器-mac-arm64.zip"
checksum_path="$output_dir/炉石记牌器-mac-arm64.zip.sha256"
profile="${NOTARY_PROFILE:-VideoPlayerNotary}"
app_version="$(node -p 'require("./package.json").version')"
result_path="$output_dir/notarization-result-v${app_version}.json"
log_path="$output_dir/notarization-log-v${app_version}.json"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/hearthstone-notary.XXXXXX")"
submission_path="$work_dir/submission.json"
stapled_zip="$work_dir/炉石记牌器-mac-arm64.zip"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

if [[ ! -d "$app_path" || ! -s "$zip_path" ]]; then
  echo "缺少待公证的应用或压缩包，请先运行 npm run package:mac-arm64" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"
signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
grep -Fq "Authority=Developer ID Application:" <<<"$signature_details"
grep -Eq 'flags=.*runtime' <<<"$signature_details"
grep -Fq "Timestamp=" <<<"$signature_details"
rm -f "$result_path" "$log_path"

xcrun notarytool submit "$zip_path" \
  --keychain-profile "$profile" \
  --wait \
  --output-format json > "$submission_path"

submission_status="$(node -e 'const r=require(process.argv[1]); process.stdout.write(String(r.status ?? ""))' "$submission_path")"
submission_id="$(node -e 'const r=require(process.argv[1]); process.stdout.write(String(r.id ?? ""))' "$submission_path")"
if [[ -z "$submission_id" ]]; then
  echo "公证服务未返回任务编号" >&2
  exit 1
fi

cp "$submission_path" "$result_path"
xcrun notarytool log "$submission_id" \
  --keychain-profile "$profile" \
  "$log_path"

if [[ "$submission_status" != "Accepted" ]]; then
  echo "Apple 公证失败：$submission_status；详情见 $log_path" >&2
  exit 1
fi

node -e '
  const report = require(process.argv[1]);
  const issues = Array.isArray(report.issues) ? report.issues : [];
  if (issues.length > 0) {
    console.error(`公证日志仍有 ${issues.length} 个问题`);
    process.exit(1);
  }
' "$log_path"

stapled=0
for _ in 1 2 3; do
  if xcrun stapler staple "$app_path"; then
    stapled=1
    break
  fi
  sleep 2
done
if [[ "$stapled" -ne 1 ]]; then
  echo "公证已通过，但票据装订失败" >&2
  exit 1
fi

xcrun stapler validate "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
spctl --assess --type execute --verbose=4 "$app_path"

ditto -c -k --sequesterRsrc --keepParent "$app_path" "$stapled_zip"
mv "$stapled_zip" "$zip_path"
(
  cd "$output_dir"
  shasum -a 256 "$(basename "$zip_path")" > "$(basename "$checksum_path")"
)

echo "Apple 公证与票据装订完成：v${app_version}（任务 ${submission_id}）"
