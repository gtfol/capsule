export interface BackgroundProgress { stage: "download" | "processing"; progress?: number; }
export interface BackgroundRequest { id: string; image: Blob; }
export type BackgroundResponse =
  | { id: string; type: "progress"; value: BackgroundProgress }
  | { id: string; type: "complete"; image: Blob }
  | { id: string; type: "error"; message: string };
