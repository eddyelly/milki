'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronLeft, Eye, EyeOff, Pencil, Plus, ThumbsUp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { type coreFeatures, DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fmtDate } from '@/lib/format';
import { type KbArticle, type KbCategory, ticketWrite, useKbArticles, useKbCategories } from '@/lib/support';

interface Draft {
  slug: string;
  categorySlug: string;
  titleEn: string;
  titleSw: string;
  bodyEn: string;
  bodySw: string;
  tags: string;
}

const empty: Draft = { slug: '', categorySlug: '', titleEn: '', titleSw: '', bodyEn: '', bodySw: '', tags: '' };
const fromArticle = (a: KbArticle): Draft => ({ slug: a.slug, categorySlug: a.categorySlug, titleEn: a.title.en, titleSw: a.title.sw, bodyEn: a.body.en, bodySw: a.body.sw, tags: a.tags.join(', ') });
const toBody = (d: Draft) => ({
  categorySlug: d.categorySlug,
  title: { en: d.titleEn.trim(), sw: d.titleSw.trim() },
  body: { en: d.bodyEn.trim(), sw: d.bodySw.trim() },
  tags: d.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
});
const validDraft = (d: Draft, needSlug: boolean) =>
  (!needSlug || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)) && !!d.categorySlug && [d.titleEn, d.titleSw, d.bodyEn, d.bodySw].every((x) => x.trim().length > 0);

/** Both languages are required: every article renders in English and Swahili (§11). */
function ArticleForm({ d, set, cats, withSlug }: { d: Draft; set: (d: Draft) => void; cats: KbCategory[]; withSlug: boolean }) {
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
      <div className="grid gap-3 sm:grid-cols-2">
        {withSlug && (
          <div className="space-y-1.5">
            <Label htmlFor="a-slug">Slug</Label>
            <Input id="a-slug" value={d.slug} onChange={(e) => set({ ...d, slug: e.target.value.toLowerCase() })} placeholder="how-to-transfer" className="font-mono" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="a-cat">Category</Label>
          <Select value={d.categorySlug} onValueChange={(v) => set({ ...d, categorySlug: v })}>
            <SelectTrigger id="a-cat" className="w-full">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {cats.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="a-ten">Title (English)</Label>
          <Input id="a-ten" value={d.titleEn} onChange={(e) => set({ ...d, titleEn: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="a-tsw">Title (Kiswahili)</Label>
          <Input id="a-tsw" value={d.titleSw} onChange={(e) => set({ ...d, titleSw: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-ben">Body (English)</Label>
        <Textarea id="a-ben" rows={6} value={d.bodyEn} onChange={(e) => set({ ...d, bodyEn: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-bsw">Body (Kiswahili)</Label>
        <Textarea id="a-bsw" rows={6} value={d.bodySw} onChange={(e) => set({ ...d, bodySw: e.target.value })} />
      </div>
      <p className="text-xs text-muted-foreground">Formatting: blank line between paragraphs, “- ” for list items, **bold**.</p>
      <div className="space-y-1.5">
        <Label htmlFor="a-tags">Tags</Label>
        <Input id="a-tags" value={d.tags} onChange={(e) => set({ ...d, tags: e.target.value })} placeholder="transfer, sell" />
      </div>
    </div>
  );
}

export function ManageArticlesView() {
  const qc = useQueryClient();
  const cats = useKbCategories();
  const articles = useKbArticles({ status: 'ALL', limit: 100 });
  const [draft, setDraft] = useState<Draft>(empty);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['kb'] });

  const columns: ColumnDef<typeof coreFeatures, KbArticle>[] = [
    {
      id: 'title',
      header: 'Article',
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[26rem]">
          <p className="truncate font-medium">{row.original.title.en}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.title.sw}</p>
        </div>
      ),
    },
    { id: 'category', header: 'Category', cell: ({ row }) => <span className="text-sm">{cats.data?.find((c) => c.slug === row.original.categorySlug)?.name.en ?? row.original.categorySlug}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (row.original.status === 'PUBLISHED' ? <Badge className="bg-success/15 text-success">Published</Badge> : <Badge variant="outline">Draft</Badge>),
    },
    {
      id: 'feedback',
      header: 'Helpful',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1 text-sm">
          <ThumbsUp className="size-3.5" aria-hidden /> {row.original.helpfulYes} / {row.original.helpfulYes + row.original.helpfulNo}
        </span>
      ),
    },
    { id: 'updated', header: 'Updated', cell: ({ row }) => <span className="text-sm text-muted-foreground">{fmtDate(row.original.updatedAt)}</span> },
    { id: 'actions', header: '', cell: ({ row }) => <RowActions a={row.original} cats={cats.data ?? []} onChanged={refresh} /> },
  ];

  return (
    <>
      <Link href="/help" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Help centre
      </Link>
      <PageHeader
        title="Manage help articles"
        description="Drafts are visible to staff only. Publishing makes an article searchable in the app and portal."
        actions={
          <ConfirmAction
            tier="T1"
            title="New help article"
            description="Saved as a draft. Publish it when both languages read well."
            trigger={
              <Button>
                <Plus /> New article
              </Button>
            }
            canConfirm={validDraft(draft, true)}
            confirmLabel="Save draft"
            successMessage="Draft saved"
            onConfirm={(ctx) => ticketWrite('post', '/kb/articles', { ...toBody(draft), slug: draft.slug, status: 'DRAFT' }, ctx.idempotencyKey)}
            onSuccess={() => {
              setDraft(empty);
              refresh();
            }}
          >
            <ArticleForm d={draft} set={setDraft} cats={cats.data ?? []} withSlug />
          </ConfirmAction>
        }
      />
      {articles.isError ? (
        <ErrorState error={articles.error} onRetry={() => void articles.refetch()} />
      ) : (
        <DataTable columns={columns} data={articles.data} loading={articles.isLoading} rowLabel={(a) => a.title.en} empty={<EmptyState title="No articles yet" description="Create the first one with New article." />} />
      )}
    </>
  );
}

function RowActions({ a, cats, onChanged }: { a: KbArticle; cats: KbCategory[]; onChanged: () => void }) {
  const [d, setD] = useState<Draft>(() => fromArticle(a));
  const published = a.status === 'PUBLISHED';
  return (
    <div className="flex justify-end gap-1">
      <ConfirmAction
        tier="T1"
        title={`Edit “${a.title.en}”`}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${a.title.en}`}>
            <Pencil />
          </Button>
        }
        canConfirm={validDraft(d, false)}
        confirmLabel="Save"
        successMessage="Article updated"
        onConfirm={(ctx) => ticketWrite('patch', `/kb/articles/${a._id}`, toBody(d), ctx.idempotencyKey)}
        onSuccess={onChanged}
      >
        <ArticleForm d={d} set={setD} cats={cats} withSlug={false} />
      </ConfirmAction>
      {published ? (
        <ConfirmAction
          tier="T2"
          title="Unpublish this article?"
          consequences={['Landowners will no longer find it in the app.', 'It stays here as a draft.']}
          typeToConfirm={a.slug}
          trigger={
            <Button size="icon-sm" variant="ghost" aria-label={`Unpublish ${a.title.en}`}>
              <EyeOff />
            </Button>
          }
          confirmLabel="Unpublish"
          successMessage="Article unpublished"
          onConfirm={(ctx) => ticketWrite('patch', `/kb/articles/${a._id}`, { status: 'DRAFT' }, ctx.idempotencyKey)}
          onSuccess={onChanged}
        />
      ) : (
        <ConfirmAction
          tier="T1"
          title="Publish this article?"
          impact={[
            { label: 'English', value: a.title.en },
            { label: 'Kiswahili', value: a.title.sw },
          ]}
          trigger={
            <Button size="icon-sm" variant="ghost" aria-label={`Publish ${a.title.en}`}>
              <Eye />
            </Button>
          }
          confirmLabel="Publish"
          successMessage="Article published"
          onConfirm={(ctx) => ticketWrite('patch', `/kb/articles/${a._id}`, { status: 'PUBLISHED' }, ctx.idempotencyKey)}
          onSuccess={onChanged}
        />
      )}
      <ConfirmAction
        tier="T2"
        title="Delete this article?"
        consequences={['It disappears from the help centre and this list.', 'Votes and history are kept (soft delete).']}
        typeToConfirm={a.slug}
        trigger={
          <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Delete ${a.title.en}`}>
            <Trash2 />
          </Button>
        }
        confirmLabel="Delete"
        successMessage="Article deleted"
        onConfirm={(ctx) => ticketWrite('delete', `/kb/articles/${a._id}`, undefined, ctx.idempotencyKey)}
        onSuccess={onChanged}
      />
    </div>
  );
}
