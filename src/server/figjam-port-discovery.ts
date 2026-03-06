/**
 * FigJam Port Discovery Module
 *
 * Dedicated port advertisement for the FigJam MCP twin server.
 * Uses a different range from the original Figma MCP server to avoid collisions.
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createChildLogger } from "../core/logger.js";

const logger = createChildLogger({ component: "figjam-port-discovery" });

export const DEFAULT_FIGJAM_WS_PORT = 9323;
export const FIGJAM_PORT_RANGE_SIZE = 10;

const PORT_FILE_PREFIX = "figjam-console-mcp-";
const PORT_FILE_DIR = tmpdir();

export interface FigJamPortFileData {
	port: number;
	pid: number;
	host: string;
	startedAt: string;
}

export function getFigJamPortRange(preferredPort: number = DEFAULT_FIGJAM_WS_PORT): number[] {
	const ports: number[] = [];
	for (let i = 0; i < FIGJAM_PORT_RANGE_SIZE; i++) {
		ports.push(preferredPort + i);
	}
	return ports;
}

function getPortFilePath(port: number): string {
	return join(PORT_FILE_DIR, `${PORT_FILE_PREFIX}${port}.json`);
}

export function advertiseFigJamPort(port: number, host: string = "localhost"): void {
	const data: FigJamPortFileData = {
		port,
		pid: process.pid,
		host,
		startedAt: new Date().toISOString(),
	};

	const filePath = getPortFilePath(port);
	try {
		writeFileSync(filePath, JSON.stringify(data, null, 2));
		logger.info({ port, filePath }, "FigJam port advertised");
	} catch (error) {
		logger.warn({ port, filePath, error }, "Failed to advertise FigJam port");
	}
}

export function unadvertiseFigJamPort(port: number): void {
	const filePath = getPortFilePath(port);
	try {
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	} catch {
		// best effort
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function cleanupStaleFigJamPortFiles(): number {
	let cleaned = 0;

	try {
		const files = readdirSync(PORT_FILE_DIR);
		for (const file of files) {
			if (!file.startsWith(PORT_FILE_PREFIX) || !file.endsWith(".json")) {
				continue;
			}
			const filePath = join(PORT_FILE_DIR, file);
			try {
				const raw = readFileSync(filePath, "utf-8");
				const data = JSON.parse(raw) as FigJamPortFileData;
				if (!isProcessAlive(data.pid)) {
					unlinkSync(filePath);
					cleaned++;
				}
			} catch {
				try {
					unlinkSync(filePath);
					cleaned++;
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}

	return cleaned;
}

export function discoverActiveFigJamInstances(
	preferredPort: number = DEFAULT_FIGJAM_WS_PORT,
): FigJamPortFileData[] {
	const result: FigJamPortFileData[] = [];

	for (const port of getFigJamPortRange(preferredPort)) {
		const filePath = getPortFilePath(port);
		if (!existsSync(filePath)) {
			continue;
		}
		try {
			const raw = readFileSync(filePath, "utf-8");
			const data = JSON.parse(raw) as FigJamPortFileData;
			if (isProcessAlive(data.pid)) {
				result.push(data);
			}
		} catch {
			// ignore bad entries
		}
	}

	return result;
}

export function registerFigJamPortCleanup(port: number): void {
	const cleanup = () => unadvertiseFigJamPort(port);
	process.on("exit", cleanup);
	process.prependListener("SIGINT", cleanup);
	process.prependListener("SIGTERM", cleanup);
}
