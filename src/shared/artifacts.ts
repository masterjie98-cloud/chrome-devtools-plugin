export type ArtifactKind = "screenshot" | "payload";

export interface ArtifactReference {
  id: string;
  uri: string;
  kind: ArtifactKind;
  mimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoredArtifactMetadata extends ArtifactReference {
  sessionId: string;
  relativePath: string;
}

export interface ArtifactReadResult {
  metadata: ArtifactReference;
  bytes: Uint8Array;
}
