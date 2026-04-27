/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SOLANA_RPC_URL?: string;
	readonly VITE_SILENT_CIRCLE_PROGRAM_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
