import type { CapabilityContext, CapabilityKey } from "./capability-context.js";

export interface ToolCapabilityPolicyEntry {
	required: CapabilityKey[];
	rationale: string;
	hint?: string;
}

const DESIGN_SYSTEM_TOOLS: ToolCapabilityPolicyEntry = {
	required: ["designSystem"],
	rationale: "This tool depends on Design System APIs and metadata unavailable in FigJam.",
	hint: "Use FigJam board tools for board structure/content operations.",
};

const COMPONENT_TOOLS: ToolCapabilityPolicyEntry = {
	required: ["components"],
	rationale: "This tool depends on component APIs unavailable in FigJam.",
	hint: "Use FigJam primitives (sticky, shape, connector, text, section) instead.",
};

const VARIABLE_TOOLS: ToolCapabilityPolicyEntry = {
	required: ["variables"],
	rationale: "This tool depends on Variables API unavailable in FigJam.",
	hint: "Variables and token operations are supported in Figma Design files only.",
};

const DESIGN_CODE_TOOLS: ToolCapabilityPolicyEntry = {
	required: ["designCode"],
	rationale: "This tool is design-to-code/component parity specific and not meaningful in FigJam.",
	hint: "Run this tool in a Figma Design file, or use FigJam-specific workflow tools.",
};

const TOOL_POLICY: Record<string, ToolCapabilityPolicyEntry> = {
	figma_get_component: COMPONENT_TOOLS,
	figma_get_component_details: COMPONENT_TOOLS,
	figma_search_components: COMPONENT_TOOLS,
	figma_instantiate_component: COMPONENT_TOOLS,
	figma_get_component_for_development: COMPONENT_TOOLS,
	figma_get_component_image: COMPONENT_TOOLS,
	figma_set_instance_properties: COMPONENT_TOOLS,
	figma_add_component_property: COMPONENT_TOOLS,
	figma_edit_component_property: COMPONENT_TOOLS,
	figma_delete_component_property: COMPONENT_TOOLS,
	figma_arrange_component_set: COMPONENT_TOOLS,

	figma_get_variables: VARIABLE_TOOLS,
	figma_create_variable: VARIABLE_TOOLS,
	figma_update_variable: VARIABLE_TOOLS,
	figma_delete_variable: VARIABLE_TOOLS,
	figma_rename_variable: VARIABLE_TOOLS,
	figma_batch_create_variables: VARIABLE_TOOLS,
	figma_batch_update_variables: VARIABLE_TOOLS,
	figma_create_variable_collection: VARIABLE_TOOLS,
	figma_delete_variable_collection: VARIABLE_TOOLS,
	figma_add_mode: VARIABLE_TOOLS,
	figma_rename_mode: VARIABLE_TOOLS,
	figma_setup_design_tokens: VARIABLE_TOOLS,
	figma_get_token_values: VARIABLE_TOOLS,

	figma_get_design_system_summary: DESIGN_SYSTEM_TOOLS,
	figma_get_design_system_kit: DESIGN_SYSTEM_TOOLS,
	figma_browse_tokens: DESIGN_SYSTEM_TOOLS,
	token_browser_refresh: DESIGN_SYSTEM_TOOLS,
	figma_audit_design_system: DESIGN_SYSTEM_TOOLS,
	ds_dashboard_refresh: DESIGN_SYSTEM_TOOLS,

	figma_check_design_parity: DESIGN_CODE_TOOLS,
	figma_generate_component_doc: DESIGN_CODE_TOOLS,
};

export function getToolCapabilityPolicy(toolName: string): ToolCapabilityPolicyEntry | null {
	return TOOL_POLICY[toolName] || null;
}

export function isToolSupportedInContext(toolName: string, context: CapabilityContext): boolean {
	if (context.editorType !== "figjam") {
		return true;
	}

	const policy = getToolCapabilityPolicy(toolName);
	if (!policy) {
		return true;
	}

	return policy.required.every((key) => context.capabilities[key]);
}
