import { model, Schema } from 'mongoose';

const localized = new Schema({ en: { type: String, required: true }, sw: { type: String, required: true } }, { _id: false });

/** Help-centre categories: Getting started, Transfers, Documents, Mortgages, Account (§11). */
const categorySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: localized, required: true },
    icon: { type: String, default: 'help' },
    order: { type: Number, default: 0 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'kb_categories', versionKey: false },
);
export const KbCategory = model('KbCategory', categorySchema);

const articleSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    categorySlug: { type: String, required: true, index: true },
    title: { type: localized, required: true },
    /** Markdown-lite: paragraphs, "- " lists and **bold**. */
    body: { type: localized, required: true },
    tags: { type: [String], default: [] },
    status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT', index: true },
    helpfulYes: { type: Number, default: 0 },
    helpfulNo: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'kb_articles', versionKey: false },
);
articleSchema.index({ 'title.en': 'text', 'title.sw': 'text', 'body.en': 'text', 'body.sw': 'text', tags: 'text' });
export const KbArticle = model('KbArticle', articleSchema);

/** One "Was this helpful?" vote per voter (user ID, or a salted IP hash for signed-out readers). */
const voteSchema = new Schema(
  { articleId: { type: Schema.Types.ObjectId, required: true }, voterKey: { type: String, required: true }, helpful: { type: Boolean, required: true } },
  { timestamps: true, collection: 'kb_votes', versionKey: false },
);
voteSchema.index({ articleId: 1, voterKey: 1 }, { unique: true });
export const KbVote = model('KbVote', voteSchema);
