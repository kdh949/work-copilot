import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  BriefContent,
  EvidenceCitation,
  StoredBriefEvidence,
} from '../work-briefs/brief-draft.types';

const MAX_RENDERED_CHARS = 200_000;

export type RenderedPublicationBrief = {
  pageTitle: string;
  storageBody: string;
  contentHash: string;
};

/**
 * Only this renderer creates Confluence storage markup.  Draft and evidence
 * values are always escaped, so an indirect prompt injection cannot become
 * executable Confluence markup when an approved brief is published.
 */
@Injectable()
export class PublicationRendererService {
  render(
    sourceJiraKey: string,
    content: BriefContent,
    evidence: readonly StoredBriefEvidence[],
  ): RenderedPublicationBrief {
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    const pageTitle = this.pageTitle(sourceJiraKey, content.title.text);
    const sections = [
      `<h1>${this.escape(content.title.text)}</h1>`,
      `<p>${this.richText(content.summary.text)}</p>${this.citations(content.summary, evidenceById)}`,
      this.section('요구사항', content.requirements, evidenceById),
      this.section('완료 기준', content.acceptanceCriteria, evidenceById),
      this.section('위험 및 의존성', content.risks, evidenceById),
      this.section('다음 단계', content.nextSteps, evidenceById),
      this.evidenceSection(evidence),
    ].filter(Boolean);
    const storageBody = sections.join('');

    if (storageBody.length > MAX_RENDERED_CHARS) {
      throw new BadRequestException('Brief publication preview is too large.');
    }

    return {
      pageTitle,
      storageBody,
      contentHash: createHash('sha256')
        .update(`${pageTitle}\n${storageBody}`)
        .digest('hex'),
    };
  }

  private pageTitle(sourceJiraKey: string, title: string): string {
    const normalizedKey = sourceJiraKey.trim().toUpperCase();
    const normalizedTitle = title.trim().replace(/\s+/g, ' ');
    const value = `[${normalizedKey}] ${normalizedTitle}`;
    return value.slice(0, 255);
  }

  private section(
    title: string,
    citations: readonly EvidenceCitation[],
    evidenceById: ReadonlyMap<string, StoredBriefEvidence>,
  ): string {
    if (citations.length === 0) {
      return '';
    }
    const items = citations
      .map(
        (citation) =>
          `<li>${this.richText(citation.text)}${this.citations(citation, evidenceById)}</li>`,
      )
      .join('');
    return `<h2>${this.escape(title)}</h2><ul>${items}</ul>`;
  }

  private evidenceSection(evidence: readonly StoredBriefEvidence[]): string {
    const items = evidence
      .map((item) => {
        const link = this.safeHref(item.url);
        const title = this.escape(item.title);
        const visible = link
          ? `<a href="${this.escapeAttribute(link)}">${title}</a>`
          : title;
        return `<li>${visible} <code>${this.escape(item.id)}</code> · v${this.escape(item.version)}</li>`;
      })
      .join('');
    return items ? `<h2>사용한 근거</h2><ol>${items}</ol>` : '';
  }

  private citations(
    citation: EvidenceCitation,
    evidenceById: ReadonlyMap<string, StoredBriefEvidence>,
  ): string {
    const links = citation.evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id);
      if (!evidence) {
        return [];
      }
      const href = this.safeHref(evidence.url);
      const label = this.escape(evidence.title);
      return [
        href
          ? `<a href="${this.escapeAttribute(href)}">${label}</a>`
          : `<span>${label}</span>`,
      ];
    });
    return links.length ? `<p><em>근거: ${links.join(', ')}</em></p>` : '';
  }

  private richText(value: string): string {
    return this.escape(value).replace(/\r?\n/g, '<br />');
  }

  private safeHref(value: string): string | null {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttribute(value: string): string {
    return this.escape(value);
  }
}
