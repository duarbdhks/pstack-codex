import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/sync-upstream.yml"), "utf8"));
const clone = workflow.jobs.mirror.steps.find(({ id }) => id === "clone");
const land = workflow.jobs.land.steps.find(({ name }) => name === "Land and track");

function runStep(step, { commands, files = {}, env = {} }) {
  const temp = mkdtempSync(join(tmpdir(), "sync-workflow-"));
  try {
    const bin = join(temp, "bin");
    mkdirSync(bin);
    for (const [command, source] of Object.entries(commands)) {
      writeFileSync(join(bin, command), `#!/usr/bin/env bash\n${source}`, { mode: 0o755 });
    }
    for (const [path, content] of Object.entries(files)) {
      const file = join(temp, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", step.run], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
        RUNNER_TEMP: temp,
        GITHUB_OUTPUT: join(temp, "outputs"),
        ...env,
      },
    });
    expect(result.error).toBeUndefined();
    const read = (path) => {
      const file = join(temp, path);
      return existsSync(file) ? readFileSync(file, "utf8").trimEnd() : "";
    };
    return { ...result, calls: read("calls").split("\n"), state: read("state/state"), outputs: read("outputs") };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const get429 = "fatal: unable to access 'https://github.com/cursor/plugins/': The requested URL returned error: 429";
const rpc429 = "error: RPC failed; HTTP 429 curl 22 The requested URL returned error: 429";
const notFound = "fatal: repository 'https://github.com/cursor/plugins/' not found";

test.each([
  ["success uses one clone", [""], ["git clone"], 0],
  ["both HTTP 429 forms recover", [get429, rpc429, ""], ["git clone", "sleep 60", "git clone", "sleep 120", "git clone"], 0],
  ["persistent 429 stops at three attempts", [get429, get429, get429], ["git clone", "sleep 60", "git clone", "sleep 120", "git clone"], 128],
  ["non-429 fails immediately", [notFound], ["git clone"], 128],
  ["non-429 stops a retry", [rpc429, notFound], ["git clone", "sleep 60", "git clone"], 128],
])("upstream clone: %s", (_name, errors, calls, status) => {
  const result = runStep(clone, {
    files: { errors: `${errors.join("\n")}\n` },
    commands: {
      git: `
printf 'git %s\n' "$1" >> "$RUNNER_TEMP/calls"
attempt="$(grep -c '^git clone$' "$RUNNER_TEMP/calls")"
error="$(sed -n "\${attempt}p" "$RUNNER_TEMP/errors")"
if [ -n "$error" ]; then
  printf '%s\n' "$error" >&2
  exit 128
fi
`,
      sleep: `printf 'sleep %s\n' "$1" >> "$RUNNER_TEMP/calls"\n`,
    },
  });
  expect(result.status).toBe(status);
  expect(result.calls).toEqual(calls);
  expect(result.state).toBe(status === 0 ? "incomplete" : "clone_failed");
  expect(result.outputs).toBe("state_available=true");
  for (const error of errors.filter(Boolean)) expect(result.stderr).toContain(error);
});

const current = { "state/state": "current\n", "state/upstream_sha": `${"a".repeat(40)}\n` };

test.each([
  ["records a clone failure without a SHA", "failure", "success", { "state/state": "clone_failed\n" }, "edit", "Upstream clone failed before verification"],
  ["records a missing artifact", "failure", "failure", {}, "edit", "no usable state"],
  ["rejects files left by an unsuccessful download", "success", "failure", current, "edit", "no usable state"],
  ["rejects a current state from a failed mirror", "failure", "success", current, "edit", "result 'failure'"],
  ["records a mirror script failure separately", "success", "success", { ...current, "state/state": "failed\n" }, "edit", "bun tools/sync.mjs failed"],
  ["closes the tracking issue when upstream is current", "success", "success", current, "close", "is current"],
])("land step %s", (_name, mirrorResult, downloadResult, files, action, message) => {
  const result = runStep(land, {
    files,
    env: {
      DEFAULT_BRANCH: "main",
      DOWNLOAD_RESULT: downloadResult,
      GITHUB_REPOSITORY: "example/pstack-codex",
      GITHUB_RUN_ID: "1",
      GITHUB_SERVER_URL: "https://github.com",
      MIRROR_RESULT: mirrorResult,
    },
    commands: {
      git: `printf 'git %s\n' "$1" >> "$RUNNER_TEMP/calls"\n`,
      gh: `
printf 'gh %s %s\n' "$1" "$2" >> "$RUNNER_TEMP/calls"
case "$1 $2" in
  "issue list") printf '%s\n' '[{"number":23,"title":"Upstream sync needs attention"}]' ;;
  "issue edit") cat "$5" ;;
  "issue close") ;;
  *) exit 1 ;;
esac
`,
    },
  });
  expect(result.status).toBe(0);
  expect(result.calls).toEqual(["git config", "git config", "gh issue list", `gh issue ${action}`]);
  expect(result.stdout).toContain(message);
});
