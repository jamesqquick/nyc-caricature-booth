/** A print job row from the Worker's D1 database. */
export type PrintJob = {
	id: string;
	session_id: string;
	event_id: string;
	postcard_key: string;
	postcard_url: string;
	scene_name: string;
	created_at: number;
};

export type AgentConfig = {
	workerUrl: string;
	eventId: string;
	pollIntervalMs: number;
	batchSize: number;
	/** Bearer token for the print-agent API — must equal the Worker's ADMIN_PASSWORD. */
	printAgentToken: string;
};
