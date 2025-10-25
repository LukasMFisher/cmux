import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";

export type ScriptIdentifiers = {
  maintenance: {
    windowName: string;
    scriptPath: string;
  };
  dev: {
    windowName: string;
    scriptPath: string;
  };
};

export const allocateScriptIdentifiers = (): ScriptIdentifiers => {
  return {
    maintenance: {
      windowName: MAINTENANCE_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${MAINTENANCE_SCRIPT_FILENAME}`,
    },
    dev: {
      windowName: DEV_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${DEV_SCRIPT_FILENAME}`,
    },
  };
};

type ScriptResult = {
  maintenanceError: string | null;
  devError: string | null;
};

// Embedded orchestrator script template
// This will be uploaded to the sandbox with placeholders replaced
const ORCHESTRATOR_TEMPLATE = `#!/usr/bin/env bun
/**
 * Orchestrator script for running maintenance and dev scripts in sequence.
 * This script runs in the background to avoid Vercel timeouts.
 *
 * Flow:
 * 1. Create both tmux windows upfront
 * 2. Run maintenance script and wait for completion
 * 3. Run dev script (regardless of maintenance outcome)
 */

import { $ } from "bun";

const WORKSPACE_ROOT = "{{WORKSPACE_ROOT}}";
const CMUX_RUNTIME_DIR = "{{CMUX_RUNTIME_DIR}}";
const MAINTENANCE_SCRIPT_PATH = "{{MAINTENANCE_SCRIPT_PATH}}";
const DEV_SCRIPT_PATH = "{{DEV_SCRIPT_PATH}}";
const MAINTENANCE_WINDOW_NAME = "{{MAINTENANCE_WINDOW_NAME}}";
const DEV_WINDOW_NAME = "{{DEV_WINDOW_NAME}}";
const MAINTENANCE_EXIT_CODE_PATH = "{{MAINTENANCE_EXIT_CODE_PATH}}";
const HAS_MAINTENANCE_SCRIPT = "{{HAS_MAINTENANCE_SCRIPT}}" === "true";
const HAS_DEV_SCRIPT = "{{HAS_DEV_SCRIPT}}" === "true";

async function waitForTmuxSession(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      const result = await $\`tmux has-session -t cmux 2>/dev/null\`.quiet();
      if (result.exitCode === 0) {
        console.log("[ORCHESTRATOR] tmux session found");
        return;
      }
    } catch (error) {
      // Session not ready yet
    }
    await Bun.sleep(500);
  }

  const result = await $\`tmux has-session -t cmux 2>/dev/null\`.quiet();
  if (result.exitCode !== 0) {
    throw new Error("Error: cmux session does not exist");
  }
}

async function createWindows(): Promise<void> {
  await waitForTmuxSession();

  if (HAS_MAINTENANCE_SCRIPT) {
    try {
      console.log(\`[ORCHESTRATOR] Creating \${MAINTENANCE_WINDOW_NAME} window...\`);
      await $\`tmux new-window -t cmux: -n \${MAINTENANCE_WINDOW_NAME} -d\`;
      console.log(\`[ORCHESTRATOR] \${MAINTENANCE_WINDOW_NAME} window created\`);
    } catch (error) {
      console.error(\`[ORCHESTRATOR] Failed to create \${MAINTENANCE_WINDOW_NAME} window:\`, error);
      throw error;
    }
  }

  if (HAS_DEV_SCRIPT) {
    try {
      console.log(\`[ORCHESTRATOR] Creating \${DEV_WINDOW_NAME} window...\`);
      await $\`tmux new-window -t cmux: -n \${DEV_WINDOW_NAME} -d\`;
      console.log(\`[ORCHESTRATOR] \${DEV_WINDOW_NAME} window created\`);
    } catch (error) {
      console.error(\`[ORCHESTRATOR] Failed to create \${DEV_WINDOW_NAME} window:\`, error);
      throw error;
    }
  }
}

async function runMaintenanceScript(): Promise<{ exitCode: number; error: string | null }> {
  if (!HAS_MAINTENANCE_SCRIPT) {
    console.log("[MAINTENANCE] No maintenance script to run");
    return { exitCode: 0, error: null };
  }

  try {
    console.log("[MAINTENANCE] Starting maintenance script...");

    const scriptCommand = \`zsh "\${MAINTENANCE_SCRIPT_PATH}"
EXIT_CODE=$?
echo "$EXIT_CODE" > "\${MAINTENANCE_EXIT_CODE_PATH}"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[MAINTENANCE] Script exited with code $EXIT_CODE" >&2
else
  echo "[MAINTENANCE] Script completed successfully"
fi
exec zsh\`;

    await $\`tmux send-keys -t cmux:\${MAINTENANCE_WINDOW_NAME} \${scriptCommand} C-m\`;

    await Bun.sleep(2000);

    console.log("[MAINTENANCE] Waiting for script to complete...");
    let attempts = 0;
    const maxAttempts = 600; // 10 minutes max
    while (attempts < maxAttempts) {
      const file = Bun.file(MAINTENANCE_EXIT_CODE_PATH);
      if (await file.exists()) {
        break;
      }
      await Bun.sleep(1000);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.error("[MAINTENANCE] Script timed out after 10 minutes");
      return {
        exitCode: 124,
        error: "Maintenance script timed out after 10 minutes"
      };
    }

    const exitCodeFile = Bun.file(MAINTENANCE_EXIT_CODE_PATH);
    const exitCodeText = await exitCodeFile.text();
    const exitCode = parseInt(exitCodeText.trim()) || 0;

    await $\`rm -f \${MAINTENANCE_EXIT_CODE_PATH}\`;

    console.log(\`[MAINTENANCE] Script completed with exit code \${exitCode}\`);

    if (exitCode !== 0) {
      return {
        exitCode,
        error: \`Maintenance script finished with exit code \${exitCode}\`
      };
    }

    return { exitCode: 0, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[MAINTENANCE] Error: \${errorMessage}\`);
    return {
      exitCode: 1,
      error: \`Maintenance script execution failed: \${errorMessage}\`
    };
  }
}

async function startDevScript(): Promise<{ error: string | null }> {
  if (!HAS_DEV_SCRIPT) {
    console.log("[DEV] No dev script to run");
    return { error: null };
  }

  try {
    console.log("[DEV] Starting dev script...");

    await $\`tmux send-keys -t cmux:\${DEV_WINDOW_NAME} "zsh \\"\${DEV_SCRIPT_PATH}\\"" C-m\`;

    await Bun.sleep(2000);

    const windowCheck = await $\`tmux list-windows -t cmux\`.text();
    if (windowCheck.includes(DEV_WINDOW_NAME)) {
      console.log("[DEV] Script started successfully");
      return { error: null };
    } else {
      const error = "Dev window not found after starting script";
      console.error(\`[DEV] ERROR: \${error}\`);
      return { error };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[DEV] Error: \${errorMessage}\`);
    return {
      error: \`Dev script execution failed: \${errorMessage}\`
    };
  }
}

(async () => {
  try {
    console.log("[ORCHESTRATOR] Starting orchestrator...");

    await createWindows();

    const maintenanceResult = await runMaintenanceScript();
    if (maintenanceResult.error) {
      console.error(\`[ORCHESTRATOR] Maintenance completed with error: \${maintenanceResult.error}\`);
    } else {
      console.log("[ORCHESTRATOR] Maintenance completed successfully");
    }

    const devResult = await startDevScript();
    if (devResult.error) {
      console.error(\`[ORCHESTRATOR] Dev script failed: \${devResult.error}\`);
      process.exit(1);
    } else {
      console.log("[ORCHESTRATOR] Dev script started successfully");
    }

    console.log("[ORCHESTRATOR] Orchestrator completed successfully");
    process.exit(0);
  } catch (error) {
    console.error(\`[ORCHESTRATOR] Fatal error: \${error}\`);
    process.exit(1);
  }
})();
`;

export async function runMaintenanceAndDevScripts({
  instance,
  maintenanceScript,
  devScript,
  identifiers,
}: {
  instance: MorphInstance;
  maintenanceScript?: string;
  devScript?: string;
  identifiers?: ScriptIdentifiers;
}): Promise<ScriptResult> {
  const ids = identifiers ?? allocateScriptIdentifiers();

  if (
    (!maintenanceScript || maintenanceScript.trim().length === 0) &&
    (!devScript || devScript.trim().length === 0)
  ) {
    return {
      maintenanceError: "Both maintenance and dev scripts are empty",
      devError: null,
    };
  }

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  // Generate unique run IDs for this execution
  const runId = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const orchestratorScriptPath = `${CMUX_RUNTIME_DIR}/orchestrator_${runId}.ts`;
  const maintenanceExitCodePath = `${CMUX_RUNTIME_DIR}/maintenance_${runId}.exit-code`;

  // Create maintenance script if provided
  const maintenanceScriptContent = maintenanceScript && maintenanceScript.trim().length > 0
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \\$(date) ==="
`
    : null;

  // Create dev script if provided
  const devScriptContent = devScript && devScript.trim().length > 0
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${devScript}
`
    : null;

  // Generate orchestrator script by replacing placeholders
  const orchestratorScript = ORCHESTRATOR_TEMPLATE
    .replace(/{{WORKSPACE_ROOT}}/g, WORKSPACE_ROOT)
    .replace(/{{CMUX_RUNTIME_DIR}}/g, CMUX_RUNTIME_DIR)
    .replace(/{{MAINTENANCE_SCRIPT_PATH}}/g, ids.maintenance.scriptPath)
    .replace(/{{DEV_SCRIPT_PATH}}/g, ids.dev.scriptPath)
    .replace(/{{MAINTENANCE_WINDOW_NAME}}/g, ids.maintenance.windowName)
    .replace(/{{DEV_WINDOW_NAME}}/g, ids.dev.windowName)
    .replace(/{{MAINTENANCE_EXIT_CODE_PATH}}/g, maintenanceExitCodePath)
    .replace(/{{HAS_MAINTENANCE_SCRIPT}}/g, String(maintenanceScriptContent !== null))
    .replace(/{{HAS_DEV_SCRIPT}}/g, String(devScriptContent !== null));

  // Create the command that sets up all scripts and starts the orchestrator in background
  const setupAndRunCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

# Write maintenance script if provided
${maintenanceScriptContent ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}
rm -f ${maintenanceExitCodePath}` : ''}

# Write dev script if provided
${devScriptContent ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}` : ''}

# Write orchestrator script
cat > ${orchestratorScriptPath} <<'ORCHESTRATOR_EOF'
${orchestratorScript}
ORCHESTRATOR_EOF
chmod +x ${orchestratorScriptPath}

# Start orchestrator as a background process (fire-and-forget)
# Redirect output to log file
nohup bun ${orchestratorScriptPath} > ${CMUX_RUNTIME_DIR}/orchestrator_${runId}.log 2>&1 &
ORCHESTRATOR_PID=$!

# Give it a moment to start
sleep 1

# Verify the process is still running
if kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
  echo "[ORCHESTRATOR] Started successfully in background (PID: $ORCHESTRATOR_PID)"
else
  echo "[ORCHESTRATOR] ERROR: Process failed to start or exited immediately" >&2
  exit 1
fi
`;

  try {
    const result = await instance.exec(
      `zsh -lc ${singleQuote(setupAndRunCommand)}`,
    );

    // Check if orchestrator started successfully
    const stdout = result.stdout?.trim() || "";
    const stderr = result.stderr?.trim() || "";

    if (result.exit_code !== 0) {
      devError = `Failed to start orchestrator: exit code ${result.exit_code}`;
      if (stderr) {
        devError += ` | stderr: ${stderr}`;
      }
    } else if (!stdout.includes("[ORCHESTRATOR] Started successfully in background (PID:")) {
      devError = "Orchestrator did not confirm successful start";
    } else {
      console.log(`[runMaintenanceAndDevScripts] Orchestrator started successfully`);
    }
  } catch (error) {
    devError = `Failed to start orchestrator: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    maintenanceError,
    devError,
  };
}
