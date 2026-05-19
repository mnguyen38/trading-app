import "@testing-library/jest-dom";

// Mock Next.js modules that can't run outside the framework
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
  usePathname: vi.fn(() => "/"),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
