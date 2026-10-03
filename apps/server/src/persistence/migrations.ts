export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '001_doc_updates',
    sql: `
      CREATE TABLE doc_updates (
        seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        room_id text NOT NULL,
        update bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX doc_updates_room_seq ON doc_updates (room_id, seq);
    `,
  },
  {
    id: '002_doc_snapshots',
    sql: `
      CREATE TABLE doc_snapshots (
        room_id text PRIMARY KEY,
        snapshot bytea NOT NULL,
        up_to_seq bigint NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
];
