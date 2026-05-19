/** A print job row from the Worker's D1 database. */
export type PrintJob = {
	id: string;
	session_id: string;
	postcard_key: string;
	postcard_url: string;
	scene_name: string;
	created_at: number;
};

export type AgentConfig = {
	workerUrl: string;
	pollIntervalMs: number;
	batchSize: number;
};
