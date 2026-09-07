-- Cancellation is an existing terminal state in the application and MongoDB
-- history. Preserve it verbatim instead of rejecting or rewriting cancelled jobs.
ALTER TABLE bulk_description_jobs
  DROP CONSTRAINT bulk_description_jobs_status_check;
ALTER TABLE bulk_description_jobs
  ADD CONSTRAINT bulk_description_jobs_status_check
    CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled'));
