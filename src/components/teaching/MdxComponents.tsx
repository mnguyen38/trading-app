import type { MDXComponents } from "mdx/types";

export const mdxComponents: MDXComponents = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-8 text-2xl font-bold text-white first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 text-lg font-semibold text-neutral-100 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 font-semibold text-neutral-200">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 leading-relaxed text-neutral-300">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 list-disc space-y-1.5 pl-5 text-neutral-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-neutral-300">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-neutral-300">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-orange-400 pl-4 text-neutral-400">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-sm text-orange-300">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-neutral-800">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="py-2 pr-4 text-neutral-300">{children}</td>
  ),
  hr: () => <hr className="my-6 border-neutral-800" />,
};
