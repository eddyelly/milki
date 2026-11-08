'use client';

import { BookOpen, Eye, Search, Settings2, ThumbsDown, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { MarkdownLite } from '@/components/support/markdown-lite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { send, toApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { isSupportStaff, type KbArticle, useKbArticle, useKbArticles, useKbCategories } from '@/lib/support';
import { cn } from '@/lib/utils';

/** Help centre (CLAUDE.md §11): searchable, grouped by category, English and Swahili, "Was this helpful?". */
export function HelpView() {
  const { user } = useAuth();
  const [lang, setLang] = useState<'en' | 'sw'>('en');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const cats = useKbCategories();
  const articles = useKbArticles({ q: q.trim() || undefined, category: category ?? undefined });

  return (
    <>
      <PageHeader
        title={lang === 'en' ? 'Help centre' : 'Kituo cha msaada'}
        description={lang === 'en' ? 'Answers landowners see in the app — useful when replying to tickets.' : 'Majibu ambayo wamiliki wa ardhi wanaona kwenye programu.'}
        actions={
          <>
            <div className="flex rounded-lg border bg-card p-0.5" role="group" aria-label="Language">
              {(['en', 'sw'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cn('rounded-md px-3 py-1 text-sm font-medium', lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                  {l === 'en' ? 'English' : 'Kiswahili'}
                </button>
              ))}
            </div>
            {isSupportStaff(user?.role) && (
              <Button variant="outline" asChild>
                <Link href="/help/manage">
                  <Settings2 /> Manage articles
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === 'en' ? 'Search help (English or Swahili)' : 'Tafuta msaada'} className="h-11 bg-card pl-9" aria-label="Search help" />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <CategoryChip active={category === null} onClick={() => setCategory(null)} label={lang === 'en' ? 'All' : 'Zote'} />
        {(cats.data ?? []).map((c) => (
          <CategoryChip key={c.slug} active={category === c.slug} onClick={() => setCategory(c.slug)} label={`${c.name[lang]} · ${c.articleCount}`} />
        ))}
      </div>
      {articles.isError ? (
        <ErrorState error={articles.error} onRetry={() => void articles.refetch()} />
      ) : articles.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : (articles.data ?? []).length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="No matching articles" description="Try other words, or another category." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {articles.data!.map((a) => (
            <button key={a.slug} type="button" onClick={() => setOpen(a.slug)} className="press rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{cats.data?.find((c) => c.slug === a.categorySlug)?.name[lang]}</p>
                  <h3 className="font-semibold">{a.title[lang]}</h3>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{a.body[lang].replace(/\*\*/g, '')}</p>
                  <p className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ThumbsUp className="size-3" aria-hidden /> {a.helpfulYes}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="size-3" aria-hidden /> {a.views}
                    </span>
                  </p>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
      <ArticleSheet slug={open} lang={lang} onClose={() => setOpen(null)} />
    </>
  );
}

function CategoryChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn('rounded-full border px-3 py-1 text-sm font-medium transition-colors', active ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground')}>
      {label}
    </button>
  );
}

function ArticleSheet({ slug, lang, onClose }: { slug: string | null; lang: 'en' | 'sw'; onClose: () => void }) {
  const a = useKbArticle(slug);
  return (
    <Sheet open={!!slug} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!a.data ? (
          <div className="space-y-3 p-6">
            <SheetHeader className="p-0">
              <SheetTitle>Loading…</SheetTitle>
              <SheetDescription className="sr-only">Help article</SheetDescription>
            </SheetHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-xl">{a.data.title[lang]}</SheetTitle>
              <SheetDescription>
                Updated {fmtDate(a.data.updatedAt)} {a.data.status === 'DRAFT' && <Badge variant="outline">Draft</Badge>}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4">
              <MarkdownLite text={a.data.body[lang]} className="text-sm" />
              <Helpful article={a.data} lang={lang} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Votes are feedback, not data changes (one per reader, changeable), so they need no confirmation dialog. */
function Helpful({ article, lang }: { article: KbArticle; lang: 'en' | 'sw' }) {
  const [voted, setVoted] = useState<boolean | null>(null);
  const vote = async (helpful: boolean) => {
    try {
      await send('post', `/kb/articles/${article.slug}/vote`, { helpful });
      setVoted(helpful);
    } catch (e) {
      toast.error(toApiError(e).message);
    }
  };
  if (article.status !== 'PUBLISHED') return null;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
      <span className="text-sm font-medium">{voted !== null ? (lang === 'en' ? 'Thanks for the feedback!' : 'Asante kwa maoni!') : lang === 'en' ? 'Was this helpful?' : 'Je, hii imesaidia?'}</span>
      <Button size="sm" variant={voted === true ? 'default' : 'outline'} onClick={() => void vote(true)} aria-pressed={voted === true}>
        <ThumbsUp /> {lang === 'en' ? 'Yes' : 'Ndiyo'}
      </Button>
      <Button size="sm" variant={voted === false ? 'default' : 'outline'} onClick={() => void vote(false)} aria-pressed={voted === false}>
        <ThumbsDown /> {lang === 'en' ? 'No' : 'Hapana'}
      </Button>
    </div>
  );
}
