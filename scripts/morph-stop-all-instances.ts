import { MorphCloudClient } from "morphcloud";
import { VM_CLEANUP_COMMANDS } from "../apps/www/lib/routes/sandboxes/cleanup";

const client = new MorphCloudClient();

const instances = await client.instances.list();

await Promise.all(
  instances.map(async (instance) => {
    console.log(`Stopping instance ${instance.id}`);
    // Kill all dev servers before pausing to avoid port conflicts on resume
    await instance.exec(VM_CLEANUP_COMMANDS).catch(() => {});
    await instance.pause();
  })
);
