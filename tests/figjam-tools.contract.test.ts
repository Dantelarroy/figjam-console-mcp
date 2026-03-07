import { registerFigJamTools } from "../src/server/register-figjam-tools";
import { z } from "zod";

interface RegisteredTool {
	name: string;
	description: string;
	schema: any;
	handler: (args: any) => Promise<any>;
}

function createMockServer() {
	const tools: Record<string, RegisteredTool> = {};
	return {
		tool: jest.fn((name: string, description: string, schema: any, handler: any) => {
			tools[name] = { name, description, schema, handler };
		}),
		_getTool(name: string): RegisteredTool {
			return tools[name];
		},
	};
}

function createMockClient() {
	return {
		createSticky: jest.fn().mockResolvedValue({ id: "sticky-1", type: "STICKY", text: "Idea" }),
		updateSticky: jest.fn().mockResolvedValue({ id: "sticky-1", type: "STICKY", text: "Updated" }),
		deleteSticky: jest.fn().mockResolvedValue({ deleted: true, nodeId: "sticky-1" }),
		createShape: jest.fn().mockResolvedValue({ id: "shape-1", type: "SHAPE_WITH_TEXT" }),
		createLink: jest.fn().mockResolvedValue({ id: "link-1", type: "LINK_UNFURL", text: "https://example.com" }),
		createConnector: jest.fn().mockResolvedValue({ id: "conn-1", type: "CONNECTOR" }),
		createText: jest.fn().mockResolvedValue({ id: "text-1", type: "TEXT", text: "Hello" }),
		createSection: jest.fn().mockResolvedValue({ id: "section-1", type: "SECTION" }),
		insertImage: jest.fn().mockResolvedValue({ id: "img-1", type: "RECTANGLE", x: 10, y: 20, width: 200, height: 120 }),
		getBoardNodes: jest.fn().mockResolvedValue([{ id: "n1", type: "STICKY" }]),
		getStickies: jest.fn().mockResolvedValue([{ id: "s1", type: "STICKY", text: "A" }]),
		getConnections: jest.fn().mockResolvedValue([{ id: "c1", type: "CONNECTOR" }]),
		moveNode: jest.fn().mockResolvedValue({ id: "n1", type: "STICKY", x: 0, y: 0 }),
		updateNode: jest.fn().mockResolvedValue({ id: "n1", type: "STICKY", name: "Updated node" }),
		deleteNode: jest.fn().mockResolvedValue({ deleted: true, nodeId: "n1" }),
		getRuntimeCapabilities: jest.fn().mockResolvedValue({
			supportsSections: true,
			supportsRichUnfurl: true,
			supportsImageInsert: true,
		}),
		scanBoardState: jest.fn().mockResolvedValue({
			fileKey: "file-key-1",
			pageId: "0:1",
			pageName: "Page 1",
			generatedAt: "2026-03-07T00:00:00.000Z",
			nodes: [
				{
					id: "s1",
					name: "Sticky 1",
					type: "STICKY",
					x: 10,
					y: 20,
					width: 240,
					height: 240,
					text: "Idea 1",
					parentId: "0:1",
					pluginData: {
						"figjam.alias": "idea-1",
						"figjam.groupId": "group-a",
						"figjam.updatedAt": "2026-03-07T00:00:00.000Z",
					},
				},
				{
					id: "c1",
					name: "Cluster A",
					type: "SECTION",
					x: 0,
					y: 0,
					width: 600,
					height: 400,
					parentId: "0:1",
					pluginData: {},
				},
			],
		}),
	};
}

describe("FigJam tools contract", () => {
	let server: ReturnType<typeof createMockServer>;
	let client: ReturnType<typeof createMockClient>;

	beforeEach(() => {
		server = createMockServer();
		client = createMockClient();
		registerFigJamTools(server as any, async () => client as any);
	});

	function validate(toolName: string, payload: unknown) {
		const tool = server._getTool(toolName);
		return z.object(tool.schema).safeParse(payload);
	}

	it("registers the FigJam tools", () => {
		expect(server.tool).toHaveBeenCalledTimes(48);
		const names = server.tool.mock.calls.map((c: any[]) => c[0]);
		expect(names).toEqual(
			expect.arrayContaining([
				"createSticky",
				"updateSticky",
				"deleteSticky",
				"createShape",
				"createLink",
				"createConnector",
				"createText",
				"createSection",
				"getBoardNodes",
				"getStickies",
				"getConnections",
				"captureWebImage",
				"insertLocalImage",
				"createImageReference",
				"bulkCreateStickies",
				"findNodes",
				"createCluster",
				"summarizeBoard",
				"autoLayoutBoard",
				"ingestResearchNotes",
				"createReferenceWall",
				"organizeByTheme",
				"linkByRelation",
				"generateResearchBoard",
				"figjam_get_job_status",
				"figjam_cancel_job",
				"figjam_resume_job",
				"figjam_index_board",
				"getBoardIndex",
				"figjam_upsert_artifact",
				"figjam_organize_by_alias",
				"figjam_validate_board_index",
				"figjam_render_reference_card",
				"figjam_render_reference_set",
				"figjam_read_board_state",
				"figjam_get_artifact_collection",
				"figjam_relocate_artifacts",
				"figjam_delete_artifacts",
				"figjam_delete_by_bbox",
				"figjam_archive_by_bbox",
				"figjam_delete_by_run",
				"figjam_bulk_upsert_artifacts",
				"figjam_get_board_graph",
				"figjam_move_collection",
				"figjam_archive_collection",
				"figjam_apply_layout_to_collection",
				"figjam_export_board_snapshot",
				"figjam_import_reference_bundle",
			]),
		);
	});

	it("validates figjam_index_board schema and returns deterministic index", async () => {
		const tool = server._getTool("figjam_index_board");
		expect(validate("figjam_index_board", {}).success).toBe(true);
		expect(validate("figjam_index_board", { includeEntities: false }).success).toBe(true);
		expect(validate("figjam_index_board", { includeEntities: "nope" }).success).toBe(false);

		const result = await tool.handler({ includeEntities: true });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.index.fileKey).toBe("file-key-1");
		expect(data.index.counts.entities).toBe(2);
		expect(data.index.aliases["idea-1"]).toBe("s1");
	});

	it("validates getBoardIndex cache/refresh behavior", async () => {
		const indexTool = server._getTool("figjam_index_board");
		const getTool = server._getTool("getBoardIndex");
		expect(validate("getBoardIndex", {}).success).toBe(true);
		expect(validate("getBoardIndex", { refresh: true }).success).toBe(true);
		expect(validate("getBoardIndex", { refresh: "yes" }).success).toBe(false);

		await indexTool.handler({ includeEntities: true });
		client.scanBoardState.mockClear();

		const cached = await getTool.handler({ refresh: false, includeEntities: true });
		expect(cached.isError).toBeUndefined();
		const cachedData = JSON.parse(cached.content[0].text);
		expect(cachedData.index.source).toBe("cache");

		const refreshed = await getTool.handler({ refresh: true, includeEntities: false });
		expect(refreshed.isError).toBeUndefined();
		const refreshedData = JSON.parse(refreshed.content[0].text);
		expect(refreshedData.index.source).toBe("fresh");
		expect(refreshedData.index.entities).toEqual([]);
	});

	it("validates figjam_upsert_artifact schema and target/create precedence", async () => {
		const tool = server._getTool("figjam_upsert_artifact");
		expect(validate("figjam_upsert_artifact", { create: { kind: "sticky", text: "A" } }).success).toBe(
			true,
		);
		expect(validate("figjam_upsert_artifact", { patch: { text: "only patch" } }).success).toBe(true);

		const invalid = await tool.handler({ patch: { text: "only patch" } });
		expect(invalid.isError).toBe(true);
		expect(JSON.parse(invalid.content[0].text).error.code).toBe("INVALID_REQUEST");

		const created = await tool.handler({
			create: { kind: "sticky", text: "New item", x: 1, y: 2 },
			alias: "new-item",
		});
		expect(created.isError).toBeUndefined();
		const createdData = JSON.parse(created.content[0].text);
		expect(createdData.upsert.resolution).toBe("create");
		expect(createdData.upsert.alias).toBe("new-item");

		const updated = await tool.handler({
			target: { alias: "idea-1" },
			patch: { text: "Updated by alias" },
			groupId: "group-b",
		});
		expect(updated.isError).toBeUndefined();
		const updatedData = JSON.parse(updated.content[0].text);
		expect(updatedData.upsert.resolution).toBe("target");
		expect(client.updateNode).toHaveBeenCalled();
	});

	it("validates figjam_organize_by_alias schema and deterministic move behavior", async () => {
		const tool = server._getTool("figjam_organize_by_alias");
		expect(validate("figjam_organize_by_alias", { aliases: ["idea-1"] }).success).toBe(true);
		expect(validate("figjam_organize_by_alias", { aliases: [] }).success).toBe(false);

		const result = await tool.handler({
			aliases: ["idea-1"],
			layout: { mode: "grid", originX: 100, originY: 200, columns: 2, gapX: 300, gapY: 150 },
			targetGroupId: "group-b",
		});

		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.organization.movedCount).toBe(1);
		expect(data.organization.failedCount).toBe(0);
		expect(data.organization.moved[0].alias).toBe("idea-1");
		expect(client.moveNode).toHaveBeenCalledWith({ nodeId: "s1", x: 100, y: 200 });
		expect(client.updateNode).toHaveBeenCalledWith({
			nodeId: "s1",
			containerId: undefined,
			groupId: "group-b",
		});
	});

	it("validates figjam_validate_board_index schema and reports deterministic issues", async () => {
		const tool = server._getTool("figjam_validate_board_index");
		expect(
			validate("figjam_validate_board_index", {
				requiredAliases: ["idea-1"],
				requireUniqueAliases: true,
			}).success,
		).toBe(true);
		expect(validate("figjam_validate_board_index", { maxVisualTargets: 0 }).success).toBe(false);

		const result = await tool.handler({
			requiredAliases: ["idea-1", "missing-alias"],
			requireUniqueAliases: true,
			requireResolvedConnectorEndpoints: true,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.validation.passed).toBe(false);
		expect(data.validation.errorCount).toBeGreaterThanOrEqual(1);
		const codes = data.validation.issues.map((i: any) => i.code);
		expect(codes).toContain("REQUIRED_ALIAS_MISSING");
		expect(Array.isArray(data.validation.visualTargets)).toBe(true);
	});

	it("validates figjam_render_reference_card schema and deterministic render output", async () => {
		const tool = server._getTool("figjam_render_reference_card");
		expect(validate("figjam_render_reference_card", { title: "OpenAI", url: "https://openai.com" }).success).toBe(
			true,
		);
		expect(validate("figjam_render_reference_card", { title: "" }).success).toBe(false);

		const result = await tool.handler({
			title: "OpenAI",
			url: "https://openai.com",
			note: "Research reference",
			x: 100,
			y: 200,
			alias: "ref-openai",
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.reference.alias).toBe("ref-openai");
		expect(data.reference.primaryNodeId).toBe("link-1");
		expect(data.reference.noteNodeId).toBe("sticky-1");
	});

	it("validates figjam_render_reference_set schema and partial failure behavior", async () => {
		const tool = server._getTool("figjam_render_reference_set");
			expect(
				validate("figjam_render_reference_set", {
					items: [{ title: "A", url: "https://example.com" }],
					uiPreset: "dense",
				}).success,
			).toBe(true);
		expect(validate("figjam_render_reference_set", { items: [] }).success).toBe(false);

		client.createLink.mockRejectedValueOnce(new Error("Link preview unavailable"));
		const result = await tool.handler({
			items: [
				{ title: "A", url: "https://example.com" },
				{ title: "B", url: "https://example.org" },
			],
				layout: { mode: "grid", originX: 0, originY: 0, columns: 2, gapX: 300, gapY: 250 },
				uiPreset: "dense",
				linkPolicy: "native_only",
				continueOnError: true,
			});
		expect(result.isError).toBeUndefined();
			const data = JSON.parse(result.content[0].text);
			expect(data.batch.total).toBe(2);
			expect(data.batch.uiPreset).toBe("dense");
			expect(data.batch.failedCount).toBe(1);
		});

	it("reflows column layout using measured card heights", async () => {
		const tool = server._getTool("figjam_render_reference_set");
		const createdLinks = [
			{ id: "link-a", type: "LINK_UNFURL", width: 300, height: 100, text: "https://a.example" },
			{ id: "link-b", type: "LINK_UNFURL", width: 300, height: 300, text: "https://b.example" },
		];
		client.createLink.mockImplementation(async () => createdLinks.shift());

		const result = await tool.handler({
			items: [
				{ title: "A", url: "https://a.example" },
				{ title: "B", url: "https://b.example" },
			],
			layout: { mode: "column", originX: 0, originY: 0, columns: 1, gapX: 300, gapY: 20 },
			uiPreset: "dense",
			linkPolicy: "native_only",
			layoutPolicy: "auto_expand",
			continueOnError: true,
		});

		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.batch.measuredCardHeights).toEqual([100, 300]);
		expect(client.moveNode).toHaveBeenCalledWith({ nodeId: "link-b", x: 0, y: 124 });
	});

	it("validates figjam_read_board_state schema and output envelope", async () => {
		const tool = server._getTool("figjam_read_board_state");
		expect(validate("figjam_read_board_state", {}).success).toBe(true);
		expect(validate("figjam_read_board_state", { limit: 0 }).success).toBe(false);

		const result = await tool.handler({
			groupBy: "type",
			includeRawPluginData: true,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.state.fileKey).toBe("file-key-1");
		expect(Array.isArray(data.state.entities)).toBe(true);
		expect(typeof data.state.groupedCounts).toBe("object");
	});

	it("validates figjam_get_artifact_collection schema and selectors", async () => {
		const tool = server._getTool("figjam_get_artifact_collection");
		expect(validate("figjam_get_artifact_collection", { selectors: { aliases: ["idea-1"] } }).success).toBe(
			true,
		);
		expect(validate("figjam_get_artifact_collection", { limit: 0 }).success).toBe(false);

		const result = await tool.handler({
			selectors: { aliases: ["idea-1"] },
			sort: "name",
			limit: 100,
			offset: 0,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.collection.total).toBe(1);
		expect(data.collection.items[0].alias).toBe("idea-1");
	});

	it("validates figjam_relocate_artifacts schema and move behavior", async () => {
		const tool = server._getTool("figjam_relocate_artifacts");
		expect(
			validate("figjam_relocate_artifacts", {
				selectors: { aliases: ["idea-1"] },
				layout: { mode: "offset", dx: 10, dy: 20 },
			}).success,
		).toBe(true);
		expect(validate("figjam_relocate_artifacts", { selectors: {}, layout: { columns: 0 } }).success).toBe(
			false,
		);

		const result = await tool.handler({
			selectors: { aliases: ["idea-1"] },
			layout: { mode: "offset", dx: 100, dy: 50 },
			targetGroupId: "group-c",
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.relocation.movedCount).toBe(1);
		expect(client.moveNode).toHaveBeenCalled();
		expect(client.updateNode).toHaveBeenCalledWith({
			nodeId: "s1",
			groupId: "group-c",
			containerId: undefined,
		});
	});

	it("validates figjam_delete_artifacts schema and deterministic deletion output", async () => {
		const tool = server._getTool("figjam_delete_artifacts");
		expect(validate("figjam_delete_artifacts", { selectors: { aliases: ["idea-1"] } }).success).toBe(true);
		expect(validate("figjam_delete_artifacts", { selectors: { aliases: [] } }).success).toBe(true);

		const result = await tool.handler({ selectors: { aliases: ["idea-1"] }, dryRun: false });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.deletion.deletedCount).toBe(1);
		expect(client.deleteNode).toHaveBeenCalledWith("s1");
	});

	it("validates figjam_bulk_upsert_artifacts schema and batch response", async () => {
		const tool = server._getTool("figjam_bulk_upsert_artifacts");
		expect(
			validate("figjam_bulk_upsert_artifacts", {
				items: [{ create: { kind: "sticky", text: "A" }, alias: "a-1" }],
			}).success,
		).toBe(true);
		expect(validate("figjam_bulk_upsert_artifacts", { items: [] }).success).toBe(false);

		const result = await tool.handler({
			items: [{ create: { kind: "sticky", text: "A" }, alias: "a-1" }],
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.upsertBatch.total).toBe(1);
		expect(data.upsertBatch.createdCount).toBe(1);
	});

	it("validates figjam_get_board_graph schema and graph envelope", async () => {
		const tool = server._getTool("figjam_get_board_graph");
		expect(validate("figjam_get_board_graph", {}).success).toBe(true);
		expect(validate("figjam_get_board_graph", { limit: 0 }).success).toBe(false);

		const result = await tool.handler({
			scope: {},
			includeContainmentEdges: true,
			includeConnectorEdges: true,
			limit: 100,
			offset: 0,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.graph.nodes)).toBe(true);
		expect(Array.isArray(data.graph.edges)).toBe(true);
	});

	it("validates figjam_move_collection schema and move semantics", async () => {
		const tool = server._getTool("figjam_move_collection");
		expect(
			validate("figjam_move_collection", {
				selectors: { aliases: ["idea-1"] },
				move: { mode: "offset", dx: 20, dy: 10 },
			}).success,
		).toBe(true);
		expect(validate("figjam_move_collection", { selectors: {}, move: { columns: 0 } }).success).toBe(false);

		const result = await tool.handler({
			selectors: { aliases: ["idea-1"] },
			move: { mode: "offset", dx: 20, dy: 10 },
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.moveCollection.movedCount).toBe(1);
	});

	it("validates figjam_archive_collection schema and archive semantics", async () => {
		const tool = server._getTool("figjam_archive_collection");
		expect(validate("figjam_archive_collection", { selectors: { aliases: ["idea-1"] } }).success).toBe(true);
		expect(validate("figjam_archive_collection", { archiveGroupId: "" }).success).toBe(false);

		const result = await tool.handler({ selectors: { aliases: ["idea-1"] } });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.archive.archivedCount).toBe(1);
	});

	it("validates figjam_apply_layout_to_collection schema and layout output", async () => {
		const tool = server._getTool("figjam_apply_layout_to_collection");
		expect(
			validate("figjam_apply_layout_to_collection", {
				selectors: { aliases: ["idea-1"] },
				layout: { mode: "grid", originX: 0, originY: 0, columns: 2, gapX: 300, gapY: 200 },
			}).success,
		).toBe(true);
		expect(validate("figjam_apply_layout_to_collection", { selectors: {}, layout: { columns: 0 } }).success).toBe(
			false,
		);

		const result = await tool.handler({
			selectors: { aliases: ["idea-1"] },
			layout: { mode: "grid", originX: 0, originY: 0, columns: 1, gapX: 300, gapY: 200 },
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.layoutResult.movedCount).toBe(1);
	});

	it("validates figjam_export_board_snapshot schema and snapshot envelope", async () => {
		const tool = server._getTool("figjam_export_board_snapshot");
		expect(validate("figjam_export_board_snapshot", {}).success).toBe(true);
		expect(validate("figjam_export_board_snapshot", { includeRawPluginData: "yes" }).success).toBe(false);

		const result = await tool.handler({ scope: {}, includeRawPluginData: true });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.snapshot.version).toBe("figjam.dbi.v1");
		expect(Array.isArray(data.snapshot.entities)).toBe(true);
	});

	it("validates figjam_import_reference_bundle schema and import response", async () => {
		const tool = server._getTool("figjam_import_reference_bundle");
		expect(
			validate("figjam_import_reference_bundle", {
				items: [{ title: "OpenAI", url: "https://openai.com" }],
			}).success,
		).toBe(true);
		expect(validate("figjam_import_reference_bundle", { items: [] }).success).toBe(false);

		const result = await tool.handler({
			title: "Bundle",
			items: [{ title: "OpenAI", url: "https://openai.com" }],
			layout: { mode: "grid", originX: 0, originY: 0, columns: 2, gapX: 300, gapY: 220 },
			linkPolicy: "native_only",
			continueOnError: true,
		});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.bundle.total).toBe(1);
		expect(data.bundle.createdCount).toBe(1);
	});

	it("validates captureWebImage schema and deterministic no-target error", async () => {
		const tool = server._getTool("captureWebImage");
		expect(validate("captureWebImage", { url: "https://example.com", selector: "img" }).success).toBe(
			true,
		);
		expect(validate("captureWebImage", { url: "not-url" }).success).toBe(false);

		const result = await tool.handler({
			url: "https://example.com",
			strict: true,
		});
		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.errorCode).toBe("NO_CAPTURE_TARGET");
	});

	it("validates insertLocalImage schema and handles missing file errors", async () => {
		const tool = server._getTool("insertLocalImage");
		expect(validate("insertLocalImage", { localPath: "/tmp/a.png" }).success).toBe(true);
		expect(validate("insertLocalImage", {}).success).toBe(false);

		const result = await tool.handler({ localPath: "/tmp/this-file-does-not-exist.png" });
		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.errorCode).toBe("FILE_NOT_FOUND");
	});

	it("validates createImageReference schema and returns deterministic envelope", async () => {
		const tool = server._getTool("createImageReference");
		expect(validate("createImageReference", { localPath: "/tmp/a.png" }).success).toBe(true);
		expect(validate("createImageReference", { localPath: "" }).success).toBe(false);

		// Avoid filesystem dependency in this unit test.
		const fs = await import("node:fs/promises");
		const spy = jest.spyOn(fs, "readFile").mockResolvedValueOnce(Buffer.from("mock-png"));
		const result = await tool.handler({
			localPath: "/tmp/a.png",
			alias: "bear-ref-1",
			sourceUrl: "https://example.com/bear",
			title: "Bear",
			tags: ["bear", "illustration"],
		});
		spy.mockRestore();

		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.reference.artifactNodeId).toBe("img-1");
		expect(data.reference.alias).toBe("bear-ref-1");
		expect(data.reference.type).toBe("image_reference");
	});

	it("validates createLink schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createLink");
		expect(validate("createLink", { url: "https://example.com", x: 1, y: 2 }).success).toBe(true);
		expect(validate("createLink", { url: "https://example.com", title: "Example" }).success).toBe(
			true,
		);
		expect(validate("createLink", { url: "not-a-url" }).success).toBe(false);

		const result = await tool.handler({ url: "https://example.com", x: 10, y: 20 });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.link.id).toBe("link-1");
		expect(data.link.type).toBe("LINK_UNFURL");
	});

	it("validates createSticky schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createSticky");
		expect(validate("createSticky", { text: "Idea", x: 1, y: 2 }).success).toBe(true);
		expect(validate("createSticky", { x: 1 }).success).toBe(false);

		const result = await tool.handler({ text: "Idea", x: 1, y: 2 });
		expect(result.isError).toBeUndefined();
		expect(result.content[0].type).toBe("text");
		const data = JSON.parse(result.content[0].text);
		expect(data.sticky.id).toBe("sticky-1");
	});

	it("validates updateSticky schema and handles invalid nodeId errors", async () => {
		const tool = server._getTool("updateSticky");
		expect(validate("updateSticky", { nodeId: "1:2", text: "New" }).success).toBe(true);
		expect(validate("updateSticky", { text: "Missing node id" }).success).toBe(false);

		client.updateSticky.mockRejectedValueOnce(new Error("Invalid nodeId: bad-id"));
		const result = await tool.handler({ nodeId: "bad-id", text: "New" });
		expect(result.isError).toBe(true);
		expect(result.content[0].type).toBe("text");
		const data = JSON.parse(result.content[0].text);
		expect(data.error).toContain("Invalid nodeId");
	});

	it("validates deleteSticky schema and handles invalid nodeId errors", async () => {
		const tool = server._getTool("deleteSticky");
		expect(validate("deleteSticky", { nodeId: "1:2" }).success).toBe(true);
		expect(validate("deleteSticky", {}).success).toBe(false);

		client.deleteSticky.mockRejectedValueOnce(new Error("Invalid nodeId: bad-id"));
		const result = await tool.handler({ nodeId: "bad-id" });
		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.error).toContain("Invalid nodeId");
	});

	it("validates createShape schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createShape");
		expect(validate("createShape", { type: "rectangle", text: "R" }).success).toBe(true);
		expect(validate("createShape", { type: "triangle" }).success).toBe(false);

		const result = await tool.handler({ type: "circle" });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.shape.type).toBe("SHAPE_WITH_TEXT");
	});

	it("validates createConnector schema and handles invalid nodeId errors", async () => {
		const tool = server._getTool("createConnector");
		expect(validate("createConnector", { fromNodeId: "1:2", toNodeId: "1:3" }).success).toBe(
			true,
		);
		expect(validate("createConnector", { fromNodeId: "1:2" }).success).toBe(false);

		client.createConnector.mockRejectedValueOnce(new Error("Invalid nodeId: missing endpoint"));
		const result = await tool.handler({ fromNodeId: "bad-id", toNodeId: "1:3" });
		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.error).toContain("Invalid nodeId");
	});

	it("validates createText schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createText");
		expect(validate("createText", { text: "Hello" }).success).toBe(true);
		expect(validate("createText", {}).success).toBe(false);

		const result = await tool.handler({ text: "Hello" });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.textNode.id).toBe("text-1");
	});

	it("validates createSection schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createSection");
		expect(validate("createSection", { name: "Area A", x: 10 }).success).toBe(true);

		const result = await tool.handler({ name: "Area A" });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.section.id).toBe("section-1");
	});

	it("returns board nodes with correct MCP response structure", async () => {
		const tool = server._getTool("getBoardNodes");
		expect(validate("getBoardNodes", {}).success).toBe(true);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		expect(result.content[0].type).toBe("text");
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.nodes)).toBe(true);
		expect(data.count).toBe(1);
	});

	it("returns stickies with correct MCP response structure", async () => {
		const tool = server._getTool("getStickies");
		expect(validate("getStickies", {}).success).toBe(true);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.stickies)).toBe(true);
		expect(data.count).toBe(1);
	});

	it("returns connections with correct MCP response structure", async () => {
		const tool = server._getTool("getConnections");
		expect(validate("getConnections", {}).success).toBe(true);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.connections)).toBe(true);
		expect(data.count).toBe(1);
	});

	it("propagates plugin nodeId errors with MCP error envelopes on query tools", async () => {
		const boardTool = server._getTool("getBoardNodes");
		const stickyTool = server._getTool("getStickies");
		const connTool = server._getTool("getConnections");

		client.getBoardNodes.mockRejectedValueOnce(new Error("Invalid nodeId in board traversal"));
		client.getStickies.mockRejectedValueOnce(new Error("Invalid nodeId in sticky lookup"));
		client.getConnections.mockRejectedValueOnce(new Error("Invalid nodeId in connector lookup"));

		const boardRes = await boardTool.handler({});
		const stickyRes = await stickyTool.handler({});
		const connRes = await connTool.handler({});

		expect(boardRes.isError).toBe(true);
		expect(stickyRes.isError).toBe(true);
		expect(connRes.isError).toBe(true);
		expect(JSON.parse(boardRes.content[0].text).error).toContain("Invalid nodeId");
		expect(JSON.parse(stickyRes.content[0].text).error).toContain("Invalid nodeId");
		expect(JSON.parse(connRes.content[0].text).error).toContain("Invalid nodeId");
	});
});
