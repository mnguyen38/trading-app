export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line px-6 py-10 lg:px-14">
      {eyebrow && (
        <div className="mb-3 text-[13px] font-medium uppercase tracking-[0.18em] text-muted">{eyebrow}</div>
      )}
      <h1 className="font-serif text-5xl font-medium leading-tight tracking-tight">{title}</h1>
      {children && <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted">{children}</p>}
    </div>
  );
}
