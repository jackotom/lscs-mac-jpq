import { sign } from "@electron/osx-sign";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [app, identity, provisioningProfile] = process.argv.slice(2);
if (!app || !identity || !provisioningProfile) {
  throw new Error("缺少 MAS 应用路径、Apple Distribution 身份或 provisioning profile");
}

const root = fileURLToPath(new URL("../", import.meta.url));
const mainEntitlements = `${root}build/mas.entitlements.plist`;
const inheritEntitlements = `${root}build/mas.inherit-entitlements.plist`;
const embeddedProfile = path.join(app, "Contents", "embedded.provisionprofile");

await copyFile(provisioningProfile, embeddedProfile);

await sign({
  app,
  identity,
  platform: "mas",
  type: "distribution",
  provisioningProfile,
  preEmbedProvisioningProfile: false,
  optionsForFile: (filePath) => ({
    entitlements: /\/Contents\/(Frameworks|PlugIns|MacOS)\//.test(filePath)
      ? inheritEntitlements
      : mainEntitlements
  })
});

if (!(await readFile(provisioningProfile)).equals(await readFile(embeddedProfile))) {
  throw new Error("嵌入的 provisioning profile 与指定 profile 不一致");
}
