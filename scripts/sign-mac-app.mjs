import { sign } from "@electron/osx-sign";

const [app, identity, ...binaries] = process.argv.slice(2);

if (!app || !identity) {
  throw new Error("缺少应用路径或 Developer ID 签名身份");
}

for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    await sign({
      app,
      identity,
      binaries,
      platform: "darwin",
      type: "distribution",
      preEmbedProvisioningProfile: false,
    });
    break;
  } catch (error) {
    const timestampUnavailable =
      error instanceof Error && /timestamp service is not available/i.test(error.message);
    if (!timestampUnavailable || attempt === 3) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
}
