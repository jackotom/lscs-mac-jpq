#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$root_dir/outputs"
version="$(node -p 'require("./package.json").version')"
tag="v${version}"
title="${tag} Apple 公证发行版"
app_path="$output_dir/炉石记牌器.app"
result_path="$output_dir/notarization-result-v${version}.json"
log_path="$output_dir/notarization-log-v${version}.json"
notes_path="$root_dir/docs/releases/${tag}.md"
provenance_path="$app_path/Contents/Resources/release-provenance.json"
release_dir="$(mktemp -d "${TMPDIR:-/tmp}/hearthstone-github-release.XXXXXX")"
release_zip="$release_dir/hearthstone-tracker-mac-arm64-${tag}.zip"
release_checksum="$release_zip.sha256"
release_verify_dir="$release_dir/verify"

cleanup() {
  rm -rf "$release_dir"
}
trap cleanup EXIT

cd "$root_dir"
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "GitHub 发布只能从 main 分支执行" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区存在未提交修改，停止发布" >&2
  exit 1
fi
git fetch origin main --tags
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "本机 main 与 origin/main 不一致" >&2
  exit 1
fi

for path in "$app_path" "$result_path" "$log_path" "$notes_path" "$provenance_path"; do
  if [[ ! -e "$path" ]]; then
    echo "缺少发布文件：$path" >&2
    exit 1
  fi
done

node -e '
  const provenance = require(process.argv[1]);
  const [version, commit] = process.argv.slice(2);
  if (provenance.version !== version || provenance.commit !== commit || provenance.state !== "clean") process.exit(1);
' "$provenance_path" "$version" "$(git rev-parse HEAD)"

node -e '
  const result = require(process.argv[1]);
  const log = require(process.argv[2]);
  if (result.status !== "Accepted" || (log.issues?.length ?? 0) !== 0) process.exit(1);
' "$result_path" "$log_path"
xcrun stapler validate "$app_path"
codesign --verify --deep --strict "$app_path"
signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
grep -Fq "Authority=Developer ID Application:" <<<"$signature_details"
grep -Eq 'flags=.*runtime' <<<"$signature_details"
grep -Fq "Timestamp=" <<<"$signature_details"

ditto -c -k --sequesterRsrc --keepParent "$app_path" "$release_zip"
mkdir -p "$release_verify_dir"
ditto -x -k "$release_zip" "$release_verify_dir"
node -e '
  const provenance = require(process.argv[1]);
  const [version, commit] = process.argv.slice(2);
  if (provenance.version !== version || provenance.commit !== commit || provenance.state !== "clean") process.exit(1);
' "$release_verify_dir/炉石记牌器.app/Contents/Resources/release-provenance.json" "$version" "$(git rev-parse HEAD)"
xcrun stapler validate "$release_verify_dir/炉石记牌器.app"
codesign --verify --deep --strict "$release_verify_dir/炉石记牌器.app"
(
  cd "$release_dir"
  shasum -a 256 "$(basename "$release_zip")" > "$(basename "$release_checksum")"
)

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  if [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
    echo "标签 $tag 已指向其它提交" >&2
    exit 1
  fi
else
  git tag -a "$tag" -m "$title"
fi
git push origin "refs/tags/$tag"

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "GitHub Release $tag 已存在，停止覆盖" >&2
  exit 1
fi
gh release create "$tag" \
  "$release_zip" \
  "$release_checksum" \
  --repo "$repo" \
  --title "$title" \
  --notes-file "$notes_path" \
  --verify-tag

gh release view "$tag" --repo "$repo" --json tagName,url,assets
