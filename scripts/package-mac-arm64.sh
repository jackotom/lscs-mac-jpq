#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$root_dir/outputs"
runtime_source="$output_dir/.mac-arm64-runtime"
stage_dir="$output_dir/.mac-arm64-stage"
publish_dir="$output_dir/.mac-arm64-publish"
publish_app="$publish_dir/炉石记牌器.app"
publish_zip="$output_dir/.炉石记牌器-mac-arm64.next.zip"
publish_checksum="$output_dir/.炉石记牌器-mac-arm64.next.zip.sha256"
target_app="$output_dir/炉石记牌器.app"
target_zip="$output_dir/炉石记牌器-mac-arm64.zip"
target_checksum="$output_dir/炉石记牌器-mac-arm64.zip.sha256"
package_listing="$stage_dir/package-contents.txt"
runtime_root_pattern='^/(?!(dist|dist-electron|node_modules)(/|$)|package\.json$|LICENSE$|THIRD_PARTY_NOTICES$)'

cleanup() {
  rm -rf "$runtime_source" "$stage_dir" "$publish_dir"
  rm -f "$publish_zip" "$publish_checksum"
}

trap cleanup EXIT
rm -rf "$runtime_source" "$stage_dir" "$publish_dir"
rm -f "$publish_zip" "$publish_checksum"
mkdir -p "$publish_dir"

for stale_path in "$output_dir"/release-* "$output_dir"/炉石记牌器\ *.app "$output_dir"/炉石记牌器-darwin-*; do
  if [[ "$stale_path" == "$output_dir/release-verification" ]]; then
    continue
  fi
  if [[ -e "$stale_path" ]]; then
    rm -rf "$stale_path"
  fi
done
rm -f "$output_dir"/炉石记牌器-mac-arm64-v*.zip

if [[ ! -x "$root_dir/native/bin/arena-ocr" ]]; then
  echo "竞技场识别组件未构建" >&2
  exit 1
fi
if [[ ! -x "$root_dir/native/bin/frontmost-app" ]]; then
  echo "前台应用识别组件未构建" >&2
  exit 1
fi

npm audit --omit=dev
mkdir -p "$runtime_source"
cp "$root_dir/package.json" "$root_dir/package-lock.json" "$root_dir/LICENSE" "$root_dir/THIRD_PARTY_NOTICES" "$runtime_source/"
ditto "$root_dir/dist" "$runtime_source/dist"
ditto "$root_dir/dist-electron" "$runtime_source/dist-electron"
(
  cd "$runtime_source"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
)
rm -rf "$runtime_source/node_modules/.vite"
rm -f "$runtime_source/node_modules/.package-lock.json" "$runtime_source/package-lock.json"
electron_version="$(node -p 'require("./node_modules/electron/package.json").version')"
app_version="$(node -p 'require("./package.json").version')"

electron_zip_args=()
if [[ -n "${ELECTRON_ZIP_DIR:-}" ]]; then
  electron_zip_args+=("--electron-zip-dir=$ELECTRON_ZIP_DIR")
fi

npx --offline @electron/packager "$runtime_source" "炉石记牌器" \
  --platform=darwin \
  --arch=arm64 \
  --electron-version="$electron_version" \
  --app-version="$app_version" \
  --build-version="$app_version" \
  --out="$stage_dir" \
  --overwrite \
  --asar \
  --no-prune \
  --app-bundle-id="cc.acyg.hearthstonemactracker" \
  --helper-bundle-id="cc.acyg.hearthstonemactracker.helper" \
  --extra-resource="$root_dir/native/bin/arena-ocr" \
  --extra-resource="$root_dir/native/bin/frontmost-app" \
  ${electron_zip_args[@]+"${electron_zip_args[@]}"} \
  --ignore="$runtime_root_pattern"

ditto "$stage_dir/炉石记牌器-darwin-arm64/炉石记牌器.app" "$publish_app"

assert_minimal_package() {
  local app_path="$1"
  "$root_dir/node_modules/.bin/asar" list "$app_path/Contents/Resources/app.asar" > "$package_listing"
  local package_entry_count
  package_entry_count="$(wc -l < "$package_listing" | tr -d ' ')"
  if [[ "$package_entry_count" -gt 500 ]]; then
    echo "安装包内容过多：${package_entry_count} 项" >&2
    exit 1
  fi
  if grep -Ev '^/(dist|dist-electron|node_modules)(/|$)|^/package\.json$|^/LICENSE$|^/THIRD_PARTY_NOTICES$' "$package_listing" | grep -q .; then
    echo "安装包混入非运行文件" >&2
    exit 1
  fi
  if ! grep -Fxq '/LICENSE' "$package_listing"; then
    echo "安装包缺少许可证" >&2
    exit 1
  fi
  if ! grep -Fxq '/THIRD_PARTY_NOTICES' "$package_listing"; then
    echo "安装包缺少第三方许可说明" >&2
    exit 1
  fi
  for forbidden_path in /src/ /tests/ /docs/ /fixtures/ /screenshots/ /.superpowers/ /node_modules/.vite/; do
    if grep -Fq "$forbidden_path" "$package_listing"; then
      echo "安装包混入禁止内容：$forbidden_path" >&2
      exit 1
    fi
  done
  echo "安装包内容验收：${package_entry_count} 项"
}

assert_minimal_package "$publish_app"
info_plist="$publish_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :NSScreenCaptureUsageDescription 仅用于在炉石传说界面自动识别当前模式、套牌和竞技场候选牌，画面不会上传。" "$info_plist" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :NSScreenCaptureUsageDescription string 仅用于在炉石传说界面自动识别当前模式、套牌和竞技场候选牌，画面不会上传。" "$info_plist"
signing_identity="${CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -n 1)}"
if [[ -z "$signing_identity" ]]; then
  echo "没有找到可用的 Apple Development 签名证书" >&2
  exit 1
fi
codesign --force --deep --sign "$signing_identity" "$publish_app"
codesign --force --sign "$signing_identity" \
  --identifier "cc.acyg.hearthstonemactracker.arena-ocr" \
  "$publish_app/Contents/Resources/arena-ocr"
codesign --force --sign "$signing_identity" \
  --identifier "cc.acyg.hearthstonemactracker.frontmost-app" \
  "$publish_app/Contents/Resources/frontmost-app"
codesign --force --sign "$signing_identity" "$publish_app"
plutil -extract NSScreenCaptureUsageDescription raw "$info_plist" >/dev/null
codesign --verify --deep --strict "$publish_app"

ditto -c -k --sequesterRsrc --keepParent "$publish_app" "$publish_zip"

rm -rf "$target_app"
mv "$publish_app" "$target_app"
rm -f "$target_zip"
mv "$publish_zip" "$target_zip"
rm -f "$target_checksum"
(
  cd "$output_dir"
  shasum -a 256 "$(basename "$target_zip")" > "$(basename "$publish_checksum")"
)
mv "$publish_checksum" "$target_checksum"
