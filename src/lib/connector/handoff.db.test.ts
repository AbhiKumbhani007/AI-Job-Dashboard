import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { applicationFromPaste, handOffEmailToCode, handOffFoundPosting, handOffPastedPosting, handOffPastedPostingToCode, handsOffToClaude, linkPastedPosting, PASTE_DAYS, readPastedPosting } from "./handoff";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/job-search/find", () => ({ fullText: vi.fn(async () => "The whole text") }));
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));

const prisma = () => db.client!;
const promptOf = (url: string) => new URL(url).searchParams.get("q")!;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("handing work to Claude chat (#221)", () => {
  it("only happens with the connector on and no AI model of Dossier's own", async () => {
    expect(await handsOffToClaude(false)).toBe(false);
    await saveSettings({ connectorEnabledAt: "2026-10-23T09:00:00.000Z" });
    expect(await handsOffToClaude(false)).toBe(true);
    expect(await handsOffToClaude(true)).toBe(false);
  });

  it("names a Find jobs posting by its id, kept with its whole text, for the connector's tools", async () => {
    const posting = {
      source: "JSEARCH",
      externalId: "j1",
      title: "Product Designer",
      company: "Acme",
      place: "Berlin",
      remote: null,
      salary: "",
      postedAt: null,
      url: "",
      via: "",
      description: "Figma",
      complete: false,
    } as const;
    const write = await handOffFoundPosting(posting, "write");
    const stored = await prisma().posting.findFirstOrThrow({ where: { externalId: "j1" } });
    expect(stored).toMatchObject({ description: "The whole text", complete: true });
    expect(write).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
    expect(promptOf(write)).toContain(`posting_id "${stored.id}" (Product Designer at Acme)`);
    expect(promptOf(write)).toContain("save_application");
    expect(promptOf(await handOffFoundPosting(posting, "score"))).toContain("save_job_scores");
    expect(write.length).toBeLessThan(2000);
  });

  it("keeps a pasted posting for Claude for 14 days, however long, then the sweep deletes it", async () => {
    const text = "Senior Product Designer. ".repeat(500);
    const now = new Date("2026-10-23T09:00:00Z");
    const { url, pasteId } = await handOffPastedPosting({ text, url: "https://jobs.example/1" }, now);
    const id = /paste_id "([^"]+)"/.exec(promptOf(url))![1];
    expect(id).toBe(pasteId);
    expect(url.length).toBeLessThan(2000);
    expect(await readPastedPosting(id, now)).toEqual({ text, url: "https://jobs.example/1" });
    expect(await readPastedPosting("../nope", now)).toBeNull();

    const later = new Date(now.getTime() + PASTE_DAYS * DAY + 1);
    expect(await readPastedPosting(id, later)).toBeNull();
    await sweepFinishedJobs(later, 24);
    expect(await prisma().claudePaste.count()).toBe(0);
  });

  it("gives Claude Code in Terminal the same pasted posting, by a link that names only what to do and its id", async () => {
    const now = new Date("2026-10-23T09:00:00Z");
    const { prompt, link, pasteId } = await handOffPastedPostingToCode({ text: "Senior Designer at Acme", url: "https://jobs.example/1" }, now);
    const id = /^dossier-claude:\/\/write\?paste_id=([0-9a-f-]{36})$/.exec(link)![1];
    expect(id).toBe(pasteId);
    expect(prompt).toContain(`paste_id "${id}"`);
    expect(prompt).toContain("save_application");
    expect(await readPastedPosting(id, now)).toEqual({ text: "Senior Designer at Acme", url: "https://jobs.example/1" });
  });

  it("remembers the application Claude saved from a pasted posting, for New application to open", async () => {
    const { pasteId } = await handOffPastedPostingToCode({ text: "Senior Designer at Acme", url: "" });
    expect(await applicationFromPaste(pasteId)).toBeNull();

    const application = await prisma().application.create({ data: { title: "Designer · Acme", company: "Acme", role: "Designer" } });
    await linkPastedPosting(pasteId, application.id);
    expect(await applicationFromPaste(pasteId)).toBe(application.id);

    // Not an id, or a posting that's gone: nothing to open, and no error.
    await linkPastedPosting("../nope", application.id);
    expect(await applicationFromPaste("../nope")).toBeNull();
    expect(await applicationFromPaste("00000000-0000-0000-0000-000000000000")).toBeNull();

    // The application goes, the posting stays, unlinked.
    await prisma().application.delete({ where: { id: application.id } });
    expect(await applicationFromPaste(pasteId)).toBeNull();
    expect(await prisma().claudePaste.count()).toBe(1);
  });

  it("continues the Claude Code session that wrote an application when its email is written, else starts one", async () => {
    const application = await prisma().application.create({ data: { title: "Designer · Acme", company: "Acme", role: "Designer" } });
    const without = await handOffEmailToCode(application.id);
    expect(without.link).toBe(`dossier-claude://email?application_id=${application.id}`);
    expect(without.prompt).toContain(`id "${application.id}"`);
    expect(without.prompt).toContain("save_email");

    // The session is named by the posting it started from.
    const { pasteId } = await handOffPastedPostingToCode({ text: "Senior Designer at Acme", url: "" });
    await linkPastedPosting(pasteId, application.id);
    expect((await handOffEmailToCode(application.id)).link).toBe(`dossier-claude://email?application_id=${application.id}&session=${pasteId}`);
  });
});
