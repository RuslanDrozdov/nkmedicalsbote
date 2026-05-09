/**
 * Builds mini-app for production. With npm workspaces, one `npm ci` in the repo
 * root installs mini-app deps (including vite); this script runs root `npm ci`
 * when needed (e.g. CI) then `npm run build --workspace mini-app`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const miniApp = path.join(root, "mini-app");

function readRootPkg() {
	return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}

function hasWorkspaces() {
	const w = readRootPkg().workspaces;
	return Array.isArray(w) && w.includes("mini-app");
}

function hasVite() {
	const rootVite = path.join(root, "node_modules", "vite", "package.json");
	const miniVite = path.join(miniApp, "node_modules", "vite", "package.json");
	return existsSync(rootVite) || existsSync(miniVite);
}

function run(cmd, cwd, envOverrides = {}) {
	const env = { ...process.env, ...envOverrides };
	const r = spawnSync(cmd, { shell: true, cwd, stdio: "inherit", env });
	if (r.status !== 0) {
		process.exit(r.status ?? 1);
	}
}

const installEnv = {
	NODE_ENV: "development",
	NPM_CONFIG_PRODUCTION: "false",
};

if (!hasWorkspaces()) {
	// Fallback: старый layout без workspaces — только mini-app
	const workersCi = process.env.WORKERS_CI === "1";
	const ci = process.env.CI === "true" || process.env.CI === "1";
	const vitePkg = path.join(miniApp, "node_modules", "vite", "package.json");
	if (workersCi || ci || !existsSync(vitePkg)) {
		run("npm ci --include=dev", miniApp, installEnv);
	}
	run("npm run build", miniApp, { NODE_ENV: "production" });
	process.exit(0);
}

if (!hasVite()) {
	run("npm ci", root, installEnv);
}

run("npm run build --workspace mini-app", root, { NODE_ENV: "production" });
