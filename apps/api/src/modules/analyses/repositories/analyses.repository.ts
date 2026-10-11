import type { Pool, QueryResultRow } from "pg";
import type { AnalysisOutput } from "../utils/output.js";
import type { FailureCode } from "../utils/provider.js";
import { AnalysisError } from "../utils/errors.js";

export type AnalysisRecord = {
  id: string; ticket_id: string; owner_id: string; status: "running" | "succeeded" | "failed";
  model: string; prompt_version: string; instruction: string | null;
  created_at: Date; completed_at: Date | null; failure_code: FailureCode | null;
  summary: string | null; category: AnalysisOutput["category"] | null; uncertainty_note: string | null;
};
type Lease = { finish(row: AnalysisRecord): Promise<AnalysisRecord>; release(): Promise<void> };
export type Analyses = {
  start(row: AnalysisRecord): Promise<Lease>;
  history(owner: string, ticket: string): Promise<AnalysisRecord[]>;
};

export function createAnalyses(pool: Pick<Pool, "connect" | "query">): Analyses {
  return {
    async history(owner, ticket) {
      const result = await pool.query<AnalysisRecord>(
        "SELECT a.* FROM analyses a JOIN tickets t ON t.id=a.ticket_id AND t.owner_id=a.owner_id WHERE a.owner_id=$1 AND a.ticket_id=$2 ORDER BY a.created_at, a.id", [owner, ticket]);
      return result.rows;
    },
    async start(row) {
      const client = await pool.connect();
      let broken = false;
      const onError = () => { broken = true; };
      client.on("error", onError); // Checked-out clients have no pool error listener.
      let locked = false;
      let released = false;
      let cleanup: Promise<void> | undefined;
      const query = async <T extends QueryResultRow>(sql: string, values: unknown[]) => {
        if (broken || released) throw new AnalysisError("database");
        try {
          const result = await client.query<T>(sql, values);
          if (broken) throw new AnalysisError("database");
          return result;
        } catch {
          broken = true;
          throw new AnalysisError("database");
        }
      };
      const release = (destroy = false) => cleanup ??= Promise.resolve().then(async () => {
        try {
          if (!destroy && !broken && locked) await query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [row.owner_id]);
        } finally {
          released = true;
          try {
            if (destroy || broken) client.release(true);
            else client.release();
          } catch { broken = true; throw new AnalysisError("database"); }
          // Pool reinstalls its idle listener synchronously. Retain our listener on
          // destroyed clients so late asynchronous errors cannot become unhandled.
          if (!destroy && !broken) client.removeListener("error", onError);
        }
        if (broken) throw new AnalysisError("database");
      });
      try {
        const lock = await query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [row.owner_id]);
        locked = lock.rows[0].locked;
        if (!locked) throw new AnalysisError("limit");
        const count = await query<{ count: string }>(
          "SELECT count(*) FROM analyses WHERE owner_id=$1 AND created_at > clock_timestamp() - interval '1 minute'", [row.owner_id]);
        if (Number(count.rows[0].count) >= 5) throw new AnalysisError("limit");
        // Autocommitted before provider invocation; no transaction across paid I/O.
        const inserted = await query<AnalysisRecord>(
          "INSERT INTO analyses (id,ticket_id,owner_id,status,model,prompt_version,instruction,created_at) VALUES ($1,$2,$3,'running',$4,$5,$6,clock_timestamp()) RETURNING *",
          [row.id, row.ticket_id, row.owner_id, row.model, row.prompt_version, row.instruction]);
        row.created_at = inserted.rows[0].created_at;
        return {
          release,
          async finish(result) {
            if (cleanup) throw new AnalysisError("database");
            const saved = await query<AnalysisRecord>(
              "UPDATE analyses SET status=$4,summary=$5,category=$6,uncertainty_note=$7,failure_code=$8,completed_at=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND ticket_id=$3 AND status='running' RETURNING *",
              [result.id, result.owner_id, result.ticket_id, result.status, result.summary, result.category, result.uncertainty_note, result.failure_code]);
            if (!saved.rows[0]) throw new AnalysisError("database");
            return saved.rows[0];
          },
        };
      } catch (error) {
        // A timed-out lock query might have acquired its server-side lock.
        await release(!(error instanceof AnalysisError));
        throw error;
      }
    },
  };
}
