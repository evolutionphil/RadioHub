import { randomBytes } from 'node:crypto';
import { getPostgresPool } from '../postgres-runtime';

export async function pgTrackVisitor(ipAddress: string, userAgent?: string): Promise<void> {
  await getPostgresPool().query(`INSERT INTO visitor_sessions(id,ip_address,user_agent) VALUES ($1,$2,$3)
    ON CONFLICT(ip_address) DO UPDATE SET last_active_date=now(),user_agent=EXCLUDED.user_agent,visit_count=visitor_sessions.visit_count+1`,
    [randomBytes(12).toString('hex'),ipAddress,userAgent?.slice(0,2048) || null]);
}

export async function pgPruneVisitors(): Promise<number> {
  const result = await getPostgresPool().query("DELETE FROM visitor_sessions WHERE created_at < now()-interval '30 days'");
  return result.rowCount || 0;
}

export async function pgRecordListening(input: { userId: string; stationId: string; stationName?: string; listenDuration: number; country?: string; genre?: string }): Promise<void> {
  if (!Number.isFinite(input.listenDuration) || input.listenDuration <= 0 || input.listenDuration > 2147483647) throw new Error('Invalid listen duration');
  await getPostgresPool().query(`INSERT INTO listening_history(id,user_id,session_id,station_id,station_name,listen_duration,country,genre,interaction_type,listened_at)
    VALUES ($1,$2,$2,$3,$4,$5,$6,$7,'listen',now())`,
    [randomBytes(12).toString('hex'),input.userId,input.stationId,input.stationName || 'Unknown',Math.max(1,Math.round(input.listenDuration)),input.country || 'Unknown',input.genre || 'Unknown']);
}

export async function pgGetAppState(key: string): Promise<Record<string, any> | null> {
  return (await getPostgresPool().query('SELECT value FROM runtime_app_state WHERE key=$1',[key])).rows[0]?.value || null;
}
export async function pgSetAppState(key: string, value: Record<string, any>): Promise<void> {
  await getPostgresPool().query(`INSERT INTO runtime_app_state(key,value) VALUES ($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[key,JSON.stringify(value)]);
}

export async function pgSaveDescriptionJob(jobId: string, totalStations: number, patch: Record<string, any>): Promise<void> {
  const columns: Record<string,string> = {
    status:'status',filterByCountry:'filter_by_country',processedStations:'processed_stations',successCount:'success_count',failedCount:'failed_count',
    skippedCount:'skipped_count',lastProcessedStationId:'last_processed_station_id',lastProcessedSkip:'last_processed_skip',errorMessage:'error_message',
  };
  const entries = Object.entries(patch).filter(([key])=>columns[key]);
  const values = [randomBytes(12).toString('hex'),jobId,totalStations,...entries.map(([,value])=>value)];
  await getPostgresPool().query(`INSERT INTO bulk_description_jobs(id,job_id,total_stations${entries.map(([key])=>','+columns[key]).join('')})
    VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(job_id) DO UPDATE SET updated_at=now()
    ${entries.map(([key])=>`,${columns[key]}=EXCLUDED.${columns[key]}`).join('')}`,values);
}
