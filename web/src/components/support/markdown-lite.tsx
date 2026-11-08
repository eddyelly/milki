import { Fragment, type ReactNode } from 'react';

/** Help-article text: paragraphs, "- " lists and **bold**. Rendered as React nodes (never as HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => l.trim().startsWith('- '))) {
          return (
            <ul key={i} className="my-3 list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.trim().slice(2))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="my-3 leading-relaxed">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
