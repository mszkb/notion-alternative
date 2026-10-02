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
}

export interface WorkspacesTable {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  workspaces: WorkspacesTable
}
