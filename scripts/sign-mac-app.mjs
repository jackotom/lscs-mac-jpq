import { sign } from "@electron/osx-sign";

const [app, identity, ...binaries] = process.argv.slice(2);

if (!app || !identity) {
  throw new Error("缺少应用路径或 Developer ID 签名身份");
}

await sign({
  app,
  identity,
  binaries,
  platform: "darwin",
  type: "distribution",
  preEmbedProvisioningProfile: false,
});
