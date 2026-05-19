import fs from "fs";
import path from "path";
import matter from "gray-matter";

const LESSONS_DIR = path.join(process.cwd(), "content/lessons");

export type LessonAction = "buy-order" | "limit-order" | "close-position" | "read";

export type LessonMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
  tier: 1 | 2 | 3;
  estimatedMinutes: number;
  completionAction: LessonAction;
  requiresMarketOpen: boolean;
  actionHref: string;
  actionLabel: string;
  missionText: string;
};

export type Lesson = LessonMeta & { content: string };

export function getAllLessonMeta(): LessonMeta[] {
  const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith(".mdx"));
  return files
    .map(file => parseMeta(file.replace(/\.mdx$/, "")))
    .sort((a, b) => a.order - b.order);
}

export function getLessonBySlug(slug: string): Lesson | null {
  const filePath = path.join(LESSONS_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;
  const { data, content } = matter(fs.readFileSync(filePath, "utf-8"));
  return { ...metaFromData(slug, data), content };
}

function parseMeta(slug: string): LessonMeta {
  const { data } = matter(fs.readFileSync(path.join(LESSONS_DIR, `${slug}.mdx`), "utf-8"));
  return metaFromData(slug, data);
}

function metaFromData(slug: string, data: Record<string, unknown>): LessonMeta {
  return {
    slug,
    title:              data.title            as string,
    description:        data.description      as string,
    order:              (data.order ?? 99)     as number,
    tier:               (data.tier ?? 1)       as 1 | 2 | 3,
    estimatedMinutes:   (data.estimatedMinutes ?? 5) as number,
    completionAction:   (data.completionAction ?? "read") as LessonAction,
    requiresMarketOpen: (data.requiresMarketOpen ?? false) as boolean,
    actionHref:         (data.actionHref ?? "")  as string,
    actionLabel:        (data.actionLabel ?? "")  as string,
    missionText:        (data.missionText ?? "")  as string,
  };
}
