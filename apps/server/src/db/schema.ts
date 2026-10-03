// Server-side database schema. Timestamps are ISO-8601 strings (UTC).

export interface UsersTable {
  id: string
  email: string
  password_hash: string
  created_at: string
}

export interface SessionsTable {
  /** SHA-256 hash of the session token; the token itself is never stored. */
  id: string
  user_id: string
  created_at: string
  expires_at: string
  /** Device registered with this session; `null` until the client registers. */
  device_id: string | null
}

export interface WorkspacesTable {
  id: string
  name: string
  owner_id: string
  created_at: string
  /** Highest change `seq` removed by log compaction (0 = complete log). */
  compacted_seq: number
}

export interface DevicesTable {
  /** Client-generated, stable per browser profile and user. */
  id: string
  user_id: string
  name: string
  created_at: string
  last_seen_at: string
  /** Set when the user removes the device; its sessions and operations are rejected. */
  revoked_at: string | null
}

// ---------------------------------------------------------------- synchronised entities

interface SyncColumns {
  /** Server-assigned, rises with every applied change of the entity. */
  revision: number
  /** Tombstone; `null` = active. */
  deleted_at: string | null
}

export interface DocumentsTable extends SyncColumns {
  id: string
  workspace_id: string
  parent_id: string | null
  title: string
  sort_key: string
  /** SQLite has no boolean: 0/1. */
  favorite: number
  created_at: string
  updated_at: string
}

export interface BlocksTable extends SyncColumns {
  id: string
  workspace_id: string
  document_id: string
  type: string
  content: string
  /** JSON of `BlockAttrs`. */
  attrs: string
  sort_key: string
}

export interface TagsTable extends SyncColumns {
  id: string
  workspace_id: string
  name: string
}

export interface DocumentTagsTable extends SyncColumns {
  id: string
  workspace_id: string
  document_id: string
  tag_id: string
}

/** Change log entry; `seq` is gap-free and monotonic per workspace (the sync cursor). */
export interface ChangesTable {
  workspace_id: string
  seq: number
  op_id: string
  device_id: string
  entity: string
  entity_id: string
  kind: string
  revision: number
  /** JSON of the operation payload as applied. */
  payload: string
  applied_at: string
}

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  workspaces: WorkspacesTable
  devices: DevicesTable
  documents: DocumentsTable
  blocks: BlocksTable
  tags: TagsTable
  document_tags: DocumentTagsTable
  changes: ChangesTable
}
