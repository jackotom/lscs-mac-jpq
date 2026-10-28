#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="${MAS_OUTPUT_DIR:-$root_dir/outputs}"
stage_dir="$output_dir/.mas-arm64-stage"
runtime_source="$output_dir/.mas-arm64-runtime"
publish_app="$output_dir/炉石记牌器-mas.app"
publish_pkg="$output_dir/炉石记牌器-mas.pkg"
unsigned_pkg="$output_dir/.炉石记牌器-mas-unsigned.pkg"
identity="${MAS_IDENTITY:-}"
installer_identity="${MAS_INSTALLER_IDENTITY:-}"
profile="${MAS_PROVISIONING_PROFILE:-}"

if [[ -z "$identity" ]]; then
  identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Distribution:[^"]*\)".*/\1/p' | head -n 1)"
fi
if [[ -z "$installer_identity" ]]; then
  installer_identity="$(security find-identity -v -p basic | sed -n 's/.*"\(3rd Party Mac Developer Installer:[^"]*\)".*/\1/p' | head -n 1)"
fi
if [[ -z "$identity" ]]; then
  echo "没有找到 Apple Distribution 签名证书；请设置 MAS_IDENTITY" >&2
  exit 1
fi
if [[ -z "$profile" || ! -f "$profile" ]]; then
  echo "缺少 Mac App Store provisioning profile；请设置 MAS_PROVISIONING_PROFILE" >&2
  exit 1
fi
if [[ -z "$installer_identity" ]]; then
  echo "没有找到 3rd Party Mac Developer Installer 证书；请设置 MAS_INSTALLER_IDENTITY" >&2
  exit 1
fi

rm -rf "$stage_dir" "$runtime_source" "$publish_app" "$publish_pkg" "$unsigned_pkg"
mkdir -p "$runtime_source"
npm run build:native
npm run build
cp "$root_dir/package.json" "$root_dir/package-lock.json" "$root_dir/LICENSE" "$root_dir/THIRD_PARTY_NOTICES" "$runtime_source/"
ditto "$root_dir/dist" "$runtime_source/dist"
ditto "$root_dir/dist-electron" "$runtime_source/dist-electron"
(
  cd "$runtime_source"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
)
rm -rf "$runtime_source/node_modules/.vite" "$runtime_source/node_modules/.package-lock.json" "$runtime_source/package-lock.json"

electron_version="$(node -p 'require("./node_modules/electron/package.json").version')"
app_version="$(node -p 'require("./package.json").version')"
npx --offline @electron/packager "$runtime_source" "炉石记牌器" \
  --platform=mas \
  --arch=arm64 \
  --electron-version="$electron_version" \
  --app-version="$app_version" \
  --build-version="${MAS_BUILD_VERSION:-$app_version}" \
  --out="$stage_dir" \
  --overwrite \
  --asar \
  --no-prune \
  --app-bundle-id="cc.acyg.hearthstonemactracker" \
  --helper-bundle-id="cc.acyg.hearthstonemactracker.helper" \
  --extra-resource="$root_dir/native/bin/arena-ocr" \
  --extra-resource="$root_dir/native/bin/frontmost-app" \
  --ignore='^/(?!(dist|dist-electron|node_modules)(/|$)|package\.json$|LICENSE$|THIRD_PARTY_NOTICES$)'

ditto "$stage_dir/炉石记牌器-mas-arm64/炉石记牌器.app" "$publish_app"
ditto "$root_dir/assets/icons/local-log-stats.icns" "$publish_app/Contents/Resources/local-log-stats.icns"
plutil -replace CFBundleIconFile -string "local-log-stats.icns" "$publish_app/Contents/Info.plist"
mv "$publish_app/Contents/Resources/arena-ocr" "$publish_app/Contents/MacOS/arena-ocr"
mv "$publish_app/Contents/Resources/frontmost-app" "$publish_app/Contents/MacOS/frontmost-app"
plutil -replace ITSAppUsesNonExemptEncryption -bool false "$publish_app/Contents/Info.plist"
node "$root_dir/scripts/sign-mas-app.mjs" "$publish_app" "$identity" "$profile"
codesign --verify --deep --strict --verbose=2 "$publish_app"
codesign -d --entitlements :- "$publish_app" 2>&1 | grep -Fq "com.apple.security.app-sandbox"
productbuild --component "$publish_app" /Applications "$unsigned_pkg"
productsign --sign "$installer_identity" "$unsigned_pkg" "$publish_pkg"
rm -f "$unsigned_pkg"
pkgutil --check-signature "$publish_pkg"
echo "MAS 包已生成：$publish_pkg"
