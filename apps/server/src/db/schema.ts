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

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  workspaces: WorkspacesTable
  devices: DevicesTable
}
