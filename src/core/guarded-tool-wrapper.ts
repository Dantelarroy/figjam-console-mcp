import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	resolveCapabilityContext,
	type CapabilityContextDependencies,
} from "./capability-context.js";
import {
	getToolCapabilityPolicy,
	isToolSupportedInContext,
} from "./tool-capability-policy.js";

const GUARD_INSTALLED_SYMBOL = Symbol.for("figma-console.guard.installed");

interface CapabilityErrorPayload {
	error: {
		code: "CAPABILITY_NOT_SUPPORTED";
		tool: string;
		editorType: string;
		required: string[];
		message: string;
		retryable: false;
		hint?: string;
	};
}

function buildCapabilityError(toolName: string, editorType: string): CapabilityErrorPayload {
	const policy = getToolCapabilityPolicy(toolName);
	const required = policy?.required || [];

	return {
		error: {
			code: "CAPABILITY_NOT_SUPPORTED",
			tool: toolName,
			editorType,
			required,
			message:
				policy?.rationale ||
				"This tool is not supported for the current editor type.",
			retryable: false,
			hint: policy?.hint,
		},
	};
}

function wrapHandler(
	toolName: string,
	handler: (...args: any[]) => any,
	deps: CapabilityContextDependencies,
): (...args: any[]) => Promise<any> {
	return async function wrappedHandler(this: any, ...args: any[]) {
		const context = await resolveCapabilityContext(deps);
		const supported = isToolSupportedInContext(toolName, context);

		if (!supported) {
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(buildCapabilityError(toolName, context.editorType)),
					},
				],
				isError: true,
			};
		}

		return await Reflect.apply(handler, this, args);
	};
}

export function installGuardedToolWrapper(
	server: McpServer,
	deps: CapabilityContextDependencies,
): void {
	const target = server as any;
	if (target[GUARD_INSTALLED_SYMBOL]) {
		return;
	}

	const originalTool = target.tool.bind(server);
	const originalRegisterTool = target.registerTool.bind(server);

	target.tool = function patchedTool(name: string, ...rest: any[]) {
		const maybeHandler = rest[rest.length - 1];
		if (typeof maybeHandler === "function") {
			rest[rest.length - 1] = wrapHandler(name, maybeHandler, deps);
		}
		return originalTool(name, ...rest);
	};

	target.registerTool = function patchedRegisterTool(
		name: string,
		config: any,
		cb: (...args: any[]) => any,
	) {
		const wrapped = typeof cb === "function" ? wrapHandler(name, cb, deps) : cb;
		return originalRegisterTool(name, config, wrapped);
	};

	target[GUARD_INSTALLED_SYMBOL] = true;
}
