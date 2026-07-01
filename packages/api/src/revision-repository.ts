/**
 * GTFS feed revision のファイル永続化。
 *
 * 版メタデータは JSON、zip 本体は別ファイルとして保存する。API 層の
 * MVP 用で、DB/オブジェクトストレージへ移す場合もこの境界だけを差し替える。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { AcceptanceReport, ReleaseGateReport, SpecLock, SpecLockId, ValidationReport } from "@gtfs-studio/core";

export type RevisionStatus = "validated" | "published" | "superseded";

export interface RevisionValidationSnapshot {
  gtfsJpV4: ValidationReport["summary"];
  googleTransitReady: ValidationReport["summary"];
}

export interface WarningApproval {
  key: string;
  code: string;
  message: string;
  entity?: Record<string, unknown>;
  impact: string;
  approver: string;
  approvedAt: string;
}

export interface FeedRevision {
  id: string;
  projectId: string;
  status: RevisionStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  profileId: string;
  validationDate?: string;
  releaseCandidate?: string;
  zipSha256: string;
  zipBytes: number;
  specLocks: Partial<Record<SpecLockId, SpecLock>>;
  acceptance: AcceptanceReport;
  gate: Pick<ReleaseGateReport, "status" | "blockers" | "requiredSpecLocks">;
  validation: RevisionValidationSnapshot;
  importWarnings: string[];
  warningApprovals?: WarningApproval[];
}

export interface CreateRevisionInput {
  id?: string;
  projectId: string;
  createdAt: string;
  profileId: string;
  validationDate?: string;
  releaseCandidate?: string;
  zip: Uint8Array;
  specLocks: Partial<Record<SpecLockId, SpecLock>>;
  acceptance: AcceptanceReport;
  gate: Pick<ReleaseGateReport, "status" | "blockers" | "requiredSpecLocks">;
  validation: RevisionValidationSnapshot;
  importWarnings: string[];
}

export interface RevisionRepository {
  readonly root: string;
  list(projectId: string): FeedRevision[];
  get(projectId: string, revisionId: string): FeedRevision | undefined;
  getLatestPublished(projectId: string): FeedRevision | undefined;
  create(input: CreateRevisionInput): FeedRevision;
  publish(projectId: string, revisionId: string, publishedAt: string): FeedRevision | undefined;
  saveWarningApprovals(projectId: string, revisionId: string, approvals: WarningApproval[], updatedAt: string): FeedRevision | undefined;
  readZip(projectId: string, revisionId: string): Uint8Array | undefined;
}

export function openRevisionRepository(root: string): RevisionRepository {
  function projectDir(projectId: string): string {
    return join(root, safeSegment(projectId));
  }

  function revisionDir(projectId: string, revisionId: string): string {
    return join(projectDir(projectId), "revisions", safeSegment(revisionId));
  }

  function manifestPath(projectId: string, revisionId: string): string {
    return join(revisionDir(projectId, revisionId), "revision.json");
  }

  function zipPath(projectId: string, revisionId: string): string {
    return join(revisionDir(projectId, revisionId), "gtfs.zip");
  }

  function readManifest(projectId: string, revisionId: string): FeedRevision | undefined {
    const path = manifestPath(projectId, revisionId);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as FeedRevision;
  }

  function writeManifest(revision: FeedRevision) {
    const path = manifestPath(revision.projectId, revision.id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(revision, null, 2) + "\n");
  }

  function list(projectId: string): FeedRevision[] {
    const dir = join(projectDir(projectId), "revisions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => readManifest(projectId, entry.name))
      .filter((revision): revision is FeedRevision => revision !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return {
    root,
    list,
    get: readManifest,
    getLatestPublished: (projectId) =>
      list(projectId)
        .filter((revision) => revision.status === "published")
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))[0],
    create: (input) => {
      const id = input.id ? safeSegment(input.id) : makeRevisionId(input.createdAt);
      const zipSha256 = createHash("sha256").update(input.zip).digest("hex");
      const revision: FeedRevision = {
        id,
        projectId: input.projectId,
        status: "validated",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        profileId: input.profileId,
        validationDate: input.validationDate,
        releaseCandidate: input.releaseCandidate,
        zipSha256,
        zipBytes: input.zip.byteLength,
        specLocks: input.specLocks,
        acceptance: input.acceptance,
        gate: input.gate,
        validation: input.validation,
        importWarnings: input.importWarnings,
      };
      const outZipPath = zipPath(input.projectId, id);
      mkdirSync(dirname(outZipPath), { recursive: true });
      writeFileSync(outZipPath, Buffer.from(input.zip));
      writeManifest(revision);
      return revision;
    },
    publish: (projectId, revisionId, publishedAt) => {
      const target = readManifest(projectId, revisionId);
      if (!target) return undefined;
      for (const revision of list(projectId)) {
        if (revision.id === revisionId) continue;
        if (revision.status === "published") {
          writeManifest({ ...revision, status: "superseded", updatedAt: publishedAt });
        }
      }
      const published: FeedRevision = {
        ...target,
        status: "published",
        updatedAt: publishedAt,
        publishedAt,
      };
      writeManifest(published);
      return published;
    },
    saveWarningApprovals: (projectId, revisionId, approvals, updatedAt) => {
      const target = readManifest(projectId, revisionId);
      if (!target) return undefined;
      const updated: FeedRevision = {
        ...target,
        updatedAt,
        warningApprovals: approvals,
      };
      writeManifest(updated);
      return updated;
    },
    readZip: (projectId, revisionId) => {
      const path = zipPath(projectId, revisionId);
      if (!existsSync(path)) return undefined;
      return new Uint8Array(readFileSync(path));
    },
  };
}

function makeRevisionId(iso: string): string {
  const compact = iso.replace(/\D/g, "").slice(0, 14) || "revision";
  return `rev_${compact}`;
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`invalid path segment: ${value}`);
  }
  return trimmed;
}
