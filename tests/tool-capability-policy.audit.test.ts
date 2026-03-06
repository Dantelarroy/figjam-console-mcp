import * as fs from "node:fs";
import * as path from "node:path";
import { getToolCapabilityPolicy } from "../src/core/tool-capability-policy";

const UPSTREAM_TOOL_SOURCES = [
	"src/local.ts",
	"src/core/figma-tools.ts",
	"src/core/design-code-tools.ts",
	"src/core/comment-tools.ts",
	"src/core/design-system-tools.ts",
	"src/index.ts",
];

const BLOCKED_CLASS_PATTERNS: RegExp[] = [
	/^figma_get_variables$/,
	/^figma_(create|update|delete|rename)_variable$/,
	/^figma_batch_(create|update)_variables$/,
	/^figma_(create|delete)_variable_collection$/,
	/^figma_(add|rename)_mode$/,
	/^figma_setup_design_tokens$/,
	/^figma_get_token_values$/,

	/^figma_get_component$/,
	/^figma_get_component_details$/,
	/^figma_search_components$/,
	/^figma_instantiate_component$/,
	/^figma_get_component_for_development$/,
	/^figma_get_component_image$/,
	/^figma_set_instance_properties$/,
	/^figma_(add|edit|delete)_component_property$/,
	/^figma_arrange_component_set$/,

	/^figma_get_design_system_summary$/,
	/^figma_get_design_system_kit$/,
	/^figma_browse_tokens$/,
	/^token_browser_refresh$/,
	/^figma_audit_design_system$/,
	/^ds_dashboard_refresh$/,

	/^figma_check_design_parity$/,
	/^figma_generate_component_doc$/,
];

function extractToolNames(source: string): string[] {
	const names = new Set<string>();

	// server.tool("name", ...)
	for (const m of source.matchAll(/\b(?:this\.)?server\.tool\(\s*"([^"]+)"/g)) {
		names.add(m[1]);
	}

	// server.registerTool("name", ...)
	for (const m of source.matchAll(/\b(?:this\.)?server\.registerTool\(\s*"([^"]+)"/g)) {
		names.add(m[1]);
	}

	// registerAppTool(server, "name", ...)
	for (const m of source.matchAll(/\bregisterAppTool\(\s*[^,]+,\s*"([^"]+)"/g)) {
		names.add(m[1]);
	}

	return [...names];
}

describe("Tool capability policy audit", () => {
	it("fails if upstream adds blocked-class tools without policy mapping", () => {
		const repoRoot = path.resolve(__dirname, "..");
		const allToolNames = new Set<string>();

		for (const rel of UPSTREAM_TOOL_SOURCES) {
			const abs = path.join(repoRoot, rel);
			const src = fs.readFileSync(abs, "utf8");
			for (const name of extractToolNames(src)) {
				allToolNames.add(name);
			}
		}

		const candidates = [...allToolNames]
			.filter((name) => BLOCKED_CLASS_PATTERNS.some((p) => p.test(name)))
			.sort();

		expect(candidates.length).toBeGreaterThan(0);

		const missing = candidates.filter((name) => getToolCapabilityPolicy(name) === null);
		expect(missing).toEqual([]);
	});
});
