/**
 * Ensures mini-app has dependencies and runs Vite production build.
 * Used by Wrangler [build] and npm "build" so Workers Builds / CI work even
 * when root postinstall was skipped (e.g. npm ci --ignore-scripts).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const miniApp = path.join(root, "mini-app");
const vitePkg = path.join(miniApp, "node_modules", "vite", "package.json");

/** npm omits devDependencies when NODE_ENV=production; mini-app needs vite (devDep). */
function run(cmd, cwd, envOverrides = {}) {
	const env = { ...process.env, ...envOverrides };
	const r = spawnSync(cmd, { shell: true, cwd, stdio: "inherit", env });
	if (r.status !== 0) {
		process.exit(r.status ?? 1);
	}
}

const workersCi = process.env.WORKERS_CI === "1";
const ci = process.env.CI === "true" || process.env.CI === "1";

const installEnv = {
	NODE_ENV: "development",
	NPM_CONFIG_PRODUCTION: "false",
};

if (workersCi || ci || !existsSync(vitePkg)) {
	// --include=dev: явно тянем devDependencies (vite), даже если в окружении omit=dev
	run("npm ci --include=dev", miniApp, installEnv);
}

run("npm run build", miniApp, { NODE_ENV: "production" });
