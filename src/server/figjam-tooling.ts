import type { FigJamClient } from "../figjam-api/figjamClient.js";

export type GetFigJamClient = () => Promise<FigJamClient>;

export function ok(data: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(data),
			},
		],
	};
}

export function fail(error: unknown, message: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
					message,
				}),
			},
		],
		isError: true,
	};
}
