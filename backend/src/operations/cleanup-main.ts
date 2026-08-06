import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { PublicationStep } from '../publications/entities/publication-step.entity';
import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { TransientEvidenceFragment } from '../work-briefs/entities/transient-evidence-fragment.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { runExpiredWorkCopilotCleanup } from './cleanup-runner';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    ...createDatabaseOptions(),
    // Every entity the runner asks for must be registered here or the
    // repository lookup fails at runtime, not at build time.
    entities: [
      TransientEvidenceFragment,
      SourceChangeEvent,
      WorkBriefDraft,
      BriefPublication,
      PublicationStep,
    ],
  });

  try {
    await dataSource.initialize();
    const result = await runExpiredWorkCopilotCleanup(dataSource);
    const summary = result.jobs
      .map(
        (job) =>
          `${job.job}:${job.outcome}:${job.deletedCount}:${job.skippedCount}`,
      )
      .join(',');

    process.stdout.write(`work-copilot-cleanup ${summary}\n`);
    if (!result.succeeded) {
      process.exitCode = 1;
    }
  } catch {
    // Do not emit database URLs, raw provider data, or driver errors from a
    // scheduled process. The non-zero exit code is the monitorable signal.
    process.stderr.write('work-copilot-cleanup failed\n');
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void main();
