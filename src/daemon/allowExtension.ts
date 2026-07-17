import { addAllowedExtensionId } from "./config";

const extensionId = process.argv[2]?.trim();
if (!extensionId) {
  console.error(
    "Usage: npm run daemon:allow-extension -- <32-character Chrome extension ID>",
  );
  process.exitCode = 1;
} else {
  const config = await addAllowedExtensionId(extensionId);
  console.error(
    `[ai-devtools-daemon] allowed Chrome extension ID ${extensionId.toLowerCase()}. Restart the daemon to apply the updated allowlist (${config.allowedExtensionIds.length} configured).`,
  );
}
